'use strict';

/**
 * niches/solar/scripts/guides.js — solar guides on top of engine/lib/guides.js.
 *
 * Guides live in niches/solar/content/guides/ (format: engine/lib/guides.js).
 * Solar placeholders, all filled from the same model as the city pages:
 *   {{cityCount}} {{usMedianPayback}} {{usMedianKwh}} {{netBillingCount}}
 *   {{fastestStates}} {{slowestStates}} {{netBillingTable}}
 *   {{costUs}} {{costCash}} {{costLoan}} {{selfUse}}
 *   {{plugInKwh}} {{plugInValue20}}  800 W plug-in kit at the US median output
 *   {{statePayback:CA}} {{statePrice:CA}} {{stateExport:CA}} {{stateValue:CA}}
 *   {{cityPayback:ca/los-angeles}}
 *   {{leadgen}}  installer-quote box, or nothing when no partner is configured
 */

const path = require('path');

const layout = require('../templates/layout.js');
const config = require('../config.js');
const engineGuides = require('../../../engine/lib/guides.js');
const { solarValueCents } = require('./model.js');

const CONTENT_DIR = path.join(__dirname, '..', 'content', 'guides');
const { escapeHtml } = layout;

const median = (arr) => {
  const s = arr.filter((v) => v != null).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/** Placeholder values derived from the render model (see render.js loadModel). */
function buildValues(m) {
  const states = [...m.stateStats.values()].map((s) => ({ ...s, pb: s.medianPayback === 99 ? null : s.medianPayback }));
  const ranked = [...states].sort((a, b) => (a.pb ?? 99) - (b.pb ?? 99));
  const fmtState = (s) => `<a href="${layout.statePath(s.abbr)}">${escapeHtml(s.name)}</a> (${layout.years(s.pb)})`;
  const netBilling = Object.entries(m.policies.states).filter(([, p]) => p.type === 'net-billing');
  const nbRows = netBilling
    .map(([abbr]) => m.stateStats.get(abbr))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (s) =>
        `<tr><td><a href="${layout.statePath(s.abbr)}">${escapeHtml(s.name)}</a></td><td>${escapeHtml(s.policy.label)}</td><td>${layout.cents(s.policy.exportCents)}</td><td>${layout.cents(s.priceCents)}</td><td>${layout.yearsShort(s.medianPayback === 99 ? null : s.medianPayback)}</td></tr>`
    )
    .join('');
  return {
    cityCount: layout.num(m.rows.length),
    usMedianPayback: layout.years(median(m.rows.map((r) => r.e.payback ?? 99))),
    usMedianKwh: layout.num(m.usMedianKwh),
    netBillingCount: String(netBilling.length),
    fastestStates: ranked.slice(0, 5).map(fmtState).join(', '),
    slowestStates: ranked.slice(-5).reverse().map(fmtState).join(', '),
    netBillingTable: `<div class="table-wrap"><table class="data"><thead><tr><th>State</th><th>Program</th><th>Exports earn</th><th>Retail price</th><th>Median payback</th></tr></thead><tbody>${nbRows}</tbody></table></div>`,
    costUs: `$${m.installedCost.us.allHostOwned.toFixed(2)}`,
    costCash: `$${m.installedCost.us.cashPurchase.toFixed(2)}`,
    costLoan: `$${m.installedCost.us.loanFinanced.toFixed(2)}`,
    selfUse: layout.pct(m.policies.selfConsumption),
    plugInKwh: layout.num(0.8 * m.usMedianKwh),
    plugInValue20: layout.money(0.8 * m.usMedianKwh * 0.2)
  };
}

/** Parameterized solar placeholders; undefined lets the engine fall through to `values`. */
function resolver(m, slug) {
  return (key, arg) => {
    if (key === 'leadgen') return layout.buildLeadGen({ name: 'your area', state: '' });
    if (key === 'statePayback' || key === 'statePrice' || key === 'stateExport' || key === 'stateValue') {
      const s = m.stateStats.get(arg);
      if (!s) throw new Error(`${slug}: unknown state ${arg}`);
      if (key === 'statePayback') return layout.years(s.medianPayback === 99 ? null : s.medianPayback);
      if (key === 'statePrice') return layout.cents(s.priceCents);
      if (key === 'stateValue') return layout.cents(solarValueCents(s.priceCents, s.policy.exportCents, m.policies.selfConsumption));
      return s.policy.type === 'net-billing' ? layout.cents(s.policy.exportCents) : 'the retail price';
    }
    if (key === 'cityPayback') {
      const r = m.rows.find((x) => `${x.city.stateSlug}/${x.city.slug}` === arg);
      if (!r) throw new Error(`${slug}: unknown city ${arg}`);
      return layout.years(r.e.payback);
    }
    return undefined;
  };
}

function loadGuides() {
  return engineGuides.loadGuides(CONTENT_DIR);
}

/** "Solar guides" card for city/home pages. */
function buildGuideLinks(guides, n = 4) {
  return engineGuides.buildGuideLinks(guides, { heading: 'Solar guides', n });
}

/** renderGuides({ guides, m, page, writePage, siteUrl }) -> URLs written. */
function renderGuides({ guides, m, page, writePage, siteUrl }) {
  const values = buildValues(m);
  return engineGuides.renderGuidePages({
    guides,
    fill: (g) => engineGuides.fillGuideBody(g, { values, resolve: resolver(m, g.slug), amazonTag: config.amazonTag }),
    page,
    writePage,
    breadcrumbs: layout.buildBreadcrumbs,
    siteUrl,
    siteName: config.siteName,
    amazonTag: config.amazonTag,
    index: {
      title: `Solar Guides (${layout.buildYear()}): Costs, Net Metering, Batteries & Quotes`,
      description: 'Guides to home solar in 2026: whether it pays without the tax credit, net metering vs net billing, batteries, leases and reading quotes.',
      h1: 'Solar Guides',
      lede: `Plain-language answers to the questions that decide whether home solar pays off in ${layout.buildYear()}, using the same data as our city estimates.`
    }
  });
}

module.exports = { loadGuides, renderGuides, buildGuideLinks };
