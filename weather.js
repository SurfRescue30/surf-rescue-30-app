/* ── Surf Patrol Log – weather.js ──
   Weather tab:
   - Warnings and BOM marine forecast from weather.json (published by the
     "Weather data" GitHub workflow), shown as a badge/banner app-wide.
   - Model forecast from Open-Meteo (free, no key): now tiles, tide estimate
     and a 24-hour strip.
   - Sun, first and last light and the moon (moon.js) calculated on the device.
     Night hours in the strip are shaded, with the moon (or a dark sky) in place of the sun.
   - Live maps: Windy (wind, waves) and RainViewer (radar, auto-plays).
   Last good data is cached so a dead spot still shows the latest, with its age.
*/
(() => {
  const WX_CACHE   = 'surfPatrolWx';
  const FEED_CACHE = 'surfPatrolFeed';
  const UNITS_KEY  = 'surfPatrolUnits';
  const point = APP_CONFIG.forecastPoint;

  const $ = id => document.getElementById(id);
  const wxNow = $('wx-now'), wxStrip = $('wx-strip'), wxUpdated = $('wx-updated');
  const warningsCard = $('warnings-card'), warningsSummary = $('warnings-summary');
  const warningsBody = $('warnings-body'), warnBadge = $('warn-badge'), warnBanner = $('warning-banner');
  const bomBody = $('bom-body'), wwCard = $('ww-card'), wwBody = $('ww-body');
  const mapWrap = $('map-wrap'), mapPills = $('map-pills'), mapCredit = $('map-credit');
  const unitPills = $('wind-unit');

  let loadedAt = 0;
  let model = null; // last Open-Meteo data, re-rendered when units change
  let feed = null;  // last weather.json

  // ── Units (remembered per device) ─────────────────────────────────
  let units = { wind: 'kn' };
  try { units = { ...units, ...JSON.parse(localStorage.getItem(UNITS_KEY)) }; } catch { /* defaults */ }
  unitPills.querySelector(`input[value="${units.wind}"]`).checked = true;

  const windLabel = () => units.wind === 'kmh' ? 'km/h' : 'kn';
  const wind = kn => kn == null ? null : units.wind === 'kmh' ? kn * 1.852 : kn;

  unitPills.addEventListener('change', e => {
    units.wind = e.target.value;
    try { localStorage.setItem(UNITS_KEY, JSON.stringify(units)); } catch { /* storage unavailable */ }
    if (model) renderModel(model.data, model.at);
    if (feed) renderFeed(feed.data, feed.at);
  });

  // ── Helpers ───────────────────────────────────────────────────────
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = deg => deg == null ? '–' : COMPASS[Math.round(deg / 22.5) % 16];
  const fmt = (v, dp = 0) => v == null || Number.isNaN(v) ? '–' : Number(v).toFixed(dp);
  const hhmm = d => d.toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false });
  // Sydney wall-clock "YYYY-MM-DDTHH:MM" → instant, right in both AEST (+10) and AEDT (+11)
  const sydneyMs = t => {
    for (const off of ['+11:00', '+10:00']) {
      const ms = new Date(t.slice(0, 16) + ':00' + off).getTime();
      if (sydneyKey(new Date(ms)) === t.slice(0, 13)) return ms;
    }
    return new Date(t.slice(0, 16) + ':00+10:00').getTime(); // the hour skipped when clocks go forward
  };
  const sydneyKey = d => d.toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' }).slice(0, 13).replace(' ', 'T'); // YYYY-MM-DDTHH
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  function cacheGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function cacheSet(key, data) { try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* full */ } }
  function ageLabel(at) {
    const mins = Math.round((Date.now() - at) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    return `${Math.round(mins / 60)} h ago`;
  }
  // One bar of signal can leave a request hanging for minutes; give up after
  // 12 s so the saved copy is used instead of a spinner
  async function fetchJson(url, ms = 12000) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { cache: 'no-store', signal: ctl?.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Open-Meteo's forecast server leaves a share of requests hanging (seen in
  // Nov 2026: ~4 in 10 never answer, the rest answer in under half a second).
  // So if there's no answer in 2.5 s, send the same request again alongside it
  // and take whichever answers first: 2 tries, each given 10 s. (More would
  // add to Open-Meteo's per-address limit, which shared mobile addresses hit.)
  function fetchHedged(url, { hedgeMs = 2500, max = 2, ms = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      const ctls = [];
      let started = 0, failed = 0, done = false, lastErr = null;
      const finish = (ok, v) => {
        if (done) return;
        done = true;
        ctls.forEach(c => c && c.abort());
        ok ? resolve(v) : reject(v);
      };
      const launch = () => {
        if (done || started >= max) return;
        const n = started++;
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        ctls.push(ctl);
        const timer = ctl && setTimeout(() => ctl.abort(), ms);
        // A tag makes each try a separate request (the server ignores it)
        fetch(`${url}${url.includes('?') ? '&' : '?'}try=${n}`, { cache: 'no-store', signal: ctl?.signal })
          .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
          .then(d => finish(true, d))
          .catch(e => {
            lastErr = e;
            if (++failed >= max) finish(false, lastErr);
            else launch();                       // failed outright: try again now
          })
          .finally(() => clearTimeout(timer));
        setTimeout(launch, hedgeMs);             // no answer yet: send another
      };
      launch();
    });
  }
  // Is the phone actually offline? (Only then say "no signal".)
  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  // ── Sun: sunrise/sunset and civil twilight (first/last light) ─────
  // Standard sunrise equation; zenith 90.833° for sun, 96° for civil twilight.
  function sunEvent(dateKey, zenith, rising) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const rad = Math.PI / 180;
    const N = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
    const lngHour = point.lon / 15;
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = (M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634 + 360) % 360;
    let RA = (Math.atan(0.91764 * Math.tan(L * rad)) / rad + 360) % 360;
    RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(zenith * rad) - sinDec * Math.sin(point.lat * rad)) / (cosDec * Math.cos(point.lat * rad));
    if (cosH > 1 || cosH < -1) return null;
    const H = (rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
    const T = H + RA - 0.06571 * t - 6.622;
    const UT = ((T - lngHour) % 24 + 24) % 24;
    let when = new Date(Date.UTC(y, m - 1, d) + UT * 3600000);
    // UT can land on the neighbouring UTC day — pull it into the local day asked for
    for (let i = 0; i < 2 && when.toLocaleDateString('sv-SE', { timeZone: 'Australia/Sydney' }) !== dateKey; i++) {
      when = new Date(when.getTime() + (when.toLocaleDateString('sv-SE', { timeZone: 'Australia/Sydney' }) < dateKey ? 1 : -1) * 86400000);
    }
    return when;
  }

  function sunToday() {
    const key = new Date().toLocaleDateString('sv-SE', { timeZone: 'Australia/Sydney' });
    return {
      firstLight: sunEvent(key, 96, true), sunrise: sunEvent(key, 90.833, true),
      sunset: sunEvent(key, 90.833, false), lastLight: sunEvent(key, 96, false)
    };
  }

  // ── Tide ──────────────────────────────────────────────────────────
  // Calculated on the phone from Fort Denison harmonic constants (tide.js):
  // free, works offline, high/low times within a few minutes.
  function tideInfo() {
    const now = Date.now();
    const events = Tide.turns(now - 13 * 3600000, now + 30 * 3600000);
    const next = events.filter(e => e.at > now);
    if (!next.length) return null;
    return {
      trend: next[0].type === 'high' ? 'rising' : 'falling',
      nextHigh: next.find(e => e.type === 'high'), nextLow: next.find(e => e.type === 'low'),
      prev: events.filter(e => e.at <= now).pop(),
      source: 'Fort Denison'
    };
  }

  // Within 15 minutes of a high or low, say so rather than rising/falling
  function tideHeadline(tide) {
    const margin = 15 * 60000;
    const next = [tide.nextHigh, tide.nextLow].filter(Boolean).sort((a, b) => a.at - b.at)[0];
    const prev = tide.prev;
    if (next && next.at - Date.now() < margin) return next.type === 'high' ? '≈ Near high' : '≈ Near low';
    if (prev && Date.now() - prev.at < margin) return prev.type === 'high' ? '≈ Near high' : '≈ Near low';
    return tide.trend === 'rising' ? '↑ Rising' : '↓ Falling';
  }

  // ── Open-Meteo model forecast ─────────────────────────────────────
  async function loadModel() {
    const common = `latitude=${point.lat}&longitude=${point.lon}&timezone=Australia%2FSydney&forecast_days=3`;
    const [wx, sea] = await Promise.all([
      fetchHedged(`https://api.open-meteo.com/v1/forecast?${common}&wind_speed_unit=kn` +
        '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,temperature_2m,weather_code,is_day' +
        '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m'),
      fetchHedged(`https://marine-api.open-meteo.com/v1/marine?${common}` +
        '&hourly=swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature')
    ]);
    return { wx, sea };
  }

  // Night sky for clear to partly cloudy hours: the moon if it's up, else a dark starry sky
  const NIGHT_CLEAR = 2;
  function nightSky(code, ms) {
    const box = el('span', 'night-sky');
    if (Moon.isUp(ms, point.lat, point.lon)) {
      const { phase, fraction } = Moon.illumination(ms);
      box.append(Moon.icon(phase, 20));
      box.title = `Moon up, ${Math.round(fraction * 100)}% lit`;
    } else {
      box.append(el('span', 'stars', '✦'));
      box.title = 'Moon down — dark sky';
    }
    if (code === 2) box.append(el('span', 'night-cloud', '☁️'));
    return box;
  }
  // Day or night at an hour: Open-Meteo's is_day, else sunrise/sunset worked out here
  function isNight(h, i) {
    const flag = h.is_day?.[i];
    if (flag != null) return flag === 0;
    const ms = sydneyMs(h.time[i]), key = h.time[i].slice(0, 10);
    const rise = sunEvent(key, 90.833, true), set = sunEvent(key, 90.833, false);
    return !rise || !set ? false : ms < rise.getTime() || ms >= set.getTime();
  }

  // ── Moon tile: phase, % lit, next rise and set ────────────────────
  function moonTile() {
    const now = Date.now();
    const { phase, fraction } = Moon.illumination(now);
    const ev = Moon.events(now, now + 30 * 3600000, point.lat, point.lon);
    const rise = ev.find(e => e.type === 'rise'), set = ev.find(e => e.type === 'set');
    const up = Moon.isUp(now, point.lat, point.lon);
    const t = tile('Moon', Moon.phaseName(phase), [
      `${Math.round(fraction * 100)}% lit · ${up ? 'up now' : 'down now'}`,
      [rise, set].filter(Boolean).sort((a, b) => a.at - b.at)
        .map(e => `${e.type === 'rise' ? 'Rise' : 'Set'} ${hhmm(e.at)}`).join(' · ') || 'No rise or set in the next 30 h'
    ], 'tile-moon');
    t.prepend(Moon.icon(phase, 44));
    return t;
  }

  const SKY = code => code == null ? '' : code === 0 ? '☀️' : code <= 2 ? '🌤️' : code === 3 ? '☁️' : code <= 48 ? '🌫️'
    : code <= 67 ? '🌧️' : code <= 77 ? '🌨️' : code <= 82 ? '🌦️' : '⛈️';

  // Windy-style wind colours (by knots)
  function windColour(kn) {
    if (kn == null) return '';
    if (kn < 5) return '#9FD9F2';
    if (kn < 10) return '#7FE3C9';
    if (kn < 15) return '#8BE36E';
    if (kn < 20) return '#D6E85A';
    if (kn < 26) return '#FFD23F';
    if (kn < 34) return '#FF9A3C';
    return '#FF5A4E';
  }

  // small: text, or a list of lines (each kept on one line)
  function tile(label, big, small, extraClass = '') {
    const t = el('div', `tile ${extraClass}`);
    t.append(el('span', 'tile-label', label), el('span', 'tile-big', big));
    if (Array.isArray(small)) small.forEach(line => t.append(el('span', 'tile-small tile-line', line)));
    else if (small) t.append(el('span', 'tile-small', small));
    return t;
  }

  function renderModel({ wx, sea }, at) {
    model = { data: { wx, sea }, at };
    markReady('model');
    wxUpdated.textContent = `· ${ageLabel(at)}`;
    const h = wx.hourly, m = sea.hourly;
    const nowKey = sydneyKey(new Date());
    let start = h.time.findIndex(t => t.slice(0, 13) >= nowKey);
    if (start < 0) start = 0;
    const si = m.time.indexOf(h.time[start]);
    const c = wx.current || {};
    const sun = sunToday();
    const tide = tideInfo();

    const grid = el('div', 'tiles');
    grid.append(
      tile('Wind', `${fmt(wind(c.wind_speed_10m ?? h.wind_speed_10m[start]))} ${windLabel()} ${compass(c.wind_direction_10m ?? h.wind_direction_10m[start])}`,
        `gusts ${fmt(wind(c.wind_gusts_10m ?? h.wind_gusts_10m[start]))} ${windLabel()}`),
      tile('Swell', `${fmt(m.swell_wave_height[si], 1)} m ${compass(m.swell_wave_direction[si])}`,
        `${fmt(m.swell_wave_period[si])} s period`),
      tide
        ? tile('Tide', tideHeadline(tide),
            // Next turn first, each high/low with its time on its own line
            [tide.nextHigh, tide.nextLow].filter(Boolean).sort((a, b) => a.at - b.at)
              .map(e => `${e.type === 'high' ? 'High' : 'Low'} ${hhmm(e.at)} (${fmt(e.height, 1)} m)`))
        : tile('Tide', '–', 'no tide data'),
      tile('Water', `${fmt(m.sea_surface_temperature[si], 1)} °C`, c.temperature_2m != null ? `air ${fmt(c.temperature_2m)} °C` : ''),
      tile('Sunrise / Sunset', `${sun.sunrise ? hhmm(sun.sunrise) : '–'} · ${sun.sunset ? hhmm(sun.sunset) : '–'}`, ''),
      tile('First / Last Light', `${sun.firstLight ? hhmm(sun.firstLight) : '–'} · ${sun.lastLight ? hhmm(sun.lastLight) : '–'}`, ''),
      moonTile()
    );
    wxNow.replaceChildren(grid);

    renderStrip(h, m, start, tide);
  }

  // Horizontal hour-by-hour strip, like Windy's bottom panel
  function renderStrip(h, m, start, tide) {
    const end = Math.min(start + 24, h.time.length);
    const cols = [];
    for (let i = start; i < end; i++) cols.push(i);

    // Tide direction per hour from the Fort Denison prediction
    const tideAt = i => {
      const ms = sydneyMs(h.time[i]);
      return Tide.height(ms + 1800000) > Tide.height(ms) ? '↑' : '↓';
    };

    const rows = [
      ['', i => {
        const t = h.time[i];
        const label = t.slice(11, 13);
        return i === start || label === '00'
          ? `${new Date(t.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' })} ${label}`
          : label;
      }, 'row-time'],
      ['', i => {
        const code = h.weather_code?.[i];
        return isNight(h, i) && code != null && code <= NIGHT_CLEAR ? nightSky(code, sydneyMs(h.time[i])) : SKY(code);
      }, 'row-sky'],
      ['Temp °C', i => fmt(h.temperature_2m?.[i])],
      ['Rain mm', i => h.precipitation?.[i] ? fmt(h.precipitation[i], 1) : ''],
      [`Wind ${windLabel()}`, i => fmt(wind(h.wind_speed_10m[i])), 'row-wind'],
      [`Gusts ${windLabel()}`, i => fmt(wind(h.wind_gusts_10m[i])), 'row-gust'],
      ['Wind dir', i => compass(h.wind_direction_10m[i]), 'row-dir'],
      ['Swell m', i => { const j = m.time.indexOf(h.time[i]); return j < 0 ? '–' : fmt(m.swell_wave_height[j], 1); }],
      ['Period s', i => { const j = m.time.indexOf(h.time[i]); return j < 0 ? '–' : fmt(m.swell_wave_period[j]); }],
      ['Swell dir', i => { const j = m.time.indexOf(h.time[i]); return j < 0 ? '–' : compass(m.swell_wave_direction[j]); }],
      ['Tide', tideAt, 'row-tide']
    ];

    const table = el('table', 'strip');
    const tbody = el('tbody');
    rows.forEach(([label, value, cls]) => {
      const tr = el('tr', cls || '');
      tr.append(el('th', null, label));
      cols.forEach(i => {
        const td = el('td', i === start ? 'now' : '');
        const v = value(i);
        if (cls === 'row-dir') {
          const arrow = el('span', 'dir-arrow', '↓');
          arrow.style.transform = `rotate(${h.wind_direction_10m[i]}deg)`;
          td.append(arrow, el('span', 'dir-text', v));
        } else if (v instanceof Node) {
          td.append(v);
        } else {
          td.textContent = v;
        }
        if ((cls === 'row-time' || cls === 'row-sky') && isNight(h, i)) td.classList.add('night');
        if (cls === 'row-wind') td.style.backgroundColor = windColour(h.wind_speed_10m[i]);
        if (cls === 'row-gust') td.style.backgroundColor = windColour(h.wind_gusts_10m[i]);
        if (h.time[i].slice(11, 13) === '00' && i !== start) td.classList.add('day-start');
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);
    wxStrip.replaceChildren(table);
  }

  // ── Feed: warnings + BOM forecast (+ WillyWeather) ────────────────
  // Sydney waters only: drop Illawarra-only warnings and Illawarra from area lists
  const SYDNEY = /sydney/i;
  function sydneyWarnings(list) {
    return list
      .map(w => ({ ...w, area: (w.area || '').split(/,\s*/).filter(a => SYDNEY.test(a)).join(', ') }))
      .filter(w => SYDNEY.test(`${w.title} ${w.area}`) || (!/illawarra/i.test(w.title) && !w.area));
  }

  function renderWarnings(all, at) {
    const list = sydneyWarnings(all);
    // Collapsed by default: the summary line carries the count and the first warning
    warningsSummary.textContent = list.length
      ? `⚠️ ${list.length} warning${list.length > 1 ? 's' : ''} — ${list[0].title}`
      : 'Warnings — none current';
    warningsCard.classList.toggle('has-warnings', list.length > 0);
    warningsBody.replaceChildren();
    if (!list.length) {
      warningsBody.append(el('p', 'all-clear', '✓ No current marine warnings for Sydney waters.'));
    }
    list.forEach(w => {
      const item = el('div', 'warning-item');
      item.append(el('strong', null, '⚠️ ' + w.title));
      const meta = [w.area, w.issued && `issued ${w.issued}`].filter(Boolean).join(' · ');
      if (meta) item.append(el('span', 'warning-meta', meta));
      warningsBody.append(item);
    });
    warningsBody.append(el('p', 'muted small', `BOM data checked ${ageLabel(at)}`));

    // App-wide signals: tab badge and a banner on the Log tab
    warnBadge.hidden = !list.length;
    warnBadge.textContent = list.length ? String(list.length) : '';
    warnBadge.setAttribute('aria-label', `${list.length} weather warnings`);
    warnBanner.hidden = !list.length;
    if (list.length) {
      warnBanner.textContent = `⚠️ ${list[0].title}${list.length > 1 ? ` (+${list.length - 1} more)` : ''}`;
    }
  }

  function renderBom(bom) {
    bomBody.replaceChildren();
    if (!bom?.areas?.length) { bomBody.append(el('p', 'muted', 'BOM forecast not available yet.')); return; }
    if (bom.issued) bomBody.append(el('p', 'muted small', `Issued ${bom.issued}`));
    bom.areas.filter(a => /^Sydney Coast/i.test(a.name)).forEach(area => {
      bomBody.append(el('h3', null, area.name));
      area.periods.slice(0, 2).forEach(p => {
        const box = el('div', 'bom-period');
        box.append(el('div', 'bom-when', p.label));
        if (p.warning) box.append(el('div', 'bom-warning', '⚠️ ' + p.warning));
        [['Winds', p.winds], ['Seas', p.seas], ['Swell', p.swell1], ['', p.swell2], ['Weather', p.weather], ['Caution', p.caution]]
          .filter(([, v]) => v)
          .forEach(([k, v]) => {
            const row = el('p');
            if (k) row.append(el('strong', null, k + ': '));
            row.append(v);
            box.append(row);
          });
        bomBody.append(box);
      });
    });
  }

  function renderWw(ww) {
    const o = ww?.observed;
    wwCard.hidden = !o;
    if (!o) return;
    const kmh = v => v == null ? null : units.wind === 'kmh' ? v : v / 1.852;
    wwBody.replaceChildren(el('p', null,
      `${fmt(kmh(o.speedKmh))} ${windLabel()} ${o.direction}, gusts ${fmt(kmh(o.gustKmh))} ${windLabel()} — ${o.station}, ${o.time}`));
    wwBody.append(el('p', 'muted small', 'Data: WillyWeather'));
  }

  function renderFeed(data, at) {
    feed = { data, at };
    markReady('feed');
    const updated = data.updated ? new Date(data.updated).getTime() : at;
    renderWarnings(data.warnings || [], updated);
    renderBom(data.bom);
    renderWw(data.ww);
    if (model) renderModel(model.data, model.at); // tide may now come from WillyWeather
  }

  // ── Loading screen: hide the tab until the forecast and BOM data are in ──
  const panel = $('panel-weather');
  // The figure-of-8 boat is SVG animation, which CSS can't slow, so honour
  // Reduce Motion here
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) $('eight-motion')?.setAttribute('dur', '12s');
  const ready = new Set();
  function markReady(part) {
    ready.add(part);
    if (ready.has('model') && ready.has('feed')) panel.classList.remove('is-loading');
  }
  // Never leave people stuck on the spinner: show whatever there is after 10 s
  setTimeout(() => panel.classList.remove('is-loading'), 10000);

  // ── Loader: try live, fall back to cache ──────────────────────────
  let retryTimer = null;
  async function load(force = false) {
    if (!force && Date.now() - loadedAt < 10 * 60000) return;
    loadedAt = Date.now();
    clearTimeout(retryTimer);

    // weather.json (built on GitHub every 30 min) carries the BOM data and,
    // since Nov 2026, the Open-Meteo forecast too, fetched there with retries.
    // Phones calling Open-Meteo themselves often hang or get "too many
    // requests", so that's only the fallback when the file's copy is old.
    const feedP = fetchHedged(`${APP_CONFIG.dataUrl}?t=${Math.floor(Date.now() / 300000)}`, { max: 2 })
      .then(d => { cacheSet(FEED_CACHE, d); renderFeed(d, Date.now()); return d; })
      .catch(() => {
        const c = cacheGet(FEED_CACHE);
        if (c) renderFeed(c.data, c.at);
        else {
          const why = offline() ? 'no signal' : "the warnings feed didn't answer";
          warningsBody.replaceChildren(el('p', 'muted', `Warnings unavailable — ${why}. Check BOM directly.`));
          bomBody.replaceChildren(el('p', 'muted', `BOM forecast unavailable — ${why}.`));
          markReady('feed');
        }
        return c?.data || null;
      });

    const useModel = (data, at) => {
      try { localStorage.setItem(WX_CACHE, JSON.stringify({ at, data })); } catch { /* full */ }
      renderModel(data, at);
    };
    const feedModel = d => {
      const m = d?.model;
      const at = m && Date.parse(m.at);
      return m?.wx?.hourly && m?.sea?.hourly && at ? { data: { wx: m.wx, sea: m.sea }, at } : null;
    };
    feedP.then(d => {
      const fm = feedModel(d);
      if (fm && Date.now() - fm.at < 90 * 60000) { useModel(fm.data, fm.at); return; }
      return loadModel()
        .then(data => useModel(data, Date.now()))
        .catch(() => {
          // Let the next tab visit try again straight away, and keep trying
          loadedAt = 0;
          retryTimer = setTimeout(() => load(), 30000);
          // An older copy from weather.json beats nothing
          const saved = cacheGet(WX_CACHE);
          const best = [fm, saved].filter(Boolean).sort((a, b) => b.at - a.at)[0];
          if (best && Date.now() - best.at < 36 * 3600000) {
            renderModel(best.data, best.at);
            wxUpdated.textContent += offline() ? ' (no signal — saved copy)' : " (forecast service didn't answer — saved copy, retrying)";
            return;
          }
          const msg = el('p', 'muted', offline()
            ? 'No signal and no saved forecast yet. It will load when there is signal.'
            : "The forecast service didn't answer. Trying again every 30 seconds.");
          const again = el('button', 'wx-retry', 'Try again now');
          again.type = 'button';
          again.addEventListener('click', () => { wxNow.replaceChildren(el('p', 'muted', 'Loading forecast…')); load(true); });
          wxNow.replaceChildren(msg, again);
          markReady('model');
        });
    });
  }
  // Signal back: fetch at once rather than waiting for the next retry
  window.addEventListener('online', () => { if (!model || Date.now() - model.at > 10 * 60000) load(true); });

  // ── Live map: one Windy iframe; the pills change its layer ─────────
  // One map at a time: several Windy maps alive at once ran phones short of
  // memory (pinch zoom stopped responding) and they share Windy's saved
  // settings, so Waves sometimes showed the wind layer.
  let frame = null, frameLayer = '';
  const mapLoading = el('div', 'map-loading');
  mapLoading.hidden = true;
  mapLoading.innerHTML = '<span class="boat-spinner small" aria-hidden="true"></span> Loading map…';

  function mapSrc(layer) {
    // Radar is centred on Malabar (the dot overlay marks it). Wind/waves centre
    // east of the marker so Windy's detail popup isn't cut off at the right edge
    const lon = layer === 'radar' ? point.lon : point.lon + 0.07;
    return 'https://embed.windy.com/embed.html?type=map&location=coordinates' +
      `&metricRain=mm&metricTemp=%C2%B0C&metricWind=${units.wind === 'kmh' ? 'km%2Fh' : 'kt'}` +
      `&zoom=10&overlay=${layer}&product=${layer === 'radar' ? 'radar' : 'ecmwf'}&level=surface` +
      `&lat=${point.lat}&lon=${lon.toFixed(3)}&detailLat=${point.lat}&detailLon=${point.lon}&marker=true`;
  }

  function showMap(layer) {
    if (!frame) {
      frame = el('iframe');
      frame.setAttribute('allow', 'fullscreen');
      frame.addEventListener('load', () => { mapLoading.hidden = true; });
      mapWrap.prepend(frame);
    }
    if (frameLayer !== layer) {
      frameLayer = layer;
      frame.title = `${layer} map`;
      mapLoading.hidden = false;
      frame.src = mapSrc(layer);
      // Never leave the spinner up if the load event goes missing
      setTimeout(() => { mapLoading.hidden = true; }, 10000);
    }
    // White dot = Malabar on the radar. It's only right while the map hasn't
    // been moved, so it hides once the map is touched (the page loses focus).
    radarDot.hidden = layer !== 'radar';
    mapCredit.textContent = layer === 'radar'
      ? 'Map: Windy.com — white dot is Malabar; tap ▶ on the map to play the last hour of radar'
      : 'Map: Windy.com';
  }
  const radarDot = el('div', 'radar-dot');
  radarDot.hidden = true;
  radarDot.setAttribute('aria-label', 'Malabar');
  radarDot.append(el('span', 'radar-dot-label', 'Malabar'));
  mapWrap.append(radarDot, mapLoading);
  window.addEventListener('blur', () => {
    if (document.activeElement && document.activeElement.tagName === 'IFRAME') radarDot.hidden = true;
  });

  mapPills.addEventListener('change', e => showMap(e.target.value));

  // Full screen: on a scrolling page the phone sometimes takes a pinch as a
  // page gesture; with the map filling the screen every gesture goes to it
  const mapCard = mapWrap.closest('.card'), fullBtn = $('map-full-btn');
  function setMapFull(on) {
    mapCard.classList.toggle('map-full', on);
    document.body.classList.toggle('no-scroll', on);
    fullBtn.setAttribute('aria-pressed', String(on));
    fullBtn.textContent = on ? '✕ Close full screen' : '⛶ Full screen map';
    if (on && !frame) showMap(mapPills.querySelector('input:checked').value);
  }
  fullBtn.addEventListener('click', () => setMapFull(!mapCard.classList.contains('map-full')));
  document.addEventListener('tabshown', e => { if (e.detail !== 'weather') setMapFull(false); });

  // Windy is heavy (it slowed the whole tab), so only load it when the map
  // card scrolls into view
  const mapObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting) && !frame) {
      showMap(mapPills.querySelector('input:checked').value);
      mapObserver.disconnect();
    }
  }, { rootMargin: '200px' }) : null;

  document.addEventListener('tabshown', e => {
    if (e.detail !== 'weather') return;
    // Chrome freezes the boat for a second or two after the hidden tab is shown
    // unless the figure-of-8 animation is restarted
    if (panel.classList.contains('is-loading')) $('eight-motion')?.beginElement?.();
    load();
    if (mapObserver) mapObserver.observe(mapWrap);
    else if (!frame) showMap(mapPills.querySelector('input:checked').value);
  });
  warnBanner.addEventListener('click', () => document.querySelector('[data-tab="weather"]').click());

  // Warnings matter even if nobody opens the Weather tab: check on start-up,
  // using the saved copy first so the badge shows straight away.
  const savedFeed = cacheGet(FEED_CACHE);
  if (savedFeed) renderFeed(savedFeed.data, savedFeed.at);

  // Open on the saved forecast (if it still covers today) so the tab is never
  // empty, then fetch fresh data straight away in the background
  const savedModel = cacheGet(WX_CACHE);
  if (savedModel && Date.now() - savedModel.at < 36 * 3600000) {
    try {
      renderModel(savedModel.data, savedModel.at);
      wxUpdated.textContent += ' · updating…';
    } catch { /* old cache shape — wait for fresh data */ }
  }
  load();

  window.sunEventForTest = sunEvent;
})();
