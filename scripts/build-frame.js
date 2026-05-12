// إطار نظيف بأسلوب RT DEALS — أبيض + منحنيين أصفرين + اسم القناة فوق + سعر يدوي يسار
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZE = 1080;
const YELLOW = '#FFC424';
const BLACK = '#0F0F1A';

// Geometry: المنتج في النصف الأيمن
// innerLeft=38%, innerTop=15%, innerW=58%, innerH=68% → spy.js
// السعر اليدوي يسار-وسط → drawn dynamically

const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <!-- خلفية بيضاء نقية -->
  <rect width="${SIZE}" height="${SIZE}" fill="white"/>

  <!-- ░░░ منحنى أصفر علوي يسار ░░░ -->
  <!-- يبدأ من زاوية أعلى يسار، يسحب لليمين ~430px ثم ينحني للأسفل عائداً للحافة اليسرى -->
  <path d="M 0 0 H 440 Q 240 200 0 360 Z" fill="${YELLOW}"/>
  
  <!-- ░░░ منحنى أصفر سفلي يمين (مرآة) ░░░ -->
  <path d="M ${SIZE} ${SIZE} H ${SIZE-440} Q ${SIZE-240} ${SIZE-200} ${SIZE} ${SIZE-360} Z" fill="${YELLOW}"/>

  <!-- ░░░ هيدر: اسم القناة + أيقونة برق ░░░ -->
  <!-- اسم القناة كبير وسط الأعلى -->
  <text x="${SIZE/2 - 60}" y="80" font-family="Arial Black, sans-serif" font-size="62" font-weight="900" fill="${BLACK}" text-anchor="middle" letter-spacing="-1">AliOffersDz</text>
  
  <!-- دائرة صفراء مع برق أسود (مكان شعار البرق في RT DEALS) -->
  <g transform="translate(${SIZE/2 + 200}, 50)">
    <circle cx="35" cy="35" r="35" fill="${YELLOW}" stroke="${BLACK}" stroke-width="3"/>
    <!-- برق أسود -->
    <path d="M 38 12 L 22 38 L 32 38 L 28 58 L 48 30 L 38 30 L 42 12 Z" fill="${BLACK}"/>
  </g>
</svg>`;

(async () => {
  const outPath = path.join(__dirname, '..', 'public', 'custom_frame.jpg');
  const baseFrame = await sharp(Buffer.from(svg)).png().toBuffer();
  await sharp(baseFrame).jpeg({ quality: 94 }).toFile(outPath);
  console.log('✅ Built clean RT-DEALS-style frame');

  // ░░░ معاينة مع منتج وهمي + سعر ديناميكي ░░░
  const { overlayPrice } = require(path.join(__dirname, '..', 'imageProcessor.js'));
  
  // منتج وهمي (سيُستبدل في الإنتاج بصور بدون خلفية)
  const productSvg = `<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">
    <circle cx="300" cy="300" r="240" fill="#1F2937"/>
    <text x="300" y="290" font-family="Arial Black" font-size="50" font-weight="900" fill="white" text-anchor="middle">PRODUCT</text>
    <text x="300" y="340" font-family="Arial" font-size="28" fill="#9CA3AF" text-anchor="middle">(transparent bg)</text>
  </svg>`;
  const productBuf = await sharp(Buffer.from(productSvg)).png().toBuffer();

  // المنتج في النصف الأيمن: innerLeft=38%, innerTop=15%, innerW=58%, innerH=68%
  const innerLeft = Math.round(SIZE * 0.38);
  const innerTop = Math.round(SIZE * 0.15);
  const innerW = Math.round(SIZE * 0.58);
  const innerH = Math.round(SIZE * 0.68);
  const resizedProduct = await sharp(productBuf)
    .resize(innerW, innerH, { fit: 'inside' })
    .toBuffer();
  const meta = await sharp(resizedProduct).metadata();
  const offX = innerLeft + Math.round((innerW - meta.width) / 2);
  const offY = innerTop + Math.round((innerH - meta.height) / 2);

  let preview = await sharp(outPath)
    .composite([{ input: resizedProduct, left: offX, top: offY, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();
  
  // السعر اليدوي يسار-وسط
  preview = await overlayPrice(preview, '16.5', { x: 60, y: 440, fontSize: 150 });
  
  await sharp(preview).jpeg({ quality: 92 }).toFile(path.join(__dirname, '..', 'public', 'preview_yellow.jpg'));
  console.log('✅ Preview saved');
})().catch(e => { console.error(e); process.exit(1); });
