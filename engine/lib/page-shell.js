'use strict';

/**
 * engine/lib/page-shell.js — niche-agnostic HTML document shell
 * (doctype, head meta/OG tags, body wrapper). Niches supply their own
 * header/footer/brand markup and body content as pre-rendered HTML
 * strings; this module only owns the boilerplate every page shares.
 */

const { escapeHtml } = require('./escape-html.js');

/**
 * buildPageShell({
 *   title, description,
 *   canonical,             // full absolute URL, or falsy to omit <link rel="canonical">
 *   robotsContent,         // default 'index, follow'
 *   stylesheetHref,        // e.g. basePath.href('/style.css')
 *   jsonLdHtml,            // optional pre-built <script type="application/ld+json">...</script>
 *   headerHtml,            // site header markup
 *   bodyHtml,              // main content markup (already includes <main>/wrapper if desired,
 *                          // or is wrapped in class="wrap" below if wrapMain !== false)
 *   footerHtml,
 *   wrapMain               // default true: wraps bodyHtml in <main class="wrap">...</main>
 * }) -> full HTML document string
 */
// Site-wide <head> additions (analytics, ad-network tags) set once per build
// via setShellDefaults(), so every page type picks them up without each
// renderer having to pass them.
let defaultHeadExtraHtml = '';

function setShellDefaults({ headExtraHtml = '' } = {}) {
  defaultHeadExtraHtml = headExtraHtml;
}

function buildPageShell(opts) {
  const {
    title,
    description,
    canonical,
    robotsContent = 'index, follow',
    stylesheetHref,
    jsonLdHtml = '',
    headerHtml = '',
    bodyHtml = '',
    footerHtml = '',
    wrapMain = true,
    headExtraHtml = defaultHeadExtraHtml
  } = opts;

  const main = wrapMain ? `<main class="wrap">\n${bodyHtml}\n${footerHtml}\n</main>` : `${bodyHtml}\n${footerHtml}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${canonical ? `<link rel="canonical" href="${canonical}">\n` : ''}<meta name="robots" content="${robotsContent}">
<link rel="stylesheet" href="${stylesheetHref}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta name="twitter:card" content="summary">
${jsonLdHtml}
${headExtraHtml}
</head>
<body>
${headerHtml}
${main}
</body>
</html>
`;
}

module.exports = { buildPageShell, setShellDefaults };
