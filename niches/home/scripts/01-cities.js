'use strict';

/**
 * niches/home/scripts/01-cities.js — city list (shared with the solar niche:
 * GeoNames places, neighborhoods folded, slugs disambiguated) plus each
 * place's county, from the GeoNames admin2 (county FIPS) code and EPA's
 * ANSI area reference table for the county name.
 *
 * Needs niches/frost/data/raw/geonames/US.txt and
 * niches/home/data/raw/SDWA_REF_ANSI_AREAS.csv (from the EPA SDWA download).
 *
 *   node niches/home/scripts/01-cities.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { streamCsv } = require('./csv.js');

const DATA = path.join(__dirname, '..', 'data');
const GEONAMES = path.join(__dirname, '..', '..', 'frost', 'data', 'raw', 'geonames', 'US.txt');
const SOLAR_CITIES = path.join(__dirname, '..', '..', 'solar', 'data', 'cities.json');

async function main() {
  const cities = JSON.parse(fs.readFileSync(SOLAR_CITIES, 'utf8'));
  const want = new Map();
  for (const c of cities) {
    const k = `${c.name}|${c.state}`;
    if (!want.has(k)) want.set(k, []);
    want.get(k).push(c);
  }

  // GeoNames: name, admin1 (state), admin2 (county FIPS) for populated places.
  const rl = readline.createInterface({ input: fs.createReadStream(GEONAMES, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const f = line.split('\t');
    if (f[6] !== 'P') continue;
    const list = want.get(`${f[1]}|${f[10]}`);
    if (!list) continue;
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    for (const c of list) {
      if (!c.countyFips && Math.abs(c.lat - lat) < 0.002 && Math.abs(c.lon - lon) < 0.002 && f[11]) c.countyFips = f[11];
    }
  }

  const countyName = new Map();
  await streamCsv(path.join(DATA, 'raw', 'SDWA_REF_ANSI_AREAS.csv'), (r) => {
    countyName.set(`${r.STATE_CODE}|${r.ANSI_ENTITY_CODE}`, { name: r.ANSI_NAME, stateFips: r.ANSI_STATE_CODE });
  });

  let withCounty = 0;
  const out = cities.map((c) => {
    const cn = c.countyFips ? countyName.get(`${c.state}|${c.countyFips}`) : null;
    if (cn) withCounty++;
    return {
      ...c,
      county: cn ? cn.name : null,
      countyFips: cn ? `${cn.stateFips}${c.countyFips}` : null
    };
  });
  fs.writeFileSync(path.join(DATA, 'cities.json'), JSON.stringify(out) + '\n');
  const missing = out.filter((c) => !c.county);
  console.log(`cities.json: ${out.length} cities, ${withCounty} with county; missing e.g. ${missing.slice(0, 8).map((c) => `${c.name} ${c.state}`).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
