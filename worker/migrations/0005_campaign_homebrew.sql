-- Homebrew that belongs to a campaign, written by its GMs.
--
-- A player's own homebrew stays in `content`, under their account, and counts
-- on their independent characters. A campaign's characters count this library
-- instead - and the player's own too, only when the campaign's allowHomebrew
-- setting is on. Deleting a campaign deletes its homebrew; characters that
-- carried copies keep them.
--
--   wrangler d1 migrations apply antaera-sheets --remote --config worker/wrangler.toml

CREATE TABLE IF NOT EXISTS campaign_content (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,           -- chosen by the browser that created it
  kind        TEXT NOT NULL,           -- race, class, feat, skill, item, template, feature
  name        TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL,           -- the entry, as JSON
  author      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL,           -- the browser's timestamp; newest edit wins
  PRIMARY KEY (campaign_id, id)
);
