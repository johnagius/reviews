# Pharmacy Review Tracker

Single-page dashboard that auto-tracks your pharmacy's Google rating + review count + 1★–5★ distribution against competitors over time, and tells you exactly how many more 5★ reviews you need to hit a target rating.

Refresh is fully automated — click one button, the dashboard scrapes every Maps page invisibly via a Cloudflare Worker running real headless Chromium, returns clean JSON, and updates. No copy/paste, no opening tabs.

## How it works

```
index.html (browser, localStorage)
       │
       └──fetch──▶  your Cloudflare Worker  ──▶  headless Chromium
                          │                          │
                          │                          ▼
                          │                    Google Maps place page
                          │                  (JS hydrates, DOM populates)
                          ▼                          │
                    DOM extraction  ◀────────────────┘
                          │
                          ▼
            JSON: { rating, reviewCount, dist }
```

The Worker is yours, running in your Cloudflare account. The dashboard only talks to your Worker. Nothing else leaves your browser.

## Setup (one-time, ~3 minutes)

### Option A — CLI (recommended)

```bash
# In the cloned repo:
npm install
npx wrangler login        # opens browser, one-time
npx wrangler deploy       # ships worker.js with the BROWSER binding
```

`wrangler deploy` prints the live URL (e.g. `https://pharm-scraper.<you>.workers.dev`). Paste it into the dashboard's yellow setup banner → **Save and refresh**.

Your account needs to be on the [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/) ($5/month) for the Browser Rendering binding. The free 10 min/day Browser Rendering quota is plenty for a few pharmacies refreshed weekly.

### Option B — Dashboard (no CLI)

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create Worker**. Name it (e.g. `pharm-scraper`), deploy the stub.
2. Open the Worker → **Edit code** → paste `worker.js` from this repo → **Save and deploy**.
3. Worker → **Settings** → **Bindings** → **Add** → **Browser Rendering**, variable name `BROWSER`.
4. Copy the deployed URL into the dashboard's setup banner.

## Adding more pharmacies

**Settings** → paste one pharmacy per line, format `name | google-maps-url`. Prefix your own with `*`:

```
* Potter's Pharmacy St. Julian's | https://www.google.com/maps/place/...
Competitor A                    | https://www.google.com/maps/place/...
Competitor B                    | https://www.google.com/maps/place/...
```

Save. Click **Refresh all**.

## What you get

- **Overview** cards: your rating, total reviews, rank by rating, rank by reviews — all with 7-day deltas.
- **Comparison table**: sortable, with Δ reviews / Δ rating since 7 days ago.
- **History chart**: review-count timeline per pharmacy, your pharmacy highlighted gold.
- **Star distribution**: 1★–5★ bars per pharmacy (extracted automatically when the Worker can open the rating panel).
- **Target calculator**: "to go from 4.7 → 4.8, you need N more 5★ reviews; at your current pace, that's ~M weeks."
- **CSV + JSON export**, **JSON import** for migrating between browsers.

## Local dev for the Worker (optional)

If you want to iterate on the Worker locally:

```bash
npm install -g wrangler
npm install @cloudflare/puppeteer
wrangler login
wrangler dev      # local preview at http://localhost:8787
wrangler deploy   # ship to production
```

The bundled `wrangler.toml` already wires the `BROWSER` binding.

## Notes

- All snapshots and the pharmacy list live in `localStorage`. Export JSON if you switch devices.
- The Worker is host-locked to google.com so nobody else can use it as an open scraper.
- Google's terms allow asking real customers for honest reviews; they don't allow incentives or "5-star only" solicitation. A sudden burst of new-account 5★s is exactly what their spam filter looks for.
- If you don't want to pay for Workers Paid: open **Settings** → **Manual entry** to type ratings in by hand. The rest of the dashboard (history, comparison, target calc) works either way.
