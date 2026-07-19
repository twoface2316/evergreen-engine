# Frost Dates & Planting Calendar — Programmatic SEO Site

Working name: **FrostCal** (final domain TBD; deploy to GitHub Pages first).
Goal: ~5,000 rich static city pages (US) with first/last frost dates, USDA hardiness zone, per-crop planting calendar, monthly temp chart. Monetize later (AdSense → Mediavine, Amazon affiliate). Zero hosting cost.

Repo root: `T:\Claude Code\frost-site`
Layout:
```
frost-site/
  PLAN.md
  data/          # raw + intermediate data (gitignored except small final JSON)
  scripts/       # Node.js pipeline scripts (plain JS, no TypeScript)
  site/          # generated static HTML output (deployed)
  templates/     # page templates + CSS
```

Tech constraints:
- Node.js, plain JS, no framework, no build tool beyond `node scripts/*.js`. Zero runtime dependencies preferred; `npm i` allowed only for CSV/tar parsing if needed (e.g. `csv-parse`, `tar`).
- Windows host. Scripts must run via `node` in PowerShell/Git Bash. No symlinks.
- All pages fully static HTML + one shared CSS file + tiny vanilla JS for interactive widget. No client-side data fetching except the countdown widget computing from embedded JSON.
- Fast pages: no external fonts, no external JS, inline critical CSS acceptable. Each page < 100KB HTML.

---

## Phase 1 — Data acquisition + frost-date pipeline

Deliverable: `data/cities-frost.json` — one record per city with frost stats + station metadata.

1. **NOAA 1991–2020 annual/seasonal normals (by station).**
   - Bulk archive directory: `https://www.ncei.noaa.gov/data/normals-annual/1991-2020/archive/` — download the `*multivariate_by-station*.tar.gz` archive (~50MB). List the directory first to get exact filename.
   - Extract. Per-station CSVs contain frost/freeze probability columns, names like `ANN-TMIN-PRBLST-T32FP50` (last spring freeze, 32°F, 50% probability, day-of-year) and `ANN-TMIN-PRBFST-T32FP50` (first fall freeze). Also 10%/90% variants (`P10`, `P90`) and other thresholds (28F, 36F). Inspect one CSV to confirm exact column names before parsing.
   - Keep for each station: lat, lon, elevation, name, state, and for threshold 32F: last-spring-freeze DOY at P10/P50/P90, first-fall-freeze DOY at P10/P50/P90, plus growing-season length if present. Convert DOY to calendar dates (non-leap year).
   - Discard stations missing 32F/P50 values.
2. **Monthly normals (for temp chart).**
   - `https://www.ncei.noaa.gov/data/normals-monthly/1991-2020/archive/` — by-station archive. Extract per-station monthly TMIN/TAVG/TMAX normals (12 values each).
3. **US cities list.**
   - GeoNames `https://download.geonames.org/export/dump/US.zip` (free, CC BY). Filter feature class `P`, population sorted desc, take top ~5,000 (ensure every state has ≥ 20 cities — top up small states if needed). Keep: name, state, lat, lon, population.
4. **Join cities → stations.**
   - Nearest station with valid frost data by haversine distance. Reject match if distance > 80 km or elevation differs > 400 m (mountain-valley mismatch); then try next-nearest. Record station distance in output.
5. **Alaska/Hawaii/tropical edge cases:** stations where no freeze occurs (columns empty/sentinel) → mark city `frostFree: true`.
6. Output `data/cities-frost.json` (array). Also write `data/pipeline-report.txt`: counts (cities matched, dropped, frost-free), distance distribution, spot-check 10 known cities (Chicago last frost ~Apr 20–May 5, Miami frost-free, Denver ~May 5, Phoenix rare, Seattle ~Mar–Apr) and PASS/FAIL each.

Acceptance: ≥ 4,500 cities matched; spot-checks pass; report written.

## Phase 2 — Crop planting engine

Deliverable: `data/crops.json` + `scripts/calendar.js` (pure function).

~40 crops, each: name, category (vegetable/herb/flower), method (`indoor-start`, `direct-sow`, `transplant`), offsets in weeks relative to **last spring frost P50** (e.g. tomato: start indoors -6, transplant +1; peas: direct sow -4), days-to-maturity range, fall-planting rule where applicable (relative to first fall frost). Use standard extension-service guidance (author from general horticultural knowledge; cite "based on university extension guidelines" in UI copy).

`calendar.js`: `computeCalendar(cityRecord, crops)` → per-crop concrete date ranges for that city. Unit-test with 3 cities (node script assert, no test framework).

## Phase 3 — Page template + sample pages

Deliverable: `templates/` + `scripts/render.js` + 5 sample pages in `site/` for review (Chicago IL, Denver CO, Miami FL, Seattle WA, Oswego IL).

Page structure (one page per city, URL `/{state-slug}/{city-slug}/`):
- H1: "Frost Dates & Planting Calendar for {City}, {ST}"
- Summary box: last spring frost (P10/P50/P90 as "safe/typical/risky" framing), first fall frost, growing-season length, USDA zone placeholder (Phase 5 fills), station name + distance ("Data: NOAA station {name}, {X} km away").
- Monthly temp chart: inline SVG generated at build time (TMIN/TAVG/TMAX lines), no JS chart lib.
- Planting calendar table: crop rows, date ranges for start-indoors / sow / transplant / fall planting. Grouped by category.
- Countdown widget: "Days until last expected frost" — tiny inline JS reading embedded JSON, computes from client date.
- FAQ section (3–4 Q/A, city-specific values interpolated) with `FAQPage` JSON-LD. Also `Dataset`/`Place` schema where sensible.
- Nearby cities links (8 nearest same-state cities) — internal linking for SEO.
- Footer: NOAA + GeoNames attribution (CC BY for GeoNames — required), methodology link, "not agronomic advice" note.
- Meta: title ≤ 60 chars, description ≤ 155 chars with real values ("Average last frost in Chicago, IL is April 25...").
- Design: clean, readable, mobile-first, light/dark via `prefers-color-scheme`. One shared `style.css`. No external assets.

Acceptance: 5 sample pages render, valid HTML, chart displays, calendar dates sane.

## Phase 4 — Full generation + site chrome

Deliverable: complete `site/` output.

- Generate all ~5,000 city pages.
- State index pages `/{state-slug}/` listing that state's cities with P50 frost dates (table).
- Homepage: search box (client-side filter over embedded city list JSON, ~150KB gzips fine — or split per-letter), top-100 cities links, explanation of methodology.
- Methodology page (how frost probabilities work, data sources, limitations).
- `sitemap.xml` (split into ≤ 50k-URL files if needed — won't be), `robots.txt`, 404 page.
- Verify: total file count < 15,000; random-sample 20 pages for broken internal links (script check, not manual).

## Phase 5 — USDA hardiness zones

Deliverable: zone field populated on all city pages.

- Preferred: find static 2023 PHZM dataset (ZIP→zone CSV/JSON on GitHub, e.g. from `prism` 2023 map releases). Verify license permits reuse.
- Fallback: `https://phzmapi.org/{zip}.json` per nearest ZIP (GeoNames postal dataset `US.zip` from `download.geonames.org/export/zip/` gives ZIP lat/lon; nearest-ZIP by haversine). Throttle ≤ 5 req/s, cache to `data/zones.json`.
- Re-render pages with zone in summary box + zone-based copy line.

## Phase 6 — Deploy + verify

**Repo naming/structure (multi-niche requirement):** repo name must be niche-generic — this codebase will be replicated across other pSEO niches later. Name the GitHub repo `evergreen-engine` (not frost/weather-specific). Before first commit, restructure for reuse:
```
evergreen-engine/
  engine/            # niche-agnostic: render loop, sitemap, slug utils, SVG chart, link checker
  niches/frost/      # this niche: pipeline scripts, crops.json, templates, niche config (site title, URL base)
  sites/frost/       # generated output for this niche (deployed)
```
Split scripts into engine/ vs niches/frost/ by whether they mention frost/crop concepts. A second niche later = new folder under niches/, reusing engine/.

- `git init`, commit (data/raw gitignored), create public GitHub repo `evergreen-engine` via `gh`, push, enable GitHub Pages serving `sites/frost/` (via Actions artifact deploy, or gh-pages branch containing that folder's contents at root).
- Verify live: fetch 5 city pages + sitemap over HTTP, confirm 200 + content.
- Post-deploy checklist output: Google Search Console setup steps (manual, needs user), domain purchase note, AdSense timing (apply after indexing, ~month 2).

---

## Execution notes
- Phases sequential; each phase = one subagent task (model: sonnet). Phase output on disk is the interface between phases.
- Any phase failing acceptance: fix within phase before moving on.
- Raw NOAA archives stay in `data/raw/` gitignored; final JSONs committed.

## Crop list (Phase 2 input)
Tomato, Pepper, Eggplant, Cucumber, Zucchini, Winter Squash, Pumpkin, Watermelon, Cantaloupe, Corn, Green Bean, Pea, Lettuce, Spinach, Kale, Arugula, Swiss Chard, Broccoli, Cauliflower, Cabbage, Brussels Sprouts, Carrot, Beet, Radish, Turnip, Onion, Garlic (fall), Potato, Sweet Potato, Asparagus, Basil, Cilantro, Parsley, Dill, Oregano, Thyme, Sunflower, Zinnia, Marigold, Cosmos, Nasturtium, Dahlia.
