/**
 * Cloudflare Worker — minimal CORS proxy for the Pharmacy Review Tracker.
 *
 * Why: public CORS proxies (corsproxy.io, allorigins.win) are free and fine for
 * occasional refreshes, but they're rate-limited and sometimes go down. Deploying
 * this gives you ~100k requests/day on Cloudflare's free tier.
 *
 * Deploy in ~60 seconds:
 *   1. Sign in at https://dash.cloudflare.com → Workers & Pages → Create → Worker.
 *   2. Replace the default code with this file's contents → Save and deploy.
 *   3. Copy your worker URL (e.g. https://pharm-proxy.<you>.workers.dev).
 *   4. In the dashboard: Settings → CORS proxy → Custom →
 *        https://pharm-proxy.<you>.workers.dev/?url={url}
 *
 * Allow-list is restricted to Google Maps so nobody else can abuse the worker
 * as an open proxy. Adjust ALLOW_HOSTS if you need other sources.
 */

const ALLOW_HOSTS = new Set([
  'www.google.com',
  'maps.google.com',
  'google.com',
]);

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const inUrl = new URL(request.url);
    const target = inUrl.searchParams.get('url');
    if (!target) {
      return new Response('Pass ?url=<target>', { status: 400, headers: cors });
    }

    let upstream;
    try { upstream = new URL(target); }
    catch { return new Response('Invalid URL', { status: 400, headers: cors }); }

    if (!ALLOW_HOSTS.has(upstream.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: cors });
    }

    const res = await fetch(upstream.toString(), {
      headers: {
        // Look like a normal desktop browser — Maps SSRs more cleanly that way.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      cf: { cacheTtl: 600, cacheEverything: true },
    });

    return new Response(res.body, {
      status: res.status,
      headers: {
        ...cors,
        'Content-Type': res.headers.get('content-type') || 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=600',
      },
    });
  },
};
