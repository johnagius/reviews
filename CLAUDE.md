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

Single-page dashboard (`index.html`) that compares the owner's pharmacy
against competitors using public Google Maps data, fetched through a
Cloudflare Worker (`worker.js`) that runs headless Chromium. State lives
in `localStorage`.

The repo is intentionally just three live files:

- `index.html` — the dashboard, served by GitHub Pages from `main`
- `worker.js` — the Cloudflare Worker source (manually pasted into the
  Cloudflare dashboard editor)
- `README.md` + `CLAUDE.md` — docs

Keep `index.html` self-contained — no build step, no external runtime deps.
That's what makes it work as a GitHub Pages site with zero configuration.

## User workflow

The user **does not use git locally**. They view and download files from
GitHub's web UI / raw links, and paste into Cloudflare's dashboard editor.
Don't suggest `git pull`, `wrangler deploy`, `npm install`, or any other
CLI step — they won't run it.

Don't add `wrangler.toml`, `package.json`, `.gitignore`, or any other
CLI/build scaffolding back to the repo. They were removed as dead weight
because the user's flow is dashboard-paste only.

## After updating `worker.js`

GitHub Pages auto-serves `index.html` from `main` within a minute of every
push, so dashboard changes need no user action. The Cloudflare Worker is
different — it does **not** auto-redeploy from this repo, so the user has
to push it manually.

After every commit that touches `worker.js`, end the reply with:

1. The raw link for the file on `main`:
   `https://raw.githubusercontent.com/johnagius/reviews/main/worker.js`
2. The dashboard redeploy steps:
   - Cloudflare → Workers & Pages → `pharm-scraper` → Edit code
   - Open the raw link above, select all, copy
   - Paste over the editor contents → Save and deploy
3. A reminder that until they redeploy, the dashboard still hits the old code.

If a commit touches **only** `index.html` (or other files that aren't
`worker.js`), say so explicitly and tell the user no Worker redeploy is
needed — GitHub Pages handles it.
