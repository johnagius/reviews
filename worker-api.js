/**
 * Pharmacy Review Tracker — D1-backed API
 *
 * GET    /state                  → all pharmacies + their reviews (public)
 * POST   /import                 → upsert one pharmacy, replace its reviews
 * DELETE /pharmacy/:placeId      → remove one pharmacy and its reviews
 * POST   /clear                  → wipe everything
 *
 * Writes require an `X-Pharm-Token` header matching the PHARM_TOKEN secret.
 * GETs are open so the dashboard serves anonymous viewers.
 *
 * Deploy:
 *   npx wrangler d1 create pharm-reviews
 *     → paste the printed database_id into wrangler.toml
 *   npx wrangler d1 execute pharm-reviews --remote --file=./migrations/0001_init.sql
 *   npx wrangler secret put PHARM_TOKEN
 *     → paste a long random string when prompted
 *   npx wrangler deploy
 *   → copy the printed worker URL into index.html (API_BASE)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pharm-Token',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);

    // Writes require token; reads are open.
    if (request.method !== 'GET') {
      const got = request.headers.get('X-Pharm-Token') || '';
      const want = env.PHARM_TOKEN || '';
      if (!want || got !== want) return json({ error: 'unauthorized' }, 401);
    }

    try {
      if (url.pathname === '/state' && request.method === 'GET') {
        return json(await getState(env.DB));
      }
      if (url.pathname === '/import' && request.method === 'POST') {
        const body = await request.json();
        return json(await importPharmacy(env.DB, body));
      }
      if (url.pathname === '/clear' && request.method === 'POST') {
        await clearAll(env.DB);
        return json({ ok: true });
      }
      const dm = url.pathname.match(/^\/pharmacy\/(.+)$/);
      if (dm && request.method === 'DELETE') {
        const placeId = decodeURIComponent(dm[1]);
        await removePharmacy(env.DB, placeId);
        return json({ ok: true, placeId });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function getState(db) {
  const pharmacies = await db
    .prepare('SELECT place_id, name, is_mine, imported_at FROM pharmacies')
    .all();
  const reviews = await db
    .prepare(
      'SELECT pharmacy_id, review_id, date, ago, stars, author, text, lang, likes, has_response, profile_url ' +
      'FROM reviews ORDER BY date ASC'
    )
    .all();

  const byPharm = {};
  for (const r of reviews.results || []) {
    if (!byPharm[r.pharmacy_id]) byPharm[r.pharmacy_id] = [];
    byPharm[r.pharmacy_id].push({
      id: r.review_id || '',
      date: r.date,
      ago: r.ago || '',
      stars: r.stars,
      author: r.author || '',
      text: r.text || '',
      lang: r.lang || '',
      likes: r.likes || 0,
      hasResponse: !!r.has_response,
      profileUrl: r.profile_url || '',
    });
  }

  return {
    pharmacies: (pharmacies.results || []).map((p) => ({
      placeId: p.place_id,
      name: p.name,
      isMine: !!p.is_mine,
      importedAt: p.imported_at,
      reviews: byPharm[p.place_id] || [],
    })),
  };
}

async function importPharmacy(db, body) {
  const placeId = body && body.placeId;
  const name = (body && body.name) || 'Pharmacy';
  const isMine = !!(body && body.isMine);
  const importedAt = (body && body.importedAt) || new Date().toISOString();
  const reviews = (body && Array.isArray(body.reviews)) ? body.reviews : null;

  if (!placeId || !reviews) {
    throw new Error('bad request: placeId + reviews[] required');
  }

  const stmts = [];

  // Only one pharmacy can be "mine" at a time — clear any other flag first.
  if (isMine) {
    stmts.push(db.prepare('UPDATE pharmacies SET is_mine = 0 WHERE is_mine = 1'));
  }

  // Upsert the pharmacy row.
  stmts.push(
    db
      .prepare(
        'INSERT INTO pharmacies (place_id, name, is_mine, imported_at) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT(place_id) DO UPDATE SET ' +
        'name = excluded.name, is_mine = excluded.is_mine, imported_at = excluded.imported_at'
      )
      .bind(placeId, name, isMine ? 1 : 0, importedAt)
  );

  // Replace this pharmacy's reviews atomically.
  stmts.push(db.prepare('DELETE FROM reviews WHERE pharmacy_id = ?').bind(placeId));

  const insert = db.prepare(
    'INSERT INTO reviews (pharmacy_id, review_id, date, ago, stars, author, text, lang, likes, has_response, profile_url) ' +
    'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)'
  );
  for (const r of reviews) {
    stmts.push(
      insert.bind(
        placeId,
        (r && r.id) || null,
        (r && r.date) || null,
        (r && r.ago) || null,
        (r && Number.isFinite(r.stars)) ? r.stars : 0,
        (r && r.author) || null,
        (r && r.text) || null,
        (r && r.lang) || null,
        (r && r.likes) || 0,
        (r && r.hasResponse) ? 1 : 0,
        (r && r.profileUrl) || null
      )
    );
  }

  // D1's batch() runs as an implicit transaction — all or nothing.
  await db.batch(stmts);
  return { ok: true, placeId, reviewCount: reviews.length };
}

async function removePharmacy(db, placeId) {
  await db.batch([
    db.prepare('DELETE FROM reviews WHERE pharmacy_id = ?').bind(placeId),
    db.prepare('DELETE FROM pharmacies WHERE place_id = ?').bind(placeId),
  ]);
}

async function clearAll(db) {
  await db.batch([
    db.prepare('DELETE FROM reviews'),
    db.prepare('DELETE FROM pharmacies'),
  ]);
}
