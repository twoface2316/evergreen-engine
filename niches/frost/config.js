'use strict';

/**
 * niches/frost/config.js — niche-level config: site identity + URL
 * defaults. Scripts still read SITE_URL / BASE_PATH from the environment
 * at generation time (see niches/frost/scripts/render.js) so CI/deploy
 * can override them per-environment; the values here are just the
 * niche's local-dev defaults and the display name/title used in page copy.
 */

module.exports = {
  siteName: 'FrostCal',
  siteTitle: 'FrostCal — Frost Dates & Planting Calendars for US Cities',
  // Production origin. Served from the domain root, so no BASE_PATH.
  defaultSiteUrl: 'https://frostcal.com',
  // Written to the site root on every full render so GitHub Pages keeps
  // the custom domain across deploys.
  customDomain: 'frostcal.com',
  // Shown on /contact/ and referenced in the privacy policy. Swap for a
  // site-specific alias before heavy promotion if desired.
  contactEmail: 'twoface692@gmail.com',

  // ---- Monetization / analytics: paste IDs here, push, done. ----
  // GoatCounter site code: the "frostcal" in https://frostcal.goatcounter.com.
  // null = no analytics script on the site.
  goatcounterCode: 'frostcal',
  // AdSense publisher ID, e.g. 'pub-1234567890123456' (from AdSense ->
  // Account -> Account information). Adds the Auto ads tag to every page and
  // writes /ads.txt. null = no ads.
  adsensePublisherId: 'pub-8043947909143318',

  // Affiliate links (scripts/affiliate.js). null = no gear boxes, no
  // disclosure. amazonTag: your Associates tracking ID, e.g. 'frostcal-20'.
  // seedShop: e.g. { name: 'True Leaf Market',
  //   searchUrl: 'https://www.trueleafmarket.com/search?q={q}',
  //   linkTemplate: '<network deep-link URL with {url}>' }
  affiliate: {
    amazonTag: 'frostcal-20',
    seedShop: null
  },

  // Printable planting calendars (scripts/printables.js). url: store page
  // (Lemon Squeezy/Gumroad/Etsy); null = no "Get the printable" box on city
  // pages. urls: optional per-bucket overrides keyed by bucket id ('apr-15').
  printables: {
    url: null,
    urls: {},
    price: '$5'
  }
};
