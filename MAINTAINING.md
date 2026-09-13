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

The engine is tested; the interface is not. `test/suite.js` holds the cases and
runs in two places:

- **In a browser**, at `/test/browser.html` — no Node required.
- **Under Node**, with `npm test` — what CI runs on every push.

`test/load-data.js` names the data files once for both runners.

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
| gestalt | available, player's choice, off | on, the DM's switch |
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

Content lives in two places, on purpose:

- **The library**, in the browser under `antaera-sheets/v1/library`, shared by
  every character made there. Exported and imported as files.
- **The character**, under `content`: a copy of each entry the sheet uses. When
  a field names something on the library shelf, `app.js` copies it in
  (`NAMES_CONTENT`). The engine reads only this copy, which is why an exported
  sheet adds up anywhere.

The "Homebrew on this sheet" panel shows those copies and offers to update one
when the library version is newer.

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

## The campaign server

Optional, and unchanged by the rulesets work: it stores sheets (whatever their
ruleset), signs players in with Discord, and holds the Antæra gestalt switch.
That switch overrides gestalt on Antæra sheets only; SRD sheets are never
touched by campaign settings. Homebrew libraries are not stored on the server —
they stay in each browser, and travel inside the sheets that use them.

### One-time setup

1. **A Discord application** at <https://discord.com/developers/applications>,
   with an OAuth2 redirect of `https://<your-worker>.workers.dev/auth/callback`.
   Only the `identify` scope is used.
2. **A database:** `npx wrangler d1 create antaera-sheets`, paste the id into
   `worker/wrangler.toml`, then
   `npx wrangler d1 execute antaera-sheets --file worker/schema.sql --remote`.
3. **Settings and secrets:** put the DM's Discord user id in `GM_DISCORD_IDS`,
   then `npx wrangler secret put DISCORD_CLIENT_ID --config worker/wrangler.toml`
   and the same for `DISCORD_CLIENT_SECRET`.
4. **Deploy**, locally with `npx wrangler deploy --config worker/wrangler.toml`,
   or by adding `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the
   repository's Actions secrets so every push deploys it.
5. **Point the app at it:** set `apiBase` in `web/config.js` to the Worker URL.

Until step 5 the app is a complete local-only build.

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
