'use strict';

/**
 * niches/home/scripts/guides.js — water + radon guides on top of
 * engine/lib/guides.js.
 *
 * Guides live in niches/home/content/guides/ (format: engine/lib/guides.js).
 * Placeholders, all computed from the same data as the city pages:
 *   {{cityCount}} {{utilityCount}} {{cleanShare}} {{windowYear}} {{waterAsOf}}
 *   {{topContaminants}}   most common health-based violations, as a list
 *   {{leadSystems}} {{leadOver15}} {{leadOver10}}   primary utilities with lead results / above 15 / above 10 ppb
 *   {{hardestCities}} {{softestCities}}   large cities, linked, with grains per gallon
 *   {{veryHardShare}} {{softShare}}       share of places in those hardness bands
 *   {{radonZone1Share}} {{radonZone3Share}}
 *   {{cityHardness:il/chicago}}           "8.1 grains per gallon (139 mg/L)"
 */

const path = require('path');

const layout = require('../templates/layout.js');
const config = require('../config.js');
const engineGuides = require('../../../engine/lib/guides.js');
const { hardnessBand, toGpg } = require('./model.js');

const CONTENT_DIR = path.join(__dirname, '..', 'content', 'guides');
const e = layout.escapeHtml;
const pct = (n, d) => `${Math.round((100 * n) / Math.max(d, 1))}%`;

/** Plain-English group for an EPA contaminant/rule name, so related rules count together. */
function contaminantGroup(name) {
  const n = name.toLowerCase();
  if (n === 'tthm' || n.includes('trihalomethane')) return 'Total trihalomethanes (TTHM), a disinfection byproduct';
  if (n.includes('haloacetic')) return 'Haloacetic acids (HAA5), a disinfection byproduct';
  if (n.includes('lead and copper')) return 'Lead and copper rules (corrosion control, tap sampling, lead pipe inventories)';
  if (n.includes('coliform')) return 'Bacteria testing and follow-up (coliform rules)';
  if (n.includes('surface water treatment')) return 'Filtration and disinfection of rivers and lakes (surface water treatment rules)';
  if (n.includes('groundwater rule')) return 'Well disinfection and fecal contamination testing (Groundwater Rule)';
  if (n.includes('disinfectants and disinfection byproducts')) return 'Disinfection byproduct rules';
  return name.charAt(0) + name.slice(1).toLowerCase().replace(/(pfas|pfoa|pfos|tthm)/g, (m) => m.toUpperCase());
}

function buildValues(m) {
  const withUtil = m.rows.filter((r) => r.d.primary);
  // Count each primary utility once (a utility can serve several places).
  const primaries = [...new Map(withUtil.map((r) => [r.d.primary.id, r.d.primary])).values()];
  const contam = new Map();
  for (const p of primaries) {
    const seen = new Set(p.violations.list.filter((v) => v.health).map((v) => contaminantGroup(v.contaminant)));
    for (const c of seen) contam.set(c, (contam.get(c) || 0) + 1);
  }
  const top = [...contam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const withLead = primaries.filter((p) => p.lead);
  const big = m.rows.filter((r) => r.d.hardness && (r.city.population || 0) >= 150000);
  const cityItem = (r) => `<a href="${layout.cityPath(r.city)}">${e(r.city.name)}, ${r.city.state}</a> (${layout.fix1(toGpg(r.d.hardness.mgL))} gpg)`;
  const hard = m.rows.filter((r) => r.d.hardness);
  const radon = m.rows.filter((r) => r.d.radon);
  return {
    cityCount: layout.num(m.rows.length),
    utilityCount: layout.num(withUtil.length),
    cleanShare: pct(withUtil.filter((r) => r.d.primary.violations.healthBased === 0).length, withUtil.length),
    windowYear: m.sources.windowStart.slice(0, 4),
    waterAsOf: e(m.sources.waterAsOf),
    topContaminants: `<ul>${top.map(([c, n]) => `<li>${e(c)} — ${layout.num(n)} utilities</li>`).join('')}</ul>`,
    leadSystems: layout.num(withLead.length),
    leadOver15: layout.num(withLead.filter((p) => p.lead.mgL > 0.015).length),
    leadOver10: layout.num(withLead.filter((p) => p.lead.mgL > 0.01).length),
    hardestCities: [...big].sort((a, b) => b.d.hardness.mgL - a.d.hardness.mgL).slice(0, 8).map(cityItem).join(', '),
    softestCities: [...big].sort((a, b) => a.d.hardness.mgL - b.d.hardness.mgL).slice(0, 8).map(cityItem).join(', '),
    veryHardShare: pct(hard.filter((r) => hardnessBand(r.d.hardness.mgL).key === 'very-hard').length, hard.length),
    softShare: pct(hard.filter((r) => hardnessBand(r.d.hardness.mgL).key === 'soft').length, hard.length),
    radonZone1Share: pct(radon.filter((r) => r.d.radon.zone === 1).length, radon.length),
    radonZone3Share: pct(radon.filter((r) => r.d.radon.zone === 3).length, radon.length)
  };
}

function resolver(m, slug) {
  return (key, arg) => {
    if (key === 'cityHardness') {
      const r = m.rows.find((x) => x.key === arg);
      if (!r || !r.d.hardness) throw new Error(`${slug}: no hardness for ${arg}`);
      return `${layout.fix1(toGpg(r.d.hardness.mgL))} grains per gallon (${layout.num(r.d.hardness.mgL)} mg/L)`;
    }
    return undefined;
  };
}

function loadGuides() {
  return engineGuides.loadGuides(CONTENT_DIR);
}

function buildGuideLinks(guides, n = 4) {
  return engineGuides.buildGuideLinks(guides, { heading: 'Water and radon guides', n });
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
      title: `Tap Water & Radon Guides (${layout.buildYear()})`,
      description: 'Guides to tap water safety, lead, PFAS, hard water, water filters and radon testing, built on EPA records for US cities.',
      h1: 'Tap Water and Radon Guides',
      lede: 'Plain-language guides to what is in your tap water and your home’s air, and what to do about it, using the same EPA data as our city reports.'
    }
  });
}

module.exports = { loadGuides, renderGuides, buildGuideLinks };
