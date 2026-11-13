/* ── Surf Patrol Log – geofence.js ──
   2 NM boundary alarm. Distance is measured to the nearest land, island,
   rock platform or reef in coast.js, so outcrops push the limit seaward.
   Alerts when within 500 m of the limit, and again when it's crossed.

   Web apps only get GPS while open on screen. The screen is kept awake while
   the alarm is on; a notification is shown on Android, and on iPhone/iPad
   when the app has been added to the Home Screen.
*/
(() => {
  const ALARM_KEY = 'surfPatrolBoundaryAlarm';
  const NM = 1852;
  const HYSTERESIS_M = 60; // don't flap between states on GPS jitter

  const bar      = document.getElementById('boundary-bar');
  const toggle   = document.getElementById('boundary-toggle');
  const readout  = document.getElementById('boundary-readout');
  const mapSvg   = document.getElementById('boundary-map');

  // ── Local planar projection (metres), same as the build script ────
  const LAT0 = -33.95, LON0 = 151.25;
  const KX = Math.cos(LAT0 * Math.PI / 180) * 111320;
  const KY = 110540;
  const px = (lat, lon) => [(lon - LON0) * KX, (lat - LAT0) * KY];

  // Pre-project every land/outcrop segment once
  const segs = [];
  const pts = [];
  COAST.features.forEach(f => {
    const p = f.map(([lat, lon]) => px(lat, lon));
    if (p.length === 1) pts.push(p[0]);
    for (let i = 0; i < p.length - 1; i++) segs.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);
  });

  function distanceToLand(lat, lon) {
    const [x, y] = px(lat, lon);
    let best = Infinity;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - x, ey = ay + t * dy - y;
      const d2 = ex * ex + ey * ey;
      if (d2 < best) best = d2;
    }
    for (const [qx, qy] of pts) {
      const d2 = (qx - x) ** 2 + (qy - y) ** 2;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  const inMappedArea = lat => lat >= COAST.mapped.latMin && lat <= COAST.mapped.latMax;

  // ── State & alerts ────────────────────────────────────────────────
  let watchId = null;
  let state = null;        // 'inside' | 'warning' | 'beyond' | 'unmapped'
  let last = null;         // last fix + distance, for the map
  let audio = null;
  let wakeLock = null;

  function classify(d) {
    const warn = COAST.warnM, limit = COAST.limitM;
    // Hysteresis: need to move clearly back inside to drop a level
    if (state === 'beyond' && d > limit - HYSTERESIS_M) return 'beyond';
    if (state === 'warning' && d > warn - HYSTERESIS_M && d <= limit) return 'warning';
    if (d > limit) return 'beyond';
    if (d > warn) return 'warning';
    return 'inside';
  }

  function beep(times = 3) {
    if (!audio) return;
    const now = audio.currentTime;
    for (let i = 0; i < times; i++) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(audio.destination);
      gain.gain.setValueAtTime(0.0001, now + i * 0.45);
      gain.gain.exponentialRampToValueAtTime(0.6, now + i * 0.45 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.45 + 0.35);
      osc.start(now + i * 0.45);
      osc.stop(now + i * 0.45 + 0.4);
    }
  }

  async function notify(title, body) {
    navigator.vibrate?.([400, 150, 400, 150, 400]);
    beep(title.includes('Beyond') ? 5 : 3);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(title, { body, tag: 'sr30-boundary', renotify: true, icon: 'icons/icon-192.png' });
      else new Notification(title, { body, tag: 'sr30-boundary' });
    } catch { /* notifications unavailable — sound/banner still work */ }
  }

  function describe(d) {
    const toLimit = COAST.limitM - d;
    const fromLand = `${(d / NM).toFixed(2)} NM from land`;
    if (toLimit >= 0) return `${fromLand} · ${Math.round(toLimit)} m inside the 2 NM limit`;
    return `${fromLand} · ${Math.round(-toLimit)} m BEYOND the 2 NM limit`;
  }

  function onFix(p) {
    const lat = p.coords.latitude, lon = p.coords.longitude;
    if (!inMappedArea(lat)) {
      state = 'unmapped';
      last = { lat, lon, d: null };
      render('unmapped', 'Boundary only mapped from South Head to Cape Baily.');
      return;
    }
    const d = distanceToLand(lat, lon);
    const next = classify(d);
    if (next !== state && state !== null) {
      if (next === 'warning' && state === 'inside') notify('⚠️ Approaching 2 NM limit', describe(d));
      if (next === 'beyond') notify('🚨 Beyond 2 NM limit', describe(d));
    }
    state = next;
    last = { lat, lon, d, acc: Math.round(p.coords.accuracy) };
    render(next, describe(d) + ` (GPS ±${last.acc} m)`);
  }

  function render(level, text) {
    bar.hidden = false;
    bar.className = `boundary-${level}`;
    bar.textContent = (level === 'beyond' ? '🚨 ' : level === 'warning' ? '⚠️ ' : '🛟 ') + text;
    readout.textContent = text;
    drawBoat();
  }

  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
    wakeLock?.addEventListener?.('release', () => { wakeLock = null; });
  }

  function start() {
    if (!navigator.geolocation) { readout.textContent = 'GPS not available on this device.'; return false; }
    state = null;
    watchId = navigator.geolocation.watchPosition(onFix, err => {
      readout.textContent = err.code === 1
        ? '⚠️ Location access denied — allow it for this site to use the alarm.'
        : '⚠️ Waiting for GPS…';
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    keepAwake();
    toggle.textContent = '🛟 Boundary alarm: ON';
    toggle.setAttribute('aria-pressed', 'true');
    readout.textContent = 'Waiting for GPS…';
    return true;
  }

  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    state = null;
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    bar.hidden = true;
    toggle.textContent = '🛟 Boundary alarm: OFF';
    toggle.setAttribute('aria-pressed', 'false');
    readout.textContent = 'Alarm off.';
  }

  toggle.addEventListener('click', async () => {
    if (watchId != null) {
      stop();
      try { localStorage.setItem(ALARM_KEY, 'off'); } catch { /* storage unavailable */ }
      return;
    }
    // Created inside the tap so iOS lets it play later
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { audio = null; }
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    if (start()) {
      try { localStorage.setItem(ALARM_KEY, 'on'); } catch { /* storage unavailable */ }
      beep(1);
    }
  });

  bar.addEventListener('click', () => document.querySelector('[data-tab="tools"]').click());

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && watchId != null) keepAwake();
  });

  // ── Map (SVG) ─────────────────────────────────────────────────────
  const VIEW = { latMin: -34.045, latMax: -33.815, lonMin: 151.205, lonMax: 151.36 };
  const W = 360;
  const H = Math.round(W * ((VIEW.latMax - VIEW.latMin) * KY) / ((VIEW.lonMax - VIEW.lonMin) * KX));
  const sx = lon => ((lon - VIEW.lonMin) / (VIEW.lonMax - VIEW.lonMin)) * W;
  const sy = lat => ((VIEW.latMax - lat) / (VIEW.latMax - VIEW.latMin)) * H;
  const path = line => line.map(([lat, lon], i) => `${i ? 'L' : 'M'}${sx(lon).toFixed(1)},${sy(lat).toFixed(1)}`).join('');

  const LABELS = ['South Head', 'Bondi', 'Coogee', 'Maroubra', 'Malabar', 'Cape Banks', 'Cape Solander', 'Wedding Cake Island']
    .map(n => PLACES.find(p => p.name === n)).filter(p => p && p.lat != null);

  // The coastline and lines are drawn once; each GPS fix only moves the boat
  // (redrawing the whole map about once a second cost battery on long patrols)
  let mapDrawn = false;
  function drawMap() {
    if (!mapSvg || mapSvg.closest('[hidden]')) return;
    if (mapDrawn) { drawBoat(); return; }
    let svg = `<rect width="${W}" height="${H}" class="m-sea"/>`;
    // Land shaded so it reads apart from the water at a glance
    (COAST.mapLand || []).forEach(poly => { svg += `<path d="${poly.map(r => path(r) + 'Z').join('')}" class="m-land"/>`; });
    COAST.mapCoast.forEach(l => { svg += `<path d="${path(l)}" class="m-coast"/>`; });
    COAST.mapOutcrops.forEach(l => { svg += `<path d="${path(l)}" class="m-outcrop"/>`; });
    COAST.warnLines.forEach(l => { svg += `<path d="${path(l)}" class="m-warn"/>`; });
    COAST.limitLines.forEach(l => { svg += `<path d="${path(l)}" class="m-limit"/>`; });
    LABELS.forEach(p => {
      svg += `<circle cx="${sx(p.lon)}" cy="${sy(p.lat)}" r="2" class="m-dot"/>` +
             `<text x="${sx(p.lon) - 4}" y="${sy(p.lat) + 3}" class="m-label" text-anchor="end">${p.name.replace(' Island', '')}</text>`;
    });
    svg += `<text x="${W - 6}" y="14" class="m-key m-key-limit" text-anchor="end">— 2 NM limit</text>` +
           `<text x="${W - 6}" y="28" class="m-key m-key-warn" text-anchor="end">- - 500 m warning</text>`;
    svg += `<circle r="7" class="m-boat" visibility="hidden"/>`;
    mapSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    mapSvg.innerHTML = svg;
    mapDrawn = true;
    drawBoat();
  }

  function drawBoat() {
    if (!mapDrawn) { drawMap(); return; }
    const boat = mapSvg.querySelector('.m-boat');
    const onMap = last && last.lat >= VIEW.latMin && last.lat <= VIEW.latMax && last.lon >= VIEW.lonMin && last.lon <= VIEW.lonMax;
    boat.setAttribute('visibility', onMap ? 'visible' : 'hidden');
    if (!onMap) return;
    boat.setAttribute('cx', sx(last.lon));
    boat.setAttribute('cy', sy(last.lat));
    boat.setAttribute('class', `m-boat m-boat-${state}`);
  }

  document.addEventListener('tabshown', e => { if (e.detail === 'tools') drawMap(); });

  // Resume the alarm after a reload if it was on (permission already granted)
  try {
    if (localStorage.getItem(ALARM_KEY) === 'on') start();
  } catch { /* storage unavailable */ }

  window.boundary = { distanceToLand, classifyForTest: d => { state = null; return classify(d); } };
})();
