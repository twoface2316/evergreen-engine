'use strict';

/**
 * niches/solar/scripts/render.js — builds the solar site into sites/solar/.
 *
 * Inputs (all committed, built by the numbered pipeline scripts):
 *   data/cities.json        02-cities.js
 *   data/states.json        01-state-data.js
 *   data/pvwatts.json       03-pvwatts.js
 *   data/installed-cost.json  hand-entered from Berkeley Lab
 *   data/export-policy.json   hand-entered: how each state credits exported power
 *
 * Cities without a PVWatts result are skipped, so a partial cache renders a
 * partial site.
 *
 *   node niches/solar/scripts/render.js sample   # whatever is cached; no coverage check
 *   node niches/solar/scripts/render.js full     # fails below 95% PVWatts coverage
 *
 * Env: SITE_URL (canonical origin, no trailing slash), BASE_PATH (sub-path
 * deploys only; see engine/lib/base-path.js).
 */

const fs = require('fs');
const path = require('path');

const layout = require('../templates/layout.js');
const config = require('../config.js');
const { computeEconomics, costPerWattFor, policyFor } = require('./model.js');
const { STATE_NAMES, stateName } = require('./states.js');
const guidesLib = require('./guides.js');

// Long-form guides (content/guides/), loaded once per build.
const GUIDES = guidesLib.loadGuides();

const basePathLib = require('../../../engine/lib/base-path.js');
const { buildPageShell, setShellDefaults } = require('../../../engine/lib/page-shell.js');
const { buildSitemapXml, buildRobotsTxt } = require('../../../engine/lib/sitemap.js');
const { renderCollection, countFilesRecursive } = require('../../../engine/lib/render-loop.js');
const { validateBasicPage } = require('../../../engine/lib/html-validate.js');

const SITE_URL = (process.env.SITE_URL || config.defaultSiteUrl).replace(/\/+$/, '');
const ROOT = path.join(__dirname, '..', '..', '..');
const DATA = path.join(__dirname, '..', 'data');
const SITE_DIR = path.join(ROOT, 'sites', 'solar');

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

function median(arr) {
  const s = arr.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildHeadExtras() {
  const parts = [];
  if (config.goatcounterCode) {
    parts.push(`<script data-goatcounter="https://${config.goatcounterCode}.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`);
  }
  if (config.adsensePublisherId) {
    parts.push(`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${config.adsensePublisherId}" crossorigin="anonymous"></script>`);
  }
  return parts.join('\n');
}

function jsonLd(graph) {
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`;
}

function breadcrumbLd(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.label, item: `${SITE_URL}${t.href}` }))
  };
}

// ---------------------------------------------------------------------
// Data assembly
// ---------------------------------------------------------------------
function loadModel() {
  const cities = readJson('cities.json');
  const statesData = readJson('states.json');
  const pvAll = readJson('pvwatts.json');
  const installedCost = readJson('installed-cost.json');
  const policies = readJson('export-policy.json');

  const rows = [];
  for (const city of cities) {
    const pv = pvAll[`${city.stateSlug}/${city.slug}`];
    const stateData = statesData.states[city.state];
    if (!pv || !stateData) continue;
    const cpw = costPerWattFor(city.state, installedCost);
    const cityPolicy = policies.cities && policies.cities[`${city.stateSlug}/${city.slug}`];
    // A city utility with its own rate (e.g. LADWP) replaces the state average price.
    const st = cityPolicy && cityPolicy.priceCents ? { ...stateData, priceCents: cityPolicy.priceCents, priceOwner: cityPolicy.utility, statePriceCents: stateData.priceCents } : stateData;
    const policy = policyFor(city.state, st.priceCents, policies, `${city.stateSlug}/${city.slug}`);
    const e = computeEconomics({ pv, state: st, costPerWatt: cpw.value, policy, selfConsumption: policies.selfConsumption, assumptions: config.assumptions });
    rows.push({ city, pv, st, e, policy, costScope: cpw.scope });
  }

  const byState = new Map();
  for (const r of rows) {
    if (!byState.has(r.city.state)) byState.set(r.city.state, []);
    byState.get(r.city.state).push(r);
  }
  const stateStats = new Map();
  for (const [abbr, list] of byState) {
    list.sort((a, b) => (b.city.population || 0) - (a.city.population || 0));
    const peers = [...list].sort((a, b) => (a.e.payback ?? 99) - (b.e.payback ?? 99));
    stateStats.set(abbr, {
      abbr,
      name: stateName(abbr),
      count: list.length,
      medianKwh: median(list.map((r) => r.pv.kwhPerKw)),
      medianPayback: median(list.map((r) => r.e.payback ?? 99)),
      priceCents: statesData.states[abbr].priceCents,
      monthlyKwh: statesData.states[abbr].monthlyKwh,
      costPerWatt: costPerWattFor(abbr, installedCost).value,
      policy: policyFor(abbr, statesData.states[abbr].priceCents, policies),
      peers
    });
  }
  const usMedianKwh = median(rows.map((r) => r.pv.kwhPerKw));
  return { cities, rows, byState, stateStats, usMedianKwh, statesData, installedCost, policies };
}

// ---------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------
function page({ title, description, pathName, bodyHtml, jsonLdHtml = '', robots }) {
  return buildPageShell({
    title,
    description,
    canonical: `${SITE_URL}${pathName}`,
    robotsContent: robots,
    stylesheetHref: basePathLib.href('/style.css'),
    jsonLdHtml,
    headerHtml: layout.buildSiteHeader(),
    bodyHtml,
    footerHtml: layout.buildFooter(PAGE_SOURCES)
  });
}

let PAGE_SOURCES = null;

function renderCity(r, m) {
  const { city, pv, st, e } = r;
  const ss = m.stateStats.get(city.state);
  const trail = [
    { label: 'Home', href: '/' },
    { label: stateName(city.state), href: layout.statePath(city.state) },
    { label: city.name, href: layout.cityPath(city) }
  ];
  const nearby = m.byState
    .get(city.state)
    .filter((o) => o !== r)
    .map((o) => ({ o, d: haversineKm(city, o.city) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map(({ o }) => o);
  const faqs = layout.buildFaqs(city, e, pv, st, r.policy);
  const place = {
    '@type': 'Place',
    name: `${city.name}, ${city.state}`,
    geo: { '@type': 'GeoCoordinates', latitude: city.lat, longitude: city.lon },
    address: { '@type': 'PostalAddress', addressLocality: city.name, addressRegion: city.state, addressCountry: 'US' }
  };
  const body = `${layout.buildBreadcrumbs(trail)}
<h1>Solar Panels in ${layout.escapeHtml(city.name)}, ${city.state}: Cost, Payback &amp; Savings</h1>
${layout.buildAnswerLede(city, e, st, r.policy)}
${layout.buildSummary(city, e, pv, r.costScope, r.policy)}
${layout.buildLeadGen(city)}
${layout.buildProductionChart(city, e)}
${layout.buildCalculator({
  heading: `Solar payback calculator for ${layout.escapeHtml(city.name)}`,
  intro: `Pre-filled with ${layout.escapeHtml(city.name)}'s sunshine and ${layout.escapeHtml(layout.possessive(st.priceOwner || stateName(city.state)))} average electricity price. Enter your own bill and an installer's price per watt to see your payback.`,
  kwhPerKw: pv.kwhPerKw,
  priceCents: st.priceCents,
  monthlyBill: (st.monthlyKwh * st.priceCents) / 100,
  costPerWatt: e.costPerWatt,
  exportCents: r.policy.exportCents,
  feePerKwMonth: r.policy.feePerKwMonth,
  selfUse: m.policies.selfConsumption
})}
${layout.buildComparison(city, e, { statePeers: ss.peers.map((p) => ({ city: p.city })), stateMedianKwh: ss.medianKwh, usMedianKwh: m.usMedianKwh, pv })}
${layout.buildIncentives(city, e, st, r.policy, m.policies.selfConsumption)}
${layout.buildFaqSection(faqs)}
${layout.buildNearby(nearby.map((o) => ({ city: o.city, e: o.e })))}
${guidesLib.buildGuideLinks(cityGuides(r.policy))}`;
  return page({
    title: layout.buildCityTitle(city),
    description: layout.buildCityDescription(city, e),
    pathName: layout.cityPath(city),
    bodyHtml: body,
    jsonLdHtml: jsonLd([place, layout.buildFaqJsonLd(faqs), breadcrumbLd(trail)])
  });
}

/** Guides most relevant to a city: export rules first where they bite. */
function cityGuides(policy) {
  const order = policy.type === 'net-billing'
    ? ['net-metering-vs-net-billing', 'solar-battery-worth-it', 'is-solar-worth-it-2026', 'how-to-read-a-solar-quote', 'solar-lease-vs-buy']
    : ['is-solar-worth-it-2026', 'how-to-read-a-solar-quote', 'solar-lease-vs-buy', 'net-metering-vs-net-billing', 'solar-battery-worth-it'];
  const bySlug = new Map(GUIDES.map((g) => [g.slug, g]));
  return order.map((s) => bySlug.get(s)).filter(Boolean);
}

function renderState(ss) {
  const trail = [
    { label: 'Home', href: '/' },
    { label: ss.name, href: layout.statePath(ss.abbr) }
  ];
  const rows = ss.peers;
  const best = rows[0];
  const pathName = layout.statePath(ss.abbr);
  const body = `${layout.buildBreadcrumbs(trail)}
<h1>Solar Panel Cost &amp; Payback in ${layout.escapeHtml(ss.name)}</h1>
<p class="lede">Home solar in ${layout.escapeHtml(ss.name)} pays back in a median <strong>${layout.years(ss.medianPayback === 99 ? null : ss.medianPayback)}</strong> across the ${layout.num(ss.count)} places we cover, at an average electricity price of ${layout.cents(ss.priceCents)}/kWh and about $${ss.costPerWatt.toFixed(2)} per watt installed.${ss.policy.type === 'net-billing' ? ` Power sent back to the grid earns only about ${layout.cents(ss.policy.exportCents)}/kWh (${layout.escapeHtml(ss.policy.label)}), which lengthens payback.` : ''} ${best ? `${layout.escapeHtml(best.city.name)} has the fastest payback (${layout.years(best.e.payback)}).` : ''}</p>
<section class="card">
<h2>Solar estimates for ${layout.escapeHtml(ss.name)} cities and towns</h2>
<p>Sorted by fastest payback. Each figure is for a system sized to an average ${layout.escapeHtml(ss.name)} home (${layout.num(ss.monthlyKwh)} kWh/month).</p>
${layout.buildStateTable(rows)}
</section>`;
  return page({
    title: `Solar Panel Cost & Payback in ${ss.name} (${layout.buildYear()})`,
    description: `Solar payback for ${ss.count} ${ss.name} cities: median ${layout.years(ss.medianPayback === 99 ? null : ss.medianPayback)} at ${layout.cents(ss.priceCents)}/kWh. Costs, savings and production by city.`,
    pathName,
    bodyHtml: body,
    jsonLdHtml: jsonLd([breadcrumbLd(trail)])
  });
}

function stateTableRows(m) {
  return [...m.stateStats.values()].map((s) => ({ ...s, medianPayback: s.medianPayback === 99 ? null : s.medianPayback }));
}

function renderStatesIndex(m) {
  const states = stateTableRows(m).sort((a, b) => (a.medianPayback ?? 99) - (b.medianPayback ?? 99));
  const body = `<h1>Solar Payback by State</h1>
<p class="lede">States ranked by median payback for a typical home system. Electricity price does most of the sorting: sunshine varies far less between states than power bills do.</p>
<section class="card">${layout.buildStatesTable(states)}</section>`;
  return page({
    title: `Solar Payback by State (${layout.buildYear()}): All 50 States Ranked`,
    description: 'Every US state ranked by how fast home solar pays for itself, with electricity prices, installed cost per watt and city-level estimates.',
    pathName: '/states/',
    bodyHtml: body
  });
}

function calculatorStateOptions(m, selected) {
  return [...m.stateStats.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      abbr: s.abbr,
      name: s.name,
      kwhPerKw: Math.round(s.medianKwh),
      priceCents: s.priceCents,
      monthlyBill: (s.monthlyKwh * s.priceCents) / 100,
      costPerWatt: s.costPerWatt,
      exportCents: s.policy.exportCents,
      feePerKwMonth: s.policy.feePerKwMonth,
      selected: s.abbr === selected
    }));
}

function renderCalculatorPage(m) {
  const opts = calculatorStateOptions(m, m.stateStats.has('CA') ? 'CA' : [...m.stateStats.keys()][0]);
  const sel = opts.find((o) => o.selected);
  const body = `<h1>Solar Panel Calculator: Size, Cost &amp; Payback</h1>
<p class="lede">Pick your state, enter your monthly electric bill, and see how many panels you need, what they cost, and how long they take to pay for themselves. For a more precise number, open your city's page — it uses local sunshine instead of the state median.</p>
${layout.buildCalculator({
  heading: 'Solar payback calculator',
  intro: 'State values are medians across the places we cover. Replace the price per watt with a real installer quote when you have one.',
  kwhPerKw: sel.kwhPerKw,
  priceCents: sel.priceCents,
  monthlyBill: sel.monthlyBill,
  costPerWatt: sel.costPerWatt,
  exportCents: sel.exportCents,
  feePerKwMonth: sel.feePerKwMonth,
  selfUse: m.policies.selfConsumption,
  stateOptions: opts
})}
<section class="card">
<h2>How many solar panels do I need?</h2>
<p>Divide your yearly electricity use (kWh) by how much one kW of panels produces where you live, then divide by the panel size. Example: 10,800 kWh a year ÷ 1,300 kWh per kW = 8.3 kW, or 21 panels of ${config.assumptions.panelWatts} W. Sunny Southwest cities produce 1,600–1,800 kWh per kW; the cloudy Pacific Northwest about 1,100.</p>
<h2>What this calculator leaves out</h2>
<p>It uses each state's rules for power you send back to the grid — full retail credit under net metering, or a lower export credit where utilities have moved to net billing — and assumes no federal tax credit (it ended for systems installed after 2025) and no battery. See the <a href="${layout.escapeHtml(layout.url('/methodology/'))}">methodology</a> for every assumption.</p>
</section>`;
  return page({
    title: `Solar Panel Calculator: Cost, Size & Payback (${layout.buildYear()})`,
    description: 'Free solar calculator: enter your electric bill and state to estimate system size, panel count, cost, payback period and 25-year savings.',
    pathName: '/solar-calculator/',
    bodyHtml: body
  });
}

function renderHome(m) {
  const biggest = [...m.rows].sort((a, b) => (b.city.population || 0) - (a.city.population || 0)).slice(0, 25);
  const states = stateTableRows(m).sort((a, b) => a.name.localeCompare(b.name));
  const body = `<h1>Is Solar Worth It Where You Live?</h1>
<p class="lede">Cost, payback and 25-year savings for home solar in ${layout.num(m.rows.length)} US cities and towns — from public sunshine, electricity-price and installed-cost data, with no federal tax credit assumed (it ended after 2025).</p>
<section class="card">${layout.buildSearchWidget()}</section>
<section class="card">
<h2>Largest cities</h2>
${layout.buildStateTable(biggest)}
</section>
<section class="card">
<h2>Solar by state</h2>
<ul class="states-az">${states.map((s) => `<li><a href="${layout.escapeHtml(layout.url(layout.statePath(s.abbr)))}">${layout.escapeHtml(s.name)}</a></li>`).join('')}</ul>
<p><a href="${layout.escapeHtml(layout.url('/states/'))}">All states ranked by payback →</a> &middot; <a href="${layout.escapeHtml(layout.url('/solar-calculator/'))}">Solar calculator →</a></p>
</section>
${guidesLib.buildGuideLinks(GUIDES, 8)}`;
  return page({
    title: `${config.siteName}: Solar Panel Cost & Payback by City (${layout.buildYear()})`,
    description: `Is solar worth it in your city? Cost, payback period and 25-year savings for home solar in ${layout.num(m.rows.length)} US cities, from NREL, EIA and Berkeley Lab data.`,
    pathName: '/',
    bodyHtml: body,
    jsonLdHtml: jsonLd([{ '@type': 'WebSite', name: config.siteName, url: `${SITE_URL}/` }])
  });
}

function renderSimple(pathName, title, description, bodyHtml, robots) {
  return page({ title, description, pathName, bodyHtml, robots });
}

// ---------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------
function writePage(rel, html) {
  const dir = path.join(SITE_DIR, ...rel.split('/').filter(Boolean));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

function main() {
  const mode = process.argv[2] || 'sample';
  basePathLib.setBasePath(process.env.BASE_PATH || '');
  setShellDefaults({ headExtraHtml: buildHeadExtras() });

  const m = loadModel();
  PAGE_SOURCES = { priceAsOf: m.statesData.priceAsOf };
  const coverage = m.rows.length / m.cities.length;
  console.log(`Solar render (${mode}): ${m.rows.length}/${m.cities.length} cities have PVWatts data (${(coverage * 100).toFixed(1)}%), ${m.stateStats.size} states`);
  if (mode === 'full' && coverage < 0.95) {
    throw new Error('full build needs >=95% PVWatts coverage; run scripts/03-pvwatts.js all');
  }

  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'templates', 'style.css'), path.join(SITE_DIR, 'style.css'));

  const cityResult = renderCollection(m.rows, {
    render: (r) => renderCity(r, m),
    outDir: (r) => [r.city.stateSlug, r.city.slug],
    siteDir: SITE_DIR,
    label: 'city pages'
  });
  for (const ss of m.stateStats.values()) writePage(layout.statePath(ss.abbr), renderState(ss));
  writePage('/states/', renderStatesIndex(m));
  writePage('/solar-calculator/', renderCalculatorPage(m));
  writePage('/', renderHome(m));
  const guideUrls = guidesLib.renderGuides({ guides: GUIDES, m, page, writePage, siteUrl: SITE_URL });
  fs.writeFileSync(path.join(SITE_DIR, 'search.json'), JSON.stringify(m.rows.map((r) => [r.city.name, r.city.state, layout.url(layout.cityPath(r.city))])), 'utf8');
  writePage('/methodology/', renderSimple('/methodology/', 'How Our Solar Estimates Are Calculated', 'Data sources and assumptions behind every solar cost, production and payback estimate on this site.', layout.buildMethodologyBody(m.statesData, m.installedCost, m.policies)));
  writePage('/about/', renderSimple('/about/', `About ${config.siteName}`, `What ${config.siteName} is, where its data comes from, and how it is funded.`, layout.buildAboutBody(m.rows.length, config.contactEmail)));
  writePage('/privacy/', renderSimple('/privacy/', 'Privacy Policy', `${config.siteName} privacy policy: hosting, analytics and advertising disclosures.`, layout.buildPrivacyBody(config.contactEmail)));
  writePage('/contact/', renderSimple('/contact/', 'Contact', `Contact ${config.siteName}.`, layout.buildContactBody(config.contactEmail)));
  fs.writeFileSync(
    path.join(SITE_DIR, '404.html'),
    renderSimple('/404.html', 'Page not found', 'Page not found.', `<h1>Page not found</h1><section class="card"><p>Try the <a href="${layout.escapeHtml(layout.url('/'))}">city search</a> or the <a href="${layout.escapeHtml(layout.url('/solar-calculator/'))}">solar calculator</a>.</p></section>`, 'noindex'),
    'utf8'
  );

  const urls = ['/', '/states/', '/solar-calculator/', '/methodology/', '/about/', ...guideUrls, ...[...m.stateStats.keys()].map(layout.statePath), ...m.rows.map((r) => layout.cityPath(r.city))];
  fs.writeFileSync(path.join(SITE_DIR, 'sitemap.xml'), buildSitemapXml(urls, SITE_URL), 'utf8');
  fs.writeFileSync(path.join(SITE_DIR, 'robots.txt'), buildRobotsTxt(SITE_URL), 'utf8');
  if (config.adsensePublisherId) {
    fs.writeFileSync(path.join(SITE_DIR, 'ads.txt'), `google.com, ${config.adsensePublisherId}, DIRECT, f08c47fec0942fa0\n`, 'utf8');
  }
  const staticDir = path.join(__dirname, '..', 'static');
  for (const name of fs.existsSync(staticDir) ? fs.readdirSync(staticDir) : []) {
    fs.copyFileSync(path.join(staticDir, name), path.join(SITE_DIR, name));
  }

  // Spot-validate a few pages.
  const checks = m.rows.slice(0, 5).map((r) => path.join(SITE_DIR, r.city.stateSlug, r.city.slug, 'index.html'));
  checks.push(path.join(SITE_DIR, 'index.html'), path.join(SITE_DIR, 'solar-calculator', 'index.html'));
  let problems = 0;
  for (const f of checks) {
    const res = validateBasicPage(fs.readFileSync(f, 'utf8'));
    const issues = Array.isArray(res) ? res : (res && res.issues) || [];
    if (issues.length) {
      problems += issues.length;
      console.log(`  validate ${path.relative(SITE_DIR, f)}: ${issues.join('; ')}`);
    }
  }

  if (cityResult.errors.length) {
    for (const { item, error } of cityResult.errors.slice(0, 10)) console.error(`  ERROR ${item.city.stateSlug}/${item.city.slug}: ${error}`);
    throw new Error(`${cityResult.errors.length} city pages failed`);
  }
  console.log(`Done: ${cityResult.ok} city pages, ${m.stateStats.size} state pages, ${countFilesRecursive(SITE_DIR)} files, ${urls.length} sitemap URLs, ${problems} validation issues`);
}

main();
