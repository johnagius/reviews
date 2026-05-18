# Pharmacy Review Tracker

Single-page dashboard backed by a Cloudflare Worker + D1 database. The
team's review data (own pharmacy + competitors) lives in D1 so every
viewer of the dashboard sees the same data. Personal UI preferences
(hidden competitor toggles, milestone filter, goals) stay in each
viewer's `localStorage`.

Imports are atomic: re-importing the same pharmacy wipes its existing
reviews and inserts the new ones in a single D1 transaction.

## Architecture

```
index.html (GitHub Pages)
     │
     │  GET  /state                  ← public; serves all pharmacies + reviews
     │  POST /import                 ← X-Pharm-Token; upserts pharmacy + replaces reviews
     │  POST /clear                  ← X-Pharm-Token; wipes everything
     │  DEL  /pharmacy/:placeId      ← X-Pharm-Token; removes one pharmacy
     ▼
Cloudflare Worker (worker-api.js)
     │
     ▼
Cloudflare D1 (pharm-reviews)
     ├── pharmacies(place_id PK, name, is_mine, imported_at)
     └── reviews(id PK, pharmacy_id FK, review_id, date, ago, stars,
                 author, text, lang, likes, has_response, profile_url)
```

## One-time setup (~5 minutes)

You need a Cloudflare account (the free tier covers everything used here).
All commands run in this repo's root.

```bash
npm install

# Create the D1 database. Wrangler prints a database_id — paste it
# into the `database_id` line of wrangler.toml.
npx wrangler d1 create pharm-reviews

# Apply the schema (creates the two tables + indexes).
npm run db:init

# Set the shared write secret. Pick a long random string — the
# dashboard will embed this in its JS to authenticate writes.
npx wrangler secret put PHARM_TOKEN

# Ship the Worker. Wrangler prints a URL like
# https://pharm-api.<your-subdomain>.workers.dev — paste it into
# index.html (API_BASE) and the secret into API_TOKEN. Commit + push.
npx wrangler deploy
```

`index.html` looks for these two constants near the top of its
`<script>` block:

```js
const API_BASE  = 'https://pharm-api.YOUR-SUBDOMAIN.workers.dev';
const API_TOKEN = 'PASTE-YOUR-PHARM_TOKEN-SECRET-HERE';
```

Replace both placeholders with the values you got above, commit
`index.html`, and the dashboard will be live on the GitHub Pages URL.

The token is embedded in the public HTML — anyone who views the source
can find it. That's by design: it stops casual abuse but isn't strong
security. Don't reuse this token anywhere sensitive.

## Day-to-day usage

1. Open the GitHub Pages site.
2. Click **Import mine** to upload your pharmacy's scraper JSON, or
   **Import competitor** to add/refresh a competitor.
3. Re-import the same JSON later to refresh — old reviews are wiped
   and replaced atomically.
4. Click **Clear all** to nuke everything (asks twice).
5. The first time the dashboard loads against an empty D1, it will
   migrate any leftover localStorage data from the pre-D1 version
   automatically (one-time, marked in `localStorage` so it doesn't
   re-upload).

## What you see on the dashboard

- **Headline digest** — auto-picks the most newsworthy fact (catch-up
  alert, recent overtake, rating threshold, milestone, pace).
- **What's changed since your last visit** — events that happened
  after your previous page load.
- **Stat grids** — total, average, Bayesian, 30/90-day counts, span,
  positive/critical %, days since last review / last 1-2★, 12-mo
  trend, current 5★ streak, days without critical, pace.
- **Mid-2024 pivot** — before/after July 1 2024 side-by-side.
- **Competitor comparison** — toggle chips, podium (gold/silver/
  bronze by review count + by Bayesian), ETA-to-overtake cards,
  velocity-ratio strip with ▲/►/▼ acceleration chips, table,
  cumulative chart, lead/gap chart, velocity chart, average-rating
  chart, milestones & crossovers list with filter dropdowns.
- **Single-pharmacy charts** — star distribution, smoothed
  cumulative reviews (with a 12-month forecast extending the curve),
  velocity, reviews per year, average rating over time.
- **Engagement** — text rate, owner response rate, critical-response
  rate, avg text length, total likes, languages.
- **Patterns & records** — YoY, best year, longest 5★ streak,
  longest quiet period, day-of-week table.
- **Goals** — review count goal + Bayesian rating goal, with
  progress bars and projected completion dates.
- **Calculators** — "how long to reach N more reviews" and
  "what rating mix to hit a target".

## Input JSON schema

Top-level: either `{ "<placeId>": [reviews...] }` (one key) or a plain
array. Each review minimally has:

```json
{
  "review_id": "...",
  "author": "...",
  "rating": 5.0,
  "review_text": { "en": "..." },
  "review_date": "2024-03-15T10:00:00+00:00",
  "raw_date": "1 year ago",
  "likes": 0,
  "owner_responses": { "en": { "text": "..." } },
  "is_deleted": 0
}
```

`review_text` may be `{lang: string}`, `{lang: {text: string}}`, or
empty. Reviews with `is_deleted == 1` are skipped. English text is
preferred when multiple languages are present.

## Local development

```bash
npx wrangler dev       # runs the Worker locally against a remote D1
npx wrangler d1 execute pharm-reviews --remote --command "SELECT COUNT(*) FROM reviews"
```

## History

Earlier this project tried scraping Google Maps via a headless-Chromium
Cloudflare Worker. That was abandoned for being fragile, then replaced
with a localStorage-only JSON-import flow, then (this version) backed
by D1 so multiple users share the same dataset. The earlier scraper
code is in git history.
