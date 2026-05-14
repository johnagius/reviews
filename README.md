# Pharmacy Review Tracker

A single-file dashboard that tracks your pharmacy's Google rating + review count against competitors over time, and tells you exactly how many more 5★ reviews you need to hit a target. Runs from `index.html` — no server, no account, no API key.

## Quick start

1. Open `index.html` (or visit the GitHub Pages URL it's hosted at).
2. Hit **Settings** → paste your pharmacies (one per line). Prefix your own with `*`:

   ```
   * Potter's Pharmacy St. Julian's | https://www.google.com/maps/place/Potter's+Pharmacy...
   Competitor A                    | https://www.google.com/maps/place/Competitor+A...
   Competitor B                    | https://www.google.com/maps/place/Competitor+B...
   ```

3. Click **Open all in Maps** — tabs open for every pharmacy.
4. Glance at each Maps panel (rating + total review count). Back in the dashboard, type those numbers into the form rows (one per pharmacy). Optionally paste the 1★/2★/3★/4★/5★ counts too (Maps shows them when you click the rating).
5. Click **Save snapshot**. The dashboard updates: overview, comparison table, history chart, distributions, target calculator.

Repeat weekly (or whenever you want a data point). Two snapshots in, you get 7-day deltas. Several snapshots in, the history chart fills out and the target calculator estimates how long your campaign will take.

Whole loop is under a minute once it's set up.

## What you get

- **Overview**: your rating, total reviews, rank vs competitors, 7-day deltas — visible the moment you save a snapshot.
- **Snapshot form**: pre-filled with last entries, so most weeks it's just bumping a couple of numbers.
- **Comparison table**: sortable, with Δ reviews / Δ rating since 7 days ago.
- **History chart**: review-count timeline per pharmacy, your pharmacy highlighted gold.
- **Star distribution**: 1★–5★ bars per pharmacy (when you enter them).
- **Target calculator**: "to go from 4.7 → 4.8, you need N more 5★ reviews; at your current pace, that's ~M weeks."
- **Bulk paste** (under Settings): paste all rows at once instead of editing per-row.
- **CSV + JSON export** so the data is yours.

## Why no auto-scraping

I tried. Google Maps doesn't include rating/review data in the HTML you get from `fetch()` — the data is loaded by JavaScript after the page hydrates. Even routed through CORS proxies, the response is just the JS app shell with the place name and coordinates, no rating. Public proxies that used to work (`corsproxy.io`) have moved to paid plans; the rest either rate-limit or get served the same useless shell because Google geo-routes from datacenter IPs.

The only ways to actually automate this are:
- Paid APIs (Google Place Details, SerpApi) — works but costs money
- Headless-browser scraping (Puppeteer/Playwright) — needs a server, not a local HTML file
- The Business Profile API — your own pharmacy only, and requires verification

For a free, local, weekly-ish workflow, manual entry beats all of them. Reading four numbers off a Maps tab takes ten seconds; the dashboard does the analytics.

## Notes

- All data lives in `localStorage`. Nothing leaves your browser. Export JSON if you switch devices or browsers.
- Google's terms allow asking real customers for honest reviews; they don't allow incentives or "5-star only" solicitation. A sudden burst of new-account 5★s is exactly what their spam filter looks for — keep the campaign clean.
