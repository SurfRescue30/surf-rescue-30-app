# Builds coast-outer.js: a coarse (100 m) land/water grid from Newcastle to
# Scarborough for the approximate job route outside the detailed area.
# It only has to stop routes cutting across land (e.g. into Pittwater round
# Barrenjoey, up Cowan Creek), so there is no channel or mid-channel detail.
# Run from the directory holding outer.json (from fetch_outer.sh):
#   cd osm && python3 ../data-scripts/build_outer.py
import json, math
from collections import deque
import numpy as np, shapely
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union, polygonize
from scipy.spatial import cKDTree

LAT0, LON0 = -33.95, 151.25          # same projection as coast.js
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110540.0
P = lambda lat, lon: ((lon - LON0) * KX, (lat - LAT0) * KY)
UP = lambda x, y: (LAT0 + y / KY, LON0 + x / KX)

CELL_M = 100.0
CLEAR_M = 15.0                        # keep cell centres off the coastline itself
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = -34.30, -32.89, 150.90, 151.83

d = json.load(open('outer.json'))
coast = [LineString([P(g['lat'], g['lon']) for g in w['geometry']])
         for w in d['coast'] if w['type'] == 'way' and len(w.get('geometry', [])) > 1]
print('coast ways', len(coast))

# Water areas (closed ways and multipolygon relations)
polys = []
for e in d['water']:
    if e['type'] == 'way' and 'geometry' in e:
        c = [P(g['lat'], g['lon']) for g in e['geometry']]
        if len(c) >= 4 and c[0] == c[-1]:
            polys.append(Polygon(c).buffer(0))
    elif e['type'] == 'relation':
        outers = [LineString([P(g['lat'], g['lon']) for g in m['geometry'] if g])
                  for m in e.get('members', []) if m.get('role') == 'outer' and len(m.get('geometry') or []) > 1]
        inners = [LineString([P(g['lat'], g['lon']) for g in m['geometry'] if g])
                  for m in e.get('members', []) if m.get('role') == 'inner' and len(m.get('geometry') or []) > 1]
        op = unary_union(list(polygonize(unary_union(outers)))) if outers else None
        if op is None or op.is_empty:
            continue
        ip = unary_union(list(polygonize(unary_union(inners)))) if inners else None
        polys.append(op.difference(ip) if ip is not None and not ip.is_empty else op)
water_area = unary_union(polys) if polys else None
print('water areas', len(polys), 'km²', round(water_area.area / 1e6, 1) if water_area else 0)

x0, y0 = P(LAT_MIN, LON_MIN)
x1, y1 = P(LAT_MAX, LON_MAX)
cols = int((x1 - x0) // CELL_M) + 1
rows = int((y1 - y0) // CELL_M) + 1
xs = x0 + (np.arange(cols) + 0.5) * CELL_M
ys = y0 + (np.arange(rows) + 0.5) * CELL_M
XX, YY = np.meshgrid(xs, ys)
pts = np.column_stack([XX.ravel(), YY.ravel()])
print('grid', rows, 'x', cols)

# Which side of the nearest coastline segment is each cell on?
# OSM coastlines keep land on the left, water on the right.
SA, SB, WAY = [], [], []
for wi, l in enumerate(coast):
    c = list(l.coords)
    for a, b in zip(c, c[1:]):
        SA.append(a); SB.append(b); WAY.append(wi)
SA = np.array(SA); SB = np.array(SB); WAY = np.array(WAY)
tree = cKDTree((SA + SB) / 2)
_, idx = tree.query(pts, k=16)
best_d = np.full(len(pts), np.inf); best_i = np.zeros(len(pts), dtype=int); best_t = np.zeros(len(pts))
for k in range(idx.shape[1]):
    i = idx[:, k]; a = SA[i]; ab = SB[i] - a
    t = np.clip(((pts - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0, 1)
    dd = (((a + ab * t[:, None]) - pts) ** 2).sum(1)
    better = dd < best_d; best_d[better] = dd[better]; best_i[better] = i[better]; best_t[better] = t[better]
unit = lambda v: v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
normal = lambda i: np.column_stack([(SB[i] - SA[i])[:, 1], -(SB[i] - SA[i])[:, 0]])
n = unit(normal(best_i))
nxt = np.minimum(best_i + 1, len(SA) - 1); prv = np.maximum(best_i - 1, 0)
at_end = best_t >= 1 - 1e-9; at_start = best_t <= 1e-9
has_next = at_end & (WAY[nxt] == WAY[best_i]) & (nxt != best_i)
has_prev = at_start & (WAY[prv] == WAY[best_i]) & (prv != best_i)
n = np.where(has_next[:, None], n + unit(normal(nxt)), n)
n = np.where(has_prev[:, None], n + unit(normal(prv)), n)
vertex = SA[best_i] + (SB[best_i] - SA[best_i]) * best_t[:, None]
side_water = ((pts - vertex) * n).sum(1) > 0
near_coast = np.sqrt(best_d) < CLEAR_M
in_area = shapely.contains_xy(water_area, pts[:, 0], pts[:, 1]) if water_area is not None else np.zeros(len(pts), bool)
free = ((side_water & ~near_coast) | in_area).reshape(rows, cols)

# Flood fill from the open sea (east edge) so lakes and land interiors drop out
sea = np.zeros_like(free)
q = deque((r, cols - 1) for r in range(rows) if free[r, cols - 1])
for r, c in q: sea[r, c] = True
while q:
    r, c = q.popleft()
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        rr, cc = r + dr, c + dc
        if 0 <= rr < rows and 0 <= cc < cols and free[rr, cc] and not sea[rr, cc]:
            sea[rr, cc] = True; q.append((rr, cc))

# 1 = open water, 2 = within 200 m of the coastline (a little dearer, so the
# approximate route doesn't hug the shore)
cls = np.where(np.sqrt(best_d).reshape(rows, cols) < 200, 2, 1).astype(np.uint8)
grid = np.where(sea, cls, 0).astype(np.uint8)
print('water cells', int(sea.sum()))

def rle(row):
    runs, cur, k = [], int(row[0]), 0
    for v in row:
        v = int(v)
        if v == cur: k += 1
        else: runs.append(f'{cur}x{k}'); cur = v; k = 1
    runs.append(f'{cur}x{k}')
    return ','.join(runs)

# Simplified coastline for the route map outside the detailed area
map_lines = []
for l in coast + ([water_area.boundary] if water_area is not None else []):
    for part in (l.geoms if hasattr(l, 'geoms') else [l]):
        s = part.simplify(40)
        if s.length > 400:
            map_lines.append([[round(v, 4) for v in UP(x, y)] for x, y in s.coords])

js = f"""/* ── Surf Patrol Log – coast-outer.js (generated) ──
   Coarse land/water grid ({int(CELL_M)} m) and simplified coastline from Newcastle to
   Scarborough, for the approximate job route outside the detailed area.
   Data © OpenStreetMap contributors (ODbL).
   Regenerate: data-scripts/fetch_outer.sh osm, then cd osm && python3 ../data-scripts/build_outer.py
*/
const COAST_OUTER = {{
  mapCoast: {json.dumps(map_lines, separators=(',', ':'))},
  // rows south→north, runs of value×count (0 land, 1 open water, 2 within 200 m of the coast)
  nav: {{ origin: {json.dumps([round(UP(x0, y0)[0], 6), round(UP(x0, y0)[1], 6)])}, cellM: {CELL_M}, rows: {rows}, cols: {cols},
         proj: {{ lat0: {LAT0}, lon0: {LON0}, kx: {KX:.4f}, ky: {KY} }}, data: {json.dumps([rle(grid[r]) for r in range(rows)], separators=(',', ':'))} }}
}};
"""
open('../coast-outer.js', 'w').write(js)
print('coast-outer.js KB', round(len(js) / 1024))
