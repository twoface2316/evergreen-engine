// Phase 5: USDA 2023 Plant Hardiness Zone lookup for every city in data/cities-frost.json.
//
// Data source decision (see PLAN.md Phase 5):
//   "Preferred" static ZIP->zone dataset was investigated first. GitHub search turned up
//   waldoj/frostline (MIT licensed) -- this is literally the parser/generator behind
//   phzmapi.org, but the repo itself only ships ZIP->lat/lon location CSVs
//   (combined_zipcodes.csv / zipcodes.csv), not the zone values themselves; zone data is
//   produced by running frostline.py against PRISM's bulk grid files and is not committed
//   to the repo. phzmapi.org (an S3-hosted static JSON-per-ZIP site built by that same
//   MIT-licensed code) has a listing showing every object's LastModified as 2023-11-19,
//   which lines up with USDA/PRISM's November 2023 PHZM release, and spot checks below
//   match the known 2023 map. So there is no separate bulk dataset to prefer over
//   phzmapi.org -- we use the PLAN.md fallback path, which for this dataset *is* the
//   authoritative static-per-ZIP 2023 data. License: frostline (the code producing this
//   data) is MIT; underlying PRISM/USDA climate data is public domain government data
//   with an attribution request, not a reuse restriction.
//
// Pipeline:
//   1. Parse frostline's combined_zipcodes.csv (data/raw/frostline-combined_zipcodes.csv,
//      MIT licensed, from github.com/waldoj/frostline) into a zip -> {lat, lon} list.
//      IMPORTANT: this is the exact ZIP-location dataset phzmapi.org was generated from,
//      so ZIP coordinates are consistent with the zone values the API returns. The
//      GeoNames postal export was tried first and produced a wrong Chicago result:
//      GeoNames pins "unique"/corporate ZIPs (e.g. 60666, O'Hare's airport ZIP) at the
//      city centroid, while PRISM computed that ZIP's zone at its real location -- so
//      nearest-ZIP-by-GeoNames-coords could select a ZIP whose zone belongs somewhere
//      else entirely.
//   2. For each city in cities-frost.json, find the 3 nearest ZIPs by haversine distance
//      (brute force over ~43k ZIPs with a cheap latitude-band rejection). Ranks 2-3 are
//      fallbacks for nearest ZIPs that 404 (frostline's README documents that PRISM's
//      data does not cover every ZIP).
//   3. Dedupe: with ~5,078 cities there are far fewer unique nearest-ZIPs. Only unique ZIPs
//      are queried against the API.
//   4. Query https://phzmapi.org/{zip}.json, throttled to <= 5 req/s, with an on-disk cache
//      at data/zones-cache.json (zip -> zone string | null) so reruns only fetch ZIPs not
//      already cached. One retry on failure (network error or non-200/404 status); 404
//      (ZIP not in PRISM's ZIP list -- documented as a real gap in frostline's README) is
//      terminal, not retried, and cached as null.
//   5. Write data/zones.json: { "<stateSlug>/<slug>": "<zone>" | null, ... } keyed the same
//      way city pages are addressed elsewhere in the pipeline (render.js join key).
//
// Node.js plain JS, no deps (uses global fetch, Node 18+).

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ZIP_COORDS_FILE = path.join(DATA_DIR, 'raw', 'frostline-combined_zipcodes.csv');
const CITIES_FILE = path.join(DATA_DIR, 'cities-frost.json');
const CACHE_FILE = path.join(DATA_DIR, 'zones-cache.json');
const OUT_FILE = path.join(DATA_DIR, 'zones.json');
const REPORT_FILE = path.join(DATA_DIR, 'zones-report.txt');

const MAX_REQ_PER_SEC = 5;
const API_BASE = 'https://phzmapi.org/';

// ---------------------------------------------------------------------
// Haversine
// ---------------------------------------------------------------------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------
// 1. Parse frostline ZIP-location CSV (zipcode,latitude,longitude header row)
// ---------------------------------------------------------------------
async function loadZipCoords() {
  if (!fs.existsSync(ZIP_COORDS_FILE)) {
    throw new Error(`Missing ${ZIP_COORDS_FILE}. Download https://raw.githubusercontent.com/waldoj/frostline/master/combined_zipcodes.csv`);
  }
  const all = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(ZIP_COORDS_FILE, 'utf8'),
    crlfDelay: Infinity
  });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    if (!line.trim()) continue;
    const f = line.split(',');
    const zip = f[0];
    const lat = parseFloat(f[1]);
    const lon = parseFloat(f[2]);
    if (!zip || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    all.push({ zip, lat, lon });
  }
  return all;
}

// ---------------------------------------------------------------------
// 2. K nearest ZIPs per city (brute force with latitude-band rejection)
// ---------------------------------------------------------------------
const NEAREST_K = 3;

function nearestZips(city, all) {
  // best[] kept sorted ascending by distance, length <= NEAREST_K.
  const best = [];
  let worstBest = Infinity;
  for (const c of all) {
    // Cheap rejection: 1 degree latitude ~ 111 km everywhere.
    if (best.length === NEAREST_K && Math.abs(c.lat - city.lat) * 111 > worstBest) continue;
    const d = haversineKm(city.lat, city.lon, c.lat, c.lon);
    if (best.length < NEAREST_K || d < worstBest) {
      best.push({ zip: c.zip, distanceKm: d });
      best.sort((a, b) => a.distanceKm - b.distanceKm);
      if (best.length > NEAREST_K) best.pop();
      worstBest = best[best.length - 1].distanceKm;
    }
  }
  return best;
}

// ---------------------------------------------------------------------
// 4. Throttled fetch with cache + one retry
// ---------------------------------------------------------------------
function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 0), 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchZoneOnce(zip) {
  const res = await fetch(`${API_BASE}${zip}.json`, { signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return null; // ZIP not present in PRISM's ZIP list -- terminal.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body && typeof body.zone === 'string' ? body.zone : null;
}

async function fetchZoneWithRetry(zip) {
  try {
    return await fetchZoneOnce(zip);
  } catch (err) {
    // One retry on transient failure (network error / 5xx / timeout).
    await sleep(300);
    try {
      return await fetchZoneOnce(zip);
    } catch (err2) {
      console.log(`  FAILED ${zip}: ${err2.message} (after 1 retry) -> null`);
      return null;
    }
  }
}

async function resolveZonesForZips(uniqueZips, cache) {
  const toFetch = uniqueZips.filter((z) => !(z in cache));
  console.log(`Unique ZIPs needed: ${uniqueZips.length}, already cached: ${uniqueZips.length - toFetch.length}, to fetch: ${toFetch.length}`);

  const intervalMs = 1000 / MAX_REQ_PER_SEC;
  let done = 0;
  for (const zip of toFetch) {
    const t0 = Date.now();
    const zone = await fetchZoneWithRetry(zip);
    cache[zip] = zone;
    done++;
    if (done % 200 === 0 || done === toFetch.length) {
      saveCache(cache); // periodic checkpoint so a crash doesn't lose progress
      console.log(`  fetched ${done}/${toFetch.length} ZIPs`);
    }
    const elapsed = Date.now() - t0;
    if (elapsed < intervalMs) await sleep(intervalMs - elapsed);
  }
  saveCache(cache);
  return cache;
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------
async function main() {
  const cities = JSON.parse(fs.readFileSync(CITIES_FILE, 'utf8'));
  console.log(`Loaded ${cities.length} cities`);

  console.log('Parsing frostline ZIP coordinates...');
  const all = await loadZipCoords();
  console.log(`Loaded ${all.length} ZIP records`);

  console.log(`Finding ${NEAREST_K} nearest ZIPs per city...`);
  const cityZips = new Map(); // "stateSlug/slug" -> [{zip, distanceKm} x NEAREST_K]
  for (const city of cities) {
    cityZips.set(`${city.stateSlug}/${city.slug}`, nearestZips(city, all));
  }

  const cache = loadCache();

  // Resolve rank-by-rank: fetch every city's nearest ZIP first; cities whose
  // nearest ZIP has no zone (404 -- PRISM doesn't cover every ZIP) fall back
  // to their 2nd, then 3rd nearest.
  const resolved = new Map(); // "stateSlug/slug" -> zone string
  for (let rank = 0; rank < NEAREST_K; rank++) {
    const needed = new Set();
    for (const [key, zips] of cityZips) {
      if (!resolved.has(key) && zips[rank]) needed.add(zips[rank].zip);
    }
    if (needed.size === 0) break;
    console.log(`Rank ${rank + 1} nearest-ZIP pass: ${needed.size} unique ZIPs`);
    await resolveZonesForZips([...needed], cache);
    for (const [key, zips] of cityZips) {
      if (resolved.has(key) || !zips[rank]) continue;
      const zone = cache[zips[rank].zip];
      if (zone != null) resolved.set(key, zone);
    }
  }

  const zones = {};
  let zonedCount = 0;
  for (const city of cities) {
    const key = `${city.stateSlug}/${city.slug}`;
    const zone = resolved.get(key);
    zones[key] = zone != null ? zone : null;
    if (zone != null) zonedCount++;
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(zones, null, 2), 'utf8');

  const coveragePct = (zonedCount / cities.length) * 100;

  // Sanity checks against known 2023 PHZM values (see PLAN.md task instructions).
  const sanity = [
    { name: 'Chicago', state: 'IL', expected: ['6a', '6b'] },
    { name: 'Miami', state: 'FL', expected: ['10b', '11a', '11b'] },
    { name: 'Denver', state: 'CO', expected: ['5b', '6a'] },
    { name: 'Phoenix', state: 'AZ', expected: ['9b', '10a', '10b'] },
    { name: 'Anchorage', state: 'AK', expected: ['4a', '4b', '5a', '5b'] }
  ];
  const sanityLines = [];
  for (const s of sanity) {
    const city = cities.find((c) => c.name === s.name && c.state === s.state);
    if (!city) {
      sanityLines.push(`${s.name}, ${s.state}: NOT FOUND in cities-frost.json`);
      continue;
    }
    const key = `${city.stateSlug}/${city.slug}`;
    const zone = zones[key];
    const pass = zone != null && s.expected.includes(zone);
    sanityLines.push(`${s.name}, ${s.state}: zone=${zone} expected one of [${s.expected.join(', ')}] -> ${pass ? 'PASS' : 'FAIL'}`);
  }

  const reportLines = [
    '=== FrostCal Phase 5 zone lookup report ===',
    `Cities total: ${cities.length}`,
    `ZIP coordinate source: frostline combined_zipcodes.csv (${all.length} ZIPs)`,
    `ZIPs in cache after run: ${Object.keys(cache).length}`,
    `Cities with resolved zone: ${zonedCount} (${coveragePct.toFixed(2)}%)`,
    `Acceptance (>= 95%): ${coveragePct >= 95 ? 'PASS' : 'FAIL'}`,
    '',
    '--- Sanity checks (2023 PHZM) ---',
    ...sanityLines
  ];
  const report = reportLines.join('\n') + '\n';
  fs.writeFileSync(REPORT_FILE, report, 'utf8');
  console.log('\n' + report);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
