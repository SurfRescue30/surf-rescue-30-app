/* ── Surf Patrol Log – route.js ──
   Job route: distance and courses by water between two points, going around
   headlands, islands and rock platforms (keeps ≥50 m off land). Uses the
   navigable-water grid in coast.js (Figure Eight Pools → Long Reef, incl. the
   harbour's eastern bays, Botany Bay/Georges River and Port Hacking)
   and A* path-finding, then straightens the path into a few legs.
   An aid for planning — the plotter is the authority.
*/
(() => {
  const ROUTE_KEY = 'surfPatrolRoute';
  const NM = 1852;
  const { kx, ky } = COAST.nav.proj;

  // ── Grids ─────────────────────────────────────────────────────────
  // makeRouter(nav, COST) wraps one navigable-water grid: decode, snap, A*,
  // straighten. The detailed grid (coast.js) covers Era Beach → Long Reef with
  // the harbour to Bradleys Head, Botany Bay/Georges River and Port Hacking.
  // The coarse grid (coast-outer.js, Newcastle → Scarborough) only keeps
  // routes off land; it's decoded the first time it's needed.
  function makeRouter(nav, COST) {
    const { lat0, lon0, kx, ky } = nav.proj;
    const water = new Uint8Array(nav.rows * nav.cols);
    nav.data.forEach((row, r) => {
      let c = 0;
      row.split(',').forEach(run => {
        const [v, n] = run.split('x').map(Number);
        if (v) water.fill(v, r * nav.cols + c, r * nav.cols + c + n);
        c += n;
      });
    });
    const ox = (nav.origin[1] - lon0) * kx;
    const oy = (nav.origin[0] - lat0) * ky;
    const toXY = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
    const toLL = (x, y) => [lat0 + y / ky, lon0 + x / kx];
    const cellOf = (lat, lon) => {
      const [x, y] = toXY(lat, lon);
      return [Math.floor((y - oy) / nav.cellM), Math.floor((x - ox) / nav.cellM)];
    };
    const centre = (r, c) => [ox + (c + 0.5) * nav.cellM, oy + (r + 0.5) * nav.cellM];
    const inGrid = (r, c) => r >= 0 && r < nav.rows && c >= 0 && c < nav.cols;
    const isWater = (r, c) => inGrid(r, c) && water[r * nav.cols + c] > 0;
    const covers = (lat, lon) => inGrid(...cellOf(lat, lon));

    // Nearest water cell (a beach or headland position is on land), within ~3 km
    function snap(lat, lon) {
      const [r0, c0] = cellOf(lat, lon);
      if (isWater(r0, c0)) return [r0, c0];
      const maxRad = Math.ceil(3000 / nav.cellM);
      for (let rad = 1; rad <= maxRad; rad++) {
        let best = null, bestD = Infinity;
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
            if (isWater(r0 + dr, c0 + dc) && dr * dr + dc * dc < bestD) { best = [r0 + dr, c0 + dc]; bestD = dr * dr + dc * dc; }
          }
        }
        if (best) return best;
      }
      return null;
    }

    // ── A* over 8-connected water cells ─────────────────────────────
    // Typed arrays and a flat binary heap: no allocation per step, so the
    // longest routes take a fraction of a second on an older phone.
    const minCost = Math.min(...COST.slice(1));
    function astar(start, goal) {
      const cols = nav.cols, rows = nav.rows, N = rows * cols;
      const g = new Float32Array(N).fill(Infinity);
      const came = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const [gr, gc] = goal;
      // Octile distance at the cheapest cost: still never overestimates, but
      // tighter than straight-line distance, so fewer cells are explored
      const h = (r, c) => {
        const dr = Math.abs(r - gr), dc = Math.abs(c - gc);
        return (Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc)) * minCost;
      };
      let keys = new Float64Array(4096), vals = new Int32Array(4096), size = 0;
      const push = (f, i) => {
        if (size === keys.length) {
          const k2 = new Float64Array(size * 2); k2.set(keys); keys = k2;
          const v2 = new Int32Array(size * 2); v2.set(vals); vals = v2;
        }
        let k = size++;
        while (k > 0) {
          const p = (k - 1) >> 1;
          if (keys[p] <= f) break;
          keys[k] = keys[p]; vals[k] = vals[p]; k = p;
        }
        keys[k] = f; vals[k] = i;
      };
      const pop = () => {
        const top = vals[0];
        const f = keys[--size], v = vals[size];
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          if (l >= size) break;
          const m = l + 1 < size && keys[l + 1] < keys[l] ? l + 1 : l;
          if (keys[m] >= f) break;
          keys[k] = keys[m]; vals[k] = vals[m]; k = m;
        }
        keys[k] = f; vals[k] = v;
        return top;
      };
      const wet = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && water[r * cols + c] > 0;
      const DR = [1, -1, 0, 0, 1, 1, -1, -1], DC = [0, 0, 1, -1, 1, -1, 1, -1];
      const STEP = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
      const s = start[0] * cols + start[1], t = gr * cols + gc;
      g[s] = 0;
      push(h(start[0], start[1]), s);
      while (size) {
        const cur = pop();
        if (cur === t) break;
        if (closed[cur]) continue;
        closed[cur] = 1;
        const r = (cur / cols) | 0, c = cur - r * cols, gcur = g[cur];
        for (let k = 0; k < 8; k++) {
          const dr = DR[k], dc = DC[k], rr = r + dr, cc = c + dc;
          if (!wet(rr, cc)) continue;
          // Don't cut diagonally past a land corner
          if (k >= 4 && (!wet(r + dr, c) || !wet(r, c + dc))) continue;
          const ni = rr * cols + cc;
          const ng = gcur + STEP[k] * COST[water[ni]];
          if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; push(ng + h(rr, cc), ni); }
        }
      }
      if (g[t] === Infinity) return null;
      const path = [];
      for (let i = t; i !== -1; i = came[i]) path.push([(i / cols) | 0, i % cols]);
      return path.reverse();
    }

    // Straight line between two cells that never gets closer to shore than the
    // path it replaces (so straightening doesn't undo the mid-channel routing).
    // worst = Infinity: any water will do.
    function lineOfSight(a, b, worst) {
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
      for (let i = 1; i < steps; i++) {
        const r = Math.round(a[0] + (b[0] - a[0]) * i / steps), c = Math.round(a[1] + (b[1] - a[1]) * i / steps);
        if (!isWater(r, c)) return false;
        const v = water[r * nav.cols + c];
        if (v !== 4 && v > worst) return false;
      }
      return true;
    }

    // Pull the cell path tight into as few straight legs as possible
    function straighten(path) {
      const out = [path[0]];
      let anchor = 0;
      while (anchor < path.length - 1) {
        // Scan forward, tracking the closest-to-shore class seen so far; stop
        // once the straight line has failed for a while
        let far = anchor + 1, worst = 1, misses = 0;
        const at = k => water[path[k][0] * nav.cols + path[k][1]];
        if (at(anchor) !== 4) worst = Math.max(worst, at(anchor));
        for (let j = anchor + 1; j < path.length && misses < 40; j++) {
          const v = at(j);
          if (v !== 4 && v > worst) worst = v;
          if (lineOfSight(path[anchor], path[j], worst)) { far = j; misses = 0; } else misses++;
        }
        out.push(path[far]);
        anchor = far;
      }
      return out;
    }

    function summarise(legsCells) {
      const pts = legsCells.map(([r, c]) => toLL(...centre(r, c)));
      const legs = [];
      let metres = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = toXY(...pts[i]), [x2, y2] = toXY(...pts[i + 1]);
        const m = Math.hypot(x2 - x1, y2 - y1);
        if (m < 1) continue;
        metres += m;
        legs.push({ nm: m / NM, brg: bearingDeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) });
      }
      // Straight line between the same water points the route uses (a place's map
      // point can be on land, e.g. a bridge or the middle of a beach)
      const [sa, sb] = [pts[0], pts[pts.length - 1]];
      return { pts, legs, nm: metres / NM, straightNm: distanceNm(sa[0], sa[1], sb[0], sb[1]) };
    }

    // straightFirst: if the direct line is clear of land, use it as is
    function route(from, to, straightFirst = false) {
      const a = snap(from.lat, from.lon), b = snap(to.lat, to.lon);
      if (!a || !b) return null;
      if (straightFirst && lineOfSight(a, b, Infinity)) return { ...summarise([a, b]), direct: true };
      const cells = astar(a, b);
      if (!cells) return null;
      return summarise(straighten(cells));
    }

    return { route, covers };
  }

  // Detailed: no depth data, so stay mid-channel: water near shore costs more,
  // charted fairways/recommended tracks cost less
  const detailed = makeRouter(COAST.nav, [Infinity, 1, 1.25, 1.8, 0.7]);
  let coarse = null;
  const coarseRouter = () => {
    if (!coarse && typeof COAST_OUTER !== 'undefined') coarse = makeRouter(COAST_OUTER.nav, [Infinity, 1, 1.3]);
    return coarse;
  };

  // Both ends in the detailed area: detailed route. Otherwise the coarse grid:
  // a straight line when it's clear of land, else around the land.
  function route(from, to) {
    if (detailed.covers(from.lat, from.lon) && detailed.covers(to.lat, to.lon)) {
      const r = detailed.route(from, to);
      if (r) return r;
    }
    const c = coarseRouter();
    if (!c) return null;
    const r = c.route(from, to, true);
    return r && { ...r, approx: true };
  }

  // ── UI ────────────────────────────────────────────────────────────
  const fromSel = document.getElementById('route-from');
  const toSel = document.getElementById('route-to');
  const speedIn = document.getElementById('route-speed');
  const result = document.getElementById('route-result');
  const svg = document.getElementById('route-map');

  // Named beaches, bays and points from Figure Eight Pools to Manly, the
  // harbour's eastern bays, Botany Bay/Georges River and Port Hacking
  // The crew's chosen list (route-places.js) when present, else the OSM names in coast.js
  const PLACE_SRC = typeof ROUTE_PLACES !== 'undefined' ? ROUTE_PLACES : COAST;
  const places = PLACE_SRC.routePlaces;
  const regions = PLACE_SRC.routeRegions;
  const placeById = new Map(places.map((p, i) => [String(i), p]));
  const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  const groups = () => regions.map(region => {
    const g = document.createElement('optgroup');
    g.label = region;
    places.forEach((p, i) => { if (p.region === region) g.append(option(String(i), p.name)); });
    return g;
  }).filter(g => g.children.length);
  fromSel.append(option('gps', '📍 Current GPS position'), ...groups());
  toSel.append(option('', 'Choose job location…'), ...groups());
  const findPlace = value => placeById.get(value);

  try {
    const saved = JSON.parse(localStorage.getItem(ROUTE_KEY)) || {};
    // Saved by name (fromName) so a changed place list can't swap it for another
    // place; older saves only have the list position, which is dropped
    if (saved.from === 'gps') fromSel.value = 'gps';
    else if (saved.fromName) {
      const i = places.findIndex(p => p.name === saved.fromName);
      if (i >= 0) fromSel.value = String(i);
    }
    if (saved.speed) speedIn.value = saved.speed;
  } catch { /* nothing saved */ }

  // ── From / To place choosers ──────────────────────────────────────
  // Each field is a button showing the chosen place. Tapping it opens a
  // full-screen chooser (a modal <dialog>) with an empty search box and the
  // keyboard up; with the keyboard closed the whole screen is the list, so
  // scrolling it can't close anything. A tap on a place chooses it; Close or
  // Escape backs out without a change. The hidden <select>s keep the value.
  function makePicker(sel, w, includeGps, emptyText) {
    const field = document.getElementById(`route-${w}-btn`);
    const sheet = document.getElementById(`route-${w}-sheet`);
    const input = document.getElementById(`route-${w}-input`);
    const list = document.getElementById(`route-${w}-list`);
    const closeBtn = document.getElementById(`route-${w}-close`);
    const label = v => v === 'gps' ? '📍 Current GPS position' : (placeById.get(v)?.name || '');
    const syncField = () => {
      field.textContent = label(sel.value) || emptyText;
      field.classList.toggle('is-empty', !label(sel.value));
    };
    const close = () => { if (sheet.open) sheet.close(); };
    const choose = value => {
      sel.value = value;
      syncField();
      close();
      sel.dispatchEvent(new Event('change'));
    };
    const item = (value, text) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.value = value;
      li.textContent = text;
      if (value === sel.value) li.setAttribute('aria-selected', 'true');
      // click, not pointerdown: a finger put down to scroll the list must not
      // pick whatever row it landed on. click only fires for a tap.
      li.addEventListener('click', () => choose(value));
      return li;
    };
    function render(query) {
      const q = query.trim().toLowerCase();
      list.replaceChildren();
      if (includeGps && (!q || 'current gps position'.includes(q))) list.append(item('gps', '📍 Current GPS position'));
      regions.forEach(region => {
        const matches = places.map((p, i) => [p, i])
          .filter(([p]) => p.region === region && (!q || p.name.toLowerCase().includes(q) || region.toLowerCase().includes(q)));
        if (!matches.length) return;
        const head = document.createElement('li');
        head.className = 'picker-group';
        head.setAttribute('role', 'presentation');
        head.textContent = region;
        list.append(head, ...matches.map(([p, i]) => item(String(i), p.name)));
      });
      if (!list.children.length) {
        const none = document.createElement('li');
        none.className = 'picker-empty';
        none.textContent = 'No matching places';
        list.append(none);
      }
    }
    field.addEventListener('click', () => {
      input.value = '';            // cleared, ready to type
      render('');
      list.scrollTop = 0;
      sheet.showModal();
      input.focus();               // same tap, so the phone raises the keyboard
    });
    closeBtn.addEventListener('click', close);
    input.addEventListener('input', () => { render(input.value); list.scrollTop = 0; });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const first = list.querySelector('[data-value]');
        if (first) { e.preventDefault(); choose(first.dataset.value); }
      } else if (e.key === 'Escape') {
        // A search box with text only clears itself on Escape; close the chooser
        e.preventDefault();
        close();
      }
    });
    // Scrolling the list hides the keyboard, so the whole list is in view
    list.addEventListener('touchmove', () => { if (document.activeElement === input) input.blur(); }, { passive: true });
    // Back on the field the chooser was opened from
    sheet.addEventListener('close', () => field.focus());
    syncField();
  }
  makePicker(fromSel, 'from', true, '📍 Current GPS position');
  makePicker(toSel, 'to', false, 'Choose job location…');

  const pad3 = n => String(Math.round(n) % 360).padStart(3, '0');
  const fmtMins = h => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

  const saveChoice = () => {
    try { localStorage.setItem(ROUTE_KEY, JSON.stringify({ from: fromSel.value === 'gps' ? 'gps' : '', fromName: findPlace(fromSel.value)?.name || '', speed: speedIn.value })); } catch { /* storage unavailable */ }
  };
  const spinner = text => { result.innerHTML = `<span class="boat-spinner small" aria-hidden="true"></span> ${text}`; };

  // The route on screen, kept so a speed change only redoes the times
  // (re-routing, and a new GPS fix, on every keystroke froze the screen)
  let shown = null, calcId = 0;

  async function calculate() {
    saveChoice();
    const id = ++calcId;
    shown = null;
    const to = findPlace(toSel.value);
    if (!to) { result.textContent = ''; svg.innerHTML = ''; return; }
    let from;
    if (fromSel.value === 'gps') {
      spinner('Getting GPS fix…');
      const pos = await getPosition(15000);
      if (id !== calcId) return;
      if (!pos) { result.textContent = '⚠️ GPS unavailable — pick a start place instead, or allow location access (Info tab).'; return; }
      from = { lat: pos.lat, lon: pos.lon, name: 'your position' };
    } else {
      const p = findPlace(fromSel.value);
      from = { lat: p.lat, lon: p.lon, name: p.name };
    }
    // Let the spinner paint before the search holds the screen
    spinner('Working out the route…');
    await new Promise(res => setTimeout(res, 30));
    if (id !== calcId) return;
    shown = { from, to, r: route(from, to) };
    showRoute(true);
  }

  // ── River and estuary water: depth and tide warning ─────────────────
  // The grid knows where water is, not how deep it is. Any route that enters
  // these areas gets a warning box. Polygons are [lat, lon] rings.
  const SHALLOW_ZONES = [
    { name: 'Georges River', ring: [[-33.93, 150.85], [-33.93, 151.135], [-34.06, 151.135], [-34.06, 150.85]] },
    { name: 'Port Hacking', ring: [[-34.03, 150.98], [-34.03, 151.150], [-34.11, 151.150], [-34.11, 150.98]] },
    // Inside the Barrenjoey–West Head line, along the Palm Beach peninsula
    { name: 'Pittwater', ring: [[-33.576, 151.240], [-33.576, 151.318], [-33.595, 151.319], [-33.610, 151.322], [-33.630, 151.322],
      [-33.650, 151.315], [-33.670, 151.310], [-33.710, 151.300], [-33.710, 151.240]] },
    // West of Juno Point and Croppy Point: Cowan Creek and the river
    { name: 'Hawkesbury River and Cowan Creek', ring: [[-33.43, 151.05], [-33.43, 151.255], [-33.71, 151.255], [-33.71, 151.05]] },
    // Inside the Ettalong entrance
    { name: 'Brisbane Water', ring: [[-33.40, 151.28], [-33.40, 151.365], [-33.525, 151.365], [-33.525, 151.28]] },
    // Swansea Channel and Lake Macquarie
    { name: 'Lake Macquarie', ring: [[-32.94, 151.50], [-32.94, 151.655], [-33.16, 151.655], [-33.16, 151.50]] }
  ];
  const inRing = ([lat, lon], ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ya, xa] = ring[i], [yb, xb] = ring[j];
      if ((ya > lat) !== (yb > lat) && lon < (xb - xa) * (lat - ya) / (yb - ya) + xa) inside = !inside;
    }
    return inside;
  };
  const shallowZonesOn = pts => SHALLOW_ZONES.filter(z => pts.some(p => inRing(p, z.ring))).map(z => z.name);

  function tideNow() {
    if (typeof Tide === 'undefined') return '';
    const now = Date.now();
    const next = Tide.turns(now, now + 26 * 3600000);
    if (!next.length) return '';
    const n = next[0];
    const hm = new Date(n.at).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false });
    return `Tide now ${n.type === 'high' ? 'rising' : 'falling'}, ${n.type} ${hm} (${n.height.toFixed(1)} m at Fort Denison).`;
  }

  function routeWarning(zones) {
    const box = document.createElement('div');
    box.className = 'route-warning';
    box.setAttribute('role', 'alert');
    const head = document.createElement('strong');
    head.textContent = `⚠️ River and estuary water: ${zones.join(', ')}`;
    const depth = document.createElement('p');
    depth.textContent = 'Check the depth. This tool does not confirm depth.';
    const tide = document.createElement('p');
    tide.textContent = `This route is affected by the tide. Check the tide before trusting it. ${tideNow()}`.trim();
    box.append(head, depth, tide);
    return box;
  }

  function showRoute(redraw) {
    const { from, to, r } = shown;
    const kn = parseFloat(speedIn.value);
    result.replaceChildren();
    if (!r) {
      const nm = distanceNm(from.lat, from.lon, to.lat, to.lon);
      result.textContent = `No water route found (outside the mapped area, Newcastle to Scarborough). Straight line ${nm.toFixed(1)} NM, ${pad3(bearingDeg(from.lat, from.lon, to.lat, to.lon))}°T.`;
      svg.innerHTML = '';
      return;
    }
    const big = document.createElement('div');
    big.className = 'big';
    const what = r.direct ? 'NM straight line' : r.approx ? 'NM by water (approx.)' : 'NM by water';
    big.textContent = `${r.nm.toFixed(1)} ${what}` + (kn > 0 ? ` · ${fmtMins(r.nm / kn)} at ${kn} kn` : '');
    // For reading out, merge legs within 20° of each other (the map keeps the exact path)
    const merged = [];
    r.legs.forEach(l => {
      const prev = merged[merged.length - 1];
      const diff = prev ? Math.abs(((l.brg - prev.brg + 540) % 360) - 180) : 999;
      if (prev && (diff < 20 || l.nm < 0.08)) {
        const total = prev.nm + l.nm;
        const x = Math.sin(prev.brg * Math.PI / 180) * prev.nm + Math.sin(l.brg * Math.PI / 180) * l.nm;
        const y = Math.cos(prev.brg * Math.PI / 180) * prev.nm + Math.cos(l.brg * Math.PI / 180) * l.nm;
        prev.brg = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
        prev.nm = total;
      } else merged.push({ ...l });
    });
    const legs = document.createElement('ol');
    legs.className = 'legs';
    merged.forEach(l => {
      const li = document.createElement('li');
      li.textContent = `Steer ${pad3(l.brg)}°T for ${l.nm.toFixed(1)} NM`;
      legs.append(li);
    });
    const extra = document.createElement('div');
    extra.className = 'muted small';
    const eta = kn > 0 ? new Date(Date.now() + r.nm / kn * 3600000).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
    extra.textContent = r.approx
      ? `${r.direct ? 'Clear of land all the way' : `Straight line ${r.straightNm.toFixed(1)} NM`}${eta ? ` · ETA if leaving now ${eta}` : ''}`
      : `Straight line ${r.straightNm.toFixed(1)} NM${eta ? ` · ETA if leaving now ${eta}` : ''} · keeps 50 m off land and rocks`;
    const approxNote = document.createElement('p');
    approxNote.className = 'route-approx';
    approxNote.textContent = 'Approximate: outside the detailed area (Era Beach to Long Reef, the harbour to Bradleys Head). It goes around land but not rocks, reefs or shallows.';
    const zones = shallowZonesOn([...r.pts, [from.lat, from.lon], [to.lat, to.lon]]);
    result.append(big);
    if (zones.length) result.append(routeWarning(zones));
    result.append(legs, extra);
    if (r.approx) result.append(approxNote);
    if (redraw) draw(r, from, to);
  }

  function draw(r, from, to) {
    const all = [...r.pts, [from.lat, from.lon], [to.lat, to.lon]];
    const padLat = 0.012, padLon = 0.015;
    let latMin = Math.min(...all.map(p => p[0])) - padLat, latMax = Math.max(...all.map(p => p[0])) + padLat;
    let lonMin = Math.min(...all.map(p => p[1])) - padLon, lonMax = Math.max(...all.map(p => p[1])) + padLon;
    const W = 360;
    // Keep true proportions, at least as wide as tall-ish for readability
    let H = W * ((latMax - latMin) * ky) / ((lonMax - lonMin) * kx);
    if (H > 480) { const extraLon = ((latMax - latMin) * ky / kx) * (W / 480) - (lonMax - lonMin); lonMin -= extraLon / 2; lonMax += extraLon / 2; H = 480; }
    if (H < 200) { const extraLat = ((lonMax - lonMin) * kx / ky) * (200 / W) - (latMax - latMin); latMin -= extraLat / 2; latMax += extraLat / 2; H = 200; }
    const sx = lon => ((lon - lonMin) / (lonMax - lonMin)) * W;
    const sy = lat => ((latMax - lat) / (latMax - latMin)) * H;
    const path = line => line.map(([lat, lon], i) => `${i ? 'L' : 'M'}${sx(lon).toFixed(1)},${sy(lat).toFixed(1)}`).join('');
    let out = `<rect width="${W}" height="${H.toFixed(0)}" class="m-sea"/>`;
    const inView = l => l.some(([lat, lon]) => lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax);
    COAST.mapCoast.forEach(l => { out += `<path d="${path(l)}" class="m-coast"/>`; });
    // Outside the detailed area, the simplified coastline from coast-outer.js
    if (r.approx && typeof COAST_OUTER !== 'undefined') {
      COAST_OUTER.mapCoast.forEach(l => { if (inView(l)) out += `<path d="${path(l)}" class="m-coast"/>`; });
    }
    COAST.mapOutcrops.forEach(l => { out += `<path d="${path(l)}" class="m-outcrop"/>`; });
    out += `<path d="${path(r.pts)}" class="m-route"/>`;
    out += `<circle cx="${sx(from.lon)}" cy="${sy(from.lat)}" r="6" class="m-from"/>`;
    out += `<circle cx="${sx(to.lon)}" cy="${sy(to.lat)}" r="6" class="m-to"/>`;
    // Label on whichever side of the dot has room, kept inside the map
    // (about 7 px a character at this size)
    const label = (p, text) => {
      const x = sx(p[1]), w = text.length * 7;
      let lx;
      if (x - 9 - w >= 2) lx = x - 9 - w;
      else if (x + 9 + w <= W - 2) lx = x + 9;
      else lx = Math.max(2, Math.min(W - 2 - w, x - w / 2));
      const ly = Math.max(12, Math.min(H - 4, sy(p[0]) + 4));
      return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="m-label m-label-big">${text}</text>`;
    };
    out += label([from.lat, from.lon], from.name === 'your position' ? 'You' : from.name);
    out += label([to.lat, to.lon], to.name);
    svg.setAttribute('viewBox', `0 0 ${W} ${H.toFixed(0)}`);
    svg.innerHTML = out;
  }

  [fromSel, toSel].forEach(s => s.addEventListener('change', calculate));
  speedIn.addEventListener('input', () => {
    saveChoice();
    if (shown) showRoute(false); else calculate();
  });

  window.routeForTest = route;
})();
