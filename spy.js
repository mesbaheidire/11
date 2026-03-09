const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { portaffFunction } = require('./afflink');

const SPY_CONFIG_FILE = path.join(__dirname, 'spy_config.json');
const SPY_LOG_FILE = path.join(__dirname, 'spy_log.json');

function loadConfig() {
  try {
    if (fs.existsSync(SPY_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(SPY_CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('Error loading spy config:', e.message);
  }
  return {
    enabled: false,
    sourceChannels: [],
    targetChannels: [],
    botToken: '',
    cookie: '',
    autoPublish: true,
    linkType: 'coin',
    messageTemplate: {
      prefix: '🔥 عرض حصري',
      priceLabel: '💰 السعر:',
      linkLabel: '🛒 رابط الشراء:',
      footer: '⚠️ لا تنس استخدام البوت الرسمي لـ AliOffersDz',
      botLink: '@AliOffersDZ_bot',
      hashtags: '#Aliexpress #تخفيضات'
    }
  };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(SPY_CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (e) {
    console.log('Error saving spy config:', e.message);
    return false;
  }
}

function loadLog() {
  try {
    if (fs.existsSync(SPY_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(SPY_LOG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveLog(log) {
  try {
    const trimmed = log.slice(-200);
    fs.writeFileSync(SPY_LOG_FILE, JSON.stringify(trimmed, null, 2));
  } catch (e) {}
}

function addLogEntry(entry) {
  const log = loadLog();
  log.push({ ...entry, timestamp: new Date().toISOString() });
  saveLog(log);
}

function extractAliExpressLinks(text) {
  if (!text) return [];
  const patterns = [
    /https?:\/\/[^\s]*aliexpress\.com[^\s]*/gi,
    /https?:\/\/[^\s]*a\.aliexpress\.com[^\s]*/gi,
    /https?:\/\/[^\s]*s\.click\.aliexpress\.com[^\s]*/gi,
    /https?:\/\/[^\s]*star\.aliexpress\.com[^\s]*/gi
  ];
  const links = new Set();
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) matches.forEach(m => links.add(m));
  }
  return [...links];
}

function extractPrice(text) {
  if (!text) return null;
  const patterns = [
    /(\d+[\.,]\d+)\s*(?:د\.ج|DA|DZD|دج)/i,
    /(\d+[\.,]\d+)\s*(?:\$|USD|€|EUR)/i,
    /(?:السعر|Price|سعر)[:\s]*(\d+[\.,]\d+)/i,
    /(\d+[\.,]\d+)\s*(?:ج|جنيه|ريال|درهم)/i,
    /(\$|€)?\s*(\d+[\.,]\d+)/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const priceStr = match[2] || match[1];
      if (priceStr && parseFloat(priceStr.replace(',', '.')) > 0) {
        return priceStr;
      }
    }
  }
  return null;
}

let spyBot = null;
let spyRunning = false;

async function startSpy(config) {
  if (spyRunning && spyBot) {
    await stopSpy();
  }

  if (!config.botToken) {
    throw new Error('توكن البوت مطلوب');
  }
  if (!config.sourceChannels || config.sourceChannels.length === 0) {
    throw new Error('يجب إضافة قناة مصدر واحدة على الأقل');
  }
  if (!config.targetChannels || config.targetChannels.length === 0) {
    throw new Error('يجب إضافة قناة هدف واحدة على الأقل');
  }

  spyBot = new Telegraf(config.botToken);
  const sourceIds = config.sourceChannels.map(ch => {
    if (ch.startsWith('-')) return ch;
    if (ch.startsWith('@')) return ch;
    if (ch.includes('t.me/')) {
      const match = ch.match(/t\.me\/([^\/\?]+)/);
      if (match) return '@' + match[1];
    }
    return '@' + ch;
  });

  const targetIds = config.targetChannels.map(ch => {
    if (ch.startsWith('-')) return ch;
    if (ch.startsWith('@')) return ch;
    if (ch.includes('t.me/')) {
      const match = ch.match(/t\.me\/([^\/\?]+)/);
      if (match) return '@' + match[1];
    }
    return '@' + ch;
  });

  spyBot.on('channel_post', async (ctx) => {
    try {
      const post = ctx.channelPost;
      const chatId = String(post.chat.id);
      const chatUsername = post.chat.username ? '@' + post.chat.username : '';

      const isSourceChannel = sourceIds.some(src => {
        return src === chatId || src === chatUsername || src === post.chat.username;
      });

      if (!isSourceChannel) return;

      const text = post.text || post.caption || '';
      const aliLinks = extractAliExpressLinks(text);

      if (aliLinks.length === 0) return;

      const price = extractPrice(text);
      const sourceName = post.chat.title || chatUsername || chatId;

      console.log(`🕵️ رصد منشور من ${sourceName} يحتوي على ${aliLinks.length} رابط`);

      for (const originalLink of aliLinks) {
        try {
          const cookie = config.cookie || process.env.cook || '';
          const result = await portaffFunction(cookie, originalLink);

          if (!result || !result.aff) {
            addLogEntry({
              source: sourceName,
              originalLink,
              status: 'failed',
              error: 'فشل تحويل الرابط'
            });
            continue;
          }

          const affLink = result.aff[config.linkType || 'coin'] ||
                          result.aff.coin ||
                          result.aff.super ||
                          result.aff.point ||
                          Object.values(result.aff).find(v => v);

          if (!affLink) {
            addLogEntry({
              source: sourceName,
              originalLink,
              status: 'failed',
              error: 'لا يوجد رابط أفلييت متاح'
            });
            continue;
          }

          const productTitle = (result.previews && result.previews.title) || '';
          const productImage = (result.previews && result.previews.image_url) || '';
          const productPrice = price || (result.previews && result.previews.price) || '';

          const t = config.messageTemplate || {};
          let message = '';
          if (t.prefix) message += `${t.prefix} ${productTitle}\n\n`;
          else message += `${productTitle}\n\n`;
          if (productPrice && t.priceLabel) message += `${t.priceLabel} ${productPrice}\n\n`;
          if (t.linkLabel) message += `${t.linkLabel}\n${affLink}\n\n`;
          else message += `${affLink}\n\n`;
          if (t.footer) message += `${t.footer}\n`;
          if (t.botLink) message += `🔗 ${t.botLink}\n\n`;
          if (t.hashtags) message += t.hashtags;

          if (config.autoPublish) {
            const publishBot = new Telegraf(config.botToken);

            for (const target of targetIds) {
              try {
                if (post.photo && post.photo.length > 0) {
                  const largestPhoto = post.photo[post.photo.length - 1];
                  await publishBot.telegram.sendPhoto(target, largestPhoto.file_id, {
                    caption: message
                  });
                } else if (productImage) {
                  await publishBot.telegram.sendPhoto(target, productImage, {
                    caption: message
                  });
                } else {
                  await publishBot.telegram.sendMessage(target, message);
                }
                console.log(`✅ تم النشر في ${target}`);
              } catch (pubErr) {
                console.log(`❌ فشل النشر في ${target}:`, pubErr.message);
                addLogEntry({
                  source: sourceName,
                  target,
                  originalLink,
                  affiliateLink: affLink,
                  status: 'publish_failed',
                  error: pubErr.message
                });
              }
            }
          }

          addLogEntry({
            source: sourceName,
            originalLink,
            affiliateLink: affLink,
            title: productTitle,
            price: productPrice,
            image: productImage,
            status: config.autoPublish ? 'published' : 'detected',
            targets: targetIds
          });

        } catch (linkErr) {
          console.log('❌ خطأ في معالجة الرابط:', linkErr.message);
          addLogEntry({
            source: sourceName,
            originalLink,
            status: 'error',
            error: linkErr.message
          });
        }
      }

    } catch (err) {
      console.log('❌ خطأ في معالجة المنشور:', err.message);
    }
  });

  spyBot.catch((err) => {
    if (!err.message.includes('409')) {
      console.log('Spy bot error:', err.message);
    }
  });

  await spyBot.launch({ dropPendingUpdates: true });
  spyRunning = true;
  config.enabled = true;
  saveConfig(config);
  console.log('🕵️ تم تشغيل نظام التجسس');
}

async function stopSpy() {
  if (spyBot) {
    try {
      spyBot.stop('Spy stopped');
    } catch (e) {}
    spyBot = null;
  }
  spyRunning = false;
  const config = loadConfig();
  config.enabled = false;
  saveConfig(config);
  console.log('🛑 تم إيقاف نظام التجسس');
}

function getStatus() {
  const config = loadConfig();
  const safeConfig = { ...config };
  if (safeConfig.botToken) {
    safeConfig.botToken = safeConfig.botToken.substring(0, 8) + '...' + safeConfig.botToken.slice(-4);
  }
  if (safeConfig.cookie) {
    safeConfig.cookie = safeConfig.cookie.substring(0, 8) + '...';
  }
  return {
    running: spyRunning,
    config: safeConfig,
    log: loadLog()
  };
}

module.exports = {
  loadConfig,
  saveConfig,
  startSpy,
  stopSpy,
  getStatus,
  loadLog,
  addLogEntry,
  extractAliExpressLinks,
  extractPrice
};
