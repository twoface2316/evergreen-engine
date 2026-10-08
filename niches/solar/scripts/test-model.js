'use strict';

/** niches/solar/scripts/test-model.js — node assert checks for model.js. Run: node niches/solar/scripts/test-model.js */

const assert = require('assert');
const { cashFlow, paybackYears, sizeSystem, solarValueCents, policyFor, computeEconomics, costPerWattFor } = require('./model.js');
const { assumptions } = require('../config.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// cashFlow: flat when no degradation/escalation.
assert.deepStrictEqual(cashFlow(1000, 20, 3, 0, 0), [200, 200, 200]);
// Escalation and degradation compound per year.
near(cashFlow(1000, 10, 2, 0.5, 1)[1], 1000 * 0.5 * 0.1 * 2, 1e-9, 'compounding');
// A flat annual fee comes off every year.
assert.deepStrictEqual(cashFlow(1000, 20, 2, 0, 0, 50), [150, 150]);

// paybackYears: exact, fractional, never; years that lose money never pay back.
assert.strictEqual(paybackYears(400, [200, 200, 200]), 2);
near(paybackYears(500, [200, 200, 200]), 2.5, 1e-9, 'fractional payback');
assert.strictEqual(paybackYears(1000, [200, 200, 200]), null);
assert.strictEqual(paybackYears(0, [200]), 0);
assert.strictEqual(paybackYears(100, [-10, -10]), null);
near(paybackYears(100, [-10, 60, 60]), 2 + 50 / 60, 1e-9, 'payback after a negative year');

// sizeSystem: rounds up to whole panels, clamps to range.
assert.deepStrictEqual(sizeSystem(8000, 1000, assumptions), { panels: 20, sizeKw: 8 });
assert.deepStrictEqual(sizeSystem(8100, 1000, assumptions), { panels: 21, sizeKw: 8.4 });
const small = sizeSystem(500, 1500, assumptions).sizeKw;
assert.ok(small >= assumptions.minKw && small < assumptions.minKw + assumptions.panelWatts / 1000, `min clamp ${small}`);
const big = sizeSystem(100000, 1000, assumptions).sizeKw;
assert.ok(big <= assumptions.maxKw && big > assumptions.maxKw - assumptions.panelWatts / 1000, `max clamp ${big}`);

// solarValueCents: retail under net metering; blended under net billing.
assert.strictEqual(solarValueCents(30, null, 0.4), 30);
assert.strictEqual(solarValueCents(30, 35, 0.4), 30);
near(solarValueCents(30, 5, 0.4), 0.4 * 30 + 0.6 * 5, 1e-9, 'blended value');

// policyFor: default net metering, cents, share of retail, fees, label overrides.
const pol = {
  default: { type: 'net-metering', label: 'Net metering' },
  states: {
    CA: { type: 'net-billing', exportCents: 7 },
    MI: { type: 'net-billing', exportShare: 0.5 },
    AL: { type: 'net-billing', exportCents: 3, feePerKwMonth: 5.41 },
    NV: { type: 'net-metering', label: 'Tier 4' }
  }
};
assert.strictEqual(policyFor('IL', 20, pol).exportCents, null);
assert.strictEqual(policyFor('IL', 20, pol).feePerKwMonth, 0);
assert.strictEqual(policyFor('CA', 32, pol).exportCents, 7);
assert.strictEqual(policyFor('MI', 20, pol).exportCents, 10);
assert.strictEqual(policyFor('AL', 16, pol).feePerKwMonth, 5.41);
assert.strictEqual(policyFor('NV', 12, pol).exportCents, null);
assert.strictEqual(policyFor('NV', 12, pol).label, 'Tier 4');
// A city's own utility overrides its state.
const withCity = { ...pol, cities: { 'ca/los-angeles': { type: 'net-metering', label: 'LADWP' } } };
assert.strictEqual(policyFor('CA', 32, withCity, 'ca/los-angeles').exportCents, null);
assert.strictEqual(policyFor('CA', 32, withCity, 'ca/fresno').exportCents, 7);

// costPerWattFor: state value or US fallback.
const ic = { us: { allHostOwned: 3.6 }, states: { CA: 3.3 } };
assert.deepStrictEqual(costPerWattFor('CA', ic), { value: 3.3, scope: 'state' });
assert.deepStrictEqual(costPerWattFor('IL', ic), { value: 3.6, scope: 'us' });

// computeEconomics: Chicago-like inputs under net metering give a sane picture.
const base = {
  pv: { kwhPerKw: 1325, monthly: [66, 84, 109, 127, 139, 145, 158, 139, 120, 94, 70, 57] },
  state: { priceCents: 19.22, monthlyKwh: 693 },
  costPerWatt: 3.6,
  selfConsumption: 0.4,
  assumptions
};
const e = computeEconomics({ ...base, policy: policyFor('XX', 19.22, pol) });
assert.strictEqual(e.panels, 16);
near(e.sizeKw, 6.4, 1e-9, 'size');
near(e.grossCost, 23040, 1e-6, 'cost');
assert.strictEqual(e.valueCents, 19.22);
assert.ok(e.offset >= 1 && e.offset < 1.1, `offset ${e.offset}`);
assert.ok(e.payback > 10 && e.payback < 16, `Chicago payback ${e.payback}`);
assert.ok(e.netLifetime > 0, 'positive lifetime savings');
near(e.monthlyKwh.reduce((s, v) => s + v, 0), 1308 * 6.4, 20, 'monthly sums to annual');

// Net billing lowers the value of a solar kWh and lengthens payback; a fee lowers savings further.
const nb = computeEconomics({ ...base, policy: policyFor('CA', 19.22, pol) });
near(nb.valueCents, 0.4 * 19.22 + 0.6 * 7, 1e-9, 'net billing value');
assert.ok(nb.payback > e.payback, `net billing payback ${nb.payback} vs ${e.payback}`);
const withFee = computeEconomics({ ...base, policy: policyFor('AL', 19.22, pol) });
const noFee = computeEconomics({ ...base, policy: { ...policyFor('AL', 19.22, pol), feePerKwMonth: 0 } });
near(withFee.annualFee, 5.41 * 6.4 * 12, 1e-9, 'annual fee');
near(noFee.year1Savings - withFee.year1Savings, withFee.annualFee, 1e-9, 'fee comes off savings');

// Embeddable: functions survive toString() round-trip (used by the calculator).
const rebuilt = new Function(
  `${cashFlow.toString()}\n${paybackYears.toString()}\n${solarValueCents.toString()}\nreturn paybackYears(500, cashFlow(1000, solarValueCents(20, null, 0.4), 5, 0, 0, 0));`
)();
near(rebuilt, 2.5, 1e-9, 'toString round-trip');

console.log('model tests: all passed');
