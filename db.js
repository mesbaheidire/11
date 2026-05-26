'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

function ensureDirs() {
  [DATA_DIR, IMAGES_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}
ensureDirs();

/* ── helpers ── */
function fp(name) { return path.join(DATA_DIR, name + '.json'); }

function readJSON(name, def) {
  try {
    const p = fp(name);
    if (!fs.existsSync(p)) return def;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return def; }
}

function writeJSON(name, data) {
  const p   = fp(name);
  const tmp = p + '.tmp.' + Date.now();
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

function imgPath(postId) { return path.join(IMAGES_DIR, postId + '.bin'); }
function imgMetaPath(postId) { return path.join(IMAGES_DIR, postId + '.mime'); }

/* ── init ── */
async function initDatabase() {
  ensureDirs();
  console.log('✅ تم إنشاء/التحقق من مجلدات التخزين بنجاح');
  return true;
}

/* ── query shim — handles the raw db.query() calls in server.js ── */
async function query(text, params = []) {
  const t = text.replace(/\s+/g, ' ').trim().toLowerCase();

  // COUNT saved_posts with time filter
  if (t.startsWith('select count') && t.includes('saved_posts') && t.includes('make_interval')) {
    const posts  = readJSON('saved_posts', []);
    const cutoff = new Date(Date.now() - Number(params[0]) * 3600000);
    const cnt    = posts.filter(p => new Date(p.saved_at || p.createdAt) < cutoff).length;
    return { rows: [{ cnt: String(cnt) }], rowCount: 1 };
  }

  // COUNT saved_posts (no filter)
  if (t.startsWith('select count') && t.includes('saved_posts')) {
    const posts = readJSON('saved_posts', []);
    return { rows: [{ cnt: String(posts.length) }], rowCount: 1 };
  }

  // DELETE saved_posts with time filter
  if (t.startsWith('delete') && t.includes('saved_posts') && t.includes('make_interval')) {
    const posts   = readJSON('saved_posts', []);
    const cutoff  = new Date(Date.now() - Number(params[0]) * 3600000);
    const kept    = posts.filter(p => new Date(p.saved_at || p.createdAt) >= cutoff);
    writeJSON('saved_posts', kept);
    const keptIds = new Set(kept.map(p => p.id));
    try {
      fs.readdirSync(IMAGES_DIR).forEach(f => {
        const id = f.replace(/\.(bin|mime)$/, '');
        if (!keptIds.has(id)) try { fs.unlinkSync(path.join(IMAGES_DIR, f)); } catch (_) {}
      });
    } catch (_) {}
    return { rows: [], rowCount: posts.length - kept.length };
  }

  console.log('⚠️ Unhandled query:', text.substring(0, 100));
  return { rows: [], rowCount: 0 };
}

/* ── spy_config ── */
async function getConfig() {
  try { return readJSON('spy_config', {}); } catch { return {}; }
}

async function saveConfig(config) {
  try {
    const existing = readJSON('spy_config', {});
    writeJSON('spy_config', { ...existing, ...config });
    console.log('✅ Saved config to file');
    return true;
  } catch (e) {
    console.log('❌ Failed to save config:', e.message);
    return false;
  }
}

/* ── spy_auth_state ── */
async function getAuthState() {
  try {
    return readJSON('spy_auth_state', { step: 'idle', phoneCodeHash: null });
  } catch { return { step: 'idle', phoneCodeHash: null }; }
}

async function saveAuthState(state) {
  try { writeJSON('spy_auth_state', state); return true; }
  catch (e) { console.log('⚠️ Failed to save auth state:', e.message); return false; }
}

/* ── spy_processed_links ── */
async function getProcessedLinks() {
  try {
    const now       = Date.now();
    const cutoff    = now - 24 * 3600000;
    const links     = readJSON('spy_processed_links', []).filter(l => l.time >= cutoff);
    writeJSON('spy_processed_links', links);
    return links.slice(0, 10000);
  } catch { return []; }
}

async function addProcessedLink(link) {
  try {
    const links = readJSON('spy_processed_links', []);
    if (!links.find(l => l.link === link)) {
      links.push({ link, time: Date.now() });
      writeJSON('spy_processed_links', links);
    }
    return true;
  } catch { return false; }
}

async function isLinkProcessed(link) {
  try {
    return readJSON('spy_processed_links', []).some(l => l.link === link);
  } catch { return false; }
}

/* ── spy_log ── */
let _logIdCounter = null;
function nextLogId() {
  const log = readJSON('spy_log', []);
  if (_logIdCounter === null) _logIdCounter = log.reduce((m, e) => Math.max(m, e.id || 0), 0);
  return ++_logIdCounter;
}

async function addLogEntry(entry) {
  try {
    const log = readJSON('spy_log', []);
    log.unshift({
      id:            nextLogId(),
      source:        entry.source,
      originalLink:  entry.originalLink,
      affiliateLink: entry.affiliateLink,
      title:         entry.title,
      price:         entry.price,
      status:        entry.status,
      error:         entry.error,
      timestamp:     new Date().toISOString(),
      image:         entry.image || null,
      targets:       entry.targets || [],
      message:       entry.message || null,
    });
    writeJSON('spy_log', log.slice(0, 5000));
    return true;
  } catch { return false; }
}

async function deleteLogEntry(id) {
  try {
    const log = readJSON('spy_log', []).filter(e => e.id !== id && e.id !== Number(id));
    writeJSON('spy_log', log);
    return true;
  } catch { return false; }
}

async function clearLog() {
  try { writeJSON('spy_log', []); return true; } catch { return false; }
}

async function getLog(limit = 200) {
  try { return readJSON('spy_log', []).slice(0, limit); } catch { return []; }
}

/* ── telegram_session ── */
async function getTelegramSession(key = 'default') {
  try { return readJSON('telegram_session', {})[key] || ''; } catch { return ''; }
}

async function saveTelegramSession(sessionData, key = 'default') {
  try {
    const sessions = readJSON('telegram_session', {});
    sessions[key] = sessionData;
    writeJSON('telegram_session', sessions);
    return true;
  } catch { return false; }
}

/* ── gemini_keys ── */
async function saveGeminiKeys(keys) {
  try { writeJSON('gemini_keys', keys); return true; } catch { return false; }
}

async function getGeminiKeys() {
  try { return readJSON('gemini_keys', []); } catch { return []; }
}

/* ── app_storage ── */
async function setAppStorage(key, value) {
  try {
    const store = readJSON('app_storage', {});
    store[key] = value;
    writeJSON('app_storage', store);
    return true;
  } catch { return false; }
}

async function getAppStorage(key) {
  try { return readJSON('app_storage', {})[key] ?? null; } catch { return null; }
}

/* ── saved_posts ── */
function stripIntroBlockquote(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/^\s*<blockquote>[\s\S]*?<\/blockquote>\s*\n*/i, '').trimStart();
}

async function addSavedPost(post) {
  try {
    const postId = post.id || post.post_id || Date.now().toString();
    const savedAt = post.savedAt || post.createdAt || new Date().toISOString();
    if (post.message) post.message = stripIntroBlockquote(post.message);

    let imageBuffer = null;
    let imageMime   = post.imageMime || post.image_mime || null;
    if (post.imageBuffer && Buffer.isBuffer(post.imageBuffer)) {
      imageBuffer = post.imageBuffer;
    } else if (typeof post.imageBase64 === 'string' && post.imageBase64.length > 0) {
      try { imageBuffer = Buffer.from(post.imageBase64, 'base64'); } catch (_) {}
    }
    if (imageBuffer && !imageMime) imageMime = 'image/jpeg';

    if (imageBuffer) {
      fs.writeFileSync(imgPath(postId), imageBuffer);
      fs.writeFileSync(imgMetaPath(postId), imageMime || 'image/jpeg', 'utf8');
    }

    const posts = readJSON('saved_posts', []);
    if (posts.find(p => p.id === postId)) return true;

    const dataPayload = { ...post };
    delete dataPayload.imageBuffer;
    delete dataPayload.imageBase64;

    posts.unshift({
      id:            postId,
      channel_id:    post.channelId || post.channel_id || null,
      title:         post.title || null,
      price:         post.price || null,
      link:          post.link || null,
      affiliate_link: post.affiliateLink || post.affiliate_link || null,
      image_url:     post.image || post.imageUrl || post.image_url || null,
      coupon:        post.coupon || null,
      message:       post.message || null,
      hook:          post.hook || null,
      saved_at:      savedAt,
      createdAt:     savedAt,
      has_image_bin: !!imageBuffer,
      image_mime:    imageMime || null,
    });
    writeJSON('saved_posts', posts);
    return true;
  } catch (e) {
    console.log('⚠️ Failed to save post:', e.message);
    return false;
  }
}

async function getSavedPosts(limit = null) {
  try {
    let posts = readJSON('saved_posts', []);
    if (limit) posts = posts.slice(0, limit);
    return posts.map(p => {
      const hasBlob = p.has_image_bin && fs.existsSync(imgPath(p.id));
      const image   = hasBlob
        ? `/api/saved-posts/${encodeURIComponent(p.id)}/image`
        : p.image_url;
      return {
        id:            p.id,
        title:         p.title,
        price:         p.price,
        link:          p.link,
        image,
        imageOriginal: p.image_url,
        hasImageBlob:  hasBlob,
        coupon:        p.coupon,
        message:       p.message,
        hook:          p.hook,
        createdAt:     p.createdAt || p.saved_at,
        savedAt:       p.saved_at,
      };
    });
  } catch { return []; }
}

async function getSavedPostImage(postId) {
  try {
    const p = imgPath(postId);
    if (!fs.existsSync(p)) return null;
    const buffer = fs.readFileSync(p);
    const mime   = fs.existsSync(imgMetaPath(postId))
      ? fs.readFileSync(imgMetaPath(postId), 'utf8')
      : 'image/jpeg';
    return { buffer, mime };
  } catch { return null; }
}

async function setSavedPostImage(postId, buffer, mime) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
    fs.writeFileSync(imgPath(postId), buffer);
    fs.writeFileSync(imgMetaPath(postId), mime || 'image/jpeg', 'utf8');
    const posts = readJSON('saved_posts', []);
    const idx   = posts.findIndex(p => p.id === postId);
    if (idx !== -1) { posts[idx].has_image_bin = true; posts[idx].image_mime = mime; writeJSON('saved_posts', posts); }
    return true;
  } catch { return false; }
}

async function updateSavedPost(postId, updates) {
  try {
    if (updates && updates.message) updates.message = stripIntroBlockquote(updates.message);
    const posts = readJSON('saved_posts', []);
    const idx   = posts.findIndex(p => p.id === postId);
    if (idx === -1) return false;
    const p = posts[idx];
    if (updates.title     !== undefined) p.title     = updates.title;
    if (updates.price     !== undefined) p.price     = updates.price;
    if (updates.link      !== undefined) p.link      = updates.link;
    if (updates.coupon    !== undefined) p.coupon    = updates.coupon;
    if (updates.message   !== undefined) p.message   = updates.message;
    if (updates.hook      !== undefined) p.hook      = updates.hook;
    if (updates.affiliateLink !== undefined) p.affiliate_link = updates.affiliateLink;
    if (updates.affiliate_link !== undefined) p.affiliate_link = updates.affiliate_link;
    const newImage = updates.image ?? updates.imageUrl ?? updates.image_url;
    if (newImage !== undefined) {
      p.image_url     = newImage;
      p.has_image_bin = false;
      try { if (fs.existsSync(imgPath(postId))) fs.unlinkSync(imgPath(postId)); } catch (_) {}
      try { if (fs.existsSync(imgMetaPath(postId))) fs.unlinkSync(imgMetaPath(postId)); } catch (_) {}
    }
    writeJSON('saved_posts', posts);
    return true;
  } catch (e) { console.log('⚠️ Failed to update saved post:', e.message); return false; }
}

async function deleteSavedPost(postId) {
  try {
    const posts = readJSON('saved_posts', []).filter(p => p.id !== postId);
    writeJSON('saved_posts', posts);
    try { if (fs.existsSync(imgPath(postId))) fs.unlinkSync(imgPath(postId)); } catch (_) {}
    try { if (fs.existsSync(imgMetaPath(postId))) fs.unlinkSync(imgMetaPath(postId)); } catch (_) {}
    return true;
  } catch { return false; }
}

async function deleteSavedPostsBefore(date) {
  try {
    const cutoff  = new Date(date);
    const posts   = readJSON('saved_posts', []);
    const kept    = posts.filter(p => new Date(p.saved_at || p.createdAt) >= cutoff);
    const removed = posts.filter(p => new Date(p.saved_at || p.createdAt) < cutoff);
    writeJSON('saved_posts', kept);
    removed.forEach(p => {
      try { if (fs.existsSync(imgPath(p.id))) fs.unlinkSync(imgPath(p.id)); } catch (_) {}
      try { if (fs.existsSync(imgMetaPath(p.id))) fs.unlinkSync(imgMetaPath(p.id)); } catch (_) {}
    });
    return true;
  } catch { return false; }
}

async function clearSavedPosts() {
  try {
    writeJSON('saved_posts', []);
    try { fs.readdirSync(IMAGES_DIR).forEach(f => { try { fs.unlinkSync(path.join(IMAGES_DIR, f)); } catch (_) {} }); } catch (_) {}
    return true;
  } catch { return false; }
}

/* ── republish_campaigns ── */
function nextCampaignId() {
  const campaigns = readJSON('republish_campaigns', []);
  return campaigns.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1;
}

async function createRepublishCampaign(c) {
  const campaigns = readJSON('republish_campaigns', []);
  const id = nextCampaignId();
  const now = new Date().toISOString();
  const campaign = {
    id,
    name:               c.name || `حملة ${new Date().toLocaleString('ar')}`,
    channel_choice:     c.channelChoice || 'both',
    min_minutes:        c.minMinutes || 30,
    max_minutes:        c.maxMinutes || 90,
    active_hours_start: c.activeHoursStart ?? null,
    active_hours_end:   c.activeHoursEnd   ?? null,
    max_count:          c.maxCount || null,
    regenerate_ai:      !!c.regenerateAi,
    status:             'active',
    total_published:    0,
    queue:              c.queue || [],
    position:           0,
    next_run_at:        c.nextRunAt || now,
    last_run_at:        null,
    credentials:        c.credentials || null,
    created_at:         now,
  };
  campaigns.unshift(campaign);
  writeJSON('republish_campaigns', campaigns);
  return campaign;
}

async function listRepublishCampaigns() {
  try { return readJSON('republish_campaigns', []); } catch { return []; }
}

async function getRepublishCampaign(id) {
  try {
    return readJSON('republish_campaigns', []).find(c => c.id === id || c.id === Number(id)) || null;
  } catch { return null; }
}

async function updateRepublishCampaign(id, updates) {
  try {
    const campaigns = readJSON('republish_campaigns', []);
    const idx = campaigns.findIndex(c => c.id === id || c.id === Number(id));
    if (idx === -1) return false;
    const c = campaigns[idx];
    const map = { status: 'status', position: 'position', total_published: 'total_published', next_run_at: 'next_run_at', last_run_at: 'last_run_at', queue: 'queue' };
    for (const [k, col] of Object.entries(map)) {
      if (updates[k] !== undefined) c[col] = updates[k];
    }
    writeJSON('republish_campaigns', campaigns);
    return true;
  } catch { return false; }
}

async function deleteRepublishCampaign(id) {
  try {
    const campaigns = readJSON('republish_campaigns', []).filter(c => c.id !== id && c.id !== Number(id));
    writeJSON('republish_campaigns', campaigns);
    const log = readJSON('republish_log', []).filter(l => l.campaign_id !== id && l.campaign_id !== Number(id));
    writeJSON('republish_log', log);
    return true;
  } catch { return false; }
}

/* ── republish_log ── */
let _rlogIdCounter = null;
function nextRlogId() {
  if (_rlogIdCounter === null) _rlogIdCounter = readJSON('republish_log', []).reduce((m, l) => Math.max(m, l.id || 0), 0);
  return ++_rlogIdCounter;
}

async function logRepublish(campaignId, savedPostId, status, error) {
  try {
    const log = readJSON('republish_log', []);
    log.unshift({ id: nextRlogId(), campaign_id: campaignId, saved_post_id: savedPostId, status, error: error || null, published_at: new Date().toISOString() });
    writeJSON('republish_log', log.slice(0, 2000));
  } catch (_) {}
}

async function getRepublishLog(campaignId, limit = 100) {
  try {
    const id = Number(campaignId);
    return readJSON('republish_log', []).filter(l => l.campaign_id === id || l.campaign_id === campaignId).slice(0, limit);
  } catch { return []; }
}

/* ── exports ── */
module.exports = {
  initDatabase,
  query,
  getConfig,
  saveConfig,
  getAuthState,
  saveAuthState,
  getProcessedLinks,
  addProcessedLink,
  isLinkProcessed,
  addLogEntry,
  deleteLogEntry,
  clearLog,
  getLog,
  getTelegramSession,
  saveTelegramSession,
  saveGeminiKeys,
  getGeminiKeys,
  addSavedPost,
  getSavedPosts,
  getSavedPostImage,
  setSavedPostImage,
  updateSavedPost,
  deleteSavedPost,
  deleteSavedPostsBefore,
  clearSavedPosts,
  createRepublishCampaign,
  listRepublishCampaigns,
  getRepublishCampaign,
  updateRepublishCampaign,
  deleteRepublishCampaign,
  logRepublish,
  getRepublishLog,
  setAppStorage,
  getAppStorage,
  closePool: async () => { console.log('🔌 File-based storage — no pool to close'); },
};
