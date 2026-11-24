// Local test of the Cloudflare Worker (no token, no deploy needed).
// Copies the worker to /tmp as .mjs, stubs Telegram API calls, and lets
// GitHub raw fetches go through for real.
import { copyFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

copyFileSync(
  '/home/hatch/workspace/ybs-bus-bot/cloudflare/src/index.js',
  '/tmp/test-worker.mjs'
);
const worker = (await import('/tmp/test-worker.mjs')).default;

const realFetch = global.fetch;
const calls = [];
// Our repo's data JSONs are not pushed yet, so serve them from disk;
// hidecard route files still fetch for real.
import { readFileSync } from 'node:fs';
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('hanthaw65/ybs-bus-bot/main/data/')) {
    const name = u.split('/').pop();
    return new Response(readFileSync(`/home/hatch/workspace/ybs-bus-bot/data/${name}`, 'utf8'), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (String(url).includes('api.telegram.org')) {
    calls.push({ url: String(url).split('/').pop().split('?')[0], body: opts?.body ? JSON.parse(opts.body) : null });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, opts);
};
const env = { TELEGRAM_BOT_TOKEN: 'FAKE:123' };
const post = (body) =>
  worker.fetch(new Request('https://worker.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, {});

let r = await worker.fetch(new Request('https://worker.test/', { method: 'GET' }), env, {});
console.log('GET /:', r.status, await r.text());
assert.equal(r.status, 200);

await post({ message: { chat: { id: 1 }, text: '/start' } });
console.log('start ->', calls[0].body.text.slice(0, 40));
assert.ok(calls[0].body.text.includes('YBS Bus Bot'));
calls.length = 0;

await post({ message: { chat: { id: 1 }, text: '100' } });
console.log('route 100 ->', calls[0].body.text.split('\n')[0], '| buttons:', calls[0].body.reply_markup.inline_keyboard.length, 'rows');
assert.ok(calls[0].body.text.includes('YBS 100'));
const cbData = calls[0].body.reply_markup.inline_keyboard[0][0].callback_data;
calls.length = 0;

await post({ callback_query: { id: 'q1', data: cbData, message: { chat: { id: 1 }, message_id: 10 } } });
console.log('stop tap ->', calls.map((c) => c.url + (c.body?.latitude ? ` lat=${c.body.latitude}` : '')));
assert.ok(calls.some((c) => c.url === 'sendLocation'));
calls.length = 0;

await post({ message: { chat: { id: 1 }, text: 'ဆူးလေ' } });
console.log('sule ->', calls[0].body.text.split('\n')[0]);
assert.ok(calls[0].body.text.includes('ဆူးလေမြို့တော်ခန်းမ'));
calls.length = 0;

await post({ message: { chat: { id: 1 }, text: '89' } });
console.log('89 -> buttons:', calls[0].body.reply_markup.inline_keyboard.length);
assert.equal(calls[0].body.reply_markup.inline_keyboard.length, 3);
calls.length = 0;

await post({ message: { chat: { id: 1 }, text: 'zzzzqqq' } });
assert.ok(calls[0].body.text.includes('မတွေ့ဘူး'));
console.log('no-match -> ok');

console.log('\nAll worker tests passed.');
