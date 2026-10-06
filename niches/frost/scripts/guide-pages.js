'use strict';

/**
 * niches/frost/scripts/guide-pages.js — the spring-content page types that
 * sit alongside the per-city pages:
 *
 *   /zones/                       USDA hardiness zone index
 *   /zones/{zone}/                zone frost dates + planting calendar
 *   /plant/                       crop index
 *   /plant/{crop}/                crop planting dates by state
 *   /plant/{crop}/{state-name}/   crop planting dates by city within a state
 *
 * plus the static data behind the homepage "frost dates by ZIP code / use my
 * location" tool (/zip/{zip3}.json shards and /geo/cities.json).
 *
 * Every renderer here returns the list of root-relative URLs it wrote so
 * render.js can add them to sitemap.xml.
 */

const fs = require('fs');
const path = require('path');

const { computeCalendar } = require('./calendar.js');
const layout = require('../templates/layout.js');
const basePathLib = require('../../../engine/lib/base-path.js');
const { buildPageShell } = require('../../../engine/lib/page-shell.js');
const nicheConfig = require('../config.js');
const crops = require('../data/crops.json');
const affiliate = require('./affiliate.js');

const SITE_URL = process.env.SITE_URL || nicheConfig.defaultSiteUrl;
const { escapeHtml, formatDateShort, formatDateLong, parseMonthDay, pickLength } = layout;
const href = (p) => escapeHtml(basePathLib.href(p));

// ---------------------------------------------------------------------
// Crop naming
// ---------------------------------------------------------------------

const PLURALS = {
  tomato: 'Tomatoes', pepper: 'Peppers', cucumber: 'Cucumbers', pumpkin: 'Pumpkins',
  'green-bean': 'Green Beans', pea: 'Peas', carrot: 'Carrots', beet: 'Beets',
  radish: 'Radishes', turnip: 'Turnips', onion: 'Onions', potato: 'Potatoes',
  'sweet-potato': 'Sweet Potatoes', sunflower: 'Sunflowers', zinnia: 'Zinnias',
  marigold: 'Marigolds', nasturtium: 'Nasturtiums', dahlia: 'Dahlias'
};

/** "Tomatoes", "Swiss Chard", "Garlic" — for titles and headings. */
function cropTitle(crop) {
  return PLURALS[crop.slug] || crop.name;
}

/** "tomatoes", "Swiss chard", "Brussels sprouts" — for running text. */
function cropLower(crop) {
  return cropTitle(crop)
    .split(' ')
    .map((w) => (w === 'Swiss' || w === 'Brussels' ? w : w.toLowerCase()))
    .join(' ');
}

const WINDOW_VERBS = {
  seedStart: 'start seeds indoors',
  directSow: 'sow outdoors',
  transplant: 'transplant outdoors',
  fallPlanting: 'plant for a fall crop'
};

/** True for crops planted only in fall (garlic): no spring offsets at all. */
function isFallOnly(crop) {
  return !crop.seedStartOffsetWeeks && !crop.transplantOffsetWeeks && !crop.directSowOffsetWeeks && !!crop.fallPlanting;
}

function windowVerb(crop, type) {
  if (type === 'transplant' && crop.method === 'transplant') return 'plant outdoors';
  if (type === 'fallPlanting' && isFallOnly(crop)) return 'plant in fall';
  return WINDOW_VERBS[type];
}

const WINDOW_TYPES = ['seedStart', 'directSow', 'transplant', 'fallPlanting'];

/** The outdoor planting window that answers "when do I plant X". */
const MAIN_PRIORITY = ['transplant', 'directSow', 'fallPlanting', 'seedStart'];

// ---------------------------------------------------------------------
// Date math (non-leap reference year, seasons that straddle New Year)
// ---------------------------------------------------------------------

function doy(month, day) {
  return Math.round((Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1)) / 86400000);
}

/** Sort key for a window start. Spring windows starting Sep-Dec belong to the previous winter; fall windows starting Jan-Mar to the following one. */
function windowKey(type, w) {
  const d = doy(w.startMonth, w.startDay);
  if (type === 'fallPlanting') return w.startMonth <= 3 ? d + 365 : d;
  return w.startMonth >= 9 ? d - 365 : d;
}

function dateKey(str) {
  const md = parseMonthDay(str);
  return md ? doy(md.month, md.day) : null;
}

/** Median of an array of "2001-MM-DD" strings, returned in the same format. */
function medianDate(strs) {
  const keys = strs.map(dateKey).filter((k) => k != null).sort((a, b) => a - b);
  if (!keys.length) return null;
  const k = keys[Math.floor(keys.length / 2)];
  const d = new Date(Date.UTC(2001, 0, 1) + k * 86400000);
  return `2001-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------
// Calendar cache: computeCalendar() once per city, keyed by output path.
// ---------------------------------------------------------------------

function buildCalendarIndex(cities) {
  const index = new Map();
  for (const city of cities) {
    const entries = computeCalendar(
      Object.assign({}, city, { lastFrost: city.lastSpringFrost, firstFrost: city.firstFallFrost }),
      crops
    );
    const bySlug = {};
    for (const e of entries) bySlug[e.slug] = e;
    index.set(city, bySlug);
  }
  return index;
}

/**
 * Statewide (or any group) summary of one crop window across frost-affected
 * cities: the median city's window plus the earliest and latest starts.
 */
function summarizeWindow(group, calIndex, crop, type) {
  const rows = [];
  for (const city of group) {
    if (city.frostFree) continue;
    const e = calIndex.get(city)[crop.slug];
    if (e && e[type]) rows.push({ city, w: e[type], key: windowKey(type, e[type]) });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.key - b.key);
  return {
    median: rows[Math.floor(rows.length / 2)],
    earliest: rows[0],
    latest: rows[rows.length - 1],
    count: rows.length
  };
}

function mainWindowType(summaries) {
  return MAIN_PRIORITY.find((t) => summaries[t]) || null;
}

function startLabel(w) {
  return formatDateShort(`2001-${String(w.startMonth).padStart(2, '0')}-${String(w.startDay).padStart(2, '0')}`);
}

// ---------------------------------------------------------------------
// Shared page chrome
// ---------------------------------------------------------------------

function shell({ title, description, canonicalPath, bodyHtml, jsonLd }) {
  return buildPageShell({
    title,
    description,
    canonical: `${SITE_URL}${canonicalPath}`,
    stylesheetHref: basePathLib.href('/style.css'),
    jsonLdHtml: jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : '',
    headerHtml: layout.buildSiteHeader(),
    bodyHtml,
    footerHtml: layout.buildFooter()
  });
}

function writePage(siteDir, rootRelPath, html) {
  const dir = path.join(siteDir, ...rootRelPath.split('/').filter(Boolean));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

function faqBlock(faqs) {
  return faqs
    .map((f) => `<div class="faq-item">
    <h3>${escapeHtml(f.q)}</h3>
    <p>${escapeHtml(f.a)}</p>
  </div>`)
    .join('');
}

function cityLink(c) {
  return `<a href="${href(`/${c.stateSlug}/${c.slug}/`)}">${escapeHtml(c.name)}</a>`;
}

// ---------------------------------------------------------------------
// Crop link grid (used on state pages and crop pages)
// ---------------------------------------------------------------------

function buildCropLinkGrid(stateAbbr, excludeSlug) {
  const items = crops
    .filter((c) => c.slug !== excludeSlug)
    .map((c) => `<li><a href="${href(layout.cropGuidePath(c.slug, stateAbbr))}">${escapeHtml(cropTitle(c))}</a></li>`)
    .join('');
  return `<ul class="link-grid">${items}</ul>`;
}

// ---------------------------------------------------------------------
// Crop x state pages, crop hubs, crop index
// ---------------------------------------------------------------------

function cropStateCopy(crop, stateName, group, calIndex) {
  const summaries = {};
  for (const t of WINDOW_TYPES) summaries[t] = summarizeWindow(group, calIndex, crop, t);
  const main = mainWindowType(summaries);
  const frostFreeCities = group.filter((c) => c.frostFree);
  const plural = cropLower(crop);

  if (!main) {
    const note = frostFreeCities.length
      ? calIndex.get(frostFreeCities[0])[crop.slug].frostFreeNote
      : null;
    return {
      summaries, main,
      answer: `Most of ${stateName} is essentially frost-free, so ${plural} aren't timed around frost dates. ${note || ''}`.trim(),
      short: `${stateName} is mostly frost-free: ${plural} can be grown much of the year, timed around heat and rainfall.`
    };
  }

  const clauses = [];
  for (const t of WINDOW_TYPES) {
    if (!summaries[t] || t === 'fallPlanting') continue;
    clauses.push(`${windowVerb(crop, t)} ${summaries[t].median.w.label}`);
  }
  const m = summaries[main];
  let answer;
  if (clauses.length) {
    answer = `In a typical ${stateName} location, ${clauses.join(', then ')}.`;
  } else {
    answer = `In a typical ${stateName} location, ${windowVerb(crop, main)} ${m.median.w.label}.`;
  }
  if (m.count > 1 && m.earliest.key !== m.latest.key) {
    answer += ` Across the state, the ${main === 'fallPlanting' ? 'fall planting' : 'outdoor planting'} window starts as early as ${startLabel(m.earliest.w)} in ${m.earliest.city.name} and as late as ${startLabel(m.latest.w)} in ${m.latest.city.name}.`;
  }
  if (summaries.fallPlanting && main !== 'fallPlanting') {
    answer += ` For a fall crop, plant around ${summaries.fallPlanting.median.w.label}.`;
  }
  if (frostFreeCities.length) {
    answer += ` ${frostFreeCities.length} ${frostFreeCities.length === 1 ? 'city' : 'cities'} in ${stateName} ${frostFreeCities.length === 1 ? 'is' : 'are'} essentially frost-free and can plant on a year-round schedule.`;
  }
  const short = m.count > 1 && m.earliest.key !== m.latest.key
    ? `${windowVerb(crop, main)} ${startLabel(m.earliest.w)} (${m.earliest.city.name}) to ${startLabel(m.latest.w)} (${m.latest.city.name})`
    : `${windowVerb(crop, main)} ${m.median.w.label}`;
  return { summaries, main, answer, short };
}

function renderCropStatePage(crop, stateAbbr, group, calIndex) {
  const stateName = layout.stateName(stateAbbr);
  const stateSlugFull = layout.stateNameSlug(stateAbbr);
  const title = cropTitle(crop);
  const plural = cropLower(crop);
  const copy = cropStateCopy(crop, stateName, group, calIndex);
  const pagePath = `/plant/${crop.slug}/${stateSlugFull}/`;

  const pageTitle = pickLength([
    `When to Plant ${title} in ${stateName}: Dates by City`,
    `When to Plant ${title} in ${stateName}`,
    `${title} Planting Dates: ${stateName}`
  ], 60);
  const shortSentence = (copy.short.charAt(0).toUpperCase() + copy.short.slice(1)).replace(/\.$/, '');
  const description = pickLength([
    `When to plant ${plural} in ${stateName}: ${shortSentence}. Planting dates for ${group.length} cities from NOAA frost normals.`,
    `When to plant ${plural} in ${stateName}: ${shortSentence}.`,
    `Planting dates for ${plural} in ${group.length} ${stateName} cities, from NOAA frost normals.`
  ], 155);

  // City table: most populous cities, only the window columns this crop uses.
  const top = group.slice().sort((a, b) => (b.population || 0) - (a.population || 0)).slice(0, 30);
  const cols = WINDOW_TYPES.filter((t) => copy.summaries[t]);
  const colLabels = { seedStart: 'Start indoors', directSow: 'Direct sow', transplant: crop.method === 'transplant' ? 'Plant outdoors' : 'Transplant', fallPlanting: 'Fall planting' };
  const rows = top.map((c) => {
    const e = calIndex.get(c)[crop.slug];
    if (c.frostFree) {
      return `<tr><td>${cityLink(c)}</td><td colspan="${Math.max(cols.length, 1)}" class="note-cell">Frost-free: year-round planting</td></tr>`;
    }
    return `<tr><td>${cityLink(c)}</td>${cols.map((t) => `<td>${escapeHtml(e[t] ? e[t].label : '—')}</td>`).join('')}</tr>`;
  }).join('');
  const head = `<tr><th>City</th>${(cols.length ? cols : ['note']).map((t) => `<th>${colLabels[t] || 'Planting'}</th>`).join('')}</tr>`;

  const dtm = crop.daysToMaturity ? `${crop.daysToMaturity[0]}–${crop.daysToMaturity[1]} days` : null;
  const r = layout.stateFrostRanges(group);
  const faqs = [
    { q: `When should I plant ${plural} in ${stateName}?`, a: copy.answer }
  ];
  if (r) {
    faqs.push({
      q: `When is the last frost in ${stateName}?`,
      a: `The average last spring frost in ${stateName} ranges from ${formatDateLong(r.lastEarly.lastSpringFrost.p50)} in ${r.lastEarly.name} to ${formatDateLong(r.lastLate.lastSpringFrost.p50)} in ${r.lastLate.name}, based on NOAA 1991–2020 climate normals.`
    });
  }
  if (dtm) {
    faqs.push({ q: `How long do ${plural} take to grow?`, a: `${title} typically take ${dtm} from planting to harvest. ${crop.notes || ''}`.trim() });
  }

  const bodyHtml = `${layout.buildGenericBreadcrumbs([
    { label: 'Home', href: '/' },
    { label: 'When to Plant', href: '/plant/' },
    { label: title, href: `/plant/${crop.slug}/` },
    { label: stateName }
  ])}
<h1>When to Plant ${escapeHtml(title)} in ${escapeHtml(stateName)}</h1>
<p class="lede answer">${escapeHtml(copy.answer)}</p>
<div class="fact-row">
  <div><span class="label">Method</span> ${escapeHtml(crop.method === 'indoor-start' ? 'Start indoors, then transplant' : crop.method === 'transplant' ? 'Plant out (slips, crowns, or tubers)' : 'Direct sow')}</div>
  ${dtm ? `<div><span class="label">Days to maturity</span> ${escapeHtml(dtm)}</div>` : ''}
</div>
${crop.notes ? `<p>${escapeHtml(crop.notes)}</p>` : ''}
<h2>${escapeHtml(title)} Planting Dates by City</h2>
<div class="table-scroll"><table class="calendar compact"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
<p class="table-hint">Showing the ${top.length} most populous of ${group.length} ${escapeHtml(stateName)} cities. Dates are estimates from each city's NOAA frost normals and university extension timing guidelines. <a href="${href(`/${group[0].stateSlug}/`)}">See all ${escapeHtml(stateName)} cities</a>.</p>
${affiliate.buildCropBox(crop, title, plural)}
<h2>Frequently Asked Questions</h2>
${faqBlock(faqs)}
<h2>Other Crops in ${escapeHtml(stateName)}</h2>
${buildCropLinkGrid(stateAbbr, crop.slug)}
<p><a href="${href(`/plant/${crop.slug}/`)}">When to plant ${escapeHtml(plural)} in other states</a></p>
<h2>Related Guides</h2>
<ul class="guide-list">
${copy.summaries.seedStart ? `<li><a href="${href('/guides/when-to-start-seeds-indoors/')}">When to start seeds indoors</a></li>
<li><a href="${href('/guides/harden-off-seedlings/')}">How to harden off seedlings</a></li>` : ''}
${copy.summaries.fallPlanting ? `<li><a href="${href('/guides/fall-garden-planting/')}">Fall garden planting</a></li>` : ''}
<li><a href="${href('/guides/protect-plants-from-frost/')}">How to protect plants from frost</a></li>
</ul>`;

  return {
    path: pagePath,
    copy,
    html: shell({
      title: pageTitle,
      description,
      canonicalPath: pagePath,
      bodyHtml,
      jsonLd: { '@context': 'https://schema.org', ...layout.buildFaqJsonLd(faqs) }
    })
  };
}

function renderCropHub(crop, stateRows) {
  const title = cropTitle(crop);
  const plural = cropLower(crop);
  const pagePath = `/plant/${crop.slug}/`;
  const rows = stateRows
    .slice()
    .sort((a, b) => a.stateName.localeCompare(b.stateName))
    .map((s) => `<tr><td><a href="${href(s.path)}">${escapeHtml(s.stateName)}</a></td><td class="note-cell">${escapeHtml(s.copy.short.charAt(0).toUpperCase() + s.copy.short.slice(1))}</td></tr>`)
    .join('');
  const dtm = crop.daysToMaturity ? `${crop.daysToMaturity[0]}–${crop.daysToMaturity[1]} days` : null;
  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'When to Plant', href: '/plant/' }, { label: title }])}
<h1>When to Plant ${escapeHtml(title)}: Planting Dates by State</h1>
<p class="lede answer">${escapeHtml(`The right time to plant ${plural} depends on your local frost dates. ${crop.notes || ''}`.trim())}</p>
${dtm ? `<div class="fact-row"><div><span class="label">Days to maturity</span> ${escapeHtml(dtm)}</div></div>` : ''}
<h2>${escapeHtml(title)} Planting Windows by State</h2>
<div class="table-scroll"><table class="calendar compact"><thead><tr><th>State</th><th>Planting window across the state</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="table-hint">Pick a state for city-by-city dates. For the most precise dates, <a href="${href('/')}">look up your ZIP code</a>.</p>
${affiliate.buildCropBox(crop, title, plural)}
<h2>Other Crops</h2>
${buildCropLinkGrid(null, crop.slug)}`;
  return {
    path: pagePath,
    html: shell({
      title: pickLength([`When to Plant ${title}: Planting Dates by State`, `When to Plant ${title}`], 60),
      description: pickLength([
        `When to plant ${plural} in every US state, with city-by-city dates from NOAA frost normals and university extension timing guidelines.`,
        `When to plant ${plural} in every US state, by city.`
      ], 155),
      canonicalPath: pagePath,
      bodyHtml
    })
  };
}

function renderCropIndex() {
  const groups = { vegetable: 'Vegetables', herb: 'Herbs', flower: 'Flowers' };
  const sections = Object.entries(groups).map(([cat, label]) => {
    const items = crops.filter((c) => c.category === cat)
      .map((c) => `<li><a href="${href(`/plant/${c.slug}/`)}">${escapeHtml(cropTitle(c))}</a></li>`).join('');
    return `<h2>${label}</h2><ul class="link-grid">${items}</ul>`;
  }).join('\n');
  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'When to Plant' }])}
<h1>When to Plant: Vegetable, Herb, and Flower Planting Dates</h1>
<p class="lede answer">Planting dates for ${crops.length} common garden crops, calculated for every US state and city from NOAA frost normals. Pick a crop, then your state.</p>
${sections}`;
  return {
    path: '/plant/',
    html: shell({
      title: 'When to Plant Vegetables, Herbs & Flowers by State',
      description: `Planting dates for ${crops.length} vegetables, herbs, and flowers in every US state and 5,000+ cities, based on NOAA frost normals.`,
      canonicalPath: '/plant/',
      bodyHtml
    })
  };
}

function renderCropPages(cities, calIndex, siteDir) {
  const urls = [];
  const byState = new Map();
  for (const c of cities) {
    if (!byState.has(c.state)) byState.set(c.state, []);
    byState.get(c.state).push(c);
  }
  for (const crop of crops) {
    const stateRows = [];
    for (const [abbr, group] of byState) {
      if (!layout.hasCropGuide(abbr)) continue;
      const page = renderCropStatePage(crop, abbr, group, calIndex);
      writePage(siteDir, page.path, page.html);
      urls.push(page.path);
      stateRows.push({ stateName: layout.stateName(abbr), path: page.path, copy: page.copy });
    }
    const hub = renderCropHub(crop, stateRows);
    writePage(siteDir, hub.path, hub.html);
    urls.push(hub.path);
  }
  const index = renderCropIndex();
  writePage(siteDir, index.path, index.html);
  urls.push(index.path);
  return urls;
}

// ---------------------------------------------------------------------
// USDA hardiness zone pages
// ---------------------------------------------------------------------

function parseZone(z) {
  const m = /^(\d{1,2})([ab])?$/.exec(z || '');
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const half = m[2] === 'b' ? 1 : 0;
  const low = -60 + ((n - 1) * 2 + half) * 5;
  return { n, half, low, high: low + 5, order: n * 2 + half };
}

function fmtTemp(t) {
  return t < 0 ? `−${Math.abs(t)}°F` : `${t}°F`;
}

function renderZonePage(zone, group, allZones, siteDir) {
  const z = parseZone(zone);
  const pagePath = `/zones/${zone}/`;
  const frosty = group.filter((c) => !c.frostFree);
  const last = medianDate(frosty.map((c) => c.lastSpringFrost.p50));
  const first = medianDate(frosty.map((c) => c.firstFallFrost.p50));
  const allFrostFree = !last || !first;
  const winter = `${fmtTemp(z.low)} to ${fmtTemp(z.high)}`;

  const synthetic = {
    name: `Zone ${zone}`,
    state: null,
    frostFree: allFrostFree,
    lastSpringFrost: allFrostFree ? null : { p10: last, p50: last, p90: last },
    firstFallFrost: allFrostFree ? null : { p10: first, p50: first, p90: first }
  };
  const entries = computeCalendar(Object.assign({}, synthetic, { lastFrost: synthetic.lastSpringFrost, firstFrost: synthetic.firstFallFrost }), crops);

  const answer = allFrostFree
    ? `USDA Zone ${zone} has average coldest-winter lows of ${winter}. Cities in this zone are essentially frost-free, so planting is timed around heat and rainfall rather than frost.`
    : `USDA Zone ${zone} has average coldest-winter lows of ${winter}. Across the ${group.length} cities we track in this zone, the typical last spring frost is around ${formatDateLong(last)} and the typical first fall frost around ${formatDateLong(first)}.`;

  const states = new Map();
  for (const c of group) states.set(c.state, (states.get(c.state) || 0) + 1);
  const stateList = [...states.entries()].sort((a, b) => b[1] - a[1])
    .map(([abbr, n]) => `<li><a href="${href(`/${group.find((c) => c.state === abbr).stateSlug}/`)}">${escapeHtml(layout.stateName(abbr))}</a> <span class="count">(${n})</span></li>`).join('');

  const top = group.slice().sort((a, b) => (b.population || 0) - (a.population || 0)).slice(0, 40);
  const cityRows = top.map((c) => `<tr><td>${cityLink(c)}, ${escapeHtml(c.state)}</td><td>${c.frostFree ? 'Frost-free' : escapeHtml(formatDateShort(c.lastSpringFrost.p50))}</td><td>${c.frostFree ? 'Frost-free' : escapeHtml(formatDateShort(c.firstFallFrost.p50))}</td></tr>`).join('');

  const idx = allZones.indexOf(zone);
  const neighbors = [allZones[idx - 1], allZones[idx + 1]].filter(Boolean)
    .map((n) => `<a href="${href(`/zones/${n}/`)}">Zone ${escapeHtml(n)}</a>`).join(' &middot; ');

  const faqs = [
    { q: `What is the temperature range for Zone ${zone}?`, a: `Zone ${zone} is defined by an average annual extreme minimum winter temperature of ${winter} (USDA 2023 Plant Hardiness Zone Map).` }
  ];
  if (!allFrostFree) {
    faqs.push({ q: `When is the last frost in Zone ${zone}?`, a: `Typically around ${formatDateLong(last)}, though it varies by location. Hardiness zones measure winter cold, not frost timing, so two places in the same zone can have last frosts weeks apart — check your city's page for local dates.` });
    faqs.push({ q: `When is the first frost in Zone ${zone}?`, a: `Typically around ${formatDateLong(first)} across the cities we track in Zone ${zone}.` });
  }

  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'Hardiness Zones', href: '/zones/' }, { label: `Zone ${zone}` }])}
<h1>Zone ${escapeHtml(zone)} Frost Dates &amp; Planting Calendar</h1>
<p class="lede answer">${escapeHtml(answer)}</p>
<div class="fact-row">
  <div><span class="label">Winter low</span> ${escapeHtml(winter)}</div>
  ${allFrostFree ? '' : `<div><span class="label">Typical last frost</span> ${escapeHtml(formatDateLong(last))}</div><div><span class="label">Typical first frost</span> ${escapeHtml(formatDateLong(first))}</div>`}
  <div><span class="label">Cities</span> ${group.length}</div>
</div>
<p class="table-hint">Hardiness zones describe winter cold, not frost timing (<a href="${href('/guides/hardiness-zones-vs-frost-dates/')}">why that matters</a>). For dates specific to your town, <a href="${href('/')}">look up your ZIP code</a>.</p>
<h2>Zone ${escapeHtml(zone)} Planting Calendar</h2>
${layout.buildCalendarTable(synthetic, entries)}
${affiliate.buildSeasonBox()}
<h2>Cities in Zone ${escapeHtml(zone)}</h2>
<div class="table-scroll"><table class="calendar compact"><thead><tr><th>City</th><th>Last frost</th><th>First frost</th></tr></thead><tbody>${cityRows}</tbody></table></div>
<h3>States with Zone ${escapeHtml(zone)} cities</h3>
<ul class="state-az-list">${stateList}</ul>
<h2>Frequently Asked Questions</h2>
${faqBlock(faqs)}
${neighbors ? `<p>Neighboring zones: ${neighbors} &middot; <a href="${href('/zones/')}">All zones</a></p>` : ''}`;

  const description = allFrostFree
    ? pickLength([`USDA Zone ${zone} (winter lows ${winter}) is essentially frost-free. Year-round planting calendar for 42 crops and ${group.length} cities.`, `USDA Zone ${zone} planting calendar and cities.`], 155)
    : pickLength([`Zone ${zone} (winter lows ${winter}): typical last frost ${formatDateShort(last)}, first frost ${formatDateShort(first)}. Planting calendar for 42 crops and ${group.length} cities.`, `Zone ${zone} frost dates and planting calendar.`], 155);

  writePage(siteDir, pagePath, shell({
    title: `Zone ${zone} Frost Dates & Planting Calendar`,
    description,
    canonicalPath: pagePath,
    bodyHtml,
    jsonLd: { '@context': 'https://schema.org', ...layout.buildFaqJsonLd(faqs) }
  }));
  return { zone, winter, count: group.length, last, first, path: pagePath };
}

function renderZonePages(cities, siteDir) {
  const byZone = new Map();
  for (const c of cities) {
    if (!parseZone(c.zone)) continue;
    if (!byZone.has(c.zone)) byZone.set(c.zone, []);
    byZone.get(c.zone).push(c);
  }
  const zones = [...byZone.keys()].sort((a, b) => parseZone(a).order - parseZone(b).order);
  const metas = zones.map((z) => renderZonePage(z, byZone.get(z), zones, siteDir));

  const rows = metas.map((m) => `<tr><td><a href="${href(m.path)}">Zone ${escapeHtml(m.zone)}</a></td><td>${escapeHtml(m.winter)}</td><td>${m.last ? escapeHtml(formatDateShort(m.last)) : 'Frost-free'}</td><td>${m.first ? escapeHtml(formatDateShort(m.first)) : 'Frost-free'}</td><td>${m.count}</td></tr>`).join('');
  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'Hardiness Zones' }])}
<h1>USDA Hardiness Zones: Frost Dates &amp; Planting Calendars</h1>
<p class="lede answer">Typical frost dates and a planting calendar for each USDA hardiness zone, based on ${cities.length.toLocaleString('en-US')} US cities. Zones measure winter cold, so local frost dates within a zone can differ by weeks.</p>
<div class="table-scroll"><table class="calendar compact"><thead><tr><th>Zone</th><th>Winter low</th><th>Typical last frost</th><th>Typical first frost</th><th>Cities</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  writePage(siteDir, '/zones/', shell({
    title: 'USDA Hardiness Zones: Frost Dates & Planting Calendars',
    description: 'Typical last and first frost dates and a 42-crop planting calendar for every USDA hardiness zone, from 5,000+ US cities and NOAA climate normals.',
    canonicalPath: '/zones/',
    bodyHtml
  }));
  return ['/zones/', ...metas.map((m) => m.path)];
}

// ---------------------------------------------------------------------
// ZIP code + "use my location" lookup data
// ---------------------------------------------------------------------

/**
 * Writes /zip/{zip3}.json ({ "60601": "il/chicago", ... }) mapping every ZIP
 * centroid to its nearest city page within 150 km, and /geo/cities.json
 * ([[lat, lon, "il/chicago"], ...]) for browser geolocation.
 *
 * `places` includes folded neighborhoods: matching against them and then
 * resolving to their parent keeps a Harlem ZIP on New York City instead of
 * the nearest remaining page (which can be across a state line). When the
 * ZIP's state is known, cities in that state win over closer out-of-state ones.
 */
function writeLocateData(places, siteDir, zipCsvPath) {
  const pagePath = (c) => {
    const target = c.foldInto || c;
    return `${target.stateSlug}/${target.slug}`;
  };
  const cell = (lat, lon) => `${Math.floor(lat)},${Math.floor(lon)}`;
  const grid = new Map();
  for (const c of places) {
    const k = cell(c.lat, c.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
  }

  function nearest(lat, lon, state) {
    let best = null;
    let bestKm = Infinity;
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dy), Math.abs(dx)) !== r) continue;
          const bucket = grid.get(cell(lat + dy, lon + dx));
          if (!bucket) continue;
          for (const c of bucket) {
            if (state && c.state !== state) continue;
            const km = layout.haversineKm(lat, lon, c.lat, c.lon);
            if (km < bestKm) { bestKm = km; best = c; }
          }
        }
      }
      if (best && bestKm < r * 80) break;
    }
    return bestKm <= 150 ? best : null;
  }

  const shards = new Map();
  let mapped = 0;
  let total = 0;
  const lines = fs.readFileSync(zipCsvPath, 'utf8').split(/\r?\n/).slice(1);
  for (const line of lines) {
    const [zip, latS, lonS, state] = line.split(',');
    if (!/^\d{5}$/.test(zip || '')) continue;
    total++;
    const lat = parseFloat(latS);
    const lon = parseFloat(lonS);
    const c = (state && nearest(lat, lon, state)) || nearest(lat, lon, null);
    if (!c) continue;
    mapped++;
    const key = zip.slice(0, 3);
    if (!shards.has(key)) shards.set(key, {});
    shards.get(key)[zip] = pagePath(c);
  }

  const zipDir = path.join(siteDir, 'zip');
  fs.rmSync(zipDir, { recursive: true, force: true });
  fs.mkdirSync(zipDir, { recursive: true });
  for (const [key, map] of shards) {
    fs.writeFileSync(path.join(zipDir, `${key}.json`), JSON.stringify(map), 'utf8');
  }

  const geoDir = path.join(siteDir, 'geo');
  fs.mkdirSync(geoDir, { recursive: true });
  const geo = places.map((c) => [Math.round(c.lat * 1000) / 1000, Math.round(c.lon * 1000) / 1000, pagePath(c)]);
  fs.writeFileSync(path.join(geoDir, 'cities.json'), JSON.stringify(geo), 'utf8');

  return { mapped, total, shardCount: shards.size };
}

/** Homepage ZIP + geolocation lookup widget. */
function buildLocateWidget() {
  const base = JSON.stringify(basePathLib.getBasePath());
  return `<form class="locate-box" id="locate-form" novalidate>
  <label for="zip-input" class="search-label">Frost dates by ZIP code</label>
  <div class="locate-row">
    <input type="text" id="zip-input" class="search-input" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="Enter ZIP code" autocomplete="postal-code">
    <button type="submit" class="btn">Find</button>
  </div>
  <button type="button" class="btn btn-secondary" id="geo-btn">Use my location</button>
  <p class="locate-status" id="locate-status" role="status"></p>
</form>
<script>(function(){
  var base = ${base};
  var form = document.getElementById('locate-form');
  var input = document.getElementById('zip-input');
  var status = document.getElementById('locate-status');
  function go(p) { window.location.href = base + '/' + p + '/'; }
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var zip = input.value.replace(/\\D/g, '');
    if (zip.length !== 5) { status.textContent = 'Enter a 5-digit US ZIP code.'; return; }
    status.textContent = 'Looking up ' + zip + '...';
    fetch(base + '/zip/' + zip.slice(0, 3) + '.json')
      .then(function(r) { return r.ok ? r.json() : {}; })
      .then(function(map) {
        if (map[zip]) go(map[zip]);
        else status.textContent = 'No match for ZIP ' + zip + '. Try searching by city name below.';
      })
      .catch(function() { status.textContent = 'Lookup failed. Try searching by city name below.'; });
  });
  document.getElementById('geo-btn').addEventListener('click', function() {
    if (!navigator.geolocation) { status.textContent = 'Location is not available in this browser. Enter a ZIP code instead.'; return; }
    status.textContent = 'Finding your location...';
    navigator.geolocation.getCurrentPosition(function(pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      fetch(base + '/geo/cities.json').then(function(r) { return r.json(); }).then(function(list) {
        var best = null, bestD = Infinity, k = Math.cos(lat * Math.PI / 180);
        for (var i = 0; i < list.length; i++) {
          var dy = list[i][0] - lat, dx = (list[i][1] - lon) * k, d = dy * dy + dx * dx;
          if (d < bestD) { bestD = d; best = list[i][2]; }
        }
        if (best && bestD < 2.5) go(best);
        else status.textContent = 'No US city found near you. Enter a ZIP code instead.';
      }).catch(function() { status.textContent = 'Lookup failed. Enter a ZIP code instead.'; });
    }, function() { status.textContent = 'Location permission was denied. Enter a ZIP code instead.'; }, { timeout: 10000, maximumAge: 600000 });
  });
})();</script>`;
}

module.exports = {
  cropTitle,
  cropLower,
  buildCropLinkGrid,
  buildCalendarIndex,
  renderCropPages,
  renderZonePages,
  writeLocateData,
  buildLocateWidget,
  parseZone,
  medianDate
};
