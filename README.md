# Pharmacy Review Tracker

Single-page dashboard that reads a JSON export of your Google reviews and
turns it into rich statistics, charts, and a precise per-review timeline.

Pure client-side — no server, no scraper to maintain. You drop in a fresh
JSON whenever you want to refresh; every chart re-renders from the imported
data.

## What you get

- **Stat cards**: total reviews, average rating, last-30-day and last-90-day
  velocity, time span (years covered).
- **Star distribution**: percentage breakdown of 1★–5★.
- **Cumulative reviews over time**: smooth growth curve, one colored dot per
  review on the line (hover for date + author + stars).
- **Reviews per year**: stacked bar chart by star rating.
- **Average rating over time**: 12-month trailing average line.
- **Engagement**: percentage of reviews with written text, owner response
  rate, total likes received, language breakdown.
- **Top reviewers**: most-liked reviews with excerpts.
- **Recent reviews**: latest 10 in card form (stars, text, response status).
- **Target calculator**: "to go from 4.50 → 4.80 at avg incoming 5.0★, you
  need N more reviews, ~M weeks at current pace."

## Usage

1. Open the dashboard (GitHub Pages site or `index.html` locally).
2. Click **Import JSON**, pick your scraper output. All charts populate.
3. Re-import any time to refresh.
4. **Export JSON** to back up the current state. **Clear** to wipe.

A sample dataset is in the repo: `potters_google_reviews.json`.

## Input format

Top-level either a single-key object `{ "hash:<placeId>": [reviews...] }` or
a plain array. Each review object should have at minimum:

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

`review_text` can be a `{lang: string}` map, a `{lang: {text: string}}` map,
or empty. Reviews with `is_deleted == 1` are skipped. The dashboard prefers
English text when multiple languages are present.

## History

Earlier versions of this project scraped Google Maps live via a Cloudflare
Worker running headless Chromium. That approach proved too fragile (Google
UI changes, IP-based "limited view" serving, Browser Rendering quota costs)
and was replaced with this JSON-import flow.
