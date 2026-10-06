'use strict';

/**
 * niches/home/templates/layout.js — markup builders for the water + radon
 * niche. Pure string functions over plain objects; render.js owns data
 * loading and file writing.
 */

const { escapeHtml } = require('../../../engine/lib/escape-html.js');
const basePath = require('../../../engine/lib/base-path.js');
const { hardnessBand, toGpg, softenerSize, leadStatus, RADON_ZONES } = require('../scripts/model.js');
const { stateName } = require('../scripts/states.js');
const config = require('../config.js');

const url = (p) => basePath.href(p);
const cityPath = (c) => `/${c.stateSlug}/${c.slug}/`;
const statePath = (abbr) => `/${abbr.toLowerCase()}/`;
const e = escapeHtml;

const num = (n) => Math.round(n).toLocaleString('en-US');
const fix1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const ppb = (mgL) => `${fix1(mgL * 1000)} ppb`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (iso) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
const buildYear = () => new Date().getFullYear();

const KEEP_UPPER = new Set(['LLC', 'MHP', 'WSC', 'MUD', 'PUD', 'UD', 'WD', 'PSD', 'CWD', 'WSD', 'DWP', 'USA', 'II', 'III', 'IV', 'WTP', 'RWD', 'SUD', 'WCID', 'FWSD', 'MDWASA', 'BPU', 'PWD', 'MWD', 'WSA', 'PWS', 'HOA', 'KOA', 'NYC', 'DC']);
/** "NEWARK WATER DEPARTMENT" -> "Newark Water Department"; keeps utility acronyms. */
function utilityName(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/[a-z0-9']+/g, (w) => {
      const up = w.toUpperCase();
      if (KEEP_UPPER.has(up) || !/[aeiouy]/.test(w)) return up;
      if (['of', 'and', 'the', 'in', 'at'].includes(w)) return w;
      return w[0].toUpperCase() + w.slice(1);
    })
    .replace(/^./, (c) => c.toUpperCase());
}

const SOURCE = {
  GW: 'groundwater (wells)',
  SW: 'surface water (rivers, lakes, reservoirs)',
  GU: 'groundwater influenced by surface water',
  GWP: 'purchased groundwater',
  SWP: 'purchased surface water',
  GUP: 'purchased groundwater influenced by surface water'
};
const OWNER = { L: 'local government', P: 'private company', M: 'public/private partnership', F: 'federal government', S: 'state government', N: 'tribal government' };
const CATEGORY = {
  MCL: 'Contaminant above the legal limit',
  MRDL: 'Disinfectant above the legal limit',
  TT: 'Required treatment not met',
  MR: 'Missed monitoring or reporting',
  Other: 'Other (notices, records)'
};

// ---------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------
function buildSiteHeader() {
  return `<header class="site-header"><div class="wrap">
  <a class="brand" href="${e(url('/'))}"><span class="drop" aria-hidden="true"></span>${e(config.siteName)}</a>
  <nav><a href="${e(url('/water-softener-calculator/'))}">Softener calculator</a><a href="${e(url('/states/'))}">States</a><a href="${e(url('/methodology/'))}">Methodology</a></nav>
</div></header>`;
}

function buildBreadcrumbs(trail) {
  const items = trail.map((t, i) => (i === trail.length - 1 ? `<span>${e(t.label)}</span>` : `<a href="${e(url(t.href))}">${e(t.label)}</a>`));
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${items.join(' <span aria-hidden="true">›</span> ')}</nav>`;
}

function buildFooter(sources) {
  const disclosure = config.amazonTag ? '<p>As an Amazon Associate we earn from qualifying purchases.</p>' : '';
  return `<footer class="site-footer">
  <div class="disclaimer">Reference information from public records — <strong>not a guarantee that any tap is safe or unsafe</strong>. Water quality changes, and your home's own pipes matter. Your utility's annual Consumer Confidence Report and a certified lab test are the authoritative sources.</div>
  <p>Utilities, violations and lead/copper results: <a href="https://echo.epa.gov/" rel="noopener">EPA Safe Drinking Water Information System via ECHO</a>${sources && sources.waterAsOf ? ` (data through ${e(sources.waterAsOf)})` : ''}. Radon zones: <a href="https://www.epa.gov/radon/epa-map-radon-zones-0" rel="noopener">EPA Map of Radon Zones</a>.</p>
  <p>Water hardness: <a href="https://www.tapwaterdata.com/water-hardness" rel="noopener">TapWaterData US Water Hardness Dataset</a>, used under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>. Place data: <a href="https://www.geonames.org/" rel="noopener">GeoNames.org</a>, CC BY 4.0.</p>
  ${disclosure}<p><a href="${e(url('/water-softener-calculator/'))}">Water softener calculator</a> &middot; <a href="${e(url('/states/'))}">Water by state</a> &middot; <a href="${e(url('/methodology/'))}">Methodology</a> &middot; <a href="${e(url('/about/'))}">About</a> &middot; <a href="${e(url('/privacy/'))}">Privacy</a> &middot; <a href="${e(url('/contact/'))}">Contact</a></p>
  <p>&copy; ${buildYear()} ${e(config.siteName)}.</p>
</footer>`;
}

// ---------------------------------------------------------------------
// City page
// ---------------------------------------------------------------------
function buildCityTitle(city) {
  const opts = [`Is ${city.name}, ${city.state} Tap Water Safe? Quality & Hardness`, `Is ${city.name}, ${city.state} Tap Water Safe? (${buildYear()})`, `${city.name}, ${city.state} Tap Water Quality`];
  return opts.find((t) => t.length <= 60) || opts[opts.length - 1];
}

function buildCityDescription(city, d) {
  const parts = [];
  if (d.primary) parts.push(`${utilityName(d.primary.name)}: ${d.primary.violations.healthBased} health-based violations since ${d.windowYear}.`);
  if (d.hardness) parts.push(`Water is ${hardnessBand(d.hardness.mgL).label.toLowerCase()} (${num(d.hardness.mgL)} mg/L).`);
  if (d.radon) parts.push(`Radon zone ${d.radon.zone}.`);
  const text = `${city.name}, ${city.state} tap water: ${parts.join(' ')}`;
  return text.length <= 155 ? text : text.slice(0, 152).replace(/\s+\S*$/, '') + '…';
}

function buildLede(city, d) {
  const s = [];
  if (d.primary) {
    const p = d.primary;
    const hb = p.violations.healthBased;
    s.push(`${e(city.name)}'s largest water utility, <strong>${e(utilityName(p.name))}</strong>, serves about ${num(p.pop)} people and has had <strong>${hb === 0 ? 'no' : hb} health-based violation${hb === 1 ? '' : 's'}</strong> since ${d.windowYear}${p.violations.open ? `, ${p.violations.open} not yet resolved` : ''}.`);
  } else {
    s.push(`We couldn't match ${e(city.name)} to a single community water utility in EPA records — many unincorporated areas and neighborhoods are served by a utility named for a nearby city or district.`);
  }
  if (d.hardness) s.push(`The water is <strong>${hardnessBand(d.hardness.mgL).label.toLowerCase()}</strong> at ${num(d.hardness.mgL)} mg/L (${fix1(toGpg(d.hardness.mgL))} grains per gallon).`);
  if (d.radon) s.push(`${e(d.radon.county)} is in EPA <strong>radon zone ${d.radon.zone}</strong> (${RADON_ZONES[d.radon.zone].key} potential).`);
  return `<p class="lede">${s.join(' ')}</p>`;
}

function chip(label, value, sub, tone) {
  return `<div class="stat tone-${tone}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

function buildSummary(city, d) {
  const out = [];
  if (d.primary) {
    const v = d.primary.violations;
    out.push(chip(`Health violations since ${d.windowYear}`, num(v.healthBased), v.healthBased ? `latest ${monthYear(v.list.find((x) => x.health).begin)}` : 'none on record', v.healthBased === 0 ? 'good' : d.recentHealth > 0 ? 'bad' : 'warn'));
    const ls = leadStatus(d.primary.lead ? d.primary.lead.mgL : null, config.lead.actionLevelMgL);
    out.push(chip('Lead (90th percentile)', !d.primary.lead ? '—' : d.primary.lead.mgL === 0 ? 'None found' : ppb(d.primary.lead.mgL), d.primary.lead ? `${d.primary.lead.mgL === 0 ? 'Not detected' : ls.label}, ${monthYear(d.primary.lead.date)}` : ls.label, { over: 'bad', elevated: 'warn', low: 'good', nd: 'good', none: 'muted' }[ls.key]));
  }
  if (d.hardness) {
    const b = hardnessBand(d.hardness.mgL);
    out.push(chip('Hardness', `${fix1(toGpg(d.hardness.mgL))} gpg`, `${b.label}, ${num(d.hardness.mgL)} mg/L`, { soft: 'good', moderate: 'good', hard: 'warn', 'very-hard': 'warn' }[b.key]));
  }
  if (d.radon) {
    out.push(chip('Radon zone', String(d.radon.zone), `${RADON_ZONES[d.radon.zone].key} potential (${e(d.radon.county)})`, { 1: 'bad', 2: 'warn', 3: 'good' }[d.radon.zone]));
  }
  return `<section class="summary" aria-label="Summary for ${e(city.name)}"><div class="stats">${out.join('')}</div></section>`;
}

function buildUtility(city, d) {
  if (!d.primary) {
    return `<section class="card">
  <h2>Who supplies ${e(city.name)}'s water?</h2>
  <p>Look up your utility by entering your address in EPA's <a href="https://enviro.epa.gov/envirofacts/sdwis/search" rel="noopener">SDWIS search</a>, or check the name on your water bill. Every community utility must publish an annual Consumer Confidence Report listing what was found in the water. Homes on private wells aren't covered by these rules at all — test a well yourself at least once a year.</p>
</section>`;
  }
  const p = d.primary;
  const v = p.violations;
  const cats = Object.entries(v.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<li>${e(CATEGORY[k] || k)}: <strong>${n}</strong></li>`)
    .join('');
  const others = d.others.length
    ? `<p class="muted">Other community systems that list ${e(city.name)} in their service area: ${d.others.map((o) => `${e(utilityName(o.name))} (${num(o.pop)} people)`).join(', ')}.</p>`
    : '';
  return `<section class="card">
  <h2>${e(utilityName(p.name))}</h2>
  <p>Public water system <strong>${e(p.id)}</strong>, run by a ${e(OWNER[p.owner] || 'utility')}, draws ${e(SOURCE[p.source] || 'its water')} and serves about ${num(p.pop)} people.</p>
  ${v.total ? `<p>Since ${d.windowYear}, EPA records <strong>${num(v.total)} violation${v.total === 1 ? '' : 's'}</strong>, ${num(v.healthBased)} of them health-based:</p><ul>${cats}</ul>` : `<p>No Safe Drinking Water Act violations on record since ${d.windowYear}.</p>`}
  ${others}
</section>`;
}

function buildViolationTable(d) {
  if (!d.primary || !d.primary.violations.list.length) return '';
  const rows = d.primary.violations.list
    .map(
      (v) =>
        `<tr${v.health ? ' class="hb"' : ''}><td>${monthYear(v.begin)}</td><td>${e(v.contaminant)}</td><td>${e(CATEGORY[v.category] || v.category)}${v.health ? ' <span class="tag">health</span>' : ''}</td><td>${v.measure && v.limit && v.limit.trim() && !/^TT/.test(v.limit) ? `${e(v.measure.toLowerCase())} vs ${e(v.limit.trim())}` : '—'}</td><td>${e(v.status || '')}</td></tr>`
    )
    .join('');
  const shown = d.primary.violations.list.length;
  return `<section class="card">
  <h2>Violation history</h2>
  <p>Health-based violations first, then monitoring and reporting violations, newest first${d.primary.violations.total > shown ? ` (${shown} of ${d.primary.violations.total} shown)` : ''}.</p>
  <div class="table-wrap"><table class="data">
  <thead><tr><th>Began</th><th>Contaminant / rule</th><th>Type</th><th>Measured</th><th>Status</th></tr></thead>
  <tbody>${rows}</tbody></table></div>
  <p class="muted">Health-based means the water exceeded a limit or required treatment wasn't done. Monitoring violations mean a required test or report was missed — not that the water was unsafe, but nobody can say it wasn't.</p>
</section>`;
}

function buildLeadCopper(city, d) {
  if (!d.primary || (!d.primary.lead && !d.primary.copper)) return '';
  const p = d.primary;
  const hist = p.lead && p.lead.history.length > 1 ? `<p class="muted">Earlier lead results: ${p.lead.history.slice(1).map(([dt, v]) => `${ppb(v)} (${monthYear(dt)})`).join(', ')}.</p>` : '';
  return `<section class="card">
  <h2>Lead and copper</h2>
  ${p.lead ? `<p>In ${monthYear(p.lead.date)} testing, 90% of sampled homes had lead at or below <strong>${ppb(p.lead.mgL)}</strong>. EPA's action level is ${ppb(config.lead.actionLevelMgL)}, but EPA's health goal for lead is zero — there is no known safe level, especially for children.</p>` : ''}
  ${p.copper ? `<p>Copper's 90th percentile was ${fix1(p.copper.mgL * 1000) === '0.0' ? 'not detected' : `${(Math.round(p.copper.mgL * 100) / 100).toFixed(2)} mg/L`} (action level ${config.copper.actionLevelMgL} mg/L).</p>` : ''}
  ${hist}
  <p>Utility results come from a sample of homes. Lead usually enters water from a home's own service line, solder and fixtures, so the only way to know your tap is to test it — especially in a home built before 1986.</p>
</section>`;
}

function buildHardness(city, d) {
  if (!d.hardness) return '';
  const h = d.hardness;
  const b = hardnessBand(h.mgL);
  const gpg = toGpg(h.mgL);
  const advice = {
    soft: 'Soft water needs no softener. It can taste slightly salty-flat and lathers easily.',
    moderate: 'Moderately hard water leaves some spots and scale; most homes manage without a softener.',
    hard: 'Hard water builds scale in water heaters, kettles and fixtures and leaves spots on dishes and glass. Many homes here use a softener.',
    'very-hard': 'Very hard water scales up water heaters and appliances quickly, dulls laundry and leaves heavy spotting. A softener usually pays for itself in appliance life and soap.'
  }[b.key];
  const tier = { T1: 'utility-reported', T2: 'computed from utility calcium and magnesium results', T3: 'a county-wide estimate from EPA/USGS water samples' }[h.tier] || 'public data';
  return `<section class="card">
  <h2>How hard is ${e(city.name)} water?</h2>
  <p>${e(city.name)} water measures about <strong>${num(h.mgL)} mg/L</strong> as calcium carbonate — <strong>${fix1(gpg)} grains per gallon</strong>, which the USGS classifies as <strong>${b.label.toLowerCase()}</strong>. ${advice}</p>
  <p class="muted">Value is ${e(tier)}${h.matchedCity ? ` for nearby ${e(h.matchedCity)}` : ''}${h.sourceDate ? `, ${monthYear(h.sourceDate)}` : ''}${h.disputed ? '; sources disagree for this place, so treat it as approximate' : ''}.</p>
</section>`;
}

/** Softener sizing calculator; embeds model.softenerSize so results match the page. */
function buildSoftenerCalc({ id = 'soft', gpg, heading, intro }) {
  const s = config.softener;
  return `<section class="card calc" id="${id}">
  <h2>${heading}</h2>
  <p>${intro}</p>
  <form class="calc-form" onsubmit="return false">
    <label>People in home<input id="${id}-people" type="number" min="1" max="12" step="1" value="4"></label>
    <label>Hardness (grains/gal)<input id="${id}-gpg" type="number" min="0" max="80" step="0.1" value="${fix1(gpg)}"></label>
    <label>Gallons per person/day<input id="${id}-gal" type="number" min="20" max="200" step="5" value="${s.gallonsPerPersonDay}"></label>
    <label>Days between regenerations<input id="${id}-days" type="number" min="3" max="14" step="1" value="${s.daysBetweenRegen}"></label>
  </form>
  <div class="calc-out" aria-live="polite">
    <div><span>Hardness removed per day</span><strong id="${id}-daily"></strong></div>
    <div><span>Capacity needed</span><strong id="${id}-need"></strong></div>
    <div><span>Recommended softener</span><strong id="${id}-size"></strong></div>
  </div>
  <script>
(function () {
  ${softenerSize.toString()}
  var SIZES = ${JSON.stringify(s.sizes)};
  var $ = function (k) { return document.getElementById('${id}-' + k); };
  var n = function (x) { return Math.round(x).toLocaleString('en-US'); };
  function run() {
    var r = softenerSize(+$('people').value, +$('gpg').value, +$('gal').value, +$('days').value, SIZES);
    $('daily').textContent = n(r.daily) + ' grains';
    $('need').textContent = n(r.needed) + ' grains';
    $('size').textContent = +$('gpg').value < 3.5 ? 'Not needed (soft water)' : r.size ? n(r.size) + '-grain' : 'Two units or commercial size';
  }
  ['people', 'gpg', 'gal', 'days'].forEach(function (k) { $(k).addEventListener('input', run); });
  run();
})();
  </script>
</section>`;
}

function buildRadon(city, d) {
  if (!d.radon) return '';
  const z = RADON_ZONES[d.radon.zone];
  return `<section class="card">
  <h2>Radon risk in ${e(d.radon.county)}</h2>
  <p>EPA places ${e(d.radon.county)} in <strong>${e(z.label)}</strong>: predicted average indoor radon ${e(z.level)}. Radon is an odorless radioactive gas from soil and rock and the leading cause of lung cancer among non-smokers.</p>
  <p>Zone is a county average, not a prediction for your house — homes with high radon turn up in every zone. EPA recommends testing every home; fix it at 4 pCi/L or above, and consider fixing between 2 and 4. Short-term test kits cost little and take a few days.</p>
</section>`;
}

function amazonSearch(q) {
  return `https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=${encodeURIComponent(config.amazonTag)}`;
}

function buildProducts(d) {
  if (!config.amazonTag) return '';
  const items = [['Certified lead test kit', 'lead water test kit']];
  if (d.hardness && hardnessBand(d.hardness.mgL).key !== 'soft') items.push(['Water hardness test strips', 'water hardness test strips']);
  if (d.primary && d.primary.violations.healthBased) items.push(['NSF/ANSI 53 water filter pitcher', 'nsf 53 certified water filter pitcher']);
  if (d.radon) items.push(['Radon test kit', 'radon test kit']);
  return `<aside class="products"><h2>Test or treat your water</h2><ul>${items
    .map(([label, q]) => `<li><a href="${e(amazonSearch(q))}" rel="sponsored noopener">${e(label)}</a></li>`)
    .join('')}</ul><p class="muted">Sponsored links; we may earn a commission.</p></aside>`;
}

function buildFaqs(city, d) {
  const place = `${city.name}, ${city.state}`;
  const faqs = [];
  if (d.primary) {
    const v = d.primary.violations;
    faqs.push({
      q: `Is ${place} tap water safe to drink?`,
      a: `${utilityName(d.primary.name)} has ${v.healthBased === 0 ? 'no health-based violations' : `${v.healthBased} health-based violation${v.healthBased === 1 ? '' : 's'}`} in EPA records since ${d.windowYear}${v.open ? `, with ${v.open} not yet resolved` : ''}. A clean record means the utility met federal limits; it doesn't cover lead from your own pipes, so test your tap if your home predates 1986.`
    });
  }
  if (d.hardness) {
    faqs.push({
      q: `Does ${place} have hard water?`,
      a: `${city.name} water is ${hardnessBand(d.hardness.mgL).label.toLowerCase()} at about ${num(d.hardness.mgL)} mg/L, or ${fix1(toGpg(d.hardness.mgL))} grains per gallon.`
    });
    const r = softenerSize(4, toGpg(d.hardness.mgL), config.softener.gallonsPerPersonDay, config.softener.daysBetweenRegen, config.softener.sizes);
    if (toGpg(d.hardness.mgL) >= 3.5 && r.size) {
      faqs.push({
        q: `What size water softener do I need in ${city.name}?`,
        a: `A family of four using ${config.softener.gallonsPerPersonDay} gallons per person a day removes about ${num(r.daily)} grains of hardness daily, so a ${num(r.size)}-grain softener regenerating weekly fits.`
      });
    }
  }
  if (d.radon) {
    faqs.push({
      q: `Is radon a problem in ${city.name}?`,
      a: `${d.radon.county} is EPA radon zone ${d.radon.zone}, meaning ${RADON_ZONES[d.radon.zone].key} potential (predicted indoor average ${RADON_ZONES[d.radon.zone].level}). EPA recommends testing every home regardless of zone.`
    });
  }
  if (d.primary && d.primary.lead) {
    faqs.push({
      q: `Is there lead in ${city.name} water?`,
      a: `In the utility's ${monthYear(d.primary.lead.date)} tests, 90% of sampled homes were at or below ${ppb(d.primary.lead.mgL)} of lead, against EPA's 15 ppb action level. Lead mostly comes from household plumbing, so results vary by home.`
    });
  }
  return faqs;
}

function buildFaqSection(faqs) {
  if (!faqs.length) return '';
  return `<section class="card faq"><h2>Frequently asked questions</h2>
  ${faqs.map((f) => `<details><summary>${e(f.q)}</summary><p>${e(f.a)}</p></details>`).join('\n  ')}
</section>`;
}

function buildFaqJsonLd(faqs) {
  return { '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
}

function buildNearby(rows) {
  if (!rows.length) return '';
  return `<section class="card"><h2>Water quality nearby</h2><ul class="nearby">${rows
    .map((r) => `<li><a href="${e(url(cityPath(r.city)))}">${e(r.city.name)}</a><span>${r.d.hardness ? `${fix1(toGpg(r.d.hardness.mgL))} gpg` : ''}${r.d.primary ? ` · ${r.d.primary.violations.healthBased} viol.` : ''}</span></li>`)
    .join('')}</ul></section>`;
}

// ---------------------------------------------------------------------
// State, home and static pages
// ---------------------------------------------------------------------
function buildCityTable(rows) {
  return `<div class="table-wrap"><table class="data">
  <thead><tr><th>Place</th><th>Utility</th><th>Health viol.</th><th>Lead</th><th>Hardness</th><th>Radon</th></tr></thead>
  <tbody>${rows
    .map(
      (r) =>
        `<tr><td><a href="${e(url(cityPath(r.city)))}">${e(r.city.name)}</a></td><td>${r.d.primary ? e(utilityName(r.d.primary.name)) : '—'}</td><td>${r.d.primary ? num(r.d.primary.violations.healthBased) : '—'}</td><td>${r.d.primary && r.d.primary.lead ? ppb(r.d.primary.lead.mgL) : '—'}</td><td>${r.d.hardness ? `${fix1(toGpg(r.d.hardness.mgL))} gpg` : '—'}</td><td>${r.d.radon ? r.d.radon.zone : '—'}</td></tr>`
    )
    .join('')}</tbody>
</table></div>`;
}

/**
 * City search box. The index (search.json: [[name, state, path], ...]) is
 * fetched on first use so the homepage stays small.
 */
function buildSearchWidget() {
  return `<div class="search">
  <label for="q">Find your city</label>
  <input id="q" type="search" placeholder="e.g. Phoenix, AZ" autocomplete="off">
  <ul id="q-results"></ul>
  <script>
(function () {
  var R = null, pending = null;
  var q = document.getElementById('q'), out = document.getElementById('q-results');
  function load() {
    if (!pending) pending = fetch(${JSON.stringify(url('/search.json'))}).then(function (r) { return r.json(); }).then(function (d) { R = d; });
    return pending;
  }
  function show() {
    var t = q.value.toLowerCase().replace(/,/g, ' ').trim().split(/\\s+/).filter(Boolean);
    out.innerHTML = '';
    if (!t.length || !R) return;
    R.filter(function (r) { var s = (r[0] + ' ' + r[1]).toLowerCase(); return t.every(function (w) { return s.indexOf(w) !== -1; }); }).slice(0, 10).forEach(function (r) {
      var li = document.createElement('li'); var a = document.createElement('a'); a.href = r[2]; a.textContent = r[0] + ', ' + r[1]; li.appendChild(a); out.appendChild(li);
    });
  }
  q.addEventListener('focus', load);
  q.addEventListener('input', function () { load().then(show); });
})();
  </script>
</div>`;
}

function buildMethodologyBody(sources) {
  return `<h1>Where this water and radon data comes from</h1>
<section class="card">
<h2>Utilities and violations</h2>
<p>We use EPA's Safe Drinking Water Information System (SDWIS), downloaded from <a href="https://echo.epa.gov/tools/data-downloads" rel="noopener">ECHO</a> (data through ${e(sources.waterAsOf)}). For each place we find active community water systems whose service-area records name the place, or whose name or mailing address matches it, and treat the largest by population as the main utility. We report violations whose non-compliance period began on or after ${e(sources.windowStart)}. Health-based violations are those EPA flags as such: a contaminant or disinfectant above its legal limit, or a required treatment technique not met.</p>
<h2>Lead and copper</h2>
<p>Utilities test tap water in a sample of homes and report the 90th-percentile result. We show the most recent result in SDWIS. EPA's action levels are ${ppb(config.lead.actionLevelMgL)} for lead and ${config.copper.actionLevelMgL} mg/L for copper.</p>
<h2>Hardness</h2>
<p>Hardness values come from the <a href="https://www.tapwaterdata.com/water-hardness" rel="noopener">TapWaterData US Water Hardness Dataset</a> (CC BY 4.0): utility-reported values where available, otherwise county estimates from EPA/USGS Water Quality Portal samples. Where a place isn't in that dataset we use the nearest listed place within 8 km. Bands follow the USGS: soft 0–60 mg/L, moderately hard 61–120, hard 121–180, very hard above 180. One grain per gallon is 17.1 mg/L.</p>
<h2>Radon</h2>
<p>Radon zones are from the <a href="https://www.epa.gov/radon/epa-map-radon-zones-0" rel="noopener">EPA Map of Radon Zones</a>, by county. Connecticut places use the state's historical counties, which the EPA map still uses.</p>
<h2>Softener sizing</h2>
<p>Daily grains = people × ${config.softener.gallonsPerPersonDay} gallons per person per day × hardness in grains per gallon. Capacity needed = daily grains × ${config.softener.daysBetweenRegen} days between regenerations, rounded up to a standard size. Add capacity if your water also contains iron.</p>
<h2>Limits</h2>
<ul><li>Matching places to utilities is automated and can be wrong where several utilities serve one place.</li><li>Records show what was reported to EPA; unreported problems don't appear.</li><li>Private wells aren't regulated and aren't covered.</li></ul>
</section>`;
}

function buildAboutBody(count, email) {
  return `<h1>About ${e(config.siteName)}</h1><section class="card">
<p>${e(config.siteName)} pulls together public records on drinking water and radon for ${num(count)} US cities and towns: which utility supplies the water, its EPA violation history, lead and copper results, hardness, and the county's radon zone.</p>
<p>The underlying data is public but scattered across EPA databases and utility reports. We publish it the same way for every place, including where the record is clean.</p>
<p>The site may show ads and link to products through affiliate programs; that never changes the data.</p>
<p>Corrections: <a href="mailto:${e(email)}">${e(email)}</a>.</p></section>`;
}

function buildPrivacyBody(email) {
  return `<h1>Privacy policy</h1><section class="card">
<p>This is a static reference site with no accounts. Nothing you type into the search box or calculators leaves your browser.</p>
<p><strong>Hosting.</strong> Pages are served by Cloudflare, which processes standard request data (IP address, browser type) to deliver and protect the site.</p>
<p><strong>Analytics.</strong> If enabled, we use privacy-friendly, cookie-free analytics that count page views without identifying you.</p>
<p><strong>Advertising.</strong> If enabled, Google and its partners may use cookies to serve ads based on your visits to this and other sites. Opt out at <a href="https://www.google.com/settings/ads" rel="noopener">Google Ads Settings</a>.</p>
<p><strong>Affiliate links.</strong> As an Amazon Associate we earn from qualifying purchases.</p>
<p>Contact: <a href="mailto:${e(email)}">${e(email)}</a>.</p></section>`;
}

function buildContactBody(email) {
  return `<h1>Contact</h1><section class="card"><p>Spotted a wrong utility or a number that looks off? Email <a href="mailto:${e(email)}">${e(email)}</a>.</p></section>`;
}

module.exports = {
  escapeHtml,
  url,
  cityPath,
  statePath,
  num,
  fix1,
  ppb,
  buildYear,
  utilityName,
  buildSiteHeader,
  buildBreadcrumbs,
  buildFooter,
  buildCityTitle,
  buildCityDescription,
  buildLede,
  buildSummary,
  buildUtility,
  buildViolationTable,
  buildLeadCopper,
  buildHardness,
  buildSoftenerCalc,
  buildRadon,
  buildProducts,
  buildFaqs,
  buildFaqSection,
  buildFaqJsonLd,
  buildNearby,
  buildCityTable,
  buildSearchWidget,
  buildMethodologyBody,
  buildAboutBody,
  buildPrivacyBody,
  buildContactBody
};
