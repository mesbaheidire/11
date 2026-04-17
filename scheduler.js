const { Telegraf } = require('telegraf');
const db = require('./db');

class PostScheduler {
  constructor() {
    this.checkInterval = null;
    this.cachedCredentials = null;
  }

  setCredentials(credentials) {
    this.cachedCredentials = credentials;
  }

  async addPost(post) {
    if (post.credentials) {
      this.cachedCredentials = post.credentials;
    }
    const newPost = {
      id: Date.now().toString(),
      message: post.message,
      image: post.image,
      scheduledTime: post.scheduledTime,
      channelChoice: post.credentials?.channelChoice || 'both',
      credentials: post.credentials || null,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    await db.addScheduledPost(newPost);
    return newPost;
  }

  async removePost(id) {
    await db.deleteScheduledPost(id);
  }

  async getAllPosts() {
    return await db.getScheduledPosts();
  }

  async checkAndPublish() {
    let claimed;
    try {
      claimed = await db.claimDueScheduledPosts(new Date());
    } catch (e) {
      return;
    }
    for (const post of claimed) {
      try {
        await this.publishPost(post);
        await db.updateScheduledPostStatus(post.id, 'published', null);
        console.log(`✅ Published scheduled post: ${post.id}`);
      } catch (e) {
        await db.updateScheduledPostStatus(post.id, 'failed', e.message);
        console.error(`❌ Failed to publish post ${post.id}:`, e.message);
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
    this.checkInterval = setInterval(() => {
      this.checkAndPublish().catch(e => console.error('Scheduler error:', e.message));
    }, 30000);
    setTimeout(() => {
      this.checkAndPublish().catch(() => {});
    }, 5000);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

module.exports = { PostScheduler };
