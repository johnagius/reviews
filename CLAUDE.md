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
