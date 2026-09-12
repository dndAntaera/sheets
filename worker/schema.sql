-- The campaign database.
--
-- Four tables and no more: who has signed in, which browsers are signed in,
-- the characters, and the handful of settings the DM controls. A character is
-- stored as the same JSON the browser holds, with the few fields the roster
-- needs lifted out into columns so listing does not mean parsing every sheet.
--
--   wrangler d1 execute antaera-sheets --file worker/schema.sql --remote

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,        -- the Discord user id
  name        TEXT NOT NULL,
  avatar      TEXT,
  gm          INTEGER NOT NULL DEFAULT 0,
  created     TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);

-- One row per signed-in browser. The cookie holds the token and nothing else,
-- so signing a player out everywhere is a DELETE, not a key rotation.
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created     TEXT NOT NULL,
  expires     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS characters (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  player      TEXT NOT NULL DEFAULT '',
  build       TEXT NOT NULL DEFAULT '',   -- "Fighter 3 // Rogue 3"
  level       INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL,              -- the whole sheet, as JSON
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS characters_owner ON characters(owner);

-- Campaign settings. Gestalt lives here because it is the DM's switch for
-- everyone, not a per-character choice.
CREATE TABLE IF NOT EXISTS campaign (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated     TEXT NOT NULL
);

INSERT OR IGNORE INTO campaign (key, value, updated)
VALUES ('gestalt', 'false', datetime('now'));
