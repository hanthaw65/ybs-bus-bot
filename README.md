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

## Deploy — Cloudflare Workers (current)

1. Create a bot with [@BotFather](https://t.me/BotFather) → `/newbot`, keep the token.
2. Cloudflare dashboard → Workers & Pages → Create Worker from this GitHub
   repo (branch `main`, `wrangler.toml` at the root).
3. Worker Settings → Variables → add secret `TELEGRAM_BOT_TOKEN`.
4. Open `https://<worker>.workers.dev/setup` once — it sets the webhook to
   the Worker itself (calling Telegram from Cloudflare's IP) and reports
   the result. Test in Telegram: `/start`, `100`, `ဆူးလေ`.

## Deploy — Netlify (fallback, kept)

Same bot code lives in `netlify/functions/telegram.js`. Create a Netlify
site from this repo, set env var `TELEGRAM_BOT_TOKEN`, deploy, then set
the webhook to `https://<site>.netlify.app/.netlify/functions/telegram`.
`netlify/functions/setup-webhook.js` is a one-time helper for that —
delete it once the webhook is confirmed on either host.

## Test locally (no token needed)

```
npm test
```

Checks catalog (147 routes), route/stop search, live route fetch for
line 100 (104 stops, 6 pages), and Telegram's 64-byte callback limit.
