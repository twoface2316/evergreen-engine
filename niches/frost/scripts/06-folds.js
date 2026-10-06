'use strict';

/**
 * niches/frost/scripts/06-folds.js — find neighborhood-level GeoNames
 * entries and the city each one belongs to, writing data/folds.json.
 *
 * GeoNames tags city sections (Harlem, Koreatown, Logan Square) as feature
 * code PPLX. As standalone "city" pages they near-duplicate their parent
 * city, so render.js turns them into redirects to the parent instead.
 *
 * A PPLX entry is folded when:
 *   - its name is NOT a USPS mailing-city name in its state (Belton, MO,
 *     Van Nuys and Astoria are real mailing places and keep their pages), and
 *   - a larger non-PPLX city in the same state lies within 30 km; the most
 *     populous such city becomes the parent.
 *
 * Inputs (raw, gitignored): data/raw/geonames/US.txt, data/raw/postal/US.txt
 * (unzipped from data/raw/geonames-postal-US.zip). Output (committed):
 * data/folds.json, { "<cityKey>": "<parentCityKey>" } where cityKey is
 * "<stateSlug>/<slug>@<lat to 3dp>" on the original, pre-disambiguation slugs.
 *
 * Run: node niches/frost/scripts/06-folds.js
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const FOLD_RADIUS_KM = 30;

function cityKey(c) {
  return `${c.stateSlug}/${c.slug}@${Number(c.lat).toFixed(3)}`;
}

function haversineKm(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function main() {
  const cities = JSON.parse(fs.readFileSync(path.join(dataDir, 'cities-frost.json'), 'utf8'));

  const featureCode = new Map();
  for (const line of fs.readFileSync(path.join(dataDir, 'raw', 'geonames', 'US.txt'), 'utf8').split('\n')) {
    const c = line.split('\t');
    if (c[6] === 'P') featureCode.set(`${c[1]}|${c[10]}|${(+c[4]).toFixed(3)}`, c[7]);
  }
  const codeOf = (c) => featureCode.get(`${c.name}|${c.state}|${Number(c.lat).toFixed(3)}`) || null;

  const postalPlaces = new Set();
  for (const line of fs.readFileSync(path.join(dataDir, 'raw', 'postal', 'US.txt'), 'utf8').split('\n')) {
    const c = line.split('\t');
    if (c[2]) postalPlaces.add(`${c[2].toLowerCase()}|${c[4]}`);
  }

  const candidates = cities.filter((c) => codeOf(c) === 'PPLX');
  const parents = cities.filter((c) => codeOf(c) !== 'PPLX');
  const folds = {};
  let keptPostal = 0;
  let keptNoParent = 0;

  for (const c of candidates) {
    if (postalPlaces.has(`${c.name.toLowerCase()}|${c.state}`)) { keptPostal++; continue; }
    let parent = null;
    for (const p of parents) {
      if (p.state !== c.state || (p.population || 0) <= (c.population || 0)) continue;
      if (haversineKm(c, p) > FOLD_RADIUS_KM) continue;
      if (!parent || (p.population || 0) > (parent.population || 0)) parent = p;
    }
    if (!parent) { keptNoParent++; continue; }
    folds[cityKey(c)] = cityKey(parent);
  }

  fs.writeFileSync(path.join(dataDir, 'folds.json'), JSON.stringify(folds, null, 1) + '\n', 'utf8');
  console.log(`PPLX entries: ${candidates.length}`);
  console.log(`  folded into a parent city: ${Object.keys(folds).length}`);
  console.log(`  kept (USPS mailing-city name): ${keptPostal}`);
  console.log(`  kept (no larger city within ${FOLD_RADIUS_KM} km): ${keptNoParent}`);
  console.log('Wrote data/folds.json');
}

if (require.main === module) main();

module.exports = { cityKey };
