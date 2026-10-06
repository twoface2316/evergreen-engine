'use strict';

/**
 * niches/frost/scripts/printables.js — printable planting calendars (paid PDFs).
 *
 * Cities are grouped by average last spring frost into half-month buckets
 * ("Last frost Apr 1–14"). Each bucket gets a 5-page landscape PDF: overview
 * with key dates, a 12-month planting chart for vegetables and for herbs and
 * flowers, a month-by-month task list, and a garden log page.
 *
 * The PDFs are sold, not published: they're written to out/printables/
 * (gitignored) for upload to a store. City pages link to the store through
 * buildCta() once niches/frost/config.js `printables.url` is set.
 *
 * CLI (from repo root):
 *   node niches/frost/scripts/printables.js         -> HTML + PDF for every bucket
 *   node niches/frost/scripts/printables.js html    -> HTML only (no Chrome needed)
 * Set CHROME_PATH if Chrome/Edge isn't in a standard install location.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { computeCalendar } = require('./calendar.js');
const layout = require('../templates/layout.js');
const nicheConfig = require('../config.js');
const { cityKey } = require('./06-folds.js');

const { escapeHtml, formatDateLong, formatDateShort } = layout;
const cfg = nicheConfig.printables || {};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

const doy = (m, d) => CUM[m - 1] + d;
function strDoy(s) {
  const [, m, d] = /^\d{4}-(\d{2})-(\d{2})/.exec(s);
  return doy(+m, +d);
}
function doyStr(n) {
  if (n > 365) n -= 365;
  let m = 12;
  while (CUM[m - 1] >= n) m--;
  return `2001-${String(m).padStart(2, '0')}-${String(n - CUM[m - 1]).padStart(2, '0')}`;
}
function median(nums) {
  const s = nums.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Half-month buckets by last spring frost. Earlier than Feb 1 or later
// than Jun 15 is near-frost-free or too rare to sell a calendar for.
const BUCKETS = [[2, 1, 14], [2, 15, 28], [3, 1, 14], [3, 15, 31], [4, 1, 14], [4, 15, 30], [5, 1, 14], [5, 15, 31], [6, 1, 15]]
  .map(([m, from, to]) => ({ m, from, to }));
for (const b of BUCKETS) {
  b.id = `${MON[b.m - 1].toLowerCase()}-${String(b.from).padStart(2, '0')}`;
  b.label = `${MON[b.m - 1]} ${b.from}–${b.to}`;
  b.start = doy(b.m, b.from);
  b.end = doy(b.m, b.to);
}

/** Bucket for a city record, or null (frost-free or outside the sold range). */
function bucketFor(city) {
  if (city.frostFree || !city.lastSpringFrost) return null;
  const n = strDoy(city.lastSpringFrost.p50);
  return BUCKETS.find((b) => n >= b.start && n <= b.end) || null;
}

// ---------------------------------------------------------------------
// City-page call to action
// ---------------------------------------------------------------------

function buildCta(city) {
  if (!cfg.url) return '';
  const b = bucketFor(city);
  if (!b) return '';
  const link = (cfg.urls && cfg.urls[b.id]) || cfg.url;
  return `<aside class="printable-cta">
<h3>Printable planting calendar for ${escapeHtml(city.name)}</h3>
<p>${escapeHtml(city.name)}'s average last frost (${escapeHtml(formatDateShort(city.lastSpringFrost.p50))}) puts it on our <strong>last frost ${escapeHtml(b.label)}</strong> calendar: a 12-month chart for 42 crops, a month-by-month task list, and a garden log, ready to print and pin up.</p>
<a class="btn" href="${escapeHtml(link)}" rel="noopener">Get the ${escapeHtml(b.label)} calendar${cfg.price ? ` &middot; ${escapeHtml(cfg.price)}` : ''}</a>
</aside>`;
}

// ---------------------------------------------------------------------
// PDF content
// ---------------------------------------------------------------------

function bucketStats(cities) {
  const groups = new Map(BUCKETS.map((b) => [b.id, []]));
  for (const c of cities) {
    const b = bucketFor(c);
    if (b) groups.get(b.id).push(c);
  }
  return BUCKETS.map((b) => {
    const g = groups.get(b.id);
    const med = (get) => doyStr(median(g.map((c) => strDoy(get(c)))));
    // Fall frosts in warm places land in January; count those as day 366+.
    const medFall = (get) => doyStr(median(g.map((c) => { const n = strDoy(get(c)); return n < 182 ? n + 365 : n; })));
    const last = { p10: med((c) => c.lastSpringFrost.p10), p50: med((c) => c.lastSpringFrost.p50), p90: med((c) => c.lastSpringFrost.p90) };
    const first = { p10: medFall((c) => c.firstFallFrost.p10), p50: medFall((c) => c.firstFallFrost.p50), p90: medFall((c) => c.firstFallFrost.p90) };
    const examples = g.slice().sort((a, c) => (c.population || 0) - (a.population || 0)).slice(0, 8).map((c) => `${c.name}, ${c.state}`);
    return { ...b, count: g.length, last, first, examples };
  });
}

/** [{left, width}] percent spans for a calendar DateRange, split if it wraps the year. */
function spans(r) {
  if (!r) return [];
  const s = doy(r.startMonth, r.startDay);
  const e = doy(r.endMonth, r.endDay) + 1;
  const pct = (n) => ((n - 1) / 365) * 100;
  if (e > s) return [{ left: pct(s), width: pct(e) - pct(s) }];
  return [{ left: pct(s), width: 100 - pct(s) }, { left: 0, width: pct(e) }];
}

const TYPES = [
  { key: 'seedStart', label: 'Start seeds indoors', cls: 'seed' },
  { key: 'directSow', label: 'Sow outdoors', cls: 'sow' },
  { key: 'transplant', label: 'Transplant / plant out', cls: 'plant' },
  { key: 'fallPlanting', label: 'Plant for fall', cls: 'fall' }
];

function frostBands(stats) {
  // NOAA percentiles run opposite ways: last frost p90 is the earliest date
  // and p10 the latest; first frost p10 is the earliest and p90 the latest.
  const band = (from, to, cls) => {
    const [, m1, d1] = from.split('-').map(Number);
    const [, m2, d2] = to.split('-').map(Number);
    return spans({ startMonth: m1, startDay: d1, endMonth: m2, endDay: d2 })
      .map((sp) => `<div class="frost-band ${cls}" style="left:${sp.left.toFixed(2)}%;width:${sp.width.toFixed(2)}%"></div>`).join('');
  };
  return band(stats.last.p90, stats.last.p10, 'last') + band(stats.first.p10, stats.first.p90, 'first');
}

function chartPage(title, entries, stats, pageNo) {
  const monthHeads = MON.map((m, i) => `<div class="mh" style="left:${((CUM[i] / 365) * 100).toFixed(2)}%;width:${(((CUM[i + 1] - CUM[i]) / 365) * 100).toFixed(2)}%">${m}</div>`).join('');
  const grid = CUM.slice(1, 12).map((c) => `<div class="vl" style="left:${((c / 365) * 100).toFixed(2)}%"></div>`).join('');
  const rows = entries.map((e) => {
    const bars = TYPES.flatMap((t) => spans(e[t.key]).map((sp) => `<div class="bar ${t.cls}" style="left:${sp.left.toFixed(2)}%;width:${Math.max(sp.width, 0.8).toFixed(2)}%"></div>`)).join('');
    return `<div class="row"><div class="crop">${escapeHtml(e.name)}</div><div class="track">${bars}</div></div>`;
  }).join('');
  return `<section class="page">
${pageHeader(title, stats)}
<div class="chart">
  <div class="row head"><div class="crop"></div><div class="track">${monthHeads}</div></div>
  <div class="rows"><div class="overlay">${grid}${frostBands(stats)}</div>${rows}</div>
</div>
${legend()}
${pageFooter(pageNo)}
</section>`;
}

function legend() {
  return `<div class="legend">${TYPES.map((t) => `<span><i class="bar ${t.cls}"></i>${t.label}</span>`).join('')}<span><i class="frost-band last"></i>Last-frost risk window</span><span><i class="frost-band first"></i>First-frost risk window</span></div>`;
}

function pageHeader(title, stats) {
  return `<header class="ph"><div class="ph-title">${escapeHtml(title)}</div><div class="ph-tag">Last frost ${escapeHtml(stats.label)} &middot; FrostCal</div></header>`;
}

function pageFooter(n) {
  return `<footer class="pf"><span>Frost dates from NOAA 1991–2020 climate normals. Look up your exact town at frostcal.com</span><span>${n}</span></footer>`;
}

const QUICK = ['tomato', 'pepper', 'cucumber', 'zucchini', 'green-bean', 'pea', 'lettuce', 'carrot', 'potato', 'garlic'];

function quickTable(entries) {
  const rows = QUICK.map((slug) => entries.find((e) => e.slug === slug)).filter(Boolean)
    .map((e) => `<tr><td>${escapeHtml(e.name)}</td>${TYPES.map((t) => `<td>${e[t.key] ? escapeHtml(e[t.key].label) : '<span class="dash">—</span>'}</td>`).join('')}</tr>`).join('');
  return `<h2 class="qh">Quick dates for popular crops</h2>
<table class="quick"><thead><tr><th>Crop</th>${TYPES.map((t) => `<th>${t.label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function overviewPage(stats, entries) {
  const frostFreeDays = (strDoy(stats.first.p50) - strDoy(stats.last.p50) + 365) % 365;
  return `<section class="page cover">
<div class="brand">Frost<span>Cal</span></div>
<h1>Planting Calendar</h1>
<div class="sub">For gardens with an average last spring frost of <strong>${escapeHtml(stats.label)}</strong></div>
<div class="cards">
  <div class="card"><div class="k">Average last frost</div><div class="v">${escapeHtml(formatDateLong(stats.last.p50))}</div><div class="n">Safer planting date: ${escapeHtml(formatDateLong(stats.last.p10))} (10% chance of a later frost)</div></div>
  <div class="card"><div class="k">Average first fall frost</div><div class="v">${escapeHtml(formatDateLong(stats.first.p50))}</div><div class="n">Could come as early as ${escapeHtml(formatDateLong(stats.first.p10))}</div></div>
  <div class="card"><div class="k">Growing season</div><div class="v">${frostFreeDays} days</div><div class="n">Frost-free days in a typical year</div></div>
</div>
<div class="cols">
  <div>
    <h2>Is this the right calendar for you?</h2>
    <p>This calendar fits any garden whose average last spring frost falls between ${escapeHtml(stats.label)}. Places in this range include ${escapeHtml(stats.examples.join('; '))}.</p>
    <p>Not sure of your date? Enter your ZIP code at <strong>frostcal.com</strong>. It's free.</p>
  </div>
  <div>
    <h2>How to use it</h2>
    <ul>
      <li><strong>Pages 2–3:</strong> a 12-month chart for 42 vegetables, herbs, and flowers. Each colored bar is a planting window.</li>
      <li><strong>Page 4:</strong> what to do each month.</li>
      <li><strong>Page 5:</strong> a log for what you planted and when frost actually came.</li>
      <li>Frost dates are averages. Watch the forecast near the shaded frost windows and keep frost cloth handy.</li>
    </ul>
  </div>
</div>
${quickTable(entries)}
${pageFooter(1)}
</section>`;
}

function taskPage(entries, stats) {
  const months = MONTHS.map((name, i) => {
    const m = i + 1;
    const a = CUM[i] + 1;
    const z = CUM[m];
    const lines = [];
    for (const t of TYPES) {
      const names = entries.filter((e) => spans(e[t.key]).some((sp) => {
        const s = Math.round((sp.left / 100) * 365) + 1;
        const e2 = s + Math.round((sp.width / 100) * 365) - 1;
        return s <= z && e2 >= a;
      })).map((e) => e.name);
      if (names.length) lines.push(`<li><strong>${t.label}:</strong> ${escapeHtml(names.join(', '))}</li>`);
    }
    const lf = strDoy(stats.last.p50);
    const ff = strDoy(stats.first.p50);
    if (lf >= a && lf <= z) lines.unshift(`<li class="frost">Average last frost ${escapeHtml(formatDateShort(stats.last.p50))}. Keep covers ready until ${escapeHtml(formatDateShort(stats.last.p10))}.</li>`);
    if (ff >= a && ff <= z) lines.unshift(`<li class="frost">Average first frost ${escapeHtml(formatDateShort(stats.first.p50))}. Harvest tender crops before it; cover the rest.</li>`);
    const growing = z >= lf && a <= ff;
    if (!lines.length) lines.push(`<li class="quiet">${growing ? 'Water, weed, mulch, and harvest.' : 'Rest, plan, and order seeds.'}</li>`);
    return `<div class="month"><h3>${name}</h3><ul>${lines.join('')}</ul></div>`;
  }).join('');
  return `<section class="page">
${pageHeader('Month-by-Month Garden Tasks', stats)}
<div class="months">${months}</div>
${pageFooter(4)}
</section>`;
}

function logPage(stats) {
  const rows = Array.from({ length: 16 }, () => '<tr><td></td><td></td><td></td><td></td></tr>').join('');
  return `<section class="page">
${pageHeader('Garden Log', stats)}
<div class="log-top">
  <div>This year's last spring frost: <span class="blank"></span></div>
  <div>This year's first fall frost: <span class="blank"></span></div>
</div>
<table class="log"><thead><tr><th style="width:14%">Date</th><th style="width:26%">Planted / sowed</th><th style="width:16%">Variety</th><th>Notes (weather, germination, harvest)</th></tr></thead><tbody>${rows}</tbody></table>
${pageFooter(5)}
</section>`;
}

const CSS = `
@page { size: 11in 8.5in; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Helvetica, Arial, sans-serif; color: #1f2a1f; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 11in; height: 8.5in; padding: 0.45in 0.5in 0.4in; position: relative; page-break-after: always; overflow: hidden; display: flex; flex-direction: column; }
.page:last-child { page-break-after: auto; }
.ph { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #3f7d4a; padding-bottom: 6px; margin-bottom: 10px; }
.ph-title { font-size: 20px; font-weight: 700; }
.ph-tag { font-size: 11px; color: #5b6b58; }
.pf { position: absolute; left: 0.5in; right: 0.5in; bottom: 0.22in; display: flex; justify-content: space-between; font-size: 9px; color: #5b6b58; }
.brand { font-size: 18px; font-weight: 700; color: #2c5c34; } .brand span { color: #8a6a37; }
.cover h1 { font-size: 44px; margin: 10px 0 0; }
.cover .sub { font-size: 18px; color: #5b6b58; margin-bottom: 20px; }
.cards { display: flex; gap: 14px; margin-bottom: 18px; }
.card { flex: 1; border: 1px solid #e1e3d8; border-top: 4px solid #3f7d4a; border-radius: 8px; padding: 12px 14px; background: #fbfaf6; }
.card .k { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #5b6b58; }
.card .v { font-size: 26px; font-weight: 700; margin: 4px 0; }
.card .n { font-size: 11px; color: #5b6b58; }
.cols { display: flex; gap: 28px; font-size: 13px; line-height: 1.5; }
.cols > div { flex: 1; }
.cols h2 { font-size: 15px; margin: 0 0 6px; color: #2c5c34; }
.cols ul { padding-left: 1.1em; margin: 0; }
.chart { flex: 1; display: flex; flex-direction: column; font-size: 10.5px; }
.rows { position: relative; flex: 1; display: flex; flex-direction: column; }
.row { display: flex; align-items: center; flex: 1; border-bottom: 1px solid #eeeee6; min-height: 0; }
.row.head { flex: 0 0 18px; border-bottom: 1px solid #c9ccbd; font-weight: 600; color: #5b6b58; }
.crop { width: 1.35in; flex: 0 0 1.35in; padding-right: 6px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.track { position: relative; flex: 1; height: 100%; }
.mh { position: absolute; top: 2px; text-align: center; }
.overlay { position: absolute; left: 1.35in; right: 0; top: 0; bottom: 0; pointer-events: none; }
.vl { position: absolute; top: 0; bottom: 0; border-left: 1px solid #e4e5dc; }
.frost-band { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, rgba(63,127,176,.16) 0 4px, rgba(63,127,176,.05) 4px 8px); border-left: 1px dashed #3f7fb0; border-right: 1px dashed #3f7fb0; }
.bar { position: absolute; top: 50%; height: 12px; margin-top: -6px; border-radius: 3px; }
.bar.seed { background: #6a9fcf; } .bar.sow { background: #4f9a5c; } .bar.plant { background: #d9a43a; } .bar.fall { background: #c4673a; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 10.5px; margin-top: 8px; color: #3b4a38; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { position: static; display: inline-block; width: 22px; height: 10px; margin: 0; border-radius: 2px; }
.months { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(3, 1fr); gap: 8px; font-size: 9px; line-height: 1.35; }
.month { border: 1px solid #e1e3d8; border-radius: 6px; padding: 6px 8px; overflow: hidden; }
.month h3 { margin: 0 0 3px; font-size: 12px; color: #2c5c34; }
.month ul { list-style: none; margin: 0; padding: 0; }
.month li { margin-bottom: 2px; }
.month li.frost { color: #2f5f8a; font-weight: 600; }
.month li.quiet { color: #5b6b58; font-style: italic; }
.qh { font-size: 15px; margin: 16px 0 6px; color: #2c5c34; }
table.quick { width: 100%; border-collapse: collapse; font-size: 11.5px; }
table.quick th { text-align: left; border-bottom: 2px solid #3f7d4a; padding: 4px 6px; font-size: 10.5px; color: #5b6b58; }
table.quick td { border-bottom: 1px solid #e4e5dc; padding: 4px 6px; }
table.quick td:first-child { font-weight: 600; }
table.quick .dash { color: #b9bcae; }
.log-top { display: flex; gap: 40px; font-size: 13px; margin: 4px 0 12px; }
.blank { display: inline-block; width: 1.6in; border-bottom: 1px solid #1f2a1f; }
table.log { width: 100%; border-collapse: collapse; font-size: 11px; flex: 1; }
table.log th { text-align: left; border-bottom: 2px solid #3f7d4a; padding: 4px 6px; }
table.log td { border-bottom: 1px solid #c9ccbd; height: 0.36in; }
`;

function renderBucketHtml(stats, crops) {
  const entries = computeCalendar({ frostFree: false, lastFrost: stats.last, firstFrost: stats.first }, crops);
  const veg = entries.filter((e) => e.category === 'vegetable');
  const other = entries.filter((e) => e.category !== 'vegetable');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FrostCal Planting Calendar: Last Frost ${escapeHtml(stats.label)}</title><style>${CSS}</style></head>
<body>
${overviewPage(stats, entries)}
${chartPage('Vegetable Planting Chart', veg, stats, 2)}
${chartPage('Herb & Flower Planting Chart', other, stats, 3)}
${taskPage(entries, stats)}
${logPage(stats)}
</body></html>`;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function loadCities() {
  const dataDir = path.join(__dirname, '..', 'data');
  const cities = require(path.join(dataDir, 'cities-frost.json'));
  const foldsPath = path.join(dataDir, 'folds.json');
  const folded = fs.existsSync(foldsPath) ? new Set(Object.keys(JSON.parse(fs.readFileSync(foldsPath, 'utf8')))) : new Set();
  return cities.filter((c) => !folded.has(cityKey(c)));
}

function run(mode) {
  const crops = require('../data/crops.json');
  const outDir = path.join(__dirname, '..', '..', '..', 'out', 'printables');
  const htmlDir = path.join(outDir, 'html');
  const pdfDir = path.join(outDir, 'pdf');
  fs.mkdirSync(htmlDir, { recursive: true });
  const chrome = mode === 'html' ? null : findChrome();
  if (mode !== 'html') {
    if (!chrome) throw new Error('Chrome/Edge not found; set CHROME_PATH or run with "html".');
    fs.mkdirSync(pdfDir, { recursive: true });
  }

  for (const stats of bucketStats(loadCities())) {
    const htmlPath = path.join(htmlDir, `${stats.id}.html`);
    fs.writeFileSync(htmlPath, renderBucketHtml(stats, crops), 'utf8');
    let note = '';
    if (chrome) {
      const pdfPath = path.join(pdfDir, `frostcal-planting-calendar-last-frost-${stats.id}.pdf`);
      execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, `file:///${htmlPath.replace(/\\/g, '/')}`], { stdio: 'ignore' });
      note = ` -> ${path.relative(process.cwd(), pdfPath)}`;
    }
    console.log(`${stats.label.padEnd(12)} ${String(stats.count).padStart(5)} cities  last ${stats.last.p50.slice(5)}  first ${stats.first.p50.slice(5)}${note}`);
  }
}

if (require.main === module) run(process.argv[2]);

module.exports = { BUCKETS, bucketFor, buildCta, bucketStats, renderBucketHtml };
