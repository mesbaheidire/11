const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { portaffFunction, directAffLink } = require('./afflink');
const http = require('http');

const SPY_CONFIG_FILE = path.join(__dirname, 'spy_config.json');
const SPY_LOG_FILE = path.join(__dirname, 'spy_log.json');
const SESSION_FILE = path.join(__dirname, 'spy_session.json');
const PROCESSED_LINKS_FILE = path.join(__dirname, 'spy_processed.json');

const inFlightLinks = new Set();
const processedMessageIds = new Set();
const MAX_PROCESSED_MESSAGES = 500;

function isMessageProcessed(chatId, msgId) {
  const key = `${chatId}:${msgId}`;
  return processedMessageIds.has(key);
}

function markMessageProcessed(chatId, msgId) {
  const key = `${chatId}:${msgId}`;
  processedMessageIds.add(key);
  if (processedMessageIds.size > MAX_PROCESSED_MESSAGES) {
    const first = processedMessageIds.values().next().value;
    processedMessageIds.delete(first);
  }
}

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
  const normalized = normalizeAliLink(link);
  if (inFlightLinks.has(normalized)) return true;
  const processed = loadProcessedLinks();
  return processed.some(entry => entry.link === normalized);
}

function reserveLink(link) {
  const normalized = normalizeAliLink(link);
  inFlightLinks.add(normalized);
}

function markLinkProcessed(link) {
  const normalized = normalizeAliLink(link);
  inFlightLinks.delete(normalized);
  const processed = loadProcessedLinks();
  processed.push({ link: normalized, time: Date.now() });
  saveProcessedLinks(processed);
}

function normalizeAliLink(link) {
  try {
    const url = new URL(link);
    const productMatch = link.match(/\/item\/(\d+)/);
    if (productMatch) return 'product:' + productMatch[1];
    const pidParam = url.searchParams.get('productIds') || url.searchParams.get('productId') || url.searchParams.get('itemId');
    if (pidParam) return 'product:' + pidParam;
    return url.hostname + url.pathname + (url.search || '');
  } catch {
    return link;
  }
}

function randomDelay(minMinutes, maxMinutes) {
  const ms = (minMinutes + Math.random() * (maxMinutes - minMinutes)) * 60 * 1000;
  return Math.round(ms);
}

let dailyPublishCount = 0;
let dailyPublishDate = '';

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getDailyCount() {
  const today = getTodayStr();
  if (dailyPublishDate !== today) {
    dailyPublishDate = today;
    dailyPublishCount = 0;
  }
  return dailyPublishCount;
}

function incrementDailyCount() {
  const today = getTodayStr();
  if (dailyPublishDate !== today) {
    dailyPublishDate = today;
    dailyPublishCount = 0;
  }
  dailyPublishCount++;
  return dailyPublishCount;
}

function isDailyLimitReached(config) {
  if (!config.dailyLimit || config.dailyLimit <= 0) return false;
  return getDailyCount() >= config.dailyLimit;
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
      headerText: '',
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

function extractCouponFromPost(text) {
  if (!text) return null;
  const coupons = new Set();

  const excludeWords = new Set([
    'CODE', 'HTTP', 'HTTPS', 'HTML', 'AMOLED', 'BLUETOOTH', 'GPS',
    'HONOR', 'SAMSUNG', 'XIAOMI', 'REDMI', 'POCO', 'REALME', 'OPPO',
    'VIVO', 'HUAWEI', 'NOKIA', 'IPHONE', 'PIXEL', 'NOTHING', 'GLOBAL',
    'VERSION', 'SPRING', 'SALE', 'TIME', 'STORE', 'FLASH', 'FREE',
    'TYPE', 'USB', 'HDMI', 'WIFI', 'OLED', 'MINI', 'PLUS', 'ULTRA',
    'LITE', 'NOTE', 'BAND', 'WATCH', 'BUDS', 'PODS', 'CASE', 'SUPER',
    'FAST', 'CHARGING', 'CABLE', 'ADAPTER'
  ]);

  function isValidCoupon(code) {
    if (!code || code.length < 4 || code.length > 20) return false;
    if (!/[A-Z]/.test(code)) return false;
    if (/^[a-z]/.test(code)) return false;
    if (excludeWords.has(code.toUpperCase())) return false;
    const upper = code.replace(/[^A-Z0-9]/g, '');
    if (upper !== code) return false;
    return true;
  }

  const patterns = [
    /(?:كوبون|قسيمة|coupon|code|كود|رمز|حصل)[:\s]*(?:البائع\s*)?(?:\$?\d+\s*)?([A-Z][A-Z0-9]{3,19})/gi,
    /(?:استخدم|use|ادخل|enter)[:\s]*([A-Z][A-Z0-9]{3,19})/gi,
    /\b(?:CODE)\s+([A-Z0-9]{4,20})/gi,
  ];

  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(text)) !== null) {
      const raw = (match[2] || match[1]).trim();
      const code = raw.toUpperCase();
      if (isValidCoupon(code)) coupons.add(code);
    }
  }

  const codePattern = /\b([A-Z]{2,8}[0-9]{1,6})\b/g;
  let m;
  while ((m = codePattern.exec(text)) !== null) {
    const code = m[1];
    if (isValidCoupon(code)) coupons.add(code);
  }

  if (coupons.size === 0) return null;
  return Array.from(coupons).join(' | ');
}

function isPhoneProduct(title, text) {
  const combined = ((title || '') + ' ' + (text || '')).toLowerCase();
  const phoneKeywords = [
    'smartphone', 'phone', 'iphone', 'samsung', 'galaxy', 'xiaomi', 'redmi',
    'poco', 'realme', 'oppo', 'vivo', 'oneplus', 'huawei', 'honor', 'nokia',
    'motorola', 'pixel', 'nothing phone', 'zte', 'infinix', 'tecno', 'itel',
    'meizu', 'lenovo', 'asus', 'rog phone', 'sony xperia', 'google pixel',
    'nubia', 'cubot', 'doogee', 'ulefone', 'umidigi', 'oukitel', 'blackview',
    'oscal', 'fossibot', 'hotwav', 'agm', 'unihertz', 'cat phone',
    'tcl', 'alcatel', 'wiko', 'fairphone', 'sharp aquos', 'hisense',
    'coolpad', 'micromax', 'lava', 'karbonn', 'gionee', 'leagoo',
    'vernee', 'elephone', 'bluboo', 'homtom', 'leeco', 'letv',
    'snapdragon', 'dimensity', 'mediatek', 'helio', 'exynos', 'kirin',
    'amoled', 'هاتف', 'موبايل', 'جوال', 'تلفون', 'سمارتفون',
    '5g phone', '4g phone', 'cellphone', 'cell phone', 'mobile phone',
    'dual sim', 'sim card', 'nfc phone'
  ];
  if (phoneKeywords.some(kw => combined.includes(kw))) return true;

  const phonePatterns = [
    /\b\d+mp\s*\+\s*\d+mp/i,
    /\b\d+mp\s+(camera|rear|front|main)/i,
    /\b\d+\s*gb\s*[\/+]\s*\d+\s*(gb|tb)\b/i,
    /\b\d{4,5}\s*mah\b/i,
    /\b[a-z]+\s+\d{1,3}\s*(pro|ultra|plus|max|lite|mini|se|gt|neo|note|prime|star|play|power|turbo|edge|fold|flip|zoom|fe)\b/i,
  ];
  return phonePatterns.some(p => p.test(combined));
}

function detectLinkType(url, text) {
  if (url) {
    const u = url.toLowerCase();
    if (u.includes('coin-index') || u.includes('syicon') || u.includes('sourcetype=555') || u.includes('/p/coin')) return 'coin';
    if (u.includes('sourcetype=620') || u.includes('channel=coin') || u.includes('point')) return 'point';
    if (u.includes('sourcetype=562') || u.includes('super')) return 'super';
    if (u.includes('sourcetype=570') || u.includes('limited') || u.includes('limit')) return 'limit';
    if (u.includes('bundledeals') || u.includes('sourcetype=561') || u.includes('bundle')) return 'ther3';
  }
  if (text) {
    const t = text.toLowerCase();
    if (t.includes('🪙') || t.includes('coin') || t.includes('كوين')) return 'coin';
    if (t.includes('⭐') || t.includes('point') || t.includes('بوينت') || t.includes('نقاط')) return 'point';
    if (t.includes('🔥') || t.includes('super') || t.includes('سوبر')) return 'super';
    if (t.includes('⚡') || t.includes('limited') || t.includes('محدود')) return 'limit';
    if (t.includes('bundle') || t.includes('باندل') || t.includes('حزمة')) return 'ther3';
  }
  return null;
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
    /(\d+[\.,]?\d*)\s*(?:د\.ج|DA|DZD|دج)/i,
    /(\d+[\.,]?\d*)\s*(?:\$|USD|€|EUR)/i,
    /(?:السعر|Price|سعر|الثمن|prix)[:\s]*(\d+[\.,]?\d*)/i,
    /(\d+[\.,]?\d*)\s*(?:ج|جنيه|ريال|درهم)/i,
    /💰[:\s]*(\d+[\.,]?\d*)/,
    /(\d+[\.,]?\d*)\s*\$/,
    /\$\s*(\d+[\.,]?\d*)/,
    /(\d{1,6}[\.,]?\d{0,2})\s*(?:dollar|دولار)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const priceStr = match[2] || match[1];
      if (priceStr && parseFloat(priceStr.replace(',', '.')) > 0.5) {
        return priceStr;
      }
    }
  }
  return null;
}

const SHARED_CREDS_FILE = path.join(__dirname, 'app_credentials.json');

function loadSharedCredentials() {
  try {
    if (fs.existsSync(SHARED_CREDS_FILE)) {
      return JSON.parse(fs.readFileSync(SHARED_CREDS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function getBotToken() {
  const shared = loadSharedCredentials();
  const config = loadConfig();
  return shared.botToken || config.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
}

function getCookie() {
  const shared = loadSharedCredentials();
  const config = loadConfig();
  const cookie = shared.cook || config.cook || process.env.cook || '';
  if (!cookie) {
    console.log('⚠️ الكوكي غير موجود — تأكد من إدخاله في صفحة الإعدادات الرئيسية');
  }
  return cookie;
}

let spyClient = null;
let spyRunning = false;
let authState = { step: 'idle', phoneCodeHash: null };
let reviewBot = null;
const pendingReviews = new Map();

function startReviewBot(botToken) {
  if (reviewBot) return;
  try {
    reviewBot = new Telegraf(botToken);

    reviewBot.action(/^spy_approve_(.+)$/, async (ctx) => {
      const config = loadConfig();
      if (config.ownerId && String(ctx.from.id) !== String(config.ownerId)) {
        await ctx.answerCbQuery('غير مصرح لك');
        return;
      }
      const reviewId = ctx.match[1];
      const review = pendingReviews.get(reviewId);
      if (!review) {
        await ctx.answerCbQuery('انتهت صلاحية هذا المنتج');
        await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '⏰ منتهي الصلاحية', callback_data: 'noop' }]] });
        return;
      }
      pendingReviews.delete(reviewId);
      await ctx.answerCbQuery('جاري النشر...');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ تمت الموافقة', callback_data: 'noop' }]] });

      try {
        await executePublish(review);
        console.log(`✅ تمت الموافقة والنشر: ${reviewId}`);
      } catch (e) {
        console.log(`❌ فشل النشر بعد الموافقة: ${e.message}`);
      }
    });

    reviewBot.action(/^spy_skip_(.+)$/, async (ctx) => {
      const config = loadConfig();
      if (config.ownerId && String(ctx.from.id) !== String(config.ownerId)) {
        await ctx.answerCbQuery('غير مصرح لك');
        return;
      }
      const reviewId = ctx.match[1];
      pendingReviews.delete(reviewId);
      await ctx.answerCbQuery('تم التخطي');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '⏭ تم التخطي', callback_data: 'noop' }]] });
      addLogEntry({ status: 'skipped', title: 'تم التخطي يدوياً', reviewId });
      console.log(`⏭ تم تخطي المنتج: ${reviewId}`);
    });

    reviewBot.action('spy_approve_all', async (ctx) => {
      const config = loadConfig();
      if (config.ownerId && String(ctx.from.id) !== String(config.ownerId)) {
        await ctx.answerCbQuery('غير مصرح لك');
        return;
      }
      const count = pendingReviews.size;
      if (count === 0) {
        await ctx.answerCbQuery('لا توجد منشورات معلقة');
        return;
      }
      await ctx.answerCbQuery(`جاري نشر ${count} منشور...`);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: `✅ تم نشر الكل (${count})`, callback_data: 'noop' }]] });
      const allReviews = Array.from(pendingReviews.entries());
      pendingReviews.clear();
      for (const [rid, review] of allReviews) {
        try {
          await executePublish(review);
          console.log(`✅ نشر (الكل): ${rid}`);
        } catch (e) {
          console.log(`❌ فشل نشر (الكل) ${rid}: ${e.message}`);
        }
      }
    });

    reviewBot.action('spy_skip_all', async (ctx) => {
      const config = loadConfig();
      if (config.ownerId && String(ctx.from.id) !== String(config.ownerId)) {
        await ctx.answerCbQuery('غير مصرح لك');
        return;
      }
      const count = pendingReviews.size;
      if (count === 0) {
        await ctx.answerCbQuery('لا توجد منشورات معلقة');
        return;
      }
      await ctx.answerCbQuery(`تم تخطي ${count} منشور`);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: `⏭ تم تخطي الكل (${count})`, callback_data: 'noop' }]] });
      for (const [rid, review] of pendingReviews.entries()) {
        addLogEntry({ status: 'skipped', title: review.productTitle || 'تم التخطي', source: review.sourceName });
      }
      pendingReviews.clear();
      console.log(`⏭ تم تخطي الكل (${count})`);
    });

    reviewBot.action('noop', (ctx) => ctx.answerCbQuery());

    reviewBot.launch({ dropPendingUpdates: true });
    console.log('🤖 بوت المراجعة يعمل');
  } catch (e) {
    console.log('⚠️ فشل تشغيل بوت المراجعة:', e.message);
    reviewBot = null;
  }
}

function stopReviewBot() {
  if (reviewBot) {
    try { reviewBot.stop(); } catch (e) {}
    reviewBot = null;
    pendingReviews.clear();
    console.log('🤖 تم إيقاف بوت المراجعة');
  }
}

async function executePublish(review) {
  const { message, productImage, targetIds, sourceName, originalLink, affiliateLink, productTitle, productPrice, imageUrlForLog } = review;
  const botToken = getBotToken();
  if (!botToken) return;

  const logImage = imageUrlForLog || (typeof productImage === 'string' ? productImage : null);

  const config = loadConfig();
  if (isDailyLimitReached(config)) {
    console.log(`🚫 تم بلوغ الحد اليومي عند النشر (${config.dailyLimit}) — إلغاء`);
    addLogEntry({
      source: sourceName, originalLink, affiliateLink,
      title: productTitle, price: productPrice, image: logImage,
      status: 'daily_limit', targets: targetIds
    });
    return;
  }

  const publishBot = new Telegraf(botToken);
  let publishedCount = 0;

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
      addLogEntry({ source: sourceName, target, originalLink, affiliateLink, status: 'publish_failed', error: pubErr.message });
    }
  }

  let finalStatus = publishedCount > 0 ? 'published' : 'publish_failed';
  if (publishedCount > 0) {
    incrementDailyCount();
    console.log(`📊 النشر اليومي: ${getDailyCount()}`);
  }
  addLogEntry({
    source: sourceName, originalLink, affiliateLink,
    title: productTitle, price: productPrice, image: logImage,
    status: finalStatus, targets: targetIds
  });
}

async function sendForReview(botToken, ownerId, review) {
  const reviewId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  pendingReviews.set(reviewId, review);

  const pendingCount = pendingReviews.size;
  const bot = new Telegraf(botToken);
  let msg = `📋 *منتج جديد للمراجعة* (${pendingCount} في الانتظار)\n\n`;
  msg += `📡 المصدر: ${review.sourceName || 'غير معروف'}\n`;
  if (review.productTitle) msg += `📦 ${review.productTitle}\n`;
  if (review.productPrice) msg += `💰 السعر: ${review.productPrice}\n`;
  if (review.affiliateLink) msg += `🔗 ${review.affiliateLink}\n`;
  msg += `\n📢 القنوات الهدف: ${(review.targetIds || []).join(', ')}`;

  const buttons = [
    { text: '✅ نشر', callback_data: `spy_approve_${reviewId}` },
    { text: '⏭ تخطي', callback_data: `spy_skip_${reviewId}` }
  ];
  const rows = [buttons];
  if (pendingCount > 1) {
    rows.push([
      { text: `📢 نشر الكل (${pendingCount})`, callback_data: 'spy_approve_all' },
      { text: `🗑 تخطي الكل`, callback_data: 'spy_skip_all' }
    ]);
  }
  const keyboard = { inline_keyboard: rows };

  try {
    if (review.productImage) {
      await bot.telegram.sendPhoto(ownerId, review.productImage, { caption: msg, reply_markup: keyboard });
    } else {
      await bot.telegram.sendMessage(ownerId, msg, { reply_markup: keyboard });
    }
  } catch (e) {
    console.log('⚠️ فشل إرسال طلب المراجعة:', e.message);
    pendingReviews.delete(reviewId);
  }
}

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

async function extractCouponWithAI(text) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ text });
    const options = {
      hostname: '127.0.0.1',
      port: parseInt(process.env.PORT) || 5000,
      path: '/api/ai-extract-coupon',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.success && parsed.coupon ? parsed.coupon : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

function cleanTitle(t) {
  if (!t) return t;
  return t
    .replace(/`{1,3}[\w]*\s*/g, '')
    .replace(/`/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('{') && !l.startsWith('}') && !/^(json|```)$/i.test(l))
    .join(' ')
    .replace(/^(json|result|العنوان|النتيجة)[\s:]+/i, '')
    .replace(/[*#"'{}[\]`]/g, '')
    .trim();
}

function callAiRefine(title, isHook) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ title, isHook });
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
          const result = parsed.success ? parsed.refinedTitle : null;
          console.log(`📨 AI refine response: method=${parsed.method}, result="${(result || '').substring(0, 80)}"`);
          resolve(result || (isHook ? '' : title));
        } catch (e) {
          console.log(`⚠️ AI refine parse error: ${e.message}`);
          resolve(isHook ? '' : title);
        }
      });
    });
    req.on('error', (e) => {
      console.log(`⚠️ AI refine request error: ${e.message}`);
      resolve(isHook ? '' : title);
    });
    req.setTimeout(15000, () => {
      console.log(`⚠️ AI refine timeout (15s)`);
      req.destroy();
      resolve(isHook ? '' : title);
    });
    req.write(postData);
    req.end();
  });
}

function shortenTitleFallback(title) {
  if (!title || title.length <= 60) return title;
  const junk = /\b(for|with|and|the|a|an|in|on|at|to|of|by|from|Global Version|Free Shipping|Original|New Arrival|Hot Sale|2024|2025|2026|High Quality)\b/gi;
  let short = title.replace(junk, ' ').replace(/\s{2,}/g, ' ').trim();
  const words = short.split(/\s+/);
  if (words.length > 8) short = words.slice(0, 8).join(' ');
  return short;
}

async function extractPhoneNameWithAI(text) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ text });
    const options = {
      hostname: '127.0.0.1',
      port: parseInt(process.env.PORT) || 5000,
      path: '/api/ai-extract-phone-name',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.success && parsed.phoneName ? parsed.phoneName : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

async function extractProductInfoWithAI(text, apiTitle) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ text, apiTitle });
    const options = {
      hostname: '127.0.0.1',
      port: parseInt(process.env.PORT) || 5000,
      path: '/api/ai-extract-product-info',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.success && parsed.productInfo ? parsed.productInfo : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(12000, () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

async function refineTitle(title) {
  return callAiRefine(title, false);
}

async function extractSellerCouponWithAI(text) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ text });
    const options = {
      hostname: '127.0.0.1',
      port: parseInt(process.env.PORT) || 5000,
      path: '/api/ai-extract-seller-coupon',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.success && parsed.sellerCoupon ? parsed.sellerCoupon : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(12000, () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

async function generateHook(title) {
  return callAiRefine(title, true);
}

async function processPost(config, text, sourceImage, sourceName) {
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

    reserveLink(originalLink);

    try {
      const cookie = getCookie();
      if (!cookie) {
        addLogEntry({ source: sourceName, originalLink, status: 'cookie_expired', error: 'الكوكي غير موجود — أدخله في الإعدادات الرئيسية' });
        inFlightLinks.delete(normalizeAliLink(originalLink));
        continue;
      }
      let affLink, apiTitle, productImage, productPrice, resolvedProductId = null;

      if (config.useTypedLinks) {
        const result = await portaffFunction(cookie, originalLink);
        if (!result || !result.aff) {
          addLogEntry({ source: sourceName, originalLink, status: 'failed', error: 'فشل تحويل الرابط' });
          inFlightLinks.delete(normalizeAliLink(originalLink));
          continue;
        }
        const linkType = config.linkType || 'coin';
        affLink = result.aff[linkType] ||
                  result.aff.coin || result.aff.super || result.aff.point ||
                  Object.values(result.aff).find(v => v);
        if (!affLink) {
          addLogEntry({ source: sourceName, originalLink, status: 'failed', error: 'لا يوجد رابط أفلييت متاح' });
          inFlightLinks.delete(normalizeAliLink(originalLink));
          continue;
        }
        console.log(`🔗 تحويل بالنوع (${linkType}): ${affLink.substring(0, 60)}...`);
        resolvedProductId = result.productId || null;
        apiTitle = (result.previews && result.previews.title) || '';
        productImage = (result.previews && result.previews.image_url) || '';
        productPrice = priceFromPost || (result.previews && result.previews.price) || '';
      } else {
        const directResult = await directAffLink(cookie, originalLink);
        if (!directResult || !directResult.affLink) {
          addLogEntry({ source: sourceName, originalLink, status: 'failed', error: 'فشل تحويل الرابط' });
          inFlightLinks.delete(normalizeAliLink(originalLink));
          continue;
        }
        affLink = directResult.affLink;
        resolvedProductId = directResult.productId || null;
        console.log(`🔗 تحويل مباشر: ${affLink.substring(0, 60)}...`);
        apiTitle = (directResult.previews && directResult.previews.title) || '';
        productImage = (directResult.previews && directResult.previews.image_url) || '';
        productPrice = priceFromPost || (directResult.previews && directResult.previews.price) || '';
      }

      markLinkProcessed(originalLink);

      if (resolvedProductId) {
        const productKey = 'product:' + resolvedProductId;
        const processed = loadProcessedLinks();
        if (processed.some(entry => entry.link === productKey)) {
          console.log(`🔁 تخطي منتج مكرر (ID: ${resolvedProductId})`);
          continue;
        }
        processed.push({ link: productKey, time: Date.now() });
        saveProcessedLinks(processed);
      }

      if (!productImage && sourceImage) {
        productImage = { source: sourceImage };
        console.log(`🖼 جميع طرق API فشلت — استخدام صورة المنشور الأصلي كاحتياط أخير`);
      }

      const imageUrlForLog = typeof productImage === 'string' ? productImage : null;

      let productTitle = apiTitle;
      if (!productTitle) {
        const postLines = (text || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('http') && !l.startsWith('👇') && !l.includes('aliexpress.com') && !l.includes('s.click'));
        if (postLines.length > 0) {
          productTitle = postLines[0];
          console.log(`📝 جميع طرق API فشلت — استخدام عنوان المنشور كاحتياط أخير: ${productTitle}`);
        }
      }

      try {
        const aiInfo = await extractProductInfoWithAI(text, apiTitle);
        if (aiInfo && aiInfo.productName) {
          productTitle = aiInfo.productName;
          console.log(`🤖 AI استخرج المنتج: "${productTitle}" (هاتف: ${aiInfo.isPhone ? 'نعم' : 'لا'})`);
        } else {
          console.log(`⚠️ AI لم يتعرف على المنتج — محاولة تحسين عنوان API`);
          if (apiTitle) {
            try {
              const refined = await refineTitle(apiTitle);
              productTitle = refined || apiTitle;
              console.log(`🤖 عنوان محسّن: ${productTitle}`);
            } catch (aiErr) {
              console.log(`⚠️ فشل تحسين العنوان: ${aiErr.message}`);
            }
          }
        }
      } catch (e) {
        console.log(`⚠️ فشل استخراج معلومات المنتج: ${e.message}`);
        if (apiTitle) {
          try {
            const refined = await refineTitle(apiTitle);
            productTitle = refined || apiTitle;
          } catch (aiErr) {}
        }
      }

      if (productTitle && productTitle.length > 60) {
        console.log(`✂️ العنوان طويل (${productTitle.length} حرف) — تقصير يدوي`);
        productTitle = shortenTitleFallback(productTitle);
        console.log(`✂️ بعد التقصير: ${productTitle}`);
      }

      const t = config.messageTemplate || {};

      let extractedCoupon = null;
      try {
        extractedCoupon = await extractCouponWithAI(text);
        if (extractedCoupon) {
          console.log(`🤖 كوبون مستخرج بالذكاء الاصطناعي: ${extractedCoupon}`);
        }
      } catch (e) {
        console.log('⚠️ فشل استخراج الكوبون بالذكاء الاصطناعي:', e.message);
      }
      if (!extractedCoupon) {
        extractedCoupon = extractCouponFromPost(text);
        if (extractedCoupon) {
          console.log(`📋 كوبون مستخرج بالأنماط: ${extractedCoupon}`);
        } else {
          console.log(`⚠️ لم يتم العثور على كوبون في النص`);
        }
      }

      const couponPrefixes = (t.couponFilter || '').split(',').map(p => p.trim().toUpperCase()).filter(p => p);
      if (couponPrefixes.length > 0 && extractedCoupon) {
        const filtered = extractedCoupon.split(' | ')
          .map(c => c.trim())
          .filter(c => couponPrefixes.some(prefix => c.toUpperCase().startsWith(prefix)));
        if (filtered.length > 0) {
          extractedCoupon = filtered.join(' | ');
          console.log(`🔍 كوبونات بعد الفلترة: ${extractedCoupon}`);
        } else {
          console.log(`🚫 كل الكوبونات المستخرجة لا تطابق الفلتر — تم تجاهلها`);
          extractedCoupon = null;
        }
      }

      const fixedCoupons = (t.fixedCoupons || '').split(',').map(c => c.trim().toUpperCase()).filter(c => c);
      if (fixedCoupons.length > 0) {
        const existingCoupons = extractedCoupon ? extractedCoupon.split(' | ').map(c => c.trim().toUpperCase()) : [];
        const newCoupons = fixedCoupons.filter(fc => !existingCoupons.includes(fc));
        if (newCoupons.length > 0) {
          extractedCoupon = extractedCoupon
            ? extractedCoupon + ' | ' + newCoupons.join(' | ')
            : newCoupons.join(' | ');
          console.log(`📌 كوبونات ثابتة مضافة: ${newCoupons.join(', ')}`);
        }
      }

      productTitle = cleanTitle(productTitle);

      let message = '';
      if (t.headerText && t.headerText.trim()) message += `${t.headerText.trim()}\n\n`;
      if (t.prefix) message += `${t.prefix} ${productTitle}\n\n`;
      else if (productTitle) message += `${productTitle}\n\n`;
      if (productPrice && t.priceLabel) message += `${t.priceLabel} ${productPrice}\n`;
      if (extractedCoupon) {
        const label = t.couponLabel || 'كوبون';
        message += `${label}: ${extractedCoupon}\n`;
      }

      let sellerCouponText = t.sellerCoupon || '';
      if (!sellerCouponText.trim()) {
        try {
          const aiCoupon = await extractSellerCouponWithAI(text);
          if (aiCoupon) {
            console.log(`🤖🎁 قسيمة البائع المستخرجة بالذكاء الاصطناعي: ${aiCoupon}`);
            sellerCouponText = aiCoupon;
          }
        } catch (e) {
          console.log(`⚠️ فشل استخراج قسيمة البائع: ${e.message}`);
        }
      }
      if (sellerCouponText && sellerCouponText.trim()) {
        message += `\n🎁 إحجز قسيمة البائع: ${sellerCouponText.trim()}`;
        if (t.sellerCouponCode && t.sellerCouponCode.trim()) {
          message += `\nكود: ${t.sellerCouponCode.trim()}`;
        }
        message += '\n';
      }
      message += '\n';
      if (t.linkLabel) message += `${t.linkLabel}\n${affLink}\n\n`;
      else message += `${affLink}\n\n`;
      if (t.footer) message += `${t.footer}\n`;
      if (t.botLink) message += `🔗 ${t.botLink}\n\n`;
      if (t.hashtags) message += t.hashtags;

      const botToken = getBotToken();

      if (isDailyLimitReached(config)) {
        console.log(`🚫 تم بلوغ الحد اليومي (${config.dailyLimit}) — تخطي النشر`);
        addLogEntry({
          source: sourceName, originalLink, affiliateLink: affLink,
          title: productTitle, price: productPrice, image: imageUrlForLog,
          status: 'daily_limit', targets: targetIds
        });
        continue;
      }

      const reviewData = {
        message, productImage, targetIds, sourceName, originalLink,
        affiliateLink: affLink, productTitle, productPrice, imageUrlForLog
      };

      if (config.manualReview && config.ownerId && botToken) {
        console.log(`📋 إرسال للمراجعة اليدوية...`);
        addLogEntry({
          source: sourceName, originalLink, affiliateLink: affLink,
          title: productTitle, price: productPrice, image: imageUrlForLog,
          status: 'review', targets: targetIds
        });
        await sendForReview(botToken, config.ownerId, reviewData);
      } else if (config.autoPublish) {
        const delayMs = config.publishDelay ? randomDelay(config.delayMin || 1, config.delayMax || 5) : 0;
        const delayMinutes = Math.round(delayMs / 60000);

        if (config.notifyOwner && config.ownerId && botToken) {
          await sendOwnerNotification(botToken, config.ownerId, {
            source: sourceName, title: productTitle, price: productPrice,
            affiliateLink: affLink, delayMinutes
          });
        }

        const publishFn = async () => {
          await executePublish(reviewData);
        };

        if (delayMs > 0) {
          console.log(`⏱ تأخير ${delayMinutes} دقيقة قبل النشر...`);
          addLogEntry({
            source: sourceName, originalLink, affiliateLink: affLink,
            title: productTitle, price: productPrice, image: imageUrlForLog,
            status: 'pending', targets: targetIds, scheduledDelay: delayMinutes
          });
          setTimeout(publishFn, delayMs);
        } else {
          await publishFn();
        }
      } else {
        addLogEntry({
          source: sourceName, originalLink, affiliateLink: affLink,
          title: productTitle, price: productPrice, image: imageUrlForLog,
          status: 'detected', targets: targetIds
        });
      }
    } catch (linkErr) {
      inFlightLinks.delete(normalizeAliLink(originalLink));
      const isCookieError = linkErr.message && (linkErr.message.includes('الكوكي منتهي') || linkErr.message.includes('login') || linkErr.message.includes('DOCTYPE'));
      const errorStatus = isCookieError ? 'cookie_expired' : 'error';
      const errorMsg = isCookieError ? '⚠️ الكوكي منتهي الصلاحية — جدّد الكوكي' : linkErr.message;
      console.log(`❌ خطأ في معالجة الرابط: ${errorMsg}`);
      addLogEntry({ source: sourceName, originalLink, status: errorStatus, error: errorMsg });
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
  if (!botToken && (config.autoPublish || config.manualReview)) {
    throw new Error('توكن البوت غير موجود - أضفه في إعدادات التطبيق الرئيسية');
  }
  if (config.manualReview && !config.ownerId) {
    throw new Error('وضع المراجعة اليدوية يتطلب إدخال معرف حسابك (Chat ID)');
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

  try {
    const me = await spyClient.getMe();
    console.log(`🕵️ تم الاتصال بحساب: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || 'بدون'})`);
  } catch (e) {
    console.log('🕵️ تم الاتصال بحساب تيليجرام');
  }

  console.log('🔄 جاري مزامنة المحادثات...');
  try {
    const dialogs = await spyClient.getDialogs({ limit: 100 });
    console.log(`📋 تمت مزامنة ${dialogs.length} محادثة`);
  } catch (e) {
    console.log(`⚠️ فشل مزامنة المحادثات: ${e.message}`);
  }

  const sourceUsernames = config.sourceChannels.map(ch => {
    if (ch.startsWith('@')) return ch.substring(1);
    if (ch.includes('t.me/')) {
      const match = ch.match(/t\.me\/([^\/\?]+)/);
      if (match) return match[1];
    }
    return ch;
  });

  const targetUsernames = new Set();
  const targetIdSet = new Set();
  for (const ch of (config.targetChannels || [])) {
    if (ch.startsWith('-')) {
      targetIdSet.add(ch);
      targetIdSet.add(ch.replace(/^-100/, ''));
    } else if (ch.startsWith('@')) {
      targetUsernames.add(ch.substring(1).toLowerCase());
    } else if (ch.includes('t.me/')) {
      const match = ch.match(/t\.me\/([^\/\?]+)/);
      if (match) targetUsernames.add(match[1].toLowerCase());
    } else {
      targetUsernames.add(ch.toLowerCase());
    }
  }

  for (const tgt of targetUsernames) {
    try {
      const entity = await spyClient.getEntity(tgt);
      const entityId = String(entity.id?.value ?? entity.id);
      targetIdSet.add(entityId);
    } catch (e) {}
  }

  let botId = null;
  const spyBotToken = getBotToken();
  if (spyBotToken) {
    const tokenMatch = spyBotToken.match(/^(\d+):/);
    if (tokenMatch) botId = tokenMatch[1];
  }

  let meId = null;
  try {
    const me = await spyClient.getMe();
    meId = String(me.id?.value ?? me.id);
  } catch (e) {}

  const resolvedSourceIds = new Set();
  for (const src of sourceUsernames) {
    try {
      const entity = await spyClient.getEntity(src);
      const entityId = String(entity.id?.value ?? entity.id);
      resolvedSourceIds.add(entityId);
      console.log(`✅ تم حل القناة: ${src} → ${entity.title || src} (ID: ${entityId})`);
    } catch (e) {
      console.log(`❌ فشل حل القناة "${src}": ${e.message}`);
    }
  }

  if (resolvedSourceIds.size === 0) {
    console.log('⚠️ لم يتم حل أي قناة مصدر — تأكد أن الحساب مشترك في القنوات');
  }

  console.log(`🛡 حماية التكرار: ${targetIdSet.size} قنوات هدف محظورة، botId=${botId || 'غير معروف'}`);

  let msgCount = 0;

  spyClient.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg || !msg.peerId) return;

      msgCount++;
      if (msgCount <= 10 || msgCount % 50 === 0) {
        console.log(`📨 رسالة #${msgCount} — out:${msg.out} peerId: ${JSON.stringify(msg.peerId.className || msg.peerId.constructor?.name || 'unknown')}`);
      }

      let chatEntity;
      try {
        chatEntity = await spyClient.getEntity(msg.peerId);
      } catch (e) {
        if (msgCount <= 10) console.log(`⚠️ فشل حل الكيان: ${e.message}`);
        return;
      }

      const chatUsername = (chatEntity.username || '').toLowerCase();
      const chatTitle = chatEntity.title || chatEntity.username || '';
      const chatId = String(chatEntity.id?.value ?? chatEntity.id);

      if (msgCount <= 10) {
        console.log(`📍 رسالة من: ${chatTitle} | username: ${chatUsername} | id: ${chatId}`);
      }

      if (targetIdSet.has(chatId) || targetUsernames.has(chatUsername)) {
        if (msgCount <= 20) console.log(`🚫 تخطي رسالة من قناة الهدف: ${chatTitle}`);
        return;
      }

      const isSource = resolvedSourceIds.has(chatId) ||
        sourceUsernames.some(src => {
          const srcLower = src.toLowerCase();
          return chatUsername === srcLower ||
                 chatId === src ||
                 ('-100' + chatId) === src;
        });

      if (!isSource) return;

      const msgId = msg.id;
      if (isMessageProcessed(chatId, msgId)) {
        console.log(`🔁 تخطي رسالة مكررة: ${chatTitle} #${msgId}`);
        return;
      }
      markMessageProcessed(chatId, msgId);

      console.log(`✅ رسالة مطابقة من قناة مصدر: ${chatTitle}`);

      const text = msg.message || '';
      if (!text) {
        console.log('⚠️ رسالة فارغة (ربما صورة/فيديو بدون نص)');
        return;
      }

      const aliLinks = extractAliExpressLinks(text);
      if (aliLinks.length === 0) {
        console.log(`ℹ️ لا توجد روابط AliExpress في الرسالة`);
        return;
      }

      let sourceImage = null;
      if (msg.media && msg.media.photo) {
        try {
          const buffer = await spyClient.downloadMedia(msg.media, {});
          if (buffer && buffer.length > 0) {
            sourceImage = buffer;
            console.log(`🖼 صورة مستخرجة من المنشور (${Math.round(buffer.length/1024)}KB)`);
          }
        } catch (imgErr) {
          console.log(`⚠️ فشل تحميل صورة المنشور: ${imgErr.message}`);
        }
      }

      console.log(`🔗 وجد ${aliLinks.length} رابط AliExpress — بدء المعالجة`);
      await processPost(config, text, sourceImage, chatTitle);
    } catch (err) {
      console.log('❌ خطأ Userbot:', err.message);
    }
  }, new NewMessage({}));

  console.log(`🔍 مراقبة القنوات: ${sourceUsernames.join(', ')}`);

  spyRunning = true;
  config.enabled = true;
  saveConfig(config);

  if (config.manualReview && botToken) {
    startReviewBot(botToken);
  }

  console.log('🕵️ تم تشغيل نظام التجسس');
}

async function stopSpy() {
  stopReviewBot();
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
  safeConfig.cook = safeConfig.cook ? true : false;
  safeConfig.botToken = safeConfig.botToken ? true : false;

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
