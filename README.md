# Pharmacy Review Tracker

A single-file dashboard that compares your pharmacy against competitors on Google Maps. No server, no API key, no account.

## Quick start

1. Download `index.html`.
2. Open it in your browser — that's it. It auto-refreshes once on first load.
3. Click **Settings** → paste your pharmacy URLs (one per line), prefix your own pharmacy with `*`:

   ```
   * Potter's Pharmacy | https://www.google.com/maps/place/Potter's+Pharmacy...
   Competitor A       | https://www.google.com/maps/place/Competitor+A...
   Competitor B       | https://www.google.com/maps/place/Competitor+B...
   ```

4. Click **Refresh all**. The dashboard pulls each Maps page through a free CORS proxy, extracts rating + review count + (when present) the 1–5★ distribution, and stores a daily snapshot in `localStorage`.

Hit **Refresh all** weekly. The history chart fills in over time.

## What you get

- **Overview**: your rating, total reviews, rank vs competitors, 7-day deltas.
- **Comparison table**: sortable, with Δ reviews / Δ rating since a week ago.
- **History chart**: review-count timeline per pharmacy (your pharmacy highlighted).
- **Star distribution**: when Maps exposes it in the page, the 1–5★ bars show up.
- **Target calculator**: "to go from 4.7 → 4.8, you need N more 5★ reviews; at your current pace, that's ~M weeks."
- **CSV/JSON export** so the data is yours.

## Why this works (and why my first answer was wrong)

CORS is a browser-policy rule, not a network rule. The local HTML can't fetch `google.com` directly because the browser blocks the read — but a tiny proxy that fetches the page server-side and returns it with `Access-Control-Allow-Origin: *` works fine. The Maps HTML response contains the place data embedded in a JSON blob, so a few targeted regexes are enough to extract rating + review count.

Defaults to **corsproxy.io** (free, no signup). Falls back to allorigins.win or codetabs.com. For reliability, deploy your own (below).

## Self-host the proxy (optional, recommended)

Public proxies are rate-limited. `proxy-worker.js` is a ~30-line Cloudflare Worker that gives you 100k requests/day free, restricted to Google Maps hosts so nobody else can abuse it.

1. https://dash.cloudflare.com → Workers & Pages → Create → Worker.
2. Paste `proxy-worker.js` → Save and deploy.
3. Copy the worker URL.
4. In the dashboard: Settings → CORS proxy → Custom → `https://your-worker.workers.dev/?url={url}`.

## When scraping fails

Google occasionally changes the page structure. If a row shows "no data — refresh" repeatedly:

1. Try a different proxy under Settings.
2. Or fill the **Manual data** field (one line per pharmacy):
   ```
   Potter's Pharmacy | 4.7 | 348 | 12,4,8,31,293
   ```
   Manual entries override scraped values and still get snapshotted on refresh, so your history still grows.

## Notes

- Everything stays on your machine — `localStorage` only. Nothing is sent anywhere except the proxy you configure.
- Use this for private benchmarking. Don't republish competitor review text.
- Google's terms allow asking real customers for honest reviews; they don't allow incentives or "5-star only" solicitation. Keep your campaign clean — a sudden burst of 5★s from new accounts is exactly what their spam filters look for.
