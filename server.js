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

const { loadConfig: loadSpyConfig, saveConfig: saveSpyConfig, startSpy, stopSpy, getStatus: getSpyStatus, loadLog: loadSpyLog, sendLoginCode, verifyCode } = require('./spy');

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

app.get('/api/gemini-status', (req, res) => {
  try {
    const data = loadGeminiKeys();
    const envKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    const totalKeys = data.keys.length + (envKey ? 1 : 0);
    
    res.json({
      success: true,
      count: data.keys.length,
      currentIndex: data.currentIndex,
      hasEnvKey: !!envKey,
      totalAvailable: totalKeys
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
      return response.text().trim();
    } catch (error) {
      const errorMsg = error.message || '';
      // Check if it's a quota error
      if (errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('403') || errorMsg.includes('leaked') || errorMsg.includes('Forbidden')) {
        console.log(`⚠️ Gemini quota exceeded on attempt ${attempt + 1}, rotating key...`);
        if (rotateGeminiKey()) {
          continue; // Try with next key
        }
      }
      // If last attempt or non-quota error, throw
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
    const cookies = credentials?.cook || process.env.cook;
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
    const botToken = credentials?.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
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
    
    const botToken = credentials?.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
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
        prompt = `
        Refine the following AliExpress product title to be attractive and professional for an English-speaking audience.
        Requirements:
        1. Keep it in English.
        2. Keep it short and concise (3-6 words).
        3. Remove junk words (Global Version, 2024, 2025, Free Shipping, etc.).
        4. Focus on the core product name.
        5. Start with a relevant emoji.
        
        Original Title: ${title}
        Result: (Refined title only)
      `;
      }
      
      // Use rotation-enabled function
      const rawResult = await runGeminiWithRotation(prompt);
      const refinedTitle = rawResult.replace(/^(هوك مقترح|المقدمة|النتيجة|العنوان|Refined Title):/i, '').split('\n')[0].trim();
      res.json({ success: true, refinedTitle: refinedTitle.replace(/[*#]/g, '') || title, method: 'ai' });
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
        extracted = String(extracted).replace(/[*#]/g, '').trim();
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

app.get('/api/spy/status', (req, res) => {
  try {
    const status = getSpyStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/config', (req, res) => {
  try {
    const stored = loadSpyConfig();
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
    saveSpyConfig(config);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/start', async (req, res) => {
  try {
    const stored = loadSpyConfig();
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
    saveSpyConfig(config);
    await startSpy(config);
    res.json({ success: true, message: 'تم تشغيل نظام التجسس' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/stop', async (req, res) => {
  try {
    await stopSpy();
    res.json({ success: true, message: 'تم إيقاف نظام التجسس' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/spy/log', (req, res) => {
  try {
    const log = loadSpyLog();
    res.json({ success: true, log });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/send-code', async (req, res) => {
  try {
    const config = req.body;
    saveSpyConfig(config);
    const result = await sendLoginCode(config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spy/verify-code', async (req, res) => {
  try {
    const { code, password } = req.body;
    const config = loadSpyConfig();
    const result = await verifyCode(config, code, password);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto-start spy if it was enabled
(async () => {
  try {
    const spyConfig = loadSpyConfig();
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
