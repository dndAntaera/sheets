# Maintaining the sheets

The repository sits beside the Antæra wiki on the DM's machine:

    F:\! Antaera Claude\antaera_Wiki
    F:\! Antaera Claude\antaera_Sheets

## Running it locally

Python is all that is needed:

```bash
python scripts/serve.py
```

The app is at <http://localhost:8010/web/> and the tests at
<http://localhost:8010/test/browser.html>. The Claude Code launch configuration
in `.claude/launch.json` runs the same server on port 8011.

Do not use `python -m http.server`. It lets the browser cache ES modules, so an
edited `web/engine/build.js` keeps being served stale even through a hard reload.
`scripts/serve.py` sends `no-store` and names UTF-8.

## The tests

Three suites, each a page on the dev server:

| Page | What it tests | Against |
| --- | --- | --- |
| `/test/browser.html` | the engine: every calculation, rulesets, effects, library sync | nothing but the data files |
| `/test/worker.html` | the server: sign-in with both providers, linking, sessions, roles, homebrew and character permissions, the database migrations | the real Worker, on a real SQLite database |
| `/test/client.html` | the app's side of accounts: signing in through `web/store.js`, a library kept in step across two devices | the real Worker and SQLite again |

The engine suite also runs under Node with `npm test`, which is what CI runs.
The other two need the dev server's SQLite stand-in, so they run in a browser.

**How the server is tested without deploying it.** `scripts/serve.py` answers
`/__test/d1` with an in-memory SQLite database built from `worker/migrations`.
D1 is SQLite, so the Worker's own SQL runs against the real engine. Google and
Discord are faked at the network by `test/worker-suite.js`: each test says who
is signing in. A "device" in the client suite is a snapshot of the page's
storage, swapped in and out. Each server case starts from an empty database;
the migration case starts from the old Discord-only schema with data in it.

`/test/app.html` is not a test but a way to look: the real app, talking to the
in-page Worker. `?as=google` signs in as a player, `?as=gm` as a GM, and
`?as=admin` as an admin with two other accounts to manage.

`test/load-data.js` names the data files once for the engine runners.

Add a case whenever you touch a formula. The valuable ones sit where 3.5 rounds,
where multiclassing sums rather than replaces, where gestalt picks the better of
two totals, where bonuses stack or do not — and on the line between rulesets,
which must not leak: a test that an SRD character has no taint is as important
as one that an Antæra character does.

Bugs this suite has caught, worth remembering: an unrecognised class scoring as
a poor progression instead of nothing; the attack routine built from the total
bonus rather than the base, handing out second attacks early; and — in its own
expectations — a halfling's Dexterity bonus counted as +2 from a 12.

## How the rules are layered

    web/data/core.json            what every 3.5 game shares
    web/data/rulesets/srd.json    the default: turns almost nothing on
    web/data/rulesets/antaera.json  the campaign: turns its systems on
    character.content             homebrew one character carries

**Core** holds sizes, the point-buy cost table, the standard array, bonus types
and which of them stack, and the wealth-by-level table. Nothing setting-specific.

**A ruleset** decides the starting level, how abilities may be generated and on
what budget, whether hit point method is locked, whether wealth caps and a level
adjustment cap apply, and — under `modules` — which optional systems exist:

| Module | SRD | Antæra |
| --- | --- | --- |
| gestalt | available, player's choice, off | on, a GM's switch |
| actionPoints | available, player's choice, off | on |
| traitsFlaws | available, player's choice, off | on |
| taint | not available | on |
| backgrounds | not available | on |
| training | not available | on |

`variantsChosenBy` says who decides: `player` (SRD) lets a character's
`options` switch a module; `ruleset` (Antæra) ignores them. Every part of the
engine and the interface asks `engine/modules.js` whether a module is on, so the
two cannot disagree.

A character stores its `ruleset` id. A sheet made before rulesets existed is
migrated to `antaera`, since that was the only ruleset then — see
`engine/character.js`.

### Adding a ruleset

1. Copy `web/data/rulesets/srd.json` to a new id and edit it.
2. Add the id to `RULESET_IDS` in `web/engine/index.js` and to `RULESETS` in
   `test/load-data.js`.
3. If it needs a module that does not exist, add the module name to `MODULES` in
   `engine/modules.js`, its arithmetic to `engine/houserules.js`, its output in
   `engine/derive.js` (as `null` when off), and a panel section in
   `ui/sheet.js` that is drawn only when the module is on.

The toggle picks new rulesets up by itself.

### Keeping Antæra in step with the wiki

`antaera.json` names the wiki page behind each rule; the wiki is the authority.
Backgrounds are copied across by script rather than by hand:

```bash
python scripts/sync-backgrounds.py
```

Two readings deliberately left to the DM: action point `mode` is `refresh`
(printed variant) rather than `accumulate`, and class features stay on the wiki
as free text because the campaign alters them most.

## Effects

`engine/effects.js` is what gives player-written content a say in the numbers.
An effect is:

```json
{ "target": "save.all", "type": "resistance", "value": 2, "condition": "", "perLevel": false }
```

**Targets** are listed in `TARGETS`: the six abilities, `ac`, the three saves
and `save.all`, `attack.all` / `.melee` / `.ranged`, `damage.melee` /
`.ranged`, `grapple`, `initiative`, `speed`, `hp`, `spellResistance`,
`skillPoints.perLevel`, `feats.bonus`, `skill.*`, and `skill.<Any Skill Name>`.
An unknown target is kept and reported as a notice, never silently dropped.

**Stacking** is done once, in `resolveEffects`: within a type the largest bonus
applies; `dodge`, `circumstance` and `untyped` stack; penalties always count.
The sheet's own typed fields — armour, shield, natural, deflection, dodge,
enhancement, inherent, resistance — are turned into effects before resolving, so
a typed +2 deflection and a ring of protection +1 give +2, not +3.

**Conditions** make an effect a note rather than a number. `perLevel` multiplies
by hit dice.

Effects come from the race, templates, feats, features, and equipped items. The
SRD races in `races.json` are written as effects too, which is the best worked
example of the format.

## Content

`engine/library.js` describes the seven kinds of content — race, class, feat,
skill, item, template, feature — as data: each kind's fields and whether it can
carry effects. `ui/content.js` draws every kind from that description, so adding
a field is a one-line change and adding a kind is a new entry in
`CONTENT_TYPES` plus wherever the engine should read it (`contentIndex`,
`resolveEntries`).

Content lives in three places, on purpose:

- **The account**, on the server, one row per entry, when the player is signed
  in. This is the copy that follows them to another device.
- **The library**, in the browser under `antaera-sheets/v1/library`: the working
  copy the editor reads and writes, kept in step with the account.
- **The character**, under `content`: a copy of each entry the sheet uses. When
  a field names something on the library shelf, `app.js` copies it in
  (`NAMES_CONTENT`). The engine reads only this copy, which is why an exported
  sheet adds up anywhere, and why a GM can read a player's homebrew in their
  sheet without ever reading their library.

The "Homebrew on this sheet" panel shows those copies and offers to update one
when the library version is newer.

### Keeping the library in step with the account

Every library entry has an id and an `updated` timestamp. The browser remembers,
per id, the timestamp it last agreed with the server on. `engine/sync.js` turns
those three things into a plan - what to upload, what to delete, what to take -
and `syncLibrary` in `web/store.js` carries it out: on sign-in, on page load
while signed in, and a moment after each edit. The rules:

- the newer copy of an entry wins;
- an entry made before signing in is uploaded on the first sync;
- a deletion on one device removes the entry everywhere;
- when an edit and a deletion collide, the edit wins.

Signing out sends any pending edit, then takes the library off the browser; it
comes back on the next sign-in.

## What is deployed where

| Half | Where | Deployed by |
| --- | --- | --- |
| The app (`web/`) | GitHub Pages, `dndantaera.github.io/sheets` | `.github/workflows/deploy.yml`, on push to `main` |
| The server (`worker/`) | Cloudflare Workers + D1 | the same workflow, if its secrets are set |

Only `web/` is published. The repository must be named **`sheets`** in the
`dndAntaera` organisation for that URL, with *Settings → Pages* set to
**GitHub Actions**.

The legal notices live on the wiki's Disclaimer & Legal page, and the app's
footer links there (`legalUrl` in `web/config.js`). If that page moves, update the
link; if Open Game Content from a new source is added, add its notice there. See
[LEGAL.md](LEGAL.md).

## The server

Optional. Without it the app is complete and everything lives in the browser.
With it, players sign in with **Google or Discord**, and their characters and
homebrew library are kept under their account.

### Accounts

An account is not a Google account or a Discord account; it is an account that
either can prove you own. The `identities` table holds one row per provider
sign-in, each pointing at an account. A signed-in player can add the other
provider from the account menu ("Also sign in with Discord"), and afterwards
reaches the same characters and homebrew from either. An identity already on a
different account is refused rather than moved, because moving it would strand
that account's characters.

**Sessions are bearer tokens, not cookies.** The app is on `github.io` and the
Worker on `workers.dev`, so a cookie would be third-party, and Safari refuses
those. The token is held by the app and sent in an `Authorization` header; the
database stores only its SHA-256. The token never appears in a URL: the Worker
redirects back with a one-time code, which the app exchanges together with a
nonce it kept in `sessionStorage` when sign-in began - so a finished sign-in
cannot be completed by any browser but the one that started it.

**What is stored about a player:** the provider's user id, a display name, an
avatar URL, and their role. Email addresses are read at sign-in to check the
`*_GOOGLE_EMAILS` settings and are not stored.

### Roles

Three levels, each with everything the one below has:

| Role | Their own characters and homebrew | Every Antæra character | The gestalt switch | Accounts and roles |
| --- | --- | --- | --- | --- |
| Player | read, edit | - | - | - |
| GM | read, edit | read, edit | move | - |
| Admin | read, edit | read, edit | move | give and take roles, remove accounts |

Nobody - admins included - reads another player's SRD characters or homebrew
library. An SRD character is built for some other table; homebrew reaches a GM
only inside the sheets that use it. The Accounts page shows an admin how many
characters and homebrew entries an account holds, never what they are.

**Where roles come from.** Everyone starts as a player. Admins change roles on
the Accounts page, which appears in the header only for them. The server's
settings add a floor underneath: an account named in `ADMIN_DISCORD_IDS` or
`ADMIN_GOOGLE_EMAILS` becomes at least an admin when it signs in, and `GM_*`
likewise for GM. The app cannot lower or remove an account below its floor, so
the site can never lose its last way back in. Taking someone off a list does not
demote them - their floor goes at their next sign-in, and then an admin can.

**What the server refuses, whoever asks:** a role below an account's floor;
demoting or removing the only admin; an admin removing their own account from
the Accounts page. Removing an account deletes its sign-ins, sessions,
characters and homebrew with it, by the database's cascades - which is how a
request to delete someone's data is carried out.

A role change applies at once, to sessions already open.

### One-time setup

1. **A database:** `npx wrangler d1 create antaera-sheets`, and paste the id into
   `worker/wrangler.toml`.
2. **Google**, if wanted: in the Google Cloud console, create an OAuth client of
   type *Web application*, with the authorised redirect URI
   `https://<your-worker>.workers.dev/auth/callback/google`. The scopes used are
   `openid`, `email` and `profile`. Set the consent screen to *External* and
   publish it, or only test users can sign in.
3. **Discord**, if wanted: an application at
   <https://discord.com/developers/applications>, with OAuth2 redirects of
   `https://<your-worker>.workers.dev/auth/callback/discord` and - for an
   application registered before Google was added - the old
   `.../auth/callback`, which still works. Only `identify` is used.
4. **Secrets and settings.** For each provider set up:

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID --config worker/wrangler.toml
   npx wrangler secret put GOOGLE_CLIENT_SECRET --config worker/wrangler.toml
   npx wrangler secret put DISCORD_CLIENT_ID --config worker/wrangler.toml
   npx wrangler secret put DISCORD_CLIENT_SECRET --config worker/wrangler.toml
   ```

   A provider without its secrets simply does not appear on the sign-in menu.
   In `worker/wrangler.toml`, name at least one admin - your own Discord id in
   `ADMIN_DISCORD_IDS`, or your Google address in `ADMIN_GOOGLE_EMAILS`.
   Everyone else can then be given a role from the Accounts page; the `GM_*`
   lists are there if you would rather set GMs in configuration.
5. **Deploy.** Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the
   repository's Actions secrets, and every push to `main` applies any new
   migrations and deploys the Worker. By hand instead:

   ```bash
   npx wrangler d1 migrations apply antaera-sheets --remote --config worker/wrangler.toml
   npx wrangler deploy --config worker/wrangler.toml
   ```

6. **Point the app at it:** set `apiBase` in `web/config.js` to the Worker's URL.

Until step 6 the app is a complete local-only build.

### Changing the database

Add a new numbered file to `worker/migrations/` - never edit one that has been
applied - and add a case to `test/worker-suite.js` that starts from the schema
before it (`{ upTo: '000N' }`) with data in place, as the Discord-only upgrade
case does. `0002_accounts_and_content.sql` voids existing sessions, since they
were cookies; everyone signs in once more after it. `0003_roles.sql` turns every
existing DM into a GM, and everyone else into a player.

## The shape of the code

    web/engine/    the arithmetic. No DOM, no fetch, no globals.
      index        makeRules, withRuleset, loadRules
      modules      which optional systems are on, and who decides
      effects      targets, stacking, conditions
      library      content kinds, contentIndex, raceFacts, embedding
      build        the class build and the gestalt best-of rule
      abilities    scores, point buy, rolled arrays, the standard array
      skills       points, costs, caps, armour check penalty, effect bonuses
      hp / defense / offense
      houserules   action points, taint, wealth, LA, feats, training
      derive       composes everything, and produces the notices
      character    the stored shape, blank characters, migration

    web/ui/
      dom             h(), bound fields, bindForm, paint
      sheet           every panel
      effects-editor  the effects table used everywhere
      content         the library view

    web/app.js     routing, the ruleset toggle and variants, saving, auto-embed

The engine never touches the page, and the interface does no arithmetic. An
input, once drawn, is never redrawn while someone is typing in it: panels whose
shape depends on a field are rebuilt on `change`, not on each keystroke.

`web/css/tokens.css` holds every colour and spacing; `sheet.css` contains
neither. Data files are formatted with `python scripts/format-json.py`, which
keeps short arrays on one line.
