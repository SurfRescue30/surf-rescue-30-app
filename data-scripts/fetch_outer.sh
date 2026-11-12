#!/usr/bin/env bash
# Downloads the OpenStreetMap coastline and the big estuary water areas from
# Newcastle to Scarborough, for the approximate route outside the detailed
# area (Pittwater, Broken Bay, Hawkesbury River to Bar Point, Cowan Creek to
# Bobbin Head, Brisbane Water to Woy Woy, Lake Macquarie entrance).
# Output: outer.json in the directory given; data-scripts/build_outer.py turns
# it into coast-outer.js.
set -euo pipefail
OUT="${1:-osm}"
mkdir -p "$OUT"
BBOX="-34.31,150.88,-32.88,151.84"
ENDPOINTS=(https://overpass-api.de/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter https://overpass.kumi.systems/api/interpreter)
UA="surf-rescue-30-app/1.0 (+https://github.com/SurfRescue30/surf-rescue-30-app)"

query() {
  local file="$1" ql="$2"
  for api in "${ENDPOINTS[@]}"; do
    for attempt in 1 2 3; do
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

query "$OUT/outer-coast.json" "[out:json][timeout:240];
way[\"natural\"=\"coastline\"]($BBOX);
out geom;"

# OSM maps these as water areas, not coastline (the coastline closes across
# their mouths), so the coastline alone would treat them as land
query "$OUT/outer-water.json" "[out:json][timeout:240];
(
  relation[\"natural\"=\"water\"][\"name\"~\"^(Port Jackson|Pittwater|Broken Bay|Hawkesbury River|Cowan Water|Berowra Creek|Brisbane Water|Lake Macquarie|Swansea Channel|Botany Bay|Port Hacking|Georges River)$\"]($BBOX);
  way[\"natural\"=\"water\"][\"name\"~\"^(Pittwater|Broken Bay|Hawkesbury River|Cowan Water|Brisbane Water|Lake Macquarie|Swansea Channel|Port Hacking)$\"]($BBOX);
);
out geom;"

python3 - "$OUT" <<'PY'
import json, sys
out = sys.argv[1]
coast = json.load(open(f"{out}/outer-coast.json"))["elements"]
water = json.load(open(f"{out}/outer-water.json"))["elements"]
json.dump({"coast": coast, "water": water}, open(f"{out}/outer.json", "w"))
print("coast ways", len(coast), "water areas", len(water))
PY
rm "$OUT/outer-coast.json" "$OUT/outer-water.json"
