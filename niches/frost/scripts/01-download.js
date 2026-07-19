// Phase 1 step 1-3: download + extract raw data sources.
// Node.js plain JS, no deps. Uses child_process for curl/tar/unzip (all present on this
// Windows host via Git Bash tooling). Idempotent: skips work when target files already exist.
//
// Sources:
//   NOAA 1991-2020 annual/seasonal normals, by-station multivariate archive
//   NOAA 1991-2020 monthly normals, by-station multivariate archive
//   GeoNames US.zip (all US features)
//
// NOTE: the directory NAMES in the PLAN (normals-annual / normals-monthly) have been
// renamed by NOAA to normals-annualseasonal / normals-monthly (monthly matched already,
// annual did not -- confirmed by listing https://www.ncei.noaa.gov/data/ which redirects
// old "normals-annual" to a 404; the live tree is "normals-annualseasonal"). The archive/
// index page also intermittently returns HTTP 500 (transient NOAA server flakiness, not a
// missing resource) -- retry on failure rather than treating it as a 404.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RAW_DIR = path.join(__dirname, "..", "data", "raw");

const ANNUAL_DIR_URL =
  "https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/archive/";
const MONTHLY_DIR_URL =
  "https://www.ncei.noaa.gov/data/normals-monthly/1991-2020/archive/";
const GEONAMES_URL = "https://download.geonames.org/export/dump/US.zip";

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// Fetch a directory listing (HTML) with retries -- NOAA's server occasionally 500s on
// these index pages transiently; a 200 usually comes back within a few attempts.
function fetchListing(url, attempts = 6) {
  for (let i = 1; i <= attempts; i++) {
    const tmp = path.join(RAW_DIR, "_listing.html");
    const code = sh("curl", [
      "-s",
      "-m",
      "30",
      "-o",
      tmp,
      "-w",
      "%{http_code}",
      url,
    ]);
    if (code.trim() === "200") {
      return fs.readFileSync(tmp, "utf8");
    }
    if (i < attempts) {
      console.log(`  listing ${url} -> HTTP ${code}, retrying (${i}/${attempts})...`);
    }
  }
  throw new Error(`Failed to fetch directory listing at ${url} after ${attempts} attempts`);
}

function findTarGzFilename(html, mustInclude) {
  const hrefRe = /href="([^"]+\.tar\.gz)"/g;
  let m;
  const matches = [];
  while ((m = hrefRe.exec(html))) matches.push(m[1]);
  const hit = matches.find((f) => mustInclude.every((s) => f.includes(s)));
  if (!hit) {
    throw new Error(
      `No .tar.gz filename matching [${mustInclude.join(", ")}] found. Candidates: ${matches.join(", ")}`
    );
  }
  return hit;
}

function downloadFile(url, destPath, minBytes, attempts = 5) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size >= minBytes) {
    console.log(`  already have ${path.basename(destPath)} (${fs.statSync(destPath).size} bytes), skipping`);
    return;
  }
  for (let i = 1; i <= attempts; i++) {
    console.log(`  downloading ${url} (attempt ${i}/${attempts})...`);
    sh("curl", ["-s", "-m", "600", "-o", destPath, "-w", "HTTP %{http_code}\n", url], {
      stdio: "inherit",
    });
    if (fs.existsSync(destPath) && fs.statSync(destPath).size >= minBytes) return;
  }
  throw new Error(`Failed to download ${url} to ${destPath} after ${attempts} attempts`);
}

function extractTarGz(archivePath, destDir) {
  ensureDir(destDir);
  const existing = fs.existsSync(destDir) ? fs.readdirSync(destDir).length : 0;
  if (existing > 100) {
    console.log(`  ${destDir} already has ${existing} files, skipping extraction`);
    return;
  }
  console.log(`  extracting ${archivePath} -> ${destDir}`);
  sh("tar", ["-xzf", archivePath, "-C", destDir]);
}

function extractZip(zipPath, destDir) {
  ensureDir(destDir);
  const existing = fs.existsSync(destDir) ? fs.readdirSync(destDir).length : 0;
  if (existing > 0) {
    console.log(`  ${destDir} already populated, skipping extraction`);
    return;
  }
  console.log(`  extracting ${zipPath} -> ${destDir}`);
  sh("unzip", ["-o", "-q", zipPath, "-d", destDir]);
}

function main() {
  ensureDir(RAW_DIR);

  console.log("=== NOAA annual/seasonal normals (by-station multivariate) ===");
  const annualHtml = fetchListing(ANNUAL_DIR_URL);
  const annualFile = findTarGzFilename(annualHtml, [
    "multivariate_by-station",
  ]);
  const annualUrl = ANNUAL_DIR_URL + annualFile;
  const annualArchivePath = path.join(RAW_DIR, "annual-by-station.tar.gz");
  downloadFile(annualUrl, annualArchivePath, 40_000_000);
  extractTarGz(annualArchivePath, path.join(RAW_DIR, "annual"));

  console.log("=== NOAA monthly normals (by-station multivariate) ===");
  const monthlyHtml = fetchListing(MONTHLY_DIR_URL);
  const monthlyFile = findTarGzFilename(monthlyHtml, [
    "monthly_multivariate_by-station",
  ]);
  const monthlyUrl = MONTHLY_DIR_URL + monthlyFile;
  const monthlyArchivePath = path.join(RAW_DIR, "monthly-by-station.tar.gz");
  downloadFile(monthlyUrl, monthlyArchivePath, 20_000_000);
  extractTarGz(monthlyArchivePath, path.join(RAW_DIR, "monthly"));

  console.log("=== GeoNames US.zip ===");
  const geonamesZipPath = path.join(RAW_DIR, "US.zip");
  downloadFile(GEONAMES_URL, geonamesZipPath, 10_000_000);
  extractZip(geonamesZipPath, path.join(RAW_DIR, "geonames"));

  console.log("Done. Raw data in", RAW_DIR);
}

main();
