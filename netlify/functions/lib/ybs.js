// Pure YBS data logic — no Telegram code here, so it can be unit-tested locally.
// Data source: hidecard/YBS-Bus-Data (static JSON, 147 routes, 17,053 stops
// verified 2026-11-24). Catalog + stop index are bundled; full route files
// are fetched on demand from GitHub raw and cached in memory (1h TTL).
// Routes are identified by `data_file` (unique), NOT by `bus_line` —
// bus_line is not unique (e.g. "89 (National Cancer Institute)" exists twice,
// and "89" has 4 variants).
const catalog = require('../../../data/routes.js');
const stopIndex = require('../../../data/stops-index.js');

const ROUTES = catalog.routes || [];
const STOPS = stopIndex.stops || [];
const PAGE_SIZE = 20;

const routeCache = new Map(); // data_file -> { at, data }

function allRoutes() {
  return ROUTES;
}

function findRoutes(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const ql = q.toLowerCase();
  // Exact bus_line match first.
  const exact = ROUTES.filter((r) => r.bus_line.toLowerCase() === ql);
  if (exact.length) return dedupeRoutes(exact);
  // Starts-with on bus_line (e.g. "89" -> 89, 89 (Min Nanda Rd.) ...).
  const prefix = ROUTES.filter((r) => r.bus_line.toLowerCase().startsWith(ql));
  if (prefix.length) return dedupeRoutes(prefix);
  // Substring on bus_line only — NOT on line_name: line names are
  // "start - end" in Burmese, so a stop name like ဆူးလေ (a common terminus)
  // would otherwise match 20+ routes and hijack stop search.
  const sub = ROUTES.filter((r) => r.bus_line.toLowerCase().includes(ql));
  return dedupeRoutes(sub);
}

// Exact stop-name match (Myanmar or English) — checked before route search
// in the handler, so a stop that is also a terminus wins over line names.
function findExactStop(query) {
  const q = String(query || '').trim();
  const ql = q.toLowerCase();
  return STOPS.find((s) => s.mm === q || (s.en || '').toLowerCase() === ql) || null;
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

function routeByFile(dataFile) {
  return ROUTES.find((r) => r.data_file === dataFile) || null;
}

async function fetchRoute(dataFile, fetchImpl) {
  const now = Date.now();
  const cached = routeCache.get(dataFile);
  if (cached && now - cached.at < 60 * 60 * 1000) return cached.data;
  const f = fetchImpl || fetch;
  const url = `https://raw.githubusercontent.com/hidecard/YBS-Bus-Data/main/${dataFile}`;
  const res = await f(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${dataFile}`);
  const data = await res.json();
  routeCache.set(dataFile, { at: now, data });
  return data;
}

function searchStops(query, limit = 10) {
  const q = String(query || '').trim();
  if (!q || q.length < 2) return [];
  const ql = q.toLowerCase();
  const scored = [];
  for (const s of STOPS) {
    const mm = s.mm || '';
    const en = (s.en || '').toLowerCase();
    let score = -1;
    if (mm === q || en === ql) score = 0; // exact
    else if (mm.startsWith(q) || en.startsWith(ql)) score = 1;
    else if (mm.includes(q) || en.includes(ql)) score = 2;
    if (score >= 0) scored.push({ score, stop: s });
  }
  scored.sort(
    (a, b) => a.score - b.score || (a.stop.mm || a.stop.en).localeCompare(b.stop.mm || b.stop.en)
  );
  return scored.slice(0, limit).map((x) => x.stop);
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
    lines.push(`${s.index}. ${escapeHtml(s.stop_name_mm || '')} (${escapeHtml(s.stop_name_en || '')})`);
  }
  lines.push('');
  lines.push('မှတ်တိုင်နံပါတ်ကို နှိပ်ရင် မြေပုံတည်နေရာ ပြမယ်။');
  lines.push('⚠️ Static data ပါ — ကားအချိန်နဲ့ live မဟုတ်ပါ။');
  return { text: lines.join('\n'), page: p, totalPages };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
  PAGE_SIZE,
  allRoutes,
  findRoutes,
  findExactStop,
  routeByFile,
  fetchRoute,
  searchStops,
  formatRoutePage,
  escapeHtml,
};
