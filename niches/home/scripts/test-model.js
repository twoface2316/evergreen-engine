'use strict';

/** niches/home/scripts/test-model.js — node assert checks for model.js. Run: node niches/home/scripts/test-model.js */

const assert = require('assert');
const { hardnessBand, toGpg, softenerSize, leadStatus, RADON_ZONES, recentHealth } = require('./model.js');
const config = require('../config.js');

assert.strictEqual(hardnessBand(0).key, 'soft');
assert.strictEqual(hardnessBand(60).key, 'soft');
assert.strictEqual(hardnessBand(60.1).key, 'moderate');
assert.strictEqual(hardnessBand(120).key, 'moderate');
assert.strictEqual(hardnessBand(180).key, 'hard');
assert.strictEqual(hardnessBand(181).key, 'very-hard');
assert.ok(Math.abs(toGpg(171) - 10) < 1e-9);

const s = config.softener;
// 4 people x 75 gal x 10 gpg = 3,000 grains/day; 21,000/week -> 24k unit.
assert.deepStrictEqual(softenerSize(4, 10, s.gallonsPerPersonDay, s.daysBetweenRegen, s.sizes), { daily: 3000, needed: 21000, size: 24000 });
assert.strictEqual(softenerSize(4, 20, 75, 7, s.sizes).size, 48000);
assert.strictEqual(softenerSize(10, 40, 75, 7, s.sizes).size, null);
const rebuilt = new Function(`${softenerSize.toString()}\nreturn softenerSize(2, 15, 75, 7, [24000, 32000]).size;`)();
assert.strictEqual(rebuilt, 24000);

const al = config.lead.actionLevelMgL;
assert.strictEqual(leadStatus(null, al).key, 'none');
assert.strictEqual(leadStatus(0, al).key, 'nd');
assert.strictEqual(leadStatus(0.002, al).key, 'low');
assert.strictEqual(leadStatus(0.006, al).key, 'elevated');
assert.strictEqual(leadStatus(0.015, al).key, 'elevated');
assert.strictEqual(leadStatus(0.016, al).key, 'over');

assert.strictEqual(RADON_ZONES[1].key, 'high');
const list = [
  { health: true, begin: '2024-03-01' },
  { health: true, begin: '2019-01-01' },
  { health: false, begin: '2025-01-01' }
];
assert.strictEqual(recentHealth(list, '2026-10-06', 5).length, 1);

console.log('home model tests: all passed');
