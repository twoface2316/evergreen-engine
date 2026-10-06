'use strict';

/**
 * niches/frost/templates/layout.js — Phase 3 HTML building blocks for
 * FrostCal city pages.
 *
 * Pure functions that take plain data (city records, computed calendar
 * entries) and return HTML/SVG string fragments. scripts/render.js owns
 * orchestration (reading data, calling calendar.js, assembling the final
 * document, writing files); this module owns markup that is specific to
 * the frost/planting-calendar niche (copy, brand, page structure).
 * Genuinely niche-free helpers (HTML escaping, the SVG line chart
 * builder, base-path-aware href prefixing) live in engine/lib and are
 * required below rather than reimplemented here.
 */

const { escapeHtml } = require('../../../engine/lib/escape-html.js');
const { buildLineChartSvg } = require('../../../engine/lib/svg-chart.js');
const basePath = require('../../../engine/lib/base-path.js');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTH_ABBR = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// ---------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------

/** Root-relative href, prefixed with the configured base path (see engine/lib/base-path.js). */
function url(rootRelativePath) {
  return basePath.href(rootRelativePath);
}

/** Parse a "YYYY-MM-DD" (or Date-parseable) string into {month, day} (1-indexed), ignoring the dummy reference year. */
function parseMonthDay(dateStr) {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (m) return { month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** "2001-04-10" -> "April 10" */
function formatDateLong(dateStr) {
  const md = parseMonthDay(dateStr);
  if (!md) return '—';
  return `${MONTH_NAMES[md.month - 1]} ${md.day}`;
}

/** "2001-04-10" -> "Apr 10" */
function formatDateShort(dateStr) {
  const md = parseMonthDay(dateStr);
  if (!md) return '—';
  return `${MONTH_NAMES[md.month - 1].slice(0, 3)} ${md.day}`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Great-circle distance in km between two lat/lon points. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nearest N cities in the same state, sorted by distance, excluding the city itself. */
function nearestCitiesSameState(city, allCities, n) {
  const count = n || 8;
  return allCities
    .filter((c) => c.stateSlug === city.stateSlug && c.slug !== city.slug)
    .map((c) => ({ city: c, distanceKm: haversineKm(city.lat, city.lon, c.lat, c.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, count);
}

// ---------------------------------------------------------------------
// Meta title / description (real values, length-bounded)
// ---------------------------------------------------------------------

/**
 * Season context for search snippets. Searchers want the frost date that is
 * coming up next: first fall frost from August through December, last spring
 * frost from January through July. A monthly CI rebuild keeps this current.
 * BUILD_DATE (YYYY-MM-DD) overrides "today" for testing.
 */
function seasonContext(now) {
  const d = now || (process.env.BUILD_DATE ? new Date(process.env.BUILD_DATE + 'T12:00:00Z') : new Date());
  const month = d.getUTCMonth() + 1;
  return { season: month >= 8 ? 'fall' : 'spring', year: d.getUTCFullYear() };
}

function pickLength(candidates, max) {
  for (const c of candidates) {
    if (c.length <= max) return c;
  }
  return candidates[candidates.length - 1].slice(0, max);
}

function buildTitle(city, ctx) {
  const { season } = ctx || seasonContext();
  const place = `${city.name}, ${city.state}`;
  if (city.frostFree) {
    return pickLength([
      `${place} Frost Dates: Frost-Free${city.zone ? ` (Zone ${city.zone})` : ''}`,
      `${place} Frost Dates: Frost-Free`,
      `${place} Frost Dates`
    ], 60);
  }
  const last = formatDateShort(city.lastSpringFrost.p50);
  const first = formatDateShort(city.firstFallFrost.p50);
  const pair = season === 'fall' ? `First ${first}, Last ${last}` : `Last ${last}, First ${first}`;
  const lead = season === 'fall' ? `First Frost ${first}` : `Last Frost ${last}`;
  return pickLength([
    `${place} Frost Dates: ${pair}`,
    `${place}: ${lead}`,
    `${city.name} Frost Dates: ${pair}`,
    `${city.name}: ${lead}`
  ], 60);
}

function buildDescription(city, ctx) {
  const { season, year } = ctx || seasonContext();
  const place = `${city.name}, ${city.state}`;
  if (city.frostFree) {
    return pickLength([
      `${place} is essentially frost-free per NOAA 1991-2020 normals${city.zone ? ` (USDA Zone ${city.zone})` : ''}. Year-round planting guidance for 42 vegetables, herbs, and flowers.`,
      `${place} is essentially frost-free per NOAA normals. Year-round planting guidance for 42 crops.`
    ], 155);
  }
  const lastP50 = formatDateShort(city.lastSpringFrost.p50);
  const lastLate = formatDateShort(city.lastSpringFrost.p10);
  const firstP50 = formatDateShort(city.firstFallFrost.p50);
  const firstEarly = formatDateShort(city.firstFallFrost.p10);
  const zone = city.zone ? ` Zone ${city.zone}.` : '';
  const candidates = season === 'fall'
    ? [
        `${place} first frost ${year}: ${firstP50} on average, as early as ${firstEarly} (1 year in 10). Last spring frost: ${lastP50}.${zone} Free planting calendar.`,
        `${place} first frost: ${firstP50} on average, as early as ${firstEarly}. Last spring frost: ${lastP50}.${zone} Planting calendar.`,
        `First frost in ${place}: ${firstP50} on average. Last spring frost: ${lastP50}. Planting calendar for 42 crops.`
      ]
    : [
        `${place} last frost ${year}: ${lastP50} on average, as late as ${lastLate} (1 year in 10). First fall frost: ${firstP50}.${zone} Free planting calendar.`,
        `${place} last frost: ${lastP50} on average, as late as ${lastLate}. First fall frost: ${firstP50}.${zone} Planting calendar.`,
        `Last frost in ${place}: ${lastP50} on average. First fall frost: ${firstP50}. Planting calendar for 42 crops.`
      ];
  return pickLength(candidates, 155);
}

/** One-sentence direct answer shown under the H1 (snippet-friendly). */
function buildAnswerLede(city, ctx) {
  const { season } = ctx || seasonContext();
  if (city.frostFree) {
    return `${city.name}, ${city.state} is essentially frost-free: NOAA's 1991–2020 normals for the nearest station record no typical freeze, so planting is timed around heat and rainfall rather than frost.`;
  }
  const last = formatDateLong(city.lastSpringFrost.p50);
  const first = formatDateLong(city.firstFallFrost.p50);
  const days = city.growingSeasonDays != null ? `, giving a growing season of about ${city.growingSeasonDays} days` : '';
  return season === 'fall'
    ? `The average first fall frost in ${city.name}, ${city.state} is ${first}, and the average last spring frost is ${last}${days}.`
    : `The average last spring frost in ${city.name}, ${city.state} is ${last}, and the average first fall frost is ${first}${days}.`;
}

// ---------------------------------------------------------------------
// Summary box
// ---------------------------------------------------------------------

function frostPillRow(block) {
  // block: {p10, p50, p90} ISO strings. Convention used throughout:
  // P10 = conservative/"safe" planning date, P50 = typical/median,
  // P90 = aggressive/"risky" planting date (see calendar.js header comment
  // and scripts/render.js adapter notes for the chronological direction,
  // which flips between last-spring-frost and first-fall-frost but the
  // safe/typical/risky labeling stays consistent).
  return `<div class="frost-scale">
    <span class="pill safe">Safe <b>${escapeHtml(formatDateShort(block.p10))}</b></span>
    <span class="pill typical">Typical <b>${escapeHtml(formatDateShort(block.p50))}</b></span>
    <span class="pill risky">Risky <b>${escapeHtml(formatDateShort(block.p90))}</b></span>
  </div>`;
}

/**
 * One-line copy keyed off the leading number of a USDA zone string (e.g. "6a" -> 6).
 * Bands per PLAN.md Phase 5: 3-4 short-season, 5-6 four-season, 7-8 mild/long,
 * 9-11 subtropical/frost-free. 1-2 and 12-13 are outer edge cases not called out
 * in the plan but present in the real 2023 map (interior Alaska / tropical Hawaii).
 */
function buildZoneCopy(zone) {
  if (!zone) return null;
  const m = /^(\d{1,2})/.exec(zone);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (num <= 2) return 'Extreme cold winters — stick to the hardiest perennials and treat most vegetables as annuals started well after the ground thaws.';
  if (num <= 4) return 'Very cold winters, focus on short-season varieties and cold-hardy perennials.';
  if (num <= 6) return 'A classic four-season climate with cold winters and a solid summer growing season.';
  if (num <= 8) return 'Mild winters and a long growing season, room for both cool- and warm-season crops.';
  if (num <= 11) return 'Subtropical to frost-free — heat, not cold, is the main limit on what you can grow.';
  return 'Tropical, essentially frost-free conditions year-round.';
}

/** USDA hardiness zone summary tile, shared by both frost-free and normal summary boxes. */
function zoneSummaryItem(city) {
  const zone = city.zone;
  if (zone) {
    return `<div class="summary-item">
      <div class="label">USDA Hardiness Zone</div>
      <div class="value"><a id="usda-zone" href="${escapeHtml(url(`/zones/${zone}/`))}">Zone ${escapeHtml(zone)}</a></div>
      <div class="sub">${escapeHtml(buildZoneCopy(zone))}</div>
    </div>`;
  }
  return `<div class="summary-item">
      <div class="label">USDA Hardiness Zone</div>
      <div class="value"><span id="usda-zone" class="zone-unavailable">Unavailable</span></div>
      <div class="sub">Zone data isn't available for this location.</div>
    </div>`;
}

function buildSummaryBox(city) {
  const stationLine = `Data: NOAA station ${escapeHtml(city.station.name)}, ${round1(city.station.distanceKm)} km away.`;

  if (city.frostFree) {
    return `<div class="summary">
  <span class="badge-frostfree">Frost-Free Climate</span>
  <div class="summary-grid">
    <div class="summary-item">
      <div class="label">Growing Season</div>
      <div class="value">Year-round</div>
      <div class="sub">No measurable freeze (32°F or below) in the 1991–2020 NOAA normals record.</div>
    </div>
    ${zoneSummaryItem(city)}
  </div>
  <div class="station-note">${stationLine}</div>
</div>`;
  }

  return `<div class="summary">
  <div class="summary-grid">
    <div class="summary-item">
      <div class="label">Last Spring Frost</div>
      <div class="value">${escapeHtml(formatDateLong(city.lastSpringFrost.p50))}</div>
      ${frostPillRow(city.lastSpringFrost)}
    </div>
    <div class="summary-item">
      <div class="label">First Fall Frost</div>
      <div class="value">${escapeHtml(formatDateLong(city.firstFallFrost.p50))}</div>
      ${frostPillRow(city.firstFallFrost)}
    </div>
    <div class="summary-item">
      <div class="label">Growing Season</div>
      <div class="value">${city.growingSeasonDays != null ? city.growingSeasonDays + ' days' : '—'}</div>
      <div class="sub">Typical last frost to typical first frost.</div>
    </div>
    ${zoneSummaryItem(city)}
  </div>
  <div class="station-note">${stationLine}</div>
</div>`;
}

// ---------------------------------------------------------------------
// Countdown widget ("Days until last expected frost")
// ---------------------------------------------------------------------

function buildCountdownWidget(city) {
  if (city.frostFree) return '';
  const last = parseMonthDay(city.lastSpringFrost.p50);
  const first = parseMonthDay(city.firstFallFrost.p50);
  if (!last || !first) return '';
  // Counts to whichever typical frost comes next from the visitor's date:
  // first fall frost through autumn, last spring frost through winter/spring.
  const data = JSON.stringify({ last, first });
  return `<div class="countdown" id="frost-countdown">
  <span class="num" id="frost-countdown-num">—</span>
  <span class="txt" id="frost-countdown-txt">days until the typical last spring frost</span>
</div>
<script type="application/json" id="frost-countdown-data">${data}</script>
<script>(function(){
  var el = document.getElementById('frost-countdown-num');
  var txt = document.getElementById('frost-countdown-txt');
  var dEl = document.getElementById('frost-countdown-data');
  if (!el || !txt || !dEl) return;
  try {
    var d = JSON.parse(dEl.textContent);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function next(md) {
      var t = new Date(now.getFullYear(), md.month - 1, md.day);
      if (t < today) t.setFullYear(t.getFullYear() + 1);
      return t;
    }
    var tl = next(d.last), tf = next(d.first);
    var useFirst = tf <= tl;
    var target = useFirst ? tf : tl;
    var md = useFirst ? d.first : d.last;
    var label = (useFirst ? 'typical first fall frost' : 'typical last spring frost') + ' (' + months[md.month - 1] + ' ' + md.day + ')';
    var days = Math.round((target - today) / 86400000);
    el.textContent = days === 0 ? 'Today' : String(days);
    txt.textContent = days === 0 ? 'is the ' + label : (days === 1 ? 'day until the ' : 'days until the ') + label;
  } catch (e) {}
})();</script>`;
}

// ---------------------------------------------------------------------
// Monthly temperature chart (inline SVG, build-time only, theme-aware
// via CSS custom properties so it follows prefers-color-scheme).
// ---------------------------------------------------------------------

function buildTempChart(monthly) {
  return buildLineChartSvg({
    width: 640,
    height: 260,
    series: [
      { data: monthly.tmax, colorVar: 'var(--chart-max)' },
      { data: monthly.tavg, colorVar: 'var(--chart-avg)' },
      { data: monthly.tmin, colorVar: 'var(--chart-min)' }
    ],
    xLabels: MONTH_ABBR,
    yTickFormat: (v) => `${Math.round(v)}°`,
    ariaLabel: 'Monthly average low, average, and high temperatures in degrees Fahrenheit, based on 1991-2020 NOAA normals',
    titleText: 'Monthly normal temperatures (°F)'
  });
}

function buildChartCard(city) {
  return `<div class="chart-card">
  ${buildTempChart(city.monthly)}
  <div class="chart-legend">
    <span><span class="swatch" style="background:var(--chart-max)"></span>Avg. high</span>
    <span><span class="swatch" style="background:var(--chart-avg)"></span>Avg. temp</span>
    <span><span class="swatch" style="background:var(--chart-min)"></span>Avg. low</span>
  </div>
</div>`;
}

// ---------------------------------------------------------------------
// Planting calendar table
// ---------------------------------------------------------------------

const CATEGORY_LABELS = {
  vegetable: 'Vegetables',
  herb: 'Herbs',
  flower: 'Flowers'
};
const CATEGORY_ORDER = ['vegetable', 'herb', 'flower'];

function daysToMaturityLabel(dtm) {
  if (!dtm) return '—';
  return dtm[0] === dtm[1] ? `${dtm[0]} days` : `${dtm[0]}–${dtm[1]} days`;
}

function buildCalendarTable(city, calendarEntries) {
  const byCategory = {};
  for (const entry of calendarEntries) {
    (byCategory[entry.category] = byCategory[entry.category] || []).push(entry);
  }

  const tables = CATEGORY_ORDER.filter((cat) => byCategory[cat]).map((cat) => {
    const rows = byCategory[cat];
    if (city.frostFree) {
      const body = rows
        .map(
          (r) => `<tr>
        <td class="crop-name"><a href="${escapeHtml(url(cropGuidePath(r.slug, city.state)))}">${escapeHtml(r.name)}</a></td>
        <td class="note-cell">${escapeHtml(r.frostFreeNote || '—')}</td>
        <td>${escapeHtml(daysToMaturityLabel(r.daysToMaturity))}</td>
      </tr>`
        )
        .join('');
      return `<div class="table-scroll">
    <table class="calendar">
      <caption>${CATEGORY_LABELS[cat]}</caption>
      <thead><tr><th>Crop</th><th>Planting notes</th><th>Days to maturity</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
    }

    const body = rows
      .map((r) => {
        const seed = r.seedStart ? r.seedStart.label : '—';
        const sow = r.directSow ? r.directSow.label : '—';
        const transplant = r.transplant ? r.transplant.label : '—';
        const fall = r.fallPlanting ? r.fallPlanting.label : '—';
        return `<tr>
        <td class="crop-name"><a href="${escapeHtml(url(cropGuidePath(r.slug, city.state)))}">${escapeHtml(r.name)}</a></td>
        <td>${escapeHtml(seed)}</td>
        <td>${escapeHtml(sow)}</td>
        <td>${escapeHtml(transplant)}</td>
        <td>${escapeHtml(fall)}</td>
        <td>${escapeHtml(daysToMaturityLabel(r.daysToMaturity))}</td>
        <td class="note-cell">${escapeHtml(r.notes || '')}</td>
      </tr>`;
      })
      .join('');
    return `<div class="table-scroll">
    <table class="calendar">
      <caption>${CATEGORY_LABELS[cat]}</caption>
      <thead><tr><th>Crop</th><th>Start indoors</th><th>Direct sow</th><th>Transplant</th><th>Fall planting</th><th>Maturity</th><th>Notes</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
  });

  const hint = city.frostFree
    ? '<p class="table-hint">Dates are relative windows based on university extension guidelines, adapted for a frost-free climate — not a guarantee.</p>'
    : '<p class="table-hint">Date ranges are estimates based on university extension guidelines and this city\'s NOAA frost normals — not a guarantee. Scroll to see all columns on narrow screens.</p>';

  return tables.join('\n') + hint;
}

// ---------------------------------------------------------------------
// FAQ (+ FAQPage JSON-LD)
// ---------------------------------------------------------------------

function buildFaqs(city) {
  if (city.frostFree) {
    const lows = city.monthly.tmin;
    const highs = city.monthly.tmax;
    const minLow = Math.min.apply(null, lows);
    const maxLow = Math.max.apply(null, lows);
    const minHigh = Math.min.apply(null, highs);
    const maxHigh = Math.max.apply(null, highs);
    return [
      {
        q: `Does ${city.name}, ${city.state} get frost?`,
        a: `No. Based on NOAA's 1991–2020 climate normals for the ${city.station.name} station, ${city.name} did not record a measurable freeze (32°F or below), so it's classified as frost-free.`
      },
      {
        q: `Can I garden year-round in ${city.name}, ${city.state}?`,
        a: `Yes. Without a hard frost limiting the season, most crops can be planted nearly any time of year in ${city.name}. Timing shifts around summer heat and rainy/dry seasons rather than frost risk.`
      },
      {
        q: `What's the typical temperature range in ${city.name}, ${city.state}?`,
        a: `Average monthly lows range from about ${Math.round(minLow)}°F to ${Math.round(maxLow)}°F, and average monthly highs range from about ${Math.round(minHigh)}°F to ${Math.round(maxHigh)}°F, based on 1991–2020 NOAA normals.`
      },
      {
        q: `What USDA hardiness zone is ${city.name}, ${city.state} in?`,
        a: city.zone
          ? `${city.name}, ${city.state} is in USDA plant hardiness zone ${city.zone}, per the USDA's 2023 Plant Hardiness Zone Map. ${buildZoneCopy(city.zone)}`
          : `USDA hardiness zone data isn't available for ${city.name} yet. In the meantime, its frost-free status and the temperature data above can guide plant selection.`
      }
    ];
  }

  const lastP50 = formatDateLong(city.lastSpringFrost.p50);
  const lastP10 = formatDateLong(city.lastSpringFrost.p10);
  const lastP90 = formatDateLong(city.lastSpringFrost.p90);
  const firstP50 = formatDateLong(city.firstFallFrost.p50);
  const firstP10 = formatDateLong(city.firstFallFrost.p10);
  const firstP90 = formatDateLong(city.firstFallFrost.p90);

  return [
    {
      q: `When is the last frost in ${city.name}, ${city.state}?`,
      a: `Based on 1991–2020 NOAA climate normals for the ${city.station.name} station, the last spring frost in ${city.name} typically falls around ${lastP50}. A cautious gardener might wait until ${lastP10} (only a 10% chance of a later frost), while ${lastP90} marks an earlier, higher-risk planting date.`
    },
    {
      q: `When is the first frost in ${city.name}, ${city.state} in fall?`,
      a: `The first fall frost in ${city.name} typically arrives around ${firstP50}. To stay safe, assume frost could start as early as ${firstP10}; in milder years it can hold off until ${firstP90}.`
    },
    {
      q: `How long is the growing season in ${city.name}, ${city.state}?`,
      a: `${city.name}'s average frost-free growing season is about ${city.growingSeasonDays} days, running from the typical last spring frost (${lastP50}) to the typical first fall frost (${firstP50}).`
    },
    {
      q: `What USDA hardiness zone is ${city.name}, ${city.state} in?`,
      a: city.zone
        ? `${city.name}, ${city.state} is in USDA plant hardiness zone ${city.zone}, per the USDA's 2023 Plant Hardiness Zone Map. ${buildZoneCopy(city.zone)}`
        : `USDA hardiness zone data isn't available for ${city.name} yet. Until then, use the frost dates above and your local extension office for planting guidance.`
    }
  ];
}

function buildFaqSection(city) {
  const faqs = buildFaqs(city);
  const items = faqs
    .map(
      (f) => `<div class="faq-item">
    <h3>${escapeHtml(f.q)}</h3>
    <p>${escapeHtml(f.a)}</p>
  </div>`
    )
    .join('');
  return { html: items, faqs };
}

function buildFaqJsonLd(faqs) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  };
}

// ---------------------------------------------------------------------
// Nearby cities
// ---------------------------------------------------------------------

function buildNearbyCities(city, allCities) {
  const nearby = nearestCitiesSameState(city, allCities, 8);
  if (nearby.length === 0) return '';
  const items = nearby
    .map(
      ({ city: c }) =>
        `<li><a href="${escapeHtml(url(`/${c.stateSlug}/${c.slug}/`))}">${escapeHtml(c.name)}, ${escapeHtml(c.state)}</a></li>`
    )
    .join('');
  return `<ul class="nearby-list">${items}</ul>`;
}

// ---------------------------------------------------------------------
// Header / footer
// ---------------------------------------------------------------------

function buildSiteHeader(city) {
  return `<header class="site-header">
  <div class="site-header-inner">
    <a class="brand" href="${escapeHtml(url('/'))}">Frost<span>Cal</span></a>
  </div>
</header>`;
}

function buildBreadcrumbs(city) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">
  <a href="${escapeHtml(url('/'))}">Home</a> &rsaquo; <a href="${escapeHtml(url(`/${city.stateSlug}/`))}">${escapeHtml(city.state)}</a> &rsaquo; ${escapeHtml(city.name)}
</nav>`;
}

function buildFooter() {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="disclaimer">This page is for general gardening reference only and is <strong>not agronomic, professional, or safety advice</strong>. Frost dates are statistical probabilities from historical climate normals, not guarantees — always check a local forecast before planting or protecting tender plants.</div>
  <p>Frost and temperature normals: <a href="https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals" rel="noopener">NOAA NCEI 1991–2020 U.S. Climate Normals</a>.</p>
  <p>City and place data: <a href="https://www.geonames.org/" rel="noopener">GeoNames.org</a>, used under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>.</p>
  <p><a href="${escapeHtml(url('/'))}">Frost dates by ZIP code</a> &middot; <a href="${escapeHtml(url('/zones/'))}">Hardiness zones</a> &middot; <a href="${escapeHtml(url('/plant/'))}">When to plant</a> &middot; <a href="${escapeHtml(url('/guides/'))}">Guides</a></p>
  <p><a href="${escapeHtml(url('/methodology/'))}">How these dates are calculated (methodology)</a> &middot; <a href="${escapeHtml(url('/about/'))}">About</a> &middot; <a href="${escapeHtml(url('/privacy/'))}">Privacy policy</a> &middot; <a href="${escapeHtml(url('/contact/'))}">Contact</a></p>
  <p>&copy; ${year} FrostCal.</p>
</footer>`;
}

// ---------------------------------------------------------------------
// Phase 4 — site chrome (state index, homepage, methodology, 404)
// ---------------------------------------------------------------------

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
};

function stateName(abbr) {
  return STATE_NAMES[abbr] || abbr;
}

function formatPopulation(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

/** Breadcrumb nav for any non-city page. `trail` is an array of {label, href?} (last item has no href). */
function buildGenericBreadcrumbs(trail) {
  const parts = trail.map((t) =>
    t.href ? `<a href="${escapeHtml(url(t.href))}">${escapeHtml(t.label)}</a>` : escapeHtml(t.label)
  );
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${parts.join(' &rsaquo; ')}</nav>`;
}

/** Earliest/latest P50 frost dates across a state's non-frost-free cities, with the city at each end. */
function stateFrostRanges(stateCities) {
  const frosty = stateCities.filter((c) => !c.frostFree && c.lastSpringFrost && c.firstFallFrost);
  if (!frosty.length) return null;
  const doy = (str) => { const md = parseMonthDay(str); return md ? Date.UTC(2001, md.month - 1, md.day) : 0; };
  const by = (key) => frosty.slice().sort((a, b) => doy(a[key].p50) - doy(b[key].p50));
  const last = by('lastSpringFrost');
  const first = by('firstFallFrost');
  return {
    lastEarly: last[0], lastLate: last[last.length - 1],
    firstEarly: first[0], firstLate: first[first.length - 1],
    count: frosty.length
  };
}

function buildStateTitle(name) {
  return pickLength([
    `${name} Frost Dates by City: Last & First Frost`,
    `${name} Frost Dates by City`,
    `${name} Frost Dates`
  ], 60);
}

function buildStateDescription(name, stateCities, ctx) {
  const { season } = ctx || seasonContext();
  const r = stateFrostRanges(stateCities);
  const n = stateCities.length;
  if (!r) {
    return pickLength([
      `Most of ${name} is frost-free per NOAA 1991-2020 normals. Year-round planting guidance for ${n} cities.`,
      `${name} frost dates and planting guidance for ${n} cities.`
    ], 155);
  }
  const lastRange = `${formatDateShort(r.lastEarly.lastSpringFrost.p50)} (${r.lastEarly.name}) to ${formatDateShort(r.lastLate.lastSpringFrost.p50)} (${r.lastLate.name})`;
  const firstRange = `${formatDateShort(r.firstEarly.firstFallFrost.p50)} (${r.firstEarly.name}) to ${formatDateShort(r.firstLate.firstFallFrost.p50)} (${r.firstLate.name})`;
  const lastShort = `${formatDateShort(r.lastEarly.lastSpringFrost.p50)}–${formatDateShort(r.lastLate.lastSpringFrost.p50)}`;
  const firstShort = `${formatDateShort(r.firstEarly.firstFallFrost.p50)}–${formatDateShort(r.firstLate.firstFallFrost.p50)}`;
  const candidates = season === 'fall'
    ? [
        `First frost in ${name} ranges from ${firstRange}. Last spring frost: ${lastShort}. Dates for ${n} cities.`,
        `First frost in ${name}: ${firstShort}; last spring frost: ${lastShort}. Frost dates for ${n} cities.`
      ]
    : [
        `Last frost in ${name} ranges from ${lastRange}. First fall frost: ${firstShort}. Dates for ${n} cities.`,
        `Last frost in ${name}: ${lastShort}; first fall frost: ${firstShort}. Frost dates for ${n} cities.`
      ];
  return pickLength(candidates, 155);
}

/** Direct-answer lede for a state page. */
function buildStateLede(name, stateCities) {
  const r = stateFrostRanges(stateCities);
  if (!r) {
    return `Nearly all of ${name} is frost-free per NOAA 1991–2020 climate normals. Pick a city below for its monthly temperatures and year-round planting guidance.`;
  }
  return `In ${name}, the average last spring frost ranges from ${formatDateLong(r.lastEarly.lastSpringFrost.p50)} in ${r.lastEarly.name} to ${formatDateLong(r.lastLate.lastSpringFrost.p50)} in ${r.lastLate.name}, and the average first fall frost from ${formatDateLong(r.firstEarly.firstFallFrost.p50)} in ${r.firstEarly.name} to ${formatDateLong(r.firstLate.firstFallFrost.p50)} in ${r.firstLate.name}. Pick a city for its full frost-date summary and 42-crop planting calendar.`;
}

// States that get crop-by-state guide pages: those with at least one city
// that sees frost. Entirely frost-free states (Hawaii) would get 42 pages
// saying the same thing, so their links point at the all-states crop hubs.
// Set once per build by render.js; null means "every state".
let cropGuideStates = null;

function setCropGuideStates(states) {
  cropGuideStates = states;
}

function hasCropGuide(stateAbbr) {
  return !!stateAbbr && (!cropGuideStates || cropGuideStates.has(stateAbbr));
}

/** Crop guide link: the crop's page for a state, or the all-states hub when the state has no guides (zone pages, Hawaii). */
function cropGuidePath(cropSlug, stateAbbr) {
  return hasCropGuide(stateAbbr) ? `/plant/${cropSlug}/${stateNameSlug(stateAbbr)}/` : `/plant/${cropSlug}/`;
}

/** URL slug for a state's full name, e.g. "NC" -> "north-carolina" (used by crop guide URLs). */
function stateNameSlug(abbr) {
  return stateName(abbr).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** State index page: table of that state's cities sorted by population desc. */
function buildStateTable(stateCities) {
  const rows = stateCities
    .slice()
    .sort((a, b) => (b.population || 0) - (a.population || 0))
    .map((c) => {
      const last = c.frostFree ? 'Frost-free' : escapeHtml(formatDateLong(c.lastSpringFrost.p50));
      const first = c.frostFree ? 'Frost-free' : escapeHtml(formatDateLong(c.firstFallFrost.p50));
      const season = c.frostFree ? 'Year-round' : (c.growingSeasonDays != null ? `${c.growingSeasonDays} days` : '—');
      const zone = c.zone ? escapeHtml(c.zone) : '—';
      return `<tr>
        <td><a href="${escapeHtml(url(`/${c.stateSlug}/${c.slug}/`))}">${escapeHtml(c.name)}</a></td>
        <td>${last}</td>
        <td>${first}</td>
        <td>${season}</td>
        <td>${zone}</td>
      </tr>`;
    })
    .join('');

  return `<div class="table-scroll">
    <table class="calendar state-table">
      <thead><tr><th>City</th><th>Last Spring Frost (typical)</th><th>First Fall Frost (typical)</th><th>Growing Season</th><th>USDA Zone</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** Homepage: ranked table of top cities by population. */
function buildTopCitiesTable(topCities) {
  const rows = topCities
    .map(
      (c, i) => `<tr>
        <td class="rank-cell">${i + 1}</td>
        <td><a href="${escapeHtml(url(`/${c.stateSlug}/${c.slug}/`))}">${escapeHtml(c.name)}, ${escapeHtml(c.state)}</a></td>
        <td>${escapeHtml(formatPopulation(c.population))}</td>
      </tr>`
    )
    .join('');
  return `<div class="table-scroll">
    <table class="calendar top-cities-table">
      <thead><tr><th>#</th><th>City</th><th>Population</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** Homepage: A-Z list of states linking to their state index pages. */
function buildStatesAZList(statesMeta) {
  const sorted = statesMeta.slice().sort((a, b) => a.name.localeCompare(b.name));
  const items = sorted
    .map(
      (s) =>
        `<li><a href="${escapeHtml(url(`/${s.stateSlug}/`))}">${escapeHtml(s.name)}</a> <span class="count">(${s.count})</span></li>`
    )
    .join('');
  return `<ul class="state-az-list">${items}</ul>`;
}

/**
 * Homepage search widget. `mode` is 'inline' (embeds the full compact city
 * index as JSON on the page) or 'split' (lazy-fetches /search-index/{letter}.json
 * on first relevant keystroke). `payload` is either the array (inline) or the
 * list of available letter buckets (split).
 */
function buildSearchWidget(mode, payload) {
  const dataBlock =
    mode === 'inline'
      ? `<script type="application/json" id="city-search-data">${JSON.stringify(payload)}</script>`
      : `<script type="application/json" id="city-search-letters">${JSON.stringify(payload)}</script>`;

  const script = `<script>(function(){
  var input = document.getElementById('city-search-input');
  var results = document.getElementById('city-search-results');
  var mode = ${JSON.stringify(mode)};
  var basePath = ${JSON.stringify(basePath.getBasePath())};
  var cache = {};
  var inlineData = null;

  function firstLetter(str) {
    var m = /[a-z]/i.exec(str);
    return m ? m[0].toLowerCase() : 'misc';
  }

  function render(items, query) {
    if (!items.length) {
      results.innerHTML = query ? '<li class="no-results">No cities found.</li>' : '';
      return;
    }
    var html = items.slice(0, 15).map(function(c) {
      return '<li><a href="' + c.u + '">' + c.n + ', ' + c.s + '</a></li>';
    }).join('');
    results.innerHTML = html;
  }

  function filterAndRender(list, query) {
    var q = query.toLowerCase();
    var matches = list.filter(function(c) {
      return c.n.toLowerCase().indexOf(q) !== -1;
    });
    render(matches, query);
  }

  function runInline(query) {
    if (!inlineData) {
      var el = document.getElementById('city-search-data');
      inlineData = JSON.parse(el.textContent);
    }
    filterAndRender(inlineData, query);
  }

  function runSplit(query) {
    var letter = firstLetter(query);
    if (cache[letter]) {
      filterAndRender(cache[letter], query);
      return;
    }
    results.innerHTML = '<li class="loading">Searching...</li>';
    fetch(basePath + '/search-index/' + letter + '.json')
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(data) {
        cache[letter] = data;
        filterAndRender(data, query);
      })
      .catch(function() { results.innerHTML = '<li class="no-results">Search unavailable.</li>'; });
  }

  input.addEventListener('input', function() {
    var query = input.value.trim();
    if (query.length < 2) { results.innerHTML = ''; return; }
    if (mode === 'inline') runInline(query); else runSplit(query);
  });
})();</script>`;

  return `<div class="search-box">
  <label for="city-search-input" class="search-label">Find your city</label>
  <input type="text" id="city-search-input" class="search-input" placeholder="Start typing a city name..." autocomplete="off">
  <ul id="city-search-results" class="search-results"></ul>
</div>
${dataBlock}
${script}`;
}

/** Methodology page body (static, no per-request data). */
function buildMethodologyBody() {
  return `<h1>Methodology</h1>
<p class="lede">How FrostCal turns raw NOAA climate data into the frost dates and planting calendar on each city page.</p>

<div class="methodology">

<h2>Where the frost dates come from</h2>
<p>Frost and freeze dates on this site are calculated from NOAA's <a href="https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals" rel="noopener">1991&ndash;2020 U.S. Climate Normals</a>, a 30-year statistical baseline published by the National Centers for Environmental Information (NCEI). For each weather station, NOAA computes the probability, in any given year, that the last spring freeze or first fall freeze at 32&deg;F falls on or before a given calendar day.</p>

<h2>What P10 / P50 / P90 mean</h2>
<dl>
  <dt>P50 (typical)</dt>
  <dd>The median date &mdash; in half of the 30 years in the record, the frost happened on or before this date, and in half it happened after. This is the single best "typical" estimate and is what's shown as the headline date on each city page.</dd>
  <dt>P10 (safe)</dt>
  <dd>For last spring frost, this is the later, more conservative date: historically, only 10% of years had a later last frost. Waiting until this date to plant tender crops is the cautious choice. For first fall frost, P10 is the later date too, meaning only a 10% chance frost arrives that late &mdash; treat it as an optimistic end-of-season estimate, not a safe one.</dd>
  <dt>P90 (risky)</dt>
  <dd>The earlier, higher-risk date: for last spring frost, 90% of years had a later frost, so planting before this date carries real frost risk. For first fall frost, P90 is the earlier date at which frost has already occurred in 90% of years &mdash; a cautious "frost could come this early" marker.</dd>
</dl>
<p>These are probabilities from historical data, not predictions for any specific year. Always check a real-time local forecast before planting tender crops or protecting plants in the field.</p>

<h2>Matching cities to weather stations</h2>
<p>City coordinates come from GeoNames; each city is matched to the nearest NOAA station that has valid 32&deg;F frost-probability data. A match is rejected &mdash; and the next-nearest station tried instead &mdash; if the station is more than <strong>80 km</strong> away or its elevation differs from the city's by more than <strong>400 meters</strong> (to avoid pairing a valley city with a mountain-top station, or vice versa). Across the 5,078 cities in the current dataset, the median station distance is <strong>6.4 km</strong>, and about 72% of cities are matched within 10 km.</p>
<p>Each city page's summary box shows the exact station name and distance used, so you can judge how locally representative the data is for your address.</p>

<h2>Frost-free classification</h2>
<p>Some stations, mostly in Hawaii, southern Florida, and similar climates, recorded no measurable 32&deg;F freeze at all across the 1991&ndash;2020 normals period. Cities matched to these stations are labeled "frost-free," and their planting calendar switches to year-round guidance instead of frost-relative offsets.</p>

<h2>Where the USDA hardiness zone comes from</h2>
<p>The USDA Hardiness Zone shown on each city page is looked up from the USDA's <a href="https://planthardiness.ars.usda.gov/" rel="noopener">2023 Plant Hardiness Zone Map</a> (produced by the PRISM Climate Group at Oregon State University), matched to each city's nearest ZIP code by distance. A small number of cities don't have a nearby ZIP with published zone data and show as "Unavailable" rather than a guess.</p>

<h2>Where the planting calendar comes from</h2>
<p>Each crop's start-indoors, direct-sow, transplant, and fall-planting windows are expressed as offsets in weeks relative to a city's last spring frost (and, for fall crops, first fall frost). The offsets themselves are authored from general horticultural knowledge and are described in the UI as <em>based on university extension guidelines</em> &mdash; the same kind of week-relative-to-frost guidance published by state extension services (e.g. "start tomatoes indoors 6&ndash;8 weeks before last frost"). They are general guidance, not a substitute for advice from your local extension office, which can account for soil, cultivar, and microclimate specifics.</p>

<h2>Limitations</h2>
<p>A few things this data does <em>not</em> capture:</p>
<ul>
  <li><strong>Microclimates.</strong> Urban heat islands, low-lying frost pockets, coastal moderation, and sheltered or exposed yards can shift your actual frost dates earlier or later than the station-level normal.</li>
  <li><strong>Elevation within a city.</strong> Large cities can span hundreds of feet of elevation change; a single station average won't capture every neighborhood.</li>
  <li><strong>Station distance.</strong> Some cities, especially in rural areas, are matched to a station tens of kilometers away. Check the station distance shown on each city page.</li>
  <li><strong>Climate change / recency.</strong> The 1991&ndash;2020 normals are already several years old and reflect the average of that 30-year window, not necessarily this year's conditions.</li>
</ul>

<h2>Data attribution</h2>
<ul>
  <li>Frost and temperature normals: <a href="https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals" rel="noopener">NOAA NCEI 1991&ndash;2020 U.S. Climate Normals</a>, U.S. public domain.</li>
  <li>City and place data: <a href="https://www.geonames.org/" rel="noopener">GeoNames.org</a>, used under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>.</li>
  <li>USDA Hardiness Zone: <a href="https://planthardiness.ars.usda.gov/" rel="noopener">USDA 2023 Plant Hardiness Zone Map</a> (PRISM Climate Group, Oregon State University), U.S. public domain government data.</li>
</ul>

</div>`;
}

/** 404 page body. */
function build404Body() {
  return `<h1>Page Not Found</h1>
<p class="lede">We couldn't find that page. It may have moved, or the URL might be mistyped.</p>
<p><a href="${escapeHtml(url('/'))}">Go to the homepage</a> or use the search box there to find a city's frost dates and planting calendar.</p>`;
}

/** Day of year (0-364, non-leap) for a "2001-MM-DD" string, or null. */
function dayOfYear(str) {
  const md = parseMonthDay(str);
  return md ? Math.round((Date.UTC(2001, md.month - 1, md.day) - Date.UTC(2001, 0, 1)) / 86400000) : null;
}

function daysPhrase(n) {
  return `${n} day${n === 1 ? '' : 's'}`;
}

/**
 * "How {city} compares": facts that set this city apart from the rest of its
 * state and from the nearest larger city, all computed from the same NOAA
 * normals shown elsewhere on the page.
 */
function buildComparison(city, allCities) {
  const items = [];
  const name = city.name;
  const state = stateName(city.state);
  const sameState = allCities.filter((c) => c.state === city.state && c !== city);

  if (!city.frostFree) {
    const myLast = dayOfYear(city.lastSpringFrost.p50);
    const myFirst = dayOfYear(city.firstFallFrost.p50);
    const frosty = sameState.filter((c) => !c.frostFree);

    if (frosty.length >= 5) {
      const earlier = frosty.filter((c) => dayOfYear(c.lastSpringFrost.p50) < myLast).length;
      const later = frosty.filter((c) => dayOfYear(c.lastSpringFrost.p50) > myLast).length;
      const total = frosty.length + 1;
      const lastLabel = formatDateShort(city.lastSpringFrost.p50);
      if (later >= earlier) {
        items.push(`${name}'s typical last spring frost (${lastLabel}) comes earlier than in ${Math.round((100 * later) / total)}% of the ${total} ${state} cities we track.`);
      } else {
        items.push(`${name}'s typical last spring frost (${lastLabel}) comes later than in ${Math.round((100 * earlier) / total)}% of the ${total} ${state} cities we track.`);
      }

      const seasons = frosty.map((c) => c.growingSeasonDays).filter((d) => d != null).sort((a, b) => a - b);
      if (seasons.length && city.growingSeasonDays != null) {
        const median = seasons[Math.floor(seasons.length / 2)];
        const diff = city.growingSeasonDays - median;
        items.push(Math.abs(diff) < 3
          ? `Its ${city.growingSeasonDays}-day growing season is about the same as the ${state} median of ${median} days.`
          : `Its ${city.growingSeasonDays}-day growing season is ${daysPhrase(Math.abs(diff))} ${diff > 0 ? 'longer' : 'shorter'} than the ${state} median of ${median} days.`);
      }
    }

    let bigger = null;
    let biggerKm = Infinity;
    for (const c of frosty) {
      if ((c.population || 0) <= (city.population || 0)) continue;
      const km = haversineKm(city.lat, city.lon, c.lat, c.lon);
      if (km < biggerKm && km <= 100) { bigger = c; biggerKm = km; }
    }
    if (bigger) {
      const dLast = myLast - dayOfYear(bigger.lastSpringFrost.p50);
      const dFirst = myFirst - dayOfYear(bigger.firstFallFrost.p50);
      const km = Math.round(biggerKm);
      if (dLast === 0 && dFirst === 0) {
        items.push(bigger.station && city.station && bigger.station.id === city.station.id
          ? `${name} shares its NOAA weather station with ${bigger.name} (${km} km away), so their typical frost dates are the same.`
          : `${name}'s typical frost dates match ${bigger.name}'s (${km} km away).`);
      } else {
        const lastPart = dLast === 0 ? 'on the same day as' : `${daysPhrase(Math.abs(dLast))} ${dLast > 0 ? 'later than' : 'earlier than'}`;
        const firstPart = dFirst === 0 ? 'on the same day' : `${daysPhrase(Math.abs(dFirst))} ${dFirst > 0 ? 'later' : 'earlier'}`;
        items.push(`Compared with ${bigger.name} (${km} km away), ${name}'s last spring frost comes ${lastPart} ${bigger.name}'s, and its first fall frost arrives ${firstPart}.`);
      }
    }
  } else {
    const frostFreeCount = sameState.filter((c) => c.frostFree).length;
    if (frostFreeCount > 0) {
      items.push(`${name} is one of ${frostFreeCount + 1} essentially frost-free ${state} cities we track.`);
    }
  }

  const m = city.monthly;
  if (m && Array.isArray(m.tmax) && Array.isArray(m.tmin) && m.tmax.length === 12 && m.tmin.length === 12) {
    let hot = 0;
    let cold = 0;
    for (let i = 1; i < 12; i++) {
      if (m.tmax[i] > m.tmax[hot]) hot = i;
      if (m.tmin[i] < m.tmin[cold]) cold = i;
    }
    items.push(`${MONTH_NAMES[hot]} is the warmest month (average high ${Math.round(m.tmax[hot])}°F) and ${MONTH_NAMES[cold]} the coldest (average low ${Math.round(m.tmin[cold])}°F).`);
  }

  if (!items.length) return '';
  return `<ul class="compare-list">${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
}

/** About page body. Deliberately anonymous: describes the project, not a person. */
function buildAboutBody(cityCount, contactEmail) {
  const n = cityCount.toLocaleString('en-US');
  return `<div class="methodology">
<h1>About FrostCal</h1>
<p class="lede">FrostCal is a free reference for frost dates and planting dates across ${n} US cities. Look up any ZIP code or city to see when frost typically ends in spring and returns in fall, with no account and no app required.</p>

<h2>Why it exists</h2>
<p>Most frost-date tools give a single date and stop there. A single date hides the part gardeners actually need: how much risk you're taking by planting on it. FrostCal shows three dates for every location: a typical date, a safer date, and a riskier one. Each comes from 30 years of weather records, so you can decide how much risk to take with tender plants.</p>

<h2>Where the data comes from</h2>
<ul>
<li><strong>Frost dates and temperatures:</strong> NOAA National Centers for Environmental Information, 1991&ndash;2020 U.S. Climate Normals. Every city page names the weather station it uses and how far away it is.</li>
<li><strong>Hardiness zones:</strong> the USDA 2023 Plant Hardiness Zone Map.</li>
<li><strong>Places:</strong> GeoNames, used under CC BY 4.0.</li>
<li><strong>Planting windows:</strong> timing rules for 42 crops based on university extension guidelines, applied to each city's own frost dates.</li>
</ul>
<p>The <a href="${escapeHtml(url('/methodology/'))}">methodology page</a> explains how stations are matched to cities and how the probability ranges work.</p>

<h2>How the site is maintained</h2>
<p>Pages are generated directly from the data above, so every city uses the same method and nothing is copied by hand. The site is rebuilt monthly. The underlying climate normals are revised by NOAA once a decade; the next release (2001&ndash;2030) will be adopted when it's published.</p>

<h2>Independence</h2>
<p>FrostCal is an independent project. It is not affiliated with NOAA, the USDA, or any seed or garden company. The site is free to use and is supported by advertising.</p>

<h2>Corrections</h2>
<p>If a date looks wrong for your area, or your town is missing, email <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>. Microclimates are real: a valley, a hilltop, or a spot near a large lake can differ from the nearest station by a week or more, and reports like that help improve the site.</p>
</div>`;
}

/** Privacy policy page body (reuses .methodology prose styling). */
function buildPrivacyBody(contactEmail) {
  return `<div class="methodology">
<h1>Privacy Policy</h1>
<p class="lede">FrostCal is a static reference site. It has no user accounts, no forms, and does not itself set cookies or collect personal information.</p>

<h2>What this site collects</h2>
<p>Nothing directly. Every page is a pre-built static file; there is no login, comment system, newsletter, or tracking script operated by FrostCal.</p>

<h2>Hosting</h2>
<p>This site is served by GitHub Pages. Like most web hosts, GitHub may log basic technical information about visits (such as IP address and user agent) for security and operational purposes. See <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener">GitHub's privacy statement</a> for details.</p>

<h2>Analytics</h2>
<p>If analytics are enabled, FrostCal uses a privacy-focused, cookie-free analytics service that records aggregate page-view counts only (no cross-site tracking, no advertising profiles, no personal identifiers stored by us).</p>

<h2>Advertising</h2>
<p>FrostCal may display third-party advertising (for example, Google AdSense) to keep the site free. Ad providers may use cookies or similar technologies to serve and measure ads, including personalized ads where permitted. You can learn about Google's use of advertising data and opt out of personalization at <a href="https://policies.google.com/technologies/ads" rel="noopener">policies.google.com/technologies/ads</a>. This section applies only if and when ads are actually shown on the site.</p>

<h2>External links</h2>
<p>Pages link to external resources (NOAA, GeoNames, retailers, and others). Their privacy practices are their own; this policy covers only FrostCal.</p>

<h2>Contact</h2>
<p>Questions about this policy: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a> or see the <a href="${escapeHtml(url('/contact/'))}">contact page</a>.</p>

<p><em>Last updated: July 20, 2026.</em></p>
</div>`;
}

/** Contact page body. */
function buildContactBody(contactEmail) {
  return `<div class="methodology">
<h1>Contact</h1>
<p class="lede">Questions, corrections, or feedback about FrostCal's frost dates and planting calendars? Get in touch.</p>
<p>Email: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a></p>
<p>Especially useful to hear about:</p>
<ul>
<li><strong>Data issues</strong> — a city whose frost dates look wrong for the area (include the city and what you'd expect; note that dates come from the nearest NOAA station, which can differ from a specific microclimate).</li>
<li><strong>Missing cities</strong> — a US city you'd like added.</li>
<li><strong>Corrections</strong> — planting-window guidance that conflicts with your local extension office's advice.</li>
</ul>
<p>FrostCal is an independent reference site and is not affiliated with NOAA or the USDA. See <a href="${escapeHtml(url('/methodology/'))}">the methodology page</a> for how the numbers are produced.</p>
</div>`;
}

module.exports = {
  escapeHtml,
  parseMonthDay,
  formatDateLong,
  formatDateShort,
  haversineKm,
  nearestCitiesSameState,
  seasonContext,
  pickLength,
  buildTitle,
  buildDescription,
  buildAnswerLede,
  stateFrostRanges,
  buildStateLede,
  stateNameSlug,
  setCropGuideStates,
  hasCropGuide,
  cropGuidePath,
  buildComparison,
  buildAboutBody,
  buildSummaryBox,
  buildZoneCopy,
  buildCountdownWidget,
  buildTempChart,
  buildChartCard,
  buildCalendarTable,
  buildFaqSection,
  buildFaqJsonLd,
  buildNearbyCities,
  buildSiteHeader,
  buildBreadcrumbs,
  buildFooter,
  STATE_NAMES,
  stateName,
  formatPopulation,
  buildGenericBreadcrumbs,
  buildStateTitle,
  buildStateDescription,
  buildStateTable,
  buildTopCitiesTable,
  buildStatesAZList,
  buildSearchWidget,
  buildMethodologyBody,
  buildPrivacyBody,
  buildContactBody,
  build404Body,
  MONTH_NAMES,
  MONTH_ABBR
};
