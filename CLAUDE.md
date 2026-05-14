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
against competitors using public Google Maps data, fetched through a CORS
proxy. State lives in `localStorage`. Optional Cloudflare Worker proxy in
`proxy-worker.js`.

Keep `index.html` self-contained — no build step, no external runtime deps.
That's what makes it work as a GitHub Pages site with zero configuration.

## After updating `worker.js`

GitHub Pages auto-deploys `index.html`, but the Cloudflare Worker doesn't
auto-redeploy from this repo — the user has to push it. After every commit
that touches `worker.js`, end the reply with:

1. The raw download link for the current `main`:
   `https://raw.githubusercontent.com/johnagius/reviews/main/worker.js`
2. Both redeploy paths:
   - **CLI:** `git pull && npx wrangler deploy`
   - **Dashboard:** Cloudflare → Workers & Pages → `pharm-scraper` → Edit code → paste the raw file contents → Save and deploy.

Don't skip this even if the change feels minor — until the Worker is
redeployed, the dashboard still hits the old code.
