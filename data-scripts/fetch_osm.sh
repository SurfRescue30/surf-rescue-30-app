#!/usr/bin/env bash
# Downloads OpenStreetMap coastline, outcrops and named water places for the
# route calculator area (Long Reef → Era, incl. Sydney Harbour, Botany Bay up the
# Georges River and Port Hacking). Run by .github/workflows/osm-data.yml;
# outputs features.json and names.json into the directory given.
set -euo pipefail
OUT="${1:-osm}"
mkdir -p "$OUT"
BBOX="-34.20,151.00,-33.70,151.36"
ENDPOINTS=(https://overpass-api.de/api/interpreter https://overpass.kumi.systems/api/interpreter https://overpass.private.coffee/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter)
# Overpass asks clients to identify themselves; anonymous requests get 406
UA="surf-rescue-30-app/1.0 (+https://github.com/SurfRescue30/surf-rescue-30-app)"

# query <file> <overpass-ql>: try each server until one returns valid JSON
query() {
  local file="$1" ql="$2"
  for api in "${ENDPOINTS[@]}"; do
    for attempt in 1 2; do
      if curl -sS -m 300 -A "$UA" --data-urlencode "data=$ql" "$api" -o "$file" &&
         python3 -c "import json,sys; json.load(open(sys.argv[1]))['elements']" "$file" 2>/dev/null; then
        echo "ok: $api → $file"; return 0
      fi
      echo "::warning::$api attempt $attempt returned: $(head -c 300 "$file" | tr '\n' ' ')"
      sleep 20
    done
  done
  echo "::error::all Overpass servers failed for $file"; return 1
}

query "$OUT/raw-features.json" "[out:json][timeout:240];
(
  way[\"natural\"=\"coastline\"]($BBOX);
  way[\"natural\"~\"^(bare_rock|reef|rock|shoal)$\"]($BBOX);
  node[\"natural\"~\"^(rock|bare_rock|reef|stone)$\"]($BBOX);
  way[\"place\"~\"^(island|islet)$\"]($BBOX);
  node[\"place\"~\"^(island|islet)$\"]($BBOX);
);
out geom;"

query "$OUT/names.json" "[out:json][timeout:240];
(
  nwr[\"natural\"~\"^(beach|bay|cape|peninsula|reef|shoal)$\"][\"name\"]($BBOX);
  nwr[\"place\"~\"^(island|islet)$\"][\"name\"]($BBOX);
  nwr[\"man_made\"=\"lighthouse\"][\"name\"]($BBOX);
  nwr[\"leisure\"=\"marina\"][\"name\"]($BBOX);
  nwr[\"amenity\"=\"ferry_terminal\"][\"name\"]($BBOX);
  nwr[\"place\"~\"^(suburb|locality|village)$\"][\"name\"~\"^(Grays Point|Bundeena|Maianbar|Kurnell|La Perouse|Watsons Bay|Taren Point|Sylvania Waters|Kangaroo Point|Lilli Pilli|Dolans Bay|Burraneer|Yowie Bay|Port Hacking)$\"]($BBOX);
  nwr[\"name\"~\"Tom Ugly|Figure Eight|Figure 8\"]($BBOX);
);
out center tags;"

# Nautical chart data (OpenSeaMap tags): fairways, recommended tracks and
# lateral marks, used to keep routes in the channel
# Optional: a slow or failed seamark download mustn't lose the rest
query "$OUT/seamarks.json" "[out:json][timeout:240];
(
  way[\"seamark:type\"~\"^(fairway|recommended_track|navigation_line|dredged_area)$\"]($BBOX);
  relation[\"seamark:type\"~\"^(fairway|dredged_area)$\"]($BBOX);
  node[\"seamark:type\"~\"^(buoy_lateral|beacon_lateral|buoy_safe_water|beacon_cardinal|buoy_cardinal)$\"]($BBOX);
);
out geom;" || echo '{"elements":[]}' > "$OUT/seamarks.json"

# Estuary water areas — OSM's coastline crosses some river mouths (e.g. Port
# Hacking, Sydney Harbour at the Heads), with the water behind mapped as natural=water
query "$OUT/water.json" "[out:json][timeout:240];
(
  way[\"natural\"=\"water\"][\"water\"~\"^(river|estuary|bay|lagoon|basin|harbour)$\"](-34.115,151.03,-33.92,151.20);
  relation[\"natural\"=\"water\"][\"water\"~\"^(river|estuary|bay|lagoon|basin|harbour)$\"](-34.115,151.03,-33.92,151.20);
  way[\"natural\"=\"water\"](-33.875,151.20,-33.79,151.30);
  relation[\"natural\"=\"water\"](-33.875,151.20,-33.79,151.30);
  way[\"natural\"=\"bay\"][\"name\"~\"Port Hacking|Gunnamatta|Gymea|Yowie|Burraneer|Dolans|Port Hacking\"](-34.115,151.03,-34.04,151.17);
);
out geom;" || echo '{"elements":[]}' > "$OUT/water.json"

# Shape features into the format build_coast.py expects
python3 - "$OUT" <<'PY'
import json, sys
out = sys.argv[1]
raw = json.load(open(f"{out}/raw-features.json"))
ways, points = [], []
for e in raw["elements"]:
    tags = e.get("tags", {})
    if e["type"] == "way" and "geometry" in e:
        ways.append({"id": str(e["id"]), "tags": tags, "pts": [(g["lat"], g["lon"]) for g in e["geometry"]]})
    elif e["type"] == "node":
        points.append({"id": str(e["id"]), "lat": e["lat"], "lon": e["lon"], "tags": tags})
json.dump({"ways": ways, "points": points}, open(f"{out}/features.json", "w"))
print("ways", len(ways), "points", len(points), "names", len(json.load(open(f"{out}/names.json"))["elements"]), "seamarks", len(json.load(open(f"{out}/seamarks.json"))["elements"]))
PY
rm "$OUT/raw-features.json"
