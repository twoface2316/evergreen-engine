'use strict';

/**
 * niches/home/config.js — site identity, URL defaults and monetization IDs
 * for the home water + radon niche. SITE_URL / BASE_PATH env vars override
 * at build time (see scripts/render.js).
 */

module.exports = {
  siteName: 'WaterByCity',
  // Production origin (Cloudflare Pages custom domain); canonical URLs use this.
  defaultSiteUrl: 'https://waterbycity.com',
  customDomain: null,
  contactEmail: 'twoface692@gmail.com',

  // ---- Monetization / analytics: paste IDs here, push, done. ----
  goatcounterCode: null,
  adsensePublisherId: null,
  // Amazon Associates tracking ID for this site (e.g. 'waterbycity-20');
  // null = product boxes render without links.
  amazonTag: null,

  // ---- Reference values (shown on /methodology/) ----
  lead: { actionLevelMgL: 0.015 }, // EPA action level, 15 ppb
  copper: { actionLevelMgL: 1.3 },
  softener: {
    gallonsPerPersonDay: 75,
    daysBetweenRegen: 7,
    sizes: [24000, 32000, 40000, 48000, 64000, 80000, 96000]
  }
};
