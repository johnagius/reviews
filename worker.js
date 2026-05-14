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

      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Fallback: if we still landed on consent.google.com (cookie didn't
      // stick, or Google rolled the format), click whichever localised
      // "Accept all" / "Reject all" button is on the page — either dismisses
      // the interstitial and forwards us to the real destination.
      if (await isConsentPage(page)) {
        await dismissConsent(page);
      }

      // Wait until the rating + a review count appear in body text. This is the
      // signal that JS hydration is done.
      await page.waitForFunction(() => {
        const t = document.body.innerText;
        return /(^|\s)[1-5]\.\d(\s|$)/m.test(t) && /\d+\s+(reviews?|Google reviews?)/i.test(t);
      }, { timeout: 15000 }).catch(() => {});

      // Best-effort: click the rating so the 1★–5★ distribution panel opens
      // and its aria-labels are available for extraction.
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('[role="img"][aria-label*="stars"]')
                  ||  document.querySelector('button[jsaction*="pane.rating.moreReviews"]');
          if (btn) (btn.closest('button') || btn).click();
        });
        await page.waitForFunction(() => {
          // Wait for distribution rows to appear (5 of them, each labelled "N stars, M reviews")
          return document.querySelectorAll('[aria-label*="stars,"]').length >= 5
              || document.querySelectorAll('[aria-label*=" star,"]').length >= 5;
        }, { timeout: 4000 }).catch(() => {});
      } catch (e) {}

      const data = await page.evaluate(extractInPage);
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

/* Runs inside the rendered Maps page (no closure access to Worker scope). */
function extractInPage() {
  const out = { name: null, rating: null, reviewCount: null, dist: null };

  // --- Name -------------------------------------------------------------
  const h1 = document.querySelector('h1');
  if (h1) out.name = h1.textContent.trim();

  // --- Rating -----------------------------------------------------------
  // Prefer aria-label on the star icon ("Rated 4.7 out of 5" / "4.7 stars")
  const ratingNodes = Array.from(document.querySelectorAll('[role="img"][aria-label], [aria-label]'));
  for (const el of ratingNodes) {
    const lbl = el.getAttribute('aria-label') || '';
    const m = lbl.match(/(?:Rated\s+|^|\s)([1-5][.,]\d)(?:\s*(?:out of 5|stars?|\/\s*5))/i);
    if (m) { out.rating = parseFloat(m[1].replace(',', '.')); break; }
  }
  // Fallback: visible rating number inside the typical container
  if (out.rating == null) {
    const cand = document.querySelector('div.F7nice span[aria-hidden="true"]')
              || document.querySelector('div.fontDisplayLarge');
    if (cand) {
      const m = (cand.textContent || '').match(/([1-5][.,]\d)/);
      if (m) out.rating = parseFloat(m[1].replace(',', '.'));
    }
  }

  // --- Review count -----------------------------------------------------
  // The button/span next to the rating typically reads "(348)" or "348 reviews"
  const reviewButton = document.querySelector('button[aria-label*="reviews"]')
                    || document.querySelector('button[jsaction*="reviewChart"]')
                    || document.querySelector('div.F7nice button')
                    || document.querySelector('div.F7nice span:nth-child(2)');
  if (reviewButton) {
    const t = reviewButton.getAttribute('aria-label') || reviewButton.textContent || '';
    const m = t.match(/(\d{1,3}(?:[, ]\d{3})*|\d+)/);
    if (m) {
      const n = parseInt(m[1].replace(/[, ]/g, ''), 10);
      if (n > 0 && n < 10_000_000) out.reviewCount = n;
    }
  }

  // --- Distribution -----------------------------------------------------
  // After clicking the rating, each star row has aria-label like
  // "5 stars, 293 reviews" (or "1 star, 12 reviews" — singular).
  const rows = Array.from(document.querySelectorAll('[aria-label]'))
    .map(el => el.getAttribute('aria-label') || '')
    .filter(l => /^\s*[1-5]\s+stars?,\s*\d/.test(l));
  if (rows.length >= 5) {
    const tmp = {};
    for (const lbl of rows) {
      const m = lbl.match(/^\s*([1-5])\s+stars?,\s*(\d{1,3}(?:[, ]\d{3})*|\d+)/);
      if (m) tmp[parseInt(m[1], 10)] = parseInt(m[2].replace(/[, ]/g, ''), 10);
    }
    if (Object.keys(tmp).length === 5) {
      out.dist = [tmp[1], tmp[2], tmp[3], tmp[4], tmp[5]];
    }
  }

  // --- Last-ditch text fallback ----------------------------------------
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
