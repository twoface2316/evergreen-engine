'use strict';

/**
 * engine/lib/render-loop.js — niche-agnostic static-site render loop
 * scaffolding: given a list of items and a function that turns one item
 * into an HTML string plus an output directory, write every page to disk,
 * catching and collecting per-item errors instead of aborting the whole
 * run, with periodic progress logging. Also a recursive file counter used
 * for the "total files under site/" acceptance check.
 */

const fs = require('fs');
const path = require('path');

function countFilesRecursive(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFilesRecursive(full);
    else count += 1;
  }
  return count;
}

/**
 * renderCollection(items, {
 *   render(item, index) -> htmlString,
 *   outDir(item, index) -> array of path segments under siteDir (no filename),
 *   siteDir,
 *   fileName,       // default 'index.html'
 *   label,          // default 'items', used in progress logs
 *   logEvery        // default 500
 * }) -> { ok, errors: [{ item, error }] }
 */
function renderCollection(items, opts) {
  const { render, outDir, siteDir, fileName = 'index.html', label = 'items', logEvery = 500 } = opts;
  let ok = 0;
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const html = render(item, i);
      const dir = path.join(siteDir, ...outDir(item, i));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fileName), html, 'utf8');
      ok++;
    } catch (err) {
      errors.push({ item, error: err.message });
    }
    if ((i + 1) % logEvery === 0 || i + 1 === items.length) {
      console.log(`  ${label}: ${i + 1}/${items.length}`);
    }
  }

  return { ok, errors };
}

module.exports = { countFilesRecursive, renderCollection };
