'use strict';

/**
 * test-calendar.js — plain node `assert` tests for scripts/calendar.js.
 * No test framework. Run with: node scripts/test-calendar.js
 */

const assert = require('assert');
const path = require('path');
const { computeCalendar, monthDayToDOY } = require('./calendar.js');
const crops = require(path.join(__dirname, '..', 'data', 'crops.json'));

let passed = 0;
function check(label, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${label}`);
  } catch (err) {
    console.error(`FAIL: ${label}`);
    console.error(`      ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------
// Synthetic city records.
// Percentile convention (see calendar.js header comment): p10 is the
// chronologically LATEST date, p90 the EARLIEST, p50 the median.
// ---------------------------------------------------------------------

const chicagoLike = {
  name: 'Chicago-like Test City',
  frostFree: false,
  lastFrost: {
    p90: { month: 4, day: 18 },
    p50: { month: 4, day: 25 },
    p10: { month: 5, day: 2 }
  },
  firstFrost: {
    p90: { month: 10, day: 8 },
    p50: { month: 10, day: 15 },
    p10: { month: 10, day: 22 }
  }
};

const denverLike = {
  name: 'Denver-like Test City',
  frostFree: false,
  lastFrost: {
    p90: { month: 4, day: 28 },
    p50: { month: 5, day: 5 },
    p10: { month: 5, day: 12 }
  },
  firstFrost: {
    p90: { month: 9, day: 24 },
    p50: { month: 10, day: 1 },
    p10: { month: 10, day: 8 }
  }
};

const miamiLike = {
  name: 'Miami-like Test City',
  frostFree: true
  // No lastFrost/firstFrost fields at all — mirrors how Phase 1 is
  // expected to represent a station with no measurable freeze.
};

// ---------------------------------------------------------------------
// Basic sanity: computeCalendar runs without crashing for all 3 cities
// and returns one entry per crop.
// ---------------------------------------------------------------------

let chicagoResult, denverResult, miamiResult;

check('computeCalendar runs for Chicago-like city without crashing', () => {
  chicagoResult = computeCalendar(chicagoLike, crops);
  assert.strictEqual(chicagoResult.length, crops.length);
});

check('computeCalendar runs for Denver-like city without crashing', () => {
  denverResult = computeCalendar(denverLike, crops);
  assert.strictEqual(denverResult.length, crops.length);
});

check('computeCalendar runs for frost-free Miami-like city without crashing', () => {
  miamiResult = computeCalendar(miamiLike, crops);
  assert.strictEqual(miamiResult.length, crops.length);
});

// ---------------------------------------------------------------------
// Tomato transplant lands late April - early May for Chicago-like
// (last frost P50 = Apr 25, transplant offset [1,2] weeks after).
// ---------------------------------------------------------------------

check('Chicago-like: tomato transplant window falls in late Apr - early May', () => {
  const tomato = chicagoResult.find((c) => c.slug === 'tomato');
  assert.ok(tomato, 'tomato entry should exist');
  assert.ok(tomato.transplant, 'tomato should have a transplant date range');

  const windowStartDOY = monthDayToDOY(4, 20); // late April floor
  const windowEndDOY = monthDayToDOY(5, 15);   // early May ceiling
  const startDOY = monthDayToDOY(tomato.transplant.startMonth, tomato.transplant.startDay);
  const endDOY = monthDayToDOY(tomato.transplant.endMonth, tomato.transplant.endDay);

  assert.ok(
    startDOY >= windowStartDOY && endDOY <= windowEndDOY,
    `expected transplant window within Apr 20 - May 15, got ${tomato.transplant.label}`
  );
  // Sanity on direction: transplant should be AFTER last frost P50 (Apr 25).
  assert.ok(startDOY > monthDayToDOY(4, 25), 'transplant start should be after last frost P50');
});

// ---------------------------------------------------------------------
// Garlic fall planting lands late September for Chicago-like
// (first frost P50 = Oct 15, fall offset [-4,-2] weeks before).
// ---------------------------------------------------------------------

check('Chicago-like: garlic fall planting window falls in September', () => {
  const garlic = chicagoResult.find((c) => c.slug === 'garlic');
  assert.ok(garlic, 'garlic entry should exist');
  assert.ok(garlic.fallPlanting, 'garlic should have a fallPlanting date range');
  assert.strictEqual(garlic.seedStart, null, 'garlic has no spring seed-start');
  assert.strictEqual(garlic.transplant, null, 'garlic has no spring transplant');
  assert.strictEqual(garlic.directSow, null, 'garlic has no spring direct-sow');

  const windowStartDOY = monthDayToDOY(9, 10);
  const windowEndDOY = monthDayToDOY(10, 5);
  const startDOY = monthDayToDOY(garlic.fallPlanting.startMonth, garlic.fallPlanting.startDay);
  const endDOY = monthDayToDOY(garlic.fallPlanting.endMonth, garlic.fallPlanting.endDay);

  assert.ok(
    startDOY >= windowStartDOY && endDOY <= windowEndDOY,
    `expected garlic fall window within Sep 10 - Oct 5, got ${garlic.fallPlanting.label}`
  );
  // Sanity: should be before first frost P50 (Oct 15).
  assert.ok(endDOY < monthDayToDOY(10, 15), 'garlic fall window should end before first frost P50');
});

// ---------------------------------------------------------------------
// Frost-free city: no crash, sensible output — every crop gets a
// frostFreeNote and no frost-relative date ranges are fabricated.
// ---------------------------------------------------------------------

check('Miami-like (frostFree): every crop has a frostFreeNote and no date ranges', () => {
  for (const entry of miamiResult) {
    assert.strictEqual(entry.seedStart, null, `${entry.slug} seedStart should be null`);
    assert.strictEqual(entry.transplant, null, `${entry.slug} transplant should be null`);
    assert.strictEqual(entry.directSow, null, `${entry.slug} directSow should be null`);
    assert.strictEqual(entry.fallPlanting, null, `${entry.slug} fallPlanting should be null`);
    assert.strictEqual(typeof entry.frostFreeNote, 'string');
    assert.ok(entry.frostFreeNote.length > 0, `${entry.slug} frostFreeNote should be non-empty`);
  }
});

check('Miami-like (frostFree): warm-season crop note differs from cold-hardy crop note', () => {
  const tomato = miamiResult.find((c) => c.slug === 'tomato');
  const garlic = miamiResult.find((c) => c.slug === 'garlic');
  assert.notStrictEqual(tomato.frostFreeNote, garlic.frostFreeNote);
});

// ---------------------------------------------------------------------
// Cross-city sanity: Denver's last frost (May 5) is later than Chicago's
// (Apr 25), so Denver's tomato transplant window should start later too.
// ---------------------------------------------------------------------

check('Denver-like tomato transplant starts later than Chicago-like (later last frost)', () => {
  const chicagoTomato = chicagoResult.find((c) => c.slug === 'tomato');
  const denverTomato = denverResult.find((c) => c.slug === 'tomato');
  const chicagoStartDOY = monthDayToDOY(chicagoTomato.transplant.startMonth, chicagoTomato.transplant.startDay);
  const denverStartDOY = monthDayToDOY(denverTomato.transplant.startMonth, denverTomato.transplant.startDay);
  assert.ok(denverStartDOY > chicagoStartDOY, 'Denver transplant start should be later than Chicago');
});

// ---------------------------------------------------------------------
// Every crop across both frost cities should produce at least one
// non-null planting method (seedStart, transplant, directSow, or
// fallPlanting) — i.e. no crop silently falls through with nothing.
// ---------------------------------------------------------------------

check('Chicago-like: every crop has at least one populated planting window', () => {
  for (const entry of chicagoResult) {
    const hasSomething = entry.seedStart || entry.transplant || entry.directSow || entry.fallPlanting;
    assert.ok(hasSomething, `${entry.slug} has no planting window at all`);
  }
});

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------

const total = passed + (process.exitCode ? 1 : 0); // not exact count of failures, just signal
console.log(`\n${passed} check(s) passed.`);
if (process.exitCode) {
  console.error('Some checks FAILED.');
} else {
  console.log('All checks passed.');
}
