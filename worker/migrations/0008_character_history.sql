-- Changes to finished characters, and the GMs who have seen them.
--
-- Once a character leaves the creator, its choices - race, classes, scores,
-- skills, feats, spells known and the rest (web/engine/locks.js) - are held.
-- `characters.locked` is the server's own copy of them as last finished. When
-- a save arrives finished and different, the difference is added to the
-- sheet's history and kept here too, so the GMs of the character's campaign
-- can be told. Each GM's `seen` marks how far down that list they have read.
--
--   wrangler d1 migrations apply antaera-sheets --remote --config worker/wrangler.toml

ALTER TABLE characters ADD COLUMN locked TEXT;

CREATE TABLE IF NOT EXISTS character_changes (
  id           TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  campaign_id  TEXT REFERENCES campaigns(id) ON DELETE CASCADE,   -- the campaign it was in at the time, if any
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,      -- who saved the change
  created      TEXT NOT NULL,
  changes      TEXT NOT NULL                                      -- JSON: [{ area, label, step, text }]
);

CREATE INDEX IF NOT EXISTS character_changes_character ON character_changes(character_id, created);
CREATE INDEX IF NOT EXISTS character_changes_campaign ON character_changes(campaign_id, created);

CREATE TABLE IF NOT EXISTS campaign_change_reads (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen        TEXT NOT NULL,
  PRIMARY KEY (campaign_id, user_id)
);
