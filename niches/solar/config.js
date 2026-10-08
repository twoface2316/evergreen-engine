'use strict';

/**
 * niches/solar/config.js — niche-level config: site identity, URL defaults,
 * monetization IDs, and the economic assumptions every page's payback math
 * uses. Scripts read SITE_URL / BASE_PATH from the environment first (see
 * scripts/render.js), so these are local-dev / production defaults.
 */

module.exports = {
  siteName: 'SolarByCity',
  siteTitle: 'Solar Panel Cost, Payback & Savings for US Cities',
  // Production origin (Cloudflare Pages custom domain); canonical URLs use this.
  defaultSiteUrl: 'https://solarbycity.com',
  // Cloudflare Pages reads the custom domain from the dashboard, not a
  // CNAME file, so this stays null there.
  customDomain: null,
  contactEmail: 'twoface692@gmail.com',

  // ---- Monetization / analytics: paste IDs here, push, done. ----
  goatcounterCode: null,
  adsensePublisherId: 'pub-8043947909143318',
  // Amazon Associates tracking ID for this site (e.g. 'solarbycity-20');
  // null = guide product mentions render as plain text.
  amazonTag: null,
  // Solar quote lead-gen partner. url: affiliate landing URL (may include
  // {zip}/{state} placeholders); null = no "get quotes" boxes.
  leadGen: {
    url: null,
    label: 'Get free quotes from local installers'
  },

  // ---- Economic assumptions (shown on /methodology/) ----
  assumptions: {
    // PVWatts inputs for the per-city 1 kW reference run.
    pv: { tilt: 20, azimuth: 180, losses: 14, arrayType: 1, moduleType: 0 },
    // Size the system to cover this share of the state's average usage,
    // clamped to a realistic residential range.
    offsetShare: 1.0,
    minKw: 3,
    maxKw: 15,
    panelWatts: 400,
    // Annual electricity price increase used for long-run savings.
    priceEscalation: 0.025,
    // Annual panel output loss.
    degradation: 0.005,
    lifetimeYears: 25,
    // Federal residential credit (Section 25D) ended for systems placed in
    // service after 2025-12-31.
    federalCredit: 0
  }
};
