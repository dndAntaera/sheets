-- The Discord bot: which character each account rolls as.
--
-- A person is recognised in Discord by the Discord sign-in on their account
-- (identities), so the bot needs only to remember the character chosen with
-- /character. See worker/src/features/discord.js.
--
--   wrangler d1 migrations apply antaera-sheets --remote --config worker/wrangler.toml

CREATE TABLE IF NOT EXISTS discord_links (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  updated      TEXT NOT NULL
);
