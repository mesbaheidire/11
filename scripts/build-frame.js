// إطار AliOffersDz بأسلوب فني أنيق + الشعار الحقيقي
// منطقة المنتج: top=18%, height=64%, left=4%, width=92%
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZE = 1080;
const YELLOW = '#FFC424';
const YELLOW_LIGHT = '#FFD659';
const YELLOW_DARK = '#E5A800';
const NAVY = '#0F1A2E';
const NAVY_SOFT = '#1E2A45';
const TEXT = '#1A1A2E';

// ============ الطبقة 1: الإطار SVG (دون الشعار) ============
const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ySwoosh" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${YELLOW_LIGHT}"/>
      <stop offset="0.6" stop-color="${YELLOW}"/>
      <stop offset="1" stop-color="${YELLOW_DARK}"/>
    </linearGradient>
    <linearGradient id="ySwoosh2" x1="1" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="${YELLOW_LIGHT}"/>
      <stop offset="0.6" stop-color="${YELLOW}"/>
      <stop offset="1" stop-color="${YELLOW_DARK}"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
      <feOffset dx="0" dy="4" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="logoShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="0" dy="6" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- خلفية بيضاء -->
  <rect width="${SIZE}" height="${SIZE}" fill="white"/>

  <!-- ▓▓▓ TOP-LEFT: انحناء فني مزدوج (طبقتان لعمق بصري) ▓▓▓ -->
  <!-- الطبقة الخلفية الأفتح -->
  <path d="M 0 0 L 480 0 Q 320 110 220 240 Q 140 360 0 340 Z" fill="${YELLOW_LIGHT}" opacity="0.5"/>
  <!-- الطبقة الأمامية الذهبية -->
  <path d="M 0 0 L 420 0 Q 270 95 175 215 Q 105 320 0 300 Z" fill="url(#ySwoosh)"/>

  <!-- نقاط زخرفية صغيرة حول الانحناء العلوي -->
  <circle cx="450" cy="35" r="6" fill="${YELLOW}" opacity="0.7"/>
  <circle cx="490" cy="65" r="4" fill="${YELLOW_DARK}" opacity="0.6"/>
  <circle cx="240" cy="280" r="5" fill="${YELLOW}" opacity="0.5"/>

  <!-- ▓▓▓ BOTTOM-RIGHT: انحناء معكوس مماثل ▓▓▓ -->
  <path d="M ${SIZE} ${SIZE} L ${SIZE-480} ${SIZE} Q ${SIZE-320} ${SIZE-110} ${SIZE-220} ${SIZE-240} Q ${SIZE-140} ${SIZE-360} ${SIZE} ${SIZE-340} Z" fill="${YELLOW_LIGHT}" opacity="0.5"/>
  <path d="M ${SIZE} ${SIZE} L ${SIZE-420} ${SIZE} Q ${SIZE-270} ${SIZE-95} ${SIZE-175} ${SIZE-215} Q ${SIZE-105} ${SIZE-320} ${SIZE} ${SIZE-300} Z" fill="url(#ySwoosh2)"/>

  <!-- نقاط زخرفية حول الانحناء السفلي -->
  <circle cx="${SIZE-450}" cy="${SIZE-35}" r="6" fill="${YELLOW}" opacity="0.7"/>
  <circle cx="${SIZE-490}" cy="${SIZE-65}" r="4" fill="${YELLOW_DARK}" opacity="0.6"/>
  <circle cx="${SIZE-240}" cy="${SIZE-280}" r="5" fill="${YELLOW}" opacity="0.5"/>

  <!-- ▓▓▓ بطاقة السعر السفلية اليسرى — تصميم أنيق ▓▓▓ -->
  <g transform="translate(60, ${SIZE-180})" filter="url(#softShadow)">
    <!-- الخلفية الداكنة -->
    <rect x="0" y="0" width="290" height="135" rx="22" fill="${NAVY}"/>
    <!-- شريط ذهبي علوي رفيع -->
    <rect x="0" y="0" width="290" height="6" rx="22" fill="url(#ySwoosh)"/>
    <!-- نص "السعر" -->
    <text x="145" y="50" font-family="Arial, sans-serif" font-size="18" fill="${YELLOW}" text-anchor="middle" letter-spacing="4" font-weight="700">PRICE · السعر</text>
    <!-- الرقم -->
    <text x="145" y="105" font-family="Georgia, serif" font-size="48" font-weight="900" fill="white" text-anchor="middle" font-style="italic">$ XX.XX</text>
  </g>

  <!-- ▓▓▓ شريط برندينغ يمين الأسفل ▓▓▓ -->
  <g transform="translate(390, ${SIZE-150})">
    <text x="0" y="34" font-family="Arial Black, sans-serif" font-size="34" font-weight="900" fill="${TEXT}">DAILY DEALS</text>
    <!-- خط ذهبي رفيع تحت العنوان -->
    <rect x="0" y="46" width="220" height="3" fill="${YELLOW}"/>
    <text x="0" y="80" font-family="Arial, sans-serif" font-size="20" fill="#444">أفضل عروض علي إكسبريس</text>
    <text x="0" y="106" font-family="Arial, sans-serif" font-size="16" fill="#888" letter-spacing="3">★ ALGERIA · DZ ★</text>
  </g>
</svg>`;

(async () => {
  const outPath = path.join(__dirname, '..', 'public', 'custom_frame.jpg');

  // 1) ارسم الإطار من SVG
  const baseFrame = await sharp(Buffer.from(svg)).png().toBuffer();

  // 2) جهّز الشعار: حجم 200x200 مع ظل ناعم خفيف (الشعار أساساً دائري بخلفية صفراء)
  const logoPath = path.join(__dirname, '..', 'public', 'logo.png');
  const LOGO_SIZE = 210;
  const logoBuf = await sharp(logoPath)
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // 3) خلفية بيضاء دائرية تحت الشعار لإبرازه على المنطقة الصفراء
  const haloBg = Buffer.from(`<svg width="${LOGO_SIZE+30}" height="${LOGO_SIZE+30}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="8"/>
        <feOffset dx="0" dy="5" result="offsetblur"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <circle cx="${(LOGO_SIZE+30)/2}" cy="${(LOGO_SIZE+30)/2}" r="${LOGO_SIZE/2 + 8}" fill="white" filter="url(#s)"/>
  </svg>`);
  const haloBuf = await sharp(haloBg).png().toBuffer();

  // 4) ركّب: إطار → خلفية الهالة (وسط أعلى) → الشعار فوقها
  const logoTopY = 30; // المسافة من الأعلى
  const logoX = Math.round((SIZE - LOGO_SIZE) / 2);
  const haloX = logoX - 15;
  const haloY = logoTopY - 15;

  const composed = await sharp(baseFrame)
    .composite([
      { input: haloBuf, left: haloX, top: haloY },
      { input: logoBuf, left: logoX, top: logoTopY },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  fs.writeFileSync(outPath, composed);
  console.log('✅ Built custom_frame.jpg (elegant + real logo)');

  // 5) معاينة مع منتج وهمي (geometry: top=18%, height=64%)
  const productSvg = `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#667eea"/><stop offset="1" stop-color="#764ba2"/></linearGradient></defs>
    <rect width="1080" height="1080" fill="url(#g)"/>
    <circle cx="540" cy="540" r="280" fill="white"/>
    <text x="540" y="500" font-family="Arial Black" font-size="80" font-weight="900" fill="#333" text-anchor="middle">PRODUCT</text>
    <text x="540" y="600" font-family="Arial" font-size="56" fill="#666" text-anchor="middle">صورة المنتج</text>
  </svg>`;
  const productBuf = await sharp(Buffer.from(productSvg)).jpeg().toBuffer();

  const innerLeft = Math.round(1080 * 0.04);
  const innerTop = Math.round(1080 * 0.18);
  const innerW = Math.round(1080 * 0.92);
  const innerH = Math.round(1080 * 0.64);
  const resizedProduct = await sharp(productBuf)
    .resize(innerW, innerH, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toBuffer();
  await sharp(outPath)
    .composite([{ input: resizedProduct, left: innerLeft, top: innerTop, blend: 'over' }])
    .jpeg({ quality: 90 })
    .toFile(path.join(__dirname, '..', 'public', 'preview_yellow.jpg'));
  console.log('✅ Preview saved');
})().catch(e => { console.error(e); process.exit(1); });
