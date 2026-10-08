'use strict';

/**
 * niches/solar/scripts/model.js — pure solar economics for one city.
 *
 * cashFlow(), paybackYears(), sizeSystem() and solarValueCents() are
 * self-contained (no closures, no requires) because the on-page calculator
 * embeds their source via Function.prototype.toString(), so the numbers a
 * visitor gets from the calculator match the numbers printed on the page
 * exactly.
 */

/**
 * Year-by-year savings: output degrades, the value of a solar kWh
 * escalates with electricity prices, and any flat annual solar fee
 * (e.g. a capacity charge) is subtracted.
 */
function cashFlow(annualKwh, valueCents, years, degradation, escalation, annualFee) {
  var out = [];
  for (var y = 0; y < years; y++) {
    out.push(annualKwh * Math.pow(1 - degradation, y) * (valueCents / 100) * Math.pow(1 + escalation, y) - (annualFee || 0));
  }
  return out;
}

/** Years until cumulative savings cover net cost (fractional), or null if never within the flow. */
function paybackYears(netCost, flow) {
  var cum = 0;
  for (var y = 0; y < flow.length; y++) {
    if (flow[y] > 0 && cum + flow[y] >= netCost) return y + (netCost - cum) / flow[y];
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
 * Average value of one solar kWh (cents). Under net metering (exportCents
 * null, or at least retail) every kWh is worth retail. Under net billing,
 * the share used at home as it's produced is worth retail and the rest
 * earns the export credit.
 */
function solarValueCents(retailCents, exportCents, selfUse) {
  if (exportCents == null || exportCents === '' || exportCents >= retailCents) return retailCents;
  return selfUse * retailCents + (1 - selfUse) * exportCents;
}

/**
 * The export compensation for a state (or a city whose own utility sets
 * different rules, keyed "<stateSlug>/<slug>"), with exportCents resolved
 * (an exportShare policy is a fraction of retail). Net metering gets
 * exportCents null.
 */
function policyFor(stateAbbr, priceCents, policies, cityKey) {
  const city = cityKey && policies.cities ? policies.cities[cityKey] : null;
  const p = Object.assign({}, policies.default, city || policies.states[stateAbbr] || {});
  const exportCents = p.type !== 'net-billing' ? null : p.exportCents != null ? p.exportCents : p.exportShare * priceCents;
  return Object.assign(p, { exportCents, feePerKwMonth: p.feePerKwMonth || 0 });
}

/**
 * computeEconomics({ pv: {kwhPerKw, monthly}, state: {priceCents, monthlyKwh},
 *   costPerWatt, policy (from policyFor), selfConsumption, assumptions }) -> numbers for the page.
 */
function computeEconomics({ pv, state, costPerWatt, policy, selfConsumption, assumptions: a }) {
  const annualUsage = state.monthlyKwh * 12;
  const { panels, sizeKw } = sizeSystem(annualUsage, pv.kwhPerKw, a);
  const annualKwh = sizeKw * pv.kwhPerKw;
  const grossCost = sizeKw * 1000 * costPerWatt;
  const netCost = grossCost * (1 - a.federalCredit);
  const valueCents = solarValueCents(state.priceCents, policy.exportCents, selfConsumption);
  const annualFee = policy.feePerKwMonth * sizeKw * 12;
  const flow = cashFlow(annualKwh, valueCents, a.lifetimeYears, a.degradation, a.priceEscalation, annualFee);
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
    valueCents,
    annualFee,
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

module.exports = { cashFlow, paybackYears, sizeSystem, solarValueCents, policyFor, computeEconomics, costPerWattFor };
