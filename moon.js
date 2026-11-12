/* ── Surf Patrol Log – moon.js ──
   Moon phase, illumination and rise/set, calculated on the phone (no data
   needed, works offline). Low-precision lunar theory (the same series as the
   widely used SunCalc library): phase within a few hours, rise/set within a
   few minutes — plenty for planning night work.
   Moon.icon() draws the moon as seen from the southern hemisphere: a waxing
   moon is lit on the LEFT in Sydney (moon emoji show the northern view).
*/
const Moon = (() => {
  const rad = Math.PI / 180;
  const obliquity = rad * 23.4397;
  const toDays = ms => ms / 86400000 - 10957.5; // days since J2000.0

  const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(obliquity) - Math.tan(b) * Math.sin(obliquity), Math.cos(l));
  const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(obliquity) + Math.cos(b) * Math.sin(obliquity) * Math.sin(l));

  function sunCoords(d) {
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    return { ra: rightAscension(L, 0), dec: declination(L, 0) };
  }

  function moonCoords(d) {
    const L = rad * (218.316 + 13.176396 * d);  // mean longitude
    const M = rad * (134.963 + 13.064993 * d);  // mean anomaly
    const F = rad * (93.272 + 13.229350 * d);   // mean distance from the node
    const l = L + rad * 6.289 * Math.sin(M);
    const b = rad * 5.128 * Math.sin(F);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
  }

  // fraction: 0 new … 1 full. phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
  function illumination(ms = Date.now()) {
    const d = toDays(ms), s = sunCoords(d), m = moonCoords(d), sunDist = 149598000;
    const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    const inc = Math.atan2(sunDist * Math.sin(phi), m.dist - sunDist * Math.cos(phi));
    const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
  }

  // Within about a day of a quarter, use its name
  function phaseName(phase) {
    const near = q => Math.abs(phase - q) < 0.034 || Math.abs(phase - q - 1) < 0.034;
    if (near(0)) return 'New moon';
    if (near(0.25)) return 'First quarter';
    if (near(0.5)) return 'Full moon';
    if (near(0.75)) return 'Last quarter';
    if (phase < 0.25) return 'Waxing crescent';
    if (phase < 0.5) return 'Waxing gibbous';
    if (phase < 0.75) return 'Waning gibbous';
    return 'Waning crescent';
  }

  // Altitude of the moon's upper limb above the horizon (radians), with refraction
  function altitude(ms, lat, lon) {
    const d = toDays(ms), c = moonCoords(d), phi = rad * lat;
    const H = rad * (280.16 + 360.9856235 * d) + rad * lon - c.ra;
    let h = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
    h += rad * 0.017 / Math.tan(h + rad * 10.26 / (h + rad * 5.10));
    return h;
  }
  const H0 = rad * 0.133; // centre altitude when the upper limb touches the horizon
  const isUp = (ms, lat, lon) => altitude(ms, lat, lon) > H0;

  // Rises and sets between two times: sample every 10 min, interpolate the crossing
  function events(fromMs, toMs, lat, lon) {
    const out = [], step = 600000;
    let t0 = fromMs, a0 = altitude(t0, lat, lon) - H0;
    for (let t1 = fromMs + step; t1 <= toMs; t1 += step) {
      const a1 = altitude(t1, lat, lon) - H0;
      if ((a0 <= 0) !== (a1 <= 0)) out.push({ type: a1 > 0 ? 'rise' : 'set', at: new Date(t0 + step * a0 / (a0 - a1)) });
      t0 = t1; a0 = a1;
    }
    return out;
  }

  // SVG moon, southern-hemisphere view. size in px.
  function icon(phase, size = 20) {
    const r = 10, k = Math.cos(2 * Math.PI * phase);        // 1 new → -1 full → 1 new
    const waxing = phase < 0.5;
    const rx = Math.abs(k) * r;
    // Lit region drawn lit-on-the-right (northern waxing), then mirrored as needed
    const crescent = k > 0;
    const lit = `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${rx.toFixed(2)} ${r} 0 0 ${crescent ? 0 : 1} 0 ${-r}Z`;
    // Southern hemisphere: waxing is lit on the left
    const flip = waxing ? ' transform="scale(-1 1)"' : '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-11 -11 22 22');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('class', 'moon-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<circle r="${r}" class="moon-dark"/><path d="${lit}" class="moon-lit"${flip}/><circle r="${r}" class="moon-rim"/>`;
    return svg;
  }

  return { illumination, phaseName, isUp, events, icon };
})();
