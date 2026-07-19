'use strict';

/**
 * engine/lib/base-path.js — support serving a site from a sub-path
 * (e.g. a GitHub Pages *project* page at https://user.github.io/repo/,
 * as opposed to a custom domain or user/org page at the origin root).
 *
 * All internal, root-relative hrefs built by a niche's templates
 * (anything starting with "/") need this prefix so they still resolve
 * once the site is deployed under a sub-path. Absolute URLs built from
 * SITE_URL (canonical links, JSON-LD, sitemap.xml, robots.txt) do NOT
 * need this — SITE_URL is expected to already include the sub-path,
 * e.g. SITE_URL=https://user.github.io/evergreen-engine.
 *
 * Module-level singleton state is intentional: a single `node
 * scripts/render.js full` process renders one site with one base path,
 * so callers set it once at the top of the run via setBasePath() and
 * every template helper picks it up via href()/getBasePath().
 */

let BASE_PATH = '';

/** basePath e.g. "/evergreen-engine" or "" (root). Leading slash, no trailing slash. */
function setBasePath(basePath) {
  const trimmed = (basePath || '').trim();
  if (trimmed === '' || trimmed === '/') {
    BASE_PATH = '';
    return;
  }
  BASE_PATH = '/' + trimmed.replace(/^\/+|\/+$/g, '');
}

function getBasePath() {
  return BASE_PATH;
}

/** Prefix a root-relative path ("/foo/") with the configured base path. Non-root-relative input is returned unchanged. */
function href(rootRelativePath) {
  if (typeof rootRelativePath !== 'string' || !rootRelativePath.startsWith('/')) {
    return rootRelativePath;
  }
  if (rootRelativePath === '/') {
    return BASE_PATH === '' ? '/' : BASE_PATH + '/';
  }
  return BASE_PATH + rootRelativePath;
}

module.exports = { setBasePath, getBasePath, href };
