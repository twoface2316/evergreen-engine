'use strict';

/**
 * niches/solar/scripts/model.js — pure solar economics for one city.
 *
 * cashFlow() and paybackYears() are self-contained (no closures, no
 * requires) because the on-page calculator embeds their source via
 * Function.prototype.toString(), so the numbers a visitor gets from the
 * calculator match the numbers printed on the page exactly.
 */

/** Year-by-year savings: output degrades, electricity price escalates. */
function cashFlow(annualKwh, priceCents, years, degradation, escalation) {
  var out = [];
  for (var y = 0; y < years; y++) {
    out.push(annualKwh * Math.pow(1 - degradation, y) * (priceCents / 100) * Math.pow(1 + escalation, y));
  }
  return out;
}

/** Years until cumulative savings cover net cost (fractional), or null if never within the flow. */
function paybackYears(netCost, flow) {
  var cum = 0;
  for (var y = 0; y < flow.length; y++) {
    if (cum + flow[y] >= netCost) return y + (netCost - cum) / flow[y];
    cum += flow[y];
  }
  return null;
}

/** Panel count and DC size covering `offsetShare` of annual usage, at least minKw (rounded up to a whole panel), at most maxKw. */
function sizeSystem(annualUsageKwh, kwhPerKw, a) {
  var targetKw = (annualUsageKwh * a.offsetShare) / kwhPerKw;
  targetKw = Math.min(a.maxKw, Math.max(a.minKw, targetKw));
  var panels = Math.ceil((targetKw * 1000) / a.panelWatts);
  if ((panels * a.panelWatts) / 1000 > a.maxKw) panels = Math.floor((a.maxKw * 1000) / a.panelWatts);
  return { panels: panels, sizeKw: (panels * a.panelWatts) / 1000 };
}

/**
 * computeEconomics({ pv: {kwhPerKw, monthly}, state: {priceCents, monthlyKwh},
 *   costPerWatt, assumptions }) -> numbers for the page.
 */
function computeEconomics({ pv, state, costPerWatt, assumptions: a }) {
  const annualUsage = state.monthlyKwh * 12;
  const { panels, sizeKw } = sizeSystem(annualUsage, pv.kwhPerKw, a);
  const annualKwh = sizeKw * pv.kwhPerKw;
  const grossCost = sizeKw * 1000 * costPerWatt;
  const netCost = grossCost * (1 - a.federalCredit);
  const flow = cashFlow(annualKwh, state.priceCents, a.lifetimeYears, a.degradation, a.priceEscalation);
  const lifetimeSavings = flow.reduce((s, v) => s + v, 0);
  return {
    annualUsage,
    panels,
    sizeKw,
    annualKwh,
    offset: annualKwh / annualUsage,
    monthlyKwh: pv.monthly.map((m) => m * sizeKw),
    grossCost,
    netCost,
    year1Savings: flow[0],
    monthlySavings: flow[0] / 12,
    payback: paybackYears(netCost, flow),
    lifetimeSavings,
    netLifetime: lifetimeSavings - netCost,
    costPerWatt
  };
}

/** State median from Berkeley Lab where it exists, else the US median. */
function costPerWattFor(stateAbbr, installedCost) {
  const v = installedCost.states[stateAbbr];
  return v != null ? { value: v, scope: 'state' } : { value: installedCost.us.allHostOwned, scope: 'us' };
}

module.exports = { cashFlow, paybackYears, sizeSystem, computeEconomics, costPerWattFor };
