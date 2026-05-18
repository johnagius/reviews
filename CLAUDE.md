# Repository instructions for Claude

## Branch workflow

**Always push directly to `main`.** Do not create feature branches, do not open
pull requests unless explicitly asked. GitHub Pages serves `index.html` from
`main`; updates go live within ~1 minute.

This is a durable, standing authorization — do not ask for confirmation before
pushing to `main` on this repo. Treat it the same way you'd treat any other
non-destructive routine action.

If a session starts on a feature branch (because the harness preselected one),
fast-forward it into `main` and push `main`.

## Project

Single-page Google reviews analytics dashboard for the owner's pharmacy.
Shared review data is stored in a Cloudflare D1 database, fronted by a
small Cloudflare Worker (`worker-api.js`). The dashboard (`index.html`)
fetches `/state` on load and POSTs new imports to `/import`. Per-user
preferences (hidden competitor toggles, filter selections, goal targets,
last-viewed timestamp) stay in each browser's `localStorage`.

Live files in the repo:

- `index.html` — the dashboard, served by GitHub Pages from `main`. Has
  two `const`s near the top of its `<script>` block that the user must
  set after deploying the Worker: `API_BASE` and `API_TOKEN`.
- `worker-api.js` — Cloudflare Worker that talks to D1.
- `migrations/0001_init.sql` — D1 schema (pharmacies + reviews tables).
- `wrangler.toml` + `package.json` — deploy config for the Worker.
- `potters_google_reviews.json`, `medina_*`, `melita_*` — sample
  scraper outputs (also useful as local test fixtures).
- `README.md` + `CLAUDE.md` — docs.

Keep `index.html` self-contained — no build step, no external runtime deps.
That's what makes it work as a GitHub Pages site with zero configuration.

## User workflow

The user is on **Windows** (`cmd.exe`, e.g. `C:\Users\Potte>` prompt) and
**does not use git locally** — they download a zip from GitHub when they
need to redeploy the Worker. Dashboard-only changes need no user action;
GitHub Pages picks them up automatically. Worker-only changes need a
zip-download + `npx wrangler deploy`.

### Worker redeploy block (use this verbatim when `worker-api.js`,
`wrangler.toml`, `package.json`, or `migrations/*.sql` changes)

```
cd %USERPROFILE%\Downloads
del reviews-main.zip
rmdir /S /Q reviews-main
curl -L -o reviews-main.zip https://github.com/johnagius/reviews/archive/refs/heads/main.zip
tar -xf reviews-main.zip
cd reviews-main
npm install
npx wrangler deploy
```

If the schema (`migrations/*.sql`) changed, the user also needs to run
`npm run db:init` (which executes the migration against the remote D1).

Don't suggest Unix syntax (`~/Downloads`, `unzip`, `&&` chains, single
quotes) — those don't work in `cmd.exe`.

## After a commit

Always end the reply with:

- If the commit touches **only `index.html`**: GitHub Pages auto-serves
  it. Tell the user to hard-refresh (Ctrl+Shift+R) once it's live (~1
  min). No Worker redeploy.
- If the commit touches `worker-api.js`, `wrangler.toml`,
  `package.json`, or a file under `migrations/`: include the Windows
  cmd.exe block above. If the schema changed, also tell them to run
  `npm run db:init`.
- If the commit is docs-only (`README.md`, `CLAUDE.md`): no action needed.

## State split

- **In D1** (shared across all viewers): pharmacies + reviews. Single
  source of truth.
- **In localStorage** (per-browser): `hidden` competitor toggle list,
  `milestoneFilter`, `milestoneScope`, `goals`, `lastViewedAt`. Stored
  under key `pharmRev.prefs`.
- **Auto-migration**: if D1 is empty AND the browser has leftover v4
  state under `pharmRev.v4`, the dashboard uploads it once on first
  load. Marked complete via `pharmRev.migratedAt` so it never re-runs.

## Auth

Writes (POST/DELETE) require an `X-Pharm-Token` header that matches the
Worker's `PHARM_TOKEN` secret. The token is embedded in `index.html` as
the `API_TOKEN` constant — anyone reading the page source can find it,
so this is casual-abuse prevention, not real security. GETs are open.

## Input JSON schema

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
      "is_deleted": 0
    }
  ]
}
```

Top-level can also be a plain array (no wrapper key). Reviews with
`is_deleted == 1` are skipped. Only `review_date`, `rating`, and
`author` are strictly required.

## History

This project used to scrape Google Maps via a headless-Chromium worker.
That was abandoned for being fragile; replaced with a localStorage-only
JSON-import dashboard; then (current version) backed by D1 so multiple
users share the same dataset. The earlier scraper code is in git
history if anyone wants to resurrect it.
