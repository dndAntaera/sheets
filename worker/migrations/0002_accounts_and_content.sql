-- Accounts that are not tied to one sign-in provider, and homebrew kept with
-- the account.
--
-- Before this, a user WAS a Discord id. Now a user is an account, and Discord
-- and Google are two ways of proving you own it: one row per provider identity,
-- all pointing at the same account, so a player who signs in with Google on a
-- phone and Discord on a desk finds the same characters and the same homebrew.
--
--   wrangler d1 migrations apply antaera-sheets --remote --config worker/wrangler.toml

CREATE TABLE IF NOT EXISTS identities (
  provider    TEXT NOT NULL,           -- 'discord' | 'google'
  subject     TEXT NOT NULL,           -- the provider's own stable user id
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Whether this identity matched the GM lists when it last signed in. Kept per
  -- identity so a Google email never has to be stored to remember it.
  gm          INTEGER NOT NULL DEFAULT 0,
  created     TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);

-- Every existing account was a Discord account whose id was its Discord id.
INSERT OR IGNORE INTO identities (provider, subject, user_id, gm, created, last_seen)
  SELECT 'discord', id, id, gm, created, last_seen FROM users;

-- Sessions now store a hash of a bearer token rather than a cookie value, so
-- every existing session is void. Signing in again is the whole cost.
DELETE FROM sessions;

-- The roster needs a sheet's ruleset without parsing it, and the DM's view is
-- limited to Antaera sheets. Every sheet stored before now was an Antaera one.
ALTER TABLE characters ADD COLUMN ruleset TEXT NOT NULL DEFAULT 'antaera';
CREATE INDEX IF NOT EXISTS characters_ruleset ON characters(ruleset);

-- A player's homebrew library, one row per entry. Rows rather than one blob, so
-- two devices editing different entries do not overwrite each other.
CREATE TABLE IF NOT EXISTS content (
  owner       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,           -- chosen by the browser that created it
  kind        TEXT NOT NULL,           -- race, class, feat, skill, item, template, feature
  name        TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL,           -- the entry, as JSON
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL,           -- the browser's timestamp; newest edit wins
  PRIMARY KEY (owner, id)
);

CREATE INDEX IF NOT EXISTS content_owner ON content(owner);

-- Short-lived values for the sign-in handshake:
--   'state'  an OAuth request in flight: which provider, which browser nonce,
--            and which account to link to, if any
--   'code'   a one-time code handed back to the app, exchanged for a session
--   'link'   permission, issued to a signed-in account, to attach another
--            provider to it
CREATE TABLE IF NOT EXISTS auth_codes (
  code        TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL,
  data        TEXT NOT NULL,           -- JSON
  created     TEXT NOT NULL
);
