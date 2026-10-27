-- Motus accounts (Cloudflare D1, SQLite). Apply:
--   npx wrangler d1 execute motus --local --file worker/schema.sql     (local)
--   npx wrangler d1 execute motus --remote --file worker/schema.sql    (production)
-- Every statement is safe to run again.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  changed INTEGER NOT NULL          -- bumped on every data change; the ETag of GET /api/data
);

-- one pending sign-in code per email; only a hash is kept
CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- signed-in browsers; only a hash of the cookie is kept
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- the token inside someone's Motus Shortcut; only a hash is kept
CREATE TABLE IF NOT EXISTS upload_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  used INTEGER
);
CREATE INDEX IF NOT EXISTS upload_tokens_user ON upload_tokens (user_id);

-- one row per person and source ({ days, exercises } as JSON); "health" is filled by the Shortcut
CREATE TABLE IF NOT EXISTS sources (
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (user_id, source)
);

-- a connected Hevy account: the key (encrypted with HEVY_SECRET) and where the last sync got to
CREATE TABLE IF NOT EXISTS hevy (
  user_id TEXT PRIMARY KEY,
  key_enc TEXT NOT NULL,
  since TEXT,                       -- changes after this time are still to fetch
  next_page INTEGER,                -- a sync in progress: the next page of changes
  started TEXT,                     -- when the sync in progress began (becomes "since" when it finishes)
  synced INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS workouts (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS rate (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset INTEGER NOT NULL
);
