'use strict';

/** niches/home/scripts/csv.js — minimal streaming CSV reader (RFC 4180 quoting, one record per line). */

const fs = require('fs');
const readline = require('readline');

function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Calls onRow(object) for every data row; lines starting with '#' are skipped. Resolves with the row count. */
async function streamCsv(file, onRow) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header = null;
  let n = 0;
  for await (const line of rl) {
    if (!line || line.startsWith('#')) continue;
    const v = parseLine(line);
    if (!header) {
      header = v.map((h) => h.replace(/^﻿/, ''));
      continue;
    }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = v[i];
    onRow(row);
    n++;
  }
  return n;
}

module.exports = { parseLine, streamCsv };
