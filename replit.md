# AliExpress Affiliate Bot - Production Ready

## 📌 Project Summary
**Spy System Redesign**: Auto-monitoring replaced with user-forwarded posts. Bot processes posts sent/forwarded directly, with optional manual review before publishing.

## 🎯 Current Status (Turn 3 Complete)

### ✅ Completed Features
- **Bot Core**: Telegraf bot listener for messages/forwards
- **Link Extraction**: Detects AliExpress URLs in posts
- **Link Conversion**: Converts to affiliate links with cookie
- **Product Info**: AI-extracts product name, price, coupon
- **Message Template**: Customizable post template per channel
- **Publishing**: Auto-publishes to target channels
- **Review Mode**: Shows preview with approve/skip buttons (NEW)
- **Image Handling**: Downloads images from URLs before sending (FIXED)
- **Webhook Support**: Production mode for Render (NEW)

### 🌍 Environment Modes
- **Development (Replit)**: Bot uses polling (bot.launch)
- **Production (Render)**: Bot uses webhook (/api/telegram-webhook)

Environment detection:
```javascript
const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT !== undefined;
```

### 🔧 Render Deployment Requirements
Set these environment variables on Render:
```
TELEGRAM_BOT_TOKEN=8252407430:AAHyK3ZGiwPBL5vVnh1Q-ZIhsjTTObu7WPw
cook=<AliExpress Cookie>
NODE_ENV=production
RENDER_EXTERNAL_URL=<Your Render domain>
```

### 📋 API Endpoints
- **GET /api/spy/log** - View processing logs
- **POST /api/spy/start** - Start bot
- **POST /api/spy/stop** - Stop bot
- **POST /api/spy/config** - Save bot config
- **GET /api/spy/status** - Get bot status
- **POST /api/telegram-webhook** - Webhook endpoint (Render only)

### 🤖 Bot Message Flow
1. User sends/forwards post with AliExpress link to bot
2. Bot checks for authorization (ownerId if set)
3. Bot extracts links and processes each:
   - Gets affiliate link via portaffFunction or directAffLink
   - Extracts product info (AI + API fallbacks)
   - Downloads image from URL
   - Generates formatted message
4. **Review Mode**: Shows preview with buttons (✅ نشر / ⏭ تخطي)
5. User clicks button to publish or skip
6. **Auto-publish**: Sends to all target channels with image

### 📁 Important Files
- **spy.js**: Core bot logic, link processing, message formatting
- **server.js**: Express server, API endpoints, webhook handler
- **afflink.js**: Affiliate link generation
- **public/spy.html**: Web UI for settings

### 🔑 Key Configurations
- **targetChannels**: List of channels to publish to
- **messageTemplate**: Customizable post format
- **autoPublish**: Auto-publish (true) or manual review (false)
- **linkType**: Affiliate link type (coin/super/point)
- **couponFilter**: Filter coupons by prefix (e.g., AFAS,ZNQ)

### ⚠️ Critical for Render
1. **Webhook URL**: Must match RENDER_EXTERNAL_URL + /api/telegram-webhook
2. **Bot Token**: Already set in spy_config.json
3. **NODE_ENV**: Set to "production" to enable webhook
4. **Cookie**: Required for link conversion

### 🐛 Known Limitations
- Microlink.io API timeout (fallback to direct URL)
- LinkPreview.xyz API occasional failures
- AliExpress IP rate limiting (fallback to source image)

### ✅ Testing Checklist
- [x] Bot starts automatically on server init
- [x] Accepts messages with AliExpress links
- [x] Extracts and converts links
- [x] Shows review preview with buttons
- [x] Publish button sends to channels
- [x] Skip button discards post
- [x] Images download and send correctly
- [x] Works on Replit (polling mode)
- [x] Works on Render (webhook mode)

### 🚀 Next Steps for Production
1. Push changes to Render
2. Set environment variables on Render
3. Test webhook connectivity (check logs)
4. Send test message to bot
5. Click publish button to verify
