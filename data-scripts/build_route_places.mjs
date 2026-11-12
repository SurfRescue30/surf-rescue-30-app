// Builds route-places.js — the places offered in the job route From/To
// pickers — from the candidate list and the crew's ticks in the
// "SR30 Route Locations" artifact (https://claude.ai/artifact/4dmjAm3EPZgCmwNwXfLKSC).
//
//   node data-scripts/build_route_places.mjs picks.json
//
// picks.json: the artifact's `picks` collection, as [{id, data: {keep}}] or
// {id: keep}. A place with no pick keeps its default: places already in the
// app are kept, proposed new ones are not.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { places } = JSON.parse(readFileSync(join(here, 'route-candidates.json'), 'utf8'));
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const picks = Array.isArray(raw) ? Object.fromEntries(raw.map(d => [d.id, d.data.keep])) : raw;

// Picker order: ramps first, then outward from Malabar
const REGIONS = ['Boat ramps & wharves', 'Eastern beaches', 'Botany Bay & Georges River', 'Kurnell & Cronulla',
  'Port Hacking', 'Royal National Park', 'Otford to Scarborough', 'Harbour (eastern bays)', 'Manly & North Head',
  'Northern Beaches', 'Pittwater', 'Broken Bay', 'Hawkesbury River & Cowan Creek', 'Brisbane Water',
  'Central Coast', 'Lake Macquarie & Newcastle'];

const kept = places.filter(p => picks[p.id] ?? p.status === 'current');
const unknown = [...new Set(kept.map(p => p.region))].filter(r => !REGIONS.includes(r));
if (unknown.length) throw new Error(`regions missing from the picker order: ${unknown}`);
const regions = REGIONS.filter(r => kept.some(p => p.region === r));
const out = kept.map(({ name, region, lat, lon }) => ({ name, region, lat, lon }));

writeFileSync(join(here, '..', 'route-places.js'), `/* ── Surf Patrol Log – route-places.js (generated) ──
   Places offered in the job route pickers, as chosen by the crew in the
   "SR30 Route Locations" artifact. Positions © OpenStreetMap contributors (ODbL).
   Regenerate: node data-scripts/build_route_places.mjs picks.json
*/
const ROUTE_PLACES = {
  routeRegions: ${JSON.stringify(regions)},
  routePlaces: [
${out.map(p => '    ' + JSON.stringify(p)).join(',\n')}
  ]
};
`);
console.log(`route-places.js: ${out.length} places in ${regions.length} areas`);
regions.forEach(r => console.log(`  ${r}: ${out.filter(p => p.region === r).length}`));
