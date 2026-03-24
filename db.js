const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
});

async function query(text, params) {
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
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    
    // Delete old entries
    await query('DELETE FROM spy_processed_links WHERE time < $1', [sevenDaysAgo]);
    
    // Get remaining
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

async function isLinkProcessed(link) {
  try {
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

async function getLog(limit = 200) {
  try {
    const result = await query(
      'SELECT * FROM spy_log ORDER BY timestamp DESC LIMIT $1',
      [limit]
    );
    return result.rows.map(row => ({
      source: row.source,
      originalLink: row.original_link,
      affiliateLink: row.affiliate_link,
      title: row.title,
      price: row.price,
      status: row.status,
      error: row.error,
      timestamp: row.timestamp,
    }));
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
    // Clear old keys
    await query('DELETE FROM gemini_keys');
    
    // Add new keys
    for (let i = 0; i < keys.length; i++) {
      await query(
        'INSERT INTO gemini_keys (key_index, api_key) VALUES ($1, $2)',
        [i, keys[i]]
      );
    }
    return true;
  } catch (e) {
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
    await query(
      `INSERT INTO saved_posts (channel_id, title, price, link, affiliate_link, image_url, coupon, saved_at, data) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
      [
        post.channelId || post.channel_id,
        post.title,
        post.price,
        post.link,
        post.affiliateLink || post.affiliate_link,
        post.imageUrl || post.image_url,
        post.coupon,
        JSON.stringify(post)
      ]
    );
    return true;
  } catch (e) {
    console.log('⚠️ Failed to save post:', e.message);
    return false;
  }
}

async function getSavedPosts(limit = 100) {
  try {
    const result = await query(
      'SELECT * FROM saved_posts ORDER BY saved_at DESC LIMIT $1',
      [limit]
    );
    return result.rows.map(row => ({
      id: row.id,
      channelId: row.channel_id,
      title: row.title,
      price: row.price,
      link: row.link,
      affiliateLink: row.affiliate_link,
      imageUrl: row.image_url,
      coupon: row.coupon,
      savedAt: row.saved_at,
    }));
  } catch (e) {
    console.log('⚠️ Failed to load saved posts:', e.message);
    return [];
  }
}

module.exports = {
  query,
  getConfig,
  saveConfig,
  getAuthState,
  saveAuthState,
  getProcessedLinks,
  addProcessedLink,
  isLinkProcessed,
  addLogEntry,
  getLog,
  getTelegramSession,
  saveTelegramSession,
  saveGeminiKeys,
  getGeminiKeys,
  addSavedPost,
  getSavedPosts,
};
