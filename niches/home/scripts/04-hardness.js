'use strict';

/**
 * niches/home/scripts/04-hardness.js — water hardness per city from the
 * TapWaterData US Water Hardness Dataset (CC BY 4.0,
 * https://www.tapwaterdata.com/water-hardness), saved to
 * data/raw/water-hardness.csv. Joined by name + state, else the nearest
 * dataset city in the same state within 8 km.
 *
 *   node niches/home/scripts/04-hardness.js
 */

const fs = require('fs');
const path = require('path');
const { streamCsv } = require('./csv.js');

const DATA = path.join(__dirname, '..', 'data');

function km(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function main() {
  const rows = [];
  await streamCsv(path.join(DATA, 'raw', 'water-hardness.csv'), (r) => {
    const mgL = Number(r.hardness_mg_l);
    if (!Number.isFinite(mgL)) return;
    rows.push({
      name: r.city,
      state: r.stateCode,
      lat: Number(r.lat),
      lon: Number(r.lng),
      mgL,
      category: r.category,
      tier: r.tier,
      source: r.source,
      sourceDate: r.sourceDate,
      disputed: r.disputed === 'true'
    });
  });
  const byName = new Map(rows.map((r) => [`${r.name.toLowerCase()}|${r.state}`, r]));
  const byState = new Map();
  for (const r of rows) {
    if (!byState.has(r.state)) byState.set(r.state, []);
    byState.get(r.state).push(r);
  }

  const cities = JSON.parse(fs.readFileSync(path.join(DATA, 'cities.json'), 'utf8'));
  const out = {};
  let exact = 0;
  let near = 0;
  for (const c of cities) {
    let r = byName.get(`${c.name.toLowerCase()}|${c.state}`);
    let match = 'name';
    if (!r) {
      let best = null;
      for (const o of byState.get(c.state) || []) {
        const d = km(c, o);
        if (d <= 8 && (!best || d < best.d)) best = { o, d };
      }
      if (best) {
        r = best.o;
        match = `near:${best.d.toFixed(1)}`;
      }
    }
    if (!r) continue;
    match === 'name' ? exact++ : near++;
    out[`${c.stateSlug}/${c.slug}`] = {
      mgL: r.mgL,
      category: r.category,
      tier: r.tier,
      source: r.source,
      sourceDate: r.sourceDate,
      disputed: r.disputed,
      matchedCity: r.name === c.name ? undefined : r.name
    };
  }
  fs.writeFileSync(path.join(DATA, 'hardness.json'), JSON.stringify(out) + '\n');
  const tiers = Object.values(out).reduce((m, v) => ((m[v.tier] = (m[v.tier] || 0) + 1), m), {});
  console.log(`hardness.json: ${exact + near}/${cities.length} cities (${exact} by name, ${near} nearest within 8 km); tiers ${JSON.stringify(tiers)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
