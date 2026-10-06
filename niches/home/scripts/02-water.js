'use strict';

/**
 * niches/home/scripts/02-water.js — each city's drinking-water utilities,
 * their Safe Drinking Water Act violations and lead/copper results, from
 * EPA's SDWIS data via the ECHO bulk download
 * (https://echo.epa.gov/files/echodownloads/SDWA_latest_downloads.zip,
 * unzipped into data/raw/).
 *
 * Matching, first that finds anything: active community water systems
 * (PWS_TYPE_CODE CWS) whose geographic-area records list the city as
 * served; systems whose name contains the city's name ("CITY OF X", "X
 * WATER DEPT"); systems with a mailing address in the city. Name and
 * address matches need >= MIN_FALLBACK_POP people served, so a trailer
 * park with a city mailing address can't stand in for the city utility.
 * NYC's five boroughs map to the city system by county. Largest system by
 * population is the city's primary utility; up to four more are listed.
 *
 * Writes data/water.json:
 *   { cities: { "<stateSlug>/<slug>": [pwsid, ...] },
 *     systems: { pwsid: { name, pop, source, owner, violations, lead, copper } },
 *     asOf, windowStart }
 *
 *   node niches/home/scripts/02-water.js     # ~10 min (4 GB violations file)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { streamCsv, parseLine } = require('./csv.js');

const DATA = path.join(__dirname, '..', 'data');
const RAW = path.join(DATA, 'raw');
// Violations whose non-compliance began on/after this date are reported.
const WINDOW_START = '2016-01-01';
const MAX_SYSTEMS_PER_CITY = 5;
const MAX_LISTED_VIOLATIONS = 25;
const MIN_FALLBACK_POP = 1000;
// Bronx, Kings, New York, Queens, Richmond counties -> NEW YORK CITY SYSTEM.
const NYC_COUNTIES = new Set(['36005', '36047', '36061', '36081', '36085']);
const NYC_PWSID = 'NY7003493';

const norm = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bfort\b/g, 'ft')
    .replace(/\bmount\b/g, 'mt')
    .replace(/[^a-z0-9]/g, '');

/** "MM/DD/YYYY" -> "YYYY-MM-DD" (or null). */
function isoDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

async function main() {
  const t0 = Date.now();
  const lap = (msg) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${msg}`);

  // Code lookups.
  const contaminant = {};
  const violationCode = {};
  await streamCsv(path.join(RAW, 'SDWA_REF_CODE_VALUES.csv'), (r) => {
    if (r.VALUE_TYPE === 'CONTAMINANT_CODE') contaminant[r.VALUE_CODE] = r.VALUE_DESCRIPTION;
    if (r.VALUE_TYPE === 'VIOLATION_CODE') violationCode[r.VALUE_CODE] = r.VALUE_DESCRIPTION;
  });

  // Active community water systems.
  const systems = new Map();
  let asOf = null;
  await streamCsv(path.join(RAW, 'SDWA_PUB_WATER_SYSTEMS.csv'), (r) => {
    asOf = asOf || r.SUBMISSIONYEARQUARTER;
    if (r.PWS_TYPE_CODE !== 'CWS' || r.PWS_ACTIVITY_CODE !== 'A') return;
    systems.set(r.PWSID, {
      name: r.PWS_NAME,
      pop: Number(r.POPULATION_SERVED_COUNT) || 0,
      source: r.PRIMARY_SOURCE_CODE || r.GW_SW_CODE || null,
      owner: r.OWNER_TYPE_CODE || null,
      // Regulating state; STATE_CODE is the mailing address and can be out of state.
      state: /^[A-Z]{2}$/.test(r.PRIMACY_AGENCY_CODE) ? r.PRIMACY_AGENCY_CODE : r.STATE_CODE,
      tokens: ` ${(r.PWS_NAME || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `,
      city: r.CITY_NAME
    });
  });
  lap(`${systems.size} active community water systems`);

  // City -> systems that serve it.
  const served = new Map(); // "norm(city)|ST" -> Set(pwsid)
  const add = (k, id) => {
    if (!served.has(k)) served.set(k, new Set());
    served.get(k).add(id);
  };
  await streamCsv(path.join(RAW, 'SDWA_GEOGRAPHIC_AREAS.csv'), (r) => {
    if (r.AREA_TYPE_CODE !== 'CT' || !r.CITY_SERVED) return;
    const s = systems.get(r.PWSID);
    if (s) add(`${norm(r.CITY_SERVED)}|${s.state}`, r.PWSID);
  });
  const byAddress = new Map();
  const byState = new Map();
  for (const [id, s] of systems) {
    if (s.pop < MIN_FALLBACK_POP) continue;
    const k = `${norm(s.city)}|${s.state}`;
    if (!byAddress.has(k)) byAddress.set(k, new Set());
    byAddress.get(k).add(id);
    if (!byState.has(s.state)) byState.set(s.state, []);
    byState.get(s.state).push(id);
  }
  /** Systems in the state whose name contains the city name as whole words. */
  const byName = (c) => {
    const needle = ` ${c.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    if (needle.length < 6) return null;
    return new Set((byState.get(c.state) || []).filter((id) => systems.get(id).tokens.includes(needle)));
  };

  const cities = JSON.parse(fs.readFileSync(path.join(DATA, 'cities.json'), 'utf8'));
  const cityMap = {};
  const via = { served: 0, name: 0, address: 0, nyc: 0 };
  for (const c of cities) {
    const k = `${norm(c.name)}|${c.state}`;
    let ids = null;
    const tries = [
      ['nyc', () => (NYC_COUNTIES.has(c.countyFips) && systems.has(NYC_PWSID) ? new Set([NYC_PWSID]) : null)],
      ['served', () => served.get(k)],
      ['name', () => byName(c)],
      ['address', () => byAddress.get(k)]
    ];
    for (const [how, fn] of tries) {
      ids = fn();
      if (ids && ids.size) {
        via[how]++;
        break;
      }
    }
    if (!ids || !ids.size) continue;
    cityMap[`${c.stateSlug}/${c.slug}`] = [...ids]
      .sort((a, b) => systems.get(b).pop - systems.get(a).pop)
      .slice(0, MAX_SYSTEMS_PER_CITY);
  }
  const wanted = new Set(Object.values(cityMap).flat());
  const matched = Object.values(via).reduce((a, b) => a + b, 0);
  lap(`cities matched: ${JSON.stringify(via)}, ${cities.length - matched} unmatched; ${wanted.size} systems kept`);

  // Violations (one row per violation x enforcement action; dedupe by VIOLATION_ID).
  const viol = new Map(); // pwsid -> Map(violationId -> record)
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(RAW, 'SDWA_VIOLATIONS_ENFORCEMENT.csv'), { encoding: 'utf8' }), crlfDelay: Infinity });
  let header = null;
  let lines = 0;
  for await (const line of rl) {
    if (!header) {
      header = parseLine(line);
      continue;
    }
    if (++lines % 5e6 === 0) lap(`violations: ${lines / 1e6}M rows`);
    // Cheap PWSID pre-check before a full parse: second quoted field.
    const a = line.indexOf('","');
    const b = line.indexOf('"', a + 3);
    if (!wanted.has(line.slice(a + 3, b))) continue;
    const v = parseLine(line);
    const r = {};
    for (let i = 0; i < header.length; i++) r[header[i]] = v[i];
    const begin = isoDate(r.NON_COMPL_PER_BEGIN_DATE) || isoDate(r.COMPL_PER_BEGIN_DATE);
    if (!begin || begin < WINDOW_START) continue;
    if (!viol.has(r.PWSID)) viol.set(r.PWSID, new Map());
    const m = viol.get(r.PWSID);
    if (m.has(r.VIOLATION_ID)) continue;
    m.set(r.VIOLATION_ID, {
      begin,
      end: isoDate(r.NON_COMPL_PER_END_DATE) || isoDate(r.COMPL_PER_END_DATE),
      category: r.VIOLATION_CATEGORY_CODE,
      health: r.IS_HEALTH_BASED_IND === 'Y',
      contaminant: contaminant[r.CONTAMINANT_CODE] || r.CONTAMINANT_CODE,
      type: violationCode[r.VIOLATION_CODE] || r.VIOLATION_CODE,
      measure: r.VIOL_MEASURE ? `${r.VIOL_MEASURE} ${r.UNIT_OF_MEASURE}`.trim() : null,
      limit: r.FEDERAL_MCL || r.STATE_MCL || null,
      status: r.VIOLATION_STATUS
    });
  }
  lap(`violations scanned: ${lines} rows`);

  // Lead and copper 90th-percentile results (PB90 / CU90), most recent first.
  const lcr = new Map(); // pwsid -> { PB90: [], CU90: [] }
  await streamCsv(path.join(RAW, 'SDWA_LCR_SAMPLES.csv'), (r) => {
    if (!wanted.has(r.PWSID) || (r.CONTAMINANT_CODE !== 'PB90' && r.CONTAMINANT_CODE !== 'CU90')) return;
    const end = isoDate(r.SAMPLING_END_DATE);
    const val = Number(r.SAMPLE_MEASURE);
    if (!end || !Number.isFinite(val)) return;
    // Normalize to mg/L.
    const mgL = /ug/i.test(r.UNIT_OF_MEASURE) ? val / 1000 : val;
    if (!lcr.has(r.PWSID)) lcr.set(r.PWSID, { PB90: [], CU90: [] });
    lcr.get(r.PWSID)[r.CONTAMINANT_CODE].push({ end, mgL });
  });
  lap('lead/copper scanned');

  const out = { asOf, windowStart: WINDOW_START, cities: cityMap, systems: {} };
  for (const id of wanted) {
    const s = systems.get(id);
    const list = [...(viol.get(id) || new Map()).values()].sort((x, y) => (x.begin < y.begin ? 1 : -1));
    const byCat = {};
    for (const v of list) byCat[v.category] = (byCat[v.category] || 0) + 1;
    const health = list.filter((v) => v.health);
    const samples = lcr.get(id) || { PB90: [], CU90: [] };
    const latest = (arr) => {
      const sorted = [...arr].sort((x, y) => (x.end < y.end ? 1 : -1));
      return sorted.length ? { mgL: sorted[0].mgL, date: sorted[0].end, history: sorted.slice(0, 5).map((x) => [x.end, x.mgL]) } : null;
    };
    out.systems[id] = {
      name: s.name,
      pop: s.pop,
      source: s.source,
      owner: s.owner,
      violations: {
        total: list.length,
        healthBased: health.length,
        open: list.filter((v) => !/Resolved|Archived/i.test(v.status || '')).length,
        byCategory: byCat,
        // Health-based first (they matter most), then the rest, newest first.
        list: [...health, ...list.filter((v) => !v.health)].slice(0, MAX_LISTED_VIOLATIONS)
      },
      lead: latest(samples.PB90),
      copper: latest(samples.CU90)
    };
  }
  fs.writeFileSync(path.join(DATA, 'water.json'), JSON.stringify(out) + '\n');
  const sys = Object.values(out.systems);
  lap(`water.json: ${Object.keys(cityMap).length} cities, ${sys.length} systems, ${sys.filter((x) => x.violations.healthBased).length} with health-based violations since ${WINDOW_START}, ${sys.filter((x) => x.lead).length} with lead results`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
