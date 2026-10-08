'use strict';

/**
 * engine/lib/guides.js — niche-agnostic long-form guides.
 *
 * A guide is a hand-written HTML fragment ({slug}.html) in a niche's
 * content directory, opening with a JSON front-matter comment:
 *
 *   <!--{"title": "...", "h1": "...", "description": "...", "summary": "...",
 *        "order": 1, "published": "2026-10-08", "updated": "...",
 *        "related": ["other-slug", ...]}-->
 *
 * Bodies may contain {{key}}, {{key:arg}} or {{key:arg|text}} placeholders.
 * Built in: {{amazon:search terms|link text}} (a sponsored Amazon search
 * link when an Associates tag is configured, plain text otherwise). Every
 * other key is answered by the niche: first its resolve(key, arg, text)
 * hook, then its `values` map; anything unanswered fails the build so a
 * typo can't ship as literal braces. Root-relative hrefs are base-path
 * prefixed.
 */

const fs = require('fs');
const path = require('path');

const basePathLib = require('./base-path.js');
const { escapeHtml } = require('./escape-html.js');

function loadGuides(contentDir) {
  if (!fs.existsSync(contentDir)) return [];
  return fs
    .readdirSync(contentDir)
    .filter((f) => f.endsWith('.html'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(contentDir, file), 'utf8');
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

function amazonLink(query, text, tag) {
  if (!tag) return escapeHtml(text);
  const href = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}`;
  return `<a href="${escapeHtml(href)}" rel="sponsored noopener">${escapeHtml(text)}</a>`;
}

/** fillGuideBody(guide, { values, resolve, amazonTag }) -> { html, usedAmazon } */
function fillGuideBody(guide, { values = {}, resolve = () => undefined, amazonTag = null }) {
  let usedAmazon = false;
  const body = guide.body.replace(/\{\{([a-zA-Z0-9]+)(?::([^}|]+))?(?:\|([^}]+))?\}\}/g, (all, key, arg, text) => {
    if (key === 'amazon') {
      usedAmazon = true;
      return amazonLink(arg, text || arg, amazonTag);
    }
    const resolved = resolve(key, arg, text);
    if (resolved !== undefined) return resolved;
    if (!(key in values)) throw new Error(`${guide.slug}: unknown placeholder ${all}`);
    return values[key];
  });
  const html = body.replace(/href="(\/[^"]*)"/g, (all, p) => `href="${escapeHtml(basePathLib.href(p))}"`);
  return { html, usedAmazon };
}

function formatDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** A card linking up to `n` guides, for city/state/home pages. */
function buildGuideLinks(guides, { heading = 'Guides', n = 4 } = {}) {
  if (!guides.length) return '';
  return `<section class="card"><h2>${escapeHtml(heading)}</h2><ul>${guides
    .slice(0, n)
    .map((g) => `<li><a href="${escapeHtml(basePathLib.href(`/guides/${g.slug}/`))}">${escapeHtml(g.h1)}</a></li>`)
    .join('')}</ul></section>`;
}

/**
 * renderGuidePages({
 *   guides, fill(guide) -> { html, usedAmazon },
 *   page({ title, description, pathName, bodyHtml, jsonLdHtml }) -> html,
 *   writePage(rootRelativeDir, html), breadcrumbs(trail) -> html,
 *   siteUrl, siteName, amazonTag,
 *   index: { title, description, h1, lede }
 * }) -> URLs written (each guide plus /guides/)
 */
function renderGuidePages({ guides, fill, page, writePage, breadcrumbs, siteUrl, siteName, amazonTag, index }) {
  if (!guides.length) return [];
  const bySlug = new Map(guides.map((g) => [g.slug, g]));
  const href = (p) => escapeHtml(basePathLib.href(p));
  const urls = [];

  for (const g of guides) {
    const { html, usedAmazon } = fill(g);
    const trail = [
      { label: 'Home', href: '/' },
      { label: 'Guides', href: '/guides/' },
      { label: g.h1, href: `/guides/${g.slug}/` }
    ];
    const related = (g.related || []).map((s) => bySlug.get(s)).filter(Boolean);
    const disclosure = usedAmazon && amazonTag ? '<p class="muted">This guide contains affiliate links. As an Amazon Associate we earn from qualifying purchases.</p>' : '';
    const body = `${breadcrumbs(trail)}
<article class="guide">
<h1>${escapeHtml(g.h1)}</h1>
<p class="muted">Published ${formatDate(g.published)}${g.updated ? ` · Updated ${formatDate(g.updated)}` : ''}</p>
${disclosure}
<p class="lede">${escapeHtml(g.summary)}</p>
<section class="card prose">
${html}
</section>
</article>
${related.length ? `<section class="card"><h2>Related guides</h2><ul>${related.map((r) => `<li><a href="${href(`/guides/${r.slug}/`)}">${escapeHtml(r.h1)}</a></li>`).join('')}</ul></section>` : ''}`;
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Article', headline: g.h1, description: g.description, datePublished: g.published, dateModified: g.updated || g.published, mainEntityOfPage: `${siteUrl}/guides/${g.slug}/`, publisher: { '@type': 'Organization', name: siteName } },
        { '@type': 'BreadcrumbList', itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.label, item: `${siteUrl}${t.href}` })) }
      ]
    };
    writePage(
      `/guides/${g.slug}/`,
      page({ title: g.title, description: g.description, pathName: `/guides/${g.slug}/`, bodyHtml: body, jsonLdHtml: `<script type="application/ld+json">${JSON.stringify(ld)}</script>` })
    );
    urls.push(`/guides/${g.slug}/`);
  }

  const indexBody = `${breadcrumbs([{ label: 'Home', href: '/' }, { label: 'Guides', href: '/guides/' }])}
<h1>${escapeHtml(index.h1)}</h1>
<p class="lede">${escapeHtml(index.lede)}</p>
${guides.map((g) => `<section class="card"><h2><a href="${href(`/guides/${g.slug}/`)}">${escapeHtml(g.h1)}</a></h2><p>${escapeHtml(g.summary)}</p></section>`).join('\n')}`;
  writePage('/guides/', page({ title: index.title, description: index.description, pathName: '/guides/', bodyHtml: indexBody }));
  urls.push('/guides/');
  return urls;
}

module.exports = { loadGuides, fillGuideBody, formatDate, buildGuideLinks, renderGuidePages };
