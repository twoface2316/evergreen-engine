'use strict';

/**
 * engine/lib/html-validate.js — niche-agnostic basic static-HTML sanity
 * checks used at generation time (not a full HTML validator): balanced
 * tags, doctype present, title/description length, byte-size budget.
 */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

function checkBalancedTags(html) {
  // Strip script/style contents (they can contain angle brackets that
  // aren't HTML tags, e.g. `<` in JS comparisons or JSON).
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(stripped))) {
    const [full, tagName, selfClose] = m;
    const lower = tagName.toLowerCase();
    if (full.startsWith('</')) {
      if (VOID_ELEMENTS.has(lower)) continue;
      if (stack.length === 0 || stack[stack.length - 1] !== lower) {
        return { ok: false, reason: `Mismatched closing tag </${lower}> (stack: ${stack.join(',')})` };
      }
      stack.pop();
    } else {
      if (VOID_ELEMENTS.has(lower) || selfClose === '/' || full.endsWith('/>')) continue;
      stack.push(lower);
    }
  }
  if (stack.length !== 0) {
    return { ok: false, reason: `Unclosed tags: ${stack.join(',')}` };
  }
  return { ok: true };
}

/**
 * Generic checks every page shares. Returns an array of issue strings
 * (empty = clean). Niches append their own page-specific checks (e.g.
 * "expected N table rows") to this array.
 */
function validateBasicPage(html, { maxSizeBytes = 100 * 1024, maxTitleLen = 60, maxDescLen = 155 } = {}) {
  const issues = [];
  const balance = checkBalancedTags(html);
  if (!balance.ok) issues.push(`Unbalanced HTML tags: ${balance.reason}`);
  if (!html.includes('<!doctype html>')) issues.push('Missing doctype');

  const titleMatch = /<title>([^<]*)<\/title>/.exec(html);
  if (!titleMatch || titleMatch[1].length > maxTitleLen || titleMatch[1].length === 0) {
    issues.push(`Title length out of bounds (${titleMatch ? titleMatch[1].length : '?'} chars)`);
  }

  const descMatch = /<meta name="description" content="([^"]*)"/.exec(html);
  if (!descMatch || descMatch[1].length > maxDescLen) {
    issues.push(`Description length out of bounds (${descMatch ? descMatch[1].length : '?'} chars)`);
  }

  const sizeBytes = Buffer.byteLength(html, 'utf8');
  if (sizeBytes >= maxSizeBytes) {
    issues.push(`Page size ${sizeBytes} bytes exceeds ${maxSizeBytes} byte budget`);
  }

  return { issues, sizeBytes };
}

module.exports = { VOID_ELEMENTS, checkBalancedTags, validateBasicPage };
