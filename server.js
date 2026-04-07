const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { portaffFunction } = require('./afflink');
const { searchHotProducts, searchProducts } = require('./aliexpress-api');
const { Telegraf } = require('telegraf');
const { PostScheduler } = require('./scheduler');
const sharp = require('sharp');
const https = require('https');
const http = require('http');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const { loadConfig: loadSpyConfig, saveConfig: saveSpyConfig, invalidateConfigCache: invalidateSpyCache, startSpy, stopSpy, getStatus: getSpyStatus, loadLog: loadSpyLog, sendLoginCode, verifyCode, executePublish } = require('./spy');

const SHARED_CREDS_FILE = path.join(__dirname, 'app_credentials.json');

// Cache for spy config to avoid blocking operations
let spyConfigCache = null;
let spyConfigCacheTime = 0;
const CONFIG_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function loadSpyConfigCached() {
  const now = Date.now();
  if (spyConfigCache && (now - spyConfigCacheTime) < CONFIG_CACHE_DURATION) {
    return spyConfigCache;
  }
  try {
    spyConfigCache = await loadSpyConfig();
    spyConfigCacheTime = now;
  } catch (e) {
    console.log('⚠️ Failed to load spy config:', e.message);
    spyConfigCache = spyConfigCache || {};
  }
  return spyConfigCache;
}

async function loadSharedCredentials() {
  let credentials = {};
  
  // Try database first
  try {
    const botTokenDb = await db.getAppStorage('TELEGRAM_BOT_TOKEN');
    const cookieDb = await db.getAppStorage('ALIEXPRESS_COOKIE');
    if (botTokenDb) credentials.botToken = botTokenDb;
    if (cookieDb) credentials.cook = cookieDb;
    if (Object.keys(credentials).length > 0) {
      console.log('✅ تم تحميل بيانات حساسة من قاعدة البيانات');
      return credentials;
    }
  } catch (e) {
    console.log('⚠️ فشل تحميل البيانات من DB:', e.message);
  }
  
  // Try environment variables
  if (process.env.TELEGRAM_BOT_TOKEN) credentials.botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.cook) credentials.cook = process.env.cook;
  if (Object.keys(credentials).length > 0) {
    console.log('✅ تم تحميل بيانات حساسة من متغيرات البيئة');
    return credentials;
  }
  
  // Try local file as last resort
  try {
    if (fs.existsSync(SHARED_CREDS_FILE)) {
      credentials = JSON.parse(fs.readFileSync(SHARED_CREDS_FILE, 'utf8'));
      console.log('✅ تم تحميل بيانات حساسة من الملف المحلي');
      return credentials;
    }
  } catch (e) {}
  
  console.log('⚠️ لم يتم العثور على بيانات حساسة - يجب إدخالها في الإعدادات');
  return {};
}

async function saveSharedCredentials(creds) {
  // Save to database
  try {
    if (creds.botToken) await db.setAppStorage('TELEGRAM_BOT_TOKEN', creds.botToken);
    if (creds.cook) await db.setAppStorage('ALIEXPRESS_COOKIE', creds.cook);
    console.log('✅ تم حفظ البيانات الحساسة في قاعدة البيانات');
  } catch (e) {
    console.log('⚠️ فشل حفظ البيانات في DB:', e.message);
  }
  
  // Also save to file as backup
  try {
    fs.writeFileSync(SHARED_CREDS_FILE, JSON.stringify(creds, null, 2));
    console.log('✅ تم حفظ نسخة احتياطية في الملف');
  } catch (e) {
    console.log('⚠️ فشل حفظ الملف:', e.message);
  }
}

async function getSharedCookie() {
  const shared = await loadSharedCredentials();
  if (shared.cook) return shared.cook;
  const spyCfg = spyConfigCache || {};
  return spyCfg.cook || process.env.cook || '';
}

async function getSharedBotToken() {
  const shared = await loadSharedCredentials();
  if (shared.botToken) return shared.botToken;
  const spyCfg = spyConfigCache || {};
  return spyCfg.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
}

const app = express();
const postScheduler = new PostScheduler();
postScheduler.start();

// Gemini API Key Management System
const GEMINI_KEYS_FILE = path.join(__dirname, 'gemini_keys.json');

// Load saved keys from file
function loadGeminiKeys() {
  try {
    if (fs.existsSync(GEMINI_KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(GEMINI_KEYS_FILE, 'utf8'));
      return data;
    }
  } catch (e) {
    console.log('Error loading Gemini keys:', e.message);
  }
  return { keys: [], currentIndex: 0 };
}

// Save keys to file
function saveGeminiKeysToFile(data) {
  try {
    fs.writeFileSync(GEMINI_KEYS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.log('Error saving Gemini keys:', e.message);
    return false;
  }
}

// Parse environment variable keys (comma-separated)
function getEnvKeys() {
  const envKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY || '';
  if (envKey.includes(',')) {
    return envKey.split(',').map(k => k.trim()).filter(k => k.length > 10);
  }
  return envKey ? [envKey] : [];
}

// Get current active API key
function getCurrentGeminiKey() {
  const data = loadGeminiKeys();
  const envKeys = getEnvKeys();
  
  // Priority: saved keys > env keys
  if (data.keys.length > 0) {
    const index = data.currentIndex % data.keys.length;
    return data.keys[index];
  }
  
  // Support multiple keys from environment variable
  if (envKeys.length > 0) {
    const envIndex = data.envKeyIndex || 0;
    return envKeys[envIndex % envKeys.length];
  }
  
  return null;
}

// Rotate to next key
function rotateGeminiKey() {
  const data = loadGeminiKeys();
  const envKeys = getEnvKeys();
  
  // Rotate saved keys first
  if (data.keys.length > 1) {
    data.currentIndex = (data.currentIndex + 1) % data.keys.length;
    saveGeminiKeysToFile(data);
    console.log(`🔄 Rotated to Gemini key ${data.currentIndex + 1}/${data.keys.length}`);
    return true;
  }
  
  // Rotate env keys if multiple
  if (envKeys.length > 1) {
    data.envKeyIndex = ((data.envKeyIndex || 0) + 1) % envKeys.length;
    saveGeminiKeysToFile(data);
    console.log(`🔄 Rotated to ENV Gemini key ${data.envKeyIndex + 1}/${envKeys.length}`);
    return true;
  }
  
  return false;
}

// Get a Gemini model instance with current key
function getGeminiModel() {
  const apiKey = getCurrentGeminiKey();
  if (!apiKey) return null;
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
  } catch (e) {
    console.log('Error creating Gemini model:', e.message);
    return null;
  }
}

// Initial setup - keep for backward compatibility
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" }) : null;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Force no-cache
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Root route to ensure index.html is served
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ping endpoint for keep-alive
app.get('/ping', (req, res) => {
  const host = req.get('host');
  console.log(`📡 Ping received on ${host} at ${new Date().toLocaleString()}`);
  res.send('pong');
});

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/api/upload-frame', upload.single('frame'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
  const targetPath = path.join(__dirname, 'public', 'custom_frame.jpg');
  fs.rename(req.file.path, targetPath, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
  const targetPath = path.join(__dirname, 'public', 'watermark_logo.png');
  fs.rename(req.file.path, targetPath, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

// Gemini Keys Management API
app.post('/api/gemini-keys', (req, res) => {
  try {
    const { keys } = req.body;
    if (!keys) return res.status(400).json({ success: false, error: 'Keys required' });
    
    const keyArray = keys.split(',').map(k => k.trim()).filter(k => k.length > 10);
    if (keyArray.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid keys found' });
    }
    
    const data = { keys: keyArray, currentIndex: 0 };
    if (saveGeminiKeysToFile(data)) {
      console.log(`✅ Saved ${keyArray.length} Gemini API keys`);
      res.json({ success: true, count: keyArray.length });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save keys' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/gemini-status', async (req, res) => {
  try {
    const data = loadGeminiKeys();
    const envKeys = getEnvKeys();
    const allKeys = [...data.keys, ...envKeys];
    const totalKeys = allKeys.length;

    let workingCount = 0;
    const keyResults = [];
    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];
      const masked = key.substring(0, 8) + '...' + key.substring(key.length - 4);
      const source = i < data.keys.length ? 'saved' : 'env';
      try {
        const testAI = new GoogleGenerativeAI(key);
        const testModel = testAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        await testModel.generateContent('test');
        keyResults.push({ key: masked, source, status: 'working' });
        workingCount++;
      } catch (e) {
        const err = e.message || '';
        let status = 'error';
        if (err.includes('quota') || err.includes('429') || err.includes('RESOURCE_EXHAUSTED')) status = 'quota_exceeded';
        else if (err.includes('API_KEY_INVALID') || err.includes('not valid')) status = 'invalid';
        else if (err.includes('403') || err.includes('Forbidden') || err.includes('leaked')) status = 'forbidden';
        keyResults.push({ key: masked, source, status, error: err.substring(0, 80) });
      }
    }

    res.json({
      success: true,
      count: data.keys.length,
      envCount: envKeys.length,
      totalAvailable: totalKeys,
      workingCount,
      keys: keyResults
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to run Gemini with auto-rotation on quota error
async function runGeminiWithRotation(prompt, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const currentModel = getGeminiModel();
    if (!currentModel) {
      throw new Error('No Gemini API key available');
    }
    
    try {
      const result = await currentModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      rotateGeminiKey();
      return text;
    } catch (error) {
      const errorMsg = error.message || '';
      const isQuotaError = errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
      const isKeyError = errorMsg.includes('API_KEY_INVALID') || errorMsg.includes('not valid') || errorMsg.includes('leaked') || errorMsg.includes('403') || errorMsg.includes('Forbidden');
      const isBadRequest = errorMsg.includes('400');

      if (isKeyError) {
        console.log(`❌ مفتاح Gemini غير صالح (محاولة ${attempt + 1}): ${errorMsg.substring(0, 100)}`);
      } else if (isQuotaError) {
        console.log(`⚠️ حصة Gemini منتهية (محاولة ${attempt + 1})`);
      } else if (isBadRequest) {
        console.log(`⚠️ طلب غير صالح Gemini (محاولة ${attempt + 1}): ${errorMsg.substring(0, 100)}`);
      } else {
        console.log(`❌ خطأ Gemini (محاولة ${attempt + 1}): ${errorMsg.substring(0, 150)}`);
      }

      if (isQuotaError || isKeyError) {
        if (rotateGeminiKey()) {
          continue;
        }
      }
      if (attempt === maxRetries - 1) {
        throw error;
      }
    }
  }
  throw new Error('All Gemini API keys exhausted');
}

// Add logo watermark only (without frame)
app.post('/api/add-watermark', async (req, res) => {
  try {
    const { imageUrl, watermark } = req.body;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'يرجى إرسال رابط الصورة' });

    let productImageBuffer;
    if (imageUrl.startsWith('data:image')) {
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
      productImageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      productImageBuffer = await downloadImage(imageUrl);
    }
    
    const logoPath = path.join(__dirname, 'public', 'watermark_logo.png');
    if (!fs.existsSync(logoPath)) {
      return res.status(400).json({ success: false, error: 'يرجى رفع لوقو القناة أولاً من الإعدادات' });
    }
    
    const imageMeta = await sharp(productImageBuffer).metadata();
    const imageWidth = imageMeta.width;
    const imageHeight = imageMeta.height;
    
    const logoSize = watermark?.size === 'small' ? 80 : watermark?.size === 'large' ? 160 : 120;
    const padding = 20;
    
    const resizedLogo = await sharp(logoPath)
      .resize(logoSize, logoSize, { fit: 'inside' })
      .png()
      .toBuffer();
    
    const logoMeta = await sharp(resizedLogo).metadata();
    const logoW = logoMeta.width;
    const logoH = logoMeta.height;
    
    let left, top;
    const position = watermark?.position || 'bottom-right';
    switch(position) {
      case 'top-left':
        left = padding;
        top = padding;
        break;
      case 'top-right':
        left = imageWidth - logoW - padding;
        top = padding;
        break;
      case 'bottom-left':
        left = padding;
        top = imageHeight - logoH - padding;
        break;
      case 'center':
        left = Math.round((imageWidth - logoW) / 2);
        top = Math.round((imageHeight - logoH) / 2);
        break;
      case 'bottom-right':
      default:
        left = imageWidth - logoW - padding;
        top = imageHeight - logoH - padding;
        break;
    }
    
    const watermarkedImage = await sharp(productImageBuffer)
      .composite([{
        input: resizedLogo,
        left: left,
        top: top,
        blend: 'over'
      }])
      .jpeg({ quality: 90 })
      .toBuffer();
    
    const base64Image = watermarkedImage.toString('base64');
    res.json({ 
      success: true, 
      framedImage: `data:image/jpeg;base64,${base64Image}` 
    });
  } catch (error) {
    console.error('Watermark error:', error);
    res.status(500).json({ success: false, error: 'فشل في إضافة العلامة المائية' });
  }
});

async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

app.post('/api/frame-image', async (req, res) => {
  try {
    const { imageUrl, watermark } = req.body;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'يرجى إرسال رابط الصورة' });

    let productImageBuffer;
    if (imageUrl.startsWith('data:image')) {
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
      productImageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      productImageBuffer = await downloadImage(imageUrl);
    }
    
    const framePath = path.join(__dirname, 'public', 'frame.jpg');
    const customFramePath = path.join(__dirname, 'public', 'custom_frame.jpg');
    const useFramePath = fs.existsSync(customFramePath) ? customFramePath : framePath;
    
    const frameMetadata = await sharp(useFramePath).metadata();
    const frameWidth = frameMetadata.width;
    const frameHeight = frameMetadata.height;
    
    const innerLeft = Math.round(frameWidth * 0.02);
    const innerTop = Math.round(frameHeight * 0.02);
    const innerWidth = Math.round(frameWidth * 0.96);
    const innerHeight = Math.round(frameHeight * 0.85);
    
    const resizedProduct = await sharp(productImageBuffer)
      .resize(innerWidth, innerHeight, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .toBuffer();
    
    let composites = [{
      input: resizedProduct,
      left: innerLeft,
      top: innerTop,
      blend: 'over'
    }];
    
    // Add logo watermark if exists
    const logoPath = path.join(__dirname, 'public', 'watermark_logo.png');
    if (fs.existsSync(logoPath) && watermark) {
      try {
        const logoSize = watermark.size === 'small' ? 80 : watermark.size === 'large' ? 160 : 120;
        const padding = 20;
        
        // Resize logo
        const resizedLogo = await sharp(logoPath)
          .resize(logoSize, logoSize, { fit: 'inside' })
          .png()
          .toBuffer();
        
        const logoMeta = await sharp(resizedLogo).metadata();
        const logoW = logoMeta.width;
        const logoH = logoMeta.height;
        
        // Calculate position
        let left, top;
        switch(watermark.position) {
          case 'top-left':
            left = padding;
            top = padding;
            break;
          case 'top-right':
            left = frameWidth - logoW - padding;
            top = padding;
            break;
          case 'bottom-left':
            left = padding;
            top = frameHeight - logoH - padding;
            break;
          case 'center':
            left = Math.round((frameWidth - logoW) / 2);
            top = Math.round((frameHeight - logoH) / 2);
            break;
          case 'bottom-right':
          default:
            left = frameWidth - logoW - padding;
            top = frameHeight - logoH - padding;
            break;
        }
        
        composites.push({
          input: resizedLogo,
          left: left,
          top: top,
          blend: 'over'
        });
      } catch (logoErr) {
        console.error('Logo watermark error:', logoErr);
      }
    }
    
    const framedImage = await sharp(useFramePath)
      .composite(composites)
      .jpeg({ quality: 90 })
      .toBuffer();
    
    const base64Image = framedImage.toString('base64');
    res.json({ 
      success: true, 
      framedImage: `data:image/jpeg;base64,${base64Image}` 
    });
  } catch (error) {
    console.error('Frame error:', error);
    res.status(500).json({ success: false, error: 'فشل في إنشاء الصورة المؤطرة' });
  }
});


app.post('/api/affiliate', async (req, res) => {
  try {
    const { url, credentials } = req.body;
    const cookies = credentials?.cook || await getSharedCookie();
    if (credentials?.cook) {
      const shared = await loadSharedCredentials();
      shared.cook = credentials.cook;
      await saveSharedCredentials(shared);
    }
    if (!url) return res.status(400).json({ success: false, error: 'الرجاء إرسال رابط المنتج' });
    if (!cookies) return res.status(500).json({ success: false, error: 'الرجاء إدخال Cookie في الإعدادات' });

    const result = await portaffFunction(cookies, url);
    if (!result?.previews?.title) return res.status(400).json({ success: false, error: 'رابط غير صالح' });

    res.json({
      success: true,
      data: {
        title: result.previews.title,
        image: result.previews.image_url,
        price: result.previews.price,
        original_price: result.previews.original_price,
        discount: result.previews.discount,
        currency: result.previews.currency,
        shop_name: result.previews.shop_name,
        rating: result.previews.rating,
        orders: result.previews.orders,
        links: {
          coin: result.aff.coin,
          point: result.aff.point,
          super: result.aff.super,
          limit: result.aff.limit,
          bundle: result.aff.ther3
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'حدث خطأ' });
  }
});

app.post('/api/publish-telegram', async (req, res) => {
  try {
    const { title, price, link, coupon, image, settings, credentials } = req.body;
    if (credentials?.telegramToken) {
      const shared = await loadSharedCredentials();
      shared.botToken = credentials.telegramToken;
      if (credentials.cook) shared.cook = credentials.cook;
      await saveSharedCredentials(shared);
    }
    const botToken = credentials?.telegramToken || await getSharedBotToken();
    let channelId1 = credentials?.channelId || process.env.TELEGRAM_CHANNEL_ID;
    let channelId2 = credentials?.channelId2 || '@AliOffers_Dz';
    const channelChoice = credentials?.channelChoice || '1';
    
    if (!botToken) return res.status(500).json({ success: false, error: 'الرجاء إدخال توكن البوت في الإعدادات' });
    
    function formatChannelId(id) {
      if (!id) return null;
      if (id.includes('t.me/')) {
        const match = id.match(/t\.me\/([^\/\?]+)/);
        if (match) return '@' + match[1];
      }
      if (!id.startsWith('@') && !id.startsWith('-')) return '@' + id;
      return id;
    }
    
    channelId1 = formatChannelId(channelId1);
    channelId2 = formatChannelId(channelId2);
    
    const s = settings || {
      prefix: '📢تخفيض لـ',
      salePrice: '✅السعر بعد التخفيض:',
      linkText: '📌رابط الشراء :',
      couponText: '🎁كوبون:',
      footer: '⚠️ لا تنس استخدام البوت الرسمي لـ AliOffersDz للحصول على أفضل العروض والتخفيضات من AliExpress 👇',
      botLink: '@AliOffersDZ_bot',
      hashtags: '#Aliexpress'
    };
    
    let message = `${s.prefix} ${title}\n\n`;
    message += `${s.salePrice} ${price}\n\n${s.linkText}\n${link}\n\n`;
    if (coupon) message += `${s.couponText} ${coupon}\n\n`;
    message += `${s.footer}\n🔗 ${s.botLink}\n\n${s.hashtags}`;
    
    // Use custom message if provided
    const finalMessage = req.body.customMessage || message;
    
    const bot = new Telegraf(botToken);
    
    let channels = [];
    if (channelChoice === '1' && channelId1) channels.push(channelId1);
    else if (channelChoice === '2' && channelId2) channels.push(channelId2);
    else if (channelChoice === 'both') {
      if (channelId1) channels.push(channelId1);
      if (channelId2) channels.push(channelId2);
    }
    
    if (channels.length === 0) return res.status(500).json({ success: false, error: 'الرجاء إدخال معرف القناة في الإعدادات' });
    
    for (const ch of channels) {
      if (image) {
        if (image.startsWith('data:image')) {
          const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
          const imageBuffer = Buffer.from(base64Data, 'base64');
          await bot.telegram.sendPhoto(ch, { source: imageBuffer }, { caption: finalMessage });
        } else {
          await bot.telegram.sendPhoto(ch, image, { caption: finalMessage });
        }
      } else {
        await bot.telegram.sendMessage(ch, finalMessage);
      }
    }
    
    res.json({ success: true, message: `تم النشر في ${channels.length} قناة` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Collections API
app.post('/api/publish-collection', async (req, res) => {
  try {
    const { message, image, credentials } = req.body;
    const spyCfg3 = spyConfigCache || {};
    const botToken = credentials?.telegramToken || spyCfg3.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return res.status(400).json({ success: false, error: 'Bot token مطلوب' });
    
    const bot = new Telegraf(botToken);
    const channels = [];
    
    function formatChannelId(channelId) {
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
    
    if (credentials.channelChoice === '1' || credentials.channelChoice === 'both') {
      if (credentials.channelId) channels.push(formatChannelId(credentials.channelId));
    }
    if (credentials.channelChoice === '2' || credentials.channelChoice === 'both') {
      if (credentials.channelId2) channels.push(formatChannelId(credentials.channelId2));
    }
    
    if (channels.length === 0) return res.status(500).json({ success: false, error: 'الرجاء إدخال معرف القناة في الإعدادات' });
    
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
    
    res.json({ success: true, message: `تم النشر في ${channels.length} قناة` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scheduling API
app.post('/api/schedule-post', (req, res) => {
  try {
    const { message, image, scheduledTime, credentials } = req.body;
    
    if (!scheduledTime) {
      return res.status(400).json({ success: false, error: 'يرجى تحديد وقت النشر' });
    }
    
    const post = postScheduler.addPost({
      message,
      image,
      scheduledTime,
      credentials
    });
    
    res.json({ success: true, post });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Simple title cleanup function (fallback when AI is unavailable)
function stripAIFormatting(text) {
  if (!text) return text;
  return text
    .replace(/`{1,3}[\w]*\s*/g, '')
    .replace(/`/g, '')
    .replace(/[*#"'{}[\]]/g, '')
    .trim();
}

function cleanupTitle(title) {
  let cleaned = title
    .replace(/\s+/g, ' ')
    .replace(/[,]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  
  // Remove common AliExpress junk patterns
  const junkPatterns = [
    /\bfor\s+(men|women|kids|boys|girls|ladies)\b/gi,
    /\b(new|hot|sale|2024|2025|2026)\b/gi,
    /\b(high quality|free shipping|fast shipping)\b/gi,
    /\d+\s*(pcs|pieces|pack|set)\b/gi,
  ];
  
  junkPatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '').trim();
  });
  
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  
  // Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

app.post('/api/ai-refine-title', async (req, res) => {
  try {
    const { title, isHook } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'العنوان مطلوب' });

    // Check if any AI key is available
    const hasAI = getGeminiModel() !== null;

    // If no AI model available, use simple cleanup
    if (!hasAI) {
      const cleanedTitle = cleanupTitle(title);
      return res.json({ success: true, refinedTitle: cleanedTitle, method: 'fallback' });
    }

    try {
      let prompt;
      if (isHook) {
        prompt = `
        أنت كاتب محتوى جزائري خبير في التسويق بالعمولة. 
        المهمة: كتابة "هوك" (Hook) واحد فقط مثير للانتباه بالدارجة الجزائرية.
        
        أمثلة للأسلوب المطلوب:
        - افاااااااااار 🔥
        - الححححححححححححق بااااطل 😱
        - باااااااااااااااااااااااااااااااااااااااااااطل 📉
        - لافيير ناااار 🧨
        
        قواعد:
        1. سطر واحد فقط (3-6 كلمات).
        2. بدون شرح أو مقدمات.
        
        العنوان: ${title}
      `;
      } else {
        prompt = `Refine this AliExpress product title to be short and attractive.
Rules:
1. English only, 3-6 words max.
2. Remove junk (Global Version, 2024, Free Shipping, etc.).
3. Focus on core product name.
4. Start with a relevant emoji.
5. Reply with ONLY the refined title text. No JSON, no markdown, no code blocks, no backticks, no quotes, no formatting.

Title: ${title}`;
      }
      
      // Use rotation-enabled function
      const rawResult = await runGeminiWithRotation(prompt);
      console.log(`🔍 AI raw result: "${rawResult.substring(0, 150)}"`);
      let refinedTitle = rawResult
        .replace(/`{1,3}[\w]*\s*/g, '')
        .replace(/`/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('{') && !l.startsWith('}') && !/^(json|```)/i.test(l))
        .join(' ')
        .replace(/^(هوك مقترح|المقدمة|النتيجة|العنوان|Refined Title|Result|json)[\s:]+/i, '')
        .replace(/[*#"'{}[\]`]/g, '')
        .trim();
      if (!refinedTitle || refinedTitle.length < 2) refinedTitle = title;
      console.log(`✅ Refined title: "${refinedTitle}"`);
      res.json({ success: true, refinedTitle, method: 'ai' });
    } catch (aiError) {
      // If AI fails (quota exceeded, etc.), use fallback
      console.log('AI failed, using fallback:', aiError.message);
      const cleanedTitle = cleanupTitle(title);
      res.json({ success: true, refinedTitle: cleanedTitle, method: 'fallback' });
    }
  } catch (error) {
    console.error('Refine error:', error.message || error);
    // Even on error, try to return something useful
    const cleanedTitle = cleanupTitle(req.body.title || '');
    if (cleanedTitle) {
      res.json({ success: true, refinedTitle: cleanedTitle, method: 'fallback' });
    } else {
      res.status(500).json({ success: false, error: 'فشل تحسين العنوان' });
    }
  }
});

app.post('/api/ai-extract-price', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'النص مطلوب' });

    const hasAI = getGeminiModel() !== null;
    if (!hasAI) {
      return res.json({ success: true, price: null, method: 'no_ai' });
    }

    try {
      const prompt = `أنت محلل نصوص خبير. استخرج السعر من النص التالي.

قواعد:
1. ابحث عن أي سعر مذكور بأي عملة (دينار، دولار، يورو، ريال، درهم، جنيه، DA, DZD, USD, EUR، إلخ).
2. إذا وُجد أكثر من سعر، اختر السعر النهائي أو سعر البيع (وليس السعر الأصلي/المشطوب).
3. أعد الإجابة بصيغة JSON فقط: {"price":"السعر مع العملة"} أو {"price":null} إذا لم تجد سعراً.
4. لا تضف أي شرح أو نص إضافي — فقط JSON.

النص:
${text}`;

      const rawResult = await runGeminiWithRotation(prompt);
      let extracted = null;
      try {
        const jsonMatch = rawResult.match(/\{[\s\S]*?"price"[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          extracted = parsed.price;
        }
      } catch {}

      if (!extracted) {
        const fallbackLine = rawResult.replace(/^(السعر|Price|النتيجة)[\s:]+/i, '').split('\n')[0].trim();
        if (fallbackLine && fallbackLine !== 'NONE' && fallbackLine.toLowerCase() !== 'none' && fallbackLine !== 'null') {
          extracted = fallbackLine;
        }
      }

      if (extracted) {
        extracted = stripAIFormatting(String(extracted));
        const hasNumber = /\d/.test(extracted);
        if (!hasNumber || extracted.length > 50) {
          return res.json({ success: true, price: null, method: 'ai_invalid' });
        }
      }

      res.json({ success: true, price: extracted || null, method: 'ai' });
    } catch (aiError) {
      console.log('AI price extraction failed:', aiError.message);
      res.json({ success: true, price: null, method: 'fallback' });
    }
  } catch (error) {
    console.error('Price extraction error:', error.message || error);
    res.json({ success: true, price: null, method: 'error' });
  }
});

app.post('/api/ai-extract-coupon', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'النص مطلوب' });

    const hasAI = getGeminiModel() !== null;
    if (!hasAI) {
      return res.json({ success: true, coupon: null, method: 'no_ai' });
    }

    try {
      const prompt = `أنت محلل نصوص خبير في التسويق والعروض. استخرج كل أكواد الكوبونات من النص التالي.

قواعد:
1. ابحث عن كل أكواد الكوبونات والخصم في النص — قد يوجد أكثر من كوبون.
2. الكوبونات تكون مزيج من حروف كبيرة وأرقام مثل: AFAS5, ZNQ005, 04CD29, CDIL2, UACD04, AUMR06, CACD43, US5OFF, AE200, إلخ.
3. ابحث بجانب كلمات: كوبون، كود، CODE، coupon، خصم، حصل، استخدم.
4. ابحث أيضاً عن أكواد بجانب أعلام الدول 🇺🇸🇨🇦🇦🇺 أو عملات مثل $4, $6.
5. أعد كل الكوبونات مفصولة بـ " | ".
6. أعد JSON فقط: {"coupon":"CODE1 | CODE2 | CODE3"} أو {"coupon":null} إذا لم تجد.
7. لا تضف شرح — فقط JSON.

النص:
${text}`;

      const rawResult = await runGeminiWithRotation(prompt);
      let extracted = null;
      try {
        const jsonMatch = rawResult.match(/\{[\s\S]*?"coupon"[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          extracted = parsed.coupon;
        }
      } catch {}

      if (!extracted) {
        const fallbackLine = rawResult.replace(/^(الكوبون|Coupon|النتيجة|الكود)[\s:]+/i, '').split('\n')[0].trim();
        if (fallbackLine && fallbackLine !== 'NONE' && fallbackLine.toLowerCase() !== 'none' && fallbackLine !== 'null' && fallbackLine.length <= 25) {
          extracted = fallbackLine;
        }
      }

      if (extracted) {
        extracted = stripAIFormatting(String(extracted));
        if (extracted.length < 3 || extracted.length > 100) {
          return res.json({ success: true, coupon: null, method: 'ai_invalid' });
        }
      }

      res.json({ success: true, coupon: extracted || null, method: 'ai' });
    } catch (aiError) {
      console.log('AI coupon extraction failed:', aiError.message);
      res.json({ success: true, coupon: null, method: 'fallback' });
    }
  } catch (error) {
    console.error('Coupon extraction error:', error.message || error);
    res.json({ success: true, coupon: null, method: 'error' });
  }
});

app.post('/api/ai-extract-phone-name', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'النص مطلوب' });

    const hasAI = getGeminiModel() !== null;
    if (!hasAI) {
      return res.json({ success: true, phoneName: null, method: 'no_ai' });
    }

    try {
      const prompt = `أنت خبير في الهواتف الذكية. استخرج اسم الهاتف الكامل والدقيق من النص التالي.

قواعد صارمة:
1. استخرج اسم الهاتف الكامل تماماً (مثال: realme P4 Power 8/256, POCO X8 PRO 5G, Samsung Galaxy S24 Ultra, iPhone 16 Pro Max, Xiaomi 14 Ultra).
2. يجب تضمين: الشركة + الموديل + الرقم + اللاحقة (Pro, Ultra, Power, Flagship, Plus, Max, Lite, 5G).
3. أضف مواصفات RAM/Storage (مثال: 8/256 أو 8GB/256GB).
4. ابحث عن جميع الماركات: realme, POCO, Xiaomi, Samsung, iPhone, Oppo, HTC, Nokia, OnePlus, Motorola.
5. أمثلة من الصور الحقيقية:
   - "realme P4 Power 8/256" → realme P4 Power 8/256
   - "POCO X8 PRO 5G" → POCO X8 PRO 5G
   - بحث دقيق: ابحث عن الهاتف بعد الصور والكلمات الرئيسية
6. لا تترجم الاسم — اكتبه بالإنجليزية.
7. أعد فقط JSON: {"phoneName":"الاسم الكامل"} أو {"phoneName":null}
8. لا تضف شرح — فقط JSON.

النص:
${text}`;

      const rawResult = await runGeminiWithRotation(prompt);
      let extracted = null;
      try {
        const jsonMatch = rawResult.match(/\{[\s\S]*?"phoneName"[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          extracted = parsed.phoneName;
        }
      } catch {}

      if (!extracted) {
        const fallbackLine = rawResult.replace(/^(الهاتف|Phone|الاسم|Name)[\s:]+/i, '').split('\n')[0].trim();
        if (fallbackLine && fallbackLine !== 'null' && fallbackLine.toLowerCase() !== 'none' && fallbackLine.length >= 5 && fallbackLine.length <= 80) {
          extracted = fallbackLine;
        }
      }

      if (extracted) {
        extracted = stripAIFormatting(String(extracted));
        if (extracted.length < 5 || extracted.length > 80) {
          return res.json({ success: true, phoneName: null, method: 'ai_invalid' });
        }
      }

      res.json({ success: true, phoneName: extracted || null, method: 'ai' });
    } catch (aiError) {
      console.log('AI phone name extraction failed:', aiError.message);
      res.json({ success: true, phoneName: null, method: 'fallback' });
    }
  } catch (error) {
    console.error('Phone name extraction error:', error.message || error);
    res.json({ success: true, phoneName: null, method: 'error' });
  }
});

app.post('/api/ai-extract-product-info', async (req, res) => {
  try {
    const { text, apiTitle } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'النص مطلوب' });

    const hasAI = getGeminiModel() !== null;
    if (!hasAI) {
      return res.json({ success: true, productInfo: null, method: 'no_ai' });
    }

    try {
      const prompt = `أنت خبير تحديد المنتجات. حلّل منشور من قناة عروض واستخرج معلومات المنتج بدقة.

القواعس:
1. تعرف على اسم المنتج التجاري الدقيق (العلامة التجارية + الموديل + النسخة).
2. للهواتف الذكية: البحث عن: Brand Model Number (مثل: iPhone 15 Pro, Samsung Galaxy S24, DJI Osmo Mobile 7, Soundcore by Anker Space Q45).
3. للأجهزة الأخرى: اسم منتج قصير جذاب (3-8 كلمات كحد أقصى).
4. اكتب اسم المنتج باللغة الإنجليزية فقط.
5. حدّد إذا كان المنتج هاتف ذكي أو لا.
6. ابحث في النص عن: اسم العلامة التجارية (Samsung, iPhone, DJI, Anker, Sony, إلخ)، رقم الموديل أو النسخة (15, S24, 7, Pro, Ultra, Max، إلخ).
7. تجاهل الكلمات العربية والحروف والرموز - انتقِ الأسماء الإنجليزية فقط.
8. رد بـ JSON فقط، بلا شرح أو markdown:
{"productName":"اسم المنتج الدقيق","isPhone":true/false}
9. إذا لم تتعرف على المنتج: {"productName":null,"isPhone":false}

${apiTitle ? `API Title (قد تكون خاطئة): ${apiTitle}\n` : ''}
نص المنشور:
${text}`;

      const rawResult = await runGeminiWithRotation(prompt);
      console.log(`🔍 AI product info raw: "${rawResult.substring(0, 150)}"`);
      let productInfo = null;
      try {
        const cleaned = rawResult.replace(/`{1,3}[\w]*\s*/g, '').replace(/`/g, '');
        const jsonMatch = cleaned.match(/\{[\s\S]*?"productName"[\s\S]*?\}/);
        if (jsonMatch) {
          productInfo = JSON.parse(jsonMatch[0]);
          if (productInfo.productName) {
            productInfo.productName = stripAIFormatting(String(productInfo.productName));
          }
        }
      } catch {}

      if (!productInfo) {
        const lines = rawResult.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('{') && !l.startsWith('`'));
        if (lines.length > 0) {
          const name = stripAIFormatting(lines[0]);
          if (name && name.length >= 3 && name.length <= 80) {
            productInfo = { productName: name, isPhone: false };
          }
        }
      }

      console.log(`✅ AI product info: ${JSON.stringify(productInfo)}`);
      res.json({ success: true, productInfo, method: 'ai' });
    } catch (aiError) {
      console.log('AI product info extraction failed:', aiError.message);
      res.json({ success: true, productInfo: null, method: 'fallback' });
    }
  } catch (error) {
    console.error('Product info extraction error:', error.message || error);
    res.json({ success: true, productInfo: null, method: 'error' });
  }
});

app.post('/api/ai-analyze-post', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.json({ success: true, result: null });
    }

    const hasAI = getGeminiModel() !== null;
    if (!hasAI) {
      return res.json({ success: true, result: null, method: 'no_ai' });
    }

    const prompt = `أنت خبير في تحليل منشورات قنوات عروض AliExpress بالعربية. حلّل المنشور التالي واستخرج كل المعلومات بدقة عالية.

## الفرق الجوهري بين الكوبونات العامة وقسيمة البائع:

### الكوبونات العامة (Platform Coupons):
- هي أكواد خصم تُستخدم عند الدفع على منصة AliExpress.
- تأتي بعد كلمات: "كوبون", "كوبــون", "كود", "coupon", "code".
- أمثلة: CDOF06, OD20, ODYOUS20, AZRA2, SEBOT, PAD11
- قد تكون مع مبلغ مثل: "كوبون $20/159 : CDOF06"
- عادة يوجد أكثر من كوبون واحد في المنشور.

### قسيمة البائع (Seller/Store Coupon):
- هي خصم خاص من متجر البائع نفسه — يجب "حجزها" أو "إحجازها" من صفحة المتجر.
- تأتي بعد عبارات محددة فقط: "قسيمة البائع", "إحجز قسيمة البائع", "حصل قسيمة البائع", "خصم البائع", "عرض المتجر", "store coupon", "seller coupon".
- عادة تكون مبلغ مثل "$0.87" أو "$32" أو "$2/20" أو كود خاص طويل مثل ONE8EV82 أو SUV5QSCYTUHK.
- إذا لم تجد عبارة "قسيمة البائع" أو ما يشابهها صراحة → ضع sellerCoupon: null.
- ⚠️ مهم جداً: إذا كان الكود يأتي بعد كلمة "كوبون" (وليس "قسيمة البائع") → هو كوبون عام وليس قسيمة بائع!

## قواعد صارمة:
1. استخرج اسم المنتج الإنجليزي الدقيق (العلامة التجارية + الموديل + النسخة).
2. استخرج السعر النهائي بعد التخفيض فقط (بالدولار).
3. الكوبونات العامة: كل كود يأتي بعد "كوبون" أو على سطور "كوبون" → ضعه في coupons[].
4. قسيمة البائع: فقط ما يأتي صراحة بعد "قسيمة البائع" أو "إحجز قسيمة" → sellerCoupon. إذا لم يوجد → null.
5. ⚠️ لا تضع نفس الكود في كلا المكانين. إذا كان الكود كوبون عام، لا تضعه كقسيمة بائع.
6. استخرج كل روابط AliExpress كمصفوفة بدون تكرار.
7. حدد إذا كان المنتج هاتف ذكي أم لا.

## أمثلة:
مثال 1: "كوبون $20/159 : CDOF06 \n كوبون $20/159 : OD20 \n كوبون $20/159 : ODYOUS20"
→ coupons: ["CDOF06", "OD20", "ODYOUS20"], sellerCoupon: null (لا يوجد ذكر لقسيمة البائع)

مثال 2: "كوبون: CDOF06 \n إحجز قسيمة البائع: $0.87"
→ coupons: ["CDOF06"], sellerCoupon: "$0.87"

مثال 3: "حصل قسيمة البائع $32: ONE8EV82"
→ coupons: [], sellerCoupon: "$32", sellerCouponCode: "ONE8EV82"

مثال 4: "كوبون: SEBOT | PAD11 | CDOF06 \n إحجز قسيمة البائع: CDOF06 | OD20 | ODYOUS20"
→ coupons: ["SEBOT", "PAD11", "CDOF06"], sellerCoupon: "CDOF06 | OD20 | ODYOUS20"

## النص:
${text}

## رد بـ JSON فقط (بدون markdown أو شرح):
{
  "productName": "اسم المنتج بالإنجليزية أو null",
  "price": "السعر النهائي أو null",
  "coupons": ["كوبون1", "كوبون2"],
  "sellerCoupon": "مبلغ أو كود قسيمة البائع أو null",
  "sellerCouponCode": "كود قسيمة البائع أو null",
  "links": ["رابط1", "رابط2"],
  "isPhone": false
}`;

    try {
      const rawResult = await runGeminiWithRotation(prompt);
      console.log(`🧠 AI analyze-post raw: "${rawResult.substring(0, 200)}"`);
      let result = null;
      try {
        const cleaned = rawResult.replace(/`{1,3}[\w]*\s*/g, '').replace(/`/g, '');
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
          if (result.productName) result.productName = stripAIFormatting(String(result.productName));
          if (!Array.isArray(result.coupons)) result.coupons = [];
          if (!Array.isArray(result.links)) result.links = [];
          result.coupons = result.coupons.map(c => String(c).trim().toUpperCase()).filter(c => c && c !== 'NULL');
          result.links = result.links.map(l => String(l).trim()).filter(l => l && l.includes('aliexpress'));
        }
      } catch (parseErr) {
        console.log(`⚠️ AI analyze-post parse error: ${parseErr.message}`);
      }

      console.log(`✅ AI analyze-post result: ${JSON.stringify(result)}`);
      res.json({ success: true, result, method: 'ai' });
    } catch (aiError) {
      console.log('AI analyze-post failed:', aiError.message);
      res.json({ success: true, result: null, method: 'fallback' });
    }
  } catch (error) {
    console.error('Analyze post error:', error.message || error);
    res.json({ success: true, result: null, error: error.message });
  }
});

// Extract seller coupon from post text
app.post('/api/ai-extract-seller-coupon', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.json({ success: true, sellerCoupon: null });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `أنت خبير في استخراج قسائم البائع (Store/Seller Coupons) من نصوص منشورات عروض AliExpress بالعربية.

## الفرق بين الكوبون العادي وقسيمة البائع:
- الكوبون العادي: يأتي بعد كلمة "كوبون" أو "كوبــون" أو "code" → هذا ليس قسيمة بائع.
- قسيمة البائع: تأتي فقط بعد عبارات: "قسيمة البائع", "إحجز قسيمة البائع", "حصل قسيمة البائع", "خصم البائع", "قسيمة المتجر", "seller coupon", "store coupon".

## قواعد صارمة:
1. ابحث فقط عن عبارات قسيمة البائع الصريحة في النص.
2. إذا لم تجد عبارة "قسيمة البائع" أو ما يشابهها → أعد null.
3. ⚠️ الأكواد بعد كلمة "كوبون" (مثل CDOF06, OD20) هي كوبونات عامة وليست قسائم بائع.
4. قسيمة البائع قد تكون: مبلغ ($0.87, $32, $2/20) أو كود طويل (ONE8EV82, SUV5QSCYTUHK).

## أمثلة:
- "كوبون: CDOF06 | OD20 | ODYOUS20" → sellerCoupon: null (هذه كوبونات عامة)
- "إحجز قسيمة البائع: $0.87" → sellerCoupon: "$0.87"
- "حصل قسيمة البائع $32: ONE8EV82" → sellerCoupon: "$32"

النص:
${text}

رد بـ JSON فقط (بدون markdown):
{"sellerCoupon": "الكود أو المبلغ أو null"}`;

    const result = await model.generateContent(prompt);
    let rawResult = result.response.text().trim();
    if (rawResult.startsWith('```')) {
      rawResult = rawResult.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed = JSON.parse(rawResult);
      const coupon = parsed.sellerCoupon || null;
      if (coupon && typeof coupon === 'string' && coupon.length > 3) {
        console.log(`✅ قسيمة البائع المستخرجة: ${coupon}`);
        res.json({ success: true, sellerCoupon: coupon });
      } else {
        res.json({ success: true, sellerCoupon: null });
      }
    } catch {
      res.json({ success: true, sellerCoupon: null });
    }
  } catch (error) {
    console.error('Seller coupon extraction error:', error.message || error);
    res.json({ success: true, sellerCoupon: null });
  }
});


// Generate Algerian-style hook/intro for product
app.post('/api/generate-algerian-hook', async (req, res) => {
  try {
    const { title, price } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'العنوان مطلوب' });

    // Fallback hooks if AI is not available - extensive list for variety
    const fallbackHooks = [
      "يا خاوتي شوفو هاد لافير الخطيرة!",
      "سلعة هبال وسومة ما تتفوتش!",
      "لافير تاع الصح، غير بروفيتيو!",
      "عرض خاص لخاوتنا، ما تفوتوهش!",
      "جبتلكم عرض هايل اليوم!",
      "والله سلعة تستاهل، شوفوها!",
      "لقيتلكم حاجة مليحة بزاف!",
      "هاد العرض راه يسوى، ما تتردوش!",
      "سومة هابطة وجودة عالية، واش تستناو!",
      "عرض ما يتفوتش، غير كليكيو!",
      "جات فرصة مليحة لخاوتنا!",
      "شوفو واش لقيت، راه يستاهل!",
      "هادي سلعة نار بسعر هايل!",
      "لافير قوية اليوم، ما تفوتكمش!",
      "والله عجبتني هاد السلعة، لازم نشاركها معاكم!",
      "سعر خيالي وجودة تاع الصح!",
      "هاذي الفرصة لي كنتو تستناو فيها!",
      "منتج هايل بسومة معقولة بزاف!",
      "شوفو هاد لافير قبل ما تخلص!",
      "جبتلكم حاجة تهبل، غير طلو!",
      "عرض اليوم راه خطير، ما تتأخروش!",
      "لقيتلكم كنز اليوم، شوفوه!",
      "هادي فرصة ذهبية، ما تضيعوهاش!",
      "سلعة ممتازة وسومتها في المتناول!",
      "راني نوصيكم بهاد المنتج، يستاهل!"
    ];

    // Check if any AI key is available
    const hasAI = getGeminiModel() !== null;

    if (!hasAI) {
      const randomHook = fallbackHooks[Math.floor(Math.random() * fallbackHooks.length)];
      return res.json({ success: true, hook: randomHook, method: 'fallback' });
    }

    try {
      const prompt = `
        أنت كاتب محتوى جزائري خبير في التسويق بالعمولة. 
        المهمة: كتابة "هوك" (Hook) واحد فقط مثير للانتباه بالدارجة الجزائرية.
        
        أمثلة للأسلوب المطلوب (اختر واحدا منها أو أسلوب مشابه):
        - افاااااااااار 🔥
        - الححححححححححححق بااااطل 😱
        - الحححححق أقل سعر يلحقلو 💸
        - باااااااااااااااااااااااااااااااااااااااااااطل 📉
        - لافيير ناااار 🧨
        - تخفيض ممتاز ✅
        - لووووووووووووووووووز 💎
        - لافـــــااار بـــــاااطل الكمية محدودة ⚠️
        
        قواعد صارمة:
        1. أرجع سطر واحد فقط (3-6 كلمات كحد أقصى).
        2. ممنوع الشرح، ممنوع المقدمات، ممنوع النقاط.
        3. أرجع النص المطلوب مباشرة بدون أي زيادات.
        
        اسم المنتج: ${title}
      `;
      const hook = await runGeminiWithRotation(prompt);
      // Clean up any extra text the AI might add
      const cleanHook = hook.replace(/^(هوك مقترح|المقدمة|النتيجة|نص الهوك|Hook):/i, '').split('\n')[0].trim();
      res.json({ success: true, hook: cleanHook.replace(/[*#]/g, ''), method: 'ai' });
    } catch (aiError) {
      console.log('AI hook failed, using fallback:', aiError.message);
      const randomHook = fallbackHooks[Math.floor(Math.random() * fallbackHooks.length)];
      res.json({ success: true, hook: randomHook, method: 'fallback' });
    }
  } catch (error) {
    console.error('Hook generation error:', error.message || error);
    res.status(500).json({ success: false, error: 'فشل إنشاء المقدمة' });
  }
});

app.get('/api/scheduled-posts', (req, res) => {
  const posts = postScheduler.getAllPosts();
  res.json({ success: true, posts });
});

app.delete('/api/scheduled-posts/:id', (req, res) => {
  postScheduler.removePost(req.params.id);
  res.json({ success: true });
});

const algerianCategories = {
  'electronics': { id: '44', nameAr: 'إلكترونيات', keywords: ['phone accessories', 'earbuds', 'smartwatch', 'power bank'] },
  'fashion': { id: '3', nameAr: 'أزياء', keywords: ['dress', 'jacket', 'shoes', 'bags'] },
  'home': { id: '15', nameAr: 'منزل ومطبخ', keywords: ['kitchen gadgets', 'home decor', 'organizer', 'storage'] },
  'beauty': { id: '66', nameAr: 'جمال وعناية', keywords: ['makeup', 'skincare', 'hair tools', 'perfume'] },
  'kids': { id: '1501', nameAr: 'أطفال وألعاب', keywords: ['toys', 'educational', 'baby items', 'games'] },
  'sports': { id: '18', nameAr: 'رياضة', keywords: ['fitness', 'outdoor', 'camping', 'cycling'] }
};

app.post('/api/discover-products', async (req, res) => {
  try {
    const { category, keywords, minPrice, maxPrice, limit, useAI } = req.body;
    
    const searchOptions = {
      limit: limit || '10',
      minPrice: minPrice || '1',
      maxPrice: maxPrice || '50'
    };

    if (category && algerianCategories[category]) {
      searchOptions.category = algerianCategories[category].id;
    }
    if (keywords) {
      searchOptions.keywords = keywords;
    }

    const result = await searchHotProducts(searchOptions);
    
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || 'فشل البحث عن المنتجات' });
    }

    let products = result.products || [];

    if (useAI && products.length > 0 && getGeminiModel()) {
      try {
        const productTitles = products.slice(0, 5).map((p, i) => `${i+1}. ${p.title} - ${p.price} ${p.currency}`).join('\n');
        
        const prompt = `أنت خبير تسويق متخصص في السوق الجزائري.
من بين هذه المنتجات، رتبها حسب جاذبيتها للمستهلك الجزائري (من الأكثر جاذبية للأقل):

${productTitles}

أعطني فقط أرقام المنتجات مرتبة (مثلاً: 2,1,4,3,5) بدون أي شرح.`;
        
        const ranking = await runGeminiWithRotation(prompt);
        const order = ranking.match(/\d+/g);
        
        if (order && order.length > 0) {
          const reorderedProducts = [];
          order.forEach(idx => {
            const index = parseInt(idx) - 1;
            if (index >= 0 && index < products.length && products[index]) {
              reorderedProducts.push({ ...products[index], aiRanked: true });
            }
          });
          products.forEach(p => {
            if (!reorderedProducts.find(rp => rp.id === p.id)) {
              reorderedProducts.push(p);
            }
          });
          products = reorderedProducts;
        }
      } catch (aiError) {
        console.log('AI ranking failed:', aiError.message);
      }
    }

    res.json({ 
      success: true, 
      total: result.total,
      products: products
    });
  } catch (error) {
    console.error('Discover products error:', error);
    res.status(500).json({ success: false, error: 'حدث خطأ في البحث' });
  }
});

app.post('/api/ai-suggest-keywords', async (req, res) => {
  try {
    const { category, season } = req.body;
    
    const defaultKeywords = {
      'electronics': ['bluetooth earbuds', 'fast charger', 'smartwatch', 'power bank'],
      'fashion': ['summer dress', 'sneakers', 'handbag', 'sunglasses'],
      'home': ['kitchen gadgets', 'home decor', 'organizer', 'LED lights'],
      'beauty': ['makeup set', 'skincare', 'perfume', 'hair tools'],
      'kids': ['educational toys', 'kids clothes', 'electronic games'],
      'sports': ['fitness equipment', 'sportswear', 'camping gear']
    };
    
    if (!getGeminiModel()) {
      return res.json({ 
        success: true, 
        keywords: defaultKeywords[category] || ['trending', 'best seller', 'hot deals'],
        method: 'fallback'
      });
    }

    try {
      const categoryName = algerianCategories[category]?.nameAr || category || 'منتجات عامة';
      const seasonText = season || 'الموسم الحالي';
      
      const prompt = `أنت خبير تسويق أفلييت متخصص في السوق الجزائري.
اقترح 5 كلمات بحث (Keywords) بالإنجليزية للبحث في AliExpress عن منتجات في فئة "${categoryName}" تناسب ${seasonText} وتحقق مبيعات عالية في الجزائر.

أعطني الكلمات فقط مفصولة بفاصلة، بدون أرقام أو شرح.`;
      
      const keywordsText = await runGeminiWithRotation(prompt);
      const keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k.length > 0);
      
      res.json({ success: true, keywords, method: 'ai' });
    } catch (aiError) {
      console.log('AI suggest keywords failed, using fallback:', aiError.message);
      res.json({ 
        success: true, 
        keywords: defaultKeywords[category] || ['trending', 'best seller', 'hot deals'],
        method: 'fallback'
      });
    }
  } catch (error) {
    console.error('AI suggest keywords error:', error);
    const defaultKeywords = ['trending', 'best seller', 'hot deals'];
    res.json({ success: true, keywords: defaultKeywords, method: 'fallback' });
  }
});

app.post('/api/analyze-product', async (req, res) => {
  try {
    const { title, price, category } = req.body;
    
    const fallbackHooks = [
      'يا خاوتي شوفو هاد لافير الخطيرة!',
      'سلعة هبال وسومة ما تتفوتش!',
      'عرض خاص لخاوتنا، ما تفوتوهش!',
      'جبتلكم عرض هايل اليوم!'
    ];
    
    if (!getGeminiModel()) {
      return res.json({ 
        success: true, 
        analysis: {
          score: 7,
          pros: ['سعر مناسب', 'منتج مطلوب'],
          hook: fallbackHooks[Math.floor(Math.random() * fallbackHooks.length)]
        },
        method: 'fallback'
      });
    }

    try {
      const prompt = `أنت خبير تسويق جزائري. حلل هذا المنتج للسوق الجزائري:

المنتج: ${title}
السعر: ${price}

أعطني:
1. نقطة من 10 لجاذبية المنتج للجزائريين
2. ميزتين رئيسيتين بالدارجة الجزائرية (قصيرة جداً)
3. Hook تسويقي قصير بالدارجة الجزائرية

أجب بصيغة JSON فقط:
{"score": 8, "pros": ["ميزة 1", "ميزة 2"], "hook": "النص"}`;
      
      const responseText = await runGeminiWithRotation(prompt);
      
      let analysis;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found');
        }
      } catch (e) {
        analysis = {
          score: 7,
          pros: ['منتج جيد', 'سعر معقول'],
          hook: 'عرض ما يتفوتش، غير كليكيو!'
        };
      }
      
      res.json({ success: true, analysis, method: 'ai' });
    } catch (aiError) {
      console.log('AI analyze failed, using fallback:', aiError.message);
      res.json({ 
        success: true, 
        analysis: {
          score: 7,
          pros: ['سعر مناسب', 'منتج مطلوب'],
          hook: fallbackHooks[Math.floor(Math.random() * fallbackHooks.length)]
        },
        method: 'fallback'
      });
    }
  } catch (error) {
    console.error('Analyze product error:', error);
    res.json({ 
      success: true, 
      analysis: {
        score: 7,
        pros: ['سعر مناسب', 'منتج مطلوب'],
        hook: 'يا خاوتي شوفو هاد لافير الخطيرة!'
      },
      method: 'fallback'
    });
  }
});

app.get('/api/categories', (req, res) => {
  const categories = Object.entries(algerianCategories).map(([key, value]) => ({
    id: key,
    name: value.nameAr,
    aliexpressId: value.id
  }));
  res.json({ success: true, categories });
});

// Saved Posts System
const SAVED_POSTS_FILE = path.join(__dirname, 'saved_posts.json');

function loadSavedPosts() {
  try {
    if (fs.existsSync(SAVED_POSTS_FILE)) {
      return JSON.parse(fs.readFileSync(SAVED_POSTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('Error loading saved posts:', e.message);
  }
  return [];
}

function savePosts(posts) {
  try {
    fs.writeFileSync(SAVED_POSTS_FILE, JSON.stringify(posts, null, 2));
    return true;
  } catch (e) {
    console.log('Error saving posts:', e.message);
    return false;
  }
}

// Get all saved posts
app.get('/api/saved-posts', (req, res) => {
  const posts = loadSavedPosts();
  res.json({ success: true, posts });
});

// Save a new post
app.post('/api/saved-posts', (req, res) => {
  try {
    const { id, title, price, link, coupon, image, message, hook, createdAt } = req.body;
    const posts = loadSavedPosts();
    
    // Use provided ID or generate new one
    const postId = id || Date.now().toString();
    
    // Check if post with same ID already exists (avoid duplicates)
    if (posts.some(p => p.id === postId)) {
      return res.json({ success: true, message: 'Post already exists' });
    }
    
    const newPost = {
      id: postId,
      title,
      price,
      link,
      coupon,
      image,
      message,
      hook,
      createdAt: createdAt || new Date().toISOString()
    };
    
    posts.unshift(newPost);
    
    // Keep only last 50 posts
    if (posts.length > 50) posts.pop();
    
    savePosts(posts);
    res.json({ success: true, post: newPost });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a saved post
app.delete('/api/saved-posts/:id', (req, res) => {
  try {
    let posts = loadSavedPosts();
    posts = posts.filter(p => p.id !== req.params.id);
    savePosts(posts);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all saved posts
app.delete('/api/saved-posts', (req, res) => {
  try {
    savePosts([]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== Spy API ==========

app.get('/api/spy/status', async (req, res) => {
  try {
    const status = await getSpyStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/spy/config', async (req, res) => {
  try {
    const config = await loadSpyConfig();
    res.json({ config });
  } catch (e) {
    res.json({ config: {} });
  }
});

app.post('/api/spy/config', async (req, res) => {
  try {
    const stored = await loadSpyConfig();
    const incoming = req.body || {};
    if (incoming.cook || incoming.botToken) {
      const shared = await loadSharedCredentials();
      if (incoming.cook && incoming.cook !== '****') shared.cook = incoming.cook;
      if (incoming.botToken && incoming.botToken !== '****') shared.botToken = incoming.botToken;
      await saveSharedCredentials(shared);
    }
    const config = { ...stored };
    if (incoming.sourceChannels) config.sourceChannels = incoming.sourceChannels;
    if (incoming.targetChannels) config.targetChannels = incoming.targetChannels;
    if (incoming.linkType) config.linkType = incoming.linkType;
    if (incoming.messageTemplate) config.messageTemplate = incoming.messageTemplate;
    if (incoming.autoPublish !== undefined) config.autoPublish = incoming.autoPublish;
    if (incoming.publishDelay !== undefined) config.publishDelay = incoming.publishDelay;
    if (incoming.delayMin !== undefined) config.delayMin = Math.max(1, Math.min(30, parseInt(incoming.delayMin) || 1));
    if (incoming.delayMax !== undefined) config.delayMax = Math.max(1, Math.min(60, parseInt(incoming.delayMax) || 5));
    if (config.delayMax < config.delayMin) config.delayMax = config.delayMin;
    if (incoming.notifyOwner !== undefined) config.notifyOwner = incoming.notifyOwner;
    if (incoming.ownerId !== undefined) config.ownerId = incoming.ownerId;
    if (incoming.manualReview !== undefined) config.manualReview = incoming.manualReview;
    if (incoming.dailyLimit !== undefined) config.dailyLimit = Math.max(0, parseInt(incoming.dailyLimit) || 0);
    if (incoming.useTypedLinks !== undefined) config.useTypedLinks = incoming.useTypedLinks;
    if (incoming.cook !== undefined && incoming.cook !== '' && incoming.cook !== '****') config.cook = incoming.cook;
    if (incoming.botToken !== undefined && incoming.botToken !== '' && incoming.botToken !== '****') config.botToken = incoming.botToken;
    if (incoming.apiId && incoming.apiId !== '') config.apiId = incoming.apiId;
    if (incoming.apiHash && incoming.apiHash !== '****' && incoming.apiHash !== '') config.apiHash = incoming.apiHash;
    if (incoming.phoneNumber && !incoming.phoneNumber.includes('****')) config.phoneNumber = incoming.phoneNumber;
    await saveSpyConfig(config);
    invalidateSpyCache();
    spyConfigCache = config;
    spyConfigCacheTime = Date.now();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/start', async (req, res) => {
  try {
    const stored = await loadSpyConfig();
    const incoming = req.body || {};
    const config = { ...stored };
    if (incoming.sourceChannels) config.sourceChannels = incoming.sourceChannels;
    if (incoming.targetChannels) config.targetChannels = incoming.targetChannels;
    if (incoming.linkType) config.linkType = incoming.linkType;
    if (incoming.messageTemplate) config.messageTemplate = incoming.messageTemplate;
    if (incoming.autoPublish !== undefined) config.autoPublish = incoming.autoPublish;
    if (incoming.publishDelay !== undefined) config.publishDelay = incoming.publishDelay;
    if (incoming.delayMin !== undefined) config.delayMin = Math.max(1, Math.min(30, parseInt(incoming.delayMin) || 1));
    if (incoming.delayMax !== undefined) config.delayMax = Math.max(1, Math.min(60, parseInt(incoming.delayMax) || 5));
    if (config.delayMax < config.delayMin) config.delayMax = config.delayMin;
    if (incoming.notifyOwner !== undefined) config.notifyOwner = incoming.notifyOwner;
    if (incoming.ownerId !== undefined) config.ownerId = incoming.ownerId;
    if (incoming.manualReview !== undefined) config.manualReview = incoming.manualReview;
    if (incoming.dailyLimit !== undefined) config.dailyLimit = Math.max(0, parseInt(incoming.dailyLimit) || 0);
    if (incoming.useTypedLinks !== undefined) config.useTypedLinks = incoming.useTypedLinks;
    if (incoming.apiId && incoming.apiId !== '') config.apiId = incoming.apiId;
    if (incoming.apiHash && incoming.apiHash !== '****' && incoming.apiHash !== '') config.apiHash = incoming.apiHash;
    if (incoming.phoneNumber && !incoming.phoneNumber.includes('****')) config.phoneNumber = incoming.phoneNumber;
    await saveSpyConfig(config);
    invalidateSpyCache();
    spyConfigCache = config;
    spyConfigCacheTime = Date.now();
    await startSpy(config);
    res.json({ success: true, message: 'تم تشغيل نظام التجسس' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/logout', async (req, res) => {
  try {
    const { logoutSpy } = require('./spy');
    await logoutSpy();
    res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/stop', async (req, res) => {
  try {
    await stopSpy();
    invalidateSpyCache();
    spyConfigCache = null;
    spyConfigCacheTime = 0;
    res.json({ success: true, message: 'تم إيقاف نظام التجسس' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/spy/log', async (req, res) => {
  try {
    const log = await loadSpyLog();
    res.json({ success: true, log });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/spy/log/:id', async (req, res) => {
  try {
    const db = require('./db');
    await db.deleteLogEntry(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/spy/log', async (req, res) => {
  try {
    const db = require('./db');
    await db.clearLog();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/republish', async (req, res) => {
  try {
    const { message, image, targets, delayMinutes } = req.body;
    if (!message || !targets || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ success: false, error: 'بيانات غير كافية لإعادة النشر' });
    }
    const spyConfig = await loadSpyConfigCached();
    const allowedTargets = (spyConfig.targetChannels || []).map(ch => String(ch.id || ch));
    const validTargets = targets.filter(t => allowedTargets.includes(String(t)));
    if (validTargets.length === 0) {
      return res.status(400).json({ success: false, error: 'لا توجد قنوات هدف مسموح بها' });
    }
    const delay = Number(delayMinutes);
    if (delayMinutes !== undefined && (!Number.isFinite(delay) || delay < 0 || delay > 1440)) {
      return res.status(400).json({ success: false, error: 'قيمة التأخير غير صالحة (0-1440 دقيقة)' });
    }
    const reviewData = {
      message,
      productImage: image || null,
      targetIds: validTargets,
      sourceName: 'إعادة نشر',
      originalLink: '',
      affiliateLink: '',
      productTitle: '',
      productPrice: '',
      imageUrlForLog: image || null
    };
    const delayMs = delay > 0 ? delay * 60000 : 0;
    if (delayMs > 0) {
      setTimeout(async () => {
        try { await executePublish(reviewData); } catch (e) { console.log('❌ فشل إعادة النشر المؤجل:', e.message); }
      }, delayMs);
      res.json({ success: true, message: `سيتم إعادة النشر بعد ${Math.round(delay)} دقيقة` });
    } else {
      await executePublish(reviewData);
      res.json({ success: true, message: 'تم إعادة النشر بنجاح' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/send-code', async (req, res) => {
  try {
    const config = req.body;
    await saveSpyConfig(config);
    spyConfigCache = config;
    spyConfigCacheTime = Date.now();
    const result = await sendLoginCode(config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/verify-code', async (req, res) => {
  try {
    const { code, password } = req.body;
    const config = await loadSpyConfigCached();
    const result = await verifyCode(config, code, password);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/verify-password', async (req, res) => {
  try {
    const { password } = req.body;
    const config = await loadSpyConfigCached();
    const result = await verifyCode(config, null, password);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======= Video Generator API =======

app.post('/api/video/fetch-product', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'الرجاء إرسال رابط المنتج' });

    const cookies = await getSharedCookie();
    if (!cookies) {
      return res.json({
        success: true,
        data: {
          title: 'منتج رائع من AliExpress',
          image: '',
          price: '$29.99',
          original_price: '$59.99',
          discount: '-50%',
          shop_name: 'AliExpress Store'
        }
      });
    }

    const result = await portaffFunction(cookies, url);
    if (!result?.previews?.title) {
      return res.json({
        success: true,
        data: {
          title: 'منتج من AliExpress',
          image: '',
          price: '$29.99',
          original_price: '$59.99',
          discount: '-50%',
          shop_name: 'Store'
        }
      });
    }

    res.json({
      success: true,
      data: {
        title: result.previews.title,
        image: result.previews.image_url,
        price: result.previews.price,
        original_price: result.previews.original_price,
        discount: result.previews.discount,
        currency: result.previews.currency,
        shop_name: result.previews.shop_name,
        rating: result.previews.rating,
        orders: result.previews.orders
      }
    });
  } catch (error) {
    console.log('Video fetch-product error:', error.message);
    res.json({
      success: true,
      data: {
        title: 'منتج من AliExpress',
        image: '',
        price: '$29.99',
        original_price: '$59.99',
        discount: '-50%',
        shop_name: 'Store'
      }
    });
  }
});

app.post('/api/video/generate-script', async (req, res) => {
  try {
    const { product, lang } = req.body;
    const hasAI = getGeminiModel() !== null;

    if (!hasAI) {
      const fallback = lang === 'ar'
        ? `🔥 عرض لا يُفوَّت!\n${product.title || 'منتج مميز'}\n💰 السعر: ${product.price || '$29.99'}\n✅ وفِّر ${product.discount || '50%'} الآن!\n👇 اطلب الآن - الرابط في الوصف`
        : `🔥 Don't miss this deal!\n${product.title || 'Amazing Product'}\n💰 Price: ${product.price || '$29.99'}\n✅ Save ${product.discount || '50%'} now!\n👇 Order now - Link in description`;
      return res.json({ success: true, script: fallback });
    }

    const prompt = lang === 'ar'
      ? `أنت كاتب إعلانات محترف. اكتب نص تسويقي قصير لفيديو أفلييت (5 أسطر كحد أقصى) للمنتج التالي:

العنوان: ${product.title || 'منتج'}
السعر: ${product.price || 'غير محدد'}
السعر الأصلي: ${product.original_price || 'غير محدد'}
الخصم: ${product.discount || 'غير محدد'}

المطلوب:
- السطر 1: جملة جذب قوية مع إيموجي 🔥
- السطر 2: اسم المنتج مختصر
- السطر 3: السعر والخصم 💰
- السطر 4: ميزة أو فائدة رئيسية ✅
- السطر 5: دعوة للشراء مع إيموجي 👇🛒

اكتب بالعربية، بأسلوب حماسي وجذاب. لا تضف أي شيء آخر.`
      : `You are a professional copywriter. Write a short affiliate video marketing script (max 5 lines) for this product:

Title: ${product.title || 'Product'}
Price: ${product.price || 'N/A'}
Original Price: ${product.original_price || 'N/A'}
Discount: ${product.discount || 'N/A'}

Requirements:
- Line 1: Strong hook with 🔥 emoji
- Line 2: Short product name
- Line 3: Price and discount 💰
- Line 4: Key benefit ✅
- Line 5: Call to action with 👇🛒 emoji

Write in English, energetic and catchy style. Nothing else.`;

    const script = await runGeminiWithRotation(prompt);
    res.json({ success: true, script: script.trim() });
  } catch (error) {
    console.log('Video generate-script error:', error.message);
    const fallback = req.body.lang === 'ar'
      ? `🔥 عرض لا يُفوَّت!\n${req.body.product?.title || 'منتج مميز'}\n💰 السعر: ${req.body.product?.price || '$29.99'}\n✅ خصم كبير!\n👇 اطلب الآن`
      : `🔥 Don't miss this!\n${req.body.product?.title || 'Amazing Product'}\n💰 Price: ${req.body.product?.price || '$29.99'}\n✅ Big discount!\n👇 Order now`;
    res.json({ success: true, script: fallback });
  }
});

app.post('/api/video/generate-veo-prompt', async (req, res) => {
  try {
    const { productName, imageUrl, style, lang } = req.body;
    if (!productName && !imageUrl) return res.status(400).json({ success: false, error: 'Product name or image required' });

    const styleNames = {
      apple: 'Apple-style clean minimalist advert',
      cinematic: 'cinematic epic advert with dramatic slow-motion',
      energetic: 'fast-paced energetic TikTok/Reels style advert',
      luxury: 'luxury premium advert with gold and black palette'
    };
    const styleLbl = styleNames[style] || styleNames.apple;

    const apiKey = getCurrentGeminiKey();
    if (!apiKey) {
      const pName = productName ? productName.split(/\s+/).slice(0, 4).join(' ') : 'Product';
      const fallback = JSON.stringify({
        product_short_name: pName,
        product_appearance: `A premium ${pName} with sleek modern industrial design, clean lines, and high-quality materials including brushed metal surfaces and matte black accents.`,
        title: `${pName} — ${styleLbl} Video Ad`,
        style: `Cinematic, ${styleLbl}`,
        duration: "30-60 seconds",
        aspect_ratio: "9:16",
        sequence: [
          {
            stage: "Stage 1 — Void Awakening",
            description: `The video opens in absolute darkness. A single point of warm light (#FFD700) ignites at the center of frame and begins pulsing outward. Microscopic golden particles emerge from the light source, swirling in slow-motion spiral patterns. The particles gradually increase in density, creating a galaxy-like formation that hints at the shape of the ${pName}. Each particle catches rim light as it travels, creating thousands of tiny flares across the dark void.`,
            camera: { movement: "Static centered, then slow push-in from 2m to 1m over 6 seconds", framing: "Wide establishing shot, f/2.8, center-weighted", speed: "0.3x slow-motion" },
            lighting: "Single warm point light (3200K) expanding outward, no fill, absolute black surroundings",
            environment: "Pure black void, no reflective surfaces, floating particles only",
            vfx: "Golden particle swirl (10000+ particles), volumetric light cone expanding, subtle lens flare at light source center",
            duration: "8 seconds"
          },
          {
            stage: "Stage 2 — Particle Convergence",
            description: `The swirling particles begin accelerating toward a central point, converging from all directions. As they collide and merge, the solid form of the ${pName} begins materializing piece by piece — edges first, then surfaces filling in like a 3D print building layer by layer. Blue energy ripples (#00A8FF) pulse across each newly formed surface. The product's materials become visible as they solidify: brushed metal catches the light differently than matte black sections.`,
            camera: { movement: "Slow orbit begins, 15°/sec clockwise, rising from eye-level to 30° above", framing: "Medium shot tightening to medium-close, f/1.8, shallow DOF", speed: "0.5x transitioning to real-time" },
            lighting: "Cool blue key light (5600K) from upper right, warm rim light (3200K) from behind-left, ratio 3:1",
            environment: "Dark void transitioning to subtle dark gradient floor reflection appearing below product",
            vfx: "Particle convergence with blue energy pulses on surface formation, material texture reveal effect, micro-sparks at convergence points",
            duration: "8 seconds"
          },
          {
            stage: "Stage 3 — Full Reveal Orbit",
            description: `The ${pName} is now fully formed and floating at center frame. The camera continues its orbit, now revealing the complete product from every angle. As each face comes into view, specific details are highlighted: the brand logo catches a rim light flare, surface textures shift between glossy and matte as the viewing angle changes, ports and connectors create geometric shadow patterns. The product rotates slowly on its own axis counter to the camera's orbit, creating a dynamic dual-rotation showcase. Volumetric light rays sweep across the scene from behind.`,
            camera: { movement: "Continuous 360° orbit at 20°/sec, maintaining 0.8m distance, height oscillates ±10°", framing: "Medium shot, f/2.0, product fills 60% of frame, focus tracks product surface", speed: "Real-time" },
            lighting: "Three-point setup: key 45° upper-right (5000K), fill 30° left (4200K at 40% intensity), strong rim backlight (6000K). Volumetric fog at 15% density",
            environment: "Reflective dark glass floor showing product underside reflection, dark gradient backdrop (#0a0a1a to #000000), subtle ambient particles",
            vfx: "Rim light flares on edges, surface material reflections, volumetric god-rays sweeping left-to-right, subtle lens dust particles",
            duration: "10 seconds"
          },
          {
            stage: "Stage 4 — Macro Detail Exploration",
            description: `The camera breaks from its orbit and begins a smooth dolly push-in toward the ${pName}'s most distinctive feature. As it approaches extreme close-up range, surface textures become dramatically visible — every grain of brushed metal, every pixel of printed text, the precise machining lines and tolerances. The focus racks slowly between the nearest surface detail and the product edge behind, creating cinematic depth. Warm accent light slides across the surface left-to-right, revealing micro-textures and material quality. A subtle reflection of the studio lights glides across any glossy surfaces.`,
            camera: { movement: "Smooth dolly push-in from medium to extreme macro over 6 seconds, then slow lateral slide right", framing: "Extreme close-up, f/1.4, shallow DOF with rack focus, product surface fills 90% of frame", speed: "0.7x slight slow-motion" },
            lighting: "Warm moving accent (3500K) sweeping left-to-right, cool static fill from above (5500K at 20%), strong separation backlight",
            environment: "Completely out of focus background, all attention on surface detail, bokeh circles from rim lights",
            vfx: "Surface texture enhancement, light sweep reflection, focus rack animation, micro dust particles in DOF bokeh",
            duration: "8 seconds"
          },
          {
            stage: "Stage 5 — Dynamic Feature Showcase",
            description: `The camera pulls back rapidly to a medium-wide shot as the ${pName} begins a dramatic slow rotation on a vertical axis. During the rotation, transparent holographic info-graphic elements appear floating beside the product, highlighting key features with clean lines connecting to specific product areas. The product pauses at its most photogenic angle as each feature callout animates in. Energy lines pulse along the product's edges in the brand's color scheme. The entire scene has a tech-forward, premium feel with the product commanding absolute attention.`,
            camera: { movement: "Quick pull-out to medium-wide, then steady hold with subtle 2% zoom pulse", framing: "Medium-wide, f/2.8, product centered with space for floating UI elements, 16:9 safe area", speed: "Pull-out at 2x speed, then real-time hold" },
            lighting: "Dramatic split-lighting: cool blue left (6500K), warm amber right (2800K). Rim light intensifies during rotation. Subtle under-glow from reflective floor",
            environment: "Dark reflective floor, abstract gradient backdrop, floating holographic UI elements in product's color scheme",
            vfx: "Holographic feature callouts (thin lines, minimal text), edge energy pulses, rotation motion blur trails, ambient particle field",
            duration: "8 seconds"
          },
          {
            stage: "Stage 6 — Atmospheric Hero Landing",
            description: `The holographic elements dissolve into particles. The ${pName} slowly descends and settles onto the reflective surface with a satisfying subtle impact — a ring of light ripples outward from the landing point across the floor. The camera smoothly pulls back and rises to a classic hero angle (30° above, slightly off-center). A gradient glow (#FFD700 to #FF6B00) builds behind the product, creating a warm halo effect. The product does one final quarter-rotation to its hero angle as clean typography fades in above: the short product name in a modern sans-serif font, followed by a subtle tagline below.`,
            camera: { movement: "Slow pull-out and rise to 30° hero angle, final position 1.5m from product, gentle ease-out deceleration", framing: "Hero composition, rule-of-thirds with product slightly below center, f/2.8, deep focus", speed: "0.8x elegant slow-motion" },
            lighting: "Warm gradient backlight building in intensity, soft key from above (4500K), floor reflection catch-light, final clean even illumination",
            environment: "Reflective dark surface with light ripple effect, warm gradient backdrop building from black to golden amber, clean and minimal",
            vfx: "Floor light ripple from landing, gradient glow build, text fade-in animation (0.5s ease), particle dissolve from previous stage, subtle lens bloom on backlight",
            duration: "10 seconds"
          }
        ],
        color_palette: ["#000000", "#FFD700", "#00A8FF", "#1a1a2e"],
        mood: "Begins mysterious and dark, builds through technical awe, resolves into confident premium elegance. The emotional arc mirrors unboxing a luxury product for the first time.",
        music_style: "Deep electronic ambient: 85 BPM, sub-bass foundation, minimal synth pads building slowly, crystalline arpeggios entering at stage 3, bass drop at landing moment, resolving to warm pad chord",
        sound_design: "Stage 1: deep sub-rumble building. Stage 2: crystalline particle chimes, electric crackle on convergence. Stage 3: smooth whoosh on orbit, subtle material sounds. Stage 4: intimate close-up ambiance, fabric/metal texture sounds. Stage 5: tech UI sounds for callouts, energy pulse hum. Stage 6: satisfying impact thud with reverb, light ripple shimmer, typography whoosh",
        text_overlays: [
          { time: "48s", text: pName, style: "32px Inter/Helvetica, white, fade-in 0.5s ease, center-top third" },
          { time: "50s", text: "Redefine Performance", style: "18px Inter Light, #CCCCCC, fade-in 0.3s ease, below title" }
        ],
        veo3_video_prompt: `A cinematic video advertisement showing a ${pName} with premium industrial design, featuring brushed metal surfaces and matte black accents. The video opens in complete darkness as a single warm golden light ignites and thousands of golden particles begin swirling in slow-motion spiral patterns. The particles gradually accelerate and converge, materializing the product piece by piece with blue energy ripples pulsing across each newly formed surface. Once fully formed, the camera begins a smooth continuous 360-degree orbit around the floating product at a distance of 0.8 meters, revealing every angle as volumetric light rays sweep through the scene from behind. The camera then pushes in for extreme macro close-ups gliding across the surface textures — every grain of brushed metal, every printed logo, every machining line becomes dramatically visible as warm accent light slides left-to-right across the surface. Pulling back to a medium-wide shot, the product performs a dramatic slow rotation while transparent holographic feature callouts appear beside it. The product then descends and settles onto a reflective dark surface with a satisfying impact, sending a ring of light rippling outward across the floor. The camera rises to a 30-degree hero angle as a warm golden gradient glow builds behind the product, and clean modern typography fades in above. The lighting transitions from a single point source through dramatic three-point studio lighting to warm gradient backlighting, while the mood evolves from mysterious darkness through technical showcase to confident premium elegance. Total duration 30-60 seconds with continuous fluid camera motion throughout.`
      }, null, 2);
      return res.json({ success: true, prompt: fallback });
    }

    const styleDescs = {
      apple: 'Apple-style clean minimalist advert with white backgrounds, elegant smooth camera movements, floating product shots, and premium feel',
      cinematic: 'cinematic epic advert with dramatic slow-motion, deep depth of field, volumetric lighting, dark moody atmosphere with spotlight on the product',
      energetic: 'fast-paced energetic TikTok/Reels style advert with quick cuts, dynamic movements, vibrant colors, particles and motion graphics',
      luxury: 'luxury premium advert with gold and black palette, reflective surfaces, macro detail shots, silk textures, slow rotating showcase'
    };
    const styleDesc = styleDescs[style] || styleDescs.apple;

    const parts = [];

    if (imageUrl) {
      try {
        const axios = require('axios');
        const imgResponse = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const base64 = Buffer.from(imgResponse.data).toString('base64');
        const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';
        parts.push({ inlineData: { mimeType, data: base64 } });
      } catch (e) {
        console.log('Failed to download product image for Veo prompt:', e.message);
      }
    }

    const hasImage = parts.length > 0;

    const jsonStructure = `{
  "product_short_name": "[SHORT brand+model name, max 4 words, e.g. 'Netac NVMe M.2 SSD']",
  "product_appearance": "[VERY DETAILED physical description: exact dimensions/proportions, precise colors with hex if possible, material types (matte aluminum, glossy plastic, brushed metal, rubber grip, etc.), surface textures, visible labels/logos with their exact position, ports/connectors, LED indicators, heatsink fins count/shape, PCB edges if visible, packaging elements — describe as if writing for a 3D artist who must recreate this product perfectly]",
  "title": "[Short Product Name] — [Style] Video Ad",
  "style": "[Cinematic/Minimalist/Energetic/Luxury], [detailed style description]",
  "duration": "30-60 seconds",
  "aspect_ratio": "9:16",
  "sequence": [
    {
      "stage": "Stage 1 — [Stage Name]",
      "description": "[RICH VIDEO scene description, minimum 3 sentences. Describe: what is physically happening frame-by-frame, how the product moves/rotates/transforms, particle effects with specific colors and behaviors, light ray directions and color temperatures, reflections on surfaces, environmental elements. Reference the product's EXACT physical appearance from product_appearance — mention specific materials, colors, textures, logo positions as they catch light or come into view.]",
      "camera": {
        "movement": "[Precise camera path: starting position, trajectory, speed changes, e.g. 'begins at 45° low angle, slowly rises while tracking left at 15°/sec, accelerates into a smooth arc']",
        "framing": "[Exact framing: e.g. 'extreme close-up filling 80% of frame, shallow depth of field at f/1.4, focus rack from logo to heatsink fins']",
        "speed": "[e.g. '0.5x slow-motion for first 2 seconds, then real-time']"
      },
      "lighting": "[Precise lighting setup: key light position/color temp/intensity, fill light, rim/back light, practical lights, volumetric fog density, shadow direction and softness]",
      "environment": "[Background/environment: e.g. 'floating in dark void', 'reflective black glass surface', 'abstract particle field', 'gradient backdrop #1a1a2e to #000']",
      "vfx": "[Visual effects: particle types/colors/behavior, light rays, lens flares, reflections, material reveals, morphing effects]",
      "duration": "[e.g. 5 seconds]"
    }
  ],
  "color_palette": ["[hex1]", "[hex2]", "[hex3]", "[hex4]"],
  "mood": "[detailed mood with emotional progression through the video]",
  "music_style": "[specific music: tempo BPM, instruments, build/drop moments, bass characteristics]",
  "sound_design": "[specific sound effects: whooshes, impacts, risers, bass drops, ambient textures timed to visual moments]",
  "text_overlays": [
    {"time": "[timestamp]", "text": "[SHORT product name only, max 4 words]", "style": "[font, size, animation, position]"}
  ],
  "veo3_video_prompt": "[A DETAILED PARAGRAPH of 8-12 sentences ready to paste into Google Veo 3 for VIDEO generation. Must begin with 'A cinematic video advertisement showing...' and describe: 1) The product's EXACT physical appearance in precise detail (shape, color, material, texture, brand markings), 2) Continuous camera movements throughout the entire video (tracking shots, orbits, push-ins, pull-outs with specific angles), 3) Frame-by-frame visual progression (what happens at each moment), 4) Lighting changes and atmosphere (volumetric rays, rim lighting, color temperature shifts), 5) Particle effects and environmental elements, 6) The emotional arc from dramatic opening to satisfying close. The prompt must make clear this is a MOVING VIDEO with CONTINUOUS MOTION, not a still image. Total video duration 30-60 seconds.]"
}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    let productDescription = '';

    if (hasImage) {
      try {
        const descPrompt = `You are a professional product photographer and 3D artist. Analyze this product image with extreme precision.

Describe EXACTLY what you see in this image. Write a single detailed paragraph covering ALL of these:

1. SHAPE: Exact form factor, proportions (length:width:height ratio), angles, edges (rounded or sharp)
2. COLORS: Every color visible with approximate hex codes — the main body color, accent colors, connector colors, label colors
3. MATERIALS: What each surface is made of — brushed aluminum, matte black plastic, glossy coating, bare copper, gold-plated pins, black PCB (printed circuit board), rubber, etc.
4. BRAND/LOGO: Exact logo design (shape, color, position on product). Describe the logo symbol precisely (e.g. "a white geometric angular 'N' logo centered on the front face")
5. COMPONENTS VISIBLE: Heatsink fins (count, direction, material), M.2 connector pins (gold pins at bottom edge), NAND chips, controller chips, stickers, thermal pads, screws
6. TEXT: Any visible text, model numbers, capacity labels, certification marks and their exact positions
7. OVERALL LOOK: The product's visual identity — is it gaming-style with aggressive angles? Minimal and clean? Industrial? Professional?

Be EXTREMELY specific. A 3D artist must be able to recreate this EXACT product from your description alone — not a generic version, but THIS specific product with its exact logo, exact colors, exact heatsink pattern, exact proportions.

Write ONLY the description paragraph, nothing else.`;

        const descParts = [...parts.filter(p => p.inlineData), { text: descPrompt }];
        const descModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const descResult = await descModel.generateContent(descParts);
        const descResponse = await descResult.response;
        productDescription = descResponse.text().trim();
        console.log('Product description from Gemini:', productDescription.substring(0, 200));
      } catch (descErr) {
        console.log('Failed to get product description:', descErr.message);
      }
    }

    const appearanceInstruction = productDescription
      ? `USE THIS EXACT PRODUCT DESCRIPTION (from image analysis) for "product_appearance" and reference it in ALL scene descriptions and in veo3_video_prompt:\n"""${productDescription}"""\n\nDo NOT write a generic product description. Copy and expand on the description above.`
      : `Write a detailed product_appearance based on what "${productName}" typically looks like.`;

    const textPrompt = hasImage
      ? `You have already analyzed the product image. Here is the precise description of the product:
"""${productDescription}"""

Now generate a HIGHLY DETAILED Google Veo 3 VIDEO advertisement prompt as JSON for this EXACT product. The video should be 30-60 seconds long.

${appearanceInstruction}

CRITICAL RULES:
1. "product_short_name": Max 4 words. Brand + product type only. Example: "Netac NVMe M.2 SSD"
2. "product_appearance": MUST contain the detailed physical description above — include EVERY detail: exact logo design, exact colors with hex codes, exact materials for each surface, exact component layout. A 3D artist must recreate THIS EXACT product from the description.
3. Create 6-8 stages. Each "description" must be 3+ sentences referencing the product's ACTUAL appearance: mention the specific logo, specific heatsink fin pattern, specific material colors, specific connector pins by name. For example: "light sweeps across the brushed black aluminum heatsink revealing 8 vertical fins, then catches the white geometric logo on the front face" — NOT generic "light on product surface".
4. Fill ALL fields: camera (movement, framing, speed), lighting, environment, vfx.
5. "veo3_video_prompt": 8-12 sentences. Start with "A cinematic video advertisement showing a [exact product description with shape, color, material, logo]...". The FIRST 2-3 sentences MUST describe the product's physical appearance in precise detail so Veo 3 renders the CORRECT product. Then describe camera motion, visual progression, lighting. 30-60 seconds of CONTINUOUS VIDEO MOTION.
6. Use SHORT product name everywhere.

The ad style should be: ${styleDesc}

JSON structure (6-8 stages):
${jsonStructure}

- All descriptions in English
- Write ONLY valid JSON, no markdown code blocks, no text before or after`
      : `Generate a HIGHLY DETAILED Google Veo 3 VIDEO advertisement prompt as JSON for: "${productName}"
The video should be 30-60 seconds long.

CRITICAL RULES:
1. "product_short_name": Max 4 words. Example: "Netac NVMe M.2 SSD"
2. "product_appearance": Describe the typical physical appearance of "${productName}" in extreme detail — exact shape, proportions, colors with hex codes, material types, textures, logo design and position, connectors, components. A 3D artist must recreate the product from this description alone.
3. Create 6-8 stages. Each "description" must be 3+ sentences referencing SPECIFIC physical features of the product. NOT generic descriptions.
4. Fill ALL fields: camera, lighting, environment, vfx.
5. "veo3_video_prompt": 8-12 sentences. Start with "A cinematic video advertisement showing a [detailed product appearance]...". First 2-3 sentences describe EXACT product appearance. 30-60 seconds CONTINUOUS VIDEO MOTION.
6. Use SHORT product name everywhere.

The ad style should be: ${styleDesc}

JSON structure (6-8 stages):
${jsonStructure}

- All descriptions in English
- Write ONLY valid JSON, no markdown code blocks, no text before or after`;

    parts.push({ text: textPrompt });

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const result = await model.generateContent(parts);
    const response = await result.response;
    const text = response.text().trim();
    rotateGeminiKey();

    let cleanText = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      const parsed = JSON.parse(cleanText);
      if (parsed.product_short_name && parsed.product_short_name.split(/\s+/).length > 6) {
        parsed.product_short_name = parsed.product_short_name.split(/\s+/).slice(0, 5).join(' ');
      }
      if (parsed.title && parsed.title.length > 60) {
        parsed.title = `${parsed.product_short_name || 'Product'} — Video Ad`;
      }
      if (parsed.text_overlays && Array.isArray(parsed.text_overlays)) {
        parsed.text_overlays = parsed.text_overlays.map(o => {
          if (o.text && o.text.split(/\s+/).length > 8) {
            o.text = parsed.product_short_name || o.text.split(/\s+/).slice(0, 5).join(' ');
          }
          return o;
        });
      }
      cleanText = JSON.stringify(parsed, null, 2);
    } catch (e) {}

    res.json({ success: true, prompt: cleanText });
  } catch (error) {
    console.log('Veo prompt error:', error.message);
    const rawName = req.body?.productName || 'Product';
    const pName = rawName.split(/\s+/).slice(0, 4).join(' ');
    const selStyle = req.body?.style || 'apple';
    const catchStyleNames = { apple: 'Apple-style clean minimalist', cinematic: 'cinematic dramatic slow-motion', energetic: 'fast-paced energetic TikTok style', luxury: 'luxury premium gold and black' };
    const catchStyleLbl = catchStyleNames[selStyle] || catchStyleNames.apple;
    const fallback = JSON.stringify({
      product_short_name: pName,
      product_appearance: `A premium ${pName} with modern industrial design, clean lines, brushed metal and matte black surfaces.`,
      title: `${pName} — ${catchStyleLbl} Video Ad`,
      style: `Cinematic, ${catchStyleLbl}`,
      duration: "30-60 seconds",
      aspect_ratio: "9:16",
      sequence: [
        {
          stage: "Stage 1 — Void Awakening",
          description: `The video opens in absolute darkness. A single warm golden light ignites at center frame, pulsing outward. Thousands of golden particles emerge, swirling in slow-motion spirals that gradually form the silhouette of the ${pName}. Each particle catches rim light creating tiny flares across the void. The density builds until the product shape is unmistakable.`,
          camera: { movement: "Static centered, slow push-in from 2m to 1m", framing: "Wide establishing, f/2.8", speed: "0.3x slow-motion" },
          lighting: "Single warm point light (3200K) expanding, absolute black surroundings",
          environment: "Pure black void, floating golden particles only",
          vfx: "Golden particle swirl, volumetric light cone, lens flare at center",
          duration: "8 seconds"
        },
        {
          stage: "Stage 2 — Particle Convergence",
          description: `The particles accelerate inward from all directions, converging at center. The solid form of the ${pName} materializes piece by piece — edges first, then surfaces filling in layer by layer. Blue energy ripples pulse across each newly formed surface. Materials become visible as they solidify: brushed metal catches light differently than matte sections.`,
          camera: { movement: "Slow orbit begins, 15°/sec clockwise, rising from eye-level to 30° above", framing: "Medium to medium-close, f/1.8, shallow DOF", speed: "0.5x to real-time" },
          lighting: "Cool blue key (5600K) upper right, warm rim (3200K) behind-left",
          environment: "Dark void with gradient floor reflection appearing",
          vfx: "Particle convergence, blue energy surface pulses, micro-sparks at merge points",
          duration: "8 seconds"
        },
        {
          stage: "Stage 3 — Full Reveal Orbit",
          description: `The ${pName} floats fully formed at center. The camera orbits 360°, revealing every angle. The brand logo catches rim light flare, surface textures shift between glossy and matte with viewing angle. The product counter-rotates slowly on its axis. Volumetric light rays sweep from behind, creating dramatic depth.`,
          camera: { movement: "Continuous 360° orbit at 20°/sec, 0.8m distance, height oscillates ±10°", framing: "Medium, f/2.0, product fills 60%", speed: "Real-time" },
          lighting: "Three-point: key 45° upper-right (5000K), fill 30° left (4200K 40%), strong rim backlight (6000K), volumetric fog 15%",
          environment: "Reflective dark glass floor, gradient backdrop #0a0a1a to #000, ambient particles",
          vfx: "Rim light edge flares, surface reflections, volumetric god-rays, lens dust",
          duration: "10 seconds"
        },
        {
          stage: "Stage 4 — Macro Detail Exploration",
          description: `Camera pushes into extreme close-up, gliding across the ${pName}'s surface. Every grain of brushed metal, every printed character becomes visible. Focus racks slowly between nearest surface and product edge behind. Warm accent light slides left-to-right revealing micro-textures and material quality.`,
          camera: { movement: "Smooth dolly push-in to extreme macro, then slow lateral slide", framing: "Extreme close-up f/1.4, rack focus, surface fills 90%", speed: "0.7x slight slow-motion" },
          lighting: "Warm moving accent (3500K) sweeping L-R, cool static fill above (5500K 20%), separation backlight",
          environment: "Out of focus background, bokeh circles from rim lights",
          vfx: "Surface texture enhancement, light sweep reflection, focus rack, bokeh particles",
          duration: "8 seconds"
        },
        {
          stage: "Stage 5 — Feature Showcase",
          description: `Camera pulls back rapidly to medium-wide as the ${pName} begins dramatic slow rotation. Transparent holographic callouts appear, highlighting key features with clean lines connecting to product areas. Energy lines pulse along edges. The scene feels tech-forward and premium.`,
          camera: { movement: "Quick pull-out to medium-wide, steady hold with subtle 2% zoom pulse", framing: "Medium-wide f/2.8, space for UI elements", speed: "Pull-out 2x, then real-time" },
          lighting: "Split-lighting: cool blue left (6500K), warm amber right (2800K), rim intensifies, under-glow from floor",
          environment: "Dark reflective floor, abstract gradient, floating holographic UI elements",
          vfx: "Holographic callouts, edge energy pulses, rotation motion blur trails, ambient particle field",
          duration: "8 seconds"
        },
        {
          stage: "Stage 6 — Hero Landing",
          description: `Holographic elements dissolve to particles. The ${pName} descends slowly to the reflective surface — on impact, a ring of light ripples outward across the floor. Camera pulls back and rises to 30° hero angle. Warm golden gradient builds behind the product. One final quarter-rotation to hero angle, then clean modern typography fades in above.`,
          camera: { movement: "Slow pull-out and rise to 30° hero angle, 1.5m from product, ease-out deceleration", framing: "Hero composition, rule-of-thirds, f/2.8 deep focus", speed: "0.8x elegant slow-motion" },
          lighting: "Warm gradient backlight building, soft key from above (4500K), floor reflection catch-light",
          environment: "Reflective dark surface with light ripple, warm gradient backdrop black to golden amber",
          vfx: "Floor light ripple, gradient glow build, text fade-in 0.5s ease, particle dissolve, subtle lens bloom",
          duration: "10 seconds"
        }
      ],
      color_palette: ["#000000", "#FFD700", "#00A8FF", "#1a1a2e"],
      mood: "Mysterious darkness building through technical awe to confident premium elegance",
      music_style: "Deep electronic ambient, 85 BPM, sub-bass foundation, minimal synth pads building, crystalline arpeggios at stage 3, bass drop at landing",
      sound_design: "Sub-rumble building → crystalline particle chimes → smooth orbit whoosh → intimate texture sounds → tech UI sounds → impact thud with reverb and shimmer",
      text_overlays: [
        { time: "48s", text: pName, style: "32px Inter, white, fade-in 0.5s, center-top third" },
        { time: "50s", text: "Redefine Performance", style: "18px Inter Light, #CCC, fade-in below title" }
      ],
      veo3_video_prompt: `A cinematic video advertisement showing a ${pName} with premium industrial design featuring brushed metal surfaces and matte black accents. The video opens in complete darkness as a single warm golden light ignites and thousands of golden particles begin swirling in slow-motion spiral patterns, gradually forming the product's silhouette. The particles then accelerate inward from all directions, converging and materializing the product piece by piece with blue energy ripples pulsing across each newly formed surface as materials solidify. Once fully formed and floating, the camera begins a smooth continuous 360-degree orbit revealing every angle, with the product counter-rotating slowly on its own axis while volumetric light rays sweep through the scene. The camera then pushes in for extreme macro close-ups, gliding across the surface where every grain of brushed metal and every printed logo becomes dramatically visible as warm accent light slides across the textures. Pulling back to medium-wide, the product performs a dramatic slow rotation while transparent holographic feature callouts appear alongside it with energy lines pulsing along its edges. Finally the product descends to a reflective dark surface with a satisfying impact sending a ring of light rippling outward across the floor. The camera rises to a 30-degree hero angle as a warm golden gradient glow builds behind the product and clean modern typography fades in above. The lighting evolves from a single point source through dramatic three-point studio setup to warm gradient backlighting, while the mood transitions from mysterious darkness through technical showcase to confident premium elegance. Total duration 30-60 seconds with continuous fluid camera motion and seamless transitions throughout the entire video.`
    }, null, 2);
    res.json({ success: true, prompt: fallback });
  }
});

app.get('/api/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL required');

    const allowedHosts = [
      'ae01.alicdn.com', 'ae02.alicdn.com', 'ae03.alicdn.com', 'ae04.alicdn.com',
      'img.alicdn.com', 'cbu01.alicdn.com', 'gw.alicdn.com',
      'i.aliimg.com', 's.alicdn.com',
      'ae-pic-a1.aliexpress-media.com',
      'cloud.video.taobao.com'
    ];

    let parsedUrl;
    try {
      parsedUrl = new URL(imageUrl);
    } catch (e) {
      return res.status(400).send('Invalid URL');
    }

    if (parsedUrl.protocol !== 'https:' || !allowedHosts.some(h => parsedUrl.hostname === h || parsedUrl.hostname.endsWith('.' + h))) {
      return res.status(403).send('Domain not allowed');
    }

    const axios = require('axios');
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(403).send('Not an image');
    }

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(response.data);
  } catch (error) {
    res.status(500).send('Image proxy error');
  }
});

// Auto-start spy if it was enabled
(async () => {
  try {
    const spyConfig = await loadSpyConfigCached();
    if (spyConfig.enabled && spyConfig.apiId) {
      console.log('🕵️ إعادة تشغيل نظام التجسس تلقائياً...');
      await startSpy(spyConfig);
    }
  } catch (e) {
    console.log('⚠️ فشل تشغيل نظام التجسس تلقائياً:', e.message);
  }
})();

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});
