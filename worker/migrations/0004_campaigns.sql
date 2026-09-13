-- Campaigns: a GM, the players they invite, and the characters at the table.
--
-- Before this, "the campaign" was Antaera, implied: a site-wide GM could see
-- every Antaera character, and one gestalt switch applied to all of them. Now a
-- campaign is a row. Whoever runs one sees the characters in it, and nothing
-- else; its settings apply to its characters only.
--
-- The old Antaera arrangement is carried over as a real campaign, so the people
-- who could see those characters yesterday still can today.
--
--   wrangler d1 migrations apply antaera-sheets --remote --config worker/wrangler.toml

CREATE TABLE IF NOT EXISTS campaigns (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  ruleset     TEXT NOT NULL DEFAULT 'srd',
  description TEXT NOT NULL DEFAULT '',
  settings    TEXT NOT NULL DEFAULT '{}',    -- JSON, checked against web/engine/campaign.js
  owner       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS campaigns_owner ON campaigns(owner);

-- Everyone in a campaign, the owner included (as a gm). The owner is told apart
-- by campaigns.owner, not by a role here, so ownership has exactly one source.
CREATE TABLE IF NOT EXISTS campaign_members (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('gm', 'player')),
  joined      TEXT NOT NULL,
  PRIMARY KEY (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS campaign_members_user ON campaign_members(user_id);

CREATE TABLE IF NOT EXISTS campaign_invites (
  code        TEXT PRIMARY KEY,               -- short, readable: ABCD2345EF
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('gm', 'player')),
  max_uses    INTEGER,                        -- null: any number
  uses        INTEGER NOT NULL DEFAULT 0,
  expires     TEXT,                           -- null: never
  created     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS campaign_invites_campaign ON campaign_invites(campaign_id);

-- A character is in at most one campaign. Deleting the campaign releases it.
ALTER TABLE characters ADD COLUMN campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS characters_campaign ON characters(campaign_id);

-- ---------------------------------------------------------------------------
-- Carrying Antaera over
--
-- Its owner is the longest-standing GM, or failing that the longest-standing
-- admin. With neither - a fresh database - there is nothing to carry over, and
-- every statement below finds no campaign and does nothing.
-- ---------------------------------------------------------------------------

INSERT INTO campaigns (id, name, ruleset, description, settings, owner, created, updated)
SELECT 'antaera', 'Antæra', 'antaera',
       'The Antæra campaign, as it was before campaigns existed.',
       json_object('modules', json_object('gestalt',
         json(COALESCE((SELECT value FROM campaign WHERE key = 'gestalt'), 'false')))),
       u.id, datetime('now'), datetime('now')
  FROM users u
 WHERE u.role IN ('gm', 'admin')
 ORDER BY CASE u.role WHEN 'gm' THEN 0 ELSE 1 END, u.created
 LIMIT 1;

-- Every site GM could see Antaera's characters; each is one of its GMs now.
INSERT OR IGNORE INTO campaign_members (campaign_id, user_id, role, joined)
SELECT 'antaera', u.id, 'gm', datetime('now')
  FROM users u
 WHERE (u.role = 'gm' OR u.id = (SELECT owner FROM campaigns WHERE id = 'antaera'))
   AND EXISTS (SELECT 1 FROM campaigns WHERE id = 'antaera');

-- Everyone with an Antaera character is one of its players, and the character is in it.
INSERT OR IGNORE INTO campaign_members (campaign_id, user_id, role, joined)
SELECT DISTINCT 'antaera', c.owner, 'player', datetime('now')
  FROM characters c
 WHERE c.ruleset = 'antaera'
   AND EXISTS (SELECT 1 FROM campaigns WHERE id = 'antaera');

UPDATE characters
   SET campaign_id = 'antaera', data = json_set(data, '$.campaignId', 'antaera')
 WHERE ruleset = 'antaera'
   AND EXISTS (SELECT 1 FROM campaigns WHERE id = 'antaera');

-- The old single `campaign` settings table is no longer read.
