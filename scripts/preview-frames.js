const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'public', 'frame-options');

// صورة منتج وهمية بلون متدرج لاختبار الإطار
async function makeSampleProduct() {
  const svg = `
<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#667eea"/>
      <stop offset="1" stop-color="#764ba2"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#g)"/>
  <circle cx="540" cy="540" r="280" fill="white" opacity="0.95"/>
  <text x="540" y="500" font-family="Arial Black, sans-serif" font-size="80" font-weight="900" fill="#333" text-anchor="middle">PRODUCT</text>
  <text x="540" y="600" font-family="Arial, sans-serif" font-size="60" fill="#666" text-anchor="middle">صورة المنتج</text>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

async function applyFrame(framePath, productBuf, outName) {
  const meta = await sharp(framePath).metadata();
  const fW = meta.width, fH = meta.height;
  const innerLeft = Math.round(fW * 0.02);
  const innerTop = Math.round(fH * 0.02);
  const innerW = Math.round(fW * 0.96);
  const innerH = Math.round(fH * 0.85);

  const resizedProduct = await sharp(productBuf)
    .resize(innerW, innerH, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toBuffer();

  await sharp(framePath)
    .composite([{ input: resizedProduct, left: innerLeft, top: innerTop, blend: 'over' }])
    .jpeg({ quality: 90 })
    .toFile(path.join(OUT, outName));
}

(async () => {
  const productBuf = await makeSampleProduct();
  await Promise.all([
    applyFrame(path.join(OUT, 'frame_premium.jpg'), productBuf, 'preview_premium.jpg'),
    applyFrame(path.join(OUT, 'frame_minimal.jpg'), productBuf, 'preview_minimal.jpg'),
    applyFrame(path.join(OUT, 'frame_bold.jpg'), productBuf, 'preview_bold.jpg'),
  ]);
  console.log('✅ Generated 3 previews');
})().catch(e => { console.error(e); process.exit(1); });
