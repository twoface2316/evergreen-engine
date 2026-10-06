'use strict';

/**
 * niches/solar/scripts/02-cities.js — city list for the solar niche, taken
 * from the frost niche's GeoNames-derived list (5,078 US places) minus the
 * neighborhoods frost folds into their parent city (data/folds.json there).
 * Writes a slim data/cities.json; rerun only if the frost list changes.
 *
 *   node niches/solar/scripts/02-cities.js
 */

const fs = require('fs');
const path = require('path');

const FROST = path.join(__dirname, '..', '..', 'frost', 'data');
const OUT = path.join(__dirname, '..', 'data', 'cities.json');

const cities = JSON.parse(fs.readFileSync(path.join(FROST, 'cities-frost.json'), 'utf8'));
const folds = JSON.parse(fs.readFileSync(path.join(FROST, 'folds.json'), 'utf8'));

// Same key format as niches/frost/scripts/06-folds.js cityKey().
const foldKey = (c) => `${c.stateSlug}/${c.slug}@${Number(c.lat).toFixed(3)}`;

const kept = cities
  .filter((c) => !folds[foldKey(c)])
  .map((c) => ({
    name: c.name,
    state: c.state,
    slug: c.slug,
    stateSlug: c.stateSlug,
    lat: c.lat,
    lon: c.lon,
    population: c.population
  }));

// Same-name places within a state (two "Vincent, CA") would share a URL.
// Larger place keeps the bare slug; the rest get -2, -3, ...
kept.sort((a, b) => (b.population || 0) - (a.population || 0));
const seen = new Map();
for (const c of kept) {
  const k = `${c.stateSlug}/${c.slug}`;
  const n = (seen.get(k) || 0) + 1;
  seen.set(k, n);
  if (n > 1) c.slug = `${c.slug}-${n}`;
}

fs.writeFileSync(OUT, JSON.stringify(kept) + '\n');
console.log(`cities.json: ${kept.length} cities (${cities.length - kept.length} folded neighborhoods dropped)`);
