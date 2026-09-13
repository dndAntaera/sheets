-- Profiles: a username and picture a player chooses, and how they like the site to look.
--
-- Until now an account's name and picture were whatever Google or Discord said
-- at the last sign-in. Now a player may choose their own, and sign-in leaves a
-- chosen name alone. The picture follows `picture`:
--
--   NULL               whichever provider was signed in with last (as before)
--   'provider:google'  that provider's, refreshed at each sign-in with it
--   'upload'           one the player uploaded, kept in users.avatar
--   'none'             no picture; the app shows initials
--
-- Each sign-in's own name and picture are kept on the identity, so a player can
-- go back to them without signing in again.
--
--   wrangler d1 migrations apply antaera-sheets --remote --config worker/wrangler.toml

ALTER TABLE users ADD COLUMN name_custom INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN picture TEXT;
ALTER TABLE users ADD COLUMN preferences TEXT NOT NULL DEFAULT '{}';

ALTER TABLE identities ADD COLUMN name TEXT;
ALTER TABLE identities ADD COLUMN avatar TEXT;
