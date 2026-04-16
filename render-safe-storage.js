const fs = require('fs');
const path = require('path');
const db = require('./db');

class RenderSafeStorage {
  constructor(name) {
    this.name = name;
    this.filePath = path.join(__dirname, `${name}.json`);
    this.memoryCache = null;
  }

  async load() {
    // Try to load from environment variable first (for Render)
    const envKey = `${this.name.toUpperCase()}_DATA`;
    if (process.env[envKey]) {
      try {
        this.memoryCache = JSON.parse(process.env[envKey]);
        console.log(`✅ Loaded ${this.name} from environment`);
        return this.memoryCache;
      } catch (e) {
        console.log(`⚠️ Failed to parse ${this.name} from environment:`, e.message);
      }
    }

    // Try to load from database
    try {
      const result = await db.query(
        'SELECT value FROM app_storage WHERE key = $1',
        [this.name]
      );
      if (result.rows.length > 0) {
        this.memoryCache = JSON.parse(result.rows[0].value);
        console.log(`✅ Loaded ${this.name} from database`);
        return this.memoryCache;
      }
    } catch (e) {
      console.log(`⚠️ Failed to load ${this.name} from database:`, e.message);
    }

    // Fallback to file
    try {
      if (fs.existsSync(this.filePath)) {
        this.memoryCache = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        console.log(`✅ Loaded ${this.name} from file`);
        return this.memoryCache;
      }
    } catch (e) {
      console.log(`⚠️ Failed to load ${this.name} from file:`, e.message);
    }

    this.memoryCache = null;
    return null;
  }

  async save(data) {
    this.memoryCache = data;

    // Save to file (for development)
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.log(`⚠️ Failed to save ${this.name} to file:`, e.message);
    }

    // Save to database
    try {
      await db.query(
        `INSERT INTO app_storage (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [this.name, JSON.stringify(data)]
      );
      console.log(`✅ Saved ${this.name} to database`);
    } catch (e) {
      console.log(`⚠️ Failed to save ${this.name} to database:`, e.message);
    }

    return true;
  }

  getSync() {
    return this.memoryCache;
  }
}

module.exports = RenderSafeStorage;
