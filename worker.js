/**
 * Pharmacy Review Tracker — scraper Worker
 *
 * Renders a Google Maps place page in a real headless Chromium so the
 * JS-hydrated rating + review count + 1★-5★ distribution appear in the DOM,
 * then returns clean JSON. The dashboard at index.html calls this Worker
 * to do its "Refresh all" without any copy/paste.
 *
 * Requirements
 * ------------
 * - Cloudflare Workers Paid plan ($5/mo). Browser Rendering free quota
 *   (10 min/day) is plenty for ~5 pharmacies refreshed weekly.
 * - A "Browser" binding configured for this Worker (see deploy steps below).
 *
 * Deploy
 * ------
 * 1. Cloudflare Dashboard → Workers & Pages → Create → Hello World template.
 * 2. Replace the editor contents with this file → Save and deploy.
 * 3. In the Worker's settings → Bindings → Add:
 *      Type: Browser Rendering, Variable name: BROWSER
 * 4. Copy the deployed Worker URL (e.g. https://pharm-scraper.<you>.workers.dev).
 * 5. Paste it into the dashboard's Settings → Scraper URL.
 *
 * The Worker only scrapes google.com Maps URLs so it can't be abused as an
 * open scraper.
 */

import puppeteer from "@cloudflare/puppeteer";

const ALLOW_HOSTS = new Set(['www.google.com', 'maps.google.com', 'google.com']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return json({ error: 'pass ?url=<google-maps-place-url>' }, 400);
    const wantDebug = new URL(request.url).searchParams.get('debug') === '1';

    let parsed;
    try { parsed = new URL(target); }
    catch { return json({ error: 'invalid url' }, 400); }
    if (!ALLOW_HOSTS.has(parsed.hostname)) {
      return json({ error: `host not allowed: ${parsed.hostname}` }, 403);
    }

    // Cloudflare's Browser Rendering hands each new puppeteer.launch a fresh
    // session, often from a different egress IP. Google flags some of those
    // IPs and serves a "limited view" of Maps (no review count, no Reviews
    // tab). Retry up to 3 times with fresh sessions when we detect that.
    let attempts = [];
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await scrapeOnce(env, target, wantDebug);
      attempts.push({ attempt, limited: result.limited, reviewCount: result.data && result.data.reviewCount });
      last = result;
      if (!result.limited && result.data && result.data.reviewCount != null) break;
    }
    if (last && last.data) {
      if (wantDebug) last.data._attempts = attempts;
      return json(last.data);
    }
    return json({ error: (last && last.error) || 'scrape failed', _attempts: attempts }, 502);
  }
};

async function scrapeOnce(env, target, wantDebug) {
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1280, height: 900 });

    // Inject __name as a global on every new document — this is the helper
    // esbuild stamps around named function declarations for stack-trace
    // readability. It lives in the bundled Worker scope, not the page's
    // V8 isolate, so any page.evaluate-stringified function that references
    // __name throws "__name is not defined" without this shim.
    await page.evaluateOnNewDocument(() => {
      // eslint-disable-next-line no-undef
      window.__name = (fn) => fn;
    });

    // Pre-set Google's consent-accept cookies on .google.com so we skip
    // the "Before you continue" interstitial on EU-egress requests.
    await page.setCookie(
      { name: 'SOCS', value: 'CAESEwgDEgk0NzgwODA4MzMaAmVuIAEaBgiA_LyaBg',
        domain: '.google.com', path: '/', secure: true, sameSite: 'Lax' },
      { name: 'CONSENT', value: 'YES+cb', domain: '.google.com', path: '/' }
    );

    const goUrl = withParam(target, 'hl', 'en');
    await page.goto(goUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (await isConsentPage(page)) {
      await dismissConsent(page);
      if (await isConsentPage(page)) {
        await page.goto(goUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
    }

    // Wait for the page to settle into either limited or full view. The
    // limited-view notice and the "N reviews" text both render
    // asynchronously, so this single wait correctly handles both outcomes
    // without racing the JS.
    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      return /You'?re seeing a limited view of Google Maps/i.test(t)
          || /\d+\s+(reviews?|Google\s+reviews?)/i.test(t)
          || !!document.querySelector('div.F7nice button');
    }, { timeout: 20000 }).catch(() => {});

    // If we're on the limited view, try force=tt as a same-session escape;
    // many places switch to the full place card with this toggle on. If it
    // doesn't escape, the outer retry loop will reopen the browser with a
    // new egress IP.
    if (await isLimitedView(page)) {
      const u = new URL(goUrl);
      u.searchParams.delete('entry');
      u.searchParams.set('force', 'tt');
      await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => {
        const t = document.body.innerText || '';
        return /You'?re seeing a limited view of Google Maps/i.test(t)
            || /\d+\s+(reviews?|Google\s+reviews?)/i.test(t);
      }, { timeout: 15000 }).catch(() => {});
    }

    const limited = await isLimitedView(page);

    // Phase 1: extract name + rating + reviewCount from the initial place
    // card view (before any click).
    const basic = await page.evaluate(extractNameRatingCount);

    // Phase 2: click the rating header to open the 1★–5★ breakdown overlay.
    try {
      await page.evaluate(() => {
        const f7Button = document.querySelector('div.F7nice button');
        if (f7Button) { f7Button.click(); return; }
        const reviewsBtn = document.querySelector('button[aria-label*="reviews"], button[aria-label*="Reviews"]');
        if (reviewsBtn) { reviewsBtn.click(); return; }
        const star = document.querySelector('[role="img"][aria-label*="stars"]')
                  || document.querySelector('button[jsaction*="pane.rating.moreReviews"]');
        if (star) (star.closest('button') || star).click();
      });
      await page.waitForFunction(() => {
        return document.querySelectorAll('[aria-label*="stars,"]').length >= 5
            || document.querySelectorAll('[aria-label*=" star,"]').length >= 5;
      }, { timeout: 6000 }).catch(() => {});
    } catch (e) {}

    const dist = await page.evaluate(extractDistribution);

    // If clicking the rating didn't bring up the actual reviews list, click
    // the Reviews tab explicitly. This happens when the rating click only
    // shows the dist popup overlay rather than navigating the side panel.
    if ((await page.$$('[data-review-id]')).length === 0) {
      await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
        const reviewsTab = tabs.find(t =>
          /^reviews$/i.test(((t.innerText || t.textContent || '').trim().split('\n')[0] || '')));
        if (reviewsTab) (reviewsTab.closest('button') || reviewsTab).click();
      });
      await page.waitForSelector('[data-review-id]', { timeout: 8000 }).catch(() => {});
    }

    const scrapeDiag = wantDebug ? { anchorFound: false, scrollerInfo: null, iters: 0, finalCount: 0 } : null;
    const reviews = await scrapeReviews(page, scrapeDiag).catch(() => []);

    const data = { ...basic, dist, reviews };
    if (wantDebug) {
      data._debug = await page.evaluate(collectDebug);
      if (scrapeDiag) data._debug.scrape = scrapeDiag;
    }
    return { data, limited, error: null };
  } catch (e) {
    return { data: null, limited: false, error: String(e && e.message || e) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function withParam(rawUrl, key, value) {
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has(key)) u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

async function isLimitedView(page) {
  return await page.evaluate(() =>
    /You'?re seeing a limited view of Google Maps/i.test(document.body.innerText || '')
  );
}

async function isConsentPage(page) {
  return await page.evaluate(() => {
    if (/(^|\.)consent\.google\.com$/.test(location.hostname)) return true;
    if (/\/consent[\/?]/i.test(location.pathname + location.search)) return true;
    if (document.querySelector('form[action*="consent.google.com"]')) return true;
    // Localised titles seen in the wild for the "Before you continue" gate.
    return /^(Before you continue|Avant d.accéder|Antes de (?:acceder|continuar|ir)|Antes de (?:aceder|continuares)|Bevor du|Voordat je|Prima di (?:andare|accedere|continuare)|Innan du|Inden du|Ennen kuin|Zanim przejdziesz|Bevor Sie)/i
      .test(document.title || '');
  });
}

// Relative-date strings Maps puts on individual review cards.
const AGO_RE_SRC =
  '^(?:(?:\\d+|a|an)\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago|yesterday|just now|moments?\\s+ago)$';
const EDITED_AGO_RE_SRC =
  '^edited\\s+((?:\\d+|a|an)\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago)$';

async function scrapeReviews(page, diag) {
  // After the rating click + Reviews-tab fallback, scroll the reviews
  // container. Anchor first on [data-review-id]; fall back to dist row;
  // last resort, scroll every visible scrollable container.
  let scrapeInfo;
  try {
    scrapeInfo = await page.evaluate(async () => {
      // wrangler/esbuild wraps named function declarations with __name() for
      // nicer stack traces. That variable only exists in the bundled Worker
      // scope, not in the page context page.evaluate runs in — so any inner
      // `function foo()` would throw "__name is not defined". Polyfill it
      // and also prefer arrow functions inside page.evaluate to avoid the
      // wrap entirely.
      // eslint-disable-next-line no-unused-vars
      const __name = (fn) => fn;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const info = { anchor: null, scroller: null, iters: 0, finalCount: 0, scrollables: 0 };
      let anchor = document.querySelector('[data-review-id]')
                || document.querySelector('[aria-label*="stars, "], [aria-label*=" star, "]');
      if (!anchor) {
        info.anchor = 'none';
        return info;
      }
      info.anchor = anchor.hasAttribute('data-review-id') ? 'review' : 'dist';

      const findScrollable = (start) => {
        let s = start && start.parentElement;
        while (s && s !== document.body) {
          const cs = getComputedStyle(s);
          if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')
              && s.scrollHeight > s.clientHeight + 4) return s;
          s = s.parentElement;
        }
        return null;
      };
      let scroller = findScrollable(anchor);
      if (!scroller) scroller = document.scrollingElement || document.documentElement;
      const cls = typeof scroller.className === 'string' ? scroller.className : '';
      info.scroller = `${scroller.tagName}.${cls.split(' ').slice(0,2).join('.')}` +
                      `[h=${scroller.scrollHeight},vh=${scroller.clientHeight}]`;

      const allScrollables = Array.from(document.querySelectorAll('*')).filter(el => {
        const cs = getComputedStyle(el);
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
            && el.scrollHeight > el.clientHeight + 4;
      });
      info.scrollables = allScrollables.length;

      const HARD_CAP = 1500, MAX_ITER = 300, WARMUP_ITERS = 25;
      let last = 0, stable = 0;
      for (let i = 0; i < MAX_ITER; i++) {
        info.iters = i + 1;
        scroller.scrollTop = scroller.scrollHeight;
        for (const s of allScrollables) s.scrollTop = s.scrollHeight;
        await sleep(400);
        const cur = document.querySelectorAll('[data-review-id]').length;
        info.finalCount = cur;
        if (cur >= HARD_CAP) break;
        if (cur === 0) {
          if (i >= WARMUP_ITERS) break;
          continue;
        }
        if (cur === last) stable++;
        else { stable = 0; last = cur; }
        if (stable >= 4) break;
      }
      return info;
    });
    if (diag) Object.assign(diag, scrapeInfo);
  } catch (e) {
    if (diag) diag.scrollError = String(e && (e.message || e)).slice(0, 300);
    return [];
  }

  try {
    return await page.evaluate((agoSrc, editedSrc) => {
      // eslint-disable-next-line no-unused-vars
      const __name = (fn) => fn;
      const agoRe = new RegExp(agoSrc, 'i');
      const editedRe = new RegExp(editedSrc, 'i');
      const out = [];
      document.querySelectorAll('[data-review-id]').forEach(item => {
        let stars = null;
        for (const el of item.querySelectorAll('[aria-label]')) {
          const lbl = el.getAttribute('aria-label') || '';
          if (/\d+\s+reviews?/i.test(lbl)) continue;
          const m = lbl.match(/(?:^|\W)([1-5])\s+stars?(?:\W|$)/i)
                 || lbl.match(/Rated\s+([1-5])(?:\.\d)?\s+out of 5/i);
          if (m) { stars = parseInt(m[1], 10); break; }
        }
        let ago = null;
        for (const s of item.querySelectorAll('span')) {
          const t = (s.textContent || '').trim();
          if (agoRe.test(t)) { ago = t; break; }
          const m = t.match(editedRe);
          if (m) { ago = m[1]; break; }
        }
        if (ago && stars != null) out.push({ ago, stars });
      });
      return out;
    }, AGO_RE_SRC, EDITED_AGO_RE_SRC);
  } catch (e) {
    if (diag) diag.extractError = String(e && (e.message || e)).slice(0, 300);
    return [];
  }
}

async function dismissConsent(page) {
  const clicked = await page.evaluate(() => {
    const labels = /^(Accept all|I agree|Reject all|Tout accepter|Tout refuser|Alle akzeptieren|Alle ablehnen|Aceptar todo|Rechazar todo|Accetta tutto|Rifiuta tutto|Aceitar tudo|Rejeitar tudo|Alles accepteren|Alles weigeren|Godkänn alla|Avvisa alla|Acceptér alle|Afvis alle|Hyväksy kaikki|Hylkää kaikki|Zaakceptuj wszystko|Odrzuć wszystko)/i;
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], form button, input[type=submit]'));
    const btn = candidates.find(el => labels.test((el.innerText || el.textContent || el.value || '').trim()));
    if (btn) { btn.click(); return true; }
    // Last-resort: submit any visible consent form.
    const form = document.querySelector('form[action*="consent"]');
    if (form) { form.submit(); return true; }
    return false;
  });
  if (clicked) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  }
}

/* Runs inside the rendered Maps page. Pulls name + rating + total review
 * count from the *initial* place card view, BEFORE the rating breakdown
 * overlay opens. Once that overlay is open each visible reviewer card has
 * its own "X reviews" badge, so a broad button[aria-label*="reviews"]
 * selector will then match the first reviewer and return a tiny count.
 */
function extractNameRatingCount() {
  const out = { name: null, rating: null, reviewCount: null };

  const h1 = document.querySelector('h1');
  if (h1) out.name = h1.textContent.trim();

  // Rating: aria-label on the star icon ("Rated 4.7 out of 5" / "4.7 stars").
  for (const el of document.querySelectorAll('[role="img"][aria-label], [aria-label]')) {
    const lbl = el.getAttribute('aria-label') || '';
    const m = lbl.match(/(?:Rated\s+|^|\s)([1-5][.,]\d)(?:\s*(?:out of 5|stars?|\/\s*5))/i);
    if (m) { out.rating = parseFloat(m[1].replace(',', '.')); break; }
  }
  if (out.rating == null) {
    const cand = document.querySelector('div.F7nice span[aria-hidden="true"]')
              || document.querySelector('div.fontDisplayLarge');
    if (cand) {
      const m = (cand.textContent || '').match(/([1-5][.,]\d)/);
      if (m) out.rating = parseFloat(m[1].replace(',', '.'));
    }
  }

  // Review count — Google has split it out of F7nice in the current UI for
  // some places, so we search in widening scopes: F7nice itself, F7nice's
  // parent (which contains both the rating and the count side-by-side),
  // and finally any element on the page whose aria-label is the standard
  // "Rated X out of 5 stars, N reviews" widget.
  const ratingHeader = document.querySelector('div.F7nice')
    || (document.querySelector('[role="img"][aria-label*="stars"]') || {}).closest?.('div')
    || null;
  const scopes = ratingHeader
    ? [ratingHeader, ratingHeader.parentElement, ratingHeader.parentElement && ratingHeader.parentElement.parentElement]
    : [];
  for (const scope of scopes) {
    if (!scope || out.reviewCount != null) break;
    const txt = (scope.textContent || '').replace(/\s+/g, ' ').trim();
    const m = txt.match(/\((\d{1,3}(?:[, ]\d{3})*|\d+)\)/)
           || txt.match(/(\d{1,3}(?:[, ]\d{3})*|\d+)\s*(?:reviews?|Google\s+reviews?)/i);
    if (m) {
      const n = parseInt(m[1].replace(/[, ]/g, ''), 10);
      if (n > 0 && n < 10_000_000) out.reviewCount = n;
    }
  }
  // Fallback: an aria-label of the form "Rated 4.5 out of 5 stars, 193 reviews"
  // or just "193 reviews" — restricted to a value that round-trips through
  // the place card so we don't catch reviewer cards or other navigation.
  if (out.reviewCount == null) {
    for (const el of document.querySelectorAll('[aria-label]')) {
      const lbl = el.getAttribute('aria-label') || '';
      let m = lbl.match(/Rated\s+[1-5][.,]\d.*?,\s*(\d{1,3}(?:[, ]\d{3})*|\d+)\s+reviews?/i);
      if (!m) m = lbl.match(/^(\d{1,3}(?:[, ]\d{3})*|\d+)\s+(?:reviews?|Google\s+reviews?)$/i);
      if (m) {
        const n = parseInt(m[1].replace(/[, ]/g, ''), 10);
        if (n > 0 && n < 10_000_000) { out.reviewCount = n; break; }
      }
    }
  }

  // Last-ditch text fallback (parses the visible body text, picking the first
  // "N reviews" mention — which is the place's total in the rating header).
  if (out.rating == null || out.reviewCount == null) {
    const txt = document.body.innerText.slice(0, 5000);
    if (out.rating == null) {
      const m = txt.match(/(?<![\d.])([1-5]\.\d)(?!\d)/);
      if (m) out.rating = parseFloat(m[1]);
    }
    if (out.reviewCount == null) {
      const m = txt.match(/\((\d{1,3}(?:,\d{3})*|\d+)\)/)
             || txt.match(/(\d{1,3}(?:,\d{3})*|\d+)\s+(?:Google\s+)?reviews?/i);
      if (m) out.reviewCount = parseInt(m[1].replace(/,/g, ''), 10);
    }
  }

  return out;
}

/* Runs after the rating-breakdown overlay opens — collects the 1★–5★ counts. */
function extractDistribution() {
  const rows = Array.from(document.querySelectorAll('[aria-label]'))
    .map(el => el.getAttribute('aria-label') || '')
    .filter(l => /^\s*[1-5]\s+stars?,\s*\d/.test(l));
  if (rows.length < 5) return null;
  const tmp = {};
  for (const lbl of rows) {
    const m = lbl.match(/^\s*([1-5])\s+stars?,\s*(\d{1,3}(?:[, ]\d{3})*|\d+)/);
    if (m) tmp[parseInt(m[1], 10)] = parseInt(m[2].replace(/[, ]/g, ''), 10);
  }
  if (Object.keys(tmp).length !== 5) return null;
  return [tmp[1], tmp[2], tmp[3], tmp[4], tmp[5]];
}

/* Diagnostic snapshot of the DOM after all extraction phases ran, so we can
 * see *why* a selector missed. Only returned when ?debug=1 is passed.
 */
function collectDebug() {
  const f7 = document.querySelector('div.F7nice');
  const f7Parent = f7 ? f7.parentElement : null;
  const f7GrandParent = f7Parent ? f7Parent.parentElement : null;

  // Any aria-label that mentions reviews with a digit, or matches the
  // canonical "Rated X out of 5" pattern.
  const reviewLabels = [];
  for (const el of document.querySelectorAll('[aria-label]')) {
    const lbl = el.getAttribute('aria-label') || '';
    if (/\d+\s*(?:reviews?|Google\s+reviews?)/i.test(lbl) || /Rated\s+[1-5]/i.test(lbl)) {
      reviewLabels.push(lbl.slice(0, 200));
      if (reviewLabels.length >= 10) break;
    }
  }

  return {
    finalUrl: location.href,
    title: document.title,
    h1: (document.querySelector('h1') || {}).textContent || null,
    bodyHead: document.body.innerText.slice(0, 1500),
    buttonLabels: Array.from(document.querySelectorAll('button[aria-label]')).slice(0, 30)
      .map(b => b.getAttribute('aria-label')),
    tabLabels: Array.from(document.querySelectorAll('[role="tab"]'))
      .map(t => (t.innerText || t.textContent || '').trim()).filter(Boolean),
    reviewItemCount: document.querySelectorAll('[data-review-id]').length,
    distRowCount: document.querySelectorAll('[aria-label*="stars,"]').length
                + document.querySelectorAll('[aria-label*=" star,"]').length,
    hasF7nice: !!f7,
    f7Text: f7 ? (f7.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null,
    f7ParentText: f7Parent ? (f7Parent.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400) : null,
    f7GrandParentText: f7GrandParent ? (f7GrandParent.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600) : null,
    reviewLabels,
    limited: /You'?re seeing a limited view of Google Maps/i.test(document.body.innerText || ''),
  };
}
