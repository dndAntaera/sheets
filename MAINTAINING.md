# Maintaining the sheets

Everything here assumes the repository sits beside the wiki, as it does on the
DM's machine:

    F:\! Antaera Claude\antaera_Wiki
    F:\! Antaera Claude\antaera_Sheets

## Running it locally

Python is all that is needed, and the wiki already requires it:

```bash
python scripts/serve.py
```

Then the sheet is at <http://localhost:8010/web/> and the tests are at
<http://localhost:8010/test/browser.html>.

Do not use `python -m http.server`. It caches, and ES modules are fetched as
subresources, so the browser will keep serving an old `web/engine/build.js`
after you have edited it — including through a hard reload of the page that
imports it. `scripts/serve.py` sends `no-store` on everything and names UTF-8,
which the standard library's server does not do for `.js` or `.json`.

The Claude Code launch configuration in `.claude/launch.json` starts the same
server on port 8011.

## The tests

The engine's arithmetic is tested; the interface is not. Cases live in
`test/suite.js` and run in two places from that one file:

- **In a browser**, at `/test/browser.html`. No toolchain, so this works on a
  machine with no Node installed.
- **Under Node**, with `npm test`, which is what CI runs on every push.

Both use `test/assert.js`, a deep-equality check and a boolean and nothing else.

Add a case whenever you touch a formula. The ones worth having are where 3.5
rounds, where multiclassing sums instead of replacing, and where gestalt picks
the better of two totals — those are where the bugs have actually been. Two
found this way are worth remembering: an unrecognised class was quietly scoring
as a poor progression instead of nothing, and the attack routine was being built
from the total attack bonus rather than the base, which handed a 3rd-level
character with a 16 Strength a second attack it had not earned.

## What is deployed where

Two independent halves, and the first works without the second.

| Half | Where | Deployed by |
| --- | --- | --- |
| The sheet (`web/`) | GitHub Pages, `dndantaera.github.io/sheets` | `.github/workflows/deploy.yml`, on push to `main` |
| The server (`worker/`) | Cloudflare Workers + D1 | the same workflow, if the secrets are set |

The site is published from `web/` alone. `test/`, `worker/` and `scripts/` are
not part of it, which is why the browser test runner lives in `test/` and not
under `web/`.

For the URL to be `dndantaera.github.io/sheets`, the repository has to be named
**`sheets`** in the `dndAntaera` organisation. In the repository's
*Settings → Pages*, set the source to **GitHub Actions**.

## The campaign server

Optional. Without it the sheets are local to each browser and travel as
exported files; with it, players sign in with Discord, their sheets follow them
between devices, and the DM sees every character in the campaign.

It is a Cloudflare Worker in front of a D1 database, both on the free tier,
which does not sleep between sessions. It does no arithmetic — the engine runs
in the browser — so there is no second implementation of the rules to disagree
with the first.

### One-time setup

1. **A Discord application**, at <https://discord.com/developers/applications>.
   Create one, and under *OAuth2* add a redirect of
   `https://<your-worker>.workers.dev/auth/callback`. Note the client id and
   client secret. Only the `identify` scope is used, so the sheet learns a
   player's Discord name and id and nothing else.

2. **A Cloudflare account** and a database:

   ```bash
   npx wrangler d1 create antaera-sheets
   ```

   Paste the id it prints into `database_id` in `worker/wrangler.toml`, then
   create the tables:

   ```bash
   npx wrangler d1 execute antaera-sheets --file worker/schema.sql --remote
   ```

3. **The secrets and settings.** In `worker/wrangler.toml`, set
   `GM_DISCORD_IDS` to your own Discord user id — that is what makes an account
   the DM, able to see every sheet and to move the gestalt switch. Then:

   ```bash
   npx wrangler secret put DISCORD_CLIENT_ID --config worker/wrangler.toml
   npx wrangler secret put DISCORD_CLIENT_SECRET --config worker/wrangler.toml
   ```

4. **Deploy it**, either locally with
   `npx wrangler deploy --config worker/wrangler.toml`, or by putting
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the repository's
   *Settings → Secrets → Actions*, after which every push to `main` deploys it
   and no Node is needed on your own machine.

5. **Point the sheet at it.** Set `apiBase` in `web/config.js` to the Worker's
   URL — `https://antaera-sheets.<subdomain>.workers.dev`, no trailing slash —
   and push. A Sign in button appears in the header.

Until step 5, a deployed sheet stays a local-only build. That is a usable state,
not a broken one.

### How access works

- A player sees and edits their own characters.
- The DM sees and edits every character, and is the only one who can change a
  campaign setting.
- The server checks who owns a sheet; it does not check whether a character is
  legal. A half-built character must be savable, and the notices in the browser
  are what say a sheet is not finished yet.

To make someone else a DM, add their Discord id to `GM_DISCORD_IDS` and deploy
again. To sign every browser out, delete the rows in `sessions`.

## Keeping up with the wiki

Rules data is in `web/data/`, and each houserule names the wiki page it came
from. When a rule changes on the wiki, change it here in the same pass.

Backgrounds are read straight across rather than retyped:

```bash
python scripts/sync-backgrounds.py
```

That rewrites `web/data/backgrounds.json` from the wiki's
`docs/rules/backgrounds.md`. Pass the wiki's path if it is not the sibling
directory.

### Things deliberately left for the DM to decide

- **Action points.** `rules.json` has a `mode` of `refresh` — 5 + half your
  level, renewed each level, the printed variant where unspent points do not
  carry over. The wiki's page omits the sentence about losing unspent points, so
  if the table plays it as accumulating, set `mode` to `accumulate` and the pool
  adds 5 + half the new level at every level instead.
- **Class features.** Hit dice, attack progressions, saves, skill points and
  class skill lists are in `web/data/classes.json`. Class *features* are not:
  they are the half of a class this campaign alters most, so they stay on the
  wiki and the sheet keeps them as free text.

## Adding a class

Splatbook, prestige and homebrew classes do not need a code change. A player
adds one under *Levels → Custom classes*, once, and it then counts exactly like
a printed class: the hit die feeds hit points, the progressions feed the attack
bonus and saves, the skill points feed the budget, and the class skill list
feeds the skill table. Marking it as a prestige class is what makes the sheet
object if two of them share a gestalt level.

Add a class to `web/data/classes.json` only when everyone in the campaign is
likely to want it, and take the numbers from the book rather than from memory.

## The shape of the code

    web/engine/    the arithmetic. No DOM, no fetch, no globals.
      progression  the three class progressions, and the attack routine
      build        the class build, and the gestalt best-of rule
      abilities    scores, point buy, rolled arrays, bonus slots
      skills       points, costs, caps, the armour check penalty
      hp           maximum at first, average or rolled after
      defense      armour class, touch, flat-footed, initiative
      offense      attack bonuses, the routine, weapon lines
      houserules   action points, taint, wealth, LA, feats, training
      derive       composes all of it, and produces the notices
      character    the stored shape of a sheet, and how to make a blank one

    web/ui/        the interface
      dom          h(), bound fields, derived outputs, one paint pass
      sheet        every panel

    web/app.js     the roster, the router, saving, the notices rail

Two rules hold it together. The engine never touches the page, and the
interface never does arithmetic: a derived number on the sheet is an `out()`
naming a path into what `derive()` returned. And an input, once built, is never
rebuilt while someone is typing in it — only the derived outputs are repainted
— which is why the caret never jumps.

`web/css/tokens.css` holds every colour and every spacing, and `sheet.css`
contains none of either. The palette is the wiki's own, so the two sites read as
siblings.
