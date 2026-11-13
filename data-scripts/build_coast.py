import json, math
from shapely.geometry import LineString, Polygon, Point, MultiLineString, box
from shapely.ops import unary_union, linemerge
LAT0, LON0 = -33.95, 151.25
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110540.0
P  = lambda lat, lon: ((lon - LON0) * KX, (lat - LAT0) * KY)
UP = lambda x, y: (LAT0 + y / KY, LON0 + x / KX)
LIMIT = 2 * 1852.0          # 2 NM
WARN  = LIMIT - 500.0       # warn 500 m inside the limit
LAT_MIN, LAT_MAX = -34.035, -33.825   # mapped range: Cape Baily → South Head

d = json.load(open('features.json'))
coast, outcrops = [], []
for w in d['ways']:
    nat = w['tags'].get('natural')
    pts = [P(*p) for p in w['pts']]
    if len(pts) < 2: continue
    if nat == 'coastline':
        coast.append(LineString(pts))
    elif nat in ('bare_rock', 'rock', 'reef', 'shoal', 'mud', 'sandbar') or w['tags'].get('place') in ('island', 'islet'):
        g = Polygon(pts) if len(pts) >= 4 and pts[0] == pts[-1] else LineString(pts)
        outcrops.append(g.buffer(0) if g.geom_type == 'Polygon' else g)
for p in d['points']:
    outcrops.append(Point(P(p['lat'], p['lon'])))

merged = linemerge(coast)
lines = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
lines.sort(key=lambda l: -l.length)
main = lines[0]
print('coast pieces', len(lines), 'main length km', round(main.length / 1000, 1),
      'ends', UP(*main.coords[0]), UP(*main.coords[-1]))

land = unary_union(coast + outcrops)

# Seaward test: OSM coastline has land on the LEFT, water on the RIGHT.
# For a point, find the nearest coastline segment and check which side it's on.
segs = []
for l in coast:
    cc = list(l.coords)
    segs += list(zip(cc, cc[1:]))
import numpy as np
A = np.array([s[0] for s in segs]); B = np.array([s[1] for s in segs])
def is_sea(x, y):
    p = np.array([x, y]); ab = B - A
    t = np.clip(((p - A) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0, 1)
    proj = A + ab * t[:, None]
    i = int(np.argmin(((proj - p) ** 2).sum(1)))
    cross = ab[i, 0] * (y - A[i, 1]) - ab[i, 1] * (x - A[i, 0])
    return cross < 0   # right-hand side = water
print('sea test', is_sea(*P(-33.95, 151.32)), is_sea(*P(-33.92, 151.24)), is_sea(*P(-34.03, 151.26)))
for i, l in enumerate(lines):
    print('piece', i, round(l.length), UP(*l.coords[0]), UP(*l.coords[-1]))

def contour(dist):
    # Window starts east of the Botany Bay heads: the bay is all within 2 NM of
    # shore, and its inner shoreline isn't in the downloaded data.
    win = box(*P(LAT_MIN, 151.235), *P(LAT_MAX, 151.45))
    seg = land.buffer(dist, resolution=24).boundary.intersection(win)
    res = []
    for g in (seg.geoms if hasattr(seg, 'geoms') else [seg]):
        if g.geom_type != 'LineString': continue
        lons = [UP(x, y)[1] for x, y in g.coords]
        # Inland pieces run into the western window edge; the seaward line doesn't
        if min(lons) < 151.2355 or max(lons) < 151.30: continue
        res.append([[round(v, 5) for v in UP(x, y)] for x, y in g.simplify(8).coords])
    return res

limit_lines = contour(LIMIT)
warn_lines = contour(WARN)
print('limit pieces', len(limit_lines), [len(l) for l in limit_lines], 'warn pieces', len(warn_lines))

# Geometry for runtime distance checks, simplified to 4 m, kept near the mapped range
near = box(*P(LAT_MIN - 0.05, 151.10), *P(LAT_MAX + 0.05, 151.45))
def to_ll(g):
    g = g.simplify(4)
    if g.geom_type == 'Point': return [[round(v, 6) for v in UP(g.x, g.y)]]
    if g.geom_type == 'Polygon': g = g.exterior
    return [[round(v, 6) for v in UP(x, y)] for x, y in g.coords]
features = []
for g in coast + outcrops:
    gi = g.intersection(near)
    if gi.is_empty: continue
    for part in (gi.geoms if hasattr(gi, 'geoms') else [gi]):
        features.append(to_ll(part))
print('runtime features', len(features), 'points', sum(len(f) for f in features))

# Main coast for the map, simplified more
grid_box = box(*P(-34.20, 151.03), *P(-33.725, 151.37))
map_coast = []
for l in lines:
    gi = l.intersection(grid_box)
    for part in (gi.geoms if hasattr(gi, 'geoms') else [gi]):
        if part.geom_type == 'LineString' and part.length > 300:
            map_coast.append([[round(v, 5) for v in UP(x, y)] for x, y in part.simplify(12).coords])
islands = [to_ll(g) for g in outcrops if g.geom_type != 'Point' and g.area > 1500] if True else []

# ── Navigable-water grid for the route calculator ─────────────────────
# Cells at least CLEAR_M from any land/outcrop and connected to open sea.
import numpy as np, shapely
from collections import deque
# 50 m keeps narrow waterways (Gunnamatta Bay, upper Georges River) open
CLEAR_M = 50.0
CELL_M = 50.0
# Figure Eight Pools → Long Reef, incl. the harbour, Botany Bay/Georges River and Port Hacking
G_LAT_MIN, G_LAT_MAX, G_LON_MIN, G_LON_MAX = -34.20, -33.725, 151.04, 151.36
x0, y0 = P(G_LAT_MIN, G_LON_MIN)
x1, y1 = P(G_LAT_MAX, G_LON_MAX)
cols = int((x1 - x0) // CELL_M) + 1
rows = int((y1 - y0) // CELL_M) + 1
blocked = shapely.prepared.prep(land.buffer(CLEAR_M, resolution=8))
xs = x0 + (np.arange(cols) + 0.5) * CELL_M
ys = y0 + (np.arange(rows) + 0.5) * CELL_M
XX, YY = np.meshgrid(xs, ys)
free = ~shapely.contains_xy(land.buffer(CLEAR_M, resolution=8), XX, YY)
# The harbour and Botany Bay shores aren't in the data, so a flood fill alone
# would leak inland. Also require each cell to be on the water side of its
# nearest coastline segment (OSM coastlines keep land on the left).
from scipy.spatial import cKDTree
SA, SB, WAY = [], [], []
for wi, l in enumerate(coast):
    c = list(l.coords)
    for a_, b_ in zip(c, c[1:]):
        SA.append(a_); SB.append(b_); WAY.append(wi)
SA = np.array(SA); SB = np.array(SB); WAY = np.array(WAY)
tree = cKDTree((SA + SB) / 2)
pts = np.column_stack([XX.ravel(), YY.ravel()])
_, idx = tree.query(pts, k=16)
best_d = np.full(len(pts), np.inf); best_i = np.zeros(len(pts), dtype=int); best_t = np.zeros(len(pts))
for k in range(idx.shape[1]):
    i = idx[:, k]; a_ = SA[i]; ab = SB[i] - a_
    t = np.clip(((pts - a_) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0, 1)
    d = (((a_ + ab * t[:, None]) - pts) ** 2).sum(1)
    better = d < best_d; best_d[better] = d[better]; best_i[better] = i[better]; best_t[better] = t[better]
def water_normal(i):  # right-hand normal of segment i (water side)
    ab = SB[i] - SA[i]
    return np.column_stack([ab[:, 1], -ab[:, 0]])
n = water_normal(best_i)
# At a vertex, add the neighbouring segment's normal (pseudo-normal); a
# dangling way end has no neighbour, so it's treated as water.
nxt = np.minimum(best_i + 1, len(SA) - 1); prv = np.maximum(best_i - 1, 0)
at_end = best_t >= 1 - 1e-9; at_start = best_t <= 1e-9
has_next = at_end & (WAY[nxt] == WAY[best_i]) & (nxt != best_i)
has_prev = at_start & (WAY[prv] == WAY[best_i]) & (prv != best_i)
unit = lambda v: v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
n = unit(n)
n = np.where(has_next[:, None], n + unit(water_normal(nxt)), n)
n = np.where(has_prev[:, None], n + unit(water_normal(prv)), n)
vertex = np.where(at_end[:, None], SB[best_i], np.where(at_start[:, None], SA[best_i], SA[best_i] + (SB[best_i] - SA[best_i]) * best_t[:, None]))
side = ((pts - vertex) * n).sum(1)
dangling = (at_end & ~has_next) | (at_start & ~has_prev)
is_water = (side > 0) | dangling
free &= is_water.reshape(free.shape)
# Estuaries mapped as water areas behind a coastline "closing line" (Port
# Hacking): treat the water area as navigable (50 m off its shores) and open
# the closing line where it crosses the mouth.
from shapely.ops import polygonize
est_polys = []
est_types = []
try:
    wel = json.load(open('water.json'))['elements']
except FileNotFoundError:
    wel = []
for e in wel:
    if e['type'] == 'way' and 'geometry' in e:
        c = [P(g['lat'], g['lon']) for g in e['geometry']]
        if len(c) >= 4 and c[0] == c[-1] and e['tags'].get('water') not in ('wastewater', 'pond', 'reservoir', 'fountain'):
            g = Polygon(c).buffer(0); est_polys.append(g); est_types.append((g, e['tags'].get('water')))
    elif e['type'] == 'relation' and e['tags'].get('water') not in ('wastewater', 'pond', 'reservoir', 'fountain'):
        outers = [LineString([P(g['lat'], g['lon']) for g in m['geometry']])
                  for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
        inners = [LineString([P(g['lat'], g['lon']) for g in m['geometry']])
                  for m in e.get('members', []) if m.get('role') == 'inner' and 'geometry' in m]
        outer_poly = unary_union(list(polygonize(unary_union(outers)))) if outers else None
        if outer_poly and not outer_poly.is_empty:
            inner_poly = unary_union(list(polygonize(unary_union(inners)))) if inners else None
            g = outer_poly.difference(inner_poly) if inner_poly else outer_poly
            est_polys.append(g); est_types.append((g, e['tags'].get('water')))
# Only water areas the coastline closed off (their middle reads as land so far);
# Botany Bay etc. are already water and their edges are real shoreline
def _cell_free(pt):
    r_, c_ = int((pt.y - y0) // CELL_M), int((pt.x - x0) // CELL_M)
    return 0 <= r_ < rows and 0 <= c_ < cols and bool(free[r_, c_])
# Rivers, harbours, bays and lagoons at any size; anything else only if large
# (the harbour query also returns ponds, fountains and ocean pools)
NAVIGABLE_WATER = ('river', 'harbour', 'bay', 'estuary', 'lagoon')
est_polys = [g for g, wt in est_types if not g.is_empty and (wt in NAVIGABLE_WATER or g.area > 200_000)
             and not _cell_free(g.representative_point())]
if est_polys:
    estuary = unary_union(est_polys)
    # Coastline segments lying along the estuary edge are the closing line across the mouth
    mouth = [LineString([a, b]) for l in coast for a, b in zip(list(l.coords), list(l.coords)[1:])
             if estuary.boundary.distance(LineString([a, b]).centroid) < 30]
    real_land = unary_union([g for g in coast + outcrops]).difference(unary_union([m.buffer(1) for m in mouth])) if mouth else land
    # Sheltered estuaries narrow to ~150 m (Port Hacking at Lilli Pilli), so
    # keep 25 m off their shores rather than 50 m or the channel closes
    EST_CLEAR_M = 25.0
    land_clear = real_land.buffer(EST_CLEAR_M, resolution=8).union(estuary.boundary.difference(unary_union([m.buffer(5) for m in mouth])).buffer(EST_CLEAR_M) if mouth else estuary.boundary.buffer(EST_CLEAR_M))
    inside = shapely.contains_xy(estuary, XX, YY) & ~shapely.contains_xy(land_clear, XX, YY)
    mouth_gap = shapely.contains_xy(unary_union([m.buffer(150) for m in mouth]), XX, YY) & ~shapely.contains_xy(real_land.buffer(CLEAR_M), XX, YY) if mouth else np.zeros_like(free)
    free |= inside | mouth_gap
    print('estuary polygons', len(est_polys), 'mouth segments', len(mouth), 'estuary cells', int(inside.sum()))

# ── Land ────────────────────────────────────────────────────────────────
# Split the map box along the coastline, keep the faces on the land side and
# cut out every navigable water area (the harbour, bays, rivers). Inside the
# harbour there is no coastline, only water areas, so the per-cell side test
# above wrongly calls parts of the north shore (Georges Heights, Middle Head)
# water. The routing grid and the maps' land fill both use this, so a route
# can't cross land the map shows.
_map_water = [g for g, wt in est_types if not g.is_empty and (wt in NAVIGABLE_WATER or g.area > 200_000)]
_est = unary_union(_map_water) if _map_water else None
_side = is_water.reshape(free.shape)
def _is_land_face(f):
    # Vote over grid cells in the face: one sample point can sit in a river
    xmin, ymin, xmax, ymax = f.bounds
    c0_, c1_ = max(0, int((xmin - x0) // CELL_M)), min(cols, int((xmax - x0) // CELL_M) + 1)
    r0_, r1_ = max(0, int((ymin - y0) // CELL_M)), min(rows, int((ymax - y0) // CELL_M) + 1)
    if c1_ <= c0_ or r1_ <= r0_:
        pt = f.representative_point(); return not is_sea(pt.x, pt.y)
    step = max(1, int(max(r1_ - r0_, c1_ - c0_) / 60))
    rr, cc = np.mgrid[r0_:r1_:step, c0_:c1_:step]
    ins = shapely.contains_xy(f, xs[cc], ys[rr])
    if not ins.any():
        pt = f.representative_point(); return not is_sea(pt.x, pt.y)
    return _side[rr[ins], cc[ins]].mean() < 0.5
_edges = unary_union([l.intersection(grid_box) for l in coast] + [grid_box.boundary])
land_fill = unary_union([f for f in polygonize(_edges) if _is_land_face(f)])
if _est is not None:
    land_fill = land_fill.difference(_est)
_in_land = shapely.contains_xy(land_fill, XX, YY)
print('land cells removed from the grid', int((free & _in_land).sum()))
free &= ~_in_land

# Flood fill from the open sea (east edge) so land interiors aren't "water"
sea = np.zeros_like(free)
q = deque((r, cols - 1) for r in range(rows) if free[r, cols - 1])
for r, c in q: sea[r, c] = True
while q:
    r, c = q.popleft()
    for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
        rr, cc = r + dr, c + dc
        if 0 <= rr < rows and 0 <= cc < cols and free[rr, cc] and not sea[rr, cc]:
            sea[rr, cc] = True; q.append((rr, cc))
# Cost class per water cell — there's no depth data in OSM, so keep routes
# mid-channel by making water near the shore dearer, and prefer charted
# fairways / recommended tracks where they're mapped.
#   1 = ≥200 m from land, 2 = 100–200 m, 3 = <100 m, 4 = charted channel
coast_pts = []
for g in coast + outcrops:
    for part in (g.geoms if hasattr(g, 'geoms') else [g]):
        if part.geom_type == 'Point':
            coast_pts.append((part.x, part.y)); continue
        ring = part.exterior if part.geom_type == 'Polygon' else part
        dens = ring.segmentize(20)
        coast_pts.extend(dens.coords)
land_tree = cKDTree(np.array(coast_pts))
dist_land, _ = land_tree.query(np.column_stack([XX.ravel(), YY.ravel()]))
dist_land = dist_land.reshape(sea.shape)
cls = np.where(dist_land >= 200, 1, np.where(dist_land >= 100, 2, 3)).astype(np.uint8)
channel = np.zeros_like(sea)
try:
    marks = json.load(open('seamarks.json'))['elements']
except FileNotFoundError:
    marks = []
chan_lines = []
for e in marks:
    t = e.get('tags', {})
    if e['type'] == 'way' and t.get('seamark:type') in ('fairway', 'recommended_track', 'navigation_line', 'dredged_area') and 'geometry' in e:
        chan_lines.append(LineString([P(g['lat'], g['lon']) for g in e['geometry']]))
    elif e['type'] == 'relation':
        for m in e.get('members', []):
            if 'geometry' in m:
                chan_lines.append(LineString([P(g['lat'], g['lon']) for g in m['geometry']]))
if chan_lines:
    chan = unary_union([l if t != 'x' else l for l, t in zip(chan_lines, ['l'] * len(chan_lines))])
    # Fairway/dredged polygons are drawn as closed ways: fill them; tracks get a 40 m corridor
    filled = []
    for l in chan_lines:
        c = list(l.coords)
        if len(c) >= 4 and c[0] == c[-1]:
            filled.append(Polygon(c).buffer(0))
        else:
            filled.append(l.buffer(40))
    chan_area = unary_union(filled)
    channel = shapely.contains_xy(chan_area, XX, YY)
# Lateral marks: pair each port mark with its nearest starboard mark (<400 m);
# the midpoints are channel "gates", chained into a centreline
lat_marks = {'port': [], 'starboard': []}
for e in marks:
    t = e.get('tags', {})
    typ = t.get('seamark:type', '')
    if e['type'] == 'node' and typ in ('buoy_lateral', 'beacon_lateral'):
        cat = t.get(f'seamark:{typ}:category')
        if cat in lat_marks:
            lat_marks[cat].append(P(e['lat'], e['lon']))
gates = []
if lat_marks['port'] and lat_marks['starboard']:
    stb = np.array(lat_marks['starboard']); stb_tree = cKDTree(stb)
    for pm in lat_marks['port']:
        d, i = stb_tree.query(pm)
        if d < 400:
            gates.append(((pm[0] + stb[i][0]) / 2, (pm[1] + stb[i][1]) / 2))
gate_lines = []
if len(gates) > 1:
    g = np.array(gates); g_tree = cKDTree(g)
    for i, pt in enumerate(g):
        for d, j in zip(*g_tree.query(pt, k=3)):
            if 0 < d < 1200 and j > i:
                gate_lines.append(LineString([tuple(pt), tuple(g[j])]))
if gate_lines:
    gate_area = unary_union([l.buffer(35) for l in gate_lines])
    channel = channel | shapely.contains_xy(gate_area, XX, YY)
print('lateral marks', {k: len(v) for k, v in lat_marks.items()}, 'gates', len(gates), 'gate links', len(gate_lines))
cls = np.where(channel, 4, cls)
grid = np.where(sea, cls, 0).astype(np.uint8)
print('channel cells', int((grid == 4).sum()), 'from', len(chan_lines), 'charted lines')
def rle(row):
    # "value×count" runs, e.g. "0x12,1x40,3x2"
    runs, cur, n = [], int(row[0]), 0
    for v in row:
        v = int(v)
        if v == cur: n += 1
        else: runs.append(f'{cur}x{n}'); cur = v; n = 1
    runs.append(f'{cur}x{n}')
    return ','.join(runs)
nav_rows = [rle(grid[r]) for r in range(rows)]
print('nav grid', rows, 'x', cols, 'water cells', int(sea.sum()))

# ── Route places: named beaches, bays, points… on navigable water ──────
# Area: Figure Eight Pools → Manly, Sydney Harbour eastern bays, Botany Bay up
# the Georges River to Tom Uglys Bridge, Port Hacking to Grays Point.
REGIONS = ['Long Reef to North Head', 'Harbour (eastern bays)', 'Eastern beaches', 'Botany Bay & Georges River',
           'Kurnell & Cronulla', 'Port Hacking', 'Royal National Park']
def region_of(lat, lon):
    if -33.875 < lat < -33.79 and 151.225 <= lon < 151.287 and not (lon > 151.2855 and lat > -33.806):
        if lat > -33.826 and lon < 151.262:
            return None  # Middle Harbour isn't one of the eastern bays
        return 'Harbour (eastern bays)'
    if -33.83 <= lat <= -33.733 and lon >= 151.28:
        return 'Long Reef to North Head'
    if -34.005 < lat <= -33.83 and lon >= 151.244:
        return 'Eastern beaches'
    if -34.03 < lat <= -33.93 and 151.105 <= lon < 151.244 and (lat > -34.012 or lon < 151.19):
        return 'Botany Bay & Georges River'
    if -34.105 < lat <= -34.052 and 151.075 <= lon < 151.153:
        return 'Port Hacking'
    if -34.075 < lat <= -33.995 and lon >= 151.145:
        return 'Kurnell & Cronulla'
    if -34.195 < lat <= -34.075 and lon >= 151.03:
        return 'Royal National Park'
    return None
KIND_RANK = {'beach': 0, 'bay': 1, 'cape': 2, 'peninsula': 3, 'island': 4, 'islet': 4, 'reef': 5, 'shoal': 5}
route_places = []
try:
    names = json.load(open('names.json'))['elements']
except FileNotFoundError:
    names = []
water_idx = np.argwhere(sea)  # route places must be near navigable water
water_tree = cKDTree(np.column_stack([x0 + (water_idx[:, 1] + 0.5) * CELL_M, y0 + (water_idx[:, 0] + 0.5) * CELL_M])) if len(water_idx) else None
cands = []
for e in names:
    t = e.get('tags', {})
    name = t.get('name')
    lat = e.get('lat', e.get('center', {}).get('lat')); lon = e.get('lon', e.get('center', {}).get('lon'))
    if not name or lat is None: continue
    reg = region_of(lat, lon)
    if not reg: continue
    kind = t.get('natural') or t.get('place') or t.get('man_made') or t.get('leisure') or t.get('amenity') or ''
    # Beaches, bays, points, islands, reefs and lighthouses — plus spots asked for by name
    named_spot = any(k in name for k in ('Ugly', 'Figure Eight', 'Bundeena', 'Maianbar'))
    if kind not in ('beach', 'bay', 'cape', 'peninsula', 'island', 'islet', 'reef', 'shoal', 'lighthouse') and not named_spot:
        continue
    # Suburb/locality points sit mid-suburb, so allow them further from the water
    limit = 1500 if kind in ('suburb', 'locality', 'village') or 'Ugly' in name else 600
    if water_tree is not None and water_tree.query(P(lat, lon))[0] > limit: continue
    cands.append((KIND_RANK.get(kind, 6), name.strip(), reg, round(lat, 5), round(lon, 5)))
cands.sort()
for rank, name, reg, lat, lon in cands:
    norm = lambda n: n.lower().replace("'", '').replace('’', '').replace(' reserve', '')
    if any(norm(p['name']) == norm(name) and abs(p['lat'] - lat) < 0.01 and abs(p['lon'] - lon) < 0.012 for p in route_places):
        continue
    route_places.append({'name': name, 'region': reg, 'lat': lat, 'lon': lon})
route_places.sort(key=lambda p: (REGIONS.index(p['region']), -p['lat'] if p['region'] != 'Botany Bay & Georges River' else p['lon']))
print('route places', len(route_places), {r: sum(1 for p in route_places if p['region'] == r) for r in REGIONS})

# ── Map shoreline: coastline plus the estuary water-area outlines ─────
# OSM's coastline closes across Sydney Harbour at the Heads (and across Port
# Hacking), with the water behind mapped as water areas. Draw those outlines
# too, and drop any piece with water on both sides (the made-up closing lines),
# so the harbour shows as open water with its real shore.
def _wet(x, y):
    r_, c_ = int((y - y0) // CELL_M), int((x - x0) // CELL_M)
    return 0 <= r_ < rows and 0 <= c_ < cols and bool(sea[r_, c_])
def _shore_parts(line, off=90):
    out, cur = [], []
    cc = list(line.coords)
    for (ax, ay), (bx, by) in zip(cc, cc[1:]):
        L = math.hypot(bx - ax, by - ay) or 1
        mx, my = (ax + bx) / 2, (ay + by) / 2
        nx, ny = -(by - ay) / L * off, (bx - ax) / L * off
        if _wet(mx + nx, my + ny) and _wet(mx - nx, my - ny):
            if len(cur) > 1: out.append(LineString(cur))
            cur = []
        else:
            if not cur: cur = [(ax, ay)]
            cur.append((bx, by))
    if len(cur) > 1: out.append(LineString(cur))
    return out
# Every navigable water area counts for the map, including ones routing leaves
# out (Middle Harbour, North Harbour)
_outlines = list(lines)
if _map_water:
    _b = unary_union(_map_water).boundary
    _outlines += list(_b.geoms) if hasattr(_b, 'geoms') else [_b]
map_coast = []
for l in _outlines:
    gi = l.intersection(grid_box)
    for part in (gi.geoms if hasattr(gi, 'geoms') else [gi]):
        if part.geom_type != 'LineString': continue
        for piece in _shore_parts(part.segmentize(40)):
            if piece.length > 300:
                map_coast.append([[round(v, 5) for v in UP(x, y)] for x, y in piece.simplify(12).coords])
print('map shoreline pieces', len(map_coast), 'points', sum(len(m) for m in map_coast))

# ── Land fill for the maps: the same land the routing grid uses ─────────
map_land = []
for poly in (land_fill.geoms if hasattr(land_fill, 'geoms') else [land_fill]):
    if poly.geom_type != 'Polygon' or poly.area < 2000: continue
    poly = poly.simplify(12)
    rings = [poly.exterior] + [r for r in poly.interiors if Polygon(r).area > 2000]
    # Compact: each ring is "x,y;dx,dy;..." in 10 m steps from the projection
    # origin, then from the previous point (decoded in coast.js itself)
    enc_rings = []
    for r in rings:
        pts_ = [(round(x / 10), round(y / 10)) for x, y in r.coords]
        out_ = [f'{pts_[0][0]},{pts_[0][1]}'] + [f'{b[0]-a[0]},{b[1]-a[1]}' for a, b in zip(pts_, pts_[1:]) if b != a]
        enc_rings.append(';'.join(out_))
    map_land.append(enc_rings)
print('map land polygons', len(map_land), 'chars', sum(len(r) for p_ in map_land for r in p_))

js = f"""/* ── Surf Patrol Log – coast.js (generated) ──
   Coastline, islands, rock platforms and reefs from South Head to Cape Baily,
   and the pre-computed 2 NM line measured from the outermost land or outcrop.
   Data © OpenStreetMap contributors (ODbL), downloaded Oct 2026.
   Regenerate with data-scripts/fetch_coast.py then build_coast.py.
   This is an aid only — the vessel's plotter is the authority.
*/
const COAST = {{
  mapped: {{ latMin: {LAT_MIN}, latMax: {LAT_MAX} }},
  limitM: {LIMIT},
  warnM: {WARN},
  features: {json.dumps(features, separators=(',', ':'))},
  mapCoast: {json.dumps(map_coast, separators=(',', ':'))},
  // Land for the maps' fill: polygons as [outer ring, ...holes], encoded; decoded below to lat/lon
  mapLand: {json.dumps(map_land, separators=(',', ':'))},
  mapOutcrops: {json.dumps(islands, separators=(',', ':'))},
  limitLines: {json.dumps(limit_lines, separators=(',', ':'))},
  warnLines: {json.dumps(warn_lines, separators=(',', ':'))},
  // Named places for the job route calculator, grouped by area
  routeRegions: {json.dumps(REGIONS)},
  routePlaces: {json.dumps(route_places, separators=(',', ':'))},
  // Navigable water for routing: rows south→north, runs of value×count (0 land, 1 open water, 2 within 200 m of land, 3 within 100 m, 4 charted channel)
  nav: {{ origin: {json.dumps([round(UP(x0, y0)[0], 6), round(UP(x0, y0)[1], 6)])}, cellM: {CELL_M}, rows: {rows}, cols: {cols},
         proj: {{ lat0: {LAT0}, lon0: {LON0}, kx: {KX:.4f}, ky: {KY} }}, data: {json.dumps(nav_rows, separators=(',', ':'))} }}
}};
// Unpack mapLand: "x,y;dx,dy;..." in 10 m steps → [[lat, lon], ...]
COAST.mapLand = COAST.mapLand.map(poly => poly.map(ring => {{
  let x = 0, y = 0;
  return ring.split(';').map(s => {{
    const [dx, dy] = s.split(',');
    x += +dx; y += +dy;
    return [{LAT0} + y * 10 / {KY}, {LON0} + x * 10 / {KX:.4f}];
  }});
}}));
"""
open('../coast.js', 'w').write(js)
print('coast.js KB', round(len(js) / 1024))
