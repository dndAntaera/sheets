-- Levels of user: player, gm, admin - each with everything the one below has.
--
--   player  their own characters and homebrew
--   gm      also every Antaera character, and the campaign's gestalt switch
--   admin   also the accounts: who holds which role, and removing an account
--
-- A role is stored, and admins change it from the app. The server's settings
-- (ADMIN_* and GM_* in wrangler.toml) set a FLOOR instead: whoever they name is
-- raised to at least that role when they sign in, and cannot be lowered below it
-- from the app. That is what guarantees somebody can always get back in as an
-- admin, however the roles in the app have been rearranged.
--
--   wrangler d1 migrations apply antaera-sheets --remote --config worker/wrangler.toml

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player'
  CHECK (role IN ('player', 'gm', 'admin'));

-- The floor each sign-in carried when it last signed in: 'gm', 'admin', or
-- nothing. Recorded per identity, so a Google address never has to be stored
-- to remember that it was on the list.
ALTER TABLE identities ADD COLUMN floor TEXT
  CHECK (floor IS NULL OR floor IN ('gm', 'admin'));

-- Everyone who was the DM before is a GM now, with the same floor.
UPDATE users SET role = 'gm' WHERE gm = 1;
UPDATE identities SET floor = 'gm' WHERE gm = 1;

-- The old `gm` columns are left in place but no longer read or written. SQLite
-- can drop a column, but nothing is gained by risking it on live data.
