# Post-deploy checklist

Live site: https://frostcal.com/ (domain purchased July 20, 2026)

## 1. DNS setup (do this at your registrar — one time)

The build already writes `sites/frost/CNAME` containing `frostcal.com` on every render, and GitHub Pages is configured for the custom domain. What remains is DNS.

**Apex records** — create four A records for `frostcal.com` (host `@`), all pointing at GitHub Pages:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Optionally add the IPv6 equivalents (AAAA, host `@`):

```
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
```

**www subdomain** — one CNAME record: host `www` → value `twoface2316.github.io` (with trailing dot if your registrar requires it). GitHub redirects `www` to the apex automatically.

Delete any parking-page A records or "forwarding" the registrar added by default — they conflict.

Propagation is usually minutes, occasionally a few hours. Check with `nslookup frostcal.com`.

**After DNS resolves:** GitHub repo → Settings → Pages → tick **Enforce HTTPS**. The certificate is issued automatically once GitHub sees the DNS pointing at it; the checkbox stays greyed out until then. Don't skip it — HTTP-only hurts rankings and blocks AdSense.

## 2. Google Search Console (redo on the new domain)

The old `twoface2316.github.io/evergreen-engine/` property and its verification file are obsolete — subpath properties don't carry over.

1. https://search.google.com/search-console → Add property → **Domain** (not URL prefix) → `frostcal.com`
2. Verify via DNS TXT record — the Domain property type requires it, and it covers http/https and all subdomains at once. Add the TXT record Google shows you at your registrar, then click Verify.
3. Sitemaps → submit `sitemap.xml` (full URL: `https://frostcal.com/sitemap.xml`). At a domain root this behaves normally — none of the subpath quirks apply.
4. URL Inspection on `https://frostcal.com/` → Request Indexing, to kick off crawling of the link graph.
5. The stale `google2a6f5e5d3842f02f.html` file in `sites/frost/` can be deleted whenever; it's harmless.

Expect weeks, not days, for meaningful indexing of 5,000 pages.

## 3. Monetization timeline

- **Month 0-2:** nothing. Let it index. Adding ads to an unindexed site helps no one.
- **Month 2-3:** apply for Google AdSense once pages are indexed and pulling any impressions. Approval wants: custom domain (subpath github.io often rejected), privacy policy page (done — `/privacy/`), contact page (done — `/contact/`).
- **Month 6+:** if traffic reaches ~10k sessions/mo, apply to Ezoic (low bar) or keep growing toward Mediavine Journey (~10k) / full Mediavine (50k sessions).
- **Anytime:** Amazon Associates links on crop rows (seed-starting trays, row covers, soil thermometers) — contextual, low effort.

## 4. Traffic monitoring

GitHub Pages has no server logs, so traffic visibility comes from two layers:

**Search performance — Google Search Console** (free, no code changes). Once the property is verified (§1), the Performance report shows impressions, clicks, queries, and per-page rankings. This is the primary "is SEO working" dashboard. Check weekly; data lags ~2 days.

**On-site visitors — pick ONE lightweight analytics service** (all work on static sites, one `<script>` tag):

| Service | Cost | Notes |
|---|---|---|
| GoatCounter | Free | Cookie-free, public or private dashboard, easiest start |
| Cloudflare Web Analytics | Free | Cookie-free; natural fit if the domain lands on Cloudflare anyway |
| Plausible | ~$9/mo | Nicest UI; not worth paying until real traffic |

Setup (GoatCounter example): create an account at goatcounter.com → get your site code → add the snippet to the page template (`buildPageShell` in `niches/frost/scripts/render.js` or the footer in `niches/frost/templates/layout.js`) → re-render + push. The privacy policy at `/privacy/` already discloses cookie-free analytics, so no policy change needed.

Skip Google Analytics 4: heavyweight, cookie-consent obligations, overkill for a content site at this stage.

## 5. Redeploy after changes

Any push to `main` redeploys automatically (`.github/workflows/deploy-pages.yml` publishes `sites/frost/`).

Typical loop:
```powershell
node niches/frost/scripts/render.js full
node engine/check-links.js sites/frost
git add -A; git commit -m "..."; git push
```
`SITE_URL` and the CNAME both come from `niches/frost/config.js` now — no env vars needed for a production build.

## 6. Content freshness (SEO maintenance, ~quarterly)

- NOAA normals update every 10 years (next: 2031 for 2001-2030) — pipeline rerun then.
- Add content pages occasionally (e.g. "seed starting guide", per-crop deep pages) — pure static additions under `sites/frost/`.
- Watch Search Console for crawl errors after each deploy.
