// Builds the stakeholder app guide: drives the real app in headless Chromium
// with example data, screenshots each screen, measures where every component
// in components.mjs sits, and writes one self-contained HTML page with
// numbered markers and explanations.
//
//   node docs/guide/build-guide.mjs [output.html]
//
// Re-run after any UI change and republish the output to the same artifact.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { SCREENS, EXPLAINERS } from './components.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.argv[2] || join(ROOT, 'app-guide.html');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// ── Example data so every component is visible ────────────────────
const fakeSpeech = () => {
  let active = null;
  class FakeRecognition {
    start() { setTimeout(() => { active = this; this.onstart?.(); }, 0); }
    stop() { setTimeout(() => { active = null; this.onend?.(); }, 0); }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeRecognition;
  window.__interim = text => active?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: false })] });
  navigator.share = undefined;
};

const hours = Array.from({ length: 72 }, (_, i) => {
  const d = new Date(Date.now() + (i - 2) * 3600000);
  return d.toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' }).slice(0, 13).replace(' ', 'T') + ':00';
});
const wave = (i, base, amp, period) => +(base + amp * Math.sin(i * 2 * Math.PI / period)).toFixed(1);
const forecast = {
  current: { wind_speed_10m: 16, wind_direction_10m: 22, wind_gusts_10m: 24, temperature_2m: 23 },
  hourly: { time: hours, wind_speed_10m: hours.map((_, i) => Math.round(wave(i, 18, 7, 24))), wind_direction_10m: hours.map((_, i) => (20 + i * 4) % 360),
            wind_gusts_10m: hours.map((_, i) => Math.round(wave(i, 25, 8, 24))), precipitation: hours.map((_, i) => i % 9 === 4 ? 0.8 : 0),
            temperature_2m: hours.map((_, i) => Math.round(wave(i, 22, 3, 24))), weather_code: hours.map((_, i) => [1, 2, 3, 61, 3, 2][i % 6]) }
};
const marine = {
  hourly: { time: hours, swell_wave_height: hours.map((_, i) => wave(i, 1.3, 0.3, 30)), swell_wave_direction: hours.map(() => 170),
            swell_wave_period: hours.map(() => 9), sea_surface_temperature: hours.map(() => 20.5),
            sea_level_height_msl: hours.map((_, i) => +(Math.sin((i - 2) * 2 * Math.PI / 12.4) * 0.7).toFixed(2)) }
};
const feed = {
  updated: new Date().toISOString(), errors: [],
  bom: { issued: 'Sat 10:00', areas: [
    { name: 'Sydney Coast: Broken Bay to Port Hacking', synoptic: '', periods: [
      { label: 'Saturday 31 Oct', warning: 'Strong Wind Warning for Saturday for Sydney Coast', winds: 'Northerly 20 to 25 knots, reaching up to 30 knots offshore in the evening.', seas: '1.5 to 2 metres.', swell1: 'Southerly 1 to 1.5 metres.', swell2: '', weather: 'Partly cloudy. 70% chance of showers.', caution: 'Surf conditions may be more powerful than they appear.' },
      { label: 'Sunday 1 Nov', warning: '', winds: 'Northwesterly 10 to 15 knots shifting southerly 15 to 20 knots.', seas: '1 to 1.5 metres.', swell1: 'Southerly 1 metre.', swell2: '', weather: 'Partly cloudy. 60% chance of showers.', caution: '' }] }] },
  warnings: [
    { title: 'Strong Wind Warning for Saturday for Sydney Coast', area: 'Sydney Coast: Broken Bay to Port Hacking', source: 'BOM coastal waters forecast',
      detail: 'Winds: Northerly 20 to 25 knots, reaching up to 30 knots offshore in the evening.\nSeas: 1.5 to 2 metres.' },
    { title: 'Hazardous Surf Warning for New South Wales', area: 'Sydney Coast, Illawarra Coast', issued: 'Sat 04:19', link: 'https://www.bom.gov.au/products/IDN28522.shtml', source: 'BOM warnings',
      detail: 'Surf and swell conditions are expected to be hazardous for coastal activities such as rock fishing, boating, and swimming.\nHazardous Surf Warning: Hunter Coast, Sydney Coast and Illawarra Coast' }
  ],
  ww: null
};
const at = mins => new Date(Date.now() - mins * 60000).toISOString();
const seed = {
  surfPatrolShift: JSON.stringify({ duty: 'Patrol', dutyOther: '', date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Australia/Sydney' }),
    skipper: 'Matt Pacey', driver: 'Marie Bowen', crew: ['Nick Tyler', 'Chiara Palazzo'], loggedOff: [] }),
  surfPatrolLogs: JSON.stringify([
    { timestamp: at(95), text: 'Departed Malabar, crew of four. Conditions northerly 15 knots, swell 1.2 m.', pos: { lat: -33.9655, lon: 151.2575, acc: 8 } },
    { timestamp: at(40), text: 'Two swimmers outside the flags at Maroubra, advised to return.', pos: { lat: -33.9488, lon: 151.2638, acc: 6 } },
    { timestamp: at(12), text: 'Rock fishers at Boora Point without lifejackets, advised.', pos: { lat: -33.9685, lon: 151.2700, acc: 7 } }
  ]),
  surfPatrolCrewNames: JSON.stringify(['Matt Pacey', 'Marie Bowen', 'Nick Tyler', 'Chiara Palazzo'])
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  locale: 'en-AU', timezoneId: 'Australia/Sydney',
  permissions: ['geolocation'], geolocation: { latitude: -33.9685, longitude: 151.2700, accuracy: 8 }
});
await context.addInitScript(fakeSpeech);
await context.route('**/api.open-meteo.com/**', r => r.fulfill({ json: forecast }));
await context.route('**/marine-api.open-meteo.com/**', r => r.fulfill({ json: marine }));
await context.route('https://raw.githubusercontent.com/**/weather.json*', r => r.fulfill({ json: feed }));
await context.route('**/embed.windy.com/**', r => r.fulfill({ contentType: 'text/html',
  body: '<html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#3d6e8f;color:#fff;font:600 15px system-ui">Windy live map</body></html>' }));
const page = await context.newPage();
page.on('dialog', d => d.accept());

// Measure each component on the current page, in page coordinates
async function measure(screen, viewportOnly) {
  return page.evaluate(({ comps, viewportOnly }) => comps.map(c => {
    const el = [...document.querySelectorAll(c.selector)].find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const dy = viewportOnly ? 0 : window.scrollY;
    return { x: r.left, y: r.top + dy, w: r.width, h: r.height };
  }), { comps: screen.components.map(c => ({ selector: c.selector })), viewportOnly });
}

async function shoot(screen, { viewportOnly = false } = {}) {
  if (!viewportOnly) await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const boxes = await measure(screen, viewportOnly);
  const size = await page.evaluate(v => ({ w: document.documentElement.clientWidth, h: v ? window.innerHeight : document.documentElement.scrollHeight }), viewportOnly);
  const buf = await page.screenshot({ fullPage: !viewportOnly, type: 'jpeg', quality: 72 });
  const missing = screen.components.filter((c, i) => !boxes[i]).map(c => c.title);
  if (missing.length) console.warn(`  ${screen.id}: not found on screen — ${missing.join(', ')}`);
  return { ...screen, img: `data:image/jpeg;base64,${buf.toString('base64')}`, size, boxes };
}

const shots = {};
const byId = id => SCREENS.find(s => s.id === id);

// Start screen (fresh device)
await page.goto(url);
shots.start = await shoot(byId('start'));

// Seed an in-progress patrol and reload into the log
await page.evaluate(seedData => { Object.entries(seedData).forEach(([k, v]) => localStorage.setItem(k, v)); localStorage.setItem('surfPatrolBoundaryAlarm', 'on'); }, seed);
await page.reload();
await page.waitForSelector('#warning-banner:not([hidden])');
await page.waitForSelector('#boundary-bar:not([hidden])');
await page.waitForSelector('.log-entry .pos');
shots.log = await shoot(byId('log'));

// Recording
await page.click('#dictate-btn');
await page.waitForTimeout(200);
await page.evaluate(() => window.__interim('jet ski broken down east of Boora Point'));
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
shots.recording = await shoot(byId('recording'), { viewportOnly: true });
await page.click('#dictate-btn');
await page.waitForTimeout(300);

// Weather (warnings opened so the list shows)
await page.click('[data-tab="weather"]');
await page.waitForSelector('.tile');
await page.click('#warnings-summary');
shots.weather = await shoot(byId('weather'));

// Tools with a worked job route
await page.click('[data-tab="tools"]');
for (const [which, typed, name] of [['from', 'coogee', 'Coogee Beach'], ['to', 'ben buck', 'Ben Buckler Headland']]) {
  await page.click(`#route-${which}-btn`);
  await page.fill(`#route-${which}-input`, typed);
  await page.click(`#route-${which}-list [role="option"]:text-is("${name}")`);
}
await page.fill('#route-speed', '20');
await page.waitForFunction(() => document.getElementById('route-result').textContent.includes('at 20 kn'));
shots.tools = await shoot(byId('tools'));

// Info
await page.click('[data-tab="info"]');
await page.waitForFunction(() => document.querySelectorAll('#perm-list li').length === 3);
shots.info = await shoot(byId('info'));

// Edit dialog
await page.click('[data-tab="log"]');
await page.evaluate(() => window.scrollTo(0, 0));
await page.click('.log-entry >> nth=1');
await page.waitForSelector('#edit-dialog[open]');
shots.edit = await shoot(byId('edit'), { viewportOnly: true });

await browser.close();
server.close();

// ── Page ──────────────────────────────────────────────────────────
let version = '';
try { version = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { /* not a git checkout */ }
const updated = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ordered = SCREENS.map(s => shots[s.id]);

const sections = ordered.map(s => {
  let n = 0;
  const items = s.components.map((c, i) => ({ ...c, box: s.boxes[i] })).filter(c => c.box).map(c => ({ ...c, n: ++n }));
  const pct = (v, total) => (v / total * 100).toFixed(3);
  const markers = items.map(c => `
        <button class="marker" type="button" data-screen="${s.id}" data-n="${c.n}" aria-label="${esc(c.title)}"
          style="left:${pct(Math.min(c.box.x + c.box.w - 14, s.size.w - 28), s.size.w)}%;top:${pct(Math.max(c.box.y - 10, 0), s.size.h)}%">${c.n}</button>
        <span class="hilite" data-screen="${s.id}" data-n="${c.n}"
          style="left:${pct(c.box.x, s.size.w)}%;top:${pct(c.box.y, s.size.h)}%;width:${pct(c.box.w, s.size.w)}%;height:${pct(c.box.h, s.size.h)}%"></span>`).join('');
  const rows = (label, text) => text ? `<div class="row"><dt>${label}</dt><dd>${esc(text)}</dd></div>` : '';
  const cards = items.map(c => `
        <li class="item" id="${s.id}-${c.n}" data-screen="${s.id}" data-n="${c.n}" tabindex="0">
          <span class="num">${c.n}</span>
          <div class="body">
            <h3>${esc(c.title)}</h3>
            <dl>${rows('What', c.what)}${rows('How to use', c.use)}${rows('Data', c.data)}${rows('Note', c.note)}</dl>
          </div>
        </li>`).join('');
  return `
    <section class="screen" id="${s.id}" aria-labelledby="${s.id}-title">
      <header class="screen-head">
        <h2 id="${s.id}-title">${esc(s.title)}</h2>
        <p>${esc(s.blurb)}</p>
      </header>
      <div class="screen-body">
        <figure class="phone">
          <div class="shot" style="aspect-ratio:${s.size.w}/${s.size.h}">
            <img src="${s.img}" alt="${esc(s.title)} screen" loading="lazy" width="${s.size.w}" height="${s.size.h}">${markers}
          </div>
        </figure>
        <ol class="items">${cards}
        </ol>
      </div>
    </section>`;
}).join('');

const explainers = EXPLAINERS.map(x => `
    <section class="screen explainer" id="${x.id}" aria-labelledby="${x.id}-title">
      <header class="screen-head">
        <h2 id="${x.id}-title">${esc(x.title)}</h2>
        <p>${esc(x.blurb)}</p>
      </header>
      <div class="timeline">${x.rows.map(r => `
        <div class="tl-row"><h3>${esc(r.when)}</h3><p>${esc(r.what)}</p></div>`).join('')}
      </div>
      ${x.note ? `<p class="tl-note">${esc(x.note)}</p>` : ''}
    </section>`).join('');

const nav = [...ordered, ...EXPLAINERS].map(s => `<a href="#${s.id}">${esc(s.title)}</a>`).join('');

const html = `<title>SR30 Patrol Log Guide</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=Barlow:wght@400;500;700&display=swap">
<style>
/* Layout: each screen is a real app screenshot with numbered markers beside a list of what each part does; phone left, notes right on wide screens, stacked on phones. */
:root {
  --bg: #F3F6FA; --surface: #FFFFFF; --ink: #10233A; --muted: #4D5F74; --line: #D6DFEA;
  --navy: #003366; --red: #CC2200; --yellow: #FFD200; --marker-ink: #10233A;
  --display: 'Barlow Condensed', 'Arial Narrow', Arial, sans-serif;
  --text: 'Barlow', 'Segoe UI', Arial, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0B1622; --surface: #12212F; --ink: #E7EEF6; --muted: #A7B6C7; --line: #24384C;
  --navy: #7FB2E6; --red: #FF6B57; --yellow: #FFD200; --marker-ink: #10233A; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #0B1622; --surface: #12212F; --ink: #E7EEF6; --muted: #A7B6C7; --line: #24384C;
  --navy: #7FB2E6; --red: #FF6B57; --yellow: #FFD200; --marker-ink: #10233A; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 400 16px/1.5 var(--text); }
.wrap { max-width: 1120px; margin: 0 auto; padding-block: 24px 64px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.masthead { display: grid; gap: 6px; border-bottom: 3px solid var(--red); padding-bottom: 16px; }
.masthead .eyebrow { font: 800 13px/1 var(--display); letter-spacing: .14em; text-transform: uppercase; color: var(--red); }
.masthead h1 { margin: 0; font: 800 clamp(34px, 6vw, 52px)/1 var(--display); text-transform: uppercase; color: var(--navy); text-wrap: balance; }
.masthead p { margin: 0; max-width: 62ch; color: var(--muted); }
.meta { font-size: 13px; color: var(--muted); }
.meta a { color: var(--navy); }
nav.jump { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; display: flex; gap: 6px; overflow-x: auto;
  background: var(--bg); padding: 10px 0; border-bottom: 1px solid var(--line); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }
nav.jump a { flex: none; font: 700 14px/1 var(--text); color: var(--ink); text-decoration: none; padding: 9px 12px;
  border: 1.5px solid var(--line); border-radius: 999px; background: var(--surface); }
nav.jump a:hover, nav.jump a:focus-visible { border-color: var(--navy); outline: none; }
.screen { padding-top: 36px; scroll-margin-top: 64px; }
.screen-head h2 { margin: 0; font: 800 30px/1.1 var(--display); text-transform: uppercase; letter-spacing: .02em; color: var(--navy); }
.screen-head p { margin: 4px 0 0; max-width: 65ch; color: var(--muted); }
.screen-body { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 28px; margin-top: 18px; align-items: start; }
@media (max-width: 760px) { .screen-body { grid-template-columns: minmax(0, 1fr); } .phone { max-width: 340px; margin: 0 auto; } }
.phone { margin: 0; position: sticky; top: 72px; background: #0E1A26; border-radius: 28px; padding: 10px;
  box-shadow: 0 1px 0 var(--line), 0 18px 40px -24px rgba(0, 20, 40, .55); }
@media (max-width: 760px) { .phone { position: static; } }
.shot { position: relative; width: 100%; max-width: 100%; border-radius: 20px; overflow: hidden; background: #003366; }
.shot img { display: block; width: 100%; height: 100%; }
.marker { position: absolute; z-index: 2; width: 26px; height: 26px; margin: 0; padding: 0; border-radius: 50%;
  border: 2px solid #fff; background: var(--yellow); color: var(--marker-ink); font: 800 13px/1 var(--text);
  cursor: pointer; box-shadow: 0 2px 6px rgba(0, 0, 0, .45); transition: transform .12s; }
.marker:hover, .marker:focus-visible { transform: scale(1.15); outline: none; }
.marker.on { background: var(--red); color: #fff; transform: scale(1.2); }
.hilite { position: absolute; z-index: 1; border: 3px solid var(--red); border-radius: 8px; box-shadow: 0 0 0 4000px rgba(0, 15, 30, .35);
  opacity: 0; pointer-events: none; transition: opacity .15s; }
.hilite.on { opacity: 1; }
.items { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; min-width: 0; }
.item { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 12px; padding: 12px 14px; background: var(--surface);
  border: 1.5px solid var(--line); border-radius: 12px; cursor: pointer; scroll-margin-top: 80px; }
.item:hover, .item:focus-visible { border-color: var(--navy); outline: none; }
.item.on { border-color: var(--red); box-shadow: 0 0 0 2px var(--red) inset; }
.num { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--yellow);
  color: var(--marker-ink); font: 800 13px/1 var(--text); }
.item.on .num { background: var(--red); color: #fff; }
.item h3 { margin: 2px 0 6px; font: 800 19px/1.15 var(--display); text-transform: uppercase; letter-spacing: .02em; }
.item dl { margin: 0; display: grid; gap: 5px; }
.row { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 10px; }
@media (max-width: 420px) { .row { grid-template-columns: minmax(0, 1fr); gap: 0; } }
dt { font: 700 12px/1.6 var(--text); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
dd { margin: 0; max-width: 62ch; }
.timeline { display: grid; gap: 0; margin-top: 18px; max-width: 760px; border-left: 3px solid var(--navy); }
.tl-row { position: relative; padding: 4px 0 18px 22px; }
.tl-row::before { content: ""; position: absolute; left: -9px; top: 8px; width: 15px; height: 15px; border-radius: 50%;
  background: var(--yellow); border: 2px solid var(--navy); }
.tl-row h3 { margin: 0 0 4px; font: 800 19px/1.15 var(--display); text-transform: uppercase; letter-spacing: .02em; }
.tl-row p { margin: 0; max-width: 62ch; }
.tl-note { max-width: 65ch; margin: 6px 0 0; padding: 10px 14px; border-radius: 10px; background: var(--surface);
  border: 1.5px solid var(--line); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; scroll-behavior: auto !important; } }
</style>
<div class="wrap">
  <header class="masthead">
    <span class="eyebrow">Surf Rescue 30 · Malabar</span>
    <h1>Patrol Log Guide</h1>
    <p>What every part of the app does, for walking stakeholders through it. Tap a numbered marker on a screen, or a description, to highlight that part. Screens use example data: crew, entries and weather are samples.</p>
    <span class="meta">Updated ${esc(updated)}${version ? ` · app version ${esc(version)}` : ''} · Live app: <a href="https://surfrescue30.github.io/surf-rescue-30-app/" target="_blank" rel="noopener">surfrescue30.github.io/surf-rescue-30-app</a></span>
  </header>
  <nav class="jump" aria-label="Screens">${nav}</nav>
  ${sections}
  ${explainers}
</div>
<script>
(() => {
  const all = sel => [...document.querySelectorAll(sel)];
  function select(screen, n, from) {
    all('.marker.on, .hilite.on, .item.on').forEach(e => e.classList.remove('on'));
    const q = '[data-screen="' + screen + '"][data-n="' + n + '"]';
    all(q).forEach(e => e.classList.add('on'));
    const item = document.querySelector('.item' + q);
    const marker = document.querySelector('.marker' + q);
    if (from === 'marker' && item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (from === 'item' && marker && window.matchMedia('(max-width: 760px)').matches) marker.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  all('.marker').forEach(m => m.addEventListener('click', () => select(m.dataset.screen, m.dataset.n, 'marker')));
  all('.item').forEach(i => {
    i.addEventListener('click', () => select(i.dataset.screen, i.dataset.n, 'item'));
    i.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i.dataset.screen, i.dataset.n, 'item'); } });
  });
})();
</script>
`;
await writeFile(OUT, html);
console.log(`Wrote ${OUT} (${Math.round(html.length / 1024)} KB, ${ordered.length} screens, ${ordered.reduce((n, s) => n + s.boxes.filter(Boolean).length, 0)} components)`);
