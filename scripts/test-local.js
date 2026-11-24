// Local test of the pure YBS logic (no Telegram token needed).
// Fetches real route files from GitHub raw, like the deployed function does.
const assert = require('assert');
const ybs = require('../netlify/functions/lib/ybs');

(async () => {
  // Catalog
  assert.strictEqual(ybs.allRoutes().length, 147, 'catalog should have 147 routes');
  console.log('✓ catalog: 147 routes');

  // Route search: exact, prefix variants, non-numeric lines
  assert.strictEqual(ybs.findRoutes('100').length, 1);
  assert.strictEqual(ybs.findRoutes('100')[0].data_file, 'ybs_100_data.json');
  const r89 = ybs.findRoutes('89');
  console.log('✓ findRoutes("89") ->', r89.map((r) => r.bus_line).join(' | '));
  // 4 catalog entries, but 2 are the identical "89 (National Cancer Institute)"
  // route, so dedupe leaves 3 distinct variants to show the user.
  assert.ok(r89.length >= 3, '89 should have 3+ distinct variants');
  assert.ok(ybs.findRoutes('APS').length >= 1, 'APS line should be found');
  assert.strictEqual(ybs.findRoutes('99999').length, 0);
  console.log('✓ route search (exact / variants / no-match)');

  // A stop name that is also a terminus must NOT match as a route:
  // ဆူးလေ appears in many line names but is not a bus_line.
  assert.strictEqual(ybs.findRoutes('ဆူးလေ').length, 0, 'stop name must not match routes');
  // No stop is named exactly "ဆူးလေ" — the real stop is ဆူးလေမြို့တော်ခန်းမ.
  assert.ok(ybs.findExactStop('ဆူးလေမြို့တော်ခန်းမ'), 'exact stop lookup should find Sule City Hall');
  assert.strictEqual(ybs.findExactStop('ဆူးလေမြို့တော်ခန်းမ').routes.length, 19, 'Sule City Hall is on 19 routes');

  // Stop search: Myanmar + English, exact + substring
  const sule = ybs.searchStops('ဆူးလေ');
  console.log('✓ searchStops("ဆူးလေ") ->', sule.length, 'stops, first routes:', sule[0] ? sule[0].routes.length : 0);
  assert.ok(sule.length >= 1 && sule[0].routes.length >= 5, 'Sule should be on many routes');
  const suleEn = ybs.searchStops('Sule');
  assert.ok(suleEn.length >= 1, 'English search should work');
  assert.strictEqual(ybs.searchStops('zzzzqqq').length, 0);
  assert.strictEqual(ybs.searchStops('a').length, 0, '1-char query returns nothing');
  console.log('✓ stop search (MM / EN / no-match)');

  // Route fetch + page formatting (live GitHub raw)
  const data = await ybs.fetchRoute('ybs_100_data.json');
  assert.strictEqual(data.stops.length, 104, 'route 100 should have 104 stops');
  const page0 = ybs.formatRoutePage(data, 0);
  assert.ok(page0.text.includes('ကျီစုသုဿန်'), 'page 0 should list first stop');
  assert.strictEqual(page0.totalPages, 6, '104 stops / 20 per page = 6 pages');
  const pageLast = ybs.formatRoutePage(data, 99);
  assert.strictEqual(pageLast.page, 5, 'page clamps to last page');
  console.log('✓ fetchRoute + formatRoutePage: 104 stops, 6 pages, clamping works');

  // Callback data length check (Telegram limit: 64 bytes)
  const longFile = 'ybs_89_national_cancer_institute_data.json';
  const cb = `stop:104:${encodeURIComponent(longFile)}`;
  assert.ok(Buffer.byteLength(cb) <= 64, `callback too long: ${cb.length}`);
  const cb2 = `route:${encodeURIComponent(longFile)}:0`;
  assert.ok(Buffer.byteLength(cb2) <= 64, `callback too long: ${cb2.length}`);
  console.log('✓ callback_data stays under Telegram 64-byte limit');

  console.log('\nAll local tests passed.');
})().catch((e) => {
  console.error('✗ TEST FAILED:', e.message);
  process.exit(1);
});
