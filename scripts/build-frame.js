// يُنشئ إطار custom_frame.jpg بأسلوب RT DEALS (انحناءات صفراء + رأس القناة)
// منطقة المنتج: top=15%, height=70%, left=2%, width=96% — يجب مطابقتها في spy.js و server.js
const sharp = require('sharp');
const path = require('path');

const SIZE = 1080;
const YELLOW = '#FFC424';
const YELLOW_DARK = '#E5A800';
const DARK = '#0F0F1A';

const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="yShine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${YELLOW}"/>
      <stop offset="1" stop-color="${YELLOW_DARK}"/>
    </linearGradient>
  </defs>
  <!-- White base -->
  <rect width="${SIZE}" height="${SIZE}" fill="white"/>

  <!-- TOP-LEFT YELLOW SWOOSH (organic curve) -->
  <path d="M 0 0 L 380 0 Q 240 90 180 200 Q 130 290 0 280 Z" fill="url(#yShine)"/>
  <!-- Inner curve dark accent -->
  <path d="M 0 0 L 360 0 Q 220 80 160 180 Q 110 270 0 260 Z" fill="${YELLOW}"/>

  <!-- TOP CHANNEL NAME (centered with thunder bolt) -->
  <text x="${SIZE/2}" y="95" font-family="Arial Black, Arial, sans-serif" font-size="64" font-weight="900" fill="${DARK}" text-anchor="middle">@AliOffersDz</text>
  <!-- Thunder bolt circle next to text (right side) -->
  <g transform="translate(${SIZE/2 + 290}, 60)">
    <circle cx="22" cy="22" r="26" fill="${YELLOW}"/>
    <circle cx="22" cy="22" r="26" fill="none" stroke="${DARK}" stroke-width="3"/>
    <path d="M 24 6 L 12 26 L 22 26 L 18 38 L 32 18 L 22 18 Z" fill="${DARK}"/>
  </g>

  <!-- BOTTOM-RIGHT YELLOW SWOOSH (mirrored organic curve) -->
  <path d="M ${SIZE} ${SIZE} L ${SIZE-380} ${SIZE} Q ${SIZE-240} ${SIZE-90} ${SIZE-180} ${SIZE-200} Q ${SIZE-130} ${SIZE-290} ${SIZE} ${SIZE-280} Z" fill="url(#yShine)"/>
  <path d="M ${SIZE} ${SIZE} L ${SIZE-360} ${SIZE} Q ${SIZE-220} ${SIZE-80} ${SIZE-160} ${SIZE-180} Q ${SIZE-110} ${SIZE-270} ${SIZE} ${SIZE-260} Z" fill="${YELLOW}"/>

  <!-- BOTTOM-LEFT PRICE TAG SHAPE (decorative — looks like price will go here) -->
  <g transform="translate(50, ${SIZE-180})">
    <!-- White rounded card with yellow border -->
    <rect x="0" y="0" width="280" height="120" rx="20" fill="white" stroke="${YELLOW}" stroke-width="6"/>
    <text x="140" y="55" font-family="Arial, sans-serif" font-size="20" fill="#888" text-anchor="middle" letter-spacing="2">السعر</text>
    <text x="140" y="100" font-family="Arial Black, sans-serif" font-size="44" font-weight="900" fill="${DARK}" text-anchor="middle">PRICE</text>
  </g>

  <!-- BOTTOM tagline (right of price tag) -->
  <text x="380" y="${SIZE-100}" font-family="Arial Black, sans-serif" font-size="32" font-weight="900" fill="${DARK}">★ DAILY DEALS</text>
  <text x="380" y="${SIZE-60}" font-family="Arial, sans-serif" font-size="22" fill="#555">أفضل العروض من علي إكسبريس</text>
</svg>`;

(async () => {
  const outPath = path.join(__dirname, '..', 'public', 'custom_frame.jpg');
  await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(outPath);
  console.log('✅ Built custom_frame.jpg (RT DEALS style)');
  // Generate preview with sample product
  const productSvg = `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#667eea"/><stop offset="1" stop-color="#764ba2"/></linearGradient></defs>
    <rect width="1080" height="1080" fill="url(#g)"/>
    <circle cx="540" cy="540" r="280" fill="white"/>
    <text x="540" y="500" font-family="Arial Black" font-size="80" font-weight="900" fill="#333" text-anchor="middle">PRODUCT</text>
    <text x="540" y="600" font-family="Arial" font-size="56" fill="#666" text-anchor="middle">صورة المنتج</text>
  </svg>`;
  const productBuf = await sharp(Buffer.from(productSvg)).jpeg().toBuffer();

  // NEW geometry: top=15%, height=70%, left=2%, width=96%
  const innerLeft = Math.round(1080 * 0.02);
  const innerTop = Math.round(1080 * 0.15);
  const innerW = Math.round(1080 * 0.96);
  const innerH = Math.round(1080 * 0.70);
  const resizedProduct = await sharp(productBuf)
    .resize(innerW, innerH, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toBuffer();
  await sharp(outPath)
    .composite([{ input: resizedProduct, left: innerLeft, top: innerTop, blend: 'over' }])
    .jpeg({ quality: 90 })
    .toFile('/tmp/preview_yellow.jpg');
  console.log('✅ Preview saved to /tmp/preview_yellow.jpg');
})().catch(e => { console.error(e); process.exit(1); });
