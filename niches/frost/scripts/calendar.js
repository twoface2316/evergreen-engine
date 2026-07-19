'use strict';

/**
 * calendar.js — Phase 2 crop planting-calendar engine.
 *
 * Pure, side-effect-free date math. No I/O, no dependencies.
 *
 * ---------------------------------------------------------------------
 * City record shape (per Phase 1 spec, data/cities-frost.json):
 *   {
 *     ...,
 *     frostFree: boolean,
 *     lastFrost:  { p10: DateLike, p50: DateLike, p90: DateLike },
 *     firstFrost: { p10: DateLike, p50: DateLike, p90: DateLike },
 *     ...
 *   }
 *
 * DateLike may be either:
 *   - { month: 1-12, day: 1-31 }              (calendar-day form, no year)
 *   - "YYYY-MM-DD" or any Date-parseable ISO string
 *
 * All frost dates are treated as day-of-year markers on a single
 * reference (non-leap) year; see toDayOfYear/fromDayOfYear below.
 *
 * NOAA percentile convention used throughout (confirmed against Phase 1
 * spec column names ANN-TMIN-PRBLST/PRBFST-T32FP10/50/90):
 *   P10 = 10% probability the frost occurs AFTER this date -> chronologically
 *         the LATEST of the three dates ("safe" framing: for last spring
 *         frost it's the latest/most-conservative date; for first fall
 *         frost it's also the latest, giving the longest growing season).
 *   P50 = median date.
 *   P90 = 90% probability the frost occurs AFTER this date -> chronologically
 *         the EARLIEST of the three ("risky" framing).
 *   So for both lastFrost and firstFrost: p10 date >= p50 date >= p90 date.
 *
 * ---------------------------------------------------------------------
 * Crop record shape (data/crops.json):
 *   {
 *     name, slug, category, method,
 *     seedStartOffsetWeeks?:  [minWeeks, maxWeeks],   // indoor-start only
 *     transplantOffsetWeeks?: [minWeeks, maxWeeks],   // indoor-start / transplant
 *     directSowOffsetWeeks?:  [minWeeks, maxWeeks],   // direct-sow (or alt for indoor-start)
 *     daysToMaturity: [min, max],
 *     fallPlanting?: { relativeTo: "firstFrost", offsetWeeks: [minWeeks, maxWeeks], notes },
 *     notes
 *   }
 * All offsetWeeks are relative to the anchor frost date's P50, negative = before.
 *
 * ---------------------------------------------------------------------
 * Output shape per crop from computeCalendar():
 *   {
 *     name, slug, category, method,
 *     seedStart:  DateRange | null,
 *     transplant: DateRange | null,
 *     directSow:  DateRange | null,
 *     fallPlanting: DateRange | null,
 *     daysToMaturity: [min, max],
 *     frostFreeNote: string | null,   // set when city.frostFree is true
 *     notes: string
 *   }
 *
 * DateRange = {
 *   startMonth, startDay,   // machine-readable
 *   endMonth, endDay,
 *   label: "Apr 15 – Apr 29"   // ISO-ish human string
 * }
 */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

// Non-leap reference year for day-of-year math. Using a fixed non-leap
// year keeps DOY <-> month/day conversion stable and matches the Phase 1
// spec's "convert DOY to calendar dates (non-leap year)" instruction.
const REF_YEAR = 2001;

const CUM_DAYS_BEFORE_MONTH = (() => {
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out = [0];
  for (let i = 0; i < 12; i++) out.push(out[i] + daysInMonth[i]);
  return out; // CUM_DAYS_BEFORE_MONTH[m] = days before month m (0-indexed, Jan=0)
})();

/**
 * Normalize a DateLike into a {month, day} pair (1-indexed month/day).
 * Accepts {month, day}, {month, day} with 0-indexed hints tolerated only
 * if explicitly out of 1-12 range is never produced by our own writers,
 * "YYYY-MM-DD" strings, or generic Date-parseable strings.
 */
function toMonthDay(dateLike) {
  if (dateLike == null) return null;
  if (typeof dateLike === 'object' && !(dateLike instanceof Date)) {
    if (typeof dateLike.month === 'number' && typeof dateLike.day === 'number') {
      return { month: dateLike.month, day: dateLike.day };
    }
    return null;
  }
  let d;
  if (dateLike instanceof Date) {
    d = dateLike;
  } else if (typeof dateLike === 'string') {
    // Handle plain "YYYY-MM-DD" without timezone surprises.
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateLike);
    if (isoMatch) {
      return { month: parseInt(isoMatch[2], 10), day: parseInt(isoMatch[3], 10) };
    }
    d = new Date(dateLike);
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return null;
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Convert {month, day} (1-indexed) to a day-of-year on the REF_YEAR. */
function monthDayToDOY(month, day) {
  return CUM_DAYS_BEFORE_MONTH[month - 1] + day;
}

/** Convert a day-of-year (may be <1 or >365 to represent wraparound) back to {month, day}. */
function doyToMonthDay(doy) {
  // Wrap into [1, 365] range, tracking how many years we crossed (not needed
  // for month/day, only for ordering — callers handle ordering separately).
  let d = doy;
  while (d < 1) d += 365;
  while (d > 365) d -= 365;
  for (let m = 11; m >= 0; m--) {
    if (d > CUM_DAYS_BEFORE_MONTH[m]) {
      return { month: m + 1, day: d - CUM_DAYS_BEFORE_MONTH[m] };
    }
  }
  return { month: 1, day: d };
}

function formatLabel(month, day) {
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

/**
 * Build a DateRange from an anchor DOY and a [minWeeks, maxWeeks] offset.
 * Offsets are applied in days (weeks * 7). Handles the case where the
 * range collapses to a single point (min === max) by still returning a
 * two-sided range (start === end) so downstream formatting is uniform.
 */
function buildRange(anchorDOY, offsetWeeksRange) {
  if (anchorDOY == null || !offsetWeeksRange) return null;
  const [minW, maxW] = offsetWeeksRange;
  const startDOY = anchorDOY + Math.round(minW * 7);
  const endDOY = anchorDOY + Math.round(maxW * 7);
  const start = doyToMonthDay(Math.min(startDOY, endDOY));
  const end = doyToMonthDay(Math.max(startDOY, endDOY));
  return {
    startMonth: start.month,
    startDay: start.day,
    endMonth: end.month,
    endDay: end.day,
    label: start.month === end.month && start.day === end.day
      ? formatLabel(start.month, start.day)
      : `${formatLabel(start.month, start.day)} – ${formatLabel(end.month, end.day)}`
  };
}

function anchorDOY(cityRecord, which) {
  const frostBlock = cityRecord && cityRecord[which];
  if (!frostBlock) return null;
  const md = toMonthDay(frostBlock.p50);
  if (!md) return null;
  return monthDayToDOY(md.month, md.day);
}

// Warm-season crops (frost-tender) get a distinct frost-free note than
// cold-hardy ones that are simply relevant year-round in mild climates.
const WARM_SEASON_SLUGS = new Set([
  'tomato', 'pepper', 'eggplant', 'cucumber', 'zucchini', 'winter-squash',
  'pumpkin', 'watermelon', 'cantaloupe', 'corn', 'green-bean', 'sweet-potato',
  'basil', 'sunflower', 'zinnia', 'marigold', 'cosmos', 'nasturtium', 'dahlia'
]);

/**
 * computeCalendar(cityRecord, crops) -> Array<CropCalendarEntry>
 *
 * Pure function: given a city's frost-date record and the crop list,
 * returns one calendar entry per crop with concrete date ranges.
 *
 * For frostFree cities, frost-relative offsets cannot be computed (there
 * is no last/first frost anchor), so date ranges are set to null and a
 * human-readable frostFreeNote is attached instead — no crash, no
 * fabricated dates.
 */
function computeCalendar(cityRecord, crops) {
  if (!Array.isArray(crops)) {
    throw new TypeError('computeCalendar: crops must be an array');
  }
  if (!cityRecord || typeof cityRecord !== 'object') {
    throw new TypeError('computeCalendar: cityRecord must be an object');
  }

  const isFrostFree = cityRecord.frostFree === true;
  const lastFrostDOY = isFrostFree ? null : anchorDOY(cityRecord, 'lastFrost');
  const firstFrostDOY = isFrostFree ? null : anchorDOY(cityRecord, 'firstFrost');

  return crops.map((crop) => {
    const entry = {
      name: crop.name,
      slug: crop.slug,
      category: crop.category,
      method: crop.method,
      seedStart: null,
      transplant: null,
      directSow: null,
      fallPlanting: null,
      daysToMaturity: crop.daysToMaturity || null,
      frostFreeNote: null,
      notes: crop.notes || ''
    };

    if (isFrostFree) {
      entry.frostFreeNote = WARM_SEASON_SLUGS.has(crop.slug)
        ? `This location is frost-free — grow ${crop.name.toLowerCase()} nearly year-round; time planting around the summer heat and rainy/dry season rather than frost.`
        : `This location is frost-free — ${crop.name.toLowerCase()} can typically be planted in fall/winter/spring; avoid the hottest mid-summer stretch.`;
      return entry;
    }

    if (lastFrostDOY != null) {
      if (crop.seedStartOffsetWeeks) {
        entry.seedStart = buildRange(lastFrostDOY, crop.seedStartOffsetWeeks);
      }
      if (crop.transplantOffsetWeeks) {
        entry.transplant = buildRange(lastFrostDOY, crop.transplantOffsetWeeks);
      }
      if (crop.directSowOffsetWeeks) {
        entry.directSow = buildRange(lastFrostDOY, crop.directSowOffsetWeeks);
      }
    }

    if (firstFrostDOY != null && crop.fallPlanting) {
      entry.fallPlanting = buildRange(firstFrostDOY, crop.fallPlanting.offsetWeeks);
    }

    return entry;
  });
}

module.exports = {
  computeCalendar,
  // exported for testing / reuse
  toMonthDay,
  monthDayToDOY,
  doyToMonthDay,
  buildRange
};
