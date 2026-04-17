const { Pool } = require('pg');

const dbUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

const pool = dbUrl ? new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
}) : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle client', err);
  });
}

async function initDatabase() {
  if (!pool) {
    console.log('⚠️ لا يوجد رابط قاعدة بيانات - التخزين سيكون مؤقتاً');
    return false;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS spy_config (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS spy_auth_state (
        id SERIAL PRIMARY KEY,
        step TEXT,
        phone_code_hash TEXT,
        phone_number TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS spy_processed_links (
        id SERIAL PRIMARY KEY,
        link TEXT UNIQUE NOT NULL,
        time BIGINT
      );
      CREATE TABLE IF NOT EXISTS spy_log (
        id SERIAL PRIMARY KEY,
        source TEXT,
        original_link TEXT,
        affiliate_link TEXT,
        title TEXT,
        price TEXT,
        status TEXT,
        error TEXT,
        timestamp TIMESTAMP DEFAULT NOW(),
        data JSONB
      );
      CREATE TABLE IF NOT EXISTS telegram_session (
        id SERIAL PRIMARY KEY,
        session_key TEXT UNIQUE NOT NULL,
        session_data TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS gemini_keys (
        id SERIAL PRIMARY KEY,
        key_index INTEGER,
        api_key TEXT
      );
      CREATE TABLE IF NOT EXISTS saved_posts (
        id SERIAL PRIMARY KEY,
        post_id TEXT UNIQUE,
        channel_id TEXT,
        title TEXT,
        price TEXT,
        link TEXT,
        affiliate_link TEXT,
        image_url TEXT,
        coupon TEXT,
        message TEXT,
        hook TEXT,
        saved_at TIMESTAMP DEFAULT NOW(),
        data JSONB
      );
      CREATE TABLE IF NOT EXISTS app_storage (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='saved_posts' AND column_name='post_id') THEN
          ALTER TABLE saved_posts ADD COLUMN post_id TEXT UNIQUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='saved_posts' AND column_name='message') THEN
          ALTER TABLE saved_posts ADD COLUMN message TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='saved_posts' AND column_name='hook') THEN
          ALTER TABLE saved_posts ADD COLUMN hook TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='saved_posts' AND column_name='created_at') THEN
          ALTER TABLE saved_posts ADD COLUMN created_at TIMESTAMP DEFAULT NOW();
        END IF;
      END $$;
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_spy_processed_links_time ON spy_processed_links(time DESC);
      CREATE INDEX IF NOT EXISTS idx_spy_log_timestamp ON spy_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_saved_posts_saved_at ON saved_posts(saved_at DESC);
    `);
    console.log('✅ تم إنشاء/التحقق من جداول قاعدة البيانات بنجاح');
    return true;
  } catch (e) {
    console.error('❌ فشل إنشاء الجداول:', e.message);
    return false;
  }
}

async function query(text, params) {
  if (!pool) throw new Error('No database connection');
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.log(`⏱️  Slow query (${duration}ms): ${text.substring(0, 50)}...`);
    }
    return result;
  } catch (error) {
    console.error('❌ Database query error:', error.message);
    throw error;
  }
}

async function getConfig() {
  try {
    const result = await query('SELECT key, value FROM spy_config');
    const config = {};
    result.rows.forEach(row => {
      try {
        config[row.key] = JSON.parse(row.value);
      } catch {
        config[row.key] = row.value;
      }
    });
    return config;
  } catch (e) {
    console.log('⚠️ Failed to load config from database:', e.message);
    return {};
  }
}

async function saveConfig(config) {
  try {
    let savedCount = 0;
    for (const [key, value] of Object.entries(config)) {
      const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
      const result = await query(
        'INSERT INTO spy_config (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [key, valueStr]
      );
      savedCount++;
    }
    console.log(`✅ Saved ${savedCount} config entries to database`);
    return true;
  } catch (e) {
    console.log('❌ Failed to save config to database:', e.message);
    console.log('Error details:', e);
    return false;
  }
}

async function getAuthState() {
  try {
    const result = await query('SELECT * FROM spy_auth_state ORDER BY id DESC LIMIT 1');
    if (result.rows.length === 0) {
      return { step: 'idle', phoneCodeHash: null };
    }
    const row = result.rows[0];
    return {
      step: row.step,
      phoneCodeHash: row.phone_code_hash,
      phoneNumber: row.phone_number,
    };
  } catch (e) {
    console.log('⚠️ Failed to load auth state:', e.message);
    return { step: 'idle', phoneCodeHash: null };
  }
}

async function saveAuthState(state) {
  try {
    await query(
      'INSERT INTO spy_auth_state (step, phone_code_hash, phone_number, updated_at) VALUES ($1, $2, $3, NOW())',
      [state.step, state.phoneCodeHash, state.phoneNumber]
    );
    return true;
  } catch (e) {
    console.log('⚠️ Failed to save auth state:', e.message);
    return false;
  }
}

async function getProcessedLinks() {
  try {
    const now = Date.now();
    // Maximum retention = 168 hours (7 days) — matches the largest configurable cooldown
    const maxRetention = now - (168 * 60 * 60 * 1000);

    // Delete entries older than the maximum allowed cooldown
    await query('DELETE FROM spy_processed_links WHERE time < $1', [maxRetention]);

    const result = await query('SELECT link, time FROM spy_processed_links ORDER BY time DESC LIMIT 10000');
    return result.rows.map(row => ({ link: row.link, time: row.time }));
  } catch (e) {
    console.log('⚠️ Failed to load processed links:', e.message);
    return [];
  }
}

async function addProcessedLink(link) {
  try {
    await query(
      'INSERT INTO spy_processed_links (link, time) VALUES ($1, $2) ON CONFLICT (link) DO NOTHING',
      [link, Date.now()]
    );
    return true;
  } catch (e) {
    console.log('⚠️ Failed to add processed link:', e.message);
    return false;
  }
}

async function isLinkProcessed(link, cooldownMs) {
  try {
    if (cooldownMs && Number.isFinite(cooldownMs) && cooldownMs > 0) {
      const cutoff = Date.now() - cooldownMs;
      const result = await query(
        'SELECT id FROM spy_processed_links WHERE link = $1 AND time >= $2 LIMIT 1',
        [link, cutoff]
      );
      return result.rows.length > 0;
    }
    const result = await query('SELECT id FROM spy_processed_links WHERE link = $1 LIMIT 1', [link]);
    return result.rows.length > 0;
  } catch (e) {
    console.log('⚠️ Failed to check processed link:', e.message);
    return false;
  }
}

async function addLogEntry(entry) {
  try {
    await query(
      `INSERT INTO spy_log (source, original_link, affiliate_link, title, price, status, error, timestamp, data) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
      [
        entry.source,
        entry.originalLink,
        entry.affiliateLink,
        entry.title,
        entry.price,
        entry.status,
        entry.error,
        JSON.stringify(entry)
      ]
    );
    return true;
  } catch (e) {
    console.log('⚠️ Failed to add log entry:', e.message);
    return false;
  }
}

async function deleteLogEntry(id) {
  try {
    await query('DELETE FROM spy_log WHERE id = $1', [id]);
    return true;
  } catch (e) {
    console.log('⚠️ Failed to delete log entry:', e.message);
    return false;
  }
}

async function clearLog() {
  try {
    await query('DELETE FROM spy_log', []);
    return true;
  } catch (e) {
    console.log('⚠️ Failed to clear log:', e.message);
    return false;
  }
}

async function getLog(limit = 200) {
  try {
    const result = await query(
      'SELECT * FROM spy_log ORDER BY timestamp DESC LIMIT $1',
      [limit]
    );
    return result.rows.map(row => {
      let extraData = {};
      try {
        if (row.data) {
          extraData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        }
      } catch {}
      return {
        id: row.id,
        source: row.source,
        originalLink: row.original_link,
        affiliateLink: row.affiliate_link,
        title: row.title,
        price: row.price,
        status: row.status,
        error: row.error,
        timestamp: row.timestamp,
        image: extraData.image || null,
        targets: extraData.targets || [],
        message: extraData.message || null,
      };
    });
  } catch (e) {
    console.log('⚠️ Failed to load log:', e.message);
    return [];
  }
}

async function getTelegramSession(key = 'default') {
  try {
    const result = await query('SELECT session_data FROM telegram_session WHERE session_key = $1', [key]);
    if (result.rows.length === 0) return '';
    return result.rows[0].session_data;
  } catch (e) {
    console.log('⚠️ Failed to load telegram session:', e.message);
    return '';
  }
}

async function saveTelegramSession(sessionData, key = 'default') {
  try {
    await query(
      'INSERT INTO telegram_session (session_key, session_data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (session_key) DO UPDATE SET session_data = $2, updated_at = NOW()',
      [key, sessionData]
    );
    return true;
  } catch (e) {
    console.log('⚠️ Failed to save telegram session:', e.message);
    return false;
  }
}

async function saveGeminiKeys(keys) {
  try {
    await query('BEGIN');
    await query('DELETE FROM gemini_keys');
    for (let i = 0; i < keys.length; i++) {
      await query(
        'INSERT INTO gemini_keys (key_index, api_key) VALUES ($1, $2)',
        [i, keys[i]]
      );
    }
    await query('COMMIT');
    return true;
  } catch (e) {
    try { await query('ROLLBACK'); } catch (re) {}
    console.log('⚠️ Failed to save gemini keys:', e.message);
    return false;
  }
}

async function getGeminiKeys() {
  try {
    const result = await query('SELECT api_key FROM gemini_keys ORDER BY key_index ASC');
    return result.rows.map(row => row.api_key);
  } catch (e) {
    console.log('⚠️ Failed to load gemini keys:', e.message);
    return [];
  }
}

async function addSavedPost(post) {
  try {
    const postId = post.id || post.post_id || Date.now().toString();
    const savedAt = post.savedAt || post.createdAt || new Date().toISOString();
    await query(
      `INSERT INTO saved_posts (post_id, channel_id, title, price, link, affiliate_link, image_url, coupon, message, hook, saved_at, created_at, data) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)
       ON CONFLICT (post_id) DO NOTHING`,
      [
        postId,
        post.channelId || post.channel_id || null,
        post.title,
        post.price,
        post.link,
        post.affiliateLink || post.affiliate_link || null,
        post.image || post.imageUrl || post.image_url || null,
        post.coupon || null,
        post.message || null,
        post.hook || null,
        savedAt,
        JSON.stringify(post)
      ]
    );
    return true;
  } catch (e) {
    console.log('⚠️ Failed to save post:', e.message);
    return false;
  }
}

async function getSavedPosts(limit = null) {
  try {
    const sql = limit ? 'SELECT * FROM saved_posts ORDER BY saved_at DESC LIMIT $1' : 'SELECT * FROM saved_posts ORDER BY saved_at DESC';
    const params = limit ? [limit] : [];
    const result = await query(sql, params);
    return result.rows.map(row => ({
      id: row.post_id || String(row.id),
      title: row.title,
      price: row.price,
      link: row.link,
      image: row.image_url,
      coupon: row.coupon,
      message: row.message,
      hook: row.hook,
      createdAt: row.created_at || row.saved_at,
      savedAt: row.saved_at,
    }));
  } catch (e) {
    console.log('⚠️ Failed to load saved posts:', e.message);
    return [];
  }
}

async function deleteSavedPostsBefore(date) {
  try {
    await query('DELETE FROM saved_posts WHERE COALESCE(created_at, saved_at) < $1', [date]);
    return true;
  } catch (e) {
    console.log('⚠️ Failed to delete saved posts before date:', e.message);
    return false;
  }
}

async function deleteSavedPost(postId) {
  try {
    await query('DELETE FROM saved_posts WHERE post_id = $1', [postId]);
    return true;
  } catch (e) {
    console.log('⚠️ Failed to delete saved post:', e.message);
    return false;
  }
}

async function clearSavedPosts() {
  try {
    await query('DELETE FROM saved_posts');
    return true;
  } catch (e) {
    console.log('⚠️ Failed to clear saved posts:', e.message);
    return false;
  }
}

async function setAppStorage(key, value) {
  try {
    await query(
      'INSERT INTO app_storage (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      [key, value]
    );
    return true;
  } catch (e) {
    console.log('⚠️ Failed to set app storage:', e.message);
    return false;
  }
}

async function getAppStorage(key) {
  try {
    const result = await query('SELECT value FROM app_storage WHERE key = $1', [key]);
    if (result.rows.length === 0) return null;
    return result.rows[0].value;
  } catch (e) {
    console.log('⚠️ Failed to get app storage:', e.message);
    return null;
  }
}

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
  deleteSavedPost,
  clearSavedPosts,
  setAppStorage,
  getAppStorage,
  closePool: async () => { if (pool) { await pool.end(); console.log('🔌 Database pool closed'); } },
};
