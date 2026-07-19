'use strict';

/**
 * engine/lib/search-index.js — niche-agnostic client-side search index
 * builder. Given an array of compact records (already shaped however the
 * niche's search widget wants, e.g. { n: name, s: state, u: url }), either
 * embeds them inline on the homepage (small sites) or splits them into
 * bucketed JSON files under <siteDir>/search-index/ that the client fetches
 * lazily on first keystroke (large sites), based on a byte budget.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_INLINE_BUDGET_BYTES = 200 * 1024;

/** Default bucket key: lowercase first letter of the given field, 'misc' if non-alphabetic. */
function firstLetterBucketer(field) {
  return (record) => {
    const m = /[a-zA-Z]/.exec(String(record[field] ?? ''));
    return m ? m[0].toLowerCase() : 'misc';
  };
}

/**
 * buildSearchIndex(compactRecords, siteDir, {
 *   bucketKeyFn,             // record -> bucket key string; default firstLetterBucketer('n')
 *   inlineBudgetBytes,       // default 200KB
 *   searchIndexDirName       // default 'search-index'
 * }) -> { mode: 'inline'|'split', payload, bytes }
 *   'inline' payload = compactRecords (embed directly in the page)
 *   'split' payload = sorted array of bucket keys (letters) that were written to disk
 */
function buildSearchIndex(compactRecords, siteDir, options = {}) {
  const {
    bucketKeyFn = firstLetterBucketer('n'),
    inlineBudgetBytes = DEFAULT_INLINE_BUDGET_BYTES,
    searchIndexDirName = 'search-index'
  } = options;

  const inlineJson = JSON.stringify(compactRecords);
  const inlineBytes = Buffer.byteLength(inlineJson, 'utf8');
  const searchIndexDir = path.join(siteDir, searchIndexDirName);

  if (inlineBytes <= inlineBudgetBytes) {
    // Clean up a stale split index from a previous run, if any.
    fs.rmSync(searchIndexDir, { recursive: true, force: true });
    return { mode: 'inline', payload: compactRecords, bytes: inlineBytes };
  }

  const buckets = new Map();
  for (const rec of compactRecords) {
    const key = bucketKeyFn(rec);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(rec);
  }

  fs.mkdirSync(searchIndexDir, { recursive: true });
  const keys = [...buckets.keys()].sort();
  for (const key of keys) {
    fs.writeFileSync(path.join(searchIndexDir, `${key}.json`), JSON.stringify(buckets.get(key)), 'utf8');
  }

  return { mode: 'split', payload: keys, bytes: inlineBytes };
}

module.exports = { buildSearchIndex, firstLetterBucketer, DEFAULT_INLINE_BUDGET_BYTES };
