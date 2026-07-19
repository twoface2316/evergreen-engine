# Post-deploy checklist

Live site: https://twoface2316.github.io/evergreen-engine/

## 1. Google Search Console (do this first — indexing is the whole game)

1. https://search.google.com/search-console → Add property → URL prefix → `https://twoface2316.github.io/evergreen-engine/`
2. Verify via HTML file: download the token file Google gives you, drop it in `sites/frost/`, commit + push (auto-redeploys), click Verify.
3. Sitemaps → submit `https://twoface2316.github.io/evergreen-engine/sitemap.xml`.
4. Expect slow initial crawl for a new site on a github.io subpath: weeks, not days. Check Coverage report weekly.

## 2. Custom domain (recommended before serious SEO investment)

A github.io subpath ranks worse and can't be moved without losing accumulated equity. Buy the domain early.

1. Buy a domain (Cloudflare Registrar or Porkbun, ~$10/yr). Niche-relevant beats brandable here, e.g. frost/planting themed.
2. GitHub repo → Settings → Pages → Custom domain → enter it; add the CNAME DNS record (`www` → `twoface2316.github.io`) plus apex ALIAS/A records per GitHub docs. Enforce HTTPS.
3. Rerender with the new URL and push:
   ```powershell
   $env:SITE_URL="https://www.yourdomain.com"; Remove-Item Env:BASE_PATH -ErrorAction SilentlyContinue
   node niches/frost/scripts/render.js full
   ```
   (Custom domain serves from root — no BASE_PATH needed.)
4. Re-add the property in Search Console under the new domain and resubmit the sitemap.

## 3. Monetization timeline

- **Month 0-2:** nothing. Let it index. Adding ads to an unindexed site helps no one.
- **Month 2-3:** apply for Google AdSense once pages are indexed and pulling any impressions. Approval wants: custom domain (subpath github.io often rejected), privacy policy page, contact page — add these before applying.
- **Month 6+:** if traffic reaches ~10k sessions/mo, apply to Ezoic (low bar) or keep growing toward Mediavine Journey (~10k) / full Mediavine (50k sessions).
- **Anytime:** Amazon Associates links on crop rows (seed-starting trays, row covers, soil thermometers) — contextual, low effort.

## 4. Redeploy after changes

Any push to `main` redeploys automatically (`.github/workflows/deploy-pages.yml` publishes `sites/frost/`).

Typical loop:
```powershell
$env:SITE_URL="https://twoface2316.github.io/evergreen-engine"; $env:BASE_PATH="/evergreen-engine"
node niches/frost/scripts/render.js full
node engine/check-links.js sites/frost --base-path=/evergreen-engine
git add -A; git commit -m "..."; git push
```
Use PowerShell for the render — Git Bash mangles `BASE_PATH`.

## 5. Content freshness (SEO maintenance, ~quarterly)

- NOAA normals update every 10 years (next: 2031 for 2001-2030) — pipeline rerun then.
- Add content pages occasionally (e.g. "seed starting guide", per-crop deep pages) — pure static additions under `sites/frost/`.
- Watch Search Console for crawl errors after each deploy.
