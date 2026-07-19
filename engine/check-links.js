'use strict';

/**
 * engine/check-links.js — niche-agnostic internal link checker.
 *
 * Samples random generated pages from a site directory, parses every
 * internal href="" / src="" it finds, and verifies the target resolves to
 * a real file on disk. Prints a PASS/FAIL report; exits non-zero on any
 * broken link.
 *
 * Usage:
 *   node engine/check-links.js <siteDir> [options]
 *
 * Options:
 *   --base-path=/evergreen-engine   Strip this root-relative prefix before
 *                                   resolving hrefs to files on disk (needed
 *                                   when the site was generated with
 *                                   BASE_PATH set — see engine/lib/base-path.js).
 *   --sample=30                     How many pages to sample beyond the
 *                                   always-included homepage (default 30).
 *   --state-sample=2                How many state/category index pages
 *                                   (one level under siteDir) to sample
 *                                   (default 2).
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const positional = [];
  const opts = { basePath: '', sample: 30, stateSample: 2 };
  for (const arg of argv) {
    if (arg.startsWith('--base-path=')) opts.basePath = arg.slice('--base-path='.length);
    else if (arg.startsWith('--sample=')) opts.sample = parseInt(arg.slice('--sample='.length), 10);
    else if (arg.startsWith('--state-sample=')) opts.stateSample = parseInt(arg.slice('--state-sample='.length), 10);
    else positional.push(arg);
  }
  opts.siteDir = positional[0];
  return opts;
}

// ---------------------------------------------------------------------
// Discover pages to sample from
// ---------------------------------------------------------------------
function listTopLevelDirs(siteDir, excludeNames) {
  return fs
    .readdirSync(siteDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !excludeNames.has(e.name))
    .map((e) => e.name);
}

function listSecondLevelPages(siteDir, topDirs) {
  const files = [];
  for (const topName of topDirs) {
    const topDir = path.join(siteDir, topName);
    for (const entry of fs.readdirSync(topDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const indexPath = path.join(topDir, entry.name, 'index.html');
      if (fs.existsSync(indexPath)) files.push(indexPath);
    }
  }
  return files;
}

function pickRandom(arr, n) {
  const pool = arr.slice();
  const picked = [];
  while (picked.length < n && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

// ---------------------------------------------------------------------
// href/src extraction + resolution
// ---------------------------------------------------------------------
function extractInternalLinks(html) {
  const links = [];
  const re = /\s(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1];
    if (!raw) continue;
    if (raw.startsWith('//')) continue; // protocol-relative external
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) continue; // http:, https:, mailto:, tel:, javascript:, data:
    if (raw.startsWith('#')) continue;
    if (!raw.startsWith('/')) continue; // relative paths not used by this site; skip
    links.push(raw);
  }
  return links;
}

function stripBasePath(href, basePath) {
  if (!basePath) return href;
  if (href === basePath || href === basePath + '/') return '/';
  if (href.startsWith(basePath + '/')) return href.slice(basePath.length);
  return href; // not prefixed with basePath -- leave as-is, will likely 404 and be reported
}

function resolveTarget(siteDir, href, basePath) {
  const stripped = stripBasePath(href, basePath);
  const clean = stripped.split('#')[0].split('?')[0];
  if (clean === '' || clean === '/') return path.join(siteDir, 'index.html');
  if (clean.endsWith('/')) return path.join(siteDir, clean.slice(1, -1), 'index.html');
  return path.join(siteDir, clean.slice(1));
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
function run() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.siteDir) {
    console.error('Usage: node engine/check-links.js <siteDir> [--base-path=/repo] [--sample=30] [--state-sample=2]');
    process.exitCode = 1;
    return;
  }
  const siteDir = path.resolve(opts.siteDir);
  if (!fs.existsSync(siteDir)) {
    console.error(`Site directory not found: ${siteDir}`);
    process.exitCode = 1;
    return;
  }

  const excludeNames = new Set(['search-index']);
  const topDirs = listTopLevelDirs(siteDir, excludeNames);
  const allSecondLevelPages = listSecondLevelPages(siteDir, topDirs);

  const sampledPages = pickRandom(allSecondLevelPages, opts.sample);
  const homepage = path.join(siteDir, 'index.html');
  const sampledTopPages = pickRandom(topDirs, opts.stateSample).map((s) => path.join(siteDir, s, 'index.html'));

  const pagesToCheck = [homepage, ...sampledTopPages, ...sampledPages].filter((p) => fs.existsSync(p));

  console.log('Internal link check');
  console.log(`  site dir: ${siteDir}`);
  if (opts.basePath) console.log(`  base path: ${opts.basePath}`);
  console.log(`  second-level pages available: ${allSecondLevelPages.length}`);
  console.log(`  pages sampled: ${pagesToCheck.length} (homepage=1, top-level=${sampledTopPages.length}, second-level=${sampledPages.length})\n`);

  let totalLinks = 0;
  let brokenLinks = 0;
  const brokenDetails = [];
  const checkedTargetCache = new Map(); // avoid re-stat'ing the same target repeatedly

  for (const pagePath of pagesToCheck) {
    const html = fs.readFileSync(pagePath, 'utf8');
    const links = extractInternalLinks(html);
    const uniqueLinks = [...new Set(links)];
    let pageBroken = 0;

    for (const linkHref of uniqueLinks) {
      totalLinks++;
      const target = resolveTarget(siteDir, linkHref, opts.basePath);
      let exists = checkedTargetCache.get(target);
      if (exists === undefined) {
        exists = fs.existsSync(target) && fs.statSync(target).isFile();
        checkedTargetCache.set(target, exists);
      }
      if (!exists) {
        brokenLinks++;
        pageBroken++;
        brokenDetails.push({ page: path.relative(siteDir, pagePath), href: linkHref, target: path.relative(siteDir, target) });
      }
    }

    const rel = path.relative(siteDir, pagePath) || 'index.html';
    console.log(`[${pageBroken === 0 ? 'PASS' : 'FAIL'}] ${rel} — ${uniqueLinks.length} unique internal link(s), ${pageBroken} broken`);
  }

  console.log(`\nChecked ${pagesToCheck.length} pages, ${totalLinks} internal link references.`);
  if (brokenLinks === 0) {
    console.log('RESULT: PASS — zero broken links.');
  } else {
    console.log(`RESULT: FAIL — ${brokenLinks} broken link(s):`);
    for (const b of brokenDetails) {
      console.log(`  - ${b.page}: href="${b.href}" -> missing ${b.target}`);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run();
}

module.exports = { extractInternalLinks, resolveTarget, stripBasePath };
