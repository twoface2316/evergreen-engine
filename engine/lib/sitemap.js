'use strict';

/**
 * engine/lib/sitemap.js — niche-agnostic sitemap.xml + robots.txt builders.
 *
 * `siteUrl` is expected to be the full origin (+ sub-path, if the site is
 * deployed under one — see engine/lib/base-path.js), with no trailing
 * slash, e.g. "https://user.github.io/evergreen-engine".
 * `urls` are root-relative paths, e.g. "/il/chicago/".
 */

function buildSitemapXml(urls, siteUrl) {
  const items = urls.map((u) => `  <url><loc>${siteUrl}${u}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>
`;
}

function buildRobotsTxt(siteUrl) {
  return `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
}

module.exports = { buildSitemapXml, buildRobotsTxt };
