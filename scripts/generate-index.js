// Regenerate data/routes.js + data/stops-index.js from upstream.
// Usage: node scripts/generate-index.js [/path/to/YBS-Bus-Data-clone]
// Without an argument it clones hidecard/YBS-Bus-Data to a temp dir.
// Route files themselves are NOT copied into this repo — the bot fetches
// them on demand from GitHub raw. Only the catalog + compact stop index
// (1,376 distinct stop names) are bundled.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoDir = process.argv[2] || (() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ybs-data-'));
  execSync(`git clone --depth 1 -q https://github.com/hidecard/YBS-Bus-Data.git "${tmp}"`, { stdio: 'inherit' });
  return tmp;
})();

const catalog = JSON.parse(fs.readFileSync(path.join(repoDir, 'api/routes.json'), 'utf8'));
const lineByFile = {};
for (const r of catalog.routes) lineByFile[r.data_file] = [r.bus_line, r.line_name || ''];

const idx = new Map();
for (const file of fs.readdirSync(repoDir).filter((f) => f.startsWith('ybs_') && f.endsWith('.json')).sort()) {
  const [line, lineName] = lineByFile[file] || ['?', ''];
  const data = JSON.parse(fs.readFileSync(path.join(repoDir, file), 'utf8'));
  for (const s of data.stops || []) {
    const mm = (s.stop_name_mm || '').trim();
    const en = (s.stop_name_en || '').trim();
    if (!mm && !en) continue;
    const key = `${mm}\0${en}`;
    if (!idx.has(key)) idx.set(key, { mm, en, routes: {} });
    const entry = idx.get(key);
    if (!entry.routes[line]) entry.routes[line] = { line, line_name: lineName, idx: s.index };
  }
}
const stops = [...idx.values()].map((e) => ({ ...e, routes: Object.values(e.routes).sort((a, b) => a.line.localeCompare(b.line)) }));
stops.sort((a, b) => (a.mm || a.en).localeCompare(b.mm || b.en));

const outDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
const writeJs = (name, obj) => {
  fs.writeFileSync(
    path.join(outDir, `${name}.js`),
    `// Generated from hidecard/YBS-Bus-Data (see scripts/generate-index.js). Do not edit by hand.\nmodule.exports = ${JSON.stringify(obj)};\n`
  );
};
writeJs('routes', catalog);
writeJs('stops-index', { generated_from: 'hidecard/YBS-Bus-Data', stop_count: stops.length, stops });
console.log(`routes: ${catalog.routes.length}, distinct stops: ${stops.length}`);
