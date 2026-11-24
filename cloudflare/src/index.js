/**
 * YBS Bus Bot — Cloudflare Workers Edition (Fixed & Production-Ready)
 *
 * Fixes included:
 * 1. Fixes Telegram 64-byte callback_data overflow on Burmese stop searches
 *    (e.g. "လှည်းတန်း", "မြေနီကုန်း", "အင်းစိန်") by using compact `stopidx:<index>` callbacks.
 * 2. Uses ctx.waitUntil() so Telegram receives immediate 200 OK without duplicate retries.
 * 3. Supports optional WEBHOOK_SECRET to protect both POST / and GET /setup.
 * 4. Supports optional DATA_BASE_URL env var if your GitHub repo/branch name changes.
 * 5. Handles /start@bot, empty route links, missing coordinates, and data-fetch errors cleanly.
 *
 * === Cloudflare Worker Variables / Secrets ===
 * - TELEGRAM_BOT_TOKEN (Secret, Required): Token from @BotFather
 * - WEBHOOK_SECRET     (Secret, Optional): Random string to protect /setup and webhook
 * - DATA_BASE_URL      (Var, Optional)   : Default https://raw.githubusercontent.com/hanthaw65/ybs-bus-bot/main/data
 */

const DEFAULT_DATA_BASE =
  'https://raw.githubusercontent.com/hanthaw65/ybs-bus-bot/main/data';
const HIDE_CARD_BASE =
  'https://raw.githubusercontent.com/hidecard/YBS-Bus-Data/main/';
const PAGE_SIZE = 20;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cached = null; // { at, base, routes, stops }
const routeCache = new Map(); // data_file -> { at, data }

async function loadData(env) {
  const base = (env.DATA_BASE_URL || DEFAULT_DATA_BASE).replace(/\/+$/, '');
  const now = Date.now();
  if (cached && cached.base === base && now - cached.at < CACHE_TTL_MS) {
    return cached;
  }

  const [catRes, idxRes] = await Promise.all([
    fetch(`${base}/routes.json`, { cf: { cacheTtl: 3600 } }),
    fetch(`${base}/stops-index.json`, { cf: { cacheTtl: 3600 } }),
  ]);

  if (!catRes.ok || !idxRes.ok) {
    throw new Error(
      `Data fetch failed (routes=${catRes.status}, stops=${idxRes.status}). Check that the GitHub repo is Public.`
    );
  }

  const [catalog, index] = await Promise.all([catRes.json(), idxRes.json()]);
  cached = {
    at: now,
    base,
    routes: catalog.routes || [],
    stops: index.stops || [],
  };
  return cached;
}

async function fetchRoute(dataFile) {
  if (!dataFile) throw new Error('Missing route data_file');
  const now = Date.now();
  const hit = routeCache.get(dataFile);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.data;

  const res = await fetch(HIDE_CARD_BASE + dataFile, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${dataFile}`);
  const data = await res.json();
  routeCache.set(dataFile, { at: now, data });
  return data;
}

function dedupeRoutes(routes) {
  const seen = new Set();
  const out = [];
  for (const r of routes) {
    const key = `${r.bus_line}||${r.line_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function findRoutes(routes, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const ql = q.toLowerCase();
  const exact = routes.filter((r) => (r.bus_line || '').toLowerCase() === ql);
  if (exact.length) return dedupeRoutes(exact);
  const prefix = routes.filter((r) => (r.bus_line || '').toLowerCase().startsWith(ql));
  if (prefix.length) return dedupeRoutes(prefix);
  return dedupeRoutes(
    routes.filter((r) => (r.bus_line || '').toLowerCase().includes(ql))
  );
}

function findExactStop(stops, query) {
  const q = String(query || '').trim();
  const ql = q.toLowerCase();
  return stops.find((s) => s.mm === q || (s.en || '').toLowerCase() === ql) || null;
}

/**
 * Returns matched stops along with their exact index in `stops`
 * so callback_data can use compact `stopidx:<idx>` (<= 12 bytes).
 */
function searchStops(stops, query, limit = 10) {
  const q = String(query || '').trim();
  if (!q || q.length < 2) return [];
  const ql = q.toLowerCase();
  const scored = [];

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const mm = s.mm || '';
    const en = (s.en || '').toLowerCase();
    let score = -1;
    if (mm === q || en === ql) score = 0;
    else if (mm.startsWith(q) || en.startsWith(ql)) score = 1;
    else if (mm.includes(q) || en.includes(ql)) score = 2;
    if (score >= 0) scored.push({ score, stop: s, idx: i });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (a.stop.mm || a.stop.en || '').localeCompare(b.stop.mm || b.stop.en || '')
  );
  return scored.slice(0, limit);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatRoutePage(routeData, page) {
  const stops = routeData.stops || [];
  const info = routeData.route_info || {};
  const totalPages = Math.max(1, Math.ceil(stops.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = stops.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);

  const lines = [];
  lines.push(`🚌 <b>YBS ${escapeHtml(routeData.bus_line || '')}</b>`);
  if (info['Line Name']) lines.push(escapeHtml(info['Line Name']));
  lines.push(
    `မှတ်တိုင် ${stops.length} ခု · စာမျက်နှာ ${p + 1}/${totalPages}` +
      (info['QR Payment'] ? ` · QR: ${escapeHtml(info['QR Payment'])}` : '')
  );
  lines.push('');
  for (const s of slice) {
    lines.push(
      `${s.index}. ${escapeHtml(s.stop_name_mm || '')} (${escapeHtml(s.stop_name_en || '')})`
    );
  }
  lines.push('');
  lines.push('မှတ်တိုင်နံပါတ်ကို နှိပ်ရင် မြေပုံတည်နေရာ ပြမယ်။');
  lines.push('⚠️ Static data ပါ — ကားအချိန်နဲ့ live မဟုတ်ပါ။');
  return { text: lines.join('\n'), page: p, totalPages };
}

const WELCOME =
  '🚌 <b>YBS Bus Bot မှ ကြိုဆိုပါတယ်</b>\n\n' +
  'ရန်ကုန် YBS ဘတ်စ်ကားလိုင်းနဲ့ မှတ်တိုင်တွေ ရှာလို့ရပါတယ်။\n\n' +
  '• လိုင်းနံပါတ် ရိုက်ပါ — ဥပမာ <code>100</code>၊ <code>89</code>\n' +
  '• မှတ်တိုင်အမည် ရိုက်ပါ — ဥပမာ <code>ဆူးလေ</code>၊ <code>လှည်းတန်း</code>၊ <code>Sule</code>\n\n' +
  '⚠️ Static data ပါ — ကားဘယ်အချိန်ရောက်မလဲ၊ live တည်နေရာ မပြပါ။\n' +
  'Data: hidecard/YBS-Bus-Data (GitHub)';

const HELP =
  '🚌 <b>အသုံးပြုနည်း</b>\n\n' +
  '• <code>/route 100</code> — လိုင်း 100 ရဲ့ မှတ်တိုင်စာရင်း\n' +
  '• <code>100</code> — လိုင်းနံပါတ်ကို တိုက်ရိုက်ရိုက်လည်း ရတယ်\n' +
  '• <code>ဆူးလေ</code> / <code>Sule</code> — မှတ်တိုင်အမည်နဲ့ ရှာမယ်၊ ဘယ်လိုင်းတွေ ဖြတ်လဲ ပြမယ်\n' +
  '• လိုင်းစာရင်းထဲက မှတ်တိုင်နံပါတ်ကို နှိပ်ရင် မြေပုံတည်နေရာ ပို့ပေးမယ်\n\n' +
  'လိုင်းတစ်ခုမှာ ပုံစံကွဲတွေ ရှိနိုင်တယ် (ဥပမာ 89 က 3 မျိုး) — အဲဒီအခါ ရွေးခိုင်းမယ်။';

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔍 လိုင်းရှာမယ်', callback_data: 'menu:routes' },
        { text: '📍 မှတ်တိုင်ရှာမယ်', callback_data: 'menu:stops' },
      ],
      [{ text: 'ℹ️ အကူအညီ', callback_data: 'menu:help' }],
    ],
  };
}

async function tg(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300);
    if (!errText.includes('message is not modified')) {
      console.error('Telegram API error', method, res.status, errText);
    }
  }
  return res;
}

const sendMessage = (token, chatId, text, extra = {}) =>
  tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

const editMessage = (token, chatId, messageId, text, extra = {}) =>
  tg(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });

const answerCallback = (token, id, text) =>
  tg(token, 'answerCallbackQuery', { callback_query_id: id, text: text || '' });

function routeKeyboard(routeData, page, totalPages) {
  const rows = [];
  const stops = routeData.stops || [];
  const slice = stops.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const encodedFile = encodeURIComponent(routeData._file);

  for (let i = 0; i < slice.length; i += 5) {
    rows.push(
      slice.slice(i, i + 5).map((s) => ({
        text: String(s.index),
        callback_data: `stop:${s.index}:${encodedFile}`,
      }))
    );
  }

  const nav = [];
  if (page > 0) {
    nav.push({ text: '◀️ အရင်', callback_data: `route:${encodedFile}:${page - 1}` });
  }
  if (page < totalPages - 1) {
    nav.push({ text: 'နောက် ▶️', callback_data: `route:${encodedFile}:${page + 1}` });
  }
  if (nav.length) rows.push(nav);
  rows.push([{ text: '🔙 Menu', callback_data: 'menu:home' }]);
  return { inline_keyboard: rows };
}

async function showRoute(token, routes, chatId, messageId, dataFile, page, edit) {
  const meta = routes.find((r) => r.data_file === dataFile);
  let data;
  try {
    data = await fetchRoute(dataFile);
  } catch (e) {
    console.error('fetchRoute failed', dataFile, e.message);
    const text = '⚠️ Data ယူလို့ မရသေးဘူး။ ခဏနေမှ ပြန်စမ်းကြည့်ပါ။';
    if (edit) await editMessage(token, chatId, messageId, text);
    else await sendMessage(token, chatId, text);
    return;
  }

  const viewData = {
    ...data,
    _file: dataFile,
    bus_line: meta ? meta.bus_line : data.bus_line,
  };
  const { text, page: p, totalPages } = formatRoutePage(viewData, page);
  const keyboard = routeKeyboard(viewData, p, totalPages);
  if (edit) await editMessage(token, chatId, messageId, text, { reply_markup: keyboard });
  else await sendMessage(token, chatId, text, { reply_markup: keyboard });
}

function routeByFileForLine(routes, r) {
  const candidates = findRoutes(routes, r.line);
  const byName = candidates.find((c) => c.line_name === r.line_name);
  const chosen = byName || candidates[0];
  return chosen ? chosen.data_file : '';
}

async function sendStopRoutes(token, routes, chatId, stop) {
  const stopRoutes = stop.routes || [];
  const lines = [
    `📍 <b>${escapeHtml(stop.mm || '')}</b> (${escapeHtml(stop.en || '')})`,
    `ဖြတ်သန်းတဲ့ လိုင်း ${stopRoutes.length} ခု:`,
    '',
  ];

  const buttons = [];
  for (const r of stopRoutes.slice(0, 20)) {
    const file = routeByFileForLine(routes, r);
    if (!file) continue;
    buttons.push([
      {
        text: `${r.line} — ${r.line_name || ''}`.slice(0, 60),
        callback_data: `route:${encodeURIComponent(file)}:0`,
      },
    ]);
  }

  const extra = buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {};
  await sendMessage(token, chatId, lines.join('\n'), extra);
}

async function handleText(token, data, chatId, text) {
  const { routes, stops } = data;
  const q = text.trim();
  if (!q) return;

  if (/^\/start(?:@\w+)?(?:\s.*)?$/i.test(q)) {
    await sendMessage(token, chatId, WELCOME, { reply_markup: mainKeyboard() });
    return;
  }
  if (/^\/help(?:@\w+)?$/i.test(q)) {
    await sendMessage(token, chatId, HELP, { reply_markup: mainKeyboard() });
    return;
  }

  const routeArg = q.match(/^\/route(?:@\w+)?\s+(.+)$/i);
  const query = routeArg ? routeArg[1].trim() : q;

  if (!routeArg) {
    const exactStop = findExactStop(stops, query);
    if (exactStop) {
      await sendStopRoutes(token, routes, chatId, exactStop);
      return;
    }
  }

  const found = findRoutes(routes, query);
  if (found.length === 1) {
    await showRoute(token, routes, chatId, null, found[0].data_file, 0, false);
    return;
  }
  if (found.length > 1) {
    const keyboard = {
      inline_keyboard: found.slice(0, 20).map((r) => [
        {
          text: `${r.bus_line} — ${r.line_name || ''}`.slice(0, 60),
          callback_data: `route:${encodeURIComponent(r.data_file)}:0`,
        },
      ]),
    };
    await sendMessage(
      token,
      chatId,
      `🚌 <b>“${escapeHtml(query)}”</b> နဲ့ ကိုက်ညီတဲ့ လိုင်း ${found.length} ခု တွေ့တယ် — တစ်ခုရွေးပါ:`,
      { reply_markup: keyboard }
    );
    return;
  }

  const matched = searchStops(stops, query, 10);
  if (matched.length === 0) {
    await sendMessage(
      token,
      chatId,
      `😕 “${escapeHtml(query)}” နဲ့ ကိုက်ညီတဲ့ လိုင်းနဲ့ မှတ်တိုင် မတွေ့ဘူး။\nလိုင်းနံပါတ် (ဥပမာ 100) ဒါမှမဟုတ် မှတ်တိုင်အမည် အပြည့်အစုံ ရိုက်ကြည့်ပါ။`,
      { reply_markup: mainKeyboard() }
    );
    return;
  }
  if (matched.length === 1) {
    await sendStopRoutes(token, routes, chatId, matched[0].stop);
    return;
  }

  // Uses compact `stopidx:<index>` so Burmese queries never exceed Telegram's 64-byte limit
  const keyboard = {
    inline_keyboard: matched.map(({ stop: s, idx }) => [
      {
        text: `${s.mm || s.en} (${s.en || ''}) — ${(s.routes || []).length} လိုင်း`.slice(0, 60),
        callback_data: `stopidx:${idx}`,
      },
    ]),
  };
  await sendMessage(
    token,
    chatId,
    `📍 <b>“${escapeHtml(query)}”</b> နဲ့ ကိုက်ညီတဲ့ မှတ်တိုင် ${matched.length} ခု — တစ်ခုရွေးပါ:`,
    { reply_markup: keyboard }
  );
}

async function handleCallback(token, data, cb) {
  if (!cb.message) {
    await answerCallback(token, cb.id);
    return;
  }

  const { routes, stops } = data;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const cbData = cb.data || '';
  await answerCallback(token, cb.id);

  const [kind, ...rest] = cbData.split(':');

  if (kind === 'menu') {
    if (rest[0] === 'home') {
      await editMessage(token, chatId, messageId, WELCOME, { reply_markup: mainKeyboard() });
    } else if (rest[0] === 'help') {
      await editMessage(token, chatId, messageId, HELP, { reply_markup: mainKeyboard() });
    } else if (rest[0] === 'routes') {
      await sendMessage(token, chatId, '🔍 လိုင်းနံပါတ် ရိုက်ပါ — ဥပမာ <code>100</code>၊ <code>89</code>');
    } else if (rest[0] === 'stops') {
      await sendMessage(token, chatId, '📍 မှတ်တိုင်အမည် ရိုက်ပါ — ဥပမာ <code>ဆူးလေ</code>၊ <code>လှည်းတန်း</code>၊ <code>Sule</code>');
    }
    return;
  }

  if (kind === 'route') {
    const dataFile = decodeURIComponent(rest[0] || '');
    const page = parseInt(rest[1] || '0', 10) || 0;
    await showRoute(token, routes, chatId, messageId, dataFile, page, true);
    return;
  }

  if (kind === 'stopidx') {
    const idx = parseInt(rest[0] || '-1', 10);
    if (idx >= 0 && stops[idx]) {
      await sendStopRoutes(token, routes, chatId, stops[idx]);
    }
    return;
  }

  // Backward compatibility for older `pickstop:` messages already in chat history
  if (kind === 'pickstop') {
    const idx = parseInt(rest[0] || '0', 10) || 0;
    const query = decodeURIComponent(rest[1] || '');
    const matched = searchStops(stops, query, 10);
    if (matched[idx]) await sendStopRoutes(token, routes, chatId, matched[idx].stop);
    return;
  }

  if (kind === 'stop') {
    const stopIndex = rest[0];
    const dataFile = decodeURIComponent(rest[1] || '');
    try {
      const routeData = await fetchRoute(dataFile);
      const stop = (routeData.stops || []).find((s) => String(s.index) === String(stopIndex));
      if (!stop) {
        await sendMessage(token, chatId, '😕 အဲဒီမှတ်တိုင် မတွေ့ဘူး။');
        return;
      }

      const lat = Number(stop.latitude);
      const lng = Number(stop.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        await tg(token, 'sendLocation', { chat_id: chatId, latitude: lat, longitude: lng });
      }

      await sendMessage(
        token,
        chatId,
        `📍 <b>${escapeHtml(stop.stop_name_mm || '')}</b> (${escapeHtml(stop.stop_name_en || '')})\n` +
          `လိုင်း ${escapeHtml(routeData.bus_line || '')} · မှတ်တိုင် ${escapeHtml(stop.index)}\n` +
          (stop.road ? `${escapeHtml(stop.road)}\n` : '') +
          (Number.isFinite(lat) && Number.isFinite(lng) ? `${lat}, ${lng}` : '')
      );
    } catch (e) {
      console.error('stop location failed', e.message);
      await sendMessage(token, chatId, '⚠️ တည်နေရာ ယူလို့ မရသေးဘူး။ ခဏနေမှ ပြန်စမ်းကြည့်ပါ။');
    }
  }
}

async function processUpdate(update, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
  try {
    const data = await loadData(env);
    if (update.message && update.message.text) {
      await handleText(token, data, update.message.chat.id, update.message.text);
    } else if (update.callback_query) {
      await handleCallback(token, data, update.callback_query);
    }
  } catch (e) {
    console.error('handler error', e);
    if (chatId) {
      await sendMessage(
        token,
        chatId,
        '⚠️ YBS ဒေတာ ဖတ်လို့ မရသေးပါဘူး။ ခဏနေမှ ပြန်စမ်းကြည့်ပါ။'
      );
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const url = new URL(request.url);

    // One-time webhook setup endpoint
    if (request.method === 'GET' && url.pathname === '/setup') {
      if (!token) {
        return Response.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 });
      }
      if (env.WEBHOOK_SECRET && url.searchParams.get('secret') !== env.WEBHOOK_SECRET) {
        return Response.json(
          { ok: false, error: 'Unauthorized. Pass ?secret=<WEBHOOK_SECRET>' },
          { status: 401 }
        );
      }

      const webhookUrl = `${url.origin}/`;
      const params = new URLSearchParams({
        url: webhookUrl,
        drop_pending_updates: 'true',
      });
      if (env.WEBHOOK_SECRET) {
        params.set('secret_token', env.WEBHOOK_SECRET);
      }

      let setResult;
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?${params}`);
        setResult = await res.json();
      } catch (e) {
        setResult = { ok: false, error: String(e.message || e) };
      }

      let info = null;
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
        info = await r.json();
      } catch (e) {
        info = { error: String(e.message || e) };
      }

      return Response.json({ setWebhook: setResult, webhookInfo: info });
    }

    if (request.method === 'GET') {
      return new Response('YBS Bus Bot webhook is up. POST Telegram updates here.', {
        status: token ? 200 : 500,
      });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    if (!token) {
      return new Response('Bot token not configured', { status: 500 });
    }

    // Verify Telegram webhook secret header if configured
    if (env.WEBHOOK_SECRET) {
      const incomingSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (incomingSecret !== env.WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(processUpdate(update, env));
    } else {
      await processUpdate(update, env);
    }
    return new Response('ok');
  },
};