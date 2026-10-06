'use strict';

/**
 * niches/home/scripts/03-radon.js — EPA Map of Radon Zones, joined to each
 * city's county. Zone 1: predicted average indoor radon > 4 pCi/L; zone 2:
 * 2-4; zone 3: < 2. Source JSON: https://www.epa.gov/radon/epa-map-radon-zones-0
 * (saved to data/raw/radon-zones.json).
 *
 *   node niches/home/scripts/03-radon.js
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');

/** "St. Louis city" / "Saint Louis" / "DeKalb" -> comparable key. */
function norm(s) {
  return s
    .toLowerCase()
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bste\b/g, 'st')
    .replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/g, '')
    .replace(/[^a-z]/g, '');
}

const raw = JSON.parse(fs.readFileSync(path.join(DATA, 'raw', 'radon-zones.json'), 'utf8').replace(/^﻿/, '')).data;
const zones = new Map();
for (const r of raw) {
  if (!/^[123]$/.test(r.Zone)) continue;
  if (r['County,State'] === 'District of Columbia') {
    zones.set('districtofcolumbia|DC', { zone: Number(r.Zone), label: 'District of Columbia' });
    continue;
  }
  const m = /^(.*), ([A-Z]{2})$/.exec(r['County,State']);
  if (!m) continue;
  // Virginia's independent cities are listed as "Norfolk, VA" with STATE
  // "VA-CITY"; EPA's ANSI table calls them "Norfolk city".
  const name = r.STATE === 'VA-CITY' ? `${m[1]} city` : m[1];
  const label = r.STATE === 'VA-CITY' ? `City of ${m[1]}` : r['COUNTY LABEL'];
  zones.set(`${norm(name)}|${m[2]}`, { zone: Number(r.Zone), label });
}

const cities = JSON.parse(fs.readFileSync(path.join(DATA, 'cities.json'), 'utf8'));
const out = {};
const unmatched = new Set();
for (const c of cities) {
  if (!c.county) continue;
  const z = zones.get(`${norm(c.county)}|${c.state}`) || zones.get(`${norm(c.county + ' city')}|${c.state}`);
  if (z) out[c.countyFips] = { zone: z.zone, county: z.label };
  else unmatched.add(`${c.county}, ${c.state}`);
}
fs.writeFileSync(path.join(DATA, 'radon.json'), JSON.stringify(out) + '\n');
const covered = cities.filter((c) => out[c.countyFips]).length;
console.log(`radon.json: ${Object.keys(out).length} counties; ${covered}/${cities.length} cities covered; unmatched counties: ${[...unmatched].slice(0, 15).join('; ')}`);
