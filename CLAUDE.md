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

Live files in the repo:

- `index.html` — the dashboard, served by GitHub Pages from `main`
- `worker.js` — the Cloudflare Worker source
- `wrangler.toml` + `package.json` — config for `npx wrangler deploy`
- `README.md` + `CLAUDE.md` — docs

Keep `index.html` self-contained — no build step, no external runtime deps.
That's what makes it work as a GitHub Pages site with zero configuration.

## User workflow

The user is on **Windows** (`cmd.exe`, e.g. `C:\Users\Potte>` prompt) and
**does not use git locally**. To redeploy the Worker they:

1. Download the repo as a zip from GitHub's "Code → Download ZIP" button
   (URL: `https://github.com/johnagius/reviews/archive/refs/heads/main.zip`)
2. Extract it in their Downloads folder
3. Run `npx wrangler deploy` in the unzipped folder

So they DO use a terminal, just not git, and the terminal is Windows
`cmd.exe`. Don't suggest:

- `git pull` / `git clone` — they download fresh zips
- Unix-only syntax: `~/Downloads`, `unzip`, `&&` chains, single-quoted
  strings — none of these work in `cmd.exe`
- `bash` script blocks — give plain `cmd.exe` commands

Keep `wrangler.toml` and `package.json` intact; without them,
`wrangler deploy` won't work.

## After updating `worker.js`

GitHub Pages auto-serves `index.html` from `main` within a minute of every
push, so dashboard changes need no user action. The Cloudflare Worker is
different — it does **not** auto-redeploy from this repo, so the user has
to push it manually.

After every commit that touches `worker.js`, `wrangler.toml`, or
`package.json`, end the reply with:

1. The zip download link for the current `main`:
   `https://github.com/johnagius/reviews/archive/refs/heads/main.zip`
2. A complete copy-pasteable Windows `cmd.exe` block. Always
   `curl`-download the zip fresh rather than telling them to click the
   GitHub link — browsers will serve a stale cached zip and silently
   redeploy the previous code, which has burned us before:
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
   Windows 10+ ships `curl` and `tar` built in. `del`/`rmdir` print
   "could not find" the first time, which is harmless. `curl -L`
   follows GitHub's 302 to codeload.github.com.

   **`npm install` is required**, not optional: wrangler bundles
   `worker.js` and needs `@cloudflare/puppeteer` resolvable from
   `node_modules`, otherwise the build fails with
   `Could not resolve "@cloudflare/puppeteer"`. Since the user
   re-extracts a fresh zip each time, `node_modules` may not persist,
   so re-run `npm install` every redeploy.

   On the very first deploy, `npx wrangler` will also prompt
   `Ok to proceed? (y)` to install wrangler itself, and then open a
   browser to log into Cloudflare. Tell the user to press `y` + Enter
   at the prompt — multi-line paste at that point sends the next
   command as the prompt answer and cancels the install.
3. A reminder that until they run that block, the dashboard still hits
   the old Worker code.

If a commit touches **only** `index.html` (or other files that aren't
Worker-related), say so explicitly and tell the user no Worker redeploy
is needed — GitHub Pages handles it.
