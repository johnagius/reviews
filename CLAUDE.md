# Repository instructions for Claude

## Branch workflow

**Always push directly to `main`.** Do not create feature branches, do not open
pull requests unless explicitly asked. This repo is served by GitHub Pages from
`main`, so updates only go live when committed there.

This is a durable, standing authorization — do not ask for confirmation before
pushing to `main` on this repo. Treat it the same way you'd treat any other
non-destructive routine action.

If a session starts on a feature branch (because the harness preselected one),
fast-forward it into `main` and push `main`.

## Project

Single-page dashboard (`index.html`) — a Google reviews analytics tool for
the owner's pharmacy. The user imports a JSON file produced by an external
Google Reviews scraper and the dashboard renders the statistics + timeline +
charts entirely client-side. State lives in `localStorage`.

The dashboard is self-contained: open `index.html` in a browser, click
**Import JSON**, every chart updates from the imported review data. No
server, no scraper, no API calls.

Live files in the repo:

- `index.html` — the dashboard, served by GitHub Pages from `main`
- `potters_google_reviews.json` — sample/current data (the user's actual
  pharmacy reviews, ~195 reviews with exact ISO dates)
- `README.md` + `CLAUDE.md` — docs

Keep `index.html` self-contained — no build step, no external runtime deps.
That's what makes it work as a GitHub Pages site with zero configuration.

## User workflow

The user is on **Windows** (`cmd.exe`, e.g. `C:\Users\Potte>` prompt) and
**does not use git locally**. The dashboard is purely client-side now —
they never need to run a deploy, push code, or touch a CLI. The only steps:

1. Open the GitHub Pages site (or `index.html` locally) in a browser.
2. Click **Import JSON** and pick the latest scraper output.

GitHub Pages auto-serves `index.html` from `main` within ~1 minute of any
push, so dashboard changes are live without any action from the user. **No
Worker redeploy. No `wrangler deploy`. No `npm install`.** Don't suggest any
of those.

After every commit that touches `index.html`, end the reply with a short
"Hard-refresh the dashboard (Ctrl+Shift+R) once GitHub Pages serves the new
build (~1 min)". Don't include any deploy or CLI commands.

## Input JSON schema

The dashboard accepts JSON in this shape (produced by the external scraper):

```json
{
  "hash:<placeId>": [
    {
      "review_id": "...",
      "author": "...",
      "rating": 5.0,
      "review_text": { "en": "..." } | { "en": { "text": "..." } } | {},
      "review_date": "2024-03-15T10:00:00+00:00",
      "raw_date": "1 year ago",
      "likes": 0,
      "owner_responses": { "en": { "text": "..." } } | {},
      "is_deleted": 0,
      "profile_url": "..."
    }
  ]
}
```

The top-level can also be a plain array of reviews (no wrapper key). Reviews
with `is_deleted == 1` are skipped. Only `review_date`, `rating`, and `author`
are strictly required.

## History

This project used to scrape Google Maps via a Cloudflare Worker running
headless Chromium. That was abandoned in favour of the external-scraper +
JSON-import flow because the scraping was fragile, expensive in Browser
Rendering minutes, and routinely broken by Google's UI changes / limited-view
serving. The Worker code is in git history if anyone wants to resurrect it.
