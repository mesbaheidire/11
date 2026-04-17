const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');

const SCHEDULED_FILE = path.join(__dirname, 'scheduled_posts.json');

class PostScheduler {
  constructor() {
    this.scheduledPosts = this.loadScheduledPosts();
    this.checkInterval = null;
    this.cachedCredentials = null;
  }

  setCredentials(credentials) {
    this.cachedCredentials = credentials;
  }

  saveScheduledPosts() {
    try {
      const postsToSave = this.scheduledPosts.map(p => {
        // We need to keep credentials for at least one turn to ensure publishPost can access them
        // But for security, we'll only save them if they aren't already in the file or if we really need them
        return p; 
      });
      fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(postsToSave, null, 2));
    } catch (e) {
      console.error('Error saving scheduled posts:', e);
    }
  }

  loadScheduledPosts() {
    try {
      if (fs.existsSync(SCHEDULED_FILE)) {
        return JSON.parse(fs.readFileSync(SCHEDULED_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('Error loading scheduled posts:', e);
    }
    return [];
  }

  addPost(post) {
    if (post.credentials) {
      this.cachedCredentials = post.credentials;
    }
    
    const newPost = {
      id: Date.now().toString(),
      message: post.message,
      image: post.image,
      scheduledTime: post.scheduledTime,
      channelChoice: post.credentials?.channelChoice || 'both',
      credentials: post.credentials, // Store credentials with the post
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    this.scheduledPosts.push(newPost);
    this.saveScheduledPosts();
    return newPost;
  }

  removePost(id) {
    this.scheduledPosts = this.scheduledPosts.filter(p => p.id !== id);
    this.saveScheduledPosts();
  }

  getScheduledPosts() {
    return this.scheduledPosts.filter(p => p.status === 'pending');
  }

  getAllPosts() {
    return this.scheduledPosts;
  }

  async checkAndPublish() {
    const now = new Date();
    const pendingPosts = this.scheduledPosts.filter(p => p.status === 'pending');
    
    for (const post of pendingPosts) {
      const scheduledTime = new Date(post.scheduledTime);
      
      if (scheduledTime <= now) {
        try {
          await this.publishPost(post);
          post.status = 'published';
          post.publishedAt = new Date().toISOString();
          console.log(`✅ Published scheduled post: ${post.id}`);
        } catch (e) {
          post.status = 'failed';
          post.error = e.message;
          console.error(`❌ Failed to publish post ${post.id}:`, e.message);
        }
        this.saveScheduledPosts();
      }
    }
  }

  async publishPost(post) {
    const { message, image, channelChoice, credentials: postCredentials } = post;
    const credentials = postCredentials || this.cachedCredentials;
    
    if (!credentials || !credentials.telegramToken) {
      const envToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!envToken) {
        throw new Error('Bot token not available - please open the app to refresh credentials');
      }
      const bot = new Telegraf(envToken);
      const envChannelId = process.env.TELEGRAM_CHANNEL_ID;
      if (!envChannelId) {
        throw new Error('Channel ID not configured');
      }

      if (image) {
        if (image.startsWith('data:image')) {
          const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
          const imageBuffer = Buffer.from(base64Data, 'base64');
          await bot.telegram.sendPhoto(envChannelId, { source: imageBuffer }, { caption: message });
        } else {
          await bot.telegram.sendPhoto(envChannelId, image, { caption: message });
        }
      } else {
        await bot.telegram.sendMessage(envChannelId, message);
      }
      return;
    }
    
    const bot = new Telegraf(credentials.telegramToken);
    const channels = [];
    
    const choice = channelChoice || credentials.channelChoice || 'both';
    if (choice === '1' || choice === 'both') {
      if (credentials.channelId) channels.push(this.formatChannelId(credentials.channelId));
    }
    if (choice === '2' || choice === 'both') {
      if (credentials.channelId2) channels.push(this.formatChannelId(credentials.channelId2));
    }
    
    if (channels.length === 0) {
      throw new Error('No channels specified');
    }
    
    for (const ch of channels) {
      if (image) {
        if (image.startsWith('data:image')) {
          const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
          const imageBuffer = Buffer.from(base64Data, 'base64');
          await bot.telegram.sendPhoto(ch, { source: imageBuffer }, { caption: message });
        } else {
          await bot.telegram.sendPhoto(ch, image, { caption: message });
        }
      } else {
        await bot.telegram.sendMessage(ch, message);
      }
    }
  }

  formatChannelId(channelId) {
    if (!channelId) return null;
    channelId = channelId.trim();
    if (channelId.includes('t.me/')) {
      channelId = '@' + channelId.split('t.me/').pop().split('/')[0].split('?')[0];
    }
    if (!channelId.startsWith('@') && !channelId.startsWith('-')) {
      channelId = '@' + channelId;
    }
    return channelId;
  }

  start() {
    console.log('📅 Post scheduler started');
    this.checkInterval = setInterval(() => this.checkAndPublish(), 30000);
    this.checkAndPublish();
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

module.exports = { PostScheduler };
