// Builds weather.json for the app from BOM marine forecasts, BOM warnings and
// (if a key is set) WillyWeather tides/observations.
// Run by .github/workflows/weather-data.yml every 30 minutes. The workflow
// downloads the BOM files from BOM's anonymous FTP service (their documented
// route for automated access) into <bom-dir>; this script only parses them.
//   node data-scripts/fetch_weather.mjs <out-dir> <bom-dir>
// Env: WW_API_KEY (optional), WW_LOCATION_ID (optional)
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BOM_PRODUCTS = [
  { file: 'IDN11001.xml', areas: ['NSW_MW004'] },              // Sydney Coast: Broken Bay to Port Hacking
  { file: 'IDN11013.xml', areas: ['NSW_MW009'] }               // Sydney Enclosed Waters
];
const bomDir = process.argv[3] || 'bom';
// Warnings that matter on the water off Sydney. Severe weather/thunderstorm
// warnings can be anywhere in the state, so only keep those for our area.
const MARINE = /marine wind|hazardous surf|gale|storm force|hurricane|tsunami|coastal hazard|damaging surf/i;
const LOCAL_SEVERE = /severe (thunderstorm|weather).*(sydney|metropolitan)/i;

const decode = s => s.replace(/\s+/g, ' ').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").trim();
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || '';
const sydney = (iso, opts) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false, ...opts });

async function text(file) {
  return readFileSync(join(bomDir, file), 'utf8');
}

// ── BOM coastal & local waters forecasts ───────────────────────────
async function getBom() {
  const areas = [];
  const coastWarnings = [];
  let issued = '';
  for (const product of BOM_PRODUCTS) {
    const xml = await text(product.file);
    if (!issued) {
      const t = (xml.match(/<issue-time-utc[^>]*>([^<]+)</) || [])[1];
      if (t) issued = sydney(t, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    }
    for (const m of xml.matchAll(/<area\b([^>]*)>([\s\S]*?)<\/area>/g)) {
      if (!product.areas.includes(attr(m[1], 'aac'))) continue;
      const name = attr(m[1], 'description').replace(/ coast$/, '');
      const periods = [];
      let synoptic = '';
      for (const p of m[2].matchAll(/<forecast-period\b([^>]*)>([\s\S]*?)<\/forecast-period>/g)) {
        const t = {};
        for (const x of p[2].matchAll(/<text type="([^"]+)">([\s\S]*?)<\/text>/g)) t[x[1]] = decode(x[2]);
        const warnings = [...p[2].matchAll(/<warning-summary[^>]*>([\s\S]*?)<\/warning-summary>/g)].map(w => decode(w[1]));
        if (t.synoptic_situation && !synoptic) synoptic = t.synoptic_situation;
        if (!t.forecast_winds && !t.forecast_seas && !t.forecast_weather) continue;
        const start = attr(p[1], 'start-time-utc');
        const label = start ? sydney(start, { weekday: 'long', day: 'numeric', month: 'short' }).replace(/ at .*/, '') : '';
        if (periods.length < 2) warnings.forEach(w => coastWarnings.push({
          title: w, area: name, source: 'BOM coastal waters forecast',
          detail: [t.forecast_winds && `Winds: ${t.forecast_winds}`, t.forecast_seas && `Seas: ${t.forecast_seas}`,
                   t.forecast_swell1 && `Swell: ${t.forecast_swell1}`, t.forecast_caution].filter(Boolean).join('\n')
        }));
        periods.push({
          label, warning: warnings.join(' · '),
          winds: t.forecast_winds || '', seas: t.forecast_seas || '',
          swell1: t.forecast_swell1 || '', swell2: t.forecast_swell2 || '',
          weather: t.forecast_weather || '', caution: t.forecast_caution || ''
        });
      }
      areas.push({ name, synoptic, periods });
    }
  }
  return { issued, areas, coastWarnings };
}

// ── BOM warning products (IDN2xxxx, downloaded by the workflow) ──────
// Each file only exists while its warning is current. Keep warnings that
// cover our waters, and say which of our areas they apply to.
const OUR_AREAS = /sydney coast|sydney enclosed|sydney closed|botany bay|sydney metropolitan|sydney/i;
async function getWarnings() {
  const dir = join(bomDir, 'warnings');
  let files = [];
  try { files = readdirSync(dir).filter(f => /^IDN2\d{4}\.xml$/.test(f)); } catch { return []; }
  const items = [];
  for (const f of files) {
    const xml = readFileSync(join(dir, f), 'utf8');
    const texts = type => [...xml.matchAll(new RegExp(`<text type="${type}">([\\s\\S]*?)</text>`, 'g'))].map(m => decode(m[1].replace(/<[^>]+>/g, ' ')));
    const expiry = (xml.match(/<expiry-time>([^<]+)</) || [])[1];
    if (expiry && new Date(expiry) < new Date()) continue;
    const title = texts('warning_title')[0] || texts('warning_phenomena_summary')[0] || '';
    if (!title) continue;
    const areas = [...texts('warning_areas'), ...texts('warning_area_summary')].join(', ');
    if (!(MARINE.test(title) || LOCAL_SEVERE.test(`${title} ${areas}`))) continue;
    if (areas && !OUR_AREAS.test(areas)) continue; // e.g. a surf warning for the North Coast only
    const ours = areas.split(/,| and /).map(a => a.trim()).filter(a => OUR_AREAS.test(a));
    const issued = (xml.match(/<issue-time-utc>([^<]+)</) || [])[1];
    const id = f.replace('.xml', '');
    // Full text for the in-app details: situation, what applies where, advice
    // Summary products (e.g. Marine Wind Warning Summary) only list phenomena and areas
    const phen = texts('warning_phenomena'), areaList = texts('warning_areas');
    const pairs = phen.map((p, k) => areaList[k] ? `${p}: ${areaList[k]}` : p);
    const detail = [...texts('synoptic_situation'), ...pairs, ...texts('warning_advice')]
      .filter(line => line && line.length > 5).join('\n');
    items.push({
      title,
      detail,
      area: ours.length ? ours.join(', ') : '',
      issued: issued ? sydney(issued, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '',
      link: `https://www.bom.gov.au/products/${id}.shtml`,
      source: 'BOM warnings'
    });
  }
  return items;
}

// ── WillyWeather (only when a key is configured) ───────────────────
async function getWw() {
  const key = process.env.WW_API_KEY;
  if (!key) return null;
  const base = `https://api.willyweather.com.au/v2/${key}`;
  let id = process.env.WW_LOCATION_ID;
  if (!id) {
    const found = await (await fetch(`${base}/search.json?query=Malabar&limit=1`)).json();
    id = found?.[0]?.id;
    if (!id) throw new Error('WillyWeather: Malabar not found');
  }
  const res = await fetch(`${base}/locations/${id}/weather.json?forecasts=tides&observational=true&days=2`);
  if (!res.ok) throw new Error(`WillyWeather HTTP ${res.status}`);
  const data = await res.json();
  // Field names per WillyWeather API v2 docs — verify against the first live response
  const tides = (data.forecasts?.tides?.days || []).flatMap(d => d.entries || []).map(e => ({
    dateTime: e.dateTime, height: e.height, type: e.type
  }));
  const wind = data.observational?.observations?.wind;
  const observed = wind ? {
    station: data.observational?.stations?.wind?.name || 'nearest station',
    speedKmh: wind.speed, gustKmh: wind.gustSpeed, direction: wind.directionText || '',
    time: (data.observational?.issueDateTime || '').slice(11, 16)
  } : null;
  return { location: data.location?.name, tides, observed };
}

// ── Open-Meteo model forecast (wind, sky, swell) for the app's Weather tab ──
// Fetched here, every 30 min with retries, so phones read it from weather.json
// instead of calling Open-Meteo themselves: from phones it often hangs or
// answers 429 "Minutely API request limit exceeded" (shared mobile addresses).
// Same request as weather.js; the point comes from config.js.
const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const POINT = {
  lat: +(cfg.match(/forecastPoint:\s*{[^}]*lat:\s*(-?[\d.]+)/) || [])[1],
  lon: +(cfg.match(/forecastPoint:\s*{[^}]*lon:\s*(-?[\d.]+)/) || [])[1]
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJsonRetry(url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.status === 429) { last = new Error('HTTP 429 (rate limited)'); await sleep(30000); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
}
async function getModel() {
  if (!Number.isFinite(POINT.lat) || !Number.isFinite(POINT.lon)) throw new Error('forecastPoint not found in config.js');
  const common = `latitude=${POINT.lat}&longitude=${POINT.lon}&timezone=Australia%2FSydney&forecast_days=3`;
  const [wx, sea] = await Promise.all([
    getJsonRetry(`https://api.open-meteo.com/v1/forecast?${common}&wind_speed_unit=kn` +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,temperature_2m,weather_code,is_day' +
      '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m'),
    getJsonRetry(`https://marine-api.open-meteo.com/v1/marine?${common}` +
      '&hourly=swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature')
  ]);
  return { at: new Date().toISOString(), wx, sea };
}
// If Open-Meteo is down for this run, keep the forecast already published
async function previousModel() {
  const repo = process.env.GITHUB_REPOSITORY || 'SurfRescue30/surf-rescue-30-app';
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/weather-data/weather.json?t=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const m = (await res.json()).model;
  return m && Date.now() - Date.parse(m.at) < 24 * 3600000 ? m : null;
}

const out = process.argv[2] || 'out';
mkdirSync(out, { recursive: true });
const result = { updated: new Date().toISOString(), errors: [] };
const settle = async (name, fn) => {
  try { return await fn(); } catch (e) { result.errors.push(`${name}: ${e.message}`); console.error(name, e.message); return null; }
};
const bom = await settle('bom', getBom);
const warnings = await settle('warnings', getWarnings);
result.bom = bom ? { issued: bom.issued, areas: bom.areas } : null;
result.warnings = [...(bom?.coastWarnings || []), ...(warnings || [])];
result.ww = await settle('willyweather', getWw);
result.model = await settle('open-meteo', getModel) || await settle('open-meteo (previous)', previousModel);
writeFileSync(join(out, 'weather.json'), JSON.stringify(result, null, 1));
console.log(`areas ${result.bom?.areas.length ?? 0}, warnings ${result.warnings.length}, ww ${result.ww ? 'yes' : 'no'}, model ${result.model ? result.model.at : 'no'}, errors ${result.errors.length}`);
if (!result.bom && !warnings) process.exit(1);
