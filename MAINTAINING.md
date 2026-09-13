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
| `/test/worker.html` | the server: sign-in, linking, sessions, roles, homebrew, characters, campaigns and invitations, the permission rules, the database migrations | the real Worker, on a real SQLite database |
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
`?as=admin` as an admin with two other accounts to manage, `?as=table` as a GM
running a campaign two players have joined, and `?as=player` as one of those
players. `/test/worker.html?only=Campaigns` runs one suite, or any test whose
name contains the text.

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

The switches pick new rulesets up by themselves.

**Public or campaign-only.** `"public": true` in a ruleset's file lets anyone
build under it, from the roster. `"public": false` keeps it out of every
switch: a character reaches it only by being brought into a campaign that uses
it, and a player reaches such a campaign only by invitation. The server holds to
the same flag - outside a campaign, a save cannot move a character onto a
ruleset that is not public (one that already has it keeps it). Today the SRD is
public and Antæra is not. With more than one public ruleset, the roster shows a
switch between them; with one, it shows none.

**Making a character takes signing in** when the app has a server (`apiBase`
set): creating, importing and duplicating are offered only to a signed-in
visitor. A build without a server has nobody to sign in to, and stays open.

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
With it, players sign in with **Google** (Discord is supported, and switched off
for now - see `SIGN_IN_WITH` below), and their characters and
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

Three site-wide levels, each with everything the one below has:

| Role | Can |
| --- | --- |
| Player | keep their own characters and homebrew; join campaigns they are invited to |
| GM | also start campaigns, and run them |
| Admin | also manage accounts: give and take roles, remove an account |

A site role does not, on its own, show anyone else's characters. Access to a
character comes from a campaign it is in - see below. Nobody, admins included,
reads another player's homebrew library; the Accounts page shows how much an
account holds, never what.

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
characters, homebrew and the campaigns it owns, by the database's cascades;
other players' characters in those campaigns are released, not deleted.

A role change applies at once, to sessions already open.

### Campaigns

A campaign is a table: an owner, the people they invite, one ruleset, and the
settings its GMs choose for everyone. Any GM or admin can start one.

Within a campaign each member has a role of their own, separate from their site
role:

| In a campaign | Can |
| --- | --- |
| Player | bring their own characters in and take them out; read the house rules; see other players' characters only if the campaign allows |
| GM | also read and edit every character in it, change its settings, invite players, remove players |
| Owner | also invite and remove GMs, change the ruleset, delete the campaign |

**Invitations** are short codes, with a link form (`#/join/CODE`). A GM chooses
how many people each can admit and for how many days; the owner can make one that
admits GMs. Someone opening a link while signed out signs in and comes straight
back to it. Accepting twice does nothing; a player accepting a GM invitation is
promoted.

**Characters** are in at most one campaign. While in one, a character plays by
the campaign's ruleset and settings - the app locks its ruleset toggle and shows
the table's variants as set by the campaign - and the campaign's GMs can edit it.
Only its owner deletes it; a GM takes it out instead. A player removed from a
campaign, or leaving it, takes their characters with them. Deleting a campaign
releases every character in it.

**Settings** are described once, in `web/engine/campaign.js`, and both halves use
that description: the server accepts only settings it lists and coerces their
values; the app draws the settings form from it and applies the campaign's
choices to each character's rules. Today there are the ruleset's variants the GM
decides (all three SRD variants; Antaera's gestalt), a starting level, whether
players see each other's characters, house rules, and a link.

**Adding a campaign setting** is one entry in `GENERAL_SETTINGS` - it is then
validated, drawn in the form, and saved. If the engine should act on it, read it
in `applyCampaign`; if the server should enforce it, ask for it in `policy.js`.

The Antaera campaign that existed implicitly before campaigns - every site GM
seeing every Antaera character, one gestalt switch - was carried over by
migration 0004 into a real campaign with the id `antaera`, owned by the
longest-standing GM, with every site GM as a GM of it, every owner of an Antaera
character as a player, those characters in it, and gestalt as it was.

### One-time setup

1. **A database:** `npx wrangler d1 create antaera-sheets`, and paste the id into
   `worker/wrangler.toml`.
2. **Google**, if wanted: in the Google Cloud console, create an OAuth client of
   type *Web application*, with the authorised redirect URI
   `https://<your-worker>.workers.dev/auth/callback/google`. The scopes used are
   `openid`, `email` and `profile`. Set the consent screen to *External* and
   publish it, or only test users can sign in.
   Which providers are offered is `SIGN_IN_WITH` in `worker/wrangler.toml`,
   currently `"google"`. A provider needs to be listed there **and** have its
   secrets. Switching one off also stops any sign-in with it already under way;
   accounts that signed in with it keep their data, and reach it through any
   other provider they linked.
3. **Discord**, if switched on: an application at
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

   **Or keep them in GitHub instead.** Any of `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `ADMIN_GOOGLE_EMAILS`, `GM_GOOGLE_EMAILS`,
   `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` set as a repository Actions
   secret is sent to the Worker on every deploy (`gh secret set NAME --repo
   dndAntaera/sheets`, then push or run the workflow). Those not set in GitHub
   are left as the Worker has them.
   Name at least one admin. With Google, that is your address in the
   `ADMIN_GOOGLE_EMAILS` **secret** (`GM_GOOGLE_EMAILS` likewise) - a secret, so
   addresses stay out of this public repository, and never also a var in
   `wrangler.toml`, or Cloudflare refuses the duplicate name. Discord ids go in
   `ADMIN_DISCORD_IDS` in `wrangler.toml`, and count only while Discord is on.
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
7. **Check it:** open `https://<your-worker>.workers.dev/health`. Under
   `signIn`, each provider says whether it is `offered`, whether it is
   `switchedOn` in `SIGN_IN_WITH`, and which of its secrets are `missing`, by
   name; `adminNamed` says whether any admin is listed. Values are never shown.

Until step 6 the app is a complete local-only build.

### Changing the database

Add a new numbered file to `worker/migrations/` - never edit one that has been
applied - and add a case that starts from the schema before it
(`{ upTo: '000N' }`) with data in place, as the upgrade cases in
`test/worker-suite.js` and `test/campaign-suite.js` do.

- `0002_accounts_and_content.sql` voids existing sessions, since they were
  cookies; everyone signs in once more after it.
- `0003_roles.sql` turns every existing DM into a GM, and everyone else into a
  player.
- `0004_campaigns.sql` turns the implicit Antaera arrangement into a campaign.

### The shape of the server

    worker/src/
      index.js       assembles the features into one router
      router.js      matches a request to a route; checks sign-in and site role
      http.js        responses, errors, bodies, tokens, cross-origin headers
      sessions.js    bearer-token sessions
      roles.js       site roles: player < gm < admin
      policy.js      every permission rule, as pure functions
      rulesets.js    the rulesets, imported from the app's own data files
      features/
        auth.js        sign-in with Google or Discord; /api/me
        accounts.js    the admin's Accounts page
        characters.js  characters, and who reaches them
        content.js     homebrew libraries
        campaigns.js   campaigns, invitations, members, characters in them

A feature is a module exporting `routes`:

```js
export const routes = [
  { method: 'GET', path: '/api/things/:id', auth: 'user', handler: getThing },
];
```

`auth` is `none`, `user`, `gm` or `admin`, checked before the handler runs. The
handler receives `{ request, env, url, params, user, body(limit) }` and returns a
Response. Anything finer than a site role - may this person change this campaign
- is a function in `policy.js`, which the handler asks with facts it has looked
up.

**Adding a feature**, then, is: a module in `features/`, its rules in
`policy.js`, its tables in a migration, one line in `FEATURES` in `index.js`, a
suite of tests registered in `test/worker.html`, and - if the app needs it - a
group of calls in `web/store.js`, a view in `web/ui/`, and an entry in `VIEWS`
and `NAV` in `web/app.js`.

The worker imports JSON with `with { type: 'json' }`, which needs Wrangler 4; the
deploy workflow pins it.

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

    web/ui/
      campaigns       the campaign list, one campaign, joining by invitation
      admin           the Accounts page

    web/engine/campaign.js  a campaign's settings, and how they apply to a character

    web/app.js     VIEWS and NAV registries, the variants strip, saving, auto-embed

The engine never touches the page, and the interface does no arithmetic. An
input, once drawn, is never redrawn while someone is typing in it: panels whose
shape depends on a field are rebuilt on `change`, not on each keystroke.

`web/css/tokens.css` holds every colour and spacing; `sheet.css` contains
neither. Data files are formatted with `python scripts/format-json.py`, which
keeps short arrays on one line.
