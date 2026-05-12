// إطار مبني على القالب المُرفق (بطاقة بيضاء + تبويبة + شعار) + لمسات صفراء + بطاقة سعر صفراء
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const TEMPLATE = path.join(__dirname, '..', 'public', 'base_frame_template.png');
const YELLOW = '#FFC424';
const YELLOW_DARK = '#E5A800';
const BLACK = '#0F0F1A';

// Geometry: المنتج يحتل المنطقة الوسطى الكبيرة من البطاقة البيضاء
// innerLeft=10%, innerTop=18%, innerW=80%, innerH=58% → spy.js

(async () => {
  if (!fs.existsSync(TEMPLATE)) {
    console.error('❌ القالب غير موجود:', TEMPLATE);
    process.exit(1);
  }

  const tplMeta = await sharp(TEMPLATE).metadata();
  const SIZE = tplMeta.width;
  console.log(`📐 حجم القالب: ${SIZE}x${tplMeta.height}`);

  // ░░░ طبقة الزخارف الصفراء ░░░
  const overlaySvg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <!-- ░░░ منحنى أصفر علوي يسار (رفيع وأنيق) ░░░ -->
  <path d="M 30 30 H 380 Q 200 200 30 320 Z" fill="${YELLOW}" opacity="0.95"/>
  
  <!-- ░░░ منحنى أصفر سفلي يمين ░░░ -->
  <path d="M ${SIZE-30} ${SIZE-180} H ${SIZE-380} Q ${SIZE-200} ${SIZE-360} ${SIZE-30} ${SIZE-480} Z" fill="${YELLOW}" opacity="0.95"/>

  <!-- ░░░ بطاقة السعر الصفراء (مكان لكتابة السعر ديناميكياً) ░░░ -->
  <!-- ظل خفيف -->
  <rect x="58" y="382" width="340" height="160" rx="30" fill="${BLACK}" opacity="0.15"/>
  <!-- البطاقة الصفراء -->
  <rect x="50" y="375" width="340" height="160" rx="30" fill="${YELLOW}" stroke="${BLACK}" stroke-width="6"/>
  <!-- تسمية صغيرة "PRICE" أعلى البطاقة -->
  <rect x="80" y="358" width="120" height="36" rx="18" fill="${BLACK}"/>
  <text x="140" y="383" font-family="Arial Black, sans-serif" font-size="20" font-weight="900" fill="${YELLOW}" text-anchor="middle" letter-spacing="3">PRICE</text>
  <!-- علامة نجمة زخرفية في زاوية البطاقة -->
  <text x="355" y="418" font-family="Arial Black, sans-serif" font-size="40" font-weight="900" fill="${BLACK}">★</text>
</svg>`;

  const baseBuf = await sharp(TEMPLATE).png().toBuffer();
  const overlayBuf = await sharp(Buffer.from(overlaySvg)).png().toBuffer();

  const composedBuf = await sharp(baseBuf)
    .composite([{ input: overlayBuf, left: 0, top: 0, blend: 'over' }])
    .jpeg({ quality: 94, background: { r: 255, g: 255, b: 255 } })
    .toBuffer();

  const outPath = path.join(__dirname, '..', 'public', 'custom_frame.jpg');
  fs.writeFileSync(outPath, composedBuf);
  console.log('✅ Built frame from template + yellow accents + price tag');

  // ░░░ معاينة مع منتج وهمي + سعر ديناميكي ░░░
  const { overlayPrice } = require(path.join(__dirname, '..', 'imageProcessor.js'));

  const productSvg = `<svg width="700" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="700" height="600" fill="none"/>
    <circle cx="350" cy="300" r="240" fill="#1F2937"/>
    <text x="350" y="290" font-family="Arial Black" font-size="56" font-weight="900" fill="white" text-anchor="middle">PRODUCT</text>
    <text x="350" y="350" font-family="Arial" font-size="28" fill="#9CA3AF" text-anchor="middle">(transparent bg)</text>
  </svg>`;
  const productBuf = await sharp(Buffer.from(productSvg)).png().toBuffer();

  // المنتج: 36% left, 12% top, 60% wide, 60% tall (يتجنّب بطاقة السعر اليسرى)
  const innerLeft = Math.round(SIZE * 0.36);
  const innerTop = Math.round(SIZE * 0.12);
  const innerW = Math.round(SIZE * 0.60);
  const innerH = Math.round(SIZE * 0.60);
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

  // السعر اليدوي داخل البطاقة الصفراء (top-left ~ x=80, y=420)
  preview = await overlayPrice(preview, '16.5', { x: 80, y: 410, fontSize: 110, color: BLACK, accent: '#E63946' });

  await sharp(preview).jpeg({ quality: 92 }).toFile(path.join(__dirname, '..', 'public', 'preview_yellow.jpg'));
  console.log('✅ Preview saved');
})().catch(e => { console.error(e); process.exit(1); });
