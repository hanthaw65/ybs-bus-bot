// One-time setup helper: sets the Telegram webhook to this site's bot
// function, calling Telegram from Netlify's IP (the Muse VM IP is
// rate-limited by Telegram with 429). DELETE this file after the webhook
// is confirmed set — it only ever sets the webhook to our own URL.
exports.handler = async (event) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }) };
  const host = event.headers.host || event.headers.Host;
  const webhookUrl = `https://${host}/.netlify/functions/telegram`;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`,
      { signal: AbortSignal.timeout(10000) }
    );
    const body = await res.text();
    let info = null;
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(10000) });
      info = await r.json();
    } catch (e) {
      info = { error: String(e.message || e) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setWebhook: JSON.parse(body), webhookInfo: info }, null, 2),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
