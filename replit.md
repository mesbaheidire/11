# AffiliDz — منصة أتمتة الأفلييت

## Overview
**AffiliDz** is an Arabic-language affiliate marketing automation platform for Telegram channel owners targeting the Algerian/DZD market. Features include affiliate link generation, competitor monitoring (spy), AI content generation, image watermarking, automated Telegram + Facebook publishing, and a Telegram Mini App store. The app is a PWA (Progressive Web App) that can be installed on mobile devices.

## Project Structure
- `server.js` - Main Express server entry point
- `afflink.js` - AliExpress affiliate link generation logic
- `scheduler.js` - Post scheduling functionality
- `aliexpress-api.js` - AliExpress API integration
- `index.js` - Telegram bot entry point
- `spy.js` - Channel spy module (monitor competitor channels)
- `public/` - Static frontend files
  - `index.html` - Main app interface
  - `spy.html` - Channel spy management page
  - `collections.html` - Collections page
  - `telegram.html` - Telegram publishing page
  - `video-generator.html` - مولّد فيديوهات TikTok/Reels تلقائي (Canvas + MediaRecorder، client-side)
    - يجلب بيانات المنتج من `/api/affiliate`، يحمّل الصورة عبر `/api/proxy-image` كـ fallback لتجاوز CORS
    - 3 قوالب (burst/story/minimal)، 3 مدد (10/15/30 ثانية)، 9:16 بدقة 540×960، 30fps
    - مخرج WebM (VP9/VP8 + Opus)، يدعم رفع موسيقى خلفية ودمجها عبر AudioContext
    - معاينة حية على Canvas + شريط تقدم أثناء التسجيل + زر تحميل بعد الانتهاء
  - `store.html` - Telegram Mini App store (Yassir-inspired purple theme)
  - `store-analytics.html` - Store analytics dashboard for admin
  - `saved-posts.html` - Saved posts management page
  - `manifest.json` - PWA manifest
  - `sw.js` - Service worker for offline support

## Tech Stack
- **Backend**: Node.js with Express
- **Frontend**: Vanilla HTML/CSS/JavaScript (PWA)
- **Design System**: `public/modern-theme.css` — shared CSS design tokens and utility classes
  - CSS variables: `--bg-primary`, `--accent-orange`, `--accent-purple`, `--accent-blue`, etc.
  - Reusable classes: `.m-card`, `.m-btn-*`, `.m-input`, `.m-toast`, `.m-glass-nav`
  - Glass morphism, gradient buttons with light overlay, curved headers with `::after` pseudo-element
  - Focus-visible accessibility styles, smooth transitions, responsive breakpoints
  - Imported by all dark-themed pages (index, telegram, spy, discover, saved-posts, collections, video-generator)
  - `store.html` and `store-analytics.html` use their own independent theme systems
- **Dependencies**: axios, cheerio, cors, express, sharp, telegraf

## Running the App
The app runs on port 5000 with the command:
```
npm start
```

## Features
- Generate AliExpress affiliate links
- Frame product images with custom borders
- **Logo Watermark** - Add channel logo as watermark to framed images
  - Upload PNG logo with transparent background
  - 5 position options (corners + center)
  - 3 size options (small, medium, large)
- Publish offers to Telegram channels
- Schedule posts for later
- PWA support for mobile installation
- **Discover Winning Products** - Search for hot products using AliExpress API with optional Gemini AI ranking
  - AI-powered keyword suggestions for Algerian market
  - Product analysis with AI scoring and hooks in Algerian dialect
  - Fallback mode works without Gemini API key
- **Gemini API Key Rotation** - Automatic switching between multiple API keys
  - Add multiple keys in Settings (comma-separated)
  - Auto-rotates to next key when quota is exceeded
  - Status display shows current key and total available
  - Keys stored securely in `gemini_keys.json` (gitignored)
- **AI Hook Refinement** - Improve user-written Algerian hooks with AI
  - Two buttons: "توليد (AI)" for generating new hooks, "تحسين (AI)" for refining existing ones
- **Saved Posts History** - Auto-save published posts for easy republishing
  - View all saved posts with thumbnails
  - One-click republish to Telegram
  - Edit saved posts before republishing
  - Posts stored in Neon PostgreSQL `saved_posts` table (persistent)
- **Channel Spy (تجسس على القنوات)** - Monitor competitor Telegram channels
  - Uses GramJS (Telegram MTProto) Userbot mode — monitors any public channel you're subscribed to without admin access
  - Auto-detect AliExpress links from source channel posts
  - Convert links to your own affiliate links automatically
  - Extract price from competitor posts, get product title and image from AliExpress API
  - **Unified Gemini analysis** — Single AI call (`/api/ai-analyze-post`) extracts productName, price, coupons[], sellerCoupon, sellerCouponCode, links[], isPhone from post text; `analyzePostFull()` in spy.js calls this once per post
  - **AI extraction hierarchy**: 1) Unified Gemini analysis, 2) Individual AI extractors (extractCouponWithAI, extractSellerCouponWithAI, extractPriceWithAI), 3) Regex fallbacks
  - **AI-powered product info extraction** — Gemini analyzes post text to extract product name and type (phone vs other)
  - **AI-powered seller coupon extraction** — Automatically detects and extracts seller coupons from competitor posts
  - AI-powered title refinement via Gemini (improves AliExpress product titles)
  - Publishes with AliExpress API image (not competitor's image) to target channels
  - Bot token and cookie used automatically from main app environment variables
  - Configurable message template with seller coupon field
  - Choose affiliate link type (Coin, Point, Super, Limited, Bundle)
  - Duplicate link detection — skips already-processed links (stored 7 days, file: `spy_processed.json`)
  - Random publish delay (configurable 1-60 min range) to avoid detection
  - Daily publish limit — configurable max posts per day (0 = unlimited), resets at midnight
  - Manual review mode — products sent to you via bot with "Publish"/"Skip" buttons before posting (30-min expiry)
  - Owner notifications — sends you a personal Telegram message when a new product is detected
  - Activity log with full history (images, targets, message stored for republishing)
  - **Republish buttons** — Each log entry with saved message data shows "إعادة نشر" (instant) and "نشر مؤجل" (delayed, user-specified minutes) buttons; republish targets are validated against configured target channels server-side
  - Auto-restart on server reboot
  - Authentication flow: API ID/Hash from my.telegram.org + phone verification
  - Session stored in PostgreSQL `telegram_session` table (with file fallback), config in `spy_config` table (with file fallback)
  - All async functions properly awaited (getBotToken, getCookie, loadConfig, saveConfig, loadAuthState, saveAuthState)
  - Config caching with `getCachedConfig()` for performance in synchronous contexts

- **Facebook Page Auto-Posting** - Automatically publish products to your Facebook Page
  - Requires Facebook Page Access Token and Page ID (permissions: pages_manage_posts, pages_read_engagement)
  - Posts with image + text + affiliate link
  - Verify token and test post from spy settings UI
  - Integrated with spy module — publishes to Facebook after Telegram
  - **Manual Facebook publish** from index.html, telegram.html, and saved-posts.html
  - Token masking in API responses; masked tokens never overwrite stored tokens
  - Settings stored in spy config (database)

## Product Metadata Extraction
The app uses multiple fallback methods to extract product title and image:
1. **AliExpress API** - First attempt using internal API
2. **microlink.io API** - External API for reliable metadata extraction
3. **Web Scraping** - Multiple AliExpress domains with JSON parsing
4. **LinkPreview.xyz API** - Fallback via `https://linkpreview.xyz/api/get-meta-tags?url=...` for meta tag extraction
5. **Mobile page fallback** - Direct scraping of AliExpress mobile pages

### Spy Image Fetching Chain (spy.js)
When processing spy posts, images are fetched in this priority order:
1. **LinkPreview.xyz** — `fetchImageViaLinkPreview()` direct call
2. **Microlink.io API** — `fetchImageViaMicrolink()` using mobile AliExpress URL
3. **AliExpress API** — `getProductDetails()` direct call from aliexpress-api.js
4. **og:image extraction** — `fetchOgImage()` from affiliate link HTML
5. **fetchLinkPreview()** — full wrapper from afflink.js (microlink + API + scraping + linkpreview)
6. **Download as Buffer** — convert any URL-only image to buffer via `downloadImageAsBuffer()`
7. **Source image** — original Telegram post image (last resort)

## Credential Loading Priority
Environment variables (Render) always take priority over database and local file storage:
1. **Environment variables** (Render / hosting platform) — always first
2. **Database** (app_storage table) — fallback
3. **Local file** (app_credentials.json) — last resort

## Environment Variables
### Required for Render/Production Deployment:
- `DATABASE_URL` - PostgreSQL connection string (auto-set by Render)
- `NEON_DATABASE_URL` - Neon PostgreSQL connection string (takes priority over DATABASE_URL)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` - Database credentials

### Optional (can be set as environment variables):
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `TELEGRAM_CHANNEL_ID` - Default channel ID
- `cook` - AliExpress cookie for affiliate generation
- `GEMINI_API_KEY` - Single or multiple keys (comma-separated) for AI features
- `SPY_CONFIG_DATA` - Spy configuration (JSON-encoded, stored in environment for Render)
- `SPY_SESSION_DATA` - Telegram session (stored in environment for Render)

## Database Schema
The app uses PostgreSQL with the following key tables:
- `spy_config` - Spy module configuration
- `spy_auth_state` - Telegram authentication state
- `spy_processed_links` - 7-day history of processed links
- `spy_log` - Activity log for spy operations
- `telegram_session` - Telegram user session
- `gemini_keys` - Gemini API keys storage
- `saved_posts` - User's saved posts
- `app_storage` - General key-value storage for Render compatibility

## Database / Storage
- **Neon PostgreSQL** - Primary persistent storage (free tier, always-on)
- `db.js` connects via `NEON_DATABASE_URL` (priority) or `DATABASE_URL`
- `initDatabase()` auto-creates all tables on startup
- Saved posts, spy config, credentials, sessions all stored in Neon DB
- No more file-based storage for saved posts (was `saved_posts.json`)
- SSL enabled for Neon (`rejectUnauthorized: false`)

## Render Deployment Notes
The app is **fully compatible with Render** and uses:
1. **Neon PostgreSQL** - For persistent data (survives restarts, free forever)
2. **Environment variables** - Set `DATABASE_URL` on Render to Neon connection string
3. Tables are auto-created on first startup

Set `DATABASE_URL` in Render Environment to your Neon connection string.
