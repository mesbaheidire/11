// إزالة خلفية المنتج + استخراج السعر + رسم السعر اليدوي على الإطار
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

let _imgly = null;
async function getImgly() {
  if (_imgly) return _imgly;
  _imgly = await import('@imgly/background-removal-node');
  return _imgly;
}

// تسجيل خط Caveat في fontconfig عند الإقلاع (يعمل على Render أيضاً)
let _fontReady = false;
function registerCaveatFont() {
  if (_fontReady) return;
  try {
    const os = require('os');
    const { execSync } = require('child_process');
    const fontDir = path.join(os.homedir(), '.fonts');
    if (!fs.existsSync(fontDir)) fs.mkdirSync(fontDir, { recursive: true });
    const src = path.join(__dirname, 'public', 'fonts', 'Caveat.ttf');
    const dst = path.join(fontDir, 'Caveat.ttf');
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
    }
    try { execSync('fc-cache -f ' + fontDir, { stdio: 'pipe' }); } catch (_) {}
    _fontReady = true;
  } catch (e) {
    console.log('⚠️ تسجيل خط Caveat فشل:', e.message);
  }
}
registerCaveatFont();

// إزالة خلفية الصورة (يحوّل إلى PNG شفّاف)
async function removeBackground(inputBuffer) {
  try {
    const { removeBackground: rmbg } = await getImgly();
    const blob = await rmbg(inputBuffer);
    const ab = await blob.arrayBuffer();
    return Buffer.from(ab);
  } catch (e) {
    console.log('⚠️ removeBackground فشل:', e.message);
    return null;
  }
}

// استخراج السعر من نص المنشور
function extractPrice(text) {
  if (!text || typeof text !== 'string') return null;
  // إزالة الإيموجي والرموز للتسهيل
  const t = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ');

  // يدعم: 24, 24.66, 24,66, 1,299.99, 1.299,99
  const NUM = '(\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
  const patterns = [
    new RegExp(`(?:بعد\\s*التخفيض|السعر\\s*بعد)[:\\s]+${NUM}`, 'i'),
    new RegExp(`السعر[:\\s]+\\$?\\s*${NUM}\\s*\\$?`, 'i'),
    new RegExp(`price[:\\s]+\\$?\\s*${NUM}`, 'i'),
    new RegExp(`\\$\\s*${NUM}`),
    new RegExp(`${NUM}\\s*\\$`),
    new RegExp(`${NUM}\\s*USD`, 'i'),
    new RegExp(`ب\\s+${NUM}\\s*\\$`, 'i'),
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) {
      const norm = normalizeNumber(m[1]);
      const f = parseFloat(norm);
      if (!isNaN(f) && f > 0 && f < 100000) return norm;
    }
  }
  return null;
}

// تحويل "1,299.99" أو "1.299,99" إلى "1299.99"
function normalizeNumber(s) {
  s = String(s).trim();
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // كلاهما موجود — الفاصلة العشرية هي الأخيرة
    if (lastComma > lastDot) {
      // 1.299,99 → 1299.99
      return s.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,299.99 → 1299.99
      return s.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const commaCount = (s.match(/,/g) || []).length;
    const after = s.length - lastComma - 1;
    // عدة فواصل أو ",XXX" بنهاية = فاصل آلاف
    if (commaCount > 1 || after === 3) return s.replace(/,/g, '');
    // فاصلة واحدة بأقل من 3 أرقام = فاصلة عشرية أوروبية
    return s.replace(',', '.');
  } else if (lastDot > -1) {
    const after = s.length - lastDot - 1;
    if (after === 3) return s.replace(/\./g, '');
    return s;
  }
  return s;
}

// إنشاء SVG بالسعر بخط يدوي + تركيبه على الإطار
async function overlayPrice(frameBuffer, price, opts = {}) {
  if (!price) return frameBuffer;
  const {
    x = 70,           // موضع X
    y = 240,          // موضع Y
    fontSize = 130,
    color = '#0F0F1A',
    accent = '#E63946',
  } = opts;

  const family = 'Caveat, Comic Sans MS, cursive, sans-serif';

  // تنظيف السعر: إزالة أي رمز عملة موجود قبل الإضافة
  const cleanPrice = String(price).replace(/[\$\s]/g, '');
  const text = `${cleanPrice}$`;
  const w = Math.round(fontSize * (text.length * 0.55 + 1));
  const h = Math.round(fontSize * 1.4);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <!-- ظل خفيف للعمق -->
    <text x="6" y="${Math.round(fontSize * 1.05)}" font-family="${family}" font-size="${fontSize}" font-weight="700" fill="${color}" opacity="0.15">${text}</text>
    <!-- النص الرئيسي -->
    <text x="0" y="${fontSize}" font-family="${family}" font-size="${fontSize}" font-weight="700" fill="${color}">${text}</text>
    <!-- خط تحته أحمر يدوي -->
    <path d="M 5 ${Math.round(fontSize * 1.15)} Q ${w/2} ${Math.round(fontSize * 1.25)} ${w-10} ${Math.round(fontSize * 1.15)}" stroke="${accent}" stroke-width="6" fill="none" stroke-linecap="round"/>
  </svg>`;

  const overlay = await sharp(Buffer.from(svg)).png().toBuffer();
  return await sharp(frameBuffer)
    .composite([{ input: overlay, left: x, top: y, blend: 'over' }])
    .toBuffer();
}

module.exports = { removeBackground, extractPrice, overlayPrice };
