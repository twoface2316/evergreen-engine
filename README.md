# evergreen-engine

Static programmatic-SEO site generator. One repo, many niches: shared build tooling in `engine/`, per-niche data pipelines and templates in `niches/<name>/`, generated output in `sites/<name>/`.

First niche: **frost** — frost dates & planting calendars for 5,078 US cities, built from NOAA 1991-2020 climate normals.

Live: https://twoface2316.github.io/evergreen-engine/

## Structure

```
engine/            Niche-agnostic tooling (link checker, shared libs)
niches/frost/      Frost niche
  config.js        Site title, URL defaults, niche settings
  scripts/         Data pipeline (download, build, zones) + render
  templates/       Page layout + stylesheet
  data/            Final JSONs (committed); data/raw/ gitignored (~1.4GB)
sites/frost/       Generated static site (committed, deployed by CI)
```

## Build

```
node niches/frost/scripts/test-calendar.js        # unit tests
node niches/frost/scripts/render.js sample        # 5 sample pages
node niches/frost/scripts/render.js full          # full 5,078-page build
node engine/check-links.js sites/frost --base-path=/evergreen-engine
```

Production render (canonical URLs + subpath links):

```powershell
$env:SITE_URL="https://twoface2316.github.io/evergreen-engine"
$env:BASE_PATH="/evergreen-engine"
node niches/frost/scripts/render.js full
```

Use PowerShell (or `cmd`) for the production render on Windows — Git Bash (MSYS) rewrites the leading-slash `BASE_PATH` into a local filesystem path.

## Deploy

Push to `main` — `.github/workflows/deploy-pages.yml` publishes `sites/frost/` to GitHub Pages. See `DEPLOY.md` for post-deploy checklist (Search Console, custom domain, monetization).

## Adding a niche

1. Copy `niches/frost/` as a starting point; replace pipeline scripts, templates, and `config.js`.
2. Generate into `sites/<name>/`.
3. Add a second Pages deployment (separate repo or path-based routing) — one GitHub Pages site per repo, so a second niche typically means its own repo reusing `engine/` via subtree/copy, or moving to Cloudflare Pages for multi-site hosting.

## Data sources

- NOAA NCEI 1991-2020 US Climate Normals (public domain)
- GeoNames (CC BY 4.0)
- USDA 2023 Plant Hardiness Zone Map via phzmapi.org / frostline ZIP dataset
