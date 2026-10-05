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

## 3. Monetization

Both IDs live in `niches/frost/config.js`. Paste the value, push, and CI rebuilds every page with it. You can make the edit on github.com (open the file, click the pencil, commit). No local tools needed.

### GoatCounter analytics (free, 5 minutes)

1. Go to https://www.goatcounter.com/signup.
2. **Code**: `frostcal` (or anything; this becomes `frostcal.goatcounter.com`). Enter your email and a password, then submit.
3. Set `goatcounterCode: 'frostcal'` (the code you chose) in `niches/frost/config.js` and commit.
4. After the deploy finishes (~2 min), visit https://frostcal.com and then your dashboard at `https://<code>.goatcounter.com`. The visit should appear within a minute.

The privacy policy already discloses cookie-free analytics.

### Google AdSense

1. Go to https://adsense.google.com → **Get started** → sign in with your Google account → site: `frostcal.com` → country → accept the terms.
2. Find your publisher ID: **Account → Settings → Account information → Publisher ID** (looks like `pub-1234567890123456`).
3. Set `adsensePublisherId: 'pub-…'` in `niches/frost/config.js` and commit. This adds the AdSense tag to every page and publishes `https://frostcal.com/ads.txt`.
4. In AdSense: **Sites → frostcal.com** → choose **AdSense code snippet** as the verification method → **Verify** (the tag is already live) → **Request review**.
5. Review takes from a few days up to about 4 weeks. Until approved, no ads show; the tag sits idle.
6. Once approved: **Ads → By site → frostcal.com → Auto ads on**. Google picks placements; nothing else to code.

If AdSense rejects the site ("low value content" is the common reason for programmatic sites), apply to **Ezoic** (no traffic minimum) instead, or reapply after another month of growth.

### Later

- **Amazon Associates**: affiliate links on crop pages (seeds, grow lights, seed-starting trays). Sign up only once traffic is ramping. The account closes if it doesn't make 3 sales within 180 days.
- **Mediavine Journey** (~10k sessions/month) and full **Mediavine** (50k) pay several times what AdSense does. Switch when traffic qualifies.

## 4. Traffic monitoring

- **Google Search Console**: impressions, clicks, queries, rankings. This is the main "is SEO working" dashboard. Check weekly; data lags about 2 days.
- **GoatCounter** (once set up): every visitor, not just Google clicks, plus referrers and which pages people actually read.

## 5. How builds and deploys work

The generated site is **not committed**. `.github/workflows/deploy-pages.yml` renders it in CI and publishes it:

- on every push to `main`
- on the 1st of every month (scheduled), so seasonal copy stays current: city titles and snippets lead with the **first fall frost from August** and the **last spring frost from January**, and quote the current year
- on demand: GitHub → Actions → "Build and deploy frost site" → **Run workflow**

Each run also runs the calendar tests and checks a 300-page sample for broken internal links. A failure stops the deploy and the live site stays on the previous version.

Note: GitHub disables scheduled workflows in repos with no commits for 60 days. The workflow re-enables itself on each scheduled run. If GitHub ever emails that it was disabled anyway, open Actions and click **Enable workflow**.

Files that must sit at the site root verbatim (search-engine verification files and the like) go in `niches/frost/static/`, not `sites/frost/`. Anything placed directly in `sites/` is discarded.

To preview locally:
```powershell
node niches/frost/scripts/render.js full
node engine/check-links.js sites/frost
```

## 6. Content freshness

- NOAA normals update every 10 years (next: 2031 for 2001-2030); rerun the pipeline then.
- Search Console exports (Performance → Export) are the input for improvements: pages at positions 5-20 with high impressions are where title or content changes pay off fastest.
