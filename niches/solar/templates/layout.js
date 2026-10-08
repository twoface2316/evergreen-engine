'use strict';

/**
 * niches/solar/templates/layout.js — markup builders for the solar niche.
 * Pure string functions: render.js owns data loading, orchestration and
 * file writing; everything here takes plain objects and returns HTML.
 */

const { escapeHtml } = require('../../../engine/lib/escape-html.js');
const basePath = require('../../../engine/lib/base-path.js');
const { cashFlow, paybackYears, sizeSystem, solarValueCents } = require('../scripts/model.js');
const { stateName } = require('../scripts/states.js');
const config = require('../config.js');

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const url = (p) => basePath.href(p);
const cityPath = (c) => `/${c.stateSlug}/${c.slug}/`;
const statePath = (abbr) => `/${abbr.toLowerCase()}/`;

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------
const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const moneyK = (n) => (Math.abs(n) >= 10000 ? (n < 0 ? '−$' : '$') + (Math.round(Math.abs(n) / 100) / 10).toLocaleString('en-US') + 'k' : money(n));
/** "saving roughly $X" / "losing roughly $X" over the system's life. */
const netPhrase = (n, fmt) => (n >= 0 ? `saving ${fmt(n)}` : `losing ${fmt(-n)}`);
const num = (n) => Math.round(n).toLocaleString('en-US');
const fix1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const cents = (c) => `${fix1(c)}¢`;
const years = (y) => (y == null ? '25+ years' : `${fix1(y)} years`);
const yearsShort = (y) => (y == null ? '25+ yrs' : `${fix1(y)} yrs`);
const pct = (x) => `${Math.round(x * 100)}%`;

/** "Illinois'" vs "Texas's": possessive for a state name. */
function possessive(name) {
  return /s$/.test(name) ? `${name}'` : `${name}'s`;
}

function buildYear() {
  return new Date().getFullYear();
}

// ---------------------------------------------------------------------
// Verdicts — one plain-language label per payback band.
// ---------------------------------------------------------------------
function verdict(payback) {
  if (payback == null || payback > 20) return { key: 'poor', label: 'Hard to justify on savings alone' };
  if (payback > 14) return { key: 'fair', label: 'Slow payback' };
  if (payback > 10) return { key: 'good', label: 'Solid long-term investment' };
  return { key: 'great', label: 'Strong investment' };
}

// ---------------------------------------------------------------------
// Head metadata
// ---------------------------------------------------------------------
function buildCityTitle(city) {
  const base = `Solar Panels in ${city.name}, ${city.state}: Cost & Payback`;
  const withYear = `${base} (${buildYear()})`;
  if (withYear.length <= 60) return withYear;
  if (base.length <= 60) return base;
  return `${city.name}, ${city.state} Solar Cost & Payback`;
}

function buildCityDescription(city, e) {
  return `A typical ${fix1(e.sizeKw)} kW solar system in ${city.name}, ${city.state} costs about ${money(e.netCost)} and pays back in ${years(e.payback)}, ${netPhrase(e.netLifetime, (n) => '~' + moneyK(n))} over 25 years.`;
}

// ---------------------------------------------------------------------
// Site chrome
// ---------------------------------------------------------------------
function buildSiteHeader() {
  return `<header class="site-header"><div class="wrap">
  <a class="brand" href="${escapeHtml(url('/'))}"><span class="sun" aria-hidden="true"></span>${escapeHtml(config.siteName)}</a>
  <nav><a href="${escapeHtml(url('/solar-calculator/'))}">Calculator</a><a href="${escapeHtml(url('/states/'))}">States</a><a href="${escapeHtml(url('/guides/'))}">Guides</a></nav>
</div></header>`;
}

function buildBreadcrumbs(trail) {
  const items = trail.map((t, i) =>
    i === trail.length - 1 || !t.href ? `<span>${escapeHtml(t.label)}</span>` : `<a href="${escapeHtml(url(t.href))}">${escapeHtml(t.label)}</a>`
  );
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${items.join(' <span aria-hidden="true">›</span> ')}</nav>`;
}

function buildFooter(sources) {
  return `<footer class="site-footer">
  <div class="disclaimer">Estimates for planning only — <strong>not a quote, and not financial or tax advice</strong>. Your roof, shading, utility rate plan and installer pricing change the numbers; get several quotes before deciding.</div>
  <p>Solar production: <a href="https://pvwatts.nrel.gov/" rel="noopener">PVWatts®</a> (NREL, now the National Laboratory of the Rockies), NSRDB typical-year weather. Electricity prices and usage: <a href="https://www.eia.gov/electricity/" rel="noopener">U.S. Energy Information Administration</a>${sources && sources.priceAsOf ? ` (prices through ${escapeHtml(sources.priceAsOf)})` : ''}. Installed costs: <a href="https://emp.lbl.gov/tracking-the-sun" rel="noopener">Berkeley Lab</a>, 2025 installs.</p>
  <p>Place data: <a href="https://www.geonames.org/" rel="noopener">GeoNames.org</a>, used under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>.</p>
  <p><a href="${escapeHtml(url('/solar-calculator/'))}">Solar calculator</a> &middot; <a href="${escapeHtml(url('/states/'))}">Solar by state</a> &middot; <a href="${escapeHtml(url('/guides/'))}">Guides</a> &middot; <a href="${escapeHtml(url('/methodology/'))}">Methodology</a> &middot; <a href="${escapeHtml(url('/about/'))}">About</a> &middot; <a href="${escapeHtml(url('/privacy/'))}">Privacy</a> &middot; <a href="${escapeHtml(url('/contact/'))}">Contact</a></p>
  <p>&copy; ${buildYear()} ${escapeHtml(config.siteName)}.</p>
</footer>`;
}

// ---------------------------------------------------------------------
// City page sections
// ---------------------------------------------------------------------
function buildAnswerLede(city, e, st, policy) {
  const exportNote = policy.type === 'net-billing' ? ` Power you send back to the grid earns only about ${cents(policy.exportCents)}/kWh here, which is built into these numbers.` : '';
  return `<p class="lede">A typical <strong>${fix1(e.sizeKw)} kW</strong> home solar system in ${escapeHtml(city.name)} costs about <strong>${money(e.netCost)}</strong> and ${e.payback == null ? `<strong>doesn't pay for itself within 25 years</strong>, ${netPhrase(e.netLifetime, (n) => `roughly <strong>${money(n)}</strong>`)} overall` : `pays for itself in about <strong>${years(e.payback)}</strong>, ${netPhrase(e.netLifetime, (n) => `roughly <strong>${money(n)}</strong>`)} over 25 years`} at ${escapeHtml(possessive(st.priceOwner || stateName(city.state)))} average electricity price of ${cents(st.priceCents)}/kWh.${exportNote}</p>`;
}

function stat(label, value, sub) {
  return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

function buildSummary(city, e, pv, costScope, policy) {
  const v = verdict(e.payback);
  const costSub = costScope === 'state' ? `at ${escapeHtml(stateName(city.state))} median $${e.costPerWatt.toFixed(2)}/W` : `at US median $${e.costPerWatt.toFixed(2)}/W`;
  return `<section class="summary" aria-label="Solar summary for ${escapeHtml(city.name)}">
  <div class="verdict verdict-${v.key}">${escapeHtml(v.label)}<span>payback ${years(e.payback)}</span></div>
  <div class="stats">
    ${stat('System size', `${fix1(e.sizeKw)} kW`, `${e.panels} × ${config.assumptions.panelWatts} W panels`)}
    ${stat('Upfront cost', money(e.netCost), costSub)}
    ${stat('First-year savings', money(e.year1Savings), policy.type === 'net-billing' ? `solar worth ${cents(e.valueCents)}/kWh after export credits` : `about ${money(e.monthlySavings)}/month`)}
    ${stat('25-year net savings', money(e.netLifetime), 'after paying for the system')}
    ${stat('Production', `${num(e.annualKwh)} kWh/yr`, `${pct(e.offset)} of a typical home's use`)}
    ${stat('Peak sun hours', `${pv.sunHours.toFixed(1)}/day`, `${num(pv.kwhPerKw)} kWh per kW per year`)}
  </div>
</section>`;
}

function buildLeadGen(city) {
  const lg = config.leadGen;
  if (!lg || !lg.url) return '';
  const href = lg.url.replace('{state}', encodeURIComponent(city.state)).replace('{zip}', '');
  return `<aside class="leadgen"><p><strong>Real prices beat estimates.</strong> Installer quotes in ${escapeHtml(city.name)} often vary by thousands of dollars for the same system.</p><a class="btn" href="${escapeHtml(href)}" rel="sponsored noopener">${escapeHtml(lg.label)}</a></aside>`;
}

/** Monthly production bars with a dashed line for average monthly usage. */
function buildProductionChart(city, e) {
  const W = 640, H = 240, padL = 44, padR = 10, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const usage = e.annualUsage / 12;
  const maxV = Math.max(...e.monthlyKwh, usage) * 1.1;
  const step = maxV > 1500 ? 500 : maxV > 600 ? 200 : 100;
  const yMax = Math.ceil(maxV / step) * step;
  const y = (v) => padT + plotH - (v / yMax) * plotH;
  const bw = plotW / 12;
  let grid = '';
  for (let v = 0; v <= yMax; v += step) {
    grid += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="var(--border)"/><text x="${padL - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted)">${num(v)}</text>`;
  }
  const bars = e.monthlyKwh
    .map((v, i) => {
      const x = padL + i * bw + bw * 0.16;
      return `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.68).toFixed(1)}" height="${(padT + plotH - y(v)).toFixed(1)}" rx="3" fill="var(--sun)"><title>${MONTH_ABBR[i]}: ${num(v)} kWh</title></rect><text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${MONTH_ABBR[i]}</text>`;
    })
    .join('');
  const uy = y(usage).toFixed(1);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated monthly solar production for a ${fix1(e.sizeKw)} kW system in ${escapeHtml(city.name)}, ${city.state}">${grid}${bars}<line x1="${padL}" y1="${uy}" x2="${W - padR}" y2="${uy}" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="5 4"/></svg>`;
  const best = e.monthlyKwh.indexOf(Math.max(...e.monthlyKwh));
  const worst = e.monthlyKwh.indexOf(Math.min(...e.monthlyKwh));
  return `<section class="card">
  <h2>Monthly solar production in ${escapeHtml(city.name)}</h2>
  <p>Estimated output of a ${fix1(e.sizeKw)} kW south-facing roof system. ${MONTH_ABBR[best]} is the strongest month (${num(e.monthlyKwh[best])} kWh); ${MONTH_ABBR[worst]} the weakest (${num(e.monthlyKwh[worst])} kWh).</p>
  <div class="chart">${svg}</div>
  <p class="legend"><span class="key key-bar"></span>Solar production (kWh) <span class="key key-line"></span>Typical home use, ${num(usage)} kWh/month</p>
</section>`;
}

/**
 * Interactive payback calculator. The model functions are embedded from
 * model.js source so the calculator reproduces the page's numbers.
 */
function buildCalculator({ id = 'calc', heading, intro, kwhPerKw, priceCents, monthlyBill, costPerWatt, exportCents = null, feePerKwMonth = 0, selfUse = 0.4, stateOptions }) {
  const a = config.assumptions;
  const data = { kwhPerKw, fee: feePerKwMonth, a: { offsetShare: a.offsetShare, minKw: a.minKw, maxKw: a.maxKw, panelWatts: a.panelWatts, degradation: a.degradation, lifetimeYears: a.lifetimeYears, federalCredit: a.federalCredit } };
  const stateSelect = stateOptions
    ? `<label class="wide">State<select id="${id}-state">${stateOptions
        .map((s) => `<option value="${s.abbr}" data-kwh="${s.kwhPerKw}" data-price="${s.priceCents.toFixed(2)}" data-bill="${s.monthlyBill.toFixed(2)}" data-cpw="${s.costPerWatt}" data-export="${s.exportCents == null ? '' : s.exportCents.toFixed(2)}" data-fee="${s.feePerKwMonth || 0}"${s.selected ? ' selected' : ''}>${escapeHtml(s.name)}</option>`)
        .join('')}</select></label>`
    : '';
  return `<section class="card calc" id="${id}">
  <h2>${heading}</h2>
  <p>${intro}</p>
  <form class="calc-form" onsubmit="return false">
    ${stateSelect}
    <label>Monthly electric bill ($)<input id="${id}-bill" type="number" min="10" max="2000" step="0.01" value="${(Math.round(monthlyBill * 100) / 100).toFixed(2)}"></label>
    <label>Electricity price (¢/kWh)<input id="${id}-price" type="number" min="3" max="80" step="0.01" value="${priceCents.toFixed(2)}"></label>
    <label>Installed cost ($/W)<input id="${id}-cpw" type="number" min="1" max="8" step="0.05" value="${costPerWatt.toFixed(2)}"></label>
    <label>Price increase per year (%)<input id="${id}-esc" type="number" min="0" max="10" step="0.5" value="${(a.priceEscalation * 100).toFixed(1)}"></label>
    <label>Export credit (¢/kWh)<input id="${id}-exp" type="number" min="0" max="80" step="0.01" placeholder="full retail" value="${exportCents == null ? '' : exportCents.toFixed(2)}"></label>
    <label>Solar used at home (%)<input id="${id}-self" type="number" min="0" max="100" step="5" value="${Math.round(selfUse * 100)}"></label>
  </form>
  <p class="muted">Leave export credit blank where the utility offers full net metering. Where exports earn less, solar used at home as it's produced is worth the full price and the rest earns the export credit.</p>
  <div class="calc-out" aria-live="polite">
    <div><span>System</span><strong id="${id}-size"></strong></div>
    <div><span>Cost</span><strong id="${id}-cost"></strong></div>
    <div><span>Year-1 savings</span><strong id="${id}-y1"></strong></div>
    <div><span>Payback</span><strong id="${id}-pb"></strong></div>
    <div><span>25-yr net savings</span><strong id="${id}-net"></strong></div>
  </div>
  <script>
(function () {
  ${cashFlow.toString()}
  ${paybackYears.toString()}
  ${sizeSystem.toString()}
  ${solarValueCents.toString()}
  var D = ${JSON.stringify(data)};
  var $ = function (s) { return document.getElementById('${id}-' + s); };
  var fmt = function (n) { return (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'); };
  function run() {
    var bill = +$('bill').value, price = +$('price').value, cpw = +$('cpw').value, esc = +$('esc').value / 100;
    var exp = $('exp').value === '' ? null : +$('exp').value, self = +$('self').value / 100;
    if (!(bill > 0 && price > 0 && cpw > 0)) return;
    var usage = bill / (price / 100) * 12;
    var s = sizeSystem(usage, D.kwhPerKw, D.a);
    var annual = s.sizeKw * D.kwhPerKw;
    var cost = s.sizeKw * 1000 * cpw * (1 - D.a.federalCredit);
    var flow = cashFlow(annual, solarValueCents(price, exp, self), D.a.lifetimeYears, D.a.degradation, esc, D.fee * s.sizeKw * 12);
    var pb = paybackYears(cost, flow);
    var total = flow.reduce(function (t, v) { return t + v; }, 0);
    $('size').textContent = s.sizeKw.toFixed(1) + ' kW (' + s.panels + ' panels)';
    $('cost').textContent = fmt(cost);
    $('y1').textContent = fmt(flow[0]);
    $('pb').textContent = pb == null ? '25+ years' : pb.toFixed(1) + ' years';
    $('net').textContent = fmt(total - cost);
  }
  var st = $('state');
  if (st) st.addEventListener('change', function () {
    var o = st.options[st.selectedIndex];
    D.kwhPerKw = +o.dataset.kwh; D.fee = +o.dataset.fee;
    $('price').value = o.dataset.price; $('bill').value = o.dataset.bill; $('cpw').value = o.dataset.cpw; $('exp').value = o.dataset.export;
    run();
  });
  ['bill', 'price', 'cpw', 'esc', 'exp', 'self'].forEach(function (k) { $(k).addEventListener('input', run); });
  run();
})();
  </script>
</section>`;
}

function buildIncentives(city, e, prices, policy, selfUse) {
  const st = stateName(city.state);
  const src = policy.sourceUrl ? ` <a href="${escapeHtml(policy.sourceUrl)}" rel="noopener">Source</a>.` : '';
  const exportHtml =
    policy.type === 'net-billing'
      ? `<p><strong>${escapeHtml(st)} pays less than retail for exported solar power.</strong> Under ${escapeHtml(policy.label)}, power you send to the grid earns about ${cents(policy.exportCents)}/kWh, against ${cents(prices.priceCents)} for power you buy. We assume ${pct(selfUse)} of a no-battery system's output is used at home as it's produced (worth the full price) and the rest is exported, so each solar kWh is worth about <strong>${cents(e.valueCents)}</strong>. Using more of your solar yourself, by running appliances midday or adding a battery, raises that.</p>
  <p>${escapeHtml(policy.note)}${src}</p>${e.annualFee ? `
  <p><strong>Solar fee:</strong> the payback above includes a $${policy.feePerKwMonth.toFixed(2)} per kW monthly charge, about ${money(e.annualFee)} a year for this system.</p>` : ''}`
      : `<p><strong>${escapeHtml(st)} offers net metering:</strong> power you send to the grid is credited at or near the retail price, so every solar kWh is valued at ${cents(prices.priceCents)} here.${policy.note && policy.note !== 'Exported power is credited at or near the retail rate, usually netted monthly or annually.' ? ' ' + escapeHtml(policy.note) : ''}${policy.sourceUrl ? src : ''}</p>`;
  return `<section class="card">
  <h2>Net metering, tax credits and incentives in ${buildYear()}</h2>
  ${exportHtml}
  <p><strong>There is no federal tax credit for buying home solar installed in ${buildYear()}.</strong> The 30% Residential Clean Energy Credit (Section 25D) ended for systems placed in service after December 31, 2025, so the costs and paybacks on this page include no federal credit.</p>
  <p>${escapeHtml(st)} and local utilities may still offer rebates, performance payments, property-tax or sales-tax exemptions. Search the <a href="https://programs.dsireusa.org/system/program?state=${escapeHtml(city.state)}" rel="noopener">DSIRE incentives database for ${escapeHtml(st)}</a> and ask installers which programs they apply for you.</p>
</section>`;
}

function buildComparison(city, e, ctx) {
  const { statePeers, stateMedianKwh, usMedianKwh, pv } = ctx;
  const rank = statePeers.findIndex((p) => p.city === city) + 1;
  const vsUs = pv.kwhPerKw / usMedianKwh - 1;
  const vsState = pv.kwhPerKw / stateMedianKwh - 1;
  const word = (d) => (Math.abs(d) < 0.02 ? 'about the same as' : d > 0 ? `${pct(Math.abs(d))} more than` : `${pct(Math.abs(d))} less than`);
  return `<section class="card">
  <h2>How ${escapeHtml(city.name)} compares</h2>
  <ul>
    <li>Each kW of panels here produces about <strong>${num(pv.kwhPerKw)} kWh a year</strong> — ${word(vsState)} the ${escapeHtml(stateName(city.state))} median and ${word(vsUs)} the US median city (${num(usMedianKwh)} kWh).</li>
    ${statePeers.length > 1 ? `<li>Payback ranks <strong>#${rank} of ${statePeers.length}</strong> ${escapeHtml(stateName(city.state))} places we cover.</li>` : ''}
    <li>Sunshine varies little across a state; electricity price, installed cost and how utilities credit exported power drive most of the difference between states.</li>
  </ul>
</section>`;
}

function buildFaqs(city, e, pv, st, policy) {
  const place = `${city.name}, ${city.state}`;
  const v = verdict(e.payback);
  return [
    {
      q: `Is solar worth it in ${place}?`,
      a: `For a typical home, ${e.payback == null ? 'savings do not repay the system within 25 years at today\'s prices' : `a solar system pays for itself in about ${years(e.payback)} and then keeps saving money`}. Over 25 years the estimated net ${e.netLifetime >= 0 ? `savings are ${money(e.netLifetime)}` : `loss is ${money(-e.netLifetime)}`}. Verdict: ${v.label.toLowerCase()}. Your own payback depends on your roof, your bill and the quotes you get.`
    },
    {
      q: `How many solar panels do I need in ${place}?`,
      a: `A home using ${num(e.annualUsage / 12)} kWh a month (the ${stateName(city.state)} average) needs about ${e.panels} panels of ${config.assumptions.panelWatts} W — a ${fix1(e.sizeKw)} kW system — to cover its annual use. Divide your own yearly kWh by ${num(pv.kwhPerKw)} to get the kW you need.`
    },
    {
      q: `How much do solar panels cost in ${place}?`,
      a: `At ${e.costPerWatt.toFixed(2)} dollars per watt, a ${fix1(e.sizeKw)} kW system costs about ${money(e.netCost)} before any state or utility incentives. There is no federal tax credit for systems installed in ${buildYear()}.`
    },
    {
      q: `How much sun does ${city.name} get?`,
      a: `${city.name} averages ${pv.sunHours.toFixed(1)} peak sun hours per day, so each kilowatt of panels produces about ${num(pv.kwhPerKw)} kWh a year.`
    },
    {
      q: `Does ${stateName(city.state)} have net metering?`,
      a:
        policy.type === 'net-billing'
          ? `Not full retail net metering. Under ${policy.label}, exported solar power earns about ${cents(policy.exportCents)} per kWh, versus ${cents(st.priceCents)} for power bought from the grid. Solar you use at home as it's produced still saves the full price.`
          : `Yes. Power sent back to the grid is credited at or near the retail price (${cents(st.priceCents)} per kWh on average).`
    },
    {
      q: `How much does electricity cost in ${stateName(city.state)}?`,
      a: `Residential electricity in ${stateName(city.state)} averages ${cents(st.statePriceCents || st.priceCents)} per kWh, and a typical home uses ${num(st.monthlyKwh)} kWh a month (EIA).`
    }
  ];
}

function buildFaqSection(faqs) {
  return `<section class="card faq">
  <h2>Frequently asked questions</h2>
  ${faqs.map((f) => `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`).join('\n  ')}
</section>`;
}

function buildFaqJsonLd(faqs) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
  };
}

function buildNearby(nearby) {
  if (!nearby.length) return '';
  return `<section class="card">
  <h2>Solar payback in nearby places</h2>
  <ul class="nearby">${nearby
    .map((n) => `<li><a href="${escapeHtml(url(cityPath(n.city)))}">${escapeHtml(n.city.name)}</a><span>${yearsShort(n.e.payback)}</span></li>`)
    .join('')}</ul>
</section>`;
}

// ---------------------------------------------------------------------
// State, index and static pages
// ---------------------------------------------------------------------
function buildStateTable(rows) {
  return `<div class="table-wrap"><table class="data">
  <thead><tr><th>Place</th><th>kWh per kW</th><th>System</th><th>Cost</th><th>Payback</th><th>25-yr savings</th></tr></thead>
  <tbody>${rows
    .map(
      (r) =>
        `<tr><td><a href="${escapeHtml(url(cityPath(r.city)))}">${escapeHtml(r.city.name)}</a></td><td>${num(r.pv.kwhPerKw)}</td><td>${fix1(r.e.sizeKw)} kW</td><td>${money(r.e.netCost)}</td><td>${yearsShort(r.e.payback)}</td><td>${money(r.e.netLifetime)}</td></tr>`
    )
    .join('')}</tbody>
</table></div>`;
}

function buildStatesTable(states) {
  return `<div class="table-wrap"><table class="data">
  <thead><tr><th>State</th><th>Price</th><th>Exports earn</th><th>Cost/W</th><th>Median payback</th><th>Places</th></tr></thead>
  <tbody>${states
    .map(
      (s) =>
        `<tr><td><a href="${escapeHtml(url(statePath(s.abbr)))}">${escapeHtml(s.name)}</a></td><td>${cents(s.priceCents)}</td><td>${s.policy && s.policy.type === 'net-billing' ? cents(s.policy.exportCents) : 'retail'}</td><td>$${s.costPerWatt.toFixed(2)}</td><td>${yearsShort(s.medianPayback)}</td><td>${num(s.count)}</td></tr>`
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
  <input id="q" type="search" placeholder="e.g. Austin, TX" autocomplete="off">
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

function buildMethodologyBody(sources, installedCost, policies) {
  const a = config.assumptions;
  const listed = Object.entries(installedCost.states)
    .map(([k, v]) => `${k} $${v.toFixed(2)}`)
    .join(', ');
  return `<h1>How these solar estimates are calculated</h1>
<section class="card">
<h2>Production</h2>
<p>For every place, we run NREL's <a href="https://pvwatts.nrel.gov/" rel="noopener">PVWatts®</a> model (version 8, now maintained by the National Laboratory of the Rockies) for a 1 kW-DC system at the place's coordinates: standard modules, fixed roof mount, ${a.pv.tilt}° tilt facing due south, ${a.pv.losses}% system losses, typical-meteorological-year weather from the National Solar Radiation Database. That gives kWh per kW per year and per month, which we scale to the system size.</p>
<h2>System size</h2>
<p>We size the system to cover ${pct(a.offsetShare)} of the average home's annual electricity use in that state (EIA, ${escapeHtml(sources.usageYear)}), rounded up to whole ${a.panelWatts} W panels, between ${a.minKw} and ${a.maxKw} kW.</p>
<h2>Cost</h2>
<p>Installed cost is the 2025 median price for homeowner-owned residential systems from Berkeley Lab's <a href="${escapeHtml(installedCost.sourceUrl)}" rel="noopener">U.S. Distributed Solar and Storage Data</a>, before incentives. State medians are used where Berkeley Lab reports one (${escapeHtml(listed)}); elsewhere we use the US median of $${installedCost.us.allHostOwned.toFixed(2)}/W. Cash purchases ran cheaper (US median $${installedCost.us.cashPurchase.toFixed(2)}/W) and loan-financed systems higher ($${installedCost.us.loanFinanced.toFixed(2)}/W).</p>
<p>No federal tax credit is applied: the Section 25D Residential Clean Energy Credit ended for systems placed in service after December 31, 2025.</p>
<h2>Savings and payback</h2>
<p>Each solar kWh is valued at the state's average residential electricity price (${escapeHtml(sources.priceSource)}) where the state offers net metering. Where utilities credit exported power below retail (net billing), we assume ${pct(policies.selfConsumption)} of a no-battery system's output is used at home as it's produced and valued at retail, and the rest earns the export credit below; a flat solar fee, where one applies, is subtracted each year. Savings rise ${(a.priceEscalation * 100).toFixed(1)}% a year with electricity prices, panel output falls ${(a.degradation * 100).toFixed(1)}% a year, and we count ${a.lifetimeYears} years. Payback is the year cumulative savings first cover the upfront cost.</p>
<h2>States that pay less than retail for exported power</h2>
<p>As of ${escapeHtml(policies.asOf)}. Rates vary by utility within a state; these are for the largest utilities or a typical value.</p>
<div class="table-wrap"><table class="data"><thead><tr><th>State</th><th>Program</th><th>Export credit</th><th>Source</th></tr></thead><tbody>${Object.entries(policies.states)
    .filter(([, p]) => p.type === 'net-billing')
    .sort((x, y) => stateName(x[0]).localeCompare(stateName(y[0])))
    .map(([abbr, p]) => `<tr><td>${escapeHtml(stateName(abbr))}</td><td>${escapeHtml(p.label)}</td><td>${p.exportCents != null ? cents(p.exportCents) : `${pct(p.exportShare)} of retail`}${p.feePerKwMonth ? ` + $${p.feePerKwMonth.toFixed(2)}/kW/mo fee` : ''}</td><td><a href="${escapeHtml(p.sourceUrl)}" rel="noopener">link</a></td></tr>`)
    .join('')}</tbody></table></div>
<p>All other states offer net metering at or near retail; some (Nevada, Virginia, Oklahoma) pay less only for surplus left over after a month or year of netting, which matters little for a system sized to your use.</p>
<h2>Limits</h2>
<ul>
<li>Export credits change often and differ by utility; time-of-use rates and fixed charges can shift payback either way.</li>
<li>Your roof's direction, pitch and shade can raise or lower output by 20% or more.</li>
<li>Financing costs, maintenance, inverter replacement and batteries are not included.</li>
<li>State averages hide differences between utilities within a state.</li>
</ul>
</section>`;
}

function buildAboutBody(cityCount, contactEmail) {
  return `<h1>About ${escapeHtml(config.siteName)}</h1>
<section class="card">
<p>${escapeHtml(config.siteName)} estimates what home solar costs and saves in ${num(cityCount)} US cities and towns, using public data from the National Laboratory of the Rockies (formerly NREL), the U.S. Energy Information Administration and Lawrence Berkeley National Laboratory.</p>
<p>Solar sales pitches tend to lead with best-case numbers. We publish the same transparent method for every place — including the ones where solar is a slow payback — so you can sanity-check a quote before you sign. The <a href="${escapeHtml(url('/methodology/'))}">methodology page</a> lists every assumption.</p>
<p>The site may show ads and may link to installer-quote services that pay us a referral fee; that never changes the numbers we publish.</p>
<p>Questions or corrections: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.</p>
</section>`;
}

function buildPrivacyBody(contactEmail) {
  return `<h1>Privacy policy</h1>
<section class="card">
<p>This is a static reference site. There are no accounts, and nothing you type into the calculators or search boxes leaves your browser.</p>
<p><strong>Hosting.</strong> Pages are served by Cloudflare, which processes standard request data (IP address, browser type) to deliver and protect the site.</p>
<p><strong>Analytics.</strong> If enabled, we use privacy-friendly, cookie-free analytics that count page views without identifying you.</p>
<p><strong>Advertising.</strong> If enabled, Google and its partners may use cookies to serve ads based on your visits to this and other sites. You can opt out of personalized advertising at <a href="https://www.google.com/settings/ads" rel="noopener">Google Ads Settings</a>.</p>
<p><strong>Referral links.</strong> Some links to installer-quote services are referral links; if you request quotes through them we may be paid a fee.</p>
<p>Contact: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.</p>
</section>`;
}

function buildContactBody(contactEmail) {
  return `<h1>Contact</h1>
<section class="card"><p>Spotted a wrong number or have a question about the method? Email <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.</p></section>`;
}

module.exports = {
  escapeHtml,
  url,
  cityPath,
  statePath,
  money,
  moneyK,
  num,
  fix1,
  cents,
  years,
  yearsShort,
  pct,
  possessive,
  buildYear,
  verdict,
  buildCityTitle,
  buildCityDescription,
  buildSiteHeader,
  buildBreadcrumbs,
  buildFooter,
  buildAnswerLede,
  buildSummary,
  buildLeadGen,
  buildProductionChart,
  buildCalculator,
  buildIncentives,
  buildComparison,
  buildFaqs,
  buildFaqSection,
  buildFaqJsonLd,
  buildNearby,
  buildStateTable,
  buildStatesTable,
  buildSearchWidget,
  buildMethodologyBody,
  buildAboutBody,
  buildPrivacyBody,
  buildContactBody
};
