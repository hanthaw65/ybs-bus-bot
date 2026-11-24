# YBS Bus Bot 🚌

Telegram bot for Yangon YBS bus routes and stops — Burmese UI.

- Type a route number (`100`, `89`) → stop list, 20 per page, tap a stop number → map location
- Type a stop name (`ဆူးလေ`, `Sule`) → which routes pass through it
- `/route 100`, `/start`, `/help`

## Architecture

- **Netlify Functions webhook** — Netlify has no 24h server, so no polling.
  Telegram calls `/.netlify/functions/telegram` on every message.
- **No database, no Firebase** — bus data is static. Catalog + a compact
  stop index (1,376 distinct stop names) are bundled in `data/`; full route
  files are fetched on demand from GitHub raw and cached in memory (1h).
- **Free** — Netlify free tier, no Render worker needed.

## Data

Source: [hidecard/YBS-Bus-Data](https://github.com/hidecard/YBS-Bus-Data)
— 147 routes, 17,053 stops, verified 2026-11-24. Static data only:
no live tracking, no arrival times, no fares/schedules.
No license is set on the upstream repo — check before production use.

Regenerate the bundled index after upstream updates:

```
node scripts/generate-index.js
```

## Deploy

1. Create a bot with [@BotFather](https://t.me/BotFather) → `/newbot`, keep the token.
2. Push this repo to GitHub, create a Netlify site from it.
3. Netlify → Site settings → Environment variables → add
   `TELEGRAM_BOT_TOKEN` = the BotFather token (never in chat or code).
4. Deploy, then set the webhook (replace `TOKEN` and `SITE`):

```
https://api.telegram.org/botTOKEN/setWebhook?url=https://SITE.netlify.app/.netlify/functions/telegram
```

5. Test in Telegram: `/start`, `100`, `ဆူးလေ`.

## Test locally (no token needed)

```
npm test
```

Checks catalog (147 routes), route/stop search, live route fetch for
line 100 (104 stops, 6 pages), and Telegram's 64-byte callback limit.
