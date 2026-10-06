# evergreen-engine

Static programmatic-SEO site generator. One repo, many niches: shared build tooling in `engine/`, per-niche data pipelines and templates in `niches/<name>/`, generated output in `sites/<name>/`.

First niche: **frost** — frost dates & planting calendars for 5,078 US cities, built from NOAA 1991-2020 climate normals.

Live: https://frostcal.com/

## Structure

```
engine/            Niche-agnostic tooling (link checker, shared libs)
niches/frost/      Frost niche
  config.js        Site title, URL defaults, niche settings
  scripts/         Data pipeline (download, build, zones, folds) + render
                   06-folds.js: neighborhoods (Harlem, Koreatown) -> parent city, writes data/folds.json
                   render.js: city, state, home, static pages
                   guide-pages.js: zone pages, crop-by-state guides, ZIP lookup data
  templates/       Page layout + stylesheet
  data/            Final JSONs + zipcodes.csv (committed); data/raw/ gitignored (~1.4GB)
  static/          Files copied verbatim to the site root (verification files etc.)
sites/frost/       Generated static site (gitignored; built by CI)
niches/solar/      Solar niche: cost, payback and savings for 4,807 US places
  scripts/         01-state-data (EIA), 02-cities (from frost list), 03-pvwatts
                   (cached API results), model.js (economics), render.js
sites/solar/       Generated solar site (gitignored; built by Cloudflare Pages)
```

### Solar niche

```
node niches/solar/scripts/01-state-data.js      # EIA prices + usage -> data/states.json
node niches/solar/scripts/02-cities.js          # city list from niches/frost/data
NREL_API_KEY=... node niches/solar/scripts/03-pvwatts.js all   # ~5 h, resumable
node niches/solar/scripts/test-model.js
node niches/solar/scripts/render.js full        # sites/solar/
```

Hosted on Cloudflare Pages (build command `node niches/solar/scripts/test-model.js && node niches/solar/scripts/render.js full`, output `sites/solar`). The frost GitHub Pages workflow ignores `niches/solar/**` pushes.

### Home (water + radon) niche

Tap water utility, EPA violations, lead/copper, hardness and radon zone per place. Raw inputs (gitignored, `niches/home/data/raw/`): EPA ECHO `SDWA_latest_downloads.zip` unzipped, `radon-zones.json` (EPA), `water-hardness.csv` (TapWaterData, CC BY 4.0), `counties-fips.geojson` (plotly/datasets, pre-2022 Census counties).

```
node niches/home/scripts/01-cities.js     # solar city list + county (GeoNames, boundary fallback)
node niches/home/scripts/02-water.js      # utilities, violations, lead/copper -> data/water.json
node niches/home/scripts/03-radon.js      # county radon zones
node niches/home/scripts/04-hardness.js   # hardness by city
node niches/home/scripts/test-model.js
node niches/home/scripts/render.js        # sites/home/ (`sample` for 8 cities)
```

Cloudflare Pages: build command `node niches/home/scripts/test-model.js && node niches/home/scripts/render.js`, output `sites/home`.

## Build

```
node niches/frost/scripts/test-calendar.js        # unit tests
node niches/frost/scripts/render.js sample        # 5 sample pages
node niches/frost/scripts/render.js full          # full ~7,300-page build
node engine/check-links.js sites/frost
```

The frost niche serves from a domain root (`frostcal.com`), so no `BASE_PATH` is needed and `SITE_URL` defaults to the production origin in `niches/frost/config.js` — a plain `render.js full` produces a deployable build.

Sub-path deploys (e.g. a GitHub Pages *project* page) still work via env vars, but must be run from PowerShell — Git Bash (MSYS) rewrites a leading-slash `BASE_PATH` into a local filesystem path:

```powershell
$env:SITE_URL="https://user.github.io/repo"; $env:BASE_PATH="/repo"
node niches/frost/scripts/render.js full
```

## Deploy

Push to `main`. `.github/workflows/deploy-pages.yml` renders the site in CI, runs the tests and link check, and publishes `sites/frost/` to GitHub Pages. It also rebuilds monthly so seasonal titles stay current. See `DEPLOY.md` for analytics/AdSense setup and the build model.

## Adding a niche

1. Copy `niches/frost/` as a starting point; replace pipeline scripts, templates, and `config.js`.
2. Generate into `sites/<name>/`.
3. Add a second Pages deployment (separate repo or path-based routing) — one GitHub Pages site per repo, so a second niche typically means its own repo reusing `engine/` via subtree/copy, or moving to Cloudflare Pages for multi-site hosting.

## Data sources

- NOAA NCEI 1991-2020 US Climate Normals (public domain)
- GeoNames (CC BY 4.0)
- USDA 2023 Plant Hardiness Zone Map via phzmapi.org / frostline ZIP dataset
