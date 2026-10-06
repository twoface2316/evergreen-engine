'use strict';

/**
 * niches/home/scripts/01-cities.js — city list (shared with the solar niche:
 * GeoNames places, neighborhoods folded, slugs disambiguated) plus each
 * place's county, from the GeoNames admin2 (county FIPS) code and EPA's
 * ANSI area reference table for the county name.
 *
 * Places GeoNames leaves without a usable county (Connecticut, which now
 * codes planning regions instead of the 8 counties EPA still uses; DC;
 * Hawaii; New York City) fall back to point-in-polygon against pre-2022
 * Census county boundaries.
 *
 * Needs niches/frost/data/raw/geonames/US.txt,
 * niches/home/data/raw/SDWA_REF_ANSI_AREAS.csv (from the EPA SDWA download) and
 * niches/home/data/raw/counties-fips.geojson
 * (https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json).
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

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** County FIPS (5 digits) containing the point, or null. Holes ignored: counties have none that matter here. */
function countyAt(features, lon, lat) {
  for (const f of features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (polys.some((p) => pointInRing(lon, lat, p[0]))) return f.id;
  }
  return null;
}

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

  const features = JSON.parse(fs.readFileSync(path.join(DATA, 'raw', 'counties-fips.geojson'), 'utf8')).features;
  let viaPolygon = 0;
  for (const c of cities) {
    if (c.countyFips && countyName.has(`${c.state}|${c.countyFips}`)) continue;
    const fips = countyAt(features, c.lon, c.lat);
    c.countyFips = fips ? fips.slice(2) : null;
    if (fips) viaPolygon++;
  }

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
  console.log(`cities.json: ${out.length} cities, ${withCounty} with county (${viaPolygon} via boundaries); missing e.g. ${missing.slice(0, 8).map((c) => `${c.name} ${c.state}`).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
