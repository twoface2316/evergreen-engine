'use strict';

/**
 * niches/frost/scripts/render.js — Phase 3/4 page renderer for the frost
 * niche.
 *
 * renderCityPage(cityRecord, allCities, crops) -> HTML string for one city.
 *
 * IMPORTANT ADAPTER NOTE: data/cities-frost.json (Phase 1 output) stores
 * frost fields as `lastSpringFrost` / `firstFallFrost`, but scripts/calendar.js
 * (Phase 2, pure function, NOT modified here) expects `lastFrost` / `firstFrost`
 * on the city record it's given. toCalendarCityRecord() below maps between
 * the two shapes; it does not touch calendar.js or the Phase 1 pipeline.
 *
 * This module owns frost-niche markup assembly and orchestration; the
 * niche-agnostic building blocks it composes (HTML document shell,
 * sitemap/robots builders, search-index builder, render-loop scaffolding,
 * base-path prefixing, basic HTML validation) live under engine/lib and
 * are required below.
 *
 * CLI usage (from repo root):
 *   node niches/frost/scripts/render.js sample
 *     -> renders Chicago IL, Denver CO, Miami FL, Seattle WA, Oswego IL to
 *        sites/frost/{stateSlug}/{citySlug}/index.html and copies
 *        templates/style.css to sites/frost/style.css, then runs basic
 *        validation checks and prints a report.
 *   node niches/frost/scripts/render.js full
 *     -> full site generation into sites/frost/.
 *
 * Env vars:
 *   SITE_URL   Full origin (+ sub-path) used for canonical URLs, JSON-LD,
 *              and sitemap.xml/robots.txt, e.g.
 *              https://user.github.io/evergreen-engine (no trailing slash).
 *   BASE_PATH  Sub-path the site is served under, e.g. /evergreen-engine.
 *              Only needed when SITE_URL's path isn't the origin root;
 *              prefixes every root-relative internal href. See
 *              engine/lib/base-path.js.
 */

const fs = require('fs');
const path = require('path');

const { computeCalendar } = require('./calendar.js');
const layout = require('../templates/layout.js');

const basePathLib = require('../../../engine/lib/base-path.js');
const { buildPageShell } = require('../../../engine/lib/page-shell.js');
const { buildSitemapXml, buildRobotsTxt } = require('../../../engine/lib/sitemap.js');
const { buildSearchIndex, firstLetterBucketer } = require('../../../engine/lib/search-index.js');
const { renderCollection, countFilesRecursive } = require('../../../engine/lib/render-loop.js');
const { validateBasicPage } = require('../../../engine/lib/html-validate.js');
const nicheConfig = require('../config.js');

const SITE_URL = process.env.SITE_URL || nicheConfig.defaultSiteUrl;

// ---------------------------------------------------------------------
// Phase 5 -> city record enrichment: attach `zone` (USDA hardiness zone
// string, e.g. "6a", or null) from data/zones.json, keyed by the same
// "<stateSlug>/<slug>" the Phase 5 pipeline (scripts/05-zones.js) used when
// it read data/cities-frost.json directly. IMPORTANT: this must run before
// runFull()'s slug-disambiguation step below (which can rewrite a handful
// of `.slug` values for same-state name collisions) -- zones.json keys are
// the *original*, pre-disambiguation slugs.
// ---------------------------------------------------------------------
function enrichCitiesWithZones(cities, dataDir) {
  const zonesPath = path.join(dataDir, 'zones.json');
  if (!fs.existsSync(zonesPath)) {
    console.warn('  WARNING: data/zones.json not found; rendering all city pages with zone = null. Run scripts/05-zones.js first.');
    for (const city of cities) city.zone = null;
    return { zonedCount: 0 };
  }
  const zones = JSON.parse(fs.readFileSync(zonesPath, 'utf8'));
  let zonedCount = 0;
  for (const city of cities) {
    const zone = zones[`${city.stateSlug}/${city.slug}`];
    city.zone = zone != null ? zone : null;
    if (city.zone) zonedCount++;
  }
  return { zonedCount };
}

// ---------------------------------------------------------------------
// Phase 1 -> Phase 2 field-name adapter (see module header note above).
// ---------------------------------------------------------------------
function toCalendarCityRecord(city) {
  return Object.assign({}, city, {
    lastFrost: city.lastSpringFrost,
    firstFrost: city.firstFallFrost
  });
}

// ---------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------
function buildJsonLd(city, faqs) {
  const url = `${SITE_URL}/${city.stateSlug}/${city.slug}/`;

  const place = {
    '@type': 'Place',
    name: `${city.name}, ${city.state}`,
    geo: { '@type': 'GeoCoordinates', latitude: city.lat, longitude: city.lon },
    address: {
      '@type': 'PostalAddress',
      addressLocality: city.name,
      addressRegion: city.state,
      addressCountry: 'US'
    }
  };

  const dataset = {
    '@type': 'Dataset',
    name: `Frost and temperature normals for ${city.name}, ${city.state}`,
    description: `1991-2020 NOAA climate normals frost-date and monthly temperature data for the ${city.station.name} station, matched to ${city.name}, ${city.state}.`,
    url,
    creator: {
      '@type': 'Organization',
      name: 'NOAA National Centers for Environmental Information',
      url: 'https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals'
    },
    spatialCoverage: place
  };

  const faqPage = layout.buildFaqJsonLd(faqs);

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [place, dataset, faqPage]
  };

  return `<script type="application/ld+json">${JSON.stringify(graph)}</script>`;
}

// ---------------------------------------------------------------------
// Lede paragraph
// ---------------------------------------------------------------------
function buildLede(city) {
  if (city.frostFree) {
    return `${city.name}, ${city.state} rarely if ever sees frost. Here's what that means for planting, plus year-round monthly temperature normals and a 42-crop garden calendar for the area.`;
  }
  return `Plan your garden around ${city.name}, ${city.state}'s typical frost-free growing season, using NOAA climate normals and a 42-crop planting calendar built for this location.`;
}

// ---------------------------------------------------------------------
// renderCityPage
// ---------------------------------------------------------------------
function renderCityPage(cityRecord, allCities, crops) {
  const city = cityRecord;
  const calendarCity = toCalendarCityRecord(city);
  const calendarEntries = computeCalendar(calendarCity, crops);

  const title = layout.buildTitle(city);
  const description = layout.buildDescription(city);
  const faqSection = layout.buildFaqSection(city);
  const jsonLd = buildJsonLd(city, faqSection.faqs);

  const canonical = `${SITE_URL}/${city.stateSlug}/${city.slug}/`;

  const bodyHtml = `${layout.buildBreadcrumbs(city)}
<h1>Frost Dates &amp; Planting Calendar for ${layout.escapeHtml(city.name)}, ${layout.escapeHtml(city.state)}</h1>
<p class="lede">${layout.escapeHtml(buildLede(city))}</p>
${layout.buildSummaryBox(city)}
${layout.buildCountdownWidget(city)}
<h2>Monthly Temperatures</h2>
${layout.buildChartCard(city)}
<h2>Planting Calendar</h2>
${layout.buildCalendarTable(city, calendarEntries)}
<h2>Frequently Asked Questions</h2>
${faqSection.html}
<h2>Nearby Cities in ${layout.escapeHtml(city.state)}</h2>
${layout.buildNearbyCities(city, allCities)}`;

  return buildPageShell({
    title,
    description,
    canonical,
    stylesheetHref: basePathLib.href('/style.css'),
    jsonLdHtml: jsonLd,
    headerHtml: layout.buildSiteHeader(city),
    bodyHtml,
    footerHtml: layout.buildFooter()
  });
}

// ---------------------------------------------------------------------
// Phase 4 — state index, homepage, methodology, 404, sitemap, robots
// ---------------------------------------------------------------------

function renderStatePage(stateAbbr, stateCities) {
  const name = layout.stateName(stateAbbr);
  const stateSlug = stateCities[0].stateSlug;
  const title = layout.buildStateTitle(name);
  const description = layout.buildStateDescription(name, stateCities.length);
  const canonical = `${SITE_URL}/${stateSlug}/`;

  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: name }])}
<h1>Frost Dates &amp; Planting Calendars in ${layout.escapeHtml(name)}</h1>
<p class="lede">Typical last spring frost, first fall frost, and growing-season length for ${stateCities.length} cities in ${layout.escapeHtml(name)}, based on NOAA 1991&ndash;2020 climate normals. Click a city for its full frost-date summary, monthly temperature chart, and 42-crop planting calendar.</p>
${layout.buildStateTable(stateCities)}`;

  return buildPageShell({
    title,
    description,
    canonical,
    stylesheetHref: basePathLib.href('/style.css'),
    headerHtml: layout.buildSiteHeader(),
    bodyHtml,
    footerHtml: layout.buildFooter()
  });
}

/** {n: name, s: state abbr, u: url} — the compact record shared by the homepage search index. */
function buildCompactCityIndex(cities) {
  return cities.map((c) => ({
    n: c.name,
    s: c.state,
    u: basePathLib.href(`/${c.stateSlug}/${c.slug}/`)
  }));
}

/** Decide inline vs. split search-index mode and write /search-index/*.json files to disk if split. */
function prepareSearchIndex(cities, siteDir) {
  const compact = buildCompactCityIndex(cities);
  return buildSearchIndex(compact, siteDir, { bucketKeyFn: firstLetterBucketer('n') });
}

function renderHomePage(cities, searchMode, searchPayload, statesMeta, topCities) {
  const title = 'FrostCal — Frost Dates & Planting Calendars for US Cities';
  const description = `Free frost dates, growing season length, and a 42-crop planting calendar for ${cities.length.toLocaleString()} US cities, based on NOAA climate normals.`;
  const canonical = `${SITE_URL}/`;

  const bodyHtml = `<div class="hero">
<h1>Frost Dates &amp; Planting Calendars for ${cities.length.toLocaleString()} US Cities</h1>
<p class="lede">FrostCal turns NOAA's 1991&ndash;2020 climate normals into plain-English last-frost and first-frost dates, growing-season length, and a free 42-crop planting calendar for your city.</p>
</div>
${layout.buildSearchWidget(searchMode, searchPayload)}
<h2>Top 100 Cities by Population</h2>
${layout.buildTopCitiesTable(topCities)}
<h2>How This Works</h2>
<p>Every city page is built from the nearest NOAA weather station with valid climate data, using 30 years of normals to estimate typical, safe, and risky frost dates, plus a 42-crop planting calendar timed off those dates. <a href="${layout.escapeHtml(basePathLib.href('/methodology/'))}">Read the full methodology</a> for how station matching and the probability ranges work.</p>
<h2>Browse by State</h2>
${layout.buildStatesAZList(statesMeta)}`;

  return buildPageShell({
    title,
    description,
    canonical,
    stylesheetHref: basePathLib.href('/style.css'),
    headerHtml: layout.buildSiteHeader(),
    bodyHtml,
    footerHtml: layout.buildFooter()
  });
}

function renderMethodologyPage() {
  const title = 'Methodology: How FrostCal Calculates Frost Dates';
  const description = 'How FrostCal turns NOAA climate normals into frost date probabilities, station-to-city matching, and planting calendar offsets.';
  const canonical = `${SITE_URL}/methodology/`;

  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'Methodology' }])}
${layout.buildMethodologyBody()}`;

  return buildPageShell({
    title,
    description,
    canonical,
    stylesheetHref: basePathLib.href('/style.css'),
    headerHtml: layout.buildSiteHeader(),
    bodyHtml,
    footerHtml: layout.buildFooter()
  });
}

function renderPrivacyPage() {
  const title = 'Privacy Policy — FrostCal';
  const description = 'FrostCal privacy policy: a static reference site with no accounts or first-party tracking; hosting, analytics, and advertising disclosures.';
  const canonical = `${SITE_URL}/privacy/`;

  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'Privacy Policy' }])}
${layout.buildPrivacyBody(nicheConfig.contactEmail)}`;

  return buildPageShell({
    title,
    description,
    canonical,
    stylesheetHref: basePathLib.href('/style.css'),
    headerHtml: layout.buildSiteHeader(),
    bodyHtml,
    footerHtml: layout.buildFooter()
  });
}

function renderContactPage() {
  const title = 'Contact — FrostCal';
  const description = 'Contact FrostCal with questions, corrections, or feedback about frost dates and planting calendars.';
  const canonical = `${SITE_URL}/contact/`;

  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'Contact' }])}
${layout.buildContactBody(nicheConfig.contactEmail)}`;

  return buildPageShell({
    title,
    description,
    canonical,
    stylesheetHref: basePathLib.href('/style.css'),
    headerHtml: layout.buildSiteHeader(),
    bodyHtml,
    footerHtml: layout.buildFooter()
  });
}

function render404Page() {
  const title = 'Page Not Found — FrostCal';
  const description = 'The page you were looking for could not be found. Search FrostCal for frost dates and planting calendars by city.';

  return buildPageShell({
    title,
    description,
    canonical: null,
    robotsContent: 'noindex, follow',
    stylesheetHref: basePathLib.href('/style.css'),
    headerHtml: layout.buildSiteHeader(),
    bodyHtml: layout.build404Body(),
    footerHtml: layout.buildFooter()
  });
}

// ---------------------------------------------------------------------
// Basic validation helpers (Phase 3 acceptance: "valid HTML" == no crash,
// balanced tags, chart present, calendar rows present, <100KB). Generic
// checks live in engine/lib/html-validate.js; this wraps it with the
// frost-specific "crop row count" check.
// ---------------------------------------------------------------------
function validatePage(html, city, crops) {
  const { issues, sizeBytes } = validateBasicPage(html);
  if (!html.includes('<svg')) issues.push('Missing inline SVG chart');
  const rowCount = (html.match(/<td class="crop-name">/g) || []).length;
  if (rowCount !== crops.length) {
    issues.push(`Calendar table has ${rowCount} crop rows, expected ${crops.length}`);
  }
  return { issues, sizeBytes, rowCount };
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------
function runSample() {
  basePathLib.setBasePath(process.env.BASE_PATH || '');

  const dataDir = path.join(__dirname, '..', 'data');
  const templatesDir = path.join(__dirname, '..', 'templates');
  const siteDir = path.join(__dirname, '..', '..', '..', 'sites', 'frost');

  const cities = require(path.join(dataDir, 'cities-frost.json'));
  const crops = require(path.join(dataDir, 'crops.json'));
  enrichCitiesWithZones(cities, dataDir);

  const targets = [
    ['Chicago', 'IL'],
    ['Denver', 'CO'],
    ['Miami', 'FL'],
    ['Seattle', 'WA'],
    ['Oswego', 'IL']
  ];

  fs.mkdirSync(siteDir, { recursive: true });
  fs.copyFileSync(path.join(templatesDir, 'style.css'), path.join(siteDir, 'style.css'));

  console.log('FrostCal Phase 3 sample render\n');
  let allOk = true;

  for (const [name, state] of targets) {
    const city = cities.find((c) => c.name === name && c.state === state);
    if (!city) {
      console.error(`MISSING city in cities-frost.json: ${name}, ${state}`);
      allOk = false;
      continue;
    }

    const html = renderCityPage(city, cities, crops);
    const outDir = path.join(siteDir, city.stateSlug, city.slug);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'index.html');
    fs.writeFileSync(outPath, html, 'utf8');

    const { issues, sizeBytes, rowCount } = validatePage(html, city, crops);
    const kb = (sizeBytes / 1024).toFixed(1);
    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    if (issues.length > 0) allOk = false;

    console.log(
      `[${status}] ${name}, ${state} (${city.frostFree ? 'frost-free' : 'frost'}) -> ${path.relative(process.cwd(), outPath)}`
    );
    console.log(`   size: ${kb} KB, crop rows: ${rowCount}/${crops.length}`);
    if (issues.length > 0) {
      for (const issue of issues) console.log(`   - ${issue}`);
    }
  }

  console.log(`\nstyle.css copied to ${path.relative(process.cwd(), path.join(siteDir, 'style.css'))}`);
  console.log(allOk ? '\nAll sample pages PASS validation.' : '\nSome sample pages FAILED validation (see above).');
  if (!allOk) process.exitCode = 1;
}

function runFull() {
  basePathLib.setBasePath(process.env.BASE_PATH || '');

  const dataDir = path.join(__dirname, '..', 'data');
  const templatesDir = path.join(__dirname, '..', 'templates');
  const siteDir = path.join(__dirname, '..', '..', '..', 'sites', 'frost');

  const cities = require(path.join(dataDir, 'cities-frost.json'));
  const crops = require(path.join(dataDir, 'crops.json'));

  console.log(`FrostCal Phase 4 full generation — ${cities.length} cities\n`);
  if (basePathLib.getBasePath()) console.log(`  base path: ${basePathLib.getBasePath()}`);
  console.log(`  site URL: ${SITE_URL}\n`);
  const startTime = Date.now();

  // Phase 5: attach USDA hardiness zone before any slug mutation (see
  // enrichCitiesWithZones header comment).
  const { zonedCount } = enrichCitiesWithZones(cities, dataDir);
  console.log(`  zones: ${zonedCount}/${cities.length} cities have a USDA hardiness zone (${((zonedCount / cities.length) * 100).toFixed(1)}%)`);

  // A handful of GeoNames entries share the same name within a state (e.g.
  // two distinct "Vincent, CA" places), which would otherwise collide on
  // the same /{stateSlug}/{slug}/ output path and silently overwrite one
  // another. Disambiguate slugs for 2nd+ occurrences in place, sorted by
  // population desc first so the more prominent place keeps the bare slug.
  // This mutates the shared in-memory `cities` array before any rendering,
  // so every downstream link (nearby cities, state table, sitemap, search
  // index) stays consistent with the disambiguated slug.
  cities.sort((a, b) => (b.population || 0) - (a.population || 0));
  const seenSlugs = new Map(); // "stateSlug/slug" -> count
  let slugCollisions = 0;
  for (const city of cities) {
    const key = `${city.stateSlug}/${city.slug}`;
    const n = (seenSlugs.get(key) || 0) + 1;
    seenSlugs.set(key, n);
    if (n > 1) {
      const newSlug = `${city.slug}-${n}`;
      console.log(`  slug collision: /${key}/ -> disambiguated to /${city.stateSlug}/${newSlug}/ (${city.name}, ${city.state}, pop ${city.population})`);
      city.slug = newSlug;
      slugCollisions++;
    }
  }

  fs.mkdirSync(siteDir, { recursive: true });
  fs.copyFileSync(path.join(templatesDir, 'style.css'), path.join(siteDir, 'style.css'));

  // GitHub Pages reads CNAME from the deployed artifact root; without it a
  // custom domain is dropped on the next deploy.
  if (nicheConfig.customDomain) {
    fs.writeFileSync(path.join(siteDir, 'CNAME'), `${nicheConfig.customDomain}\n`, 'utf8');
    console.log(`  CNAME: ${nicheConfig.customDomain}`);
  }

  // --- 1. City pages -----------------------------------------------------
  const { ok: cityOk, errors: cityErrors } = renderCollection(cities, {
    siteDir,
    render: (city) => renderCityPage(city, cities, crops),
    outDir: (city) => [city.stateSlug, city.slug],
    label: 'city pages'
  });

  // --- 2. State index pages -----------------------------------------------
  const stateGroups = new Map(); // stateAbbr -> cities[]
  for (const city of cities) {
    if (!stateGroups.has(city.state)) stateGroups.set(city.state, []);
    stateGroups.get(city.state).push(city);
  }

  let statePagesOk = 0;
  const statesMeta = [];
  for (const [stateAbbr, stateCities] of stateGroups) {
    const stateSlug = stateCities[0].stateSlug;
    const html = renderStatePage(stateAbbr, stateCities);
    const outDir = path.join(siteDir, stateSlug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    statePagesOk++;
    statesMeta.push({ stateSlug, name: layout.stateName(stateAbbr), count: stateCities.length });
  }
  console.log(`  state pages: ${statePagesOk}/${stateGroups.size}`);

  // --- 3. Homepage (incl. search index) -----------------------------------
  const { mode: searchMode, payload: searchPayload, bytes: searchBytes } = prepareSearchIndex(cities, siteDir);
  const topCities = cities.slice().sort((a, b) => (b.population || 0) - (a.population || 0)).slice(0, 100);
  const homeHtml = renderHomePage(cities, searchMode, searchPayload, statesMeta, topCities);
  fs.writeFileSync(path.join(siteDir, 'index.html'), homeHtml, 'utf8');
  console.log(`  homepage: written (search index ${searchMode}, ${(searchBytes / 1024).toFixed(1)} KB raw)`);

  // --- 4. Methodology page -------------------------------------------------
  const methodologyDir = path.join(siteDir, 'methodology');
  fs.mkdirSync(methodologyDir, { recursive: true });
  fs.writeFileSync(path.join(methodologyDir, 'index.html'), renderMethodologyPage(), 'utf8');
  console.log('  methodology page: written');

  for (const [dir, renderFn] of [['privacy', renderPrivacyPage], ['contact', renderContactPage]]) {
    const pageDir = path.join(siteDir, dir);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, 'index.html'), renderFn(), 'utf8');
    console.log(`  ${dir} page: written`);
  }

  // --- 5. sitemap.xml, robots.txt, 404.html --------------------------------
  const urls = ['/', '/methodology/', '/privacy/', '/contact/'];
  for (const { stateSlug } of statesMeta) urls.push(`/${stateSlug}/`);
  for (const city of cities) urls.push(`/${city.stateSlug}/${city.slug}/`);
  fs.writeFileSync(path.join(siteDir, 'sitemap.xml'), buildSitemapXml(urls, SITE_URL), 'utf8');
  fs.writeFileSync(path.join(siteDir, 'robots.txt'), buildRobotsTxt(SITE_URL), 'utf8');
  fs.writeFileSync(path.join(siteDir, '404.html'), render404Page(), 'utf8');
  console.log(`  sitemap.xml: ${urls.length} URLs`);
  console.log('  robots.txt, 404.html: written');

  // --- 6. Report -------------------------------------------------------------
  const elapsedMs = Date.now() - startTime;
  const totalFiles = countFilesRecursive(siteDir);

  console.log('\n=== FrostCal Phase 4 generation report ===');
  console.log(`City pages:  ${cityOk} OK / ${cityErrors.length} failed (of ${cities.length})`);
  console.log(`USDA zones:  ${zonedCount}/${cities.length} (${((zonedCount / cities.length) * 100).toFixed(1)}%)`);
  if (cityErrors.length > 0) {
    console.log('  Errors:');
    for (const e of cityErrors.slice(0, 20)) console.log(`   - ${e.item.name}, ${e.item.state}: ${e.error}`);
    if (cityErrors.length > 20) console.log(`   ...and ${cityErrors.length - 20} more`);
  }
  console.log(`State pages: ${statePagesOk} (of ${stateGroups.size} states)`);
  console.log(`Slug collisions disambiguated: ${slugCollisions}`);
  console.log(`Homepage search index: ${searchMode} (${(searchBytes / 1024).toFixed(1)} KB raw compact JSON)`);
  console.log(`Sitemap URLs: ${urls.length}`);
  console.log(`Total files under sites/frost/: ${totalFiles} (budget < 15,000)`);
  console.log(`Wall time: ${(elapsedMs / 1000).toFixed(1)}s`);

  if (cityErrors.length > 0 || totalFiles >= 15000) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  const mode = process.argv[2];
  if (mode === 'sample') {
    runSample();
  } else if (mode === 'full') {
    runFull();
  } else {
    console.log('Usage: node niches/frost/scripts/render.js sample|full');
    process.exitCode = 1;
  }
}

module.exports = {
  renderCityPage,
  toCalendarCityRecord,
  renderStatePage,
  renderHomePage,
  renderMethodologyPage,
  render404Page,
  buildCompactCityIndex,
  buildSitemapXml,
  buildRobotsTxt,
  SITE_URL
};
