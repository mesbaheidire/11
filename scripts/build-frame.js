// إطار جريء وجذاب — أصفر + أسود + دوائر ملوّنة (بدون نص سعر — السعر ديناميكي)
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZE = 1080;
const YELLOW = '#FFC424';
const YELLOW_DARK = '#E5A800';
const BLACK = '#0F0F1A';
const RED = '#E63946';
const BLUE = '#2563EB';
const GREEN = '#10B981';

// Geometry: white stage from y=180 to y=900 (height 720), x=60 to x=1020 (width 960)
// → innerTop=180/1080≈16.7%, innerHeight=720/1080≈66.7%, innerLeft=60/1080≈5.6%, innerWidth=960/1080≈88.9%

const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dx="0" dy="10" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- خلفية صفراء كاملة -->
  <rect width="${SIZE}" height="${SIZE}" fill="${YELLOW}"/>

  <!-- نمط نقاط زخرفية في الخلفية الصفراء -->
  ${(() => {
    let dots = '';
    for (let i = 0; i < 40; i++) {
      const cx = Math.random() * SIZE;
      const cy = Math.random() * SIZE;
      const r = 2 + Math.random() * 3;
      dots += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(1)}" fill="${BLACK}" opacity="0.08"/>`;
    }
    return dots;
  })()}

  <!-- ░░░ HEADER: شريط علوي مع اسم القناة ░░░ -->
  <!-- شريط أسود علوي رفيع -->
  <rect x="0" y="0" width="${SIZE}" height="14" fill="${BLACK}"/>
  <!-- اسم القناة كبير وأسود -->
  <text x="${SIZE/2}" y="115" font-family="Arial Black, sans-serif" font-size="68" font-weight="900" fill="${BLACK}" text-anchor="middle" letter-spacing="-2">@AliOffersDz</text>
  <!-- خط أحمر تحت الاسم (لمسة رياضية) -->
  <rect x="${SIZE/2 - 220}" y="135" width="440" height="6" fill="${RED}" rx="3"/>

  <!-- ░░░ المسرح الأبيض المركزي للمنتج ░░░ -->
  <g filter="url(#dropShadow)">
    <rect x="60" y="180" width="960" height="720" rx="40" fill="white"/>
  </g>

  <!-- إطار أسود رفيع حول المسرح -->
  <rect x="60" y="180" width="960" height="720" rx="40" fill="none" stroke="${BLACK}" stroke-width="6"/>

  <!-- ░░░ دوائر ملوّنة زخرفية على حواف المسرح ░░░ -->
  <!-- زاوية علوية يسرى -->
  <circle cx="50" cy="220" r="22" fill="${RED}" stroke="${BLACK}" stroke-width="5"/>
  <circle cx="100" cy="160" r="14" fill="${BLUE}" stroke="${BLACK}" stroke-width="4"/>
  <!-- زاوية علوية يمنى -->
  <circle cx="${SIZE-50}" cy="220" r="22" fill="${GREEN}" stroke="${BLACK}" stroke-width="5"/>
  <circle cx="${SIZE-100}" cy="160" r="14" fill="${RED}" stroke="${BLACK}" stroke-width="4"/>
  <!-- زاوية سفلية يسرى -->
  <circle cx="50" cy="880" r="18" fill="${BLUE}" stroke="${BLACK}" stroke-width="5"/>
  <!-- زاوية سفلية يمنى -->
  <circle cx="${SIZE-50}" cy="880" r="18" fill="${RED}" stroke="${BLACK}" stroke-width="5"/>

  <!-- ░░░ شارة "DEAL" سفلية بارزة في الزاوية اليمنى ░░░ -->
  <g transform="translate(${SIZE-260}, ${SIZE-160})">
    <!-- ظل -->
    <rect x="6" y="6" width="220" height="100" rx="20" fill="${BLACK}" opacity="0.25"/>
    <!-- بطاقة حمراء -->
    <rect x="0" y="0" width="220" height="100" rx="20" fill="${BLACK}"/>
    <rect x="0" y="0" width="220" height="100" rx="20" fill="none" stroke="${YELLOW}" stroke-width="4"/>
    <!-- نص -->
    <text x="110" y="42" font-family="Arial Black, sans-serif" font-size="22" font-weight="900" fill="${YELLOW}" text-anchor="middle">★ HOT ★</text>
    <text x="110" y="80" font-family="Arial Black, sans-serif" font-size="36" font-weight="900" fill="white" text-anchor="middle" letter-spacing="3">DEAL</text>
  </g>

  <!-- ░░░ شارة "PRICE" يدوية فارغة (الرقم سيُكتب ديناميكياً) ░░░ -->
  <!-- نتركها فارغة - السعر سيُرسم في runtime عبر overlayPrice -->
  
  <!-- شريط جانبي صغير بنص ALGERIA في زاوية اليمين العلوية للمسرح -->
  <g transform="translate(${SIZE-200}, 195)">
    <rect x="0" y="0" width="120" height="34" rx="17" fill="${BLACK}"/>
    <text x="60" y="24" font-family="Arial Black, sans-serif" font-size="18" font-weight="900" fill="${YELLOW}" text-anchor="middle" letter-spacing="2">ALGERIA</text>
  </g>
</svg>`;

(async () => {
  const outPath = path.join(__dirname, '..', 'public', 'custom_frame.jpg');

  // 1) ارسم الإطار الأساسي
  const baseFrame = await sharp(Buffer.from(svg)).png().toBuffer();

  // 2) جهّز شعار صغير دائري في زاوية الهيدر العلوية اليسرى
  const logoPath = path.join(__dirname, '..', 'public', 'logo.png');
  if (fs.existsSync(logoPath)) {
    const LOGO = 110;
    const logoBuf = await sharp(logoPath)
      .resize(LOGO, LOGO, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    // خلفية بيضاء دائرية للشعار + ظل
    const halo = Buffer.from(`<svg width="${LOGO+20}" height="${LOGO+20}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${(LOGO+20)/2}" cy="${(LOGO+20)/2}" r="${LOGO/2 + 5}" fill="white" stroke="${BLACK}" stroke-width="4"/>
    </svg>`);
    const haloBuf = await sharp(halo).png().toBuffer();

    const composed = await sharp(baseFrame)
      .composite([
        { input: haloBuf, left: 40, top: 40 },
        { input: logoBuf, left: 50, top: 50 },
      ])
      .jpeg({ quality: 92 })
      .toBuffer();
    fs.writeFileSync(outPath, composed);
  } else {
    await sharp(baseFrame).jpeg({ quality: 92 }).toFile(outPath);
  }

  console.log('✅ Built bold frame (yellow + black + circles)');

  // 3) معاينة مع منتج وهمي + سعر ديناميكي
  const { overlayPrice } = require(path.join(__dirname, '..', 'imageProcessor.js'));
  const productSvg = `<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="800" fill="white"/>
    <circle cx="400" cy="400" r="280" fill="#1E40AF"/>
    <text x="400" y="380" font-family="Arial Black" font-size="80" font-weight="900" fill="white" text-anchor="middle">PRODUCT</text>
    <text x="400" y="460" font-family="Arial" font-size="40" fill="white" text-anchor="middle">(no bg removed here)</text>
  </svg>`;
  const productBuf = await sharp(Buffer.from(productSvg)).png().toBuffer();

  // منطقة المنتج: داخل المسرح الأبيض
  const innerLeft = Math.round(1080 * 0.07);
  const innerTop = Math.round(1080 * 0.18);
  const innerW = Math.round(1080 * 0.86);
  const innerH = Math.round(1080 * 0.65);
  const resizedProduct = await sharp(productBuf)
    .resize(innerW, innerH, { fit: 'inside' })
    .toBuffer();
  // مركز داخل المسرح
  const meta = await sharp(resizedProduct).metadata();
  const offX = innerLeft + Math.round((innerW - meta.width) / 2);
  const offY = innerTop + Math.round((innerH - meta.height) / 2);

  let preview = await sharp(outPath)
    .composite([{ input: resizedProduct, left: offX, top: offY, blend: 'over' }])
    .toBuffer();
  // أضف سعر تجريبي
  preview = await overlayPrice(preview, '24.66', { x: 80, y: 690, fontSize: 140 });
  await sharp(preview).jpeg({ quality: 90 }).toFile(path.join(__dirname, '..', 'public', 'preview_yellow.jpg'));
  console.log('✅ Preview saved');
})().catch(e => { console.error(e); process.exit(1); });
