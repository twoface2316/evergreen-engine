// Phase 1 step 3-6: build data/cities-frost.json + data/pipeline-report.txt
//
// Pipeline:
//   1. Parse NOAA annual/seasonal by-station CSVs -> station frost records (32F P10/50/90
//      last-spring-freeze + first-fall-freeze dates, growing season length). Frost-free
//      stations (sentinel -9999, e.g. HI/southern FL) are kept and flagged.
//   2. Parse NOAA monthly by-station CSVs -> station monthly TMIN/TAVG/TMAX (12 values).
//   3. Parse GeoNames US.txt -> top ~5000 populated places by population, topped up so
//      every state (incl. DC) has >= 20 cities.
//   4. Join each city to nearest valid-frost station via haversine, rejecting matches
//      > 80km distance or > 400m elevation delta (falls through to next-nearest).
//   5. Write data/cities-frost.json + data/pipeline-report.txt.
//
// Node.js plain JS, no deps. Designed to run sequentially over ~15,600 small station CSVs
// and a 300MB GeoNames text file (streamed line-by-line, not slurped) to keep memory low.

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const RAW_DIR = path.join(__dirname, "..", "data", "raw");
const ANNUAL_DIR = path.join(RAW_DIR, "annual");
const MONTHLY_DIR = path.join(RAW_DIR, "monthly");
const GEONAMES_FILE = path.join(RAW_DIR, "geonames", "US.txt");
const OUT_JSON = path.join(__dirname, "..", "data", "cities-frost.json");
const OUT_REPORT = path.join(__dirname, "..", "data", "pipeline-report.txt");

const TARGET_CITY_COUNT = 5000;
const MIN_CITIES_PER_STATE = 20;
const MAX_DISTANCE_KM = 80;
const MAX_ELEVATION_DELTA_M = 400;

// ---------- generic CSV line parser (handles quoted fields with embedded commas) ----------
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function num(v) {
  const t = (v || "").trim();
  if (t === "") return null;
  const f = parseFloat(t);
  return Number.isNaN(f) ? null : f;
}

// MM/DD (non-leap reference year 2001) -> {month, day, iso, doy}
function mmddToDate(mmdd) {
  const m = /^(\d{2})\/(\d{2})$/.exec(mmdd.trim());
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const REF_YEAR = 2001; // non-leap
  const iso = `${REF_YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const doy = Math.round(
    (Date.UTC(REF_YEAR, month - 1, day) - Date.UTC(REF_YEAR, 0, 1)) / 86400000
  ) + 1;
  return { month, day, iso, doy };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------- Step 1: parse annual (frost) by-station CSVs ----------
const THRESHOLD = "T32F";
const FROST_COLS = {
  lstP10: `ANN-TMIN-PRBLST-${THRESHOLD}P10`,
  lstP50: `ANN-TMIN-PRBLST-${THRESHOLD}P50`,
  lstP90: `ANN-TMIN-PRBLST-${THRESHOLD}P90`,
  fstP10: `ANN-TMIN-PRBFST-${THRESHOLD}P10`,
  fstP50: `ANN-TMIN-PRBFST-${THRESHOLD}P50`,
  fstP90: `ANN-TMIN-PRBFST-${THRESHOLD}P90`,
  gslP50: `ANN-TMIN-PRBGSL-${THRESHOLD}P50`,
};

function isSentinel(v) {
  const f = parseFloat(v);
  return !Number.isNaN(f) && f <= -9000;
}

function parseAnnualStations() {
  const files = fs.readdirSync(ANNUAL_DIR).filter((f) => f.endsWith(".csv"));
  const stations = new Map(); // id -> record
  let noColumn = 0;
  let missingP50 = 0;
  let frostFreeCount = 0;
  let validCount = 0;

  for (const f of files) {
    const content = fs.readFileSync(path.join(ANNUAL_DIR, f), "utf8");
    const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2) continue;
    const headers = parseCsvLine(lines[0]);
    const idx = {};
    headers.forEach((h, i) => (idx[h] = i));

    if (idx[FROST_COLS.lstP50] === undefined || idx[FROST_COLS.fstP50] === undefined) {
      noColumn++;
      continue;
    }
    const row = parseCsvLine(lines[1]);
    const get = (col) => (row[idx[col]] || "").trim();

    const lstP50raw = get(FROST_COLS.lstP50);
    const fstP50raw = get(FROST_COLS.fstP50);

    if (lstP50raw === "" || fstP50raw === "") {
      missingP50++;
      continue; // truly missing 32F/P50 values -> discard per spec
    }

    const frostFree = isSentinel(lstP50raw) || isSentinel(fstP50raw);

    const lat = num(get("LATITUDE"));
    const lon = num(get("LONGITUDE"));
    const elevation = num(get("ELEVATION"));
    const name = get("NAME");
    const stateMatch = /,\s*([A-Z]{2})\s*US$/.exec(name);
    const state = stateMatch ? stateMatch[1] : null;
    const id = get("STATION");

    if (lat === null || lon === null) {
      missingP50++;
      continue;
    }

    let frost = null;
    if (!frostFree) {
      const lst50 = mmddToDate(lstP50raw);
      const fst50 = mmddToDate(fstP50raw);
      if (!lst50 || !fst50) {
        missingP50++;
        continue;
      }
      const lst10raw = get(FROST_COLS.lstP10);
      const lst90raw = get(FROST_COLS.lstP90);
      const fst10raw = get(FROST_COLS.fstP10);
      const fst90raw = get(FROST_COLS.fstP90);
      const gslRaw = get(FROST_COLS.gslP50);

      frost = {
        lastSpringFrost: {
          p10: !isSentinel(lst10raw) ? mmddToDate(lst10raw)?.iso ?? null : null,
          p50: lst50.iso,
          p90: !isSentinel(lst90raw) ? mmddToDate(lst90raw)?.iso ?? null : null,
        },
        firstFallFrost: {
          p10: !isSentinel(fst10raw) ? mmddToDate(fst10raw)?.iso ?? null : null,
          p50: fst50.iso,
          p90: !isSentinel(fst90raw) ? mmddToDate(fst90raw)?.iso ?? null : null,
        },
        growingSeasonDays: gslRaw !== "" && !isSentinel(gslRaw) ? num(gslRaw) : null,
      };
      validCount++;
    } else {
      frostFreeCount++;
    }

    stations.set(id, {
      id,
      name,
      state,
      lat,
      lon,
      elevation,
      frostFree,
      frost, // null when frostFree
    });
  }

  return { stations, stats: { totalFiles: files.length, noColumn, missingP50, validCount, frostFreeCount } };
}

// ---------- Step 2: parse monthly by-station CSVs ----------
const MONTH_COLS = { tavg: "MLY-TAVG-NORMAL", tmin: "MLY-TMIN-NORMAL", tmax: "MLY-TMAX-NORMAL" };

function parseMonthlyStations(stationIds) {
  const monthly = new Map();
  let found = 0;
  for (const id of stationIds) {
    const fp = path.join(MONTHLY_DIR, `${id}.csv`);
    if (!fs.existsSync(fp)) continue;
    const content = fs.readFileSync(fp, "utf8");
    const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2) continue;
    const headers = parseCsvLine(lines[0]);
    const idx = {};
    headers.forEach((h, i) => (idx[h] = i));
    if (
      idx[MONTH_COLS.tavg] === undefined ||
      idx[MONTH_COLS.tmin] === undefined ||
      idx[MONTH_COLS.tmax] === undefined ||
      idx["month"] === undefined
    ) {
      continue;
    }
    const tavg = new Array(12).fill(null);
    const tmin = new Array(12).fill(null);
    const tmax = new Array(12).fill(null);
    for (let li = 1; li < lines.length; li++) {
      const row = parseCsvLine(lines[li]);
      const monthNum = parseInt((row[idx["month"]] || "").trim(), 10);
      if (!monthNum || monthNum < 1 || monthNum > 12) continue;
      tavg[monthNum - 1] = num(row[idx[MONTH_COLS.tavg]]);
      tmin[monthNum - 1] = num(row[idx[MONTH_COLS.tmin]]);
      tmax[monthNum - 1] = num(row[idx[MONTH_COLS.tmax]]);
    }
    if (tavg.every((v) => v === null)) continue;
    monthly.set(id, { tavg, tmin, tmax });
    found++;
  }
  return { monthly, found };
}

// ---------- Step 3: parse GeoNames, select top ~5000 cities ----------
async function parseGeonamesCities() {
  const rl = readline.createInterface({
    input: fs.createReadStream(GEONAMES_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  const candidates = []; // { geonameid, name, state, lat, lon, population, elevation }
  for await (const line of rl) {
    if (!line) continue;
    const cols = line.split("\t");
    if (cols.length < 19) continue;
    const featureClass = cols[6];
    if (featureClass !== "P") continue;
    const population = parseInt(cols[14], 10) || 0;
    if (population <= 0) continue;
    const state = cols[10];
    if (!state) continue;
    const lat = parseFloat(cols[4]);
    const lon = parseFloat(cols[5]);
    const dem = parseInt(cols[16], 10);
    candidates.push({
      geonameid: cols[0],
      name: cols[2] || cols[1], // asciiname, fallback to name
      state,
      lat,
      lon,
      population,
      elevation: Number.isNaN(dem) ? null : dem,
    });
  }

  candidates.sort((a, b) => b.population - a.population);

  const selected = new Map(); // geonameid -> candidate
  for (let i = 0; i < Math.min(TARGET_CITY_COUNT, candidates.length); i++) {
    selected.set(candidates[i].geonameid, candidates[i]);
  }

  // top up states below MIN_CITIES_PER_STATE
  const byState = new Map();
  for (const c of candidates) {
    if (!byState.has(c.state)) byState.set(c.state, []);
    byState.get(c.state).push(c);
  }
  const countInSelected = (state) =>
    [...selected.values()].filter((c) => c.state === state).length;

  for (const [state, list] of byState) {
    let count = countInSelected(state);
    if (count >= MIN_CITIES_PER_STATE) continue;
    for (const c of list) {
      if (count >= MIN_CITIES_PER_STATE) break;
      if (!selected.has(c.geonameid)) {
        selected.set(c.geonameid, c);
        count++;
      }
    }
  }

  return { cities: [...selected.values()], totalCandidates: candidates.length };
}

// ---------- Step 4: join cities to nearest valid station ----------
function joinCitiesToStations(cities, stationList) {
  const matched = [];
  const dropped = [];
  const distances = [];

  for (const city of cities) {
    const withDist = stationList.map((s) => ({
      station: s,
      distance: haversineKm(city.lat, city.lon, s.lat, s.lon),
    }));
    withDist.sort((a, b) => a.distance - b.distance);

    let chosen = null;
    for (const cand of withDist) {
      if (cand.distance > MAX_DISTANCE_KM) break; // sorted ascending, no closer ones left
      if (
        city.elevation !== null &&
        cand.station.elevation !== null &&
        Math.abs(city.elevation - cand.station.elevation) > MAX_ELEVATION_DELTA_M
      ) {
        continue; // try next nearest
      }
      chosen = cand;
      break;
    }

    if (!chosen) {
      dropped.push({ city, reason: "no station within 80km/400m elevation" });
      continue;
    }

    distances.push(chosen.distance);
    matched.push({ city, station: chosen.station, distance: chosen.distance });
  }

  return { matched, dropped, distances };
}

// ---------- report helpers ----------
function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

function fmtDate(iso) {
  if (!iso) return "n/a";
  const [, m, d] = iso.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

// spot-check: known city name/state -> expected last-spring-frost P50 window (month/day pairs)
// or 'frostFree' or 'rare' (very early/mild, treated loosely).
const SPOT_CHECKS = [
  { name: "Chicago", state: "IL", type: "range", from: [3, 25], to: [5, 10], desc: "last spring frost ~Mar 25-May 10" },
  { name: "Miami", state: "FL", type: "frostFree", desc: "frost-free" },
  { name: "Denver", state: "CO", type: "range", from: [4, 15], to: [5, 20], desc: "last spring frost ~Apr 15-May 20" },
  { name: "Phoenix", state: "AZ", type: "rare", desc: "rare/very early frost" },
  { name: "Seattle", state: "WA", type: "range", from: [2, 15], to: [4, 15], desc: "last spring frost ~Feb 15-Apr 15" },
  { name: "New York City", state: "NY", type: "range", from: [3, 20], to: [5, 5], desc: "last spring frost ~Mar 20-May 5" },
  { name: "Los Angeles", state: "CA", type: "rare", desc: "rare/very early frost" },
  { name: "Minneapolis", state: "MN", type: "range", from: [4, 1], to: [5, 20], desc: "last spring frost ~Apr 1-May 20" },
  { name: "Atlanta", state: "GA", type: "range", from: [3, 1], to: [4, 15], desc: "last spring frost ~Mar 1-Apr 15" },
  { name: "Anchorage", state: "AK", type: "range", from: [4, 15], to: [6, 10], desc: "last spring frost ~Apr 15-Jun 10" },
];

function monthDayInRange(month, day, from, to) {
  const val = month * 100 + day;
  const fromVal = from[0] * 100 + from[1];
  const toVal = to[0] * 100 + to[1];
  return val >= fromVal && val <= toVal;
}

function runSpotChecks(records) {
  const results = [];
  for (const check of SPOT_CHECKS) {
    const rec = records.find(
      (r) => r.city.name.toLowerCase() === check.name.toLowerCase() && r.city.state === check.state
    );
    if (!rec) {
      results.push({ ...check, pass: false, actual: "NOT FOUND (no matching city record)" });
      continue;
    }
    if (check.type === "frostFree") {
      const pass = rec.frostFree === true;
      results.push({ ...check, pass, actual: rec.frostFree ? "frostFree" : `has frost data (station ${rec.station.id})` });
      continue;
    }
    if (rec.frostFree) {
      // frostFree also satisfies "rare"/very mild expectations
      const pass = check.type === "rare";
      results.push({ ...check, pass, actual: "frostFree" });
      continue;
    }
    const p50 = rec.lastSpringFrost.p50;
    if (!p50) {
      results.push({ ...check, pass: false, actual: "no p50 value" });
      continue;
    }
    const [, mm, dd] = p50.split("-").map((v) => parseInt(v, 10));
    if (check.type === "rare") {
      // "rare" = frost-free OR last frost date very early (Jan/early Feb) -- treat as PASS if
      // last spring frost falls on/before Feb 15 (i.e. frost is essentially a non-event).
      const pass = monthDayInRange(mm, dd, [1, 1], [2, 15]);
      results.push({ ...check, pass, actual: `${fmtDate(p50)} (station ${rec.station.id}, ${rec.distance.toFixed(1)}km)` });
      continue;
    }
    const pass = monthDayInRange(mm, dd, check.from, check.to);
    results.push({ ...check, pass, actual: `${fmtDate(p50)} (station ${rec.station.id}, ${rec.distance.toFixed(1)}km)` });
  }
  return results;
}

// ---------- main ----------
async function main() {
  console.log("Parsing annual (frost) station CSVs...");
  const { stations: annualStations, stats: annualStats } = parseAnnualStations();
  console.log(`  ${annualStations.size} usable stations (valid=${annualStats.validCount}, frostFree=${annualStats.frostFreeCount})`);

  console.log("Parsing monthly station CSVs for matched stations...");
  const { monthly, found: monthlyFound } = parseMonthlyStations(annualStations.keys());
  console.log(`  monthly data found for ${monthlyFound} stations`);

  console.log("Parsing GeoNames US cities...");
  const { cities, totalCandidates } = await parseGeonamesCities();
  console.log(`  ${totalCandidates} candidate populated places (population>0), selected ${cities.length} cities`);

  console.log("Joining cities to nearest valid station...");
  const stationList = [...annualStations.values()];
  const { matched, dropped, distances } = joinCitiesToStations(cities, stationList);
  console.log(`  matched=${matched.length} dropped=${dropped.length}`);

  // build output records
  const records = matched.map(({ city, station, distance }) => {
    const monthlyData = monthly.get(station.id) || null;
    return {
      name: city.name,
      state: city.state,
      slug: slugify(city.name),
      stateSlug: slugify(city.state),
      lat: city.lat,
      lon: city.lon,
      population: city.population,
      elevation: city.elevation,
      frostFree: station.frostFree,
      lastSpringFrost: station.frostFree ? null : station.frost.lastSpringFrost,
      firstFallFrost: station.frostFree ? null : station.frost.firstFallFrost,
      growingSeasonDays: station.frostFree ? null : station.frost.growingSeasonDays,
      monthly: monthlyData,
      station: {
        id: station.id,
        name: station.name,
        lat: station.lat,
        lon: station.lon,
        elevation: station.elevation,
        distanceKm: Math.round(distance * 10) / 10,
      },
    };
  });

  // dedupe: two cities occasionally share name+state (rare) - keep as-is, downstream can handle.
  fs.writeFileSync(OUT_JSON, JSON.stringify(records, null, 2));
  console.log(`Wrote ${records.length} records to ${OUT_JSON}`);

  // ---------- report ----------
  const sortedDist = [...distances].sort((a, b) => a - b);
  const stateCounts = new Map();
  for (const r of records) {
    stateCounts.set(r.state, (stateCounts.get(r.state) || 0) + 1);
  }
  const statesBelowMin = [...stateCounts.entries()].filter(([, c]) => c < MIN_CITIES_PER_STATE);

  const frostFreeCities = records.filter((r) => r.frostFree).length;

  // spot checks need the "flat" shape used above (rec.frostFree, rec.lastSpringFrost, etc.)
  const spotCheckRecords = records.map((r) => ({
    city: { name: r.name, state: r.state },
    frostFree: r.frostFree,
    lastSpringFrost: r.lastSpringFrost,
    station: r.station,
    distance: r.station.distanceKm,
  }));
  const spotResults = runSpotChecks(spotCheckRecords);

  const distBuckets = [
    ["0-10km", (d) => d <= 10],
    ["10-30km", (d) => d > 10 && d <= 30],
    ["30-50km", (d) => d > 30 && d <= 50],
    ["50-80km", (d) => d > 50 && d <= 80],
  ];

  const lines = [];
  lines.push("FrostCal Phase 1 pipeline report");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("=== Source data ===");
  lines.push(`NOAA annual/seasonal by-station CSVs: ${annualStats.totalFiles} files scanned`);
  lines.push(`  usable stations (has 32F/P50 columns): ${annualStations.size}`);
  lines.push(`  of which valid frost data: ${annualStats.validCount}`);
  lines.push(`  of which frost-free (sentinel -9999, e.g. HI/southern FL): ${annualStats.frostFreeCount}`);
  lines.push(`  discarded (missing 32F/P50 values or no such columns): ${annualStats.noColumn + annualStats.missingP50}`);
  lines.push(`NOAA monthly by-station CSVs: monthly TMIN/TAVG/TMAX found for ${monthlyFound} of ${annualStations.size} stations`);
  lines.push(`GeoNames candidate populated places (feature class P, population>0): ${totalCandidates}`);
  lines.push("");
  lines.push("=== City selection + join ===");
  lines.push(`Cities selected from GeoNames (top ~${TARGET_CITY_COUNT}, topped up so every state has >= ${MIN_CITIES_PER_STATE}): ${cities.length}`);
  lines.push(`Cities matched to a valid station: ${matched.length}`);
  lines.push(`Cities dropped (no station within ${MAX_DISTANCE_KM}km / ${MAX_ELEVATION_DELTA_M}m elevation delta): ${dropped.length}`);
  lines.push(`Frost-free cities in final output: ${frostFreeCities}`);
  lines.push("");
  lines.push("=== Distance distribution (matched cities, km to station) ===");
  if (sortedDist.length) {
    lines.push(`  min=${sortedDist[0].toFixed(1)} p25=${percentile(sortedDist, 25).toFixed(1)} median=${percentile(sortedDist, 50).toFixed(1)} p75=${percentile(sortedDist, 75).toFixed(1)} p90=${percentile(sortedDist, 90).toFixed(1)} max=${sortedDist[sortedDist.length - 1].toFixed(1)}`);
    for (const [label, pred] of distBuckets) {
      const n = sortedDist.filter(pred).length;
      lines.push(`  ${label}: ${n} (${((n / sortedDist.length) * 100).toFixed(1)}%)`);
    }
  }
  lines.push("");
  lines.push("=== Per-state city counts ===");
  for (const [state, count] of [...stateCounts.entries()].sort()) {
    lines.push(`  ${state}: ${count}`);
  }
  if (statesBelowMin.length) {
    lines.push(`  WARNING: states below minimum (${MIN_CITIES_PER_STATE}): ${statesBelowMin.map(([s, c]) => `${s}=${c}`).join(", ")}`);
  } else {
    lines.push(`  All states have >= ${MIN_CITIES_PER_STATE} cities.`);
  }
  lines.push("");
  lines.push("=== Spot checks (10 known cities) ===");
  let allPass = true;
  for (const r of spotResults) {
    if (!r.pass) allPass = false;
    lines.push(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}, ${r.state} -- expected ${r.desc}; actual: ${r.actual}`);
  }
  lines.push("");
  lines.push(`Overall spot-check result: ${allPass ? "ALL PASS" : "SOME FAILED"}`);
  lines.push("");
  lines.push("=== Acceptance criteria ===");
  lines.push(`  >= 4500 cities matched: ${matched.length >= 4500 ? "PASS" : "FAIL"} (${matched.length})`);
  lines.push(`  Spot checks pass: ${allPass ? "PASS" : "FAIL"}`);
  lines.push(`  Report written: PASS (this file)`);

  fs.writeFileSync(OUT_REPORT, lines.join("\n") + "\n");
  console.log(`Wrote report to ${OUT_REPORT}`);
  console.log(lines.slice(-6).join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
