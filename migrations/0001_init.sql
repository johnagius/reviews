-- Pharmacy Review Tracker — D1 schema
-- Apply once with:
--   npx wrangler d1 execute pharm-reviews --remote --file=./migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS pharmacies (
  place_id    TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  is_mine     INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id   TEXT    NOT NULL,
  review_id     TEXT,
  date          TEXT    NOT NULL,
  ago           TEXT,
  stars         INTEGER NOT NULL,
  author        TEXT,
  text          TEXT,
  lang          TEXT,
  likes         INTEGER DEFAULT 0,
  has_response  INTEGER DEFAULT 0,
  profile_url   TEXT,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(place_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reviews_pharmacy ON reviews(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_reviews_date     ON reviews(date);
