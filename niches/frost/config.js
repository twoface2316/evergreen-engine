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
  // Local-dev fallback; production sets SITE_URL to the real deployed
  // origin (+ sub-path), e.g. https://user.github.io/evergreen-engine.
  defaultSiteUrl: 'https://frostcal.example',
  // Shown on /contact/ and referenced in the privacy policy. Swap for a
  // site-specific alias before heavy promotion if desired.
  contactEmail: 'Andrew@apicella5.com'
};
