'use strict';

/**
 * niches/solar/scripts/01-state-data.js — state-level electricity data.
 *
 *   EIA Electric Power Monthly Table 5.6.B: average residential price,
 *     year-to-date (cents/kWh).
 *   EIA Sales & Revenue Table 5A: average monthly residential consumption
 *     (kWh) and bill.
 *
 * Writes data/states.json keyed by state abbreviation. Raw downloads go to
 * data/raw/ (gitignored). Local-only: uses `tar -xf` to unpack the xlsx,
 * which Windows' bundled bsdtar handles; CI never runs this script.
 *
 *   node niches/solar/scripts/01-state-data.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { STATE_NAMES } = require('./states.js');

const DATA = path.join(__dirname, '..', 'data');
const RAW = path.join(DATA, 'raw');
const UA = { 'User-Agent': 'Mozilla/5.0 (evergreen-engine data pipeline)' };

const PRICE_URL = 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_b';
const USAGE_URL = 'https://www.eia.gov/electricity/sales_revenue_price/xls/table_5A.xlsx';

const NAME_TO_ABBR = Object.fromEntries(Object.entries(STATE_NAMES).map(([a, n]) => [n, a]));

async function download(url, file) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/** Table 5.6.B: first numeric column after the state name = residential, current YTD. */
function parsePrices(html) {
  const asOf = (/Year-to-Date through (\w+ \d{4})/.exec(html) || [])[1] || null;
  const prices = {};
  for (const row of html.split(/<tr[\s>]/i)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    if (cells.length < 3) continue;
    const abbr = NAME_TO_ABBR[cells[0]];
    const v = parseFloat(cells[1]);
    if (abbr && Number.isFinite(v)) prices[abbr] = v;
  }
  return { asOf, prices };
}

/** Minimal xlsx reader: shared strings + first sheet, cell values by ref. */
function readXlsx(file, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  // Windows' bsdtar reads zip; Git Bash's GNU tar (if first on PATH) does not.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar';
  execFileSync(tar, ['-xf', file, '-C', outDir]);
  const sst = fs.readFileSync(path.join(outDir, 'xl', 'sharedStrings.xml'), 'utf8');
  const strings = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')
  );
  const sheet = fs.readFileSync(path.join(outDir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  const rows = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([^<]*)<\/v>)?/g)) {
      const [, col, attrs, v] = c;
      if (v == null) continue;
      row[col] = /t="s"/.test(attrs) ? strings[Number(v)] : Number(v);
    }
    rows.push(row);
  }
  return { title: strings[0], rows };
}

function parseUsage(xlsx) {
  const year = (/(\d{4})/.exec(xlsx.title) || [])[1] || null;
  const usage = {};
  for (const row of xlsx.rows) {
    const abbr = NAME_TO_ABBR[row.A];
    if (abbr && typeof row.C === 'number') {
      usage[abbr] = { monthlyKwh: Math.round(row.C), monthlyBill: Math.round(row.E * 100) / 100 };
    }
  }
  return { year, usage };
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const priceFile = path.join(RAW, 'eia-epm-5-6-b.html');
  const usageFile = path.join(RAW, 'eia-table-5a.xlsx');
  await download(PRICE_URL, priceFile);
  await download(USAGE_URL, usageFile);

  const { asOf, prices } = parsePrices(fs.readFileSync(priceFile, 'utf8'));
  const { year, usage } = parseUsage(readXlsx(usageFile, path.join(RAW, 'table-5a')));

  const states = {};
  const missing = [];
  for (const abbr of Object.keys(STATE_NAMES)) {
    if (prices[abbr] == null || usage[abbr] == null) {
      missing.push(abbr);
      continue;
    }
    states[abbr] = { priceCents: prices[abbr], ...usage[abbr] };
  }
  if (missing.length) throw new Error(`missing EIA data for: ${missing.join(', ')}`);

  const out = {
    priceSource: `EIA Electric Power Monthly, Table 5.6.B (residential, year-to-date through ${asOf})`,
    priceAsOf: asOf,
    usageSource: `EIA ${year} Average Monthly Bill - Residential (Form EIA-861)`,
    usageYear: year,
    states
  };
  fs.writeFileSync(path.join(DATA, 'states.json'), JSON.stringify(out, null, 1) + '\n');
  const p = Object.values(states).map((s) => s.priceCents);
  console.log(`states.json: ${Object.keys(states).length} states, price ${Math.min(...p)}-${Math.max(...p)} c/kWh, as of ${asOf}; usage year ${year}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
