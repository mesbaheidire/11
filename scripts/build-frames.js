const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZE = 1080;
const OUT = path.join(__dirname, '..', 'public', 'frame-options');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const GOLD = '#FFC424';
const GOLD_DARK = '#E5A800';
const DARK = '#0F0F1A';
const DARK2 = '#1E1E2E';
const RED = '#E63946';

// inner product area: 2% padding L/T, 96% width, 85% height
// Free zones (NOT covered by product):
//   - Top strip:    y = 0 .. ~20px (2% of 1080 = 21.6px) — too thin for content
//   - Bottom band:  y = ~940 .. 1080  (15% = 162px usable, but product reaches 87% so band starts at y=918+)
//   - Actually inner ends at y = 0.02*1080 + 0.85*1080 = 21.6 + 918 = ~940. So bottom 140px is free.
//   - Side strips:  x = 0..~20 and x = 1060..1080 — too thin for content (just borders OK)

function svgToBuf(svg) { return sharp(Buffer.from(svg)).png().toBuffer(); }

// ============ Variant 1: PREMIUM GOLD ============
async function variant1_premium() {
  const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="band1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${DARK}"/>
      <stop offset="0.5" stop-color="${DARK2}"/>
      <stop offset="1" stop-color="${DARK}"/>
    </linearGradient>
    <linearGradient id="goldShine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${GOLD_DARK}"/>
      <stop offset="0.5" stop-color="#FFE066"/>
      <stop offset="1" stop-color="${GOLD_DARK}"/>
    </linearGradient>
  </defs>
  <!-- Base white -->
  <rect width="${SIZE}" height="${SIZE}" fill="white"/>
  <!-- Thin gold side borders (kept thin so product doesn't overlap) -->
  <rect x="0" y="0" width="${SIZE}" height="14" fill="url(#goldShine)"/>
  <rect x="0" y="0" width="14" height="${SIZE-140}" fill="${GOLD}"/>
  <rect x="${SIZE-14}" y="0" width="14" height="${SIZE-140}" fill="${GOLD}"/>
  <!-- Gold accent line above bottom band -->
  <rect x="0" y="${SIZE-148}" width="${SIZE}" height="8" fill="url(#goldShine)"/>
  <!-- Bottom band -->
  <rect x="0" y="${SIZE-140}" width="${SIZE}" height="140" fill="url(#band1)"/>
  <!-- Decorative diamond pattern in band -->
  <g opacity="0.08" fill="${GOLD}">
    ${Array.from({length: 30}, (_, i) => 
      `<rect x="${i*40}" y="${SIZE-100}" width="8" height="8" transform="rotate(45 ${i*40+4} ${SIZE-96})"/>`
    ).join('')}
  </g>
  <!-- Brand left aligned -->
  <text x="40" y="${SIZE-78}" font-family="Arial Black, Arial, sans-serif" font-size="46" font-weight="900" fill="${GOLD}">@AliOffersDz</text>
  <text x="42" y="${SIZE-38}" font-family="Arial, sans-serif" font-size="20" fill="white" opacity="0.85" letter-spacing="2">DAILY ALIEXPRESS DEALS · DZ</text>
  <!-- Right side gold badge with star (no emoji) -->
  <g transform="translate(${SIZE-130},${SIZE-110})">
    <circle cx="40" cy="40" r="48" fill="${GOLD}"/>
    <circle cx="40" cy="40" r="48" fill="none" stroke="white" stroke-width="2" stroke-dasharray="3 3" opacity="0.6"/>
    <!-- Star shape -->
    <path d="M 40 12 L 47 32 L 68 32 L 51 45 L 58 65 L 40 53 L 22 65 L 29 45 L 12 32 L 33 32 Z" fill="${DARK}"/>
  </g>
</svg>`;
  const buf = await svgToBuf(svg);
  await sharp(buf).jpeg({ quality: 92 }).toFile(path.join(OUT, 'frame_premium.jpg'));
}

// ============ Variant 2: MINIMAL CLEAN ============
async function variant2_minimal() {
  const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g2" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${GOLD_DARK}"/>
      <stop offset="0.5" stop-color="${GOLD}"/>
      <stop offset="1" stop-color="${GOLD_DARK}"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="#FAFAFA"/>
  <!-- Thin frame outline around inner -->
  <rect x="14" y="14" width="${SIZE-28}" height="${SIZE-168}" fill="white" stroke="${GOLD}" stroke-width="4"/>
  <!-- Bottom clean white band -->
  <rect x="0" y="${SIZE-140}" width="${SIZE}" height="140" fill="white"/>
  <rect x="0" y="${SIZE-140}" width="${SIZE}" height="4" fill="url(#g2)"/>
  <!-- Centered brand -->
  <text x="${SIZE/2}" y="${SIZE-72}" font-family="Arial Black, sans-serif" font-size="50" font-weight="900" fill="${DARK}" text-anchor="middle">@AliOffersDz</text>
  <text x="${SIZE/2}" y="${SIZE-36}" font-family="Arial, sans-serif" font-size="20" fill="#666" text-anchor="middle" letter-spacing="4">★  AFFILIATE PARTNER  ★</text>
  <circle cx="60" cy="${SIZE-90}" r="6" fill="${GOLD}"/>
  <circle cx="${SIZE-60}" cy="${SIZE-90}" r="6" fill="${GOLD}"/>
</svg>`;
  const buf = await svgToBuf(svg);
  await sharp(buf).jpeg({ quality: 92 }).toFile(path.join(OUT, 'frame_minimal.jpg'));
}

// ============ Variant 3: BOLD SALE ============
async function variant3_bold() {
  const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bottomB" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${DARK}"/>
      <stop offset="0.5" stop-color="${GOLD_DARK}"/>
      <stop offset="1" stop-color="${DARK}"/>
    </linearGradient>
    <linearGradient id="topB" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${RED}"/>
      <stop offset="1" stop-color="#C0392B"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="white"/>
  <!-- Top thick red band with SALE notice (only ~14px so we add extra inset) -->
  <!-- Actually we use the side & top thin borders only since top has ~21px free. Use 14px thick gold/red border -->
  <rect x="0" y="0" width="${SIZE}" height="14" fill="url(#topB)"/>
  <rect x="0" y="0" width="14" height="${SIZE-140}" fill="${GOLD}"/>
  <rect x="${SIZE-14}" y="0" width="14" height="${SIZE-140}" fill="${GOLD}"/>
  <!-- Gold accent above bottom band -->
  <rect x="0" y="${SIZE-148}" width="${SIZE}" height="8" fill="${GOLD}"/>
  <!-- Bottom band -->
  <rect x="0" y="${SIZE-140}" width="${SIZE}" height="140" fill="url(#bottomB)"/>
  <!-- Left red SALE pill on bottom band -->
  <g transform="translate(30,${SIZE-115})">
    <rect x="0" y="0" width="120" height="44" rx="22" fill="${RED}"/>
    <text x="60" y="30" font-family="Arial Black, sans-serif" font-size="22" font-weight="900" fill="white" text-anchor="middle">-70% SALE</text>
  </g>
  <!-- Right gold HOT pill on bottom band -->
  <g transform="translate(${SIZE-150},${SIZE-115})">
    <rect x="0" y="0" width="120" height="44" rx="22" fill="${GOLD}"/>
    <text x="60" y="30" font-family="Arial Black, sans-serif" font-size="22" font-weight="900" fill="${DARK}" text-anchor="middle">★ HOT DEAL</text>
  </g>
  <!-- Brand center -->
  <text x="${SIZE/2}" y="${SIZE-38}" font-family="Arial Black, sans-serif" font-size="40" font-weight="900" fill="white" text-anchor="middle">@AliOffersDz</text>
</svg>`;
  const buf = await svgToBuf(svg);
  await sharp(buf).jpeg({ quality: 92 }).toFile(path.join(OUT, 'frame_bold.jpg'));
}

(async () => {
  await Promise.all([variant1_premium(), variant2_minimal(), variant3_bold()]);
  console.log('✅ Generated 3 frame variants');
})().catch(e => { console.error(e); process.exit(1); });
