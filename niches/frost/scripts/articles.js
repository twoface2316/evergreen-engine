'use strict';

/**
 * niches/frost/scripts/articles.js — long-form gardening guides.
 *
 * Each guide is one hand-written HTML fragment in niches/frost/content/guides/
 * ({slug}.html), opening with a JSON front-matter comment:
 *
 *   <!--{"title": "...", "description": "...", "h1": "...",
 *        "summary": "...", "order": 1, "published": "2026-10-05"}-->
 *
 * Bodies may embed {{placeholders}} that are filled at build time from the
 * same crop and NOAA data the rest of the site uses, so the guides can't drift
 * out of sync with the city pages. Root-relative links ("/plant/tomato/") are
 * base-path prefixed automatically.
 *
 * Writes /guides/ and /guides/{slug}/ and returns their URLs for the sitemap.
 */

const fs = require('fs');
const path = require('path');

const { computeCalendar } = require('./calendar.js');
const layout = require('../templates/layout.js');
const guides = require('./guide-pages.js');
const basePathLib = require('../../../engine/lib/base-path.js');
const { buildPageShell } = require('../../../engine/lib/page-shell.js');
const nicheConfig = require('../config.js');
const crops = require('../data/crops.json');

const SITE_URL = process.env.SITE_URL || nicheConfig.defaultSiteUrl;
const CONTENT_DIR = path.join(__dirname, '..', 'content', 'guides');
const { escapeHtml, formatDateShort, formatDateLong } = layout;
const href = (p) => escapeHtml(basePathLib.href(p));

// ---------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------

function loadGuides() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs.readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
      const m = /^\s*<!--\s*(\{[\s\S]*?\})\s*-->/.exec(raw);
      if (!m) throw new Error(`${file}: missing JSON front-matter comment`);
      const meta = JSON.parse(m[1]);
      for (const key of ['title', 'description', 'h1', 'summary']) {
        if (!meta[key]) throw new Error(`${file}: front matter is missing "${key}"`);
      }
      return { ...meta, slug: file.replace(/\.html$/, ''), body: raw.slice(m[0].length).trim() };
    })
    .sort((a, b) => (a.order || 99) - (b.order || 99));
}

// ---------------------------------------------------------------------
// Data-driven placeholders
// ---------------------------------------------------------------------

/** [-8, -6] -> "6–8 weeks before"; [1, 2] -> "1–2 weeks after"; [0, 1] -> "0–1 week after". */
function weeksPhrase(range, anchor) {
  const [a, b] = range;
  if (a < 0 && b <= 0) {
    const lo = Math.abs(b);
    const hi = Math.abs(a);
    return lo === 0 ? `up to ${hi} weeks before ${anchor}` : `${lo}–${hi} weeks before ${anchor}`;
  }
  if (a >= 0) {
    if (a === 0 && b === 0) return `at ${anchor}`;
    return a === 0 ? `${anchor} to ${b} week${b === 1 ? '' : 's'} after` : `${a}–${b} weeks after ${anchor}`;
  }
  return `${Math.abs(a)} weeks before to ${b} week${b === 1 ? '' : 's'} after ${anchor}`;
}

function cropLink(crop) {
  return `<a href="${href(`/plant/${crop.slug}/`)}">${escapeHtml(guides.cropTitle(crop))}</a>`;
}

function exampleCity(ctx) {
  return ctx.cities.find((c) => c.name === 'Chicago' && c.state === 'IL') || ctx.cities.find((c) => !c.frostFree);
}

function calendarFor(city) {
  const entries = computeCalendar(
    Object.assign({}, city, { lastFrost: city.lastSpringFrost, firstFrost: city.firstFallFrost }),
    crops
  );
  const bySlug = {};
  for (const e of entries) bySlug[e.slug] = e;
  return bySlug;
}

function table(head, rows) {
  return `<div class="table-scroll"><table class="calendar compact"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const PLACEHOLDERS = {
  seedStartTable() {
    const rows = crops
      .filter((c) => c.seedStartOffsetWeeks)
      .sort((a, b) => a.seedStartOffsetWeeks[0] - b.seedStartOffsetWeeks[0])
      .map((c) => [
        cropLink(c),
        escapeHtml(weeksPhrase(c.seedStartOffsetWeeks, 'last frost')),
        escapeHtml(c.transplantOffsetWeeks ? weeksPhrase(c.transplantOffsetWeeks, 'last frost') : '—')
      ]);
    return table(['Crop', 'Start seeds indoors', 'Plant outdoors'], rows);
  },

  directSowList() {
    const list = crops.filter((c) => c.method === 'direct-sow' && !c.seedStartOffsetWeeks && c.directSowOffsetWeeks);
    return list.map((c) => `<a href="${href(`/plant/${c.slug}/`)}">${escapeHtml(guides.cropLower(c))}</a>`).join(', ');
  },

  seedStartExample(ctx) {
    const city = exampleCity(ctx);
    const cal = calendarFor(city);
    const pick = ['onion', 'pepper', 'tomato', 'basil']
      .filter((s) => cal[s] && cal[s].seedStart)
      .map((s) => `${guides.cropLower(crops.find((c) => c.slug === s))} ${cal[s].seedStart.label}`);
    return `For example, ${escapeHtml(city.name)}'s typical last frost is ${escapeHtml(formatDateLong(city.lastSpringFrost.p50))}, which puts indoor seed starting at: ${escapeHtml(pick.join('; '))}. <a href="${href(`/${city.stateSlug}/${city.slug}/`)}">See the full ${escapeHtml(city.name)} calendar</a>.`;
  },

  fallTable() {
    const rows = crops
      .filter((c) => c.fallPlanting)
      .sort((a, b) => a.fallPlanting.offsetWeeks[0] - b.fallPlanting.offsetWeeks[0])
      .map((c) => [
        cropLink(c),
        escapeHtml(`${c.method === 'indoor-start' ? 'Transplant' : c.slug === 'garlic' ? 'Plant cloves' : 'Sow'} ${weeksPhrase(c.fallPlanting.offsetWeeks, 'first frost')}`),
        escapeHtml(c.daysToMaturity ? `${c.daysToMaturity[0]}–${c.daysToMaturity[1]} days` : '—')
      ]);
    return table(['Crop', 'When to plant', 'Days to maturity'], rows);
  },

  fallExample(ctx) {
    const city = exampleCity(ctx);
    const cal = calendarFor(city);
    const pick = ['carrot', 'kale', 'lettuce', 'garlic']
      .filter((s) => cal[s] && cal[s].fallPlanting)
      .map((s) => `${guides.cropLower(crops.find((c) => c.slug === s))} ${cal[s].fallPlanting.label}`);
    return `In ${escapeHtml(city.name)}, where the typical first fall frost is ${escapeHtml(formatDateLong(city.firstFallFrost.p50))}, that works out to: ${escapeHtml(pick.join('; '))}. <a href="${href(`/${city.stateSlug}/${city.slug}/`)}">See every crop for ${escapeHtml(city.name)}</a>.`;
  },

  zoneContrast(ctx) {
    // The widest last-frost spread between two sizable cities sharing a zone.
    // Limited to zones 3-8 and spring frosts Feb-Jun: in the mildest zones the
    // "last frost" can fall in December or January, which makes a nonsense
    // comparison (and wraps around the year).
    const key = (c) => {
      const md = layout.parseMonthDay(c.lastSpringFrost.p50);
      return md ? Date.UTC(2001, md.month - 1, md.day) / 86400000 : null;
    };
    const springMin = Date.UTC(2001, 1, 1) / 86400000;
    const springMax = Date.UTC(2001, 5, 30) / 86400000;
    const byZone = new Map();
    for (const c of ctx.cities) {
      if (c.frostFree || !c.zone || (c.population || 0) < 50000) continue;
      const zoneNum = parseInt(c.zone, 10);
      const k = key(c);
      if (!(zoneNum >= 3 && zoneNum <= 8) || k == null || k < springMin || k > springMax) continue;
      if (!byZone.has(c.zone)) byZone.set(c.zone, []);
      byZone.get(c.zone).push(c);
    }
    let best = null;
    for (const [zone, list] of byZone) {
      if (list.length < 2) continue;
      const sorted = list.slice().sort((a, b) => key(a) - key(b));
      const early = sorted[0];
      const late = sorted[sorted.length - 1];
      const gap = key(late) - key(early);
      if (!best || gap > best.gap) best = { zone, early, late, gap };
    }
    if (!best) return '';
    const link = (c) => `<a href="${href(`/${c.stateSlug}/${c.slug}/`)}">${escapeHtml(c.name)}, ${escapeHtml(c.state)}</a>`;
    return `${link(best.early)} and ${link(best.late)} are both in <a href="${href(`/zones/${best.zone}/`)}">Zone ${escapeHtml(best.zone)}</a>. Yet ${escapeHtml(best.early.name)}'s typical last spring frost is ${escapeHtml(formatDateLong(best.early.lastSpringFrost.p50))}, while ${escapeHtml(best.late.name)}'s is ${escapeHtml(formatDateLong(best.late.lastSpringFrost.p50))}: ${best.gap} days apart. A tomato transplanted on the same calendar date would be safe in one and frozen in the other.`;
  },

  cityCount(ctx) {
    return ctx.cities.length.toLocaleString('en-US');
  }
};

function fillPlaceholders(body, ctx, slug) {
  return body.replace(/\{\{(\w+)\}\}/g, (m, name) => {
    if (!PLACEHOLDERS[name]) throw new Error(`guide ${slug}: unknown placeholder {{${name}}}`);
    return PLACEHOLDERS[name](ctx);
  });
}

function prefixLinks(html) {
  return html.replace(/href="(\/[^"]*)"/g, (m, p) => `href="${escapeHtml(basePathLib.href(p))}"`);
}

// ---------------------------------------------------------------------
// Pages
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

function renderGuide(guide, all, ctx) {
  const pagePath = `/guides/${guide.slug}/`;
  const related = all.filter((g) => g.slug !== guide.slug);
  // Prefix the author's links first: placeholder output already carries prefixed hrefs.
  const body = fillPlaceholders(prefixLinks(guide.body), ctx, guide.slug);
  const published = guide.published || '2026-10-05';
  const modified = guide.modified || published;

  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'Guides', href: '/guides/' }, { label: guide.h1 }])}
<article class="article">
<h1>${escapeHtml(guide.h1)}</h1>
<p class="lede answer">${escapeHtml(guide.summary)}</p>
${body}
</article>
<h2>Find Your Frost Dates</h2>
${guides.buildLocateWidget()}
<h2>More Guides</h2>
<ul class="guide-list">${related.map((g) => `<li><a href="${href(`/guides/${g.slug}/`)}">${escapeHtml(g.h1)}</a></li>`).join('')}</ul>`;

  return shell({
    title: guide.title,
    description: guide.description,
    canonicalPath: pagePath,
    bodyHtml,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: guide.h1,
      description: guide.description,
      datePublished: published,
      dateModified: modified,
      mainEntityOfPage: `${SITE_URL}${pagePath}`,
      author: { '@type': 'Organization', name: nicheConfig.siteName, url: `${SITE_URL}/about/` },
      publisher: { '@type': 'Organization', name: nicheConfig.siteName, url: `${SITE_URL}/` }
    }
  });
}

function renderIndex(all) {
  const items = all.map((g) => `<li><a href="${href(`/guides/${g.slug}/`)}"><strong>${escapeHtml(g.h1)}</strong></a><br><span class="guide-summary">${escapeHtml(g.summary)}</span></li>`).join('');
  const bodyHtml = `${layout.buildGenericBreadcrumbs([{ label: 'Home', href: '/' }, { label: 'Guides' }])}
<h1>Gardening Guides: Frost, Timing, and Planting</h1>
<p class="lede answer">Practical guides to working with your frost dates: what they mean, how to protect plants, and when to plant each part of the garden.</p>
<ul class="guide-list guide-index">${items}</ul>`;
  return shell({
    title: 'Gardening Guides: Frost Dates, Timing & Planting',
    description: 'Guides to frost dates, frost protection, seed starting, hardening off, fall planting, and hardiness zones, built on NOAA climate data.',
    canonicalPath: '/guides/',
    bodyHtml
  });
}

/** Short related-guides list for other page types; `slugs` picks and orders guides. */
function buildGuideLinks(all, slugs) {
  const picked = slugs.map((s) => all.find((g) => g.slug === s)).filter(Boolean);
  if (!picked.length) return '';
  return `<ul class="guide-list">${picked.map((g) => `<li><a href="${href(`/guides/${g.slug}/`)}">${escapeHtml(g.h1)}</a></li>`).join('')}</ul>`;
}

function renderGuides(cities, siteDir, all) {
  const ctx = { cities };
  const urls = [];
  for (const g of all) {
    writePage(siteDir, `/guides/${g.slug}/`, renderGuide(g, all, ctx));
    urls.push(`/guides/${g.slug}/`);
  }
  if (all.length) {
    writePage(siteDir, '/guides/', renderIndex(all));
    urls.unshift('/guides/');
  }
  return urls;
}

module.exports = { loadGuides, renderGuides, buildGuideLinks, weeksPhrase };
