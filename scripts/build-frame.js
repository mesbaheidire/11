// إطار أنيق نهائي: قالب أبيض + منحنيات ربعية صفراء + بطاقة سعر صغيرة فوق الشعار
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const TEMPLATE = path.join(__dirname, '..', 'public', 'base_frame_template.png');
const YELLOW = '#FFC424';
const YELLOW_LIGHT = '#FFD960';
const YELLOW_DARK = '#E5A800';
const BLACK = '#0F0F1A';

(async () => {
  const tplMeta = await sharp(TEMPLATE).metadata();
  const SIZE = tplMeta.width;
  console.log(`📐 حجم القالب: ${SIZE}x${tplMeta.height}`);

  // بطاقة السعر: أصغر، فوق شعار AliOffersDz
  const PRICE_W = 240;
  const PRICE_H = 90;
  const PRICE_X = (SIZE - PRICE_W) / 2;
  const PRICE_Y = SIZE - 290;  // مسافة كافية فوق الشعار

  const overlaySvg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gradTL" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${YELLOW_LIGHT}"/>
      <stop offset="100%" stop-color="${YELLOW}"/>
    </linearGradient>
    <linearGradient id="gradBR" x1="100%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="${YELLOW_LIGHT}"/>
      <stop offset="100%" stop-color="${YELLOW}"/>
    </linearGradient>
    <linearGradient id="gradPrice" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${YELLOW_LIGHT}"/>
      <stop offset="100%" stop-color="${YELLOW}"/>
    </linearGradient>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
      <feOffset dx="0" dy="4" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- ░░░ منحنى ربعي علوي يسار (نظيف ومنحني) ░░░ -->
  <path d="M 30 30 H 360 Q 360 360 30 360 Z" fill="url(#gradTL)"/>
  <path d="M 30 30 H 360 Q 360 360 30 360 Z" fill="none" stroke="${YELLOW_DARK}" stroke-width="2" opacity="0.5"/>

  <!-- ░░░ منحنى ربعي سفلي يمين (مرآة) ░░░ -->
  <path d="M ${SIZE-30} ${SIZE-30} H ${SIZE-360} Q ${SIZE-360} ${SIZE-360} ${SIZE-30} ${SIZE-360} Z" fill="url(#gradBR)"/>
  <path d="M ${SIZE-30} ${SIZE-30} H ${SIZE-360} Q ${SIZE-360} ${SIZE-360} ${SIZE-30} ${SIZE-360} Z" fill="none" stroke="${YELLOW_DARK}" stroke-width="2" opacity="0.5"/>

  <!-- نقاط زخرفية خفيفة -->
  <circle cx="400" cy="60" r="5" fill="${YELLOW}"/>
  <circle cx="60" cy="400" r="5" fill="${YELLOW}"/>
  <circle cx="${SIZE-400}" cy="${SIZE-60}" r="5" fill="${YELLOW}"/>
  <circle cx="${SIZE-60}" cy="${SIZE-400}" r="5" fill="${YELLOW}"/>

  <!-- ░░░ بطاقة السعر الصغيرة الأنيقة ░░░ -->
  <g filter="url(#cardShadow)">
    <rect x="${PRICE_X}" y="${PRICE_Y}" width="${PRICE_W}" height="${PRICE_H}" rx="${PRICE_H/2}"
          fill="url(#gradPrice)" stroke="${YELLOW_DARK}" stroke-width="3"/>
  </g>
</svg>`;

  const baseBuf = await sharp(TEMPLATE).png().toBuffer();
  const overlayBuf = await sharp(Buffer.from(overlaySvg)).png().toBuffer();

  const composedBuf = await sharp(baseBuf)
    .composite([{ input: overlayBuf, left: 0, top: 0, blend: 'over' }])
    .jpeg({ quality: 94, background: { r: 255, g: 255, b: 255 } })
    .toBuffer();

  const outPath = path.join(__dirname, '..', 'public', 'custom_frame.jpg');
  fs.writeFileSync(outPath, composedBuf);
  console.log('✅ Built clean frame with elegant quarter-curves + small price pill');

  // ░░░ معاينة ░░░
  const { overlayPrice } = require(path.join(__dirname, '..', 'imageProcessor.js'));

  const productSvg = `<svg width="700" height="500" xmlns="http://www.w3.org/2000/svg">
    <circle cx="350" cy="250" r="200" fill="#1F2937"/>
    <text x="350" y="240" font-family="Arial Black" font-size="50" font-weight="900" fill="white" text-anchor="middle">PRODUCT</text>
    <text x="350" y="290" font-family="Arial" font-size="24" fill="#9CA3AF" text-anchor="middle">(transparent)</text>
  </svg>`;
  const productBuf = await sharp(Buffer.from(productSvg)).png().toBuffer();

  // المنتج: 12% top, 55% tall (يتوقّف قبل بطاقة السعر)
  const innerLeft = Math.round(SIZE * 0.10);
  const innerTop = Math.round(SIZE * 0.10);
  const innerW = Math.round(SIZE * 0.80);
  const innerH = Math.round(SIZE * 0.55);
  const resizedProduct = await sharp(productBuf).resize(innerW, innerH, { fit: 'inside' }).toBuffer();
  const meta = await sharp(resizedProduct).metadata();
  const offX = innerLeft + Math.round((innerW - meta.width) / 2);
  const offY = innerTop + Math.round((innerH - meta.height) / 2);

  let preview = await sharp(outPath)
    .composite([{ input: resizedProduct, left: offX, top: offY, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();

  // السعر داخل البطاقة الصغيرة (مركز البطاقة)
  // البطاقة 240x90 — السعر بحجم 56 يتمركز
  preview = await overlayPrice(preview, '16.5', {
    x: PRICE_X + 50,
    y: PRICE_Y + 8,
    fontSize: 60,
    color: BLACK,
    accent: '#E63946'
  });

  await sharp(preview).jpeg({ quality: 92 }).toFile(path.join(__dirname, '..', 'public', 'preview_yellow.jpg'));
  console.log('✅ Preview saved');
})().catch(e => { console.error(e); process.exit(1); });
