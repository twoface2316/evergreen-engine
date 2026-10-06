'use strict';

/**
 * niches/frost/scripts/affiliate.js — "Gear for this" product boxes.
 *
 * Driven by niches/frost/config.js `affiliate`:
 *   amazonTag  Amazon Associates tracking ID (e.g. 'frostcal-20'). Gear links
 *              are Amazon search links carrying the tag, so they never point
 *              at a discontinued product.
 *   seedShop   { name, searchUrl, linkTemplate } for crop seed links. searchUrl
 *              holds {q}; linkTemplate (optional) wraps the final shop URL for
 *              an affiliate network and holds {url} (URL-encoded), e.g. AWIN's
 *              https://www.awin1.com/cread.php?awinmid=..&awinaffid=..&ued={url}
 * Either may be null; with both null every box renders as '' (no box, no
 * disclosure), same as the AdSense/GoatCounter switches.
 */

const layout = require('../templates/layout.js');
const nicheConfig = require('../config.js');

const { escapeHtml } = layout;
const cfg = nicheConfig.affiliate || {};

// Curated gear. `q` is the Amazon search phrase.
const GEAR = {
  'frost-cloth': { name: 'Frost cloth plant covers', q: 'frost cloth plant cover', blurb: 'Drape over tender plants before a frost night; traps ground heat for a few degrees of protection.' },
  'row-cover': { name: 'Floating row cover', q: 'floating row cover garden', blurb: 'Lightweight fabric that stretches the fall harvest of greens and roots by weeks.' },
  'frost-alarm': { name: 'Wireless thermometer with frost alarm', q: 'wireless indoor outdoor thermometer frost alarm', blurb: 'Sensor in the garden, display in the kitchen; alerts you when it nears freezing.' },
  'cold-frame': { name: 'Cold frame', q: 'garden cold frame', blurb: 'A mini greenhouse for hardening off seedlings in spring and growing greens into winter.' },
  'seed-trays': { name: 'Seed starting trays with domes', q: 'seed starting trays humidity dome', blurb: 'Cell trays plus humidity domes for starting seeds indoors before your last frost.' },
  'heat-mat': { name: 'Seedling heat mat', q: 'seedling heat mat thermostat', blurb: 'Warm soil speeds germination of tomatoes, peppers, and eggplant by days.' },
  'grow-light': { name: 'LED grow light', q: 'led grow light seedlings', blurb: 'Keeps indoor seedlings stocky instead of leggy; a window alone is rarely enough.' },
  'soil-thermometer': { name: 'Soil thermometer', q: 'soil thermometer gardening', blurb: 'Tells you when soil is warm enough to sow, which matters as much as the frost date.' }
};

const SEASON_GEAR = {
  fall: ['frost-cloth', 'frost-alarm', 'row-cover'],
  spring: ['seed-trays', 'grow-light', 'soil-thermometer']
};

const GUIDE_GEAR = {
  'protect-plants-from-frost': ['frost-cloth', 'row-cover', 'frost-alarm', 'cold-frame'],
  'frost-vs-freeze': ['frost-cloth', 'frost-alarm', 'row-cover'],
  'when-to-start-seeds-indoors': ['seed-trays', 'heat-mat', 'grow-light', 'soil-thermometer'],
  'harden-off-seedlings': ['cold-frame', 'grow-light', 'frost-cloth'],
  'fall-garden-planting': ['row-cover', 'cold-frame', 'frost-cloth']
};

function enabled() {
  return Boolean(cfg.amazonTag || cfg.seedShop);
}

function amazonUrl(q) {
  return `https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=${encodeURIComponent(cfg.amazonTag)}`;
}

function seedUrl(q) {
  const shopUrl = cfg.seedShop.searchUrl.replace('{q}', encodeURIComponent(q));
  return cfg.seedShop.linkTemplate ? cfg.seedShop.linkTemplate.replace('{url}', encodeURIComponent(shopUrl)) : shopUrl;
}

/** Gear item -> {name, url, blurb}, or null when Amazon isn't configured. */
function gearItem(key) {
  const g = GEAR[key];
  if (!g || !cfg.amazonTag) return null;
  return { name: g.name, url: amazonUrl(g.q), blurb: g.blurb, amazon: true };
}

/** Seed link for a crop: the seed shop if configured, otherwise Amazon. */
function seedItem(crop, cropPlural) {
  const q = crop.slug === 'garlic' ? 'seed garlic' : crop.slug === 'potato' ? 'seed potatoes' : crop.slug === 'sweet-potato' ? 'sweet potato slips' : `${crop.name.toLowerCase()} seeds`;
  const label = crop.slug === 'garlic' ? 'Seed garlic' : crop.slug === 'potato' ? 'Seed potatoes' : crop.slug === 'sweet-potato' ? 'Sweet potato slips' : `${crop.name} seeds`;
  if (cfg.seedShop) {
    return { name: `${label} at ${cfg.seedShop.name}`, url: seedUrl(q), blurb: `Varieties suited to your season length; check days to maturity against your frost-free days.` };
  }
  if (cfg.amazonTag) return { name: label, url: amazonUrl(q), blurb: `Pick varieties whose days to maturity fit before your first fall frost.`, amazon: true };
  return null;
}

/** Gear keys that fit how a crop is planted. */
function cropGearKeys(crop) {
  if (crop.method === 'indoor-start') return ['seed-trays', 'grow-light', 'frost-cloth'];
  if (crop.fallPlanting) return ['row-cover', 'soil-thermometer'];
  return ['soil-thermometer', 'frost-cloth'];
}

function box(heading, items) {
  const list = items.filter(Boolean);
  if (!list.length) return '';
  const lis = list.map((it) => `<li><a href="${escapeHtml(it.url)}" rel="sponsored nofollow noopener" target="_blank">${escapeHtml(it.name)}</a><span>${escapeHtml(it.blurb)}</span></li>`).join('');
  return `<aside class="gear-box" aria-label="Recommended supplies">
<h3>${escapeHtml(heading)}</h3>
<ul>${lis}</ul>
<p class="gear-note">${escapeHtml(disclosureText(list.some((it) => it.amazon)))}</p>
</aside>`;
}

function disclosureText(amazon) {
  return amazon
    ? 'FrostCal earns a commission from purchases through these links, at no cost to you. As an Amazon Associate FrostCal earns from qualifying purchases.'
    : 'FrostCal earns a commission from purchases through these links, at no cost to you.';
}

/** City, zone, and other pages: the gear that fits the season of the build. */
function buildSeasonBox() {
  if (!enabled()) return '';
  const season = layout.seasonContext().season;
  const heading = season === 'fall' ? 'Gear for frost season' : 'Gear for seed-starting season';
  return box(heading, SEASON_GEAR[season].map(gearItem));
}

/** Crop pages: seeds for the crop plus gear for its planting method. */
function buildCropBox(crop, cropTitle, cropPlural) {
  if (!enabled()) return '';
  return box(`What you need to grow ${cropPlural}`, [seedItem(crop, cropPlural), ...cropGearKeys(crop).map(gearItem)]);
}

/** Guides: gear for the guide's topic, falling back to the season box. */
function buildGuideBox(slug) {
  if (!enabled()) return '';
  const keys = GUIDE_GEAR[slug];
  return keys ? box('Supplies mentioned in this guide', keys.map(gearItem)) : buildSeasonBox();
}

/** One-line footer disclosure, '' when no affiliate program is configured. */
function footerDisclosure() {
  if (!enabled()) return '';
  return cfg.amazonTag
    ? 'Some links are affiliate links: FrostCal earns a commission from qualifying purchases. As an Amazon Associate FrostCal earns from qualifying purchases.'
    : 'Some links are affiliate links: FrostCal earns a commission from qualifying purchases.';
}

module.exports = { enabled, buildSeasonBox, buildCropBox, buildGuideBox, footerDisclosure, GEAR };
