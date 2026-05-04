# AffiliDz — منصة أتمتة الأفلييت

## Overview
AffiliDz is an Arabic-language affiliate marketing automation platform specifically designed for Telegram channel owners targeting the Algerian market. The platform aims to streamline and automate various aspects of affiliate marketing, from content creation to multi-platform publishing. Key capabilities include affiliate link generation, competitor monitoring (spy), AI-powered content generation, image watermarking, automated publishing to Telegram and Facebook, and a Telegram Mini App store. It is built as a Progressive Web App (PWA) for mobile accessibility. The project envisions empowering Algerian affiliate marketers with advanced automation tools, enhancing their efficiency, and maximizing their reach and revenue within the local market.

## User Preferences
The user prefers to interact with the system through a PWA for mobile accessibility. They desire automated solutions for content creation and publishing, with a focus on ease of use for tasks like generating affiliate links, watermarking images, and scheduling posts. The user also values features that allow monitoring competitor channels and leveraging AI for product discovery and content refinement, specifically tailored to the Algerian dialect. They need a system that ensures persistent data storage and reliable operation, even under varying loads or environment configurations.

## System Architecture
AffiliDz is built with a Node.js Express backend and a vanilla HTML/CSS/JavaScript frontend, functioning as a PWA.

**UI/UX Decisions:**
The application utilizes a shared CSS design system (`public/modern-theme.css`) characterized by:
- Modern aesthetic with glass morphism, gradient buttons, and curved headers.
- Use of CSS variables for consistent theming (`--bg-primary`, `--accent-orange`, etc.).
- Reusable utility classes for common UI components (`.m-card`, `.m-btn-*`, `.m-input`).
- Focus-visible accessibility styles, smooth transitions, and responsive design.
- The Telegram Mini App store (`store.html`) and its analytics (`store-analytics.html`) use independent, Yassir-inspired purple themes.

**Technical Implementations & Feature Specifications:**
- **Affiliate Link Generation:** Integrates with AliExpress for generating affiliate links.
- **Image Processing:** Features include custom borders, logo watermarking (5 positions, 3 sizes), and various image fetching fallbacks (LinkPreview.xyz, Microlink.io, AliExpress API, OG image, direct download).
- **AI Integration:**
    - **Gemini AI:** Used for product discovery with keyword suggestions, product analysis (scoring, hooks in Algerian dialect), and refining user-written hooks.
    - **AI Key Rotation:** Supports automatic rotation of multiple Gemini API keys to manage quotas.
    - **AI-powered Extraction:** Unified Gemini analysis extracts product details, coupons, and product type from post text, with individual AI extractors and regex fallbacks.
- **Content Publishing & Scheduling:**
    - Automates publishing to Telegram channels and Facebook pages.
    - Supports post scheduling and auto-saving of published posts for republishing.
    - Features a 5-tier image fallback system for reliable visual content delivery in posts.
    - **Image safety**: Source-channel images are NEVER used as a fallback to avoid posting wrong/unrelated images (e.g. a pinned mining-machine photo for a smartwatch product). If no proper product image is found, the post is sent as text-only.
    - **Text sanitization**: CDN image URLs (ae-pic, aliexpress-media, alicdn, *.avif, *.webp, jpg_NNNxNNN) are stripped from incoming spy text before AI processing to prevent leaking raw image links into published posts. The smart sender no longer pastes the image URL into the message body when sendPhoto fails.
    - **Auto-Repost System:** Background scheduler that randomly republishes saved posts to Telegram at configurable intervals (1–1440 minutes). Config stored in `app_storage` key `auto_repost_config`. Tracks reposted IDs to avoid repeats, resets cycle when all posts are covered. Includes concurrency guard (`autoRepostBusy` flag) to prevent overlapping executions. UI panel in `saved-posts.html` with toggle, interval input, manual trigger, and reset. API: `GET/POST /api/auto-repost/config`, `POST /api/auto-repost/now`, `POST /api/auto-repost/reset`.
- **Competitor Monitoring (Channel Spy):**
    - Monitors public Telegram channels using GramJS (Userbot mode) without admin access.
    - Auto-detects and converts AliExpress links to user's affiliate links.
    - Extracts product information (price, title, image, coupons) using AI and various fallbacks.
    - Offers configurable message templates, duplicate link detection, random publish delays, daily limits, and manual review mode.
    - Provides owner notifications and a detailed activity log with republishing capabilities.
- **Video Generator:** A client-side TikTok/Reels video generator (`public/video-generator.html`) using Canvas and MediaRecorder. It supports multiple templates, durations, and aspect ratios, with custom background music integration and live preview.
- **Telegram Mini App Store:** A dedicated store interface with analytics.
- **Data Persistence:** Utilizes Neon PostgreSQL for storing critical data such as spy configurations, saved posts, Telegram sessions, and Gemini API keys. Database tables are auto-created on startup.
- **Credential Management:** Environment variables take priority over database and local file storage for credentials, ensuring secure and flexible deployment.
- **Excel Import:** Allows batch publishing of products via `.xlsx`/`.csv` files, supporting column mapping, message templating, and background processing with status tracking.

## External Dependencies
- **AliExpress API:** For product data retrieval, affiliate link generation, and product information.
- **Telegram Bot API:** For interacting with Telegram channels, sending messages, and managing bot operations.
- **GramJS (Telegram MTProto):** Used in Userbot mode for the channel spy feature to monitor public Telegram channels.
- **Google Gemini API:** For AI-powered features such as product discovery, content generation, and intelligent data extraction.
- **Facebook Graph API:** For automatically publishing content to Facebook pages.
- **microlink.io API:** An external service for reliable metadata and image extraction from URLs.
- **LinkPreview.xyz API:** Used as a fallback for extracting meta tags and images from URLs.
- **Neon PostgreSQL:** The primary database for persistent storage, including `spy_config`, `saved_posts`, `telegram_session`, and `app_storage`.
- **axios:** HTTP client for making API requests.
- **cheerio:** For parsing and manipulating HTML (used in web scraping fallbacks).
- **cors:** Middleware for enabling Cross-Origin Resource Sharing.
- **express:** Web framework for the backend server.
- **sharp:** Image processing library for tasks like watermarking and resizing.
- **telegraf:** Telegram bot framework.
- **xlsx:** Library for parsing Excel files in the Excel import feature.