// Smoke test for the patrol log: serves the repo, drives it in headless
// Chromium at phone size with a fake SpeechRecognition and fake GPS, and
// checks the core flow. Weather APIs are mocked so it runs without network.
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// ── Fake SpeechRecognition ─────────────────────────────────────────
// __speech.say(text) emits a final result, interim(text) a partial one,
// autoEnd() ends the session as the browser would (timeout, screen lock),
// error(code) fires onerror then onend. __speech.sessions counts start() calls.
const fakeSpeech = () => {
  // Behaves like the real API: event.results is the session's full list so far.
  // sayAndroid(text) mimics Chrome on Android, where each result repeats the
  // whole phrase so far.
  let active = null;
  class FakeRecognition {
    start() { window.__speech.sessions++; this.results = []; setTimeout(() => { active = this; this.onstart?.(); }, 0); }
    stop() { setTimeout(() => this._end(), 0); }
    _end() { if (active === this) active = null; this.onend?.(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  const push = (text, isFinal) => {
    if (!active) return;
    const r = active.results;
    if (r.length && !r[r.length - 1].isFinal) r.pop(); // interim is replaced
    r.push(Object.assign([{ transcript: text, confidence: 1 }], { isFinal }));
    active.onresult?.({ resultIndex: r.length - 1, results: r });
  };
  window.__speech = {
    sessions: 0,
    get active() { return !!active; },
    say: text => push(text, true),
    interim: text => push(text, false),
    sayAndroid: words => { let so = ''; words.split(' ').forEach(w => { so = so ? `${so} ${w}` : w; push(so, true); }); },
    autoEnd() { active?._end(); },
    error(code) { const a = active; a?.onerror?.({ error: code }); a?._end(); },
  };
  navigator.share = undefined; // force the download fallback
};

// Minimal Open-Meteo responses for the Weather tab
const hours = Array.from({ length: 48 }, (_, i) => {
  const d = new Date(Date.now() + (i - 2) * 3600000);
  return d.toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' }).slice(0, 13).replace(' ', 'T') + ':00';
});
const forecastFixture = {
  current: { wind_speed_10m: 14, wind_direction_10m: 22, wind_gusts_10m: 20, temperature_2m: 22 },
  hourly: { time: hours, wind_speed_10m: hours.map((_, i) => i === 6 ? 28 : 15), wind_direction_10m: hours.map(() => 22),
            wind_gusts_10m: hours.map(() => 22), precipitation: hours.map((_, i) => i === 8 ? 1.2 : 0),
            temperature_2m: hours.map(() => 22), weather_code: hours.map((_, i) => i % 3 === 0 ? 0 : 3),
            // night from 19:00 to 06:00 local
            is_day: hours.map(t => { const hr = +t.slice(11, 13); return hr >= 6 && hr < 19 ? 1 : 0; }) }
};
const marineFixture = {
  hourly: { time: hours, wave_height: hours.map(() => 1.6), swell_wave_height: hours.map(() => 1.2),
            swell_wave_direction: hours.map(() => 180), swell_wave_period: hours.map(() => 9), sea_surface_temperature: hours.map(() => 20.5),
            // ~12.4 h tide cycle, rising at the current hour
            sea_level_height_msl: hours.map((_, i) => Math.sin((i - 2) * 2 * Math.PI / 12.4) * 0.8) }
};

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true,
  locale: 'en-AU', timezoneId: 'Australia/Sydney',
  permissions: ['geolocation'], geolocation: { latitude: -33.9685, longitude: 151.2700, accuracy: 8 }
});
await context.addInitScript(fakeSpeech);
await context.route('**/api.open-meteo.com/**', r => r.fulfill({ json: forecastFixture }));
await context.route('**/marine-api.open-meteo.com/**', r => r.fulfill({ json: marineFixture }));
// Published weather.json (BOM forecast + warnings) from the weather-data branch
const feedFixture = {
  updated: new Date().toISOString(), errors: [],
  bom: { issued: 'Sat 10:00', areas: [{ name: 'Sydney Coast: Broken Bay to Port Hacking', synoptic: '',
    periods: [{ label: 'Saturday 31 Oct', warning: 'Strong Wind Warning for Saturday for Sydney Coast', winds: 'Northerly 20 to 25 knots.', seas: '1.5 to 2 metres.', swell1: 'Southerly 1 to 1.5 metres.', swell2: '', weather: 'Partly cloudy.', caution: '' }] }] },
  warnings: [
    { title: 'Strong Wind Warning for Saturday for Sydney Coast', area: 'Sydney Coast: Broken Bay to Port Hacking', source: 'BOM coastal waters forecast' },
    { title: 'Strong Wind Warning for Saturday for Illawarra Coast', area: 'Illawarra Coast: Port Hacking to Ulladulla', source: 'BOM coastal waters forecast' },
    { title: 'Hazardous Surf Warning for New South Wales', link: 'https://www.bom.gov.au/nsw/warnings/hazardoussurf.shtml', issued: 'Sat 04:19', source: 'BOM warnings',
      detail: 'Surf and swell conditions are expected to be hazardous for coastal activities such as rock fishing, boating, and swimming.' }
  ],
  ww: { location: 'Malabar', tides: [], observed: { station: 'Little Bay', speedKmh: 15, gustKmh: 22, direction: 'NNE', time: '09:00' } }
};
await context.route('https://raw.githubusercontent.com/**/weather.json*', r => r.fulfill({ json: feedFixture }));
await context.route('**/www.rainviewer.com/**', r => r.fulfill({ body: '<html><body>radar</body></html>', contentType: 'text/html' }));
await context.route('**/embed.windy.com/**', r => r.fulfill({ body: '<html><body>map</body></html>', contentType: 'text/html' }));
const page = await context.newPage();
page.on('dialog', d => d.accept());
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const startRec = async () => {
  await page.click('#dictate-btn');
  await page.waitForFunction(() => window.__speech.active);
};
const stopRec = async () => {
  await page.click('#dictate-btn');
  await page.waitForFunction(() => !window.__speech.active && !document.getElementById('dictate-btn').classList.contains('listening'));
};
const record = async (text) => {
  await startRec();
  await page.evaluate(t => window.__speech.say(t), text);
  await stopRec();
};
const entryTexts = () => page.$$eval('.log-entry .text', els => els.map(e => e.textContent));

await page.goto(url);

// ── Start screen ───────────────────────────────────────────────────
await check('first load shows the start screen, not the log', async () => {
  assert(await page.isVisible('#start-screen'), 'start screen hidden');
  assert(!(await page.isVisible('#dictate-btn')), 'log controls visible before crew entered');
  assert(await page.isChecked('input[name="duty"][value="Patrol"]'), 'Patrol not the default duty');
  assert(await page.locator('.crew-extra').count() === 2, 'expected 2 crew rows (4 spots with skipper and driver)');
  const ph = await page.$$eval('#start-screen input[type="text"]:not([hidden])', els => els.map(e => e.placeholder));
  assert(ph[0] === 'Skipper' && ph[1] === 'Driver' && ph.slice(2).every(p => p === 'Crew (optional)'), `placeholders ${ph}`);
  assert(await page.locator('#start-screen [required]').count() === 0, 'start screen still has required fields');
});

await check('date defaults to the local calendar date', async () => {
  const [value, expected] = await page.evaluate(() => {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    return [document.getElementById('patrol-date').value, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`];
  });
  assert(value === expected, `date ${value}, expected ${expected}`);
});

await check('nothing is required: an empty start screen opens the log', async () => {
  await page.click('#start-btn');
  assert(await page.isVisible('#dictate-btn'), 'empty start screen did not open the log');
  const summary = await page.textContent('#shift-summary');
  assert(summary.includes('Patrol') && !summary.includes('S:') && !summary.includes('undefined'), `summary "${summary}"`);
  await page.click('#shift-summary');
  assert(await page.isVisible('#start-screen'), 'crew bar did not reopen the start screen');
  assert(await page.locator('.crew-extra').count() === 2, 'crew rows missing when adding names later');
});

await check('Other duty opens a text box', async () => {
  await page.click('label.pill:has-text("Other")');
  assert(await page.isVisible('#duty-other'), 'other text box not shown');
  await page.click('label.pill:has-text("Patrol")');
  assert(!(await page.isVisible('#duty-other')), 'other text box still shown');
});

await check('add crew adds more rows than the default two', async () => {
  await page.fill('#crew-skipper', 'Matt Pacey');
  await page.fill('#crew-driver', 'Marie Bowen');
  await page.click('#add-crew-btn');
  assert(await page.locator('.crew-extra').count() === 3, 'add crew did not add a row');
});

await check('start patrol opens the log with a crew summary', async () => {
  await page.fill('.crew-extra >> nth=0', 'Nick Tyler');
  await page.fill('.crew-extra >> nth=1', 'Chiara Palazzo');
  await page.click('#start-btn');
  assert(await page.isVisible('#dictate-btn'), 'log not shown');
  const summary = await page.textContent('#shift-summary');
  assert(summary.includes('Patrol') && summary.includes('Matt Pacey') && summary.includes('Chiara Palazzo'), `summary "${summary}"`);
});

// ── Recording ──────────────────────────────────────────────────────
await check('records an entry with formatting and local-word corrections', async () => {
  await record('two swimmers near bear island at 1430 hours');
  const texts = await entryTexts();
  assert(texts.at(-1) === 'Two swimmers near Bare Island at 14:30 hrs.', `got ${JSON.stringify(texts.at(-1))}`);
});

await check('voice entries get a GPS position and nearest landmark', async () => {
  await page.waitForFunction(() => document.querySelector('.log-entry:last-child .pos'), null, { timeout: 5000 });
  const pos = await page.textContent('.log-entry:last-child .pos');
  assert(/33°58\.\d{3}′S 151°16\.\d{3}′E/.test(pos) && /NM \d{3}°T from|at /.test(pos), `pos "${pos}"`);
});

await check('live box shows words as they are heard', async () => {
  await startRec();
  assert(await page.isVisible('#live-box'), 'live box hidden while recording');
  await page.evaluate(() => window.__speech.interim('rip forming'));
  assert((await page.textContent('#live-text')).includes('rip forming'), 'interim text not shown');
  await page.evaluate(() => window.__speech.say('rip forming north end'));
  await stopRec();
  assert(!(await page.isVisible('#live-box')), 'live box still visible after stop');
});

await check('Android-style repeated results make one clean sentence', async () => {
  await startRec();
  await page.evaluate(() => window.__speech.sayAndroid('departing botany bay for ben buckler'));
  await stopRec();
  const texts = await entryTexts();
  assert(texts.at(-1) === 'Departing Botany Bay for Ben Buckler.', `got ${JSON.stringify(texts.at(-1))}`);
});

await check('push to talk: no automatic restart when the phone stops listening', async () => {
  await startRec();
  const before = await page.evaluate(() => window.__speech.sessions);
  await page.evaluate(() => { window.__speech.say('kayaker heading south'); window.__speech.autoEnd(); });
  await page.waitForFunction(() => !document.getElementById('dictate-btn').classList.contains('listening'));
  await page.waitForTimeout(600);
  assert(await page.evaluate(() => window.__speech.sessions) === before, 'session was restarted (would beep on Android)');
  assert((await entryTexts()).includes('Kayaker heading south.'), 'words not saved');
  assert((await page.textContent('#dictate-btn')).includes('Continue entry'), 'no Continue entry offer');
});

await check('Continue entry adds to the same entry', async () => {
  const count = (await entryTexts()).length;
  await page.click('#dictate-btn');
  await page.waitForFunction(() => window.__speech.active);
  await page.evaluate(() => window.__speech.say('towards cape banks'));
  await stopRec();
  const texts = await entryTexts();
  assert(texts.length === count, `a new entry was created (${count} → ${texts.length})`);
  assert(texts.includes('Kayaker heading south towards Cape Banks.'), `got ${JSON.stringify(texts)}`);
  assert((await page.textContent('#dictate-btn')).includes('Log Entry'), 'button did not return to Log Entry');
});

await check('keeps transcript when the mic is blocked mid-recording', async () => {
  await startRec();
  await page.evaluate(() => { window.__speech.say('patient conscious and breathing'); window.__speech.error('not-allowed'); });
  await page.waitForFunction(() => !document.getElementById('dictate-btn').classList.contains('listening'));
  const texts = await entryTexts();
  assert(texts.includes('Patient conscious and breathing.'), 'transcript discarded on fatal error');
});

await check('entries persist across reload', async () => {
  const count = (await entryTexts()).length;
  await page.reload();
  assert((await entryTexts()).length === count, 'entries lost on reload');
  assert(await page.isVisible('#dictate-btn'), 'reload returned to start screen mid-shift');
});

await check('a recording interrupted by the app closing is recovered', async () => {
  const count = (await entryTexts()).length;
  await page.evaluate(() => localStorage.setItem('surfPatrolDraft',
    JSON.stringify({ startedAt: new Date().toISOString(), text: 'surfer with board leg rope tangled' })));
  await page.reload();
  const texts = await entryTexts();
  assert(texts.length === count + 1 && texts.some(t => t.includes('[recovered]')), `got ${JSON.stringify(texts.at(-1))}`);
});

await check('tap an entry to edit it', async () => {
  await page.click('.log-entry >> nth=0');
  assert(await page.isVisible('#edit-dialog'), 'edit dialog not shown');
  await page.fill('#edit-text', 'Two swimmers near Bare Island at 14:30 hrs, both assisted ashore.');
  await page.click('#edit-save');
  await page.waitForFunction(() => document.querySelector('.log-entry .text').textContent.includes('both assisted ashore'), null, { timeout: 3000 });
  assert(!(await page.isVisible('#edit-dialog')), 'dialog still open');
});

await check('mark button logs the current position', async () => {
  const count = (await entryTexts()).length;
  await page.click('#mark-btn');
  await page.waitForFunction(c => document.querySelectorAll('.log-entry').length > c, count);
  assert((await entryTexts()).includes('Position marked.'), 'no mark entry');
});

// ── Crew changes ───────────────────────────────────────────────────
await check('logging off and adding crew records a crew change', async () => {
  await page.click('#shift-summary');
  assert(await page.inputValue('#crew-skipper') === 'Matt Pacey', 'crew not prefilled');
  const rows = page.locator('.crew-row:has(.crew-extra)');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    if (await rows.nth(i).locator('.crew-extra').inputValue() === 'Nick Tyler') { await rows.nth(i).locator('.row-remove').click(); break; }
  }
  await page.click('#add-crew-btn');
  await page.fill('.crew-extra >> nth=-1', 'Doug Lucas');
  await page.click('#start-btn');
  const texts = await entryTexts();
  assert(texts.includes('Crew change — Off: Nick Tyler (C). On: Doug Lucas (C).'), `got ${JSON.stringify(texts.at(-1))}`);
  const summary = await page.textContent('#shift-summary');
  assert(summary.includes('Doug Lucas') && !summary.includes('Nick Tyler'), `summary "${summary}"`);
});

await check('swipe deletes an entry', async () => {
  const count = (await entryTexts()).length;
  const card = await page.$('.log-entry');
  const box = await card.boundingBox();
  const y = box.y + box.height / 2;
  await card.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: box.x + 20, clientY: y }] });
  await card.dispatchEvent('touchmove', { touches: [{ identifier: 0, clientX: box.x + 160, clientY: y }] });
  await card.dispatchEvent('touchend', { touches: [] });
  await page.waitForSelector('#confirm-dialog[open]');
  assert((await page.textContent('#confirm-text')).startsWith('Delete this entry?'), 'in-app confirm not shown');
  await page.click('#confirm-ok');
  await page.waitForTimeout(400);
  assert((await entryTexts()).length === count - 1, 'entry not deleted');
});

await check('end of shift report has duty, crew, logged-off crew and positions', async () => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#report-btn')]);
  const body = await readFile(await download.path(), 'utf8');
  assert(body.includes('Duty     : Patrol'), 'report missing duty');
  assert(body.includes('S  Matt Pacey') && body.includes('D  Marie Bowen') && body.includes('C  Doug Lucas'), 'report missing crew');
  assert(/Logged off:\n\s+C  Nick Tyler \(off \d\d:\d\d\)/.test(body), 'report missing logged-off crew');
  assert(/Pos: 33°58\.\d{3}′S/.test(body), 'report missing positions');
});

// ── Tabs ───────────────────────────────────────────────────────────
await check('warnings show as a badge and a banner on the log', async () => {
  await page.click('[data-tab="log"]');
  await page.waitForSelector('#warning-banner:not([hidden])', { timeout: 5000 });
  assert((await page.textContent('#warning-banner')).includes('Strong Wind Warning for Saturday for Sydney Coast (+1 more)'), 'banner text');
  assert((await page.textContent('#warn-badge')).includes('2'), 'badge count');
});

await check('weather tab: warnings, now tiles, tide, sun and first/last light', async () => {
  await page.click('#warning-banner');
  assert(await page.isVisible('#panel-weather'), 'banner did not open weather tab');
  await page.waitForSelector('.tile', { timeout: 5000 });
  assert(await page.locator('.warning-item').count() === 2, 'warnings not listed');
  assert(!(await page.$eval('#warnings-card', d => d.open)), 'warnings should start collapsed');
  assert((await page.textContent('#warnings-summary')).startsWith('⚠️ 2 warnings'), 'warning summary line');
  await page.click('#warnings-summary');
  assert(await page.isVisible('.warning-item'), 'warnings did not expand');
  assert(!(await page.textContent('#warnings-body')).includes('Illawarra'), 'Illawarra warning should be filtered out');
  assert(await page.locator('#warn-details-card').count() === 0, 'warning details section should be gone');
  assert(await page.$eval('.warning-item', el => el.tagName) === 'DIV', 'warnings should not be clickable');
  const now = await page.textContent('#wx-now');
  assert(!now.includes('Waves'), 'Waves tile should be gone');
  for (const want of ['14 kn NNE', '1.2 m S', '20.5 °C', 'Sunrise / Sunset', 'First / Last Light']) {
    assert(now.includes(want), `missing "${want}" in "${now}"`);
  }
  assert(/First \/ Last Light\s*0[45]:\d\d · (19|20):\d\d/.test(now), 'first/last light times');
  assert(/(Rising|Falling|Near high|Near low)/.test(now), 'tide direction missing');
  // Tide: next turns in time order, each "High/Low hh:mm (x.x m)" on its own line
  const tideLines = await page.$$eval('#wx-now .tile:nth-child(3) .tile-line', els => els.map(e => [e.textContent, e.getBoundingClientRect().height]));
  assert(tideLines.length >= 1 && tideLines.every(([t]) => /^(High|Low) \d\d:\d\d \(\d\.\d m\)$/.test(t)), `tide lines ${JSON.stringify(tideLines)}`);
  assert(tideLines.every(([, h]) => h < 20), 'a tide line wrapped');
  const tideTimes = tideLines.map(([t]) => t.match(/\d\d:\d\d/)[0]);
  const expected = await page.evaluate(() => {
    const now = Date.now(), next = Tide.turns(now, now + 30 * 3600000);
    const hi = next.find(e => e.type === 'high'), lo = next.find(e => e.type === 'low');
    return [hi, lo].filter(Boolean).sort((a, b) => a.at - b.at)
      .map(e => e.at.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' }));
  });
  assert(JSON.stringify(tideTimes) === JSON.stringify(expected), `tide order ${tideTimes} expected ${expected}`);
  assert((await page.textContent('#bom-body')).includes('Strong Wind Warning for Saturday'), 'BOM forecast not shown');
  assert(!(await page.textContent('#bom-body')).includes('Illawarra'), 'BOM forecast should be Sydney Coast only');
});

await check('weather tab shows a loading screen until the data is in', async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-AU', timezoneId: 'Australia/Sydney' });
  await ctx2.addInitScript(fakeSpeech);
  let release;
  const gate = new Promise(r => { release = r; });
  await ctx2.route('**/api.open-meteo.com/**', async r => { await gate; r.fulfill({ json: forecastFixture }); });
  await ctx2.route('**/marine-api.open-meteo.com/**', async r => { await gate; r.fulfill({ json: marineFixture }); });
  await ctx2.route('https://raw.githubusercontent.com/**/weather.json*', r => r.fulfill({ json: feedFixture }));
  const p2 = await ctx2.newPage();
  await p2.goto(url);
  await p2.evaluate(() => localStorage.setItem('surfPatrolShift', JSON.stringify({ duty: 'Patrol', dutyOther: '', date: '2026-10-31', skipper: 'A', driver: 'B', crew: [], loggedOff: [] })));
  await p2.reload();
  await p2.click('[data-tab="weather"]');
  assert(await p2.isVisible('#wx-loading .boat-spinner'), 'spinner not shown while loading');
  assert(!(await p2.isVisible('#warnings-card')), 'content shown before data loaded');
  release();
  await p2.waitForSelector('.tile', { timeout: 5000 });
  assert(!(await p2.isVisible('#wx-loading')), 'spinner still shown after loading');
  await ctx2.close();
});

await check('wind map loads when the app opens on the Weather tab', async () => {
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-AU', timezoneId: 'Australia/Sydney' });
  await ctx3.route('**/api.open-meteo.com/**', r => r.fulfill({ json: forecastFixture }));
  await ctx3.route('**/marine-api.open-meteo.com/**', r => r.fulfill({ json: marineFixture }));
  await ctx3.route('https://raw.githubusercontent.com/**/weather.json*', r => r.fulfill({ json: feedFixture }));
  await ctx3.route('**/embed.windy.com/**', r => r.fulfill({ body: '<html><body>map</body></html>', contentType: 'text/html' }));
  await ctx3.addInitScript(() => {
    localStorage.setItem('surfPatrolTab', 'weather');
    localStorage.setItem('surfPatrolShift', JSON.stringify({ duty: 'Patrol', dutyOther: '', date: '2026-10-31', skipper: 'A', driver: 'B', crew: [], loggedOff: [] }));
  });
  const p3 = await ctx3.newPage();
  await p3.goto(url);
  await p3.waitForSelector('.tile', { timeout: 5000 });
  await p3.evaluate(() => document.getElementById('map-wrap').scrollIntoView({ block: 'center' }));
  await p3.waitForSelector('#map-wrap iframe[src*="overlay=wind"]', { timeout: 5000 });
  await ctx3.close();
});

await check('tide prediction: Saturday 31 Oct high at about 12:56 at Fort Denison', async () => {
  const turns = await page.evaluate(() => {
    const from = Date.parse('2026-10-31T09:00:00+11:00');
    return Tide.turns(from, from + 8 * 3600000).map(e => ({ type: e.type, at: e.at.toISOString() }));
  });
  const high = turns.find(t => t.type === 'high');
  const mins = (Date.parse(high.at) - Date.parse('2026-10-31T12:56:00+11:00')) / 60000;
  assert(Math.abs(mins) <= 5, `high predicted at ${high.at}`);
});

await check('weather tab: 24-hour strip with coloured wind', async () => {
  const cols = await page.locator('.strip .row-wind td').count();
  assert(cols === 24, `expected 24 hours, got ${cols}`);
  const bg = await page.locator('.strip .row-wind td').nth(4).evaluate(td => td.style.backgroundColor);
  assert(bg, 'wind cell not coloured');
});

await check('weather: night hours shaded with the moon or a dark sky; moon tile', async () => {
  const night = await page.$$eval('.strip .row-time td', tds => tds.map(td => td.classList.contains('night')));
  const hrs = await page.$$eval('.strip .row-time td', tds => tds.map(td => +td.textContent.trim().slice(-2)));
  night.forEach((n, i) => assert(n === (hrs[i] < 6 || hrs[i] >= 19), `hour ${hrs[i]} night=${n}`));
  // A clear night hour shows a moon or stars, never the sun
  const sky = await page.$$eval('.strip .row-sky td.night', tds => tds.map(td => td.textContent + (td.querySelector('.night-sky') ? '|N' : '')));
  if (sky.length) assert(!sky.some(t => t.includes('☀️')), `sun at night: ${sky}`);
  const nightClear = await page.locator('.strip .row-sky td.night .night-sky').count();
  const expected = await page.evaluate(() => {
    const tds = [...document.querySelectorAll('.strip .row-sky td')];
    return tds.filter(td => td.classList.contains('night') && !/☁️/.test(td.textContent) || td.querySelector('.night-sky')).length;
  });
  assert(nightClear === expected, `night clear cells ${nightClear} vs ${expected}`);
  const moon = await page.textContent('.tile-moon');
  assert(/(moon|quarter|crescent|gibbous)/i.test(moon) && /\d+% lit/.test(moon) && /(Rise|Set) \d\d:\d\d/.test(moon), `moon tile "${moon}"`);
  assert(await page.locator('.tile-moon svg.moon-icon').count() === 1, 'moon drawing missing');
});

await check('wind units switch to km/h and are remembered', async () => {
  await page.click('#wind-unit label:has-text("km/h")');
  assert((await page.textContent('#wx-now')).includes('26 km/h NNE'), 'tiles not in km/h');
  assert((await page.textContent('.strip .row-wind th')).includes('km/h'), 'strip not in km/h');
  await page.reload();
  await page.click('[data-tab="weather"]');
  await page.waitForSelector('.tile', { timeout: 5000 });
  assert((await page.textContent('#wx-now')).includes('26 km/h'), 'units not remembered');
  await page.click('#wind-unit label:has-text("knots")');
});

await check('live map: one Windy map whose layer follows the pills; full screen', async () => {
  assert(await page.locator('#map-pills input[value="satellite"]').count() === 0, 'satellite still there');
  assert((await page.textContent('#map-pills')).includes('Radar') && !(await page.textContent('#map-pills')).includes('Rain radar'), 'pill should say Radar');
  const srcs = [];
  for (const [label, layer] of [['Waves', 'waves'], ['Radar', 'radar'], ['Wind', 'wind'], ['Waves', 'waves']]) {
    await page.click(`#map-pills label:has-text("${label}")`);
    const frames = await page.$$eval('#map-wrap iframe', fs => fs.map(f => f.src));
    assert(frames.length === 1, `expected one map, got ${frames.length}`);
    assert(frames[0].includes('embed.windy.com') && frames[0].includes(`overlay=${layer}`), `${label} pill showed ${frames[0]}`);
    srcs.push(frames[0]);
  }
  await page.click('#map-full-btn');
  const box = await page.$eval('#map-wrap iframe', f => f.getBoundingClientRect().toJSON());
  assert(box.height > 600 && box.width > 350, `full screen map ${JSON.stringify(box)}`);
  await page.click('#map-full-btn');
  assert(await page.$eval('#map-wrap iframe', f => f.getBoundingClientRect().height) < 450, 'map did not leave full screen');
});

await check('header scrolls away, tabs stay pinned', async () => {
  assert(await page.$eval('#sticky-top', el => getComputedStyle(el).position) === 'sticky', 'tabs not sticky');
  await page.evaluate(() => window.scrollTo(0, 2000));
  const top = await page.$eval('#tabs', el => el.getBoundingClientRect().top);
  const headerBottom = await page.$eval('header', el => el.getBoundingClientRect().bottom);
  assert(Math.abs(top) < 2 && headerBottom <= 0, `tabs top ${top}, header bottom ${headerBottom}`);
});

// Choose a place in a job-route chooser by typing part of its name
const pick = async (which, typed, name) => {
  await page.click(`#route-${which}-btn`);
  await page.fill(`#route-${which}-input`, typed);
  await page.click(`#route-${which}-list [role="option"]:text-is("${name}")`);
};

await check('tools tab order: Job Route, Calculator, Fuel & Range, 2 NM Boundary; no Position', async () => {
  await page.click('[data-tab="tools"]');
  const heads = await page.$$eval('#panel-tools .card > h2', hs => hs.map(h => h.textContent.trim()));
  assert(heads[0] === 'Job Route' && heads[1].startsWith('Calculator') && heads[2].startsWith('Fuel') && heads[3].startsWith('2 NM'), `order ${heads}`);
  assert(heads.length === 4, `expected 4 sections, got ${heads.length}`);
});

await check('job route From and To stack full width on a phone and are searchable', async () => {
  const [a, b] = await Promise.all(['#route-from-btn', '#route-to-btn'].map(sel => page.$eval(sel, el => el.getBoundingClientRect().toJSON())));
  assert(b.top > a.bottom - 1 && Math.abs(a.width - b.width) < 2 && a.width > 300 && a.height >= 48, `from ${JSON.stringify(a)} to ${JSON.stringify(b)}`);
  await page.click('#route-to-btn');
  await page.fill('#route-to-input', 'gunna');
  const opts = await page.$$eval('#route-to-list [role="option"]', os => os.map(o => o.textContent));
  assert(opts.length >= 1 && opts.every(o => /gunna/i.test(o)), `options ${opts}`);
  await page.keyboard.press('Escape');
  assert(!(await page.isVisible('#route-to-sheet')), 'Escape did not close the chooser');
});

await check('place chooser: opens full screen, cleared and focused; scrolling never closes or picks', async () => {
  await page.click('[data-tab="tools"]');
  await pick('to', 'coogee b', 'Coogee Beach');
  const before = await page.$eval('#route-to', s => s.value);
  await page.click('#route-to-btn');
  // Full screen on a phone, search box empty and ready for typing
  const box = await page.$eval('#route-to-sheet', d => d.getBoundingClientRect().toJSON());
  assert(box.width >= 389 && box.height >= 800, `chooser not full screen: ${JSON.stringify(box)}`);
  assert(await page.inputValue('#route-to-input') === '', 'search box was not cleared');
  assert(await page.evaluate(() => document.activeElement.id) === 'route-to-input', 'search box not focused');
  // The current choice is marked in the list
  assert((await page.textContent('#route-to-list [aria-selected="true"]')).trim() === 'Coogee Beach', 'current place not marked');
  // A finger put down to scroll: pointerdown with no tap
  await page.$eval('#route-to-list [role="option"]:nth-of-type(3)', li => {
    li.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    li.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
  });
  assert(await page.isVisible('#route-to-sheet'), 'chooser closed on a scroll touch');
  assert(await page.$eval('#route-to', s => s.value) === before, 'a scroll touch picked a place');
  // Keyboard closed (iPhone "Done"), then scroll the list: still open
  await page.$eval('#route-to-input', i => i.blur());
  await page.locator('#route-to-list').evaluate(l => { l.scrollTop = 1500; l.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(200);
  assert(await page.isVisible('#route-to-sheet'), 'chooser closed when the keyboard was dismissed and the list scrolled');
  const target = page.locator('#route-to-list [role="option"]').nth(40);
  const name = (await target.textContent()).trim();
  await target.tap();
  assert((await page.textContent('#route-to-btn')).trim() === name, `tap did not choose ${name}`);
  assert(!(await page.isVisible('#route-to-sheet')), 'chooser did not close after choosing');
  // Close backs out without a change
  await page.click('#route-from-btn');
  const fromBefore = await page.$eval('#route-from', s => s.value);
  await page.click('#route-from-close');
  assert(!(await page.isVisible('#route-from-sheet')) && await page.$eval('#route-from', s => s.value) === fromBefore, 'Close changed the place or left the chooser open');
});

await check('job route: Coogee to Ben Buckler by water with time at speed', async () => {
  await page.click('[data-tab="tools"]');
  await pick('from', 'coogee', 'Coogee Beach');
  await pick('to', 'ben buck', 'Ben Buckler Headland');
  await page.fill('#route-speed', '20');
  await page.waitForFunction(() => document.getElementById('route-result').textContent.includes('at 20 kn'));
  const r = await page.textContent('#route-result');
  assert(await page.locator('#route-result .route-warning').count() === 0, 'open-coast route should have no depth warning');
  const nm = parseFloat(r);
  assert(nm > 1.9 && nm < 2.8 && /min at 20 kn/.test(r) && /Steer \d{3}°T/.test(r), `got "${r}"`);
  assert(await page.locator('#route-map .m-route').count() === 1, 'route not drawn');
});

await check('job route: changing the speed updates the times without re-routing', async () => {
  // The route found above stays on screen; only the times change
  await page.evaluate(() => { window.__mapNode = document.querySelector('#route-map .m-route'); });
  await page.fill('#route-speed', '');
  await page.type('#route-speed', '25');
  await page.waitForFunction(() => document.getElementById('route-result').textContent.includes('at 25 kn'));
  assert(await page.evaluate(() => document.querySelector('#route-map .m-route') === window.__mapNode), 'map was redrawn: speed change re-ran the route');
  await page.fill('#route-speed', '20');
  await page.waitForFunction(() => document.getElementById('route-result').textContent.includes('at 20 kn'));
});

await check('job route map shows both place names in full', async () => {
  await pick('from', 'malabar b', 'Malabar Beach');
  await pick('to', 'north cronulla', 'North Cronulla Beach');
  await page.waitForFunction(() => document.getElementById('route-result').textContent.includes('NM by water'));
  const labels = await page.$eval('#route-map', svg => {
    const w = svg.viewBox.baseVal.width;
    return [...svg.querySelectorAll('.m-label-big')].map(t => { const b = t.getBBox(); return { text: t.textContent, inside: b.x >= 0 && b.x + b.width <= w }; });
  });
  assert(labels.length === 2 && labels.every(l => l.inside), `labels ${JSON.stringify(labels)}`);
});

await check('job route reaches Grays Point up Port Hacking', async () => {
  await pick('from', 'bundeena b', 'Bundeena Bay');
  await pick('to', 'grays', 'Grays Point');
  await page.waitForFunction(() => /NM by water/.test(document.getElementById('route-result').textContent) && document.getElementById('route-result').textContent.includes('Grays') === false);
  const nm = parseFloat(await page.textContent('#route-result'));
  assert(nm > 3 && nm < 5, `Bundeena Bay → Grays Point ${nm} NM`);
  const warn = await page.textContent('#route-result .route-warning');
  assert(/Port Hacking/.test(warn) && /does not confirm depth/.test(warn) && /affected by the tide/.test(warn) && /Tide now (rising|falling)/.test(warn), `warning "${warn}"`);
  await page.click('#route-to-btn');
  const groups = await page.$$eval('#route-to-list .picker-group', gs => gs.map(g => g.textContent));
  assert(groups.includes('Port Hacking') && groups.includes('Harbour (eastern bays)'), `groups ${groups}`);
  await page.keyboard.press('Escape');
});

await check('job route: crew place list, approximate route into Pittwater with warnings', async () => {
  await page.click('#route-to-btn');
  const groups = await page.$$eval('#route-to-list .picker-group', gs => gs.map(g => g.textContent));
  assert(groups[0] === 'Boat ramps & wharves' && groups.includes('Pittwater') && groups.includes('Central Coast') && groups.includes('Otford to Scarborough'), `groups ${groups}`);
  assert(!groups.includes('Lake Macquarie & Newcastle'), 'Newcastle was not chosen');
  await page.keyboard.press('Escape');
  await pick('from', 'malabar boat', 'Malabar Boat Ramp');
  await pick('to', 'bayview', 'Bayview');
  await page.waitForFunction(() => /NM by water \(approx\.\)/.test(document.getElementById('route-result').textContent), null, { timeout: 10000 });
  const r = await page.textContent('#route-result');
  assert(/Pittwater/.test(r) && /does not confirm depth/.test(r), `no Pittwater warning: "${r.slice(0, 200)}"`);
  assert(await page.locator('#route-result .route-approx').count() === 1, 'approximate note missing');
  const nm = parseFloat(r);
  assert(nm > 26 && nm < 34, `Malabar Boat Ramp → Bayview ${nm} NM`);
});

await check('job route goes around Cape Banks, not over land', async () => {
  await pick('from', 'little bay', 'Little Bay Beach');
  await pick('to', 'frenchmans', 'Frenchmans Bay');
  await page.waitForFunction(() => document.getElementById('route-result').textContent.includes('NM by water'));
  const nm = parseFloat(await page.textContent('#route-result'));
  assert(nm > 2.2, `Little Bay → Frenchmans Bay only ${nm} NM — cutting across land`);
});

await check('info tab shows the phone setup check', async () => {
  await page.click('[data-tab="info"]');
  await page.waitForFunction(() => document.querySelectorAll('#perm-list li').length === 3);
  assert((await page.textContent('#perm-list')).includes('Location'), 'location row missing');
  const calls = await page.textContent('#panel-info');
  for (const line of ['Vessel Traffic Services (VTS)', 'Botany Bay: VHF Ch 12', 'Sydney Harbour: VHF Ch 13']) assert(calls.includes(line), `missing "${line}"`);
  await page.click('[data-tab="tools"]');
});

await check('tools: speed/distance/time defaults to knots and NM', async () => {
  await page.click('[data-tab="tools"]');
  await page.fill('#sdt-speed', '10');
  await page.fill('#sdt-dist', '5');
  const r = await page.textContent('#sdt-result');
  assert(r.startsWith('Time: 30 min'), `got "${r}"`);
  await page.click('#sdt-clear');
  await page.fill('#sdt-dist', '3');
  await page.fill('#sdt-min', '15');
  assert((await page.textContent('#sdt-result')) === 'Speed: 12.0 kn', 'speed calc wrong');
});

await check('tools: fuel range uses the rule of thirds', async () => {
  await page.fill('#fuel-onboard', '300');
  await page.fill('#fuel-burn', '60');
  await page.fill('#fuel-speed', '20');
  const r = await page.textContent('#fuel-result');
  assert(r.includes('Endurance 5 h 0 min') && r.includes('1 h 40 min out') && r.includes('Radius 33.3 NM'), `got "${r}"`);
});

// ── 2 NM boundary ──────────────────────────────────────────────────
const pointAt = async (targetM) => page.evaluate(t => {
  // Walk east from Malabar until the distance to land reaches t metres
  for (let lon = 151.265; lon < 151.40; lon += 0.0002) {
    if (window.boundary.distanceToLand(-33.965, lon) >= t) return lon;
  }
  return null;
}, targetM);

await check('2 NM limit is measured from the outermost land or outcrop', async () => {
  const lon = await pointAt(3704);
  assert(lon > 151.295 && lon < 151.32, `2 NM off Malabar at lon ${lon}`);
  const cake = await page.evaluate(() => window.boundary.distanceToLand(-33.926, 151.2654));
  assert(cake < 60, `Wedding Cake Island not treated as land (${Math.round(cake)} m)`);
});

await check('boundary alarm warns at 500 m and alerts beyond the limit', async () => {
  const warnLon = await pointAt(3400);
  const beyondLon = await pointAt(3900);
  await page.click('#boundary-toggle');
  await page.waitForFunction(() => document.getElementById('boundary-bar').className === 'boundary-inside');
  await context.setGeolocation({ latitude: -33.965, longitude: warnLon, accuracy: 8 });
  await page.waitForFunction(() => document.getElementById('boundary-bar').className === 'boundary-warning', null, { timeout: 5000 });
  await context.setGeolocation({ latitude: -33.965, longitude: beyondLon, accuracy: 8 });
  await page.waitForFunction(() => document.getElementById('boundary-bar').className === 'boundary-beyond', null, { timeout: 5000 });
  assert((await page.textContent('#boundary-readout')).includes('BEYOND'), 'readout does not say beyond');
  assert(await page.locator('#boundary-map .m-limit').count() >= 1, 'map has no limit line');
});

// Route engine without the page: detailed and approximate (coarse grid) routes
const { runInNewContext } = await import('node:vm');
const routeEngine = await (async () => {
  const src = f => readFile(join(ROOT, f), 'utf8');
  const ctx = { Math, console };
  runInNewContext([(await src('geo.js')).replace(/^const /gm, 'var '),
    (await src('coast.js')).replace('const COAST', 'var COAST'),
    (await src('coast-outer.js')).replace('const COAST_OUTER', 'var COAST_OUTER')].join('\n'), ctx);
  const r = await src('route.js');
  runInNewContext('var NM = 1852;\n' + r.slice(r.indexOf('  // ── Grids'), r.indexOf('  // ── UI ──')) + '\nthis.route = route;', ctx);
  return ctx.route;
})();
const timed = (a, b) => { const t = performance.now(); const r = routeEngine(a, b); return [r, performance.now() - t]; };

await check('route engine: detailed area runs Era to Long Reef, quickly', async () => {
  const [r, ms] = timed({ lat: -34.19, lon: 151.06 }, { lat: -33.742, lon: 151.318 });
  assert(r && !r.approx && r.nm > 28 && r.nm < 34, `Figure Eight → Long Reef ${r && r.nm} NM approx=${r && r.approx}`);
  assert(ms < 2000, `longest detailed route took ${ms.toFixed(0)} ms`);
  const [h] = timed({ lat: -34.085, lon: 151.15 }, { lat: -33.853, lon: 151.247 });
  assert(h && !h.approx, 'Bundeena → Bradleys Head should be detailed');
});

await check('route engine: into Pittwater goes round Barrenjoey, not over the isthmus', async () => {
  const [r] = timed({ lat: -33.60055, lon: 151.32315 }, { lat: -33.61426, lon: 151.32256 }); // Palm Beach → Careel Bay
  assert(r && r.approx && !r.direct, `Palm Beach → Careel Bay: ${JSON.stringify(r && { nm: r.nm, direct: r.direct })}`);
  assert(Math.max(...r.pts.map(p => p[0])) > -33.585, 'route did not go north round Barrenjoey');
  assert(r.nm > 3, `${r.nm.toFixed(1)} NM is too short to have gone round`);
});

await check('route engine: approximate routes reach Woy Woy, Bobbin Head, Newcastle and Scarborough', async () => {
  for (const [a, b, name] of [
    [{ lat: -33.48316, lon: 151.32506 }, { lat: -33.54652, lon: 151.34544 }, 'Woy Woy Wharf → Box Head'],
    [{ lat: -33.66029, lon: 151.16067 }, { lat: -33.55131, lon: 151.27468 }, 'Bobbin Head → Patonga'],
    [{ lat: -32.92749, lon: 151.78635 }, { lat: -33.44499, lon: 151.44394 }, 'Newcastle Beach → Terrigal'],
    [{ lat: -34.2675, lon: 150.95972 }, { lat: -34.17, lon: 151.065 }, 'Scarborough → Garie']]) {
    const [r, ms] = timed(a, b);
    assert(r && r.approx, `${name}: no approximate route`);
    assert(ms < 2000, `${name} took ${ms.toFixed(0)} ms`);
  }
  // Open water both ends: a straight line
  const [d] = timed({ lat: -33.85, lon: 151.40 }, { lat: -33.70, lon: 151.42 });
  assert(d && d.direct, 'clear water should give a straight line');
});

await check('no uncaught page errors', async () => {
  assert(errors.length === 0, errors.join('; '));
});

// ── Screenshots ────────────────────────────────────────────────────
const shotDir = await mkdtemp(join(process.env.CLAUDE_SCRATCH || tmpdir(), 'smoke-'));
const shoot = async (name, fn) => { try { await fn(); await page.screenshot({ path: join(shotDir, name) }); } catch (e) { console.log(`(screenshot ${name} skipped: ${e.message.split('\n')[0]})`); } };
await shoot('tools.png', async () => { await page.click('[data-tab="tools"]'); });
try { await page.locator('#boundary-map').screenshot({ path: join(shotDir, 'boundary-map.png') }); } catch { /* optional */ }
await shoot('log.png', async () => { await page.click('[data-tab="log"]'); });
await shoot('recording.png', async () => {
  await startRec();
  await page.evaluate(() => window.__speech.interim('jet ski broken down east of'));
});
try { await page.evaluate(() => window.__speech.say('jet ski broken down east of boora point')); await stopRec(); } catch { /* optional */ }
await shoot('weather.png', async () => { await page.click('[data-tab="weather"]'); });
await shoot('info.png', async () => { await page.click('[data-tab="info"]'); });
await shoot('crew-edit.png', async () => { await page.click('[data-tab="log"]'); await page.click('#shift-summary'); });
await shoot('log-ipad.png', async () => { await page.setViewportSize({ width: 820, height: 1180 }); await page.click('#start-cancel'); });
await browser.close();
server.close();

for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? ` — ${msg}` : ''}`);
console.log(`\nScreenshots: ${shotDir}`);
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
