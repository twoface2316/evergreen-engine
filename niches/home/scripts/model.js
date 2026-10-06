'use strict';

/**
 * niches/home/scripts/model.js — pure classification and sizing rules.
 * softenerSize() is self-contained so the on-page calculator can embed its
 * source and match the page exactly.
 */

const GPG_MG_L = 17.1; // 1 grain per gallon = 17.1 mg/L as CaCO3

/** USGS hardness bands, mg/L as CaCO3. */
function hardnessBand(mgL) {
  if (mgL <= 60) return { key: 'soft', label: 'Soft' };
  if (mgL <= 120) return { key: 'moderate', label: 'Moderately hard' };
  if (mgL <= 180) return { key: 'hard', label: 'Hard' };
  return { key: 'very-hard', label: 'Very hard' };
}

function toGpg(mgL) {
  return mgL / GPG_MG_L;
}

/** Softener capacity (grains) for a household; smallest standard size covering the regeneration cycle. */
function softenerSize(people, gpg, gallonsPerPersonDay, days, sizes) {
  var daily = people * gallonsPerPersonDay * gpg;
  var needed = daily * days;
  for (var i = 0; i < sizes.length; i++) if (sizes[i] >= needed) return { daily: daily, needed: needed, size: sizes[i] };
  return { daily: daily, needed: needed, size: null };
}

/** Lead 90th percentile vs the EPA action level. */
function leadStatus(mgL, actionLevel) {
  if (mgL == null) return { key: 'none', label: 'No recent result' };
  if (mgL > actionLevel) return { key: 'over', label: 'Above EPA action level' };
  if (mgL >= actionLevel / 3) return { key: 'elevated', label: 'Below action level, detectable' };
  if (mgL > 0) return { key: 'low', label: 'Low' };
  return { key: 'nd', label: 'Not detected' };
}

const RADON_ZONES = {
  1: { key: 'high', label: 'Zone 1 — highest potential', level: 'above 4 pCi/L' },
  2: { key: 'moderate', label: 'Zone 2 — moderate potential', level: '2 to 4 pCi/L' },
  3: { key: 'low', label: 'Zone 3 — low potential', level: 'below 2 pCi/L' }
};

/** Health-based violations that began within `years` of `today` (ISO dates). */
function recentHealth(list, today, years) {
  const cutoff = `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
  return list.filter((v) => v.health && v.begin >= cutoff);
}

module.exports = { GPG_MG_L, hardnessBand, toGpg, softenerSize, leadStatus, RADON_ZONES, recentHealth };
