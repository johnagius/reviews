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

      // Phase 2: click the rating to open the 1★–5★ distribution overlay.
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('[role="img"][aria-label*="stars"]')
                  ||  document.querySelector('button[jsaction*="pane.rating.moreReviews"]');
          if (btn) (btn.closest('button') || btn).click();
        });
        await page.waitForFunction(() => {
          return document.querySelectorAll('[aria-label*="stars,"]').length >= 5
              || document.querySelectorAll('[aria-label*=" star,"]').length >= 5;
        }, { timeout: 4000 }).catch(() => {});
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

const REVIEW_ITEM_SELECTOR =
  '[data-review-id], div[jscontroller][jsdata*="review"], div[aria-label][jslog*="review"]';

async function scrapeReviews(page) {
  // Open the Reviews tab/panel. Try the standard "Reviews" tab first, then
  // any "See all reviews" / "more reviews" button as a fallback.
  await page.evaluate((sel) => {
    if (document.querySelector(sel)) return;
    const visibleText = el => ((el.innerText || el.textContent || '').trim().split('\n')[0] || '').toLowerCase();
    const tabs = Array.from(document.querySelectorAll('button[role="tab"], div[role="tab"]'));
    const tab = tabs.find(t => visibleText(t) === 'reviews');
    if (tab && tab.getAttribute('aria-selected') !== 'true') {
      (tab.closest('button') || tab).click();
      return;
    }
    const more = Array.from(document.querySelectorAll('button, a[role="button"]'))
      .find(el => /^(see all reviews|more reviews|all reviews|view all reviews)/i.test(visibleText(el)));
    if (more) (more.closest('button') || more).click();
  }, REVIEW_ITEM_SELECTOR);

  await page.waitForSelector(REVIEW_ITEM_SELECTOR, { timeout: 10000 }).catch(() => {});

  // Scroll the reviews container until lazy-loading stops adding entries.
  await page.evaluate(async (sel) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const first = document.querySelector(sel);
    if (!first) return;
    let scroller = first.parentElement;
    while (scroller && scroller !== document.body) {
      const cs = getComputedStyle(scroller);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')
          && scroller.scrollHeight > scroller.clientHeight + 4) break;
      scroller = scroller.parentElement;
    }
    if (!scroller || scroller === document.body) {
      // Last resort: scroll the window itself.
      scroller = document.scrollingElement || document.documentElement;
    }
    const HARD_CAP = 1500, MAX_ITER = 300;
    let last = 0, stable = 0;
    for (let i = 0; i < MAX_ITER && stable < 4; i++) {
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(350);
      const cur = document.querySelectorAll(sel).length;
      if (cur >= HARD_CAP) break;
      if (cur === last) stable++;
      else { stable = 0; last = cur; }
    }
  }, REVIEW_ITEM_SELECTOR);

  return await page.evaluate((sel) => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll(sel).forEach(item => {
      const id = item.getAttribute('data-review-id') || item.outerHTML.slice(0, 80);
      if (seen.has(id)) return;
      seen.add(id);

      let stars = null;
      // Try aria-label patterns the rating widget exposes: "5 stars" / "Rated 4.0 out of 5".
      const starCandidates = item.querySelectorAll('[aria-label]');
      for (const el of starCandidates) {
        const lbl = el.getAttribute('aria-label') || '';
        let m = lbl.match(/(?:^|\s)(\d)\s+stars?(?:\s|$|,)/i)
             || lbl.match(/Rated\s+([1-5])(?:\.0)?\s+out of 5/i);
        if (m) { stars = parseInt(m[1], 10); break; }
      }

      let ago = null;
      for (const s of item.querySelectorAll('span')) {
        const t = (s.textContent || '').trim();
        if (/^(?:(?:\d+|a|an)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|yesterday|just now|moments?\s+ago)$/i.test(t)) {
          ago = t; break;
        }
        const m = t.match(/^edited\s+((?:\d+|a|an)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)$/i);
        if (m) { ago = m[1]; break; }
      }
      if (ago && stars != null) out.push({ ago, stars });
    });
    return out;
  }, REVIEW_ITEM_SELECTOR);
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

  // Review count — restrict the search to the rating header container so we
  // don't match navigation, side-panel reviewer badges, or "(193) reviews"-style
  // text elsewhere on the page.
  const ratingHeader = document.querySelector('div.F7nice')
    || (document.querySelector('[role="img"][aria-label*="stars"]') || {}).closest?.('div')
    || null;
  if (ratingHeader) {
    // Look for any element whose accessible name/text mentions reviews.
    const candidates = ratingHeader.querySelectorAll('button, span, a, div');
    for (const el of candidates) {
      const lbl = (el.getAttribute && el.getAttribute('aria-label')) || el.textContent || '';
      if (!/review/i.test(lbl) && !/^\(?\d/.test(lbl.trim())) continue;
      const m = lbl.match(/(\d{1,3}(?:[, ]\d{3})*|\d+)\s*(?:reviews?|Google\s+reviews?)/i)
             || lbl.match(/\((\d{1,3}(?:[, ]\d{3})*|\d+)\)/);
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
  const buttonLabels = Array.from(document.querySelectorAll('button[aria-label]'))
    .slice(0, 20)
    .map(b => b.getAttribute('aria-label'));
  const reviewItemCount = document.querySelectorAll('[data-review-id]').length;
  const distRowCount = document.querySelectorAll('[aria-label*="stars,"]').length
                     + document.querySelectorAll('[aria-label*=" star,"]').length;
  return {
    finalUrl: location.href,
    title: document.title,
    h1: (document.querySelector('h1') || {}).textContent || null,
    bodyHead: document.body.innerText.slice(0, 600),
    buttonLabels,
    reviewItemCount,
    distRowCount,
    hasF7nice: !!document.querySelector('div.F7nice'),
  };
}
