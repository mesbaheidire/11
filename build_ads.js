const sharp = require('sharp');

const SIZE = 1080;
const LOGO = 'public/ads/logo.png';

async function renderText(text, { fontSize, color = '#FFFFFF', weight = 'bold', width = SIZE - 120, align = 'center' }) {
  const pangoMarkup = `<span foreground="${color}" font_family="Cairo" font_weight="${weight}" size="${fontSize * 1024}">${text}</span>`;
  return sharp({
    text: {
      text: pangoMarkup,
      font: 'Cairo',
      width,
      dpi: 72,
      rgba: true,
      align,
    }
  }).png().toBuffer({ resolveWithObject: true });
}

async function renderTextWithStroke(text, opts) {
  const stroke = await renderText(text, { ...opts, color: opts.strokeColor || '#000000' });
  const fill = await renderText(text, opts);
  // Build a simple stroke effect by overlaying the fill over a slightly enlarged stroke layer (cheap pseudo-stroke via blur)
  const strokeBlurred = await sharp(stroke.data)
    .blur(2)
    .modulate({ brightness: 1 })
    .toBuffer({ resolveWithObject: true });
  // Composite fill on top of blurred stroke
  const W = Math.max(strokeBlurred.info.width, fill.info.width);
  const H = Math.max(strokeBlurred.info.height, fill.info.height);
  const canvas = sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const out = await canvas
    .composite([
      { input: strokeBlurred.data, left: 0, top: 0 },
      { input: strokeBlurred.data, left: 0, top: 0 },
      { input: strokeBlurred.data, left: 0, top: 0 },
      { input: fill.data, left: Math.floor((W - fill.info.width) / 2), top: Math.floor((H - fill.info.height) / 2) },
    ])
    .png()
    .toBuffer({ resolveWithObject: true });
  return out;
}

async function buildAd({ bg, top, mid, cta, footer, out }) {
  const logoBuf = await sharp(LOGO).resize({ width: 220 }).png().toBuffer();

  const topImg = await renderTextWithStroke(top, { fontSize: 44, color: '#FFFFFF', weight: '900', width: SIZE - 320, align: 'right' });
  const midImg = await renderTextWithStroke(mid, { fontSize: 80, color: '#FFC424', weight: '900', width: SIZE - 120, align: 'center' });
  const ctaTextImg = await renderText(cta, { fontSize: 50, color: '#1a1a2e', weight: '900', width: 600, align: 'center' });
  const footerImg = await renderTextWithStroke(footer, { fontSize: 36, color: '#FFFFFF', weight: '700', width: 600, align: 'center' });

  const ctaBgWidth = 700;
  const ctaBgHeight = 130;
  const ctaBg = await sharp({
    create: { width: ctaBgWidth, height: ctaBgHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ctaBgWidth}" height="${ctaBgHeight}"><rect x="0" y="0" rx="65" ry="65" width="${ctaBgWidth}" height="${ctaBgHeight}" fill="#FFC424"/></svg>`)
    }])
    .png()
    .toBuffer();

  // Bottom dark gradient strip for readability
  const gradient = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
        <defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="rgba(0,0,0,0.92)"/>
          <stop offset="55%" stop-color="rgba(0,0,0,0.55)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
        </linearGradient></defs>
        <rect x="0" y="${SIZE - 600}" width="${SIZE}" height="600" fill="url(#g)"/>
        <rect x="0" y="0" width="${SIZE}" height="220" fill="rgba(0,0,0,0.45)"/>
      </svg>`)
    }])
    .png()
    .toBuffer();

  const ctaX = Math.floor((SIZE - ctaBgWidth) / 2);
  const ctaY = SIZE - 290;

  await sharp(bg)
    .resize(SIZE, SIZE, { fit: 'cover', position: 'center' })
    .composite([
      { input: gradient, left: 0, top: 0 },
      { input: logoBuf, top: 40, left: 40 },
      { input: topImg.data, top: 70, left: SIZE - topImg.info.width - 60 },
      { input: midImg.data, top: SIZE - 470, left: Math.floor((SIZE - midImg.info.width) / 2) },
      { input: ctaBg, top: ctaY, left: ctaX },
      { input: ctaTextImg.data, top: ctaY + Math.floor((ctaBgHeight - ctaTextImg.info.height) / 2), left: ctaX + Math.floor((ctaBgWidth - ctaTextImg.info.width) / 2) },
      { input: footerImg.data, top: SIZE - 110, left: Math.floor((SIZE - footerImg.info.width) / 2) },
    ])
    .png()
    .toFile(out);
  console.log('✅', out);
}

(async () => {
  await buildAd({
    bg: 'public/ads/bg1_deals.png',
    top: 'تخفيضات يومية من علي إكسبريس',
    mid: 'وفّر حتى ٪70',
    cta: 'اشترك الآن في القناة',
    footer: '@AliOffersDz',
    out: 'public/ads/ad1_deals.png'
  });
  await buildAd({
    bg: 'public/ads/bg2_lifestyle.png',
    top: 'انضم لآلاف المتسوقين الأذكياء',
    mid: 'أفضل العروض كل يوم',
    cta: 'اضغط للانضمام مجاناً',
    footer: '@AliOffersDz',
    out: 'public/ads/ad2_lifestyle.png'
  });
  await buildAd({
    bg: 'public/ads/bg3_explosion.png',
    top: 'لا تفوّت أي عرض',
    mid: 'كوبونات حصرية يومياً',
    cta: 'انضم إلى القناة',
    footer: '@AliOffersDz',
    out: 'public/ads/ad3_explosion.png'
  });
})().catch(e => { console.error(e); process.exit(1); });
