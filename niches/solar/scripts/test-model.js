'use strict';

/** niches/solar/scripts/test-model.js — node assert checks for model.js. Run: node niches/solar/scripts/test-model.js */

const assert = require('assert');
const { cashFlow, paybackYears, sizeSystem, computeEconomics, costPerWattFor } = require('./model.js');
const { assumptions } = require('../config.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// cashFlow: flat when no degradation/escalation.
assert.deepStrictEqual(cashFlow(1000, 20, 3, 0, 0), [200, 200, 200]);
// Escalation and degradation compound per year.
near(cashFlow(1000, 10, 2, 0.5, 1)[1], 1000 * 0.5 * 0.1 * 2, 1e-9, 'compounding');

// paybackYears: exact, fractional, never.
assert.strictEqual(paybackYears(400, [200, 200, 200]), 2);
near(paybackYears(500, [200, 200, 200]), 2.5, 1e-9, 'fractional payback');
assert.strictEqual(paybackYears(1000, [200, 200, 200]), null);
assert.strictEqual(paybackYears(0, [200]), 0);

// sizeSystem: rounds up to whole panels, clamps to range.
assert.deepStrictEqual(sizeSystem(8000, 1000, assumptions), { panels: 20, sizeKw: 8 });
assert.deepStrictEqual(sizeSystem(8100, 1000, assumptions), { panels: 21, sizeKw: 8.4 });
const small = sizeSystem(500, 1500, assumptions).sizeKw;
assert.ok(small >= assumptions.minKw && small < assumptions.minKw + assumptions.panelWatts / 1000, `min clamp ${small}`);
const big = sizeSystem(100000, 1000, assumptions).sizeKw;
assert.ok(big <= assumptions.maxKw && big > assumptions.maxKw - assumptions.panelWatts / 1000, `max clamp ${big}`);

// costPerWattFor: state value or US fallback.
const ic = { us: { allHostOwned: 3.6 }, states: { CA: 3.3 } };
assert.deepStrictEqual(costPerWattFor('CA', ic), { value: 3.3, scope: 'state' });
assert.deepStrictEqual(costPerWattFor('IL', ic), { value: 3.6, scope: 'us' });

// computeEconomics: Chicago-like inputs give a sane picture.
const e = computeEconomics({
  pv: { kwhPerKw: 1325, monthly: [66, 84, 109, 127, 139, 145, 158, 139, 120, 94, 70, 57] },
  state: { priceCents: 19.22, monthlyKwh: 693 },
  costPerWatt: 3.6,
  assumptions
});
assert.strictEqual(e.panels, 16);
near(e.sizeKw, 6.4, 1e-9, 'size');
near(e.grossCost, 23040, 1e-6, 'cost');
assert.ok(e.offset >= 1 && e.offset < 1.1, `offset ${e.offset}`);
assert.ok(e.payback > 10 && e.payback < 16, `Chicago payback ${e.payback}`);
assert.ok(e.netLifetime > 0, 'positive lifetime savings');
near(e.monthlyKwh.reduce((s, v) => s + v, 0), 1308 * 6.4, 20, 'monthly sums to annual');

// Embeddable: functions survive toString() round-trip (used by the calculator).
const rebuilt = new Function(`${cashFlow.toString()}\n${paybackYears.toString()}\nreturn paybackYears(500, cashFlow(1000, 20, 5, 0, 0));`)();
near(rebuilt, 2.5, 1e-9, 'toString round-trip');

console.log('model tests: all passed');
