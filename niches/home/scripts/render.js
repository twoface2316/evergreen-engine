'use strict';

/**
 * niches/home/scripts/render.js — builds the water + radon site into
 * sites/home/.
 *
 * Inputs (committed, from the numbered pipeline scripts):
 *   data/cities.json    01-cities.js   places + county
 *   data/water.json     02-water.js    utilities, violations, lead/copper
 *   data/radon.json     03-radon.js    county radon zones
 *   data/hardness.json  04-hardness.js
 *
 * A place gets a page only if it has a matched utility or a hardness value;
 * radon alone is too thin to stand as a page.
 *
 *   node niches/home/scripts/render.js            # full build
 *   node niches/home/scripts/render.js sample     # 8 cities + chrome, for review
 *
 * Env: SITE_URL (canonical origin, no trailing slash), BASE_PATH (sub-path deploys only).
 */

const fs = require('fs');
const path = require('path');

const layout = require('../templates/layout.js');
const config = require('../config.js');
const { recentHealth, toGpg } = require('./model.js');
const { stateName } = require('./states.js');

const basePathLib = require('../../../engine/lib/base-path.js');
const { buildPageShell, setShellDefaults } = require('../../../engine/lib/page-shell.js');
const { buildSitemapXml, buildRobotsTxt } = require('../../../engine/lib/sitemap.js');
const { renderCollection, countFilesRecursive } = require('../../../engine/lib/render-loop.js');
const { validateBasicPage } = require('../../../engine/lib/html-validate.js');

const SITE_URL = (process.env.SITE_URL || config.defaultSiteUrl).replace(/\/+$/, '');
const ROOT = path.join(__dirname, '..', '..', '..');
const DATA = path.join(__dirname, '..', 'data');
const SITE_DIR = path.join(ROOT, 'sites', 'home');
const SAMPLE = ['il/chicago', 'nj/newark', 'az/phoenix', 'ny/new-york-city', 'mi/flint', 'ct/bridgeport', 'tx/houston', 'il/oswego'];
const TODAY = new Date().toISOString().slice(0, 10);

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function buildHeadExtras() {
  const parts = [];
  if (config.goatcounterCode) parts.push(`<script data-goatcounter="https://${config.goatcounterCode}.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`);
  if (config.adsensePublisherId) parts.push(`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${config.adsensePublisherId}" crossorigin="anonymous"></script>`);
  return parts.join('\n');
}

const jsonLd = (graph) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`;
const breadcrumbLd = (trail) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.label, item: `${SITE_URL}${t.href}` }))
});

/** "2026Q2" -> "mid-2026" style label for footers. */
function quarterLabel(q) {
  const m = /^(\d{4})Q([1-4])$/.exec(q || '');
  return m ? `${['March', 'June', 'September', 'December'][Number(m[2]) - 1]} ${m[1]}` : q;
}

function loadModel() {
  const cities = readJson('cities.json');
  const water = readJson('water.json');
  const radon = readJson('radon.json');
  const hardness = readJson('hardness.json');
  const windowYear = water.windowStart.slice(0, 4);

  const rows = [];
  for (const city of cities) {
    const key = `${city.stateSlug}/${city.slug}`;
    const ids = water.cities[key] || [];
    const sys = ids.map((id) => ({ id, ...water.systems[id] }));
    const d = {
      primary: sys[0] || null,
      others: sys.slice(1),
      hardness: hardness[key] || null,
      radon: city.countyFips ? radon[city.countyFips] || null : null,
      windowYear
    };
    if (!d.primary && !d.hardness) continue;
    d.recentHealth = d.primary ? recentHealth(d.primary.violations.list, TODAY, 3).length : 0;
    rows.push({ city, d, key });
  }
  const byState = new Map();
  for (const r of rows) {
    if (!byState.has(r.city.state)) byState.set(r.city.state, []);
    byState.get(r.city.state).push(r);
  }
  for (const list of byState.values()) list.sort((a, b) => (b.city.population || 0) - (a.city.population || 0));
  return { cities, rows, byState, sources: { waterAsOf: quarterLabel(water.asOf), windowStart: water.windowStart } };
}

let SOURCES = null;

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
    footerHtml: layout.buildFooter(SOURCES)
  });
}

function renderCity(r, m) {
  const { city, d } = r;
  const trail = [
    { label: 'Home', href: '/' },
    { label: stateName(city.state), href: layout.statePath(city.state) },
    { label: city.name, href: layout.cityPath(city) }
  ];
  const nearby = m.byState
    .get(city.state)
    .filter((o) => o !== r)
    .map((o) => ({ o, dist: haversineKm(city, o.city) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8)
    .map(({ o }) => o);
  const faqs = layout.buildFaqs(city, d);
  const place = {
    '@type': 'Place',
    name: `${city.name}, ${city.state}`,
    geo: { '@type': 'GeoCoordinates', latitude: city.lat, longitude: city.lon },
    address: { '@type': 'PostalAddress', addressLocality: city.name, addressRegion: city.state, addressCountry: 'US' }
  };
  // Soft water (< 3.5 gpg) needs no softener; skip the calculator there.
  const softener = d.hardness && toGpg(d.hardness.mgL) >= 3.5
    ? layout.buildSoftenerCalc({
        heading: `Water softener size for ${layout.escapeHtml(city.name)}`,
        intro: `Pre-filled with ${layout.escapeHtml(city.name)}'s hardness. Change the household size to see the softener capacity you need.`,
        gpg: toGpg(d.hardness.mgL)
      })
    : '';
  const body = `${layout.buildBreadcrumbs(trail)}
<h1>Is ${layout.escapeHtml(city.name)}, ${city.state} Tap Water Safe?</h1>
${layout.buildLede(city, d)}
${layout.buildSummary(city, d)}
${layout.buildUtility(city, d)}
${layout.buildViolationTable(d)}
${layout.buildLeadCopper(city, d)}
${layout.buildProducts(d)}
${layout.buildHardness(city, d)}
${softener}
${layout.buildRadon(city, d)}
${layout.buildFaqSection(faqs)}
${layout.buildNearby(nearby)}`;
  return page({
    title: layout.buildCityTitle(city),
    description: layout.buildCityDescription(city, d),
    pathName: layout.cityPath(city),
    bodyHtml: body,
    jsonLdHtml: jsonLd([place, ...(faqs.length ? [layout.buildFaqJsonLd(faqs)] : []), breadcrumbLd(trail)])
  });
}

function stateSummary(abbr, list) {
  const withUtil = list.filter((r) => r.d.primary);
  const clean = withUtil.filter((r) => r.d.primary.violations.healthBased === 0).length;
  const hard = list.filter((r) => r.d.hardness);
  const medGpg = hard.length ? [...hard.map((r) => toGpg(r.d.hardness.mgL))].sort((a, b) => a - b)[Math.floor(hard.length / 2)] : null;
  const zones = list.reduce((m, r) => (r.d.radon ? ((m[r.d.radon.zone] = (m[r.d.radon.zone] || 0) + 1), m) : m), {});
  return { abbr, name: stateName(abbr), count: list.length, withUtil: withUtil.length, clean, medGpg, zones };
}

function renderState(abbr, list) {
  const s = stateSummary(abbr, list);
  const trail = [
    { label: 'Home', href: '/' },
    { label: s.name, href: layout.statePath(abbr) }
  ];
  const zoneText = Object.entries(s.zones)
    .sort()
    .map(([z, n]) => `${n} in zone ${z}`)
    .join(', ');
  const body = `${layout.buildBreadcrumbs(trail)}
<h1>${layout.escapeHtml(s.name)} Tap Water Quality, Hardness &amp; Radon</h1>
<p class="lede">Of ${layout.num(s.withUtil)} ${layout.escapeHtml(s.name)} places matched to a water utility, <strong>${layout.num(s.clean)}</strong> have no health-based EPA violations since ${layout.escapeHtml(SOURCES.windowStart.slice(0, 4))}.${s.medGpg != null ? ` Median hardness is ${layout.fix1(s.medGpg)} grains per gallon.` : ''}${zoneText ? ` Radon: ${zoneText} (places by county zone).` : ''}</p>
<section class="card"><h2>Water and radon by place</h2><p>Largest places first.</p>${layout.buildCityTable(list)}</section>`;
  return page({
    title: `${s.name} Tap Water Quality & Hardness by City (${layout.buildYear()})`,
    description: `Tap water violations, lead results, hardness and radon zones for ${s.count} ${s.name} cities and towns, from EPA records.`,
    pathName: layout.statePath(abbr),
    bodyHtml: body,
    jsonLdHtml: jsonLd([breadcrumbLd(trail)])
  });
}

function renderStatesIndex(m) {
  const states = [...m.byState.entries()].map(([abbr, list]) => stateSummary(abbr, list)).sort((a, b) => a.name.localeCompare(b.name));
  const body = `<h1>Tap Water Quality by State</h1>
<section class="card"><div class="table-wrap"><table class="data">
<thead><tr><th>State</th><th>Places</th><th>No health violations</th><th>Median hardness</th></tr></thead>
<tbody>${states
    .map((s) => `<tr><td><a href="${layout.escapeHtml(layout.url(layout.statePath(s.abbr)))}">${layout.escapeHtml(s.name)}</a></td><td>${layout.num(s.count)}</td><td>${s.withUtil ? `${Math.round((100 * s.clean) / s.withUtil)}%` : '—'}</td><td>${s.medGpg != null ? `${layout.fix1(s.medGpg)} gpg` : '—'}</td></tr>`)
    .join('')}</tbody></table></div></section>`;
  return page({
    title: `Tap Water Quality by State (${layout.buildYear()})`,
    description: 'Every US state: share of places with no health-based drinking water violations, median water hardness, and city-level reports.',
    pathName: '/states/',
    bodyHtml: body
  });
}

function renderSoftenerPage() {
  const body = `<h1>Water Softener Size Calculator</h1>
<p class="lede">Enter your household size and water hardness to find the softener capacity you need. Don't know your hardness? Find your city's value from the <a href="${layout.escapeHtml(layout.url('/'))}">city search</a>, or check your utility's water quality report.</p>
${layout.buildSoftenerCalc({ heading: 'Softener sizing', intro: 'Grains per gallon = mg/L ÷ 17.1. Add 1 grain per gallon for every 1 ppm of iron.', gpg: 10 })}
<section class="card"><h2>How softener sizing works</h2>
<p>A softener's grain rating is how much hardness it removes before it has to regenerate. Multiply your daily water use by your hardness to get grains per day, then by how many days you want between regenerations — about a week is typical. Oversizing slightly wastes little; undersizing means frequent regeneration and more salt.</p></section>`;
  return page({
    title: `Water Softener Size Calculator (${layout.buildYear()})`,
    description: 'Free water softener sizing calculator: enter household size and water hardness to get the grain capacity you need.',
    pathName: '/water-softener-calculator/',
    bodyHtml: body
  });
}

function renderHome(m) {
  const big = m.rows.filter((r) => (r.city.population || 0) >= 100000);
  const hardest = big.filter((r) => r.d.hardness).sort((a, b) => b.d.hardness.mgL - a.d.hardness.mgL).slice(0, 15);
  const largest = [...m.rows].sort((a, b) => (b.city.population || 0) - (a.city.population || 0)).slice(0, 20);
  const states = [...m.byState.keys()].sort((a, b) => stateName(a).localeCompare(stateName(b)));
  const body = `<h1>What's in Your Tap Water?</h1>
<p class="lede">EPA violation history, lead and copper results, water hardness and radon risk for ${layout.num(m.rows.length)} US cities and towns — straight from public records.</p>
<section class="card">${layout.buildSearchWidget()}</section>
<section class="card"><h2>Largest cities</h2>${layout.buildCityTable(largest)}</section>
<section class="card"><h2>Hardest water among big cities</h2>${layout.buildCityTable(hardest)}</section>
<section class="card"><h2>Browse by state</h2><ul class="states-az">${states.map((a) => `<li><a href="${layout.escapeHtml(layout.url(layout.statePath(a)))}">${layout.escapeHtml(stateName(a))}</a></li>`).join('')}</ul>
<p><a href="${layout.escapeHtml(layout.url('/water-softener-calculator/'))}">Water softener calculator →</a></p></section>`;
  return page({
    title: `${config.siteName}: Tap Water Quality, Hardness & Radon by City`,
    description: `Is your tap water safe? EPA violations, lead results, hardness and radon zones for ${layout.num(m.rows.length)} US cities and towns.`,
    pathName: '/',
    bodyHtml: body,
    jsonLdHtml: jsonLd([{ '@type': 'WebSite', name: config.siteName, url: `${SITE_URL}/` }])
  });
}

function writePage(rel, html) {
  const dir = path.join(SITE_DIR, ...rel.split('/').filter(Boolean));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

function main() {
  const mode = process.argv[2] || 'full';
  basePathLib.setBasePath(process.env.BASE_PATH || '');
  setShellDefaults({ headExtraHtml: buildHeadExtras() });
  const m = loadModel();
  SOURCES = m.sources;
  console.log(`Home render (${mode}): ${m.rows.length}/${m.cities.length} places have a utility or hardness value; ${m.byState.size} states`);

  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'templates', 'style.css'), path.join(SITE_DIR, 'style.css'));

  const cityRows = mode === 'sample' ? m.rows.filter((r) => SAMPLE.includes(r.key)) : m.rows;
  const result = renderCollection(cityRows, {
    render: (r) => renderCity(r, m),
    outDir: (r) => [r.city.stateSlug, r.city.slug],
    siteDir: SITE_DIR,
    label: 'city pages'
  });
  const stateAbbrs = mode === 'sample' ? [...new Set(cityRows.map((r) => r.city.state))] : [...m.byState.keys()];
  for (const abbr of stateAbbrs) writePage(layout.statePath(abbr), renderState(abbr, m.byState.get(abbr)));
  writePage('/states/', renderStatesIndex(m));
  writePage('/water-softener-calculator/', renderSoftenerPage());
  writePage('/', renderHome(m));
  fs.writeFileSync(path.join(SITE_DIR, 'search.json'), JSON.stringify(m.rows.map((r) => [r.city.name, r.city.state, layout.url(layout.cityPath(r.city))])), 'utf8');
  const simple = (p, t, dsc, b) => writePage(p, page({ title: t, description: dsc, pathName: p, bodyHtml: b }));
  simple('/methodology/', 'Where Our Water and Radon Data Comes From', 'Sources and methods behind the utility, violation, lead, hardness and radon data on this site.', layout.buildMethodologyBody(m.sources));
  simple('/about/', `About ${config.siteName}`, `What ${config.siteName} is and where its data comes from.`, layout.buildAboutBody(m.rows.length, config.contactEmail));
  simple('/privacy/', 'Privacy Policy', `${config.siteName} privacy policy: hosting, analytics, advertising and affiliate disclosures.`, layout.buildPrivacyBody(config.contactEmail));
  simple('/contact/', 'Contact', `Contact ${config.siteName}.`, layout.buildContactBody(config.contactEmail));
  fs.writeFileSync(
    path.join(SITE_DIR, '404.html'),
    page({ title: 'Page not found', description: 'Page not found.', pathName: '/404.html', robots: 'noindex', bodyHtml: `<h1>Page not found</h1><section class="card"><p>Try the <a href="${layout.escapeHtml(layout.url('/'))}">city search</a>.</p></section>` }),
    'utf8'
  );

  const urls = ['/', '/states/', '/water-softener-calculator/', '/methodology/', '/about/', ...stateAbbrs.map(layout.statePath), ...cityRows.map((r) => layout.cityPath(r.city))];
  fs.writeFileSync(path.join(SITE_DIR, 'sitemap.xml'), buildSitemapXml(urls, SITE_URL), 'utf8');
  fs.writeFileSync(path.join(SITE_DIR, 'robots.txt'), buildRobotsTxt(SITE_URL), 'utf8');
  if (config.adsensePublisherId) fs.writeFileSync(path.join(SITE_DIR, 'ads.txt'), `google.com, ${config.adsensePublisherId}, DIRECT, f08c47fec0942fa0\n`, 'utf8');
  const staticDir = path.join(__dirname, '..', 'static');
  for (const name of fs.existsSync(staticDir) ? fs.readdirSync(staticDir) : []) fs.copyFileSync(path.join(staticDir, name), path.join(SITE_DIR, name));

  let problems = 0;
  const checks = [...cityRows.slice(0, 8).map((r) => path.join(SITE_DIR, r.city.stateSlug, r.city.slug, 'index.html')), path.join(SITE_DIR, 'index.html')];
  for (const f of checks) {
    const { issues } = validateBasicPage(fs.readFileSync(f, 'utf8'));
    if (issues.length) {
      problems += issues.length;
      console.log(`  validate ${path.relative(SITE_DIR, f)}: ${issues.join('; ')}`);
    }
  }
  if (result.errors.length) {
    for (const { item, error } of result.errors.slice(0, 10)) console.error(`  ERROR ${item.key}: ${error}`);
    throw new Error(`${result.errors.length} city pages failed`);
  }
  console.log(`Done: ${result.ok} city pages, ${stateAbbrs.length} state pages, ${countFilesRecursive(SITE_DIR)} files, ${urls.length} sitemap URLs, ${problems} validation issues`);
}

main();
