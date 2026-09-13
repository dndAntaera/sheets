# 3.5 Sheets

A character creator for the 3.5 edition System Reference Document — build a
character, and the sheet keeps the arithmetic.

**Open it at [dndantaera.github.io/sheets](https://dndantaera.github.io/sheets)**

## Two rulesets, SRD first

Every character is built under a ruleset, chosen with a toggle on the roster
and switchable on the sheet at any time:

- **SRD** — the default. The 3.5 SRD as published: every SRD class, skill and
  core race, 1st-level start, point buy at the budget you pick, and no campaign
  restrictions. The Unearthed Arcana variants — gestalt, action points, traits
  and flaws — are there for tables that use them, off until a player ticks them.
- **Antæra** — the campaign documented in the
  [Antæra Wiki](https://dndantaera.github.io/antaera-wiki/). 3rd-level start,
  30-point buy, gestalt set by the campaign's GM, action points, taint,
  backgrounds, training time, and the campaign's limits on wealth and level
  adjustment.

Switching never loses anything typed; it changes which rules read it.

## What it works out

- **Base attack bonus, saves and hit dice** across any number of classes,
  summed per class the way 3.5 actually does it — and under gestalt, the better
  of two complete builds
- **Hit points** — maximum at 1st level, then average or rolled
- **Skills** — points per level, class and cross-class costs and caps, the
  armour check penalty (twice for Swim)
- **Armour Class**, touch and flat-footed, with Dexterity capped by armour
- **Attack routines** from base attack bonus, so a second attack appears when
  it is earned and not before
- **Racial traits** of the SRD races, applied rather than described
- **Bonus stacking** — two bonuses of the same type give the better one, as the
  rules say; dodge, circumstance and untyped bonuses stack
- **Spell save DCs and bonus slots** for any casting class
- Under Antæra: action points, taint thresholds, wealth caps, level adjustment
  limits, traits and flaws, and training time

Beside the sheet, a list of what is still wrong or unfinished: skill points
overspent, a class nobody has defined, a feat still to choose.

## Your own content

The SRD does not have everything, so anything missing can be written in. Seven
kinds of content — **races, classes, feats, skills, items, templates and
features** — are entered under **Content**, and each counts on the sheet
exactly as printed content does.

What makes that real is **effects**. An entry can say what it changes:

| Changes | Type | By | Only when |
| --- | --- | --- | --- |
| Armour Class | deflection | +2 | |
| Hide | racial | +4 | in rocky terrain |
| all saving throws | resistance | +1 | |

Unconditional effects go into the totals, under the same stacking rules as
everything else. Conditional ones are listed beside the number they would
change, because the sheet cannot know whether you are fighting a giant. A
**Bonuses in force** panel shows every bonus being counted, where it came from,
and which ones do not stack.

Homebrew is written once and picked by name on any sheet. Signed in, your
library is saved to your account and follows you to any device; signed out, it
stays in the browser. When a sheet uses a piece of homebrew, it keeps its own
copy — so an exported character still adds up for your DM, even though their
library has never seen your Warblade. Libraries also export and import as
files, for sharing a table's homebrew in one go.

## Using it

Characters are saved as you type. **Sign in with Google or Discord** and your
characters and homebrew are kept with your account, on every device you use —
and either sign-in can be added to the same account. Without signing in, the
app is still complete: everything stays in the browser and travels as exported
files.

The server is a Cloudflare Worker with a D1 database.

**Campaigns.** A GM starts a campaign, picks its ruleset and the choices the
table plays by - gestalt or not, starting level, house rules - and invites
players with a link or a short code. Players bring their characters in; while
there, a character plays by the campaign's rules, and the campaign's GMs can see
and edit it. A campaign can have co-GMs, and can let players see each other's
sheets.

Accounts have three levels — **Player**, **GM** and **Admin** — each with
everything below it: a GM can also start and run campaigns, and an admin also
manages accounts and roles. A site role on its own shows nobody else's
characters; that comes only from running a campaign they are in.

Sheets print to something that can be carried to a table with no power.

## Repository

    web/          the app, the engine and the data - everything published
      engine/     all the arithmetic, browser-free and tested
      ui/         the panels, the content editor, the effects editor
      data/       core 3.5 constants, SRD classes, skills and races
        rulesets/ srd.json, antaera.json, and the campaign's backgrounds
    worker/       the server: accounts, characters, homebrew
      migrations/ the database, one numbered change at a time
    test/         engine, server and account tests, run in a browser
    scripts/      the dev server, the JSON formatter, the background sync

Technical documentation is in [MAINTAINING.md](MAINTAINING.md).

## Legal

The sheets share the wiki's
[Disclaimer & Legal Information](https://dndantaera.github.io/antaera-wiki/disclaimer-legal/)
page, which carries the Open Game License and the Fan Content Policy notice, and
every page of the app links to it. [LEGAL.md](LEGAL.md) lists which files here
are Open Game Content.
