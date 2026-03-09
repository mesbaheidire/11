const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { portaffFunction } = require('./afflink');
const http = require('http');

const SPY_CONFIG_FILE = path.join(__dirname, 'spy_config.json');
const SPY_LOG_FILE = path.join(__dirname, 'spy_log.json');
const SESSION_FILE = path.join(__dirname, 'spy_session.json');
const PROCESSED_LINKS_FILE = path.join(__dirname, 'spy_processed.json');

function loadProcessedLinks() {
  try {
    if (fs.existsSync(PROCESSED_LINKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROCESSED_LINKS_FILE, 'utf8'));
      const now = Date.now();
      const filtered = data.filter(entry => now - entry.time < 7 * 24 * 60 * 60 * 1000);
      if (filtered.length < data.length) {
        saveProcessedLinks(filtered);
      }
      return filtered;
    }
  } catch (e) {}
  return [];
}

function saveProcessedLinks(links) {
  try {
    fs.writeFileSync(PROCESSED_LINKS_FILE, JSON.stringify(links));
  } catch (e) {}
}

function isLinkProcessed(link) {
  const processed = loadProcessedLinks();
  const normalized = normalizeAliLink(link);
  return processed.some(entry => entry.link === normalized);
}

function markLinkProcessed(link) {
  const processed = loadProcessedLinks();
  processed.push({ link: normalizeAliLink(link), time: Date.now() });
  saveProcessedLinks(processed);
}

function normalizeAliLink(link) {
  try {
    const url = new URL(link);
    const productMatch = link.match(/\/item\/(\d+)/);
    if (productMatch) return 'product:' + productMatch[1];
    return url.hostname + url.pathname;
  } catch {
    return link;
  }
}

function randomDelay(minMinutes, maxMinutes) {
  const ms = (minMinutes + Math.random() * (maxMinutes - minMinutes)) * 60 * 1000;
  return Math.round(ms);
}

async function sendOwnerNotification(botToken, ownerId, entry) {
  if (!botToken || !ownerId) return;
  try {
    const bot = new Telegraf(botToken);
    let msg = `🔔 *منتج جديد مرصود*\n\n`;
    msg += `📡 المصدر: ${entry.source || 'غير معروف'}\n`;
    if (entry.title) msg += `📦 ${entry.title}\n`;
    if (entry.price) msg += `💰 السعر: ${entry.price}\n`;
    if (entry.affiliateLink) msg += `🔗 الرابط: ${entry.affiliateLink}\n`;
    msg += `\n⏱ سيتم النشر بعد ${entry.delayMinutes || 0} دقيقة`;
    await bot.telegram.sendMessage(ownerId, msg);
  } catch (e) {
    console.log('⚠️ فشل إرسال الإشعار:', e.message);
  }
}

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
    apiId: '',
    apiHash: '',
    phoneNumber: '',
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

function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

function getCookie() {
  return process.env.cook || '';
}

let spyClient = null;
let spyRunning = false;
let authState = { step: 'idle', phoneCodeHash: null };

async function extractPriceWithAI(text) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ text });
    const options = {
      hostname: '127.0.0.1',
      port: parseInt(process.env.PORT) || 5000,
      path: '/api/ai-extract-price',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.success && parsed.price ? parsed.price : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

async function refineTitle(title) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ title, isHook: false });
    const options = {
      hostname: '127.0.0.1',
      port: parseInt(process.env.PORT) || 5000,
      path: '/api/ai-refine-title',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.success ? parsed.refinedTitle : title);
        } catch { resolve(title); }
      });
    });
    req.on('error', () => resolve(title));
    req.setTimeout(15000, () => { req.destroy(); resolve(title); });
    req.write(postData);
    req.end();
  });
}

async function processPost(config, text, _unused, sourceName) {
  const aliLinks = extractAliExpressLinks(text);
  if (aliLinks.length === 0) return;

  let priceFromPost = null;
  try {
    priceFromPost = await extractPriceWithAI(text);
    if (priceFromPost) {
      console.log(`🤖 سعر مستخرج بالذكاء الاصطناعي: ${priceFromPost}`);
    }
  } catch (e) {
    console.log('⚠️ فشل استخراج السعر بالذكاء الاصطناعي:', e.message);
  }
  if (!priceFromPost) {
    priceFromPost = extractPrice(text);
    if (priceFromPost) console.log(`📋 سعر مستخرج بالنمط: ${priceFromPost}`);
  }
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
    if (isLinkProcessed(originalLink)) {
      console.log(`🔁 تم تخطي رابط مكرر: ${originalLink.substring(0, 50)}...`);
      continue;
    }

    try {
      const cookie = getCookie();
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

      markLinkProcessed(originalLink);

      const apiTitle = (result.previews && result.previews.title) || '';
      const productImage = (result.previews && result.previews.image_url) || '';
      const productPrice = priceFromPost || (result.previews && result.previews.price) || '';

      let productTitle = apiTitle;
      if (apiTitle) {
        try {
          productTitle = await refineTitle(apiTitle);
          console.log(`🤖 عنوان محسّن: ${productTitle}`);
        } catch (aiErr) {
          console.log(`⚠️ فشل تحسين العنوان، استخدام العنوان الأصلي: ${aiErr.message}`);
        }
      }

      const t = config.messageTemplate || {};
      let message = '';
      if (t.prefix) message += `${t.prefix} ${productTitle}\n\n`;
      else if (productTitle) message += `${productTitle}\n\n`;
      if (productPrice && t.priceLabel) message += `${t.priceLabel} ${productPrice}\n\n`;
      if (t.linkLabel) message += `${t.linkLabel}\n${affLink}\n\n`;
      else message += `${affLink}\n\n`;
      if (t.footer) message += `${t.footer}\n`;
      if (t.botLink) message += `🔗 ${t.botLink}\n\n`;
      if (t.hashtags) message += t.hashtags;

      const botToken = getBotToken();
      const delayMs = config.publishDelay ? randomDelay(config.delayMin || 1, config.delayMax || 5) : 0;
      const delayMinutes = Math.round(delayMs / 60000);

      if (config.notifyOwner && config.ownerId && botToken) {
        await sendOwnerNotification(botToken, config.ownerId, {
          source: sourceName, title: productTitle, price: productPrice,
          affiliateLink: affLink, delayMinutes
        });
      }

      const publishFn = async () => {
        let publishedCount = 0;
        if (config.autoPublish && botToken) {
          const publishBot = new Telegraf(botToken);
          for (const target of targetIds) {
            try {
              if (productImage) {
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
      };

      if (delayMs > 0) {
        console.log(`⏱ تأخير ${delayMinutes} دقيقة قبل النشر...`);
        addLogEntry({
          source: sourceName, originalLink, affiliateLink: affLink,
          title: productTitle, price: productPrice, image: productImage,
          status: 'pending', targets: targetIds, scheduledDelay: delayMinutes
        });
        setTimeout(publishFn, delayMs);
      } else {
        await publishFn();
      }
    } catch (linkErr) {
      console.log('❌ خطأ في معالجة الرابط:', linkErr.message);
      addLogEntry({ source: sourceName, originalLink, status: 'error', error: linkErr.message });
    }
  }
}

async function startSpy(config) {
  if (spyRunning) {
    await stopSpy();
  }

  const { TelegramClient } = require('telegram');
  const { StringSession } = require('telegram/sessions');
  const { NewMessage } = require('telegram/events');

  const apiId = parseInt(config.apiId);
  const apiHash = config.apiHash;

  if (!apiId || !apiHash) {
    throw new Error('API ID و API Hash مطلوبان - احصل عليهما من my.telegram.org');
  }
  if (!config.targetChannels || config.targetChannels.length === 0) {
    throw new Error('يجب إضافة قناة هدف واحدة على الأقل');
  }
  if (!config.sourceChannels || config.sourceChannels.length === 0) {
    throw new Error('يجب إضافة قناة مصدر واحدة على الأقل');
  }

  const botToken = getBotToken();
  if (!botToken && config.autoPublish) {
    throw new Error('توكن البوت غير موجود - أضفه في إعدادات التطبيق الرئيسية');
  }

  let sessionStr = '';
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      sessionStr = sessionData.session || '';
    }
  } catch (e) {}

  if (!sessionStr) {
    throw new Error('SESSION_REQUIRED');
  }

  const session = new StringSession(sessionStr);
  spyClient = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

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
      await processPost(config, text, null, chatTitle);
    } catch (err) {
      console.log('❌ خطأ Userbot:', err.message);
    }
  }, new NewMessage({}));

  spyRunning = true;
  config.enabled = true;
  saveConfig(config);
  console.log('🕵️ تم تشغيل نظام التجسس');
}

async function stopSpy() {
  if (spyClient) {
    try { await spyClient.disconnect(); } catch (e) {}
    spyClient = null;
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

function getStatus() {
  const config = loadConfig();
  const safeConfig = { ...config };
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
  verifyCode
};
