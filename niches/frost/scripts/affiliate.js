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
  'soil-thermometer': { name: 'Soil thermometer', q: 'soil thermometer gardening', blurb: 'Tells you when soil is warm enough to sow, which matters as much as the frost date.' },
  'seed-mix': { name: 'Seed starting mix', q: 'seed starting mix', blurb: 'Sterile, fine-textured mix that drains well; garden soil compacts in small cells.' },
  'water-wall': { name: 'Water-filled plant protectors', q: 'wall of water plant protector', blurb: 'Rings of water around early tomatoes soak up daytime heat and release it overnight.' },
  'hoops': { name: 'Low tunnel hoops', q: 'garden hoops for row cover', blurb: 'Hold row cover or plastic off plants to turn a bed into a low tunnel.' },
  'clip-fan': { name: 'Small clip-on fan', q: 'small clip on fan', blurb: 'A gentle breeze over seedlings builds sturdy stems and helps prevent damping-off.' },
  'min-max-thermometer': { name: 'Min/max garden thermometer', q: 'min max thermometer outdoor garden', blurb: 'Records the overnight low at plant height so you learn how your garden compares to the forecast.' },
  'seed-garlic': { name: 'Seed garlic', q: 'seed garlic for planting', blurb: 'Plant cloves in fall, a few weeks before the ground freezes, for a summer harvest.' },
  'tomato-cages': { name: 'Tomato cages', q: 'heavy duty tomato cages', blurb: 'Set them at transplant time, before roots spread and plants sprawl.' },
  'trellis': { name: 'Trellis netting', q: 'garden trellis netting', blurb: 'Vertical support for peas, beans, and cucumbers; saves space and keeps fruit clean.' },
  'grow-bags': { name: 'Potato grow bags', q: 'potato grow bags', blurb: 'Grow potatoes on a patio and harvest by tipping the bag out.' }
};

// Extra gear for specific crops, added ahead of the planting-method gear.
const CROP_EXTRAS = {
  tomato: ['tomato-cages'],
  cucumber: ['trellis'],
  pea: ['trellis'],
  'green-bean': ['trellis'],
  potato: ['grow-bags'],
  'sweet-potato': ['grow-bags']
};

const SEASON_GEAR = {
  fall: ['frost-cloth', 'frost-alarm', 'row-cover'],
  spring: ['seed-trays', 'grow-light', 'soil-thermometer']
};

const GUIDE_GEAR = {
  'protect-plants-from-frost': ['frost-cloth', 'row-cover', 'water-wall', 'hoops', 'frost-alarm', 'cold-frame'],
  'frost-vs-freeze': ['frost-cloth', 'frost-alarm', 'row-cover', 'cold-frame'],
  'when-to-start-seeds-indoors': ['seed-trays', 'seed-mix', 'heat-mat', 'grow-light', 'clip-fan'],
  'harden-off-seedlings': ['cold-frame', 'grow-light', 'frost-cloth'],
  'fall-garden-planting': ['seed-garlic', 'row-cover', 'hoops', 'cold-frame'],
  'how-frost-dates-work': ['min-max-thermometer', 'frost-alarm', 'frost-cloth'],
  'hardiness-zones-vs-frost-dates': ['seed-garlic', 'min-max-thermometer', 'cold-frame']
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
  const extras = CROP_EXTRAS[crop.slug] || [];
  if (crop.method === 'indoor-start') return [...extras, 'seed-trays', 'grow-light', 'frost-cloth'];
  if (crop.fallPlanting) return [...extras, 'row-cover', 'soil-thermometer'];
  return [...extras, 'soil-thermometer', 'frost-cloth'];
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

/**
 * In-text link for guide prose: {{gear:key|anchor text}}. With affiliates
 * off it renders the anchor text alone, so guides read the same either way.
 */
function inlineLink(key, textHtml) {
  if (!GEAR[key]) throw new Error(`unknown gear key "${key}"`);
  const item = gearItem(key);
  return item ? `<a href="${escapeHtml(item.url)}" rel="sponsored nofollow noopener" target="_blank">${textHtml}</a>` : textHtml;
}

/** Notice shown above guide text that contains in-text affiliate links. */
function inlineDisclosure() {
  if (!cfg.amazonTag) return '';
  return `<p class="gear-note">${escapeHtml(disclosureText(true))}</p>`;
}

/** One-line footer disclosure, '' when no affiliate program is configured. */
function footerDisclosure() {
  if (!enabled()) return '';
  return cfg.amazonTag
    ? 'Some links are affiliate links: FrostCal earns a commission from qualifying purchases. As an Amazon Associate FrostCal earns from qualifying purchases.'
    : 'Some links are affiliate links: FrostCal earns a commission from qualifying purchases.';
}

module.exports = { enabled, buildSeasonBox, buildCropBox, buildGuideBox, footerDisclosure, inlineLink, inlineDisclosure, GEAR };
