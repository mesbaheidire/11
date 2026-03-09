const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { portaffFunction } = require('./afflink');

const SPY_CONFIG_FILE = path.join(__dirname, 'spy_config.json');
const SPY_LOG_FILE = path.join(__dirname, 'spy_log.json');
const SESSION_FILE = path.join(__dirname, 'spy_session.json');

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
    mode: 'userbot',
    sourceChannels: [],
    targetChannels: [],
    botToken: '',
    apiId: '',
    apiHash: '',
    phoneNumber: '',
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
    if (matches) matches.forEach(m => {
      let clean = m.replace(/[)}\]>،,؛;]+$/, '');
      links.add(clean);
    });
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

let spyClient = null;
let spyBot = null;
let spyRunning = false;
let authState = { step: 'idle', phoneCodeHash: null };

async function processPost(config, text, photo, sourceName) {
  const aliLinks = extractAliExpressLinks(text);
  if (aliLinks.length === 0) return;

  const price = extractPrice(text);
  const targetIds = (config.targetChannels || []).map(ch => {
    if (ch.startsWith('-')) return ch;
    if (ch.startsWith('@')) return ch;
    if (ch.includes('t.me/')) {
      const match = ch.match(/t\.me\/([^\/\?]+)/);
      if (match) return '@' + match[1];
    }
    return '@' + ch;
  });

  console.log(`🕵️ رصد منشور من ${sourceName} يحتوي على ${aliLinks.length} رابط`);

  for (const originalLink of aliLinks) {
    try {
      const cookie = config.cookie || process.env.cook || '';
      const result = await portaffFunction(cookie, originalLink);

      if (!result || !result.aff) {
        addLogEntry({ source: sourceName, originalLink, status: 'failed', error: 'فشل تحويل الرابط' });
        continue;
      }

      const affLink = result.aff[config.linkType || 'coin'] ||
                      result.aff.coin || result.aff.super || result.aff.point ||
                      Object.values(result.aff).find(v => v);

      if (!affLink) {
        addLogEntry({ source: sourceName, originalLink, status: 'failed', error: 'لا يوجد رابط أفلييت متاح' });
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

      let publishedCount = 0;
      if (config.autoPublish && config.botToken) {
        const publishBot = new Telegraf(config.botToken);
        for (const target of targetIds) {
          try {
            if (photo) {
              await publishBot.telegram.sendPhoto(target, photo, { caption: message });
            } else if (productImage) {
              await publishBot.telegram.sendPhoto(target, productImage, { caption: message });
            } else {
              await publishBot.telegram.sendMessage(target, message);
            }
            publishedCount++;
            console.log(`✅ تم النشر في ${target}`);
          } catch (pubErr) {
            console.log(`❌ فشل النشر في ${target}:`, pubErr.message);
            addLogEntry({ source: sourceName, target, originalLink, affiliateLink: affLink, status: 'publish_failed', error: pubErr.message });
          }
        }
      }

      let finalStatus = 'detected';
      if (config.autoPublish && publishedCount > 0) finalStatus = 'published';
      else if (config.autoPublish && publishedCount === 0 && targetIds.length > 0) finalStatus = 'publish_failed';

      addLogEntry({
        source: sourceName, originalLink, affiliateLink: affLink,
        title: productTitle, price: productPrice, image: productImage,
        status: finalStatus, targets: targetIds
      });
    } catch (linkErr) {
      console.log('❌ خطأ في معالجة الرابط:', linkErr.message);
      addLogEntry({ source: sourceName, originalLink, status: 'error', error: linkErr.message });
    }
  }
}

async function startUserbotSpy(config) {
  const { TelegramClient } = require('telegram');
  const { StringSession } = require('telegram/sessions');
  const { NewMessage } = require('telegram/events');

  const apiId = parseInt(config.apiId);
  const apiHash = config.apiHash;

  if (!apiId || !apiHash) {
    throw new Error('API ID و API Hash مطلوبان - احصل عليهما من my.telegram.org');
  }
  if (!config.botToken && config.autoPublish) {
    throw new Error('توكن البوت مطلوب للنشر في القنوات الهدف');
  }

  let sessionStr = '';
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      sessionStr = sessionData.session || '';
    }
  } catch (e) {}

  const session = new StringSession(sessionStr);
  spyClient = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  if (!sessionStr) {
    throw new Error('SESSION_REQUIRED');
  }

  await spyClient.connect();

  if (!await spyClient.isUserAuthorized()) {
    throw new Error('SESSION_REQUIRED');
  }

  console.log('🕵️ تم الاتصال بحساب تيليجرام');

  const sourceUsernames = config.sourceChannels.map(ch => {
    if (ch.startsWith('@')) return ch.substring(1);
    if (ch.includes('t.me/')) {
      const match = ch.match(/t\.me\/([^\/\?]+)/);
      if (match) return match[1];
    }
    return ch;
  });

  spyClient.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg || !msg.peerId) return;

      let chatEntity;
      try {
        chatEntity = await spyClient.getEntity(msg.peerId);
      } catch (e) { return; }

      const chatUsername = chatEntity.username || '';
      const chatTitle = chatEntity.title || chatUsername || '';

      const isSource = sourceUsernames.some(src => {
        return chatUsername.toLowerCase() === src.toLowerCase() ||
               String(chatEntity.id) === src ||
               ('-100' + chatEntity.id) === src;
      });

      if (!isSource) return;

      const text = msg.message || '';
      let photoUrl = null;

      if (msg.media && msg.media.photo) {
        try {
          const buffer = await spyClient.downloadMedia(msg.media, {});
          if (buffer) {
            const base64 = buffer.toString('base64');
            photoUrl = `data:image/jpeg;base64,${base64}`;
          }
        } catch (e) {
          console.log('⚠️ فشل تحميل الصورة:', e.message);
        }
      }

      let photoForPublish = null;
      if (photoUrl && photoUrl.startsWith('data:image')) {
        const base64Data = photoUrl.replace(/^data:image\/\w+;base64,/, '');
        photoForPublish = { source: Buffer.from(base64Data, 'base64') };
      }

      await processPost(config, text, photoForPublish, chatTitle);
    } catch (err) {
      console.log('❌ خطأ Userbot:', err.message);
    }
  }, new NewMessage({}));

  spyRunning = true;
  config.enabled = true;
  config.mode = 'userbot';
  saveConfig(config);
  console.log('🕵️ تم تشغيل نظام التجسس (Userbot)');
}

async function startBotSpy(config) {
  if (!config.botToken) {
    throw new Error('توكن البوت مطلوب');
  }
  if (!config.sourceChannels || config.sourceChannels.length === 0) {
    throw new Error('يجب إضافة قناة مصدر واحدة على الأقل');
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
      const sourceName = post.chat.title || chatUsername || chatId;

      let photo = null;
      if (post.photo && post.photo.length > 0) {
        photo = post.photo[post.photo.length - 1].file_id;
      }

      await processPost(config, text, photo, sourceName);
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
  config.mode = 'bot';
  saveConfig(config);
  console.log('🕵️ تم تشغيل نظام التجسس (Bot Admin)');
}

async function startSpy(config) {
  if (spyRunning) {
    await stopSpy();
  }

  if (!config.targetChannels || config.targetChannels.length === 0) {
    throw new Error('يجب إضافة قناة هدف واحدة على الأقل');
  }
  if (!config.sourceChannels || config.sourceChannels.length === 0) {
    throw new Error('يجب إضافة قناة مصدر واحدة على الأقل');
  }

  if (config.mode === 'userbot') {
    await startUserbotSpy(config);
  } else {
    await startBotSpy(config);
  }
}

async function stopSpy() {
  if (spyClient) {
    try { await spyClient.disconnect(); } catch (e) {}
    spyClient = null;
  }
  if (spyBot) {
    try { spyBot.stop('Spy stopped'); } catch (e) {}
    spyBot = null;
  }
  spyRunning = false;
  const config = loadConfig();
  config.enabled = false;
  saveConfig(config);
  console.log('🛑 تم إيقاف نظام التجسس');
}

async function sendLoginCode(config) {
  const { TelegramClient } = require('telegram');
  const { StringSession } = require('telegram/sessions');

  const apiId = parseInt(config.apiId);
  const apiHash = config.apiHash;
  const phoneNumber = config.phoneNumber;

  if (!apiId || !apiHash) throw new Error('API ID و API Hash مطلوبان');
  if (!phoneNumber) throw new Error('رقم الهاتف مطلوب');

  if (spyClient) {
    try { await spyClient.disconnect(); } catch (e) {}
    spyClient = null;
  }

  const session = new StringSession('');
  spyClient = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
  await spyClient.connect();

  const result = await spyClient.sendCode(
    { apiId, apiHash },
    phoneNumber
  );

  authState = { step: 'code_sent', phoneCodeHash: result.phoneCodeHash, phoneNumber };
  return { success: true, message: 'تم إرسال رمز التحقق إلى تيليجرام' };
}

async function verifyCode(config, code, password) {
  const { TelegramClient } = require('telegram');

  if (!spyClient) throw new Error('ابدأ بإرسال رمز التحقق أولاً');
  if (authState.step !== 'code_sent' && authState.step !== 'need_password') {
    throw new Error('ابدأ بإرسال رمز التحقق أولاً');
  }

  try {
    if (authState.step === 'need_password') {
      const { computeCheck } = require('telegram/Password');
      const passwordResult = await spyClient.invoke(
        new (require('telegram/tl').Api.account.GetPassword)()
      );
      const srp = await computeCheck(passwordResult, password);
      await spyClient.invoke(
        new (require('telegram/tl').Api.auth.CheckPassword)({ password: srp })
      );
    } else {
      try {
        await spyClient.invoke(
          new (require('telegram/tl').Api.auth.SignIn)({
            phoneNumber: authState.phoneNumber,
            phoneCodeHash: authState.phoneCodeHash,
            phoneCode: code
          })
        );
      } catch (e) {
        if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          authState.step = 'need_password';
          return { success: false, needPassword: true, message: 'الحساب محمي بكلمة مرور - أدخل كلمة المرور' };
        }
        throw e;
      }
    }

    const sessionStr = spyClient.session.save();
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ session: sessionStr }));
    authState = { step: 'authenticated' };

    await spyClient.disconnect();
    spyClient = null;

    return { success: true, message: 'تم تسجيل الدخول بنجاح! يمكنك الآن تشغيل التجسس' };
  } catch (e) {
    throw new Error('فشل التحقق: ' + e.message);
  }
}

function getAuthState() {
  const hasSession = fs.existsSync(SESSION_FILE);
  return {
    step: authState.step,
    hasSession,
    isRunning: spyRunning
  };
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
  safeConfig.apiHash = safeConfig.apiHash ? '****' : '';
  safeConfig.phoneNumber = safeConfig.phoneNumber ? safeConfig.phoneNumber.substring(0, 4) + '****' : '';

  const hasSession = fs.existsSync(SESSION_FILE);
  return {
    running: spyRunning,
    config: safeConfig,
    log: loadLog(),
    hasSession,
    authStep: authState.step
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
  extractPrice,
  sendLoginCode,
  verifyCode,
  getAuthState
};
