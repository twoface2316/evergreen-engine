'use strict';

/**
 * niches/solar/scripts/guides.js — long-form solar guides.
 *
 * Each guide is a hand-written HTML fragment in niches/solar/content/guides/
 * ({slug}.html) opening with a JSON front-matter comment:
 *
 *   <!--{"title": "...", "h1": "...", "description": "...", "summary": "...",
 *        "order": 1, "published": "2026-10-08", "related": ["slug", ...]}-->
 *
 * Bodies use {{placeholders}} filled from the same model as the city pages,
 * so the guides can't drift from the site's numbers:
 *   {{cityCount}} {{usMedianPayback}} {{usMedianKwh}} {{netBillingCount}}
 *   {{fastestStates}} {{slowestStates}} {{netBillingTable}}
 *   {{costUs}} {{costCash}} {{costLoan}} {{selfUse}}
 *   {{statePayback:CA}} {{statePrice:CA}} {{stateExport:CA}} {{stateValue:CA}}
 *   {{plugInKwh}} {{plugInValue20}}  800 W plug-in kit at the US median output
 *   {{cityPayback:ca/los-angeles}}
 *   {{amazon:search terms|link text}}  sponsored Amazon link, or plain text when no tag
 *   {{leadgen}}                         installer-quote box, or nothing when no partner
 * Root-relative hrefs ("/solar-calculator/") are base-path prefixed.
 *
 * renderGuides() writes /guides/ and /guides/{slug}/ and returns their URLs.
 */

const fs = require('fs');
const path = require('path');

const layout = require('../templates/layout.js');
const config = require('../config.js');
const basePathLib = require('../../../engine/lib/base-path.js');
const { stateName } = require('./states.js');
const { solarValueCents } = require('./model.js');

const CONTENT_DIR = path.join(__dirname, '..', 'content', 'guides');
const { escapeHtml } = layout;

function loadGuides() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
      const m = /^\s*<!--\s*(\{[\s\S]*?\})\s*-->/.exec(raw);
      if (!m) throw new Error(`${file}: missing JSON front-matter comment`);
      const meta = JSON.parse(m[1]);
      for (const key of ['title', 'h1', 'description', 'summary', 'published']) {
        if (!meta[key]) throw new Error(`${file}: front matter is missing "${key}"`);
      }
      return { ...meta, slug: file.replace(/\.html$/, ''), body: raw.slice(m[0].length).trim() };
    })
    .sort((a, b) => (a.order || 99) - (b.order || 99));
}

const median = (arr) => {
  const s = arr.filter((v) => v != null).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/** Placeholder values derived from the render model (see render.js loadModel). */
function buildValues(m) {
  const states = [...m.stateStats.values()].map((s) => ({ ...s, pb: s.medianPayback === 99 ? null : s.medianPayback }));
  const ranked = [...states].sort((a, b) => (a.pb ?? 99) - (b.pb ?? 99));
  const fmtState = (s) => `<a href="${layout.statePath(s.abbr)}">${escapeHtml(s.name)}</a> (${layout.years(s.pb)})`;
  const netBilling = Object.entries(m.policies.states).filter(([, p]) => p.type === 'net-billing');
  const nbRows = netBilling
    .map(([abbr]) => m.stateStats.get(abbr))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (s) =>
        `<tr><td><a href="${layout.statePath(s.abbr)}">${escapeHtml(s.name)}</a></td><td>${escapeHtml(s.policy.label)}</td><td>${layout.cents(s.policy.exportCents)}</td><td>${layout.cents(s.priceCents)}</td><td>${layout.yearsShort(s.medianPayback === 99 ? null : s.medianPayback)}</td></tr>`
    )
    .join('');
  return {
    cityCount: layout.num(m.rows.length),
    usMedianPayback: layout.years(median(m.rows.map((r) => r.e.payback ?? 99))),
    usMedianKwh: layout.num(m.usMedianKwh),
    netBillingCount: String(netBilling.length),
    fastestStates: ranked.slice(0, 5).map(fmtState).join(', '),
    slowestStates: ranked.slice(-5).reverse().map(fmtState).join(', '),
    netBillingTable: `<div class="table-wrap"><table class="data"><thead><tr><th>State</th><th>Program</th><th>Exports earn</th><th>Retail price</th><th>Median payback</th></tr></thead><tbody>${nbRows}</tbody></table></div>`,
    costUs: `$${m.installedCost.us.allHostOwned.toFixed(2)}`,
    costCash: `$${m.installedCost.us.cashPurchase.toFixed(2)}`,
    costLoan: `$${m.installedCost.us.loanFinanced.toFixed(2)}`,
    selfUse: layout.pct(m.policies.selfConsumption),
    plugInKwh: layout.num(0.8 * m.usMedianKwh),
    plugInValue20: layout.money(0.8 * m.usMedianKwh * 0.2)
  };
}

function amazonLink(query, text) {
  if (!config.amazonTag) return escapeHtml(text);
  const href = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&tag=${encodeURIComponent(config.amazonTag)}`;
  return `<a href="${escapeHtml(href)}" rel="sponsored noopener">${escapeHtml(text)}</a>`;
}

function fillBody(guide, values, m) {
  let usedAmazon = false;
  const body = guide.body.replace(/\{\{([a-zA-Z0-9]+)(?::([^}|]+))?(?:\|([^}]+))?\}\}/g, (all, key, arg, text) => {
    if (key === 'amazon') {
      usedAmazon = true;
      return amazonLink(arg, text || arg);
    }
    if (key === 'leadgen') return layout.buildLeadGen({ name: 'your area', state: '' });
    if (key === 'statePayback' || key === 'statePrice' || key === 'stateExport' || key === 'stateValue') {
      const s = m.stateStats.get(arg);
      if (!s) throw new Error(`${guide.slug}: unknown state ${arg}`);
      if (key === 'statePayback') return layout.years(s.medianPayback === 99 ? null : s.medianPayback);
      if (key === 'statePrice') return layout.cents(s.priceCents);
      if (key === 'stateValue') return layout.cents(solarValueCents(s.priceCents, s.policy.exportCents, m.policies.selfConsumption));
      return s.policy.type === 'net-billing' ? layout.cents(s.policy.exportCents) : 'the retail price';
    }
    if (key === 'cityPayback') {
      const r = m.rows.find((x) => `${x.city.stateSlug}/${x.city.slug}` === arg);
      if (!r) throw new Error(`${guide.slug}: unknown city ${arg}`);
      return layout.years(r.e.payback);
    }
    if (!(key in values)) throw new Error(`${guide.slug}: unknown placeholder {{${key}}}`);
    return values[key];
  });
  // Base-path prefix root-relative links.
  const html = body.replace(/href="(\/[^"]*)"/g, (all, p) => `href="${escapeHtml(basePathLib.href(p))}"`);
  return { html, usedAmazon };
}

function formatDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Small "Solar guides" card for city/state pages: up to `n` guides. */
function buildGuideLinks(guides, n = 4) {
  if (!guides.length) return '';
  return `<section class="card"><h2>Solar guides</h2><ul>${guides
    .slice(0, n)
    .map((g) => `<li><a href="${escapeHtml(layout.url(`/guides/${g.slug}/`))}">${escapeHtml(g.h1)}</a></li>`)
    .join('')}</ul></section>`;
}

/**
 * renderGuides({ guides, m, page, writePage, siteUrl }) -> list of URLs written.
 * `page` and `writePage` are render.js's page shell and file writer.
 */
function renderGuides({ guides, m, page, writePage, siteUrl }) {
  if (!guides.length) return [];
  const values = buildValues(m);
  const bySlug = new Map(guides.map((g) => [g.slug, g]));
  const urls = [];

  for (const g of guides) {
    const { html, usedAmazon } = fillBody(g, values, m);
    const trail = [
      { label: 'Home', href: '/' },
      { label: 'Guides', href: '/guides/' },
      { label: g.h1, href: `/guides/${g.slug}/` }
    ];
    const related = (g.related || []).map((s) => bySlug.get(s)).filter(Boolean);
    const disclosure = usedAmazon && config.amazonTag ? '<p class="muted">This guide contains affiliate links. As an Amazon Associate we earn from qualifying purchases.</p>' : '';
    const body = `${layout.buildBreadcrumbs(trail)}
<article class="guide">
<h1>${escapeHtml(g.h1)}</h1>
<p class="muted">Published ${formatDate(g.published)}${g.updated ? ` · Updated ${formatDate(g.updated)}` : ''}</p>
${disclosure}
<p class="lede">${escapeHtml(g.summary)}</p>
<section class="card prose">
${html}
</section>
</article>
${related.length ? `<section class="card"><h2>Related guides</h2><ul>${related.map((r) => `<li><a href="${escapeHtml(layout.url(`/guides/${r.slug}/`))}">${escapeHtml(r.h1)}</a></li>`).join('')}</ul></section>` : ''}`;
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Article', headline: g.h1, description: g.description, datePublished: g.published, dateModified: g.updated || g.published, mainEntityOfPage: `${siteUrl}/guides/${g.slug}/`, publisher: { '@type': 'Organization', name: config.siteName } },
        { '@type': 'BreadcrumbList', itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.label, item: `${siteUrl}${t.href}` })) }
      ]
    };
    writePage(
      `/guides/${g.slug}/`,
      page({ title: g.title, description: g.description, pathName: `/guides/${g.slug}/`, bodyHtml: body, jsonLdHtml: `<script type="application/ld+json">${JSON.stringify(ld)}</script>` })
    );
    urls.push(`/guides/${g.slug}/`);
  }

  const index = `${layout.buildBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'Guides', href: '/guides/' }])}
<h1>Solar Guides</h1>
<p class="lede">Plain-language answers to the questions that decide whether home solar pays off in ${layout.buildYear()}, using the same data as our city estimates.</p>
${guides
  .map((g) => `<section class="card"><h2><a href="${escapeHtml(layout.url(`/guides/${g.slug}/`))}">${escapeHtml(g.h1)}</a></h2><p>${escapeHtml(g.summary)}</p></section>`)
  .join('\n')}`;
  writePage('/guides/', page({ title: `Solar Guides (${layout.buildYear()}): Costs, Net Metering, Batteries & Quotes`, description: 'Guides to home solar in 2026: whether it pays without the tax credit, net metering vs net billing, batteries, leases and reading quotes.', pathName: '/guides/', bodyHtml: index }));
  urls.push('/guides/');
  return urls;
}

module.exports = { loadGuides, renderGuides, buildGuideLinks, stateName };
