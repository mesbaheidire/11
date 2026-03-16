# AliExpress Affiliate Links Generator

## Overview
An Arabic-language web application for generating AliExpress affiliate links and publishing product offers to Telegram channels. The app is a PWA (Progressive Web App) that can be installed on mobile devices.

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
  - `manifest.json` - PWA manifest
  - `sw.js` - Service worker for offline support

## Tech Stack
- **Backend**: Node.js with Express
- **Frontend**: Vanilla HTML/CSS/JavaScript (PWA)
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
  - Posts stored in `saved_posts.json` (gitignored)
- **Channel Spy (تجسس على القنوات)** - Monitor competitor Telegram channels
  - Uses GramJS (Telegram MTProto) Userbot mode — monitors any public channel you're subscribed to without admin access
  - Auto-detect AliExpress links from source channel posts
  - Convert links to your own affiliate links automatically
  - Extract price from competitor posts, get product title and image from AliExpress API
  - **Comprehensive AI post analysis** — Gemini analyzes entire post to detect issues, quality, and provides recommendations
  - **AI-powered product info extraction** — Gemini analyzes post text to extract product name and type (phone vs other)
  - **AI-powered seller coupon extraction** — Automatically detects and extracts seller coupons from competitor posts
  - **AI failure diagnosis** — Provides detailed error reasons and suggestions for fixing problems
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
  - Activity log with full history
  - Auto-restart on server reboot
  - Authentication flow: API ID/Hash from my.telegram.org + phone verification
  - Session stored in `spy_session.json` (gitignored), config in `spy_config.json` (gitignored)

## Product Metadata Extraction
The app uses multiple fallback methods to extract product title and image:
1. **AliExpress API** - First attempt using internal API
2. **microlink.io API** - External API for reliable metadata extraction
3. **Web Scraping** - Multiple AliExpress domains with JSON parsing

## Environment Variables (Optional)
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `TELEGRAM_CHANNEL_ID` - Default channel ID
- `cook` - AliExpress cookie for affiliate generation
- `GEMINI_API_KEY` - Single or multiple keys (comma-separated) for AI features
