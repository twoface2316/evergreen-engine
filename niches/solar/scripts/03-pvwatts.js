'use strict';

/**
 * niches/solar/scripts/03-pvwatts.js — per-city solar production from the
 * PVWatts v8 API (NREL, now the National Laboratory of the Rockies):
 * one 1 kW-DC reference run per city, cached to data/pvwatts.json so builds
 * never call the API. Resumable: cities already in the cache are skipped.
 *
 * API key: NREL_API_KEY env var (free, developer.nlr.gov/signup). Without
 * it, falls back to DEMO_KEY (10 requests/hour) — enough for `sample`.
 * A real key allows 1,000/hour; when the hourly budget runs out the script
 * waits for it to reset.
 *
 *   node niches/solar/scripts/03-pvwatts.js sample   # 5 sample cities
 *   node niches/solar/scripts/03-pvwatts.js all      # every city (~5 hours)
 */

const fs = require('fs');
const path = require('path');
const { assumptions } = require('../config.js');

const DATA = path.join(__dirname, '..', 'data');
const CACHE = path.join(DATA, 'pvwatts.json');
const API = 'https://developer.nlr.gov/api/pvwatts/v8.json';
const KEY = process.env.NREL_API_KEY || 'DEMO_KEY';

const SAMPLE = ['il/chicago', 'az/phoenix', 'wa/seattle', 'ma/boston', 'tx/houston'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round(n * 100) / 100;

async function runOne(city) {
  const { tilt, azimuth, losses, arrayType, moduleType } = assumptions.pv;
  const qs = new URLSearchParams({
    api_key: KEY,
    lat: city.lat.toFixed(4),
    lon: city.lon.toFixed(4),
    system_capacity: '1',
    azimuth: String(azimuth),
    tilt: String(tilt),
    array_type: String(arrayType),
    module_type: String(moduleType),
    losses: String(losses),
    timeframe: 'monthly'
  });
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}?${qs}`);
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    if (res.status === 429) {
      console.log('  rate limit hit; waiting 5 min');
      await sleep(5 * 60 * 1000);
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || (body.errors && body.errors.length)) {
      if (attempt < 3) {
        await sleep(5000 * attempt);
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(body && body.errors)}`);
    }
    const o = body.outputs;
    const s = body.station_info;
    return {
      result: {
        kwhPerKw: Math.round(o.ac_annual),
        monthly: o.ac_monthly.map((v) => Math.round(v * 10) / 10),
        sunHours: r2(o.solrad_annual),
        station: { lat: r2(s.lat), lon: r2(s.lon), distanceKm: Math.round(s.distance / 100) / 10 }
      },
      remaining
    };
  }
}

async function main() {
  const mode = process.argv[2] || 'sample';
  const cities = JSON.parse(fs.readFileSync(path.join(DATA, 'cities.json'), 'utf8'));
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const key = (c) => `${c.stateSlug}/${c.slug}`;

  let todo = mode === 'all' ? cities : cities.filter((c) => SAMPLE.includes(key(c)));
  todo = todo.filter((c) => !cache[key(c)]);
  console.log(`PVWatts: ${todo.length} to fetch (${Object.keys(cache).length} cached), key=${KEY === 'DEMO_KEY' ? 'DEMO_KEY' : 'NREL_API_KEY'}`);

  let done = 0;
  const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache) + '\n');
  for (const city of todo) {
    try {
      const { result, remaining } = await runOne(city);
      cache[key(city)] = result;
      done++;
      if (done % 25 === 0 || done === todo.length) {
        save();
        console.log(`  ${done}/${todo.length} (budget left this hour: ${remaining})`);
      }
      if (remaining <= 1) {
        save();
        console.log('  hourly budget used; waiting 10 min');
        await sleep(10 * 60 * 1000);
      }
    } catch (e) {
      save();
      console.error(`  ${key(city)}: ${e.message}`);
    }
  }
  save();
  console.log(`pvwatts.json: ${Object.keys(cache).length} cities`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
