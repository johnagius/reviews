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

    let parsed;
    try { parsed = new URL(target); }
    catch { return json({ error: 'invalid url' }, 400); }
    if (!ALLOW_HOSTS.has(parsed.hostname)) {
      return json({ error: `host not allowed: ${parsed.hostname}` }, 403);
    }

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

      // Cloudflare's Browser Rendering egress is often EU-based, so Google
      // serves its "Before you continue" consent interstitial before the
      // Maps content. Pre-set the accept cookies so we skip the gate.
      await page.setCookie(
        { name: 'SOCS', value: 'CAESEwgDEgk0NzgwODA4MzMaAmVuIAEaBgiA_LyaBg',
          domain: '.google.com', path: '/', secure: true, sameSite: 'Lax' },
        { name: 'CONSENT', value: 'YES+cb', domain: '.google.com', path: '/' }
      );

      // Force English UI so our "N stars, M reviews" regexes match regardless
      // of the IP-geolocated locale Google would otherwise pick.
      const goUrl = withParam(target, 'hl', 'en');
      await page.goto(goUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Fallback: if we still landed on consent.google.com (cookie didn't
      // stick, or Google rolled the format), click whichever localised
      // "Accept all" / "Reject all" button is on the page, then re-navigate
      // to the target so we own the post-consent page state.
      if (await isConsentPage(page)) {
        await dismissConsent(page);
        if (await isConsentPage(page)) {
          await page.goto(goUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
      }

      // Cloudflare's egress IP rotates per request, and on some IPs Google
      // serves a "limited view" of Maps — no review count, no Reviews tab,
      // stripped place card. Detect that and re-navigate with force=tt
      // (and entry= stripped), which asks Maps for the full traditional
      // place card.
      if (await isLimitedView(page)) {
        const u = new URL(goUrl);
        u.searchParams.delete('entry');
        u.searchParams.set('force', 'tt');
        await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      // Wait until the rating + a review count appear in body text. This is the
      // signal that JS hydration is done.
      await page.waitForFunction(() => {
        const t = document.body.innerText;
        return /(^|\s)[1-5]\.\d(\s|$)/m.test(t) && /\d+\s+(reviews?|Google reviews?)/i.test(t);
      }, { timeout: 15000 }).catch(() => {});

      // Phase 1: extract name + rating + reviewCount from the *initial* place
      // card view — before any clicks. After we open the rating breakdown each
      // visible reviewer card has its own "X reviews" badge, and a broad
      // button[aria-label*="reviews"] selector then matches a reviewer's badge
      // instead of the place's total, returning a tiny count like 4.
      const basic = await page.evaluate(extractNameRatingCount);

      // Phase 2: click the rating header to open the 1★–5★ breakdown overlay.
      // Try the F7nice review-count button first (most reliable across UI
      // refreshes), then fall back to the star icon's parent button.
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

      // Phase 3: extract dist while the breakdown overlay is open.
      const dist = await page.evaluate(extractDistribution);

      // Phase 4: scroll the reviews list and collect per-review dates/stars.
      const reviews = await scrapeReviews(page).catch(() => []);

      const debug = new URL(request.url).searchParams.get('debug') === '1'
        ? await page.evaluate(collectDebug)
        : undefined;

      const data = { ...basic, dist, reviews };
      if (debug) data._debug = debug;
      return json(data);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
};

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

// Recognise relative-date strings Maps puts on individual review cards.
const AGO_RE_SRC =
  '^(?:(?:\\d+|a|an)\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago|yesterday|just now|moments?\\s+ago)$';
const EDITED_AGO_RE_SRC =
  '^edited\\s+((?:\\d+|a|an)\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago)$';

async function scrapeReviews(page) {
  // After the rating click in phase 2, the breakdown overlay is open and the
  // 1★–5★ rows are visible. Individual reviews sit in the SAME scrollable
  // overlay just below the distribution, so we anchor scrolling on the dist
  // row's nearest scrollable ancestor (we know it exists; data-review-id
  // does not always).
  await page.evaluate(async (agoSrc) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const agoRe = new RegExp(agoSrc, 'i');
    const isReviewSpan = el => agoRe.test((el.textContent || '').trim());

    const anchor = document.querySelector('[aria-label*="stars, "], [aria-label*=" star, "]')
                || document.querySelector('[data-review-id]')
                || Array.from(document.querySelectorAll('span')).find(isReviewSpan);
    if (!anchor) return;
    let scroller = anchor.parentElement;
    while (scroller && scroller !== document.body) {
      const cs = getComputedStyle(scroller);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')
          && scroller.scrollHeight > scroller.clientHeight + 4) break;
      scroller = scroller.parentElement;
    }
    if (!scroller || scroller === document.body) {
      scroller = document.scrollingElement || document.documentElement;
    }
    const countReviews = () => Array.from(document.querySelectorAll('span'))
      .filter(isReviewSpan).length;
    const HARD_CAP = 1500, MAX_ITER = 300;
    let last = 0, stable = 0;
    for (let i = 0; i < MAX_ITER && stable < 4; i++) {
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(350);
      const cur = countReviews();
      if (cur >= HARD_CAP) break;
      if (cur === last) stable++;
      else { stable = 0; last = cur; }
    }
  }, AGO_RE_SRC);

  return await page.evaluate((agoSrc, editedSrc) => {
    const agoRe = new RegExp(agoSrc, 'i');
    const editedRe = new RegExp(editedSrc, 'i');
    const out = [];
    const seen = new Set();
    // Find every relative-date span on the page, then walk up to the
    // nearest ancestor that also contains a star-rating element. That
    // ancestor is the review card.
    for (const span of document.querySelectorAll('span')) {
      const txt = (span.textContent || '').trim();
      let ago = null;
      if (agoRe.test(txt)) ago = txt;
      else {
        const m = txt.match(editedRe);
        if (m) ago = m[1];
      }
      if (!ago) continue;

      let p = span.parentElement, stars = null, card = null;
      for (let i = 0; i < 10 && p; i++) {
        const starEl = p.querySelector('[role="img"][aria-label*=" star"], [aria-label$=" stars"], [aria-label$=" star"]');
        if (starEl) {
          const lbl = starEl.getAttribute('aria-label') || '';
          // Skip the place-level rating widget which mentions "X reviews"
          // (we want individual review cards with a single star count).
          if (/\d+\s+reviews?/i.test(lbl)) { p = p.parentElement; continue; }
          const m = lbl.match(/^(\d)\s+stars?$/i)
                 || lbl.match(/Rated\s+([1-5])(?:\.0)?\s+out of 5/i);
          if (m) { stars = parseInt(m[1], 10); card = p; break; }
        }
        p = p.parentElement;
      }
      if (stars == null || !card) continue;
      const key = (card.getAttribute && card.getAttribute('data-review-id'))
               || (card.outerHTML || '').slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ago, stars });
    }
    return out;
  }, AGO_RE_SRC, EDITED_AGO_RE_SRC);
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
