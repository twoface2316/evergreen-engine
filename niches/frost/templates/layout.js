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

function buildTitle(city) {
  const candidates = [
    `Frost Dates & Planting Calendar for ${city.name}, ${city.state}`,
    `${city.name}, ${city.state} Frost Dates & Planting Calendar`,
    `${city.name}, ${city.state} Frost Dates & Garden Calendar`,
    `${city.name}, ${city.state} Frost Dates`
  ];
  for (const c of candidates) {
    if (c.length <= 60) return c;
  }
  return candidates[candidates.length - 1].slice(0, 60);
}

function buildDescription(city) {
  let base;
  if (city.frostFree) {
    base = `${city.name}, ${city.state} is frost-free per NOAA normals. See year-round planting guidance and a free 42-crop garden calendar.`;
  } else {
    const lastP50 = formatDateLong(city.lastSpringFrost && city.lastSpringFrost.p50);
    base = `Average last frost in ${city.name}, ${city.state} is ${lastP50}. Get frost dates, growing season length, and a free 42-crop planting calendar.`;
  }
  if (base.length <= 155) return base;
  const short = `Frost dates, growing season, and a planting calendar for ${city.name}, ${city.state}, based on NOAA climate normals.`;
  return short.length <= 155 ? short : short.slice(0, 152) + '...';
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
      <div class="value"><span id="usda-zone">Zone ${escapeHtml(zone)}</span></div>
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
  const md = parseMonthDay(city.lastSpringFrost.p50);
  if (!md) return '';
  const data = JSON.stringify({ month: md.month, day: md.day });
  return `<div class="countdown" id="frost-countdown">
  <span class="num" id="frost-countdown-num">—</span>
  <span class="txt">days until the typical last spring frost</span>
</div>
<script type="application/json" id="frost-countdown-data">${data}</script>
<script>(function(){
  var el = document.getElementById('frost-countdown-num');
  var dEl = document.getElementById('frost-countdown-data');
  if (!el || !dEl) return;
  try {
    var d = JSON.parse(dEl.textContent);
    var now = new Date();
    var target = new Date(now.getFullYear(), d.month - 1, d.day);
    target.setHours(0,0,0,0);
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (target < today) target.setFullYear(target.getFullYear() + 1);
    var days = Math.round((target - today) / 86400000);
    el.textContent = days === 0 ? 'Today' : String(days);
    if (days === 0) {
      el.nextElementSibling.textContent = 'is the typical last spring frost';
    }
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
        <td class="crop-name">${escapeHtml(r.name)}</td>
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
        <td class="crop-name">${escapeHtml(r.name)}</td>
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
  <p><a href="${escapeHtml(url('/methodology/'))}">How these dates are calculated (methodology)</a></p>
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

function buildStateTitle(name) {
  const candidates = [
    `${name} Frost Dates & Planting Calendars by City`,
    `${name} Frost Dates & Planting Calendars`,
    `${name} Frost Dates by City`,
    `${name} Frost Dates`
  ];
  for (const c of candidates) {
    if (c.length <= 60) return c;
  }
  return candidates[candidates.length - 1].slice(0, 60);
}

function buildStateDescription(name, cityCount) {
  const base = `Frost dates and free planting calendars for ${cityCount} cities in ${name}, based on NOAA 1991-2020 climate normals.`;
  if (base.length <= 155) return base;
  const short = `Frost dates and planting calendars for cities in ${name}, based on NOAA climate normals.`;
  return short.length <= 155 ? short : short.slice(0, 152) + '...';
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

module.exports = {
  escapeHtml,
  parseMonthDay,
  formatDateLong,
  formatDateShort,
  haversineKm,
  nearestCitiesSameState,
  buildTitle,
  buildDescription,
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
  build404Body,
  MONTH_NAMES,
  MONTH_ABBR
};
