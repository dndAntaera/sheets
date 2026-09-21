# Maintaining the sheets

The repository sits beside the Antæra Wiki on the DM's machine:

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

Bugs this suite has caught, worth remembering: an unrecognized class scoring as
a poor progression instead of nothing; the attack routine built from the total
bonus rather than the base, handing out second attacks early; and — in its own
expectations — a halfling's Dexterity bonus counted as +2 from a 12.

## Housekeeping

The tests prove the arithmetic. `scripts/sweep.py` looks after everything else:

    python scripts/sweep.py

It needs only Python, prints OK or FAIL for each check, and exits non-zero on
any failure. It checks:

- **the code** - every import points at a file that exists, and every name
  imported is one that module exports (following `export * from` chains). A
  stale import loads fine in every other file and stops the whole app, which is
  exactly what a browser test run on one page will not notice. Also: no
  `debugger` or `console.log` left in `web/`; every panel a sheet page or
  creator step names is in `PANELS`; the manifest's icons and the service
  worker's offline shell are files that exist; `web/index.html` lists every
  module the app loads (see Loading fast, below).
- **the data** - every JSON file parses; every feat in `feat-effects.json` is an
  SRD feat; every effect (feats, traits and flaws, races) aims at a target
  `effects.js` knows, or a real skill; classes and races name real feats and
  languages; `srd/feat-rules.json` is what `build-feat-rules.py` would write.
- **the words** - 3.5's spellings (armor, color, favored, defense), not British
  ones; the world's name with its ligature, Antæra, in anything a person reads
  (identifiers stay `antaera`); the Antæra Wiki as a proper name.
- **safety and the license** - no personal email committed (admin and GM
  emails are Worker secrets); no secret set in `wrangler.toml`; every data file
  identified in `LEGAL.md`.

Run it after any change, and certainly after editing a data file by hand. **A
new rule** is a `check(...)` in the right section: give it a name that says what
should be true, and list what is not.

## Safeguards

GitHub Pages publishes whatever reaches `main`, and every player's sheet opens
in whatever it publishes. Three things stand in the way of a bad commit.

### 1. Pre-push guard

`.githooks/pre-push` runs before anything leaves this machine and refuses the
push if:

- it would delete a branch on GitHub,
- the number of files under `web/` would drop below 70% of what is published
  (an accidental mass delete), or
- the housekeeping sweep fails.

A deliberate large change gets through with an explicit override:

```bash
ALLOW_DESTRUCTIVE=1 git push
```

Hooks are not carried by `git clone`, so on a fresh copy enable them once:

```bash
git config --local core.hooksPath .githooks
```

### 2. CI

The deploy workflow runs the engine suite and the sweep before it builds; if
either fails, nothing is published and the previous version stays live.

### 3. Rolling back a bad deploy

History is the backstop, so recovery is a revert rather than a repair:

```bash
git revert --no-edit <bad-sha>
git push
```

The workflow republishes within a couple of minutes. A Worker change rolls back
the same way; a database migration does not - write a new migration that undoes
it. To find the commit that introduced a problem, `git log --oneline` and compare
against the last run that was known good.

If the working tree itself is damaged, discard it and take the published
history instead:

```bash
git fetch origin
git reset --hard origin/main
```

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

**Characters and homebrew take signing in** when the app has a server
(`apiBase` set): the Characters and Content pages, every sheet, and creating,
importing and duplicating are for a signed-in visitor (`signedIn` in `app.js`);
anyone else gets the front page, or a sign-in prompt in place of the page they
asked for. A build without a server has nobody to sign in to, and stays open.

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
The sheet's own typed fields — armor, shield, natural, deflection, dodge,
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

Content lives in these places, on purpose:

- **The account**, on the server, one row per entry, when the player is signed
  in. This is the copy that follows them to another device.
- **A campaign**, on the server (`campaign_content`), written by the campaign's
  GMs from `#/campaign/<id>/homebrew` and read by its members. The app holds it
  in memory only (`campaignLibrary` in `store.js`), fetched afresh when a sheet
  in the campaign opens.
- **The library**, in the browser under `antaera-sheets/v1/library`: the working
  copy the editor reads and writes, kept in step with the account.
- **The character**, under `content`: a copy of each entry the sheet uses. When
  a field names something on the library shelf, `app.js` copies it in
  (`NAMES_CONTENT`). The engine reads only this copy, which is why an exported
  sheet adds up anywhere, and why a GM can read a player's homebrew in their
  sheet without ever reading their library.

The "Homebrew on this sheet" panel shows those copies and offers to update one
when the library version is newer.

**Whose homebrew counts** is one function, `usableContent` in
`engine/library.js`, which `derive` applies before anything else reads content:

| Character | Counts |
| --- | --- |
| Independent | everything it carries |
| In a campaign | the campaign's library, as its GMs wrote it (not the sheet's copy) |
| In a campaign that allows homebrew | that, and the rest of what it carries |

A copy of a campaign's entry on a sheet is marked `campaign: <id>`; offline, those
copies stand in for the campaign's library. What does not count is kept on the
sheet, listed in `derived.homebrew.blocked`, and raised as a notice. The app
follows the same rule for what it suggests and copies in (`shelvesFor` in
`app.js`). The Content page, and the Content link, need a signed-in visitor.

### The SRD reference

`web/data/srd/` holds the SRD's spells, powers, feats, classes (with their
tables), domains and equipment, built by `scripts/build-srd.py` from Andargor's
SRD 3.5 database (the SQLite edition). The text keeps a handful of formatting
tags and no attributes, so the app can show it as written. Rebuild with:

    python scripts/build-srd.py path/to/dnd35.db

`web/reference.js` fetches a kind only when something asks for it, and keeps it;
`lookUp(kind, name)` finds an entry whatever its capitals. The Reference page
(`web/ui/reference.js`, `#/reference/<kind>/<name>`) searches and filters them,
and its `referenceCard` is how the sheet shows an entry too: a feat's "About",
a spell's "Details". Armor, shields and weapons picked by an SRD name fill in
their numbers (`fillFromEquipment` in `app.js`).

`progression.json` is the small part the engine loads with the app: spell
slots, spells known, power points, powers known, highest power level and class
specials, per class, per level. The engine also loads, with the app:

- `srd/feat-rules.json` - each feat's types, prerequisites as written, whether it
  can be taken again and on what, and whether it is a fighter bonus feat. Built
  from `feats.json` by `scripts/build-feat-rules.py`; rerun it after
  `build-srd.py`.
- `srd/traits.json` - Unearthed Arcana's traits and flaws, each with its effects,
  its choice (the skill Illiterate improves) and who may take it. Written by hand
  from the SRD's trait and flaw pages.
- `srd/languages.json` - the SRD's languages, their speakers and alphabets.
- `srd/domains.json` - for the domains' granted powers.
- `data/feat-effects.json` - what the SRD's feats do to the numbers, as effects:
  Toughness's +3 hit points, Skill Focus's +3 on the skill chosen. Written by
  hand; a feat not in it is still taken and shown, it just changes no number.

Traits & flaws and languages are Reference kinds too.

### The sheet's pages

`web/ui/sheet-pages.js` lists the sheet's pages (`#/sheet/<id>/<page>`) and the
panels and notice fields each one has. `openSheet(id, { page })` draws only that
page's panels; the Full sheet draws every panel and is what prints. A new page
is an entry there.

### Spells and powers

`web/engine/magic.js` turns the class tables into what a caster or manifester
has today: spells per day (table + bonus spells + domain or specialty slot,
closed above the ability score's limit), spells known, caster level, save DCs,
and one pool of power points (table + modifier x level / 2) with powers known
and the highest level. What the player has done is `character.magic`:
spells known or in a spellbook, spells prepared slot by slot, spells cast,
domains, specialty and prohibited schools, a psion's discipline, power points
spent. `restedMagic` is a night's rest. Which classes cast is `casting` and
`manifesting` in `web/data/classes.json`, with `spontaneous`, `spellbook`,
`half`, `domains` and `disciplines`. The Spell or Powers Sheet is
`web/ui/magic.js`.

### Inventory, equipment, the shop and attacks

`web/engine/inventory.js` and `web/ui/inventory.js`, over the sheet's Equipment,
Inventory and Shop pages, and the attack cards on Combat.

- **The inventory** is `character.wealth.items`: a row an item, with an `id`,
  `qty`, `weight` and `value` each, `category`, and - for a weapon, armor or
  shield - `stats` copied in when it is bought (`itemFromReference` reads an SRD
  equipment entry), so the sheet never needs the reference to add up.
- **Money is a ledger**, `character.wealth.ledger`: coins are the starting wealth
  plus every entry. `buyItem` writes a `purchase` (negative, with its `itemId`)
  as the item arrives, so using some up gives nothing back; `removeItem` can
  `refund` that purchase, `sell` for half the value, or `discard`. A sheet from
  before the ledger keeps its hand-counted coins as `legacyCoins`.
- **Equipment** is `character.equipment`: `armor`, `shield`, `weapons` (any
  number) and `slots` (the 3.5 body slots in `BODY_SLOTS`), each holding an item
  id. `slotChoices` says what fits a slot and how many are free. derive() reads
  armor and shield from their slots (`equippedGear`), and an item's effects
  count while it is in a slot - or, on an older row with no statistics, unless
  it is marked unworn.
- **Load**: `carryingCapacity` and `inventoryTotals` weigh items and coins (50 to
  the pound); a medium or heavy load caps Dexterity and sets a check penalty,
  the worse of it and armor's (`defense.js`).
- **Attacks**: `attackFor` works out one weapon's routine, damage and critical
  with the choices on the Combat page - two-weapon fighting, Power Attack,
  Combat Expertise, fighting defensively, charging, flanking, higher ground,
  Rapid Shot, Point Blank Shot - kept in `character.combat.calculator`.
- **Custom items** are asked for their values (a weapon's damage and critical,
  armor's bonus and penalties) and saved to the player's own library with
  `inventoryItem: true`. `usableContent` lets those count in a campaign that
  allows no homebrew, and the shop's Your items tab offers them anywhere.
- `migrateInventory` (run by `migrate()`) moves an older sheet's typed armor,
  shield, weapons and coins into all of this, once.

### Feats, class features, languages and wealth

- **Feats** (`web/engine/feats.js`). `featSlots` lists every slot a character
  has - the 1st-level feat and one every third hit die, a race's bonus feat, a
  class's bonus feats (`bonusFeats` in `web/data/classes.json`: a named `list`, or
  `choices` by level for a monk and a ranger), one per flaw, and any typed in -
  and the feats a class simply grants (`grantedFeats`). `parsePrerequisites`
  reads the SRD's prerequisite words into clauses; `stateAtLevel` is the
  character as it stood at a level (its base attack bonus, caster level, class
  levels, scores and the feats held before), and `featEligibility` checks one
  against the other. `featPlan` puts it together, and `featOptions` is what a
  slot's dropdown offers. A feat row on the character is `{ name, choice, slot }`.
- **Traits and flaws** (`web/engine/traits.js`) resolve a row `{ name, choice }`
  against `srd/traits.json`; their effects join the rest, their notes are listed
  with the special abilities.
- **Class features** (`web/engine/features.js`) are read from each class's
  "Special" column, one feature per name with its latest step ("Sneak attack
  +3d6"). `featureEffects` turns the ones that are numbers into effects (divine
  grace, a monk's AC bonus and fast movement, trap sense...). A cleric's domains
  (`DOMAIN_RULES`) add class skills, granted feats, trackers and effects. The
  Special abilities panel (`web/ui/feats.js`) shows each with its SRD text, cut
  from the class's description.
- **Languages** (`web/engine/languages.js`): a race's automatic languages and
  bonus languages (`languages` in `races.json`), a class's (`classes.json`), one
  bonus language per point of starting Intelligence bonus, and a language a rank
  of Speak Language. The character stores the names chosen, `character.languages`.
- **Starting wealth** (`wealth` in `web/engine/houserules.js`): a campaign's
  `startingWealth` setting, else an independent character's own figure, else
  wealth by level - the class's average starting gold at 1st level
  (`startingGold` in `classes.json`).

### Ability scores

Point buy is a dropdown of the scores it allows, with their cost. The standard
array and rolled scores are a set to place: `scorePlacement` in
`web/engine/abilities.js` says which score of the set each ability holds
(`abilities.placed`), and `placeScore` puts one there, swapping with whichever
ability held it. Rolls (`newAbilityRolls`, 4d6 drop the lowest) are kept on the
character as `abilities.rolls`, with how many times they were rolled; scores
rolled at the table can be typed in instead, and the sheet says they were.

### Limited uses

`web/engine/trackers.js` lists everything with uses per day or week: read from
class table specials ("rage 2/day"), from the SRD's formulas (turning, bardic
music, stunning fist, lay on hands, a monk's abilities), and from any feat,
feature or item row - or homebrew entry - given a number of uses. Used counts
are `character.trackers[key]`, or `usesUsed` on the row. `restedTrackers` is a
rest ('day') or a new week ('week'). The panel is on the Feats page.

### Variant rules

Every variant rule in the SRD (Unearthed Arcana) is a module, beside gestalt,
action points and traits and flaws: `VARIANT_MODULES` in `web/engine/modules.js`.
They come in three kinds, and the creator treats each differently:

- **Content** (`CONTENT_MODULES`) - variants that are only more to choose from:
  environmental and elemental races, paragon, generic and prestigious classes,
  class variants (bardic sage, spontaneous cleric), spelltouched and weapon group
  feats, and the specialist wizard and druid feature variants. They are never
  switched on. Their races are in the race list, their classes in the class
  list, their feats in the feat dropdowns, for every character - unless a
  campaign's GMs take them off the table in its settings. A class variant is a
  class of its own name on a level row ("Cloistered cleric"), read back to the
  class it varies by `classVariantView`, so domains, spells and class features
  all still know it as a cleric.
- **Building** (`BUILD_MODULES`) - gestalt, traits and flaws, the two skill
  systems, character background: switched in the creator's Concept step,
  because they change the steps after it.
- **Play** (`PLAY_MODULES`) - everything else: switched in the creator's
  Advanced step, with the choices each needs. The sheet's Rules page lists what
  is in force.

- `web/data/variants.json` is the catalog - each variant's name, category, what
  it does, and what the sheet does about it - and the SRD tables the engine
  reads (defense bonus, magic rating, spell points, craft points, contacts,
  reputation, honor, recharge times, spontaneous divine spells known, reducing
  level adjustments, bloodline levels, the paragon classes). Its rule text is
  `web/data/srd/variants.json`, for the Reference page. Both are built by
  `scripts/build-variants.py` from the SRD's variant pages.
- `web/data/srd/variant-content.json` is the content variants as data: each
  environmental or elemental race as its core race with what it adds, removes
  and replaces; the prestige bard, paladin and ranger (tables and class skills
  read from the rule text, with the levels that add to an existing
  spellcasting class); spelltouched and weapon group feats; and what each
  specialist or druid variant takes the place of. `scripts/build-variant-content.py`
  writes it, and the sweep checks it is current.
- `web/engine/variants.js` is the rules: class variants, generic, paragon and
  prestigious classes (`variantClassIndex`, `classVariantView`), variant races
  (`variantRaceIndex`), class feature variants (`applyFeatureVariants`: a traded
  bonus feat or school slot is removed, a variant's class skills added), defense bonus and armor as DR
  (`variantArmorClass`), vitality and wounds, reserve points, injury, massive
  damage, death and dying, damage conversion and taint (`variantHealth`), craft
  points, contacts, reputation, honor, sanity, bloodlines and level adjustment
  reductions (`variantScores`), magic rating, spell points, recharge times and
  spontaneous metamagic. `magic.js` and `skills.js` read the rest: spontaneous
  divine casters, battle sorcerer and bardic sage casting, the alternative
  skill systems. A player's choices within a variant are `character.variants`.
- Variants that change only how the game is played at the table - hex grid,
  combat facing, complex skill checks, incantations and so on - are switched on
  like the others, noted where they apply, and open to their full text.
- `web/ui/variants.js` draws them: the rules of play in the creator's Advanced
  step (`advancedRulesPanel`), a class's own choices in the Class step
  (`classChoicesPanel`), the rules in force on the Rules page
  (`rulesInPlayPanel`), what the
  adventuring variants change on the Combat page, and the scores and tracks on
  the Feats page. The SRD taint variant is `uaTaint`, separate from Antæra's
  corruption and depravity (`taint`).

### The character creator

A new character opens in a wizard (`web/ui/wizard.js`, at `#/create/<id>/<step>`)
rather than on the sheet. It is not a second sheet: `openSheet(id, { wizard })`
draws one step's panels from the same `PANELS` the sheet uses, binds them the
same way, and recomputes the same derived character - so a step shows exactly
the numbers and notices the sheet would. What the wizard adds is order, the
words at the top of each step, and a box for finding a race.

Each step in `WIZARD_STEPS` names its panels, the notice fields it answers for
(the rail shows only those; the review shows all), and optionally a `body` of
its own. **Adding a step** is an entry there. A character in the creator carries
`meta.wizard.step`, which the character list reports as `draftStep` so a draft
reopens where it was left; Finish removes it and opens the sheet.

The race is one box that narrows a list as it is typed. The creator builds a
character rather than plays it: uses per day, spell slots and power points show
their maximums, but nothing is cast, spent or rested until the sheet (panels
check `app.wizard`).

Every step opened is added to `meta.creatorVisited`. Finishing - or "Skip to the
full sheet" - with steps never opened keeps them in `meta.creatorSkipped`: the
sheet then shows a warning for each, and a link back, until the step is opened.
The creator does not buy equipment; that is the sheet's Inventory and Shop pages.

The steps are Concept (with the switches that change how a character is built:
gestalt, traits and flaws, the skill systems), Race, Class (the Levels panel,
and Class choices for a generic or paragon class, a druid's aspect of nature or
a prestige class's requirements), Ability scores, Skills, Feats, Hit points &
wealth, Spells, languages & story, Advanced (the rules of play) and Review.

### Held choices and change history

Once a character leaves the creator, what it is built of is held
(`web/engine/locks.js`): race, classes and class choices, ability scores and
level increases, skill ranks, feats, traits and flaws, hit point rolls, spells
and powers known (and a specialist's school, a cleric's domains), languages,
and the rules it plays by. On the sheet their fields are disabled
(`LOCKED_FIELDS` by path; `holdChoices` in app.js also disables controls marked
`data-lock`); the sheet does not point the player at the creator. Everything
that is play - hit points, spells prepared and cast, uses, gear, notes - stays
open.

"Open in the creator", in the toolbar, opens a finished character in the wizard again. It is
saved as it stands first, then `beginRevision` copies its held choices into
`meta.wizard.revision`. The review step lists what has changed
(`revisionChanges`); "Save the changes" finishes, "Discard changes" puts every
held choice back (`restoreLocked`).

Changes are written into the sheet's own `history` - `[{ id, at, by, changes }]`,
each change `{ area, label, step, text }`. When signed in, the **server** writes
them: `characters.locked` keeps the summary of the choices as last finished
(`lockedSummary`), and a finished save that differs adds an entry to the stored
history (a sheet's own history is never trusted) and a row to
`character_changes`. The GMs of the character's campaign see those rows on the
campaign page, with a count beside Campaigns in the header until they mark them
read (`campaign_change_reads`). With no server, the browser writes the entry
itself. A sheet with history shows a History page.

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

## Modules: a sheet keeps what it uses

A character in memory is whole - every field `blankCharacter` describes. The
file is not. `engine/sheet-modules.js` packs a character on the way out and
fills it on the way in:

- **What a new character would have anyway is left out.** A skill nobody put a
  rank in is not a row; an empty inventory is not a field.
- **What is left is grouped into modules** - spells, inventory, feats,
  languages, effects, trackers, variants, taint, action points, story,
  homebrew, history - and the file records which it has, in `modules`. A
  fighter's file says `[]`; a wizard's says `["spells", ...]`.
- **Nothing else changes.** `fillCharacter` puts the whole character back
  before the sheet sees it, so no panel has to ask whether a part exists, and a
  file from before this (which kept everything) reads exactly as it did.

A blank sheet went from 3.8 KB to 169 bytes, a played 5th-level wizard from
4.2 KB to 842 bytes. The Discord bot's roll snapshot is written for the account
server only; this browser recomputes it on every save, so it is not in the
local file.

The same modules decide what **data** is fetched. `DATA_PACKS` in
`engine/index.js` holds the rules only some sheets need - Unearthed Arcana's
races, classes and feats with the variant tables (110 KB), the traits and flaws
(20 KB), the domains (13 KB) - and `loadRules` takes the packs to fetch;
`addPacks` adds one later without fetching anything twice. `packsForCharacter`
reads a character and says which it needs: a race or class or feat the core
data does not know means the variant content, traits or flaws mean the traits,
and anything with spells means the domains. The creator asks for all of it,
because a player choosing a race is choosing from everything. Opening a Human
Fighter's sheet now fetches 143 KB of data rather than 265 KB.

Everything that reads this data already copes with its absence (`rules.traits
|| []`, `rules.variantContent?.races`), so a pack that is not there means those
options are not offered - never a broken sheet. **Adding a data file** that
only some sheets need: name it in `DATA_PACKS`, and say when it is wanted in
`packsForCharacter`.

The same modules decide what the app fetches. `ui/lazy.js` names the parts that
arrive only when wanted - the casting panel, the inventory, feats, the variant
panels, the campaign, Accounts, homebrew, reference, profile and feedback pages
- and a page fetches what its own panels are drawn by, no more. A fighter's
sheet never downloads the casting panel; someone who never opens Accounts never
downloads it. Around 200 KB of the interface is behind that.

**Adding a panel or page** that is not needed on every sheet: name its file in
`ui/lazy.js`, and draw it with `fromPart` (a panel) or `fromPage` (a page) in
`app.js`. Anything a page needs is fetched before that page is drawn, so the
panel itself is written no differently.

## What a sheet leaves out

The rule is narrow: **a sheet keeps everything a character has, and drops only
what it does not**. A fighter needs no spell sheet, a character who manifests
nothing needs no powers known, a table that does not use action points needs no
tracker for them. An empty inventory, an empty feat list and a skill with no
ranks in it are not the same thing - they belong to the character and stay, with
the line that says how they fill in.

In practice that means a panel is drawn when it has something to say for *this*
character: `houserulesPanel` returns null unless action points or taint are in
play, the casting panel is skipped for a character with no casting class (and
its part is never fetched - `partsFor` in app.js), and the Spells page tab is
hidden the same way. A new optional system follows suit: its panel returns null
when the character does not use it, and it is named in `SHEET_MODULES` so it is
not written into the file either.

## The catalog

`ui/catalog.js` puts what a character may be built from beside the step that
builds it: races on the Race step, classes on the Class step, feats on Feats,
items on Hit points & wealth. Each entry is shown the way the library shows it
- its fields, what it does on the sheet, and where it came from - and a race or
a class can be taken straight from it.

It appears only for a table with content of its own: a campaign, a ruleset
beyond the SRD, or homebrew somebody wrote (`hasContentOfItsOwn`). On the plain
SRD the pickers already list everything.

- **Sources** are gathered in order: the character's own copies, the campaign's
  library, the player's homebrew, the variant content, then the rules. A name
  met twice keeps the nearest copy.
- **Sorted** A to Z or gathered under each source, and searchable. A list longer
  than 120 is cut short, with a line saying how many more there are.
- **The words** come from the reference when the rules keep them there (a
  feat's benefit, an item's description), fetched once the catalog is open.
  Markup from the rules is shown as markup; anything a person at the table
  wrote is shown as text, never handed to the page as markup.
- **On a phone** the panel is one line - "Browse 39 races" - that opens a sheet
  from the foot of the screen: the list, then the entry with a way back, and
  the buttons at the bottom where a thumb already is. The same list and preview
  are used in both layouts, and turning the phone redraws it.

## Loading fast

Three things keep the first load short and the next ones shorter:

- **Every module named up front.** A browser only learns what `app.js`
  imports once it arrives, so without help the modules come in waves.
  `web/index.html` names them all with `<link rel="modulepreload">` so they
  download together. The list is written by a script and the sweep fails while
  it is out of step, so after adding, removing or renaming a module run:

      python scripts/build-preload.py

- **Data stamped with its build.** The deploy writes the commit into
  `web/config.js` (`version`), and the rules data and the SRD reference are
  asked for as `file.json?v=<commit>`. The service worker keeps a stamped file
  and serves it straight away until the next deploy asks for a new stamp. A
  working copy says `version: 'dev'`, and every file is checked with the server
  each time, so an edit shows on reload.
- **Saves without the history.** The server keeps a character's history of
  held choices itself, so a character it already has is saved without it.

## What is deployed where

| Half | Where | Deployed by |
| --- | --- | --- |
| The app (`web/`) | GitHub Pages, `dndantaera.github.io/sheets` | `.github/workflows/deploy.yml`, on push to `main` |
| The server (`worker/`) | Cloudflare Workers + D1 | the same workflow, if its secrets are set |

Only `web/` is published. The repository must be named **`sheets`** in the
`dndAntaera` organization for that URL, with *Settings → Pages* set to
**GitHub Actions**.

## Branding

The Antæra logo is kept beside the repositories, in `antaera_Shared_Images`:
`logo_Antaera.png` for icons, and `logo_Antaera_02.png` (transparent) for the
logo on the site. `scripts/build-brand.py` makes every size the site uses from
them - the tab icon, the app icons (one padded for Android's shaped icons), an
iPhone's home-screen icon, and the logo images in `web/brand/` - so rerun it when
the logo changes:

    python scripts/build-brand.py

The sheets wear the wiki's look, so a player moving between them does not feel
they have left:

- **The header bar** is the wiki's: the full width of the window, in the
  accent purple, the logo on a white disc (`logo-disc-96.png`, made the way the
  wiki's is) and the name in bold white. A player who picks another accent in
  Settings gets the bar in that color.
- **The sky** is the wiki's starfield. `web/starfield.js` is the wiki's
  `docs/javascripts/starfield.js` with this site's class names and its own
  reduced-motion setting; change the sky in the wiki first, then copy it here.
- **The colors, type and spacing** in `web/css/tokens.css` are the wiki's own
  values under this site's names.

Elsewhere on the dark sky the transparent logo is used. Where purple text,
buttons or glow sit close to it - the landing page - the white-ground version is
used as a rounded badge, so the logo's purple does not run into the site's.

## The mobile app

The site is built to be a phone app as it stands, and to be wrapped as a native
one without changing how it works.

**Installable now.** `web/manifest.webmanifest` and `web/sw.js` make the site a
progressive web app: on Android, Chrome offers *Install app*; on an iPhone,
Safari's *Share → Add to Home Screen*. It opens full screen with its own icon
(`web/icons/`, made by `scripts/build-brand.py` - see Branding below). The service worker fetches
network first and keeps a copy of everything the site has loaded, so the app
opens offline and a deploy is never held back by a stale cache. Data files
stamped with their build are the exception: they are served from the copy until
the next deploy (see Loading fast). Characters
edited offline are saved in the browser by the app itself and sent to the
account when it is back online, as they always were.

**Built for a phone.** The layout is one column below 62rem; the header puts the
links on a row that scrolls sideways; the sheet's page tabs stay at the top
while scrolling; the notices fold to a single line; controls are larger and
fields are 16px on touch screens (so a phone does not zoom in on them); and the
header and content keep clear of a notch (`viewport-fit=cover` and the
safe-area insets). Anything wide - a class table - scrolls inside its own box.
Check a change at 375px wide: nothing but those boxes should scroll sideways.

**Wrapping as a native app** (Capacitor, or any web-view shell). Everything the
app needs is static files in `web/` and one server address, so a shell can load
`web/` as it is:

1. Create the shell project around `web/` as its web directory
   (Capacitor: `webDir: "web"`). Routes are in the address's hash, so no server
   rewriting is needed.
2. Give the shell a link scheme of its own (for example `antaerasheets://`) and
   set `appReturnUrl` in `web/config.js` - in the shell's copy - to the address
   sign-in should come back to, such as `antaerasheets://app/`.
3. On the Worker, add the web view's origins to `APP_ORIGINS` (Capacitor:
   `capacitor://localhost,https://localhost`) and that return address, exactly,
   to `APP_RETURN_URLS`. The Worker refuses any return address not listed.
4. Google does not allow sign-in inside a web view: the shell opens
   `/auth/start` in the system browser (`remote.signIn` takes a `navigate`
   function for this), and when its link scheme is opened with
   `#/signed-in/<code>`, hands that hash to the web view, which finishes the
   sign-in as the website does.

The legal notices live on the wiki's Disclaimer & Legal page, and the app's
footer links there (`legalUrl` in `web/config.js`). If that page moves, update the
link; if Open Game Content from a new source is added, add its notice there. See
[LEGAL.md](LEGAL.md).

## The server

Optional. Without it the app is complete and everything lives in the browser.
With it, players sign in with **Google or Discord** (see `SIGN_IN_WITH` below),
and their characters and
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

### Contact Me and feedback

The Contact Me page (`#/contact`, linked in the footer) lets anyone send a
message, signed in or not, with a name, Discord username or email if they
choose. `web/engine/feedback.js` is the one description of what a message may
hold; the page checks it before sending and the Worker
(`worker/src/features/feedback.js`) again before storing it in the `feedback`
table. Admins read them on the Feedback page (`#/feedback`): newest first, New,
Read or All, marked read or new, deleted.

Two things keep the form from being flooded: a field people never see, which a
bot fills in and whose message is silently dropped, and a limit of a few
messages an hour per sender - a hash of the network address (salted with
`FEEDBACK_SALT` if set), or of the account when signed in. The address itself is
never stored. The Privacy Policy describes all of this; change it with the form.

### The Discord bot

A table can roll from its sheets in Discord: `/roll what [character]` rolls a
skill, save, ability, initiative, a weapon (attack, a confirmation roll on a
threat, and damage) or plain dice, with a `+2` or `-1` on the end for a
situational modifier; `/sheet` shows a character's numbers; `/character` picks
which character a person rolls as. What to roll autocompletes from the sheet.
Each has a one-letter shortcut that works the same way: `/r 1d6` is
`/roll 1d6`, `/s` is `/sheet` and `/c` is `/character` (`SHORTCUTS` in
`discord.js`, and a second entry in `discord-commands.json`, which the tests
check agree).

It is an HTTP interactions endpoint on the Worker, `POST /discord/interactions`
(`worker/src/features/discord.js`): no gateway, no process to keep running.
Every request is checked against the application's Ed25519 public key, and an
unsigned one is refused. A person is recognized by the Discord sign-in on their
account - signing in with Discord, or linking it in Settings, is all it takes -
and rolls from the characters that account can see. `discord_links` remembers
the character chosen with `/character`.

The Worker does no arithmetic. Each time the app saves a sheet it writes
`character.rolls`, a small snapshot of what a roll needs (`rollSheet` in
`web/engine/rolls.js`), and the bot rolls from that with the same file's
`rollFor`. A sheet saved before the bot existed asks to be opened once.

Setting it up, once:

1. In the Discord developer portal, open the application the sheets already
   sign in with (or make one). On its General Information page, copy the
   **Public key**.
2. Add it to the Worker as `DISCORD_PUBLIC_KEY` - a repository secret of that
   name is sent on the next deploy, or set it in the Cloudflare dashboard.
   `/health` then shows `"discordBot": true`.
3. Still on General Information, set **Interactions Endpoint URL** to
   `https://<the worker's address>/discord/interactions`. Discord checks it with
   a signed ping as you save.
4. On the Bot page, make a bot and copy its token (keep it to yourself). On
   OAuth2, invite it to your server with the `applications.commands` scope.
5. Register the commands, from this folder:

       set DISCORD_APPLICATION_ID=<the application id>
       set DISCORD_BOT_TOKEN=<the bot token>
       python scripts/register-discord-commands.py <your server id>

   With a server id they appear there at once; without one they are global.
   Rerun it whenever `scripts/discord-commands.json` changes.

### Profiles and settings

Every account has a profile (`#/profile`) and a Settings page (`#/settings`),
both reached from the account menu.

- **Set once.** An account's name and picture come from the sign-in that made
  it, and signing in again - with either provider - never changes them. Each
  sign-in's current name and picture are kept on its identity, for Settings to
  offer.
- **Username.** A player may choose their own (`checkUsername` in
  `web/engine/preferences.js`: 2-32 letters and numbers, with a little
  punctuation between); it must not match another account's name, whatever the
  capitals.
- **Picture.** The one the account was made with; or a sign-in's current one,
  copied when chosen; or one uploaded - the app cuts a 256-pixel square and
  sends it as a small WebP or JPEG data URL, and the server keeps only PNG, JPEG
  or WebP data of at most 200,000 characters; or none, when initials show.
- **Appearance.** Theme, accent color, text size and motion, described in
  `APPEARANCE` and applied by `web/ui/appearance.js` as attributes on `<html>`
  that the "Appearance" section of `css/sheet.css` answers. Kept in the browser,
  so a page is drawn right at once, and on the account, which wins at sign-in.
  A new setting is an entry in `APPEARANCE` and its CSS.
- **Who sees a profile.** Its owner, admins, and anyone who shares a campaign
  with its owner (`accountCan.viewProfile`), who see the name, picture, role,
  when the account was made, and the campaigns they share - nothing it keeps.

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
decides (all three SRD variants; Antæra's gestalt), a starting level, whether
players see each other's characters, house rules, and a link.

**Adding a campaign setting** is one entry in `GENERAL_SETTINGS` - it is then
validated, drawn in the form, and saved. If the engine should act on it, read it
in `applyCampaign`; if the server should enforce it, ask for it in `policy.js`.

The Antæra campaign that existed implicitly before campaigns - every site GM
seeing every Antæra character, one gestalt switch - was carried over by
migration 0004 into a real campaign with the id `antaera`, owned by the
longest-standing GM, with every site GM as a GM of it, every owner of an Antæra
character as a player, those characters in it, and gestalt as it was.

### One-time setup

1. **A database:** `npx wrangler d1 create antaera-sheets`, and paste the id into
   `worker/wrangler.toml`.
2. **Google**, if wanted: in the Google Cloud console, create an OAuth client of
   type *Web application*, with the authorized redirect URI
   `https://<your-worker>.workers.dev/auth/callback/google`. The scopes used are
   `openid`, `email` and `profile`. Set the consent screen to *External* and
   publish it, or only test users can sign in.
   Which providers are offered is `SIGN_IN_WITH` in `worker/wrangler.toml`,
   currently `"google,discord"`. A provider needs to be listed there **and** have its
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
- `0004_campaigns.sql` turns the implicit Antæra arrangement into a campaign.
- `0005_campaign_homebrew.sql` adds each campaign's homebrew library.
- `0006_profiles.sql` adds chosen usernames and pictures, preferences, and each
  sign-in's own name and picture.
- `0007_feedback.sql` adds the Contact Me page's messages.

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
        content.js     each player's homebrew library
        campaigns.js   campaigns, invitations, members, characters in them
        campaign-content.js  a campaign's homebrew, written by its GMs
        profile.js     profiles: username, picture, preferences; others' profiles

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
      skills       points, costs, caps, armor check penalty, effect bonuses
      hp / defense / offense
      houserules   action points, taint, wealth, LA, feats, training
      derive       composes everything, and produces the notices
      character    the stored shape, blank characters, migration
      sheet-modules what a file keeps: packing, filling, the module list

    web/ui/
      dom             h(), bound fields, bindForm, paint
      lazy            the parts fetched when a sheet or page needs them
      people          avatars, role words, a waiting invitation
      sheet           every panel
      effects-editor  the effects table used everywhere
      content         the library view

    web/ui/
      landing         the front page at #/; the characters are at #/characters
      campaigns       the campaign list, one campaign, joining by invitation
      admin           the Accounts page

    web/engine/campaign.js  a campaign's settings, and how they apply to a character

    web/app.js     VIEWS and NAV registries, the variants strip, saving, auto-embed

The engine never touches the page, and the interface does no arithmetic. An
input, once drawn, is never redrawn while someone is typing in it: panels whose
shape depends on a field are rebuilt on `change`, not on each keystroke.

`web/css/tokens.css` holds every color and spacing; `sheet.css` contains
neither. Data files are formatted with `python scripts/format-json.py`, which
keeps short arrays on one line.
