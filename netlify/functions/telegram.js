// YBS Bus Bot — Telegram webhook for Netlify Functions.
// Netlify cannot run a polling bot (no 24h server), so Telegram calls this
// function on every message via webhook. No database: bus data is static JSON
// (bundled catalog + stop index, route files fetched from GitHub raw).
// Env var: TELEGRAM_BOT_TOKEN (set in Netlify only, never in chat or code).
const { findRoutes, findExactStop, routeByFile, fetchRoute, searchStops, formatRoutePage, escapeHtml } = require('./lib/ybs');

const WELCOME =
  '🚌 <b>YBS Bus Bot မှ ကြိုဆိုပါတယ်</b>\n\n' +
  'ရန်ကုန် YBS ဘတ်စ်ကားလိုင်းနဲ့ မှတ်တိုင်တွေ ရှာလို့ရပါတယ်။\n\n' +
  '• လိုင်းနံပါတ် ရိုက်ပါ — ဥပမာ <code>100</code>၊ <code>89</code>\n' +
  '• မှတ်တိုင်အမည် ရိုက်ပါ — ဥပမာ <code>ဆူးလေ</code>၊ <code>Sule</code>\n\n' +
  '⚠️ Static data ပါ — ကားဘယ်အချိန်ရောက်မလဲ၊ live တည်နေရာ မပြပါ။\n' +
  'Data: hidecard/YBS-Bus-Data (GitHub)';

const HELP =
  '🚌 <b>အသုံးပြုနည်း</b>\n\n' +
  '• <code>/route 100</code> — လိုင်း 100 ရဲ့ မှတ်တိုင်စာရင်း\n' +
  '• <code>100</code> — လိုင်းနံပါတ်ကို တိုက်ရိုက်ရိုက်လည်း ရတယ်\n' +
  '• <code>ဆူးလေ</code> / <code>Sule</code> — မှတ်တိုင်အမည်နဲ့ ရှာမယ်၊ ဘယ်လိုင်းတွေ ဖြတ်လဲ ပြမယ်\n' +
  '• လိုင်းစာရင်းထဲက မှတ်တိုင်နံပါတ်ကို နှိပ်ရင် မြေပုံတည်နေရာ ပို့ပေးမယ်\n\n' +
  'လိုင်းတစ်ခုမှာ ပုံစံကွဲတွေ ရှိနိုင်တယ် (ဥပမာ 89 က 4 မျိုး) — အဲဒီအခါ ရွေးခိုင်းမယ်။';

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
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Telegram API error', method, res.status, body.slice(0, 300));
  }
  return res;
}

const sendMessage = (token, chatId, text, extra = {}) =>
  tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
const editMessage = (token, chatId, messageId, text, extra = {}) =>
  tg(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra });
const answerCallback = (token, id, text) =>
  tg(token, 'answerCallbackQuery', { callback_query_id: id, text: text || '' });

function routeKeyboard(routeData, page, totalPages) {
  const rows = [];
  const stops = routeData.stops || [];
  const slice = stops.slice(page * 20, (page + 1) * 20);
  // Stop-number buttons, 5 per row — tapping one sends its location.
  for (let i = 0; i < slice.length; i += 5) {
    rows.push(
      slice.slice(i, i + 5).map((s) => ({
        text: String(s.index),
        // Keep callback_data under Telegram's 64-byte limit: no bus_line.
        callback_data: `stop:${s.index}:${encodeURIComponent(routeData._file)}`,
      }))
    );
  }
  const nav = [];
  if (page > 0) nav.push({ text: '◀️ အရင်', callback_data: `route:${encodeURIComponent(routeData._file)}:${page - 1}` });
  if (page < totalPages - 1) nav.push({ text: 'နောက် ▶️', callback_data: `route:${encodeURIComponent(routeData._file)}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '🔙 Menu', callback_data: 'menu:home' }]);
  return { inline_keyboard: rows };
}

async function showRoute(token, chatId, messageId, dataFile, page, edit) {
  const meta = routeByFile(dataFile);
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
  data._file = dataFile;
  data.bus_line = meta ? meta.bus_line : data.bus_line;
  const { text, page: p, totalPages } = formatRoutePage(data, page);
  const keyboard = routeKeyboard(data, p, totalPages);
  if (edit) await editMessage(token, chatId, messageId, text, { reply_markup: keyboard });
  else await sendMessage(token, chatId, text, { reply_markup: keyboard });
}

async function handleText(token, chatId, text) {
  const q = text.trim();
  if (!q) return;
  if (q === '/start') {
    await sendMessage(token, chatId, WELCOME, { reply_markup: mainKeyboard() });
    return;
  }
  if (q === '/help') {
    await sendMessage(token, chatId, HELP, { reply_markup: mainKeyboard() });
    return;
  }
  const routeArg = q.match(/^\/route\s+(.+)$/);
  const query = routeArg ? routeArg[1].trim() : q;

  // 0) Exact stop name wins (e.g. ဆူးလေ is also a terminus in many line names).
  if (!routeArg) {
    const exactStop = findExactStop(query);
    if (exactStop) {
      await sendStopRoutes(token, chatId, exactStop);
      return;
    }
  }

  // 1) Route search.
  const routes = findRoutes(query);
  if (routes.length === 1) {
    await showRoute(token, chatId, null, routes[0].data_file, 0, false);
    return;
  }
  if (routes.length > 1) {
    const lines = [
      `🚌 <b>“${escapeHtml(query)}”</b> နဲ့ ကိုက်ညီတဲ့ လိုင်း ${routes.length} ခု တွေ့တယ် — တစ်ခုရွေးပါ:`,
      '',
    ];
    const keyboard = {
      inline_keyboard: routes.slice(0, 20).map((r) => [
        {
          text: `${r.bus_line} — ${r.line_name || ''}`.slice(0, 60),
          callback_data: `route:${encodeURIComponent(r.data_file)}:0`,
        },
      ]),
    };
    await sendMessage(token, chatId, lines.join('\n'), { reply_markup: keyboard });
    return;
  }

  // 2) Stop-name search.
  const stops = searchStops(query, 10);
  if (stops.length === 0) {
    await sendMessage(
      token,
      chatId,
      `😕 “${escapeHtml(query)}” နဲ့ ကိုက်ညီတဲ့ လိုင်းနဲ့ မှတ်တိုင် မတွေ့ဘူး။\nလိုင်းနံပါတ် (ဥပမာ 100) ဒါမှမဟုတ် မှတ်တိုင်အမည် အပြည့်အစုံ ရိုက်ကြည့်ပါ။`,
      { reply_markup: mainKeyboard() }
    );
    return;
  }
  if (stops.length === 1) {
    await sendStopRoutes(token, chatId, stops[0]);
    return;
  }
  const lines = [`📍 <b>“${escapeHtml(query)}”</b> နဲ့ ကိုက်ညီတဲ့ မှတ်တိုင် ${stops.length} ခု — တစ်ခုရွေးပါ:`, ''];
  const keyboard = {
    inline_keyboard: stops.map((s, i) => [
      {
        text: `${s.mm || s.en} (${s.en || ''}) — ${s.routes.length} လိုင်း`.slice(0, 60),
        callback_data: `pickstop:${i}:${encodeURIComponent(query)}`,
      },
    ]),
  };
  // Store the candidate list in the callback by re-searching on tap (stateless).
  await sendMessage(token, chatId, lines.join('\n'), { reply_markup: keyboard });
}

async function sendStopRoutes(token, chatId, stop) {
  const lines = [
    `📍 <b>${escapeHtml(stop.mm || '')}</b> (${escapeHtml(stop.en || '')})`,
    `ဖြတ်သန်းတဲ့ လိုင်း ${stop.routes.length} ခု:`,
    '',
  ];
  const keyboard = {
    inline_keyboard: stop.routes.slice(0, 20).map((r) => [
      {
        text: `${r.line} — ${r.line_name || ''}`.slice(0, 60),
        callback_data: `route:${encodeURIComponent(routeByFileForLine(r))}:0`,
      },
    ]),
  };
  await sendMessage(token, chatId, lines.join('\n'), { reply_markup: keyboard });
}

// A stop's route entry only carries bus_line; resolve it to a data_file.
// When several files share a bus_line, prefer the one whose line_name matches.
function routeByFileForLine(r) {
  const candidates = findRoutes(r.line);
  const byName = candidates.find((c) => c.line_name === r.line_name);
  const chosen = byName || candidates[0];
  return chosen ? chosen.data_file : '';
}

async function handleCallback(token, cb) {
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const data = cb.data || '';
  await answerCallback(token, cb.id);
  const [kind, ...rest] = data.split(':');

  if (kind === 'menu') {
    if (rest[0] === 'home') {
      await editMessage(token, chatId, messageId, WELCOME, { reply_markup: mainKeyboard() });
    } else if (rest[0] === 'help') {
      await editMessage(token, chatId, messageId, HELP, { reply_markup: mainKeyboard() });
    } else if (rest[0] === 'routes') {
      await sendMessage(token, chatId, '🔍 လိုင်းနံပါတ် ရိုက်ပါ — ဥပမာ <code>100</code>၊ <code>89</code>');
    } else if (rest[0] === 'stops') {
      await sendMessage(token, chatId, '📍 မှတ်တိုင်အမည် ရိုက်ပါ — ဥပမာ <code>ဆူးလေ</code>၊ <code>Sule</code>');
    }
    return;
  }
  if (kind === 'route') {
    const dataFile = decodeURIComponent(rest[0]);
    const page = parseInt(rest[1] || '0', 10) || 0;
    await showRoute(token, chatId, messageId, dataFile, page, true);
    return;
  }
  if (kind === 'pickstop') {
    const idx = parseInt(rest[0] || '0', 10) || 0;
    const query = decodeURIComponent(rest[1] || '');
    const stops = searchStops(query, 10);
    if (stops[idx]) await sendStopRoutes(token, chatId, stops[idx]);
    return;
  }
  if (kind === 'stop') {
    // stop:<stop_index>:<data_file>
    const stopIndex = rest[0];
    const dataFile = decodeURIComponent(rest[1] || '');
    try {
      const routeData = await fetchRoute(dataFile);
      const stop = (routeData.stops || []).find((s) => String(s.index) === String(stopIndex));
      if (!stop) {
        await sendMessage(token, chatId, '😕 အဲဒီမှတ်တိုင် မတွေ့ဘူး။');
        return;
      }
      await tg(token, 'sendLocation', {
        chat_id: chatId,
        latitude: stop.latitude,
        longitude: stop.longitude,
      });
      await sendMessage(
        token,
        chatId,
        `📍 <b>${escapeHtml(stop.stop_name_mm || '')}</b> (${escapeHtml(stop.stop_name_en || '')})\n` +
          `လိုင်း ${escapeHtml(routeData.bus_line || '')} · မှတ်တိုင် ${escapeHtml(stop.index)}\n` +
          (stop.road ? `${escapeHtml(stop.road)}\n` : '') +
          `${stop.latitude}, ${stop.longitude}`
      );
    } catch (e) {
      console.error('stop location failed', e.message);
      await sendMessage(token, chatId, '⚠️ တည်နေရာ ယူလို့ မရသေးဘူး။ ခဏနေမှ ပြန်စမ်းကြည့်ပါ။');
    }
    return;
  }
}

exports.handler = async (event) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set');
    return { statusCode: 500, body: 'Bot token not configured' };
  }
  if (event.httpMethod === 'GET') {
    return { statusCode: 200, body: 'YBS Bus Bot webhook is up. POST Telegram updates here.' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  let update;
  try {
    update = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Bad JSON' };
  }
  try {
    if (update.message && update.message.text) {
      await handleText(token, update.message.chat.id, update.message.text);
    } else if (update.callback_query) {
      await handleCallback(token, update.callback_query);
    }
  } catch (e) {
    console.error('handler error', e);
  }
  // Always 200 so Telegram does not retry the same update.
  return { statusCode: 200, body: 'ok' };
};
