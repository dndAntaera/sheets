-- Feedback: messages sent from the Contact Me page, for the site's admins.
--
-- Anyone may send one, signed in or not. A name, Discord username and email are
-- all optional - whoever sends a message decides how, or whether, to be
-- reached. `sender` is a one-way hash of the network address (or the account,
-- when signed in), kept only to hold a sender to a few messages an hour; the
-- address itself is never stored.
--
--   wrangler d1 migrations apply antaera-sheets --remote --config worker/wrangler.toml

CREATE TABLE IF NOT EXISTS feedback (
  id       TEXT PRIMARY KEY,
  created  TEXT NOT NULL,
  name     TEXT NOT NULL DEFAULT '',
  discord  TEXT NOT NULL DEFAULT '',
  email    TEXT NOT NULL DEFAULT '',
  message  TEXT NOT NULL,
  user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,   -- the account, if signed in when sent
  status   TEXT NOT NULL DEFAULT 'new',                     -- new | read
  sender   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created);
CREATE INDEX IF NOT EXISTS feedback_sender ON feedback(sender, created);
