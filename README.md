# Sheet Tracker 3.5e

A character creator for the 3.5 edition System Reference Document — build a
character, and the sheet keeps the arithmetic.

**Open it at [dndantaera.github.io/sheets](https://dndantaera.github.io/sheets)**

## Two rulesets, SRD for everyone

Every character is built under a ruleset. Anyone signed in can build under the
SRD; Antæra is played only in a campaign, which a player joins by invitation.
No one picks a campaign from a list.

- **SRD** — public, and the default. The 3.5 SRD as published: every SRD class, skill and
  core race, 1st-level start, point buy at the budget you pick, and no campaign
  restrictions. Unearthed Arcana's races, classes and feats — aquatic dwarves,
  bardic sages, prestige paladins, spelltouched feats — are simply in the lists;
  its rules — gestalt, traits and flaws, defense bonus, spell points and the rest —
  are there for tables that use them, off until a player switches them on in the
  creator.
- **Antæra** — campaigns only. The campaign documented in the
  [Antæra Wiki](https://dndantaera.github.io/antaera-wiki/). 3rd-level start,
  30-point buy, gestalt set by the campaign's GM, action points, taint,
  backgrounds, training time, and the campaign's limits on wealth and level
  adjustment.

A character brought into an Antæra campaign plays by Antæra's rules while it is
there. Changing rules never loses anything typed; it changes which rules read it.

## What it works out

- **Base attack bonus, saves and hit dice** across any number of classes,
  summed per class the way 3.5 actually does it — and under gestalt, the better
  of two complete builds
- **Ability scores** — point buy, the standard array, or 4d6 rolled six times,
  each score chosen from a dropdown
- **Hit points** — maximum at 1st level, then average or rolled
- **Skills** — points per level, class and cross-class costs and caps, the
  armor check penalty (twice for Swim)
- **Armor Class**, touch and flat-footed, with Dexterity capped by armor
- **Attack routines** from base attack bonus, so a second attack appears when
  it is earned and not before
- **Racial traits** of the SRD races, applied rather than described
- **Bonus stacking** — two bonuses of the same type give the better one, as the
  rules say; dodge, circumstance and untyped bonuses stack
- **Feats** — every slot a character has, each offering only the feats it
  qualifies for at that level, with what each feat does counted for it
- **Class features** from the class tables, with their SRD text and uses per day
- **Spells and powers** chosen from the lists a class may use: a wizard's
  spellbook and preparation, a cleric's domains, a psion's discipline
- **Languages** — the race's, and as many more as Intelligence and Speak
  Language allow
- **Inventory and money** — a shop of the SRD's equipment, an inventory with
  weight and value, coins kept as a ledger of what was bought, sold and found,
  and the load it all makes; custom items of your own
- **Held choices** — once a character is finished, its race, classes,
  scores, skills, feats, spells known and languages are changed in the creator,
  and every change is kept in the sheet's history; a campaign's GMs are told
- **Rolling in Discord** — `/roll hide`, `/roll longsword`, `/roll 2d6+3` from
  your sheet, once the bot is set up (see MAINTAINING.md)
- **Equipment slots** — armor, shield, as many weapons as you like, and the body
  slots for magic items, filled from the inventory
- **Armor Class as a table** of every source, and **attack cards** for each
  weapon, with two-weapon fighting, Power Attack and the rest worked in
- **Starting wealth** by level, or a figure of your own (a campaign's GMs set it
  for their table)
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
| Armor Class | deflection | +2 | |
| Hide | racial | +4 | in rocky terrain |
| all saving throws | resistance | +1 | |

Unconditional effects go into the totals, under the same stacking rules as
everything else. Conditional ones are listed beside the number they would
change, because the sheet cannot know whether you are fighting a giant. A
**Bonuses in force** panel shows every bonus being counted, where it came from,
and which ones do not stack.

Homebrew is written once and picked by name. Each player has a library of their
own, on their account, and it counts on their characters outside campaigns.
A campaign has a library too, written by its GMs: characters in the campaign
count that, and their players' own homebrew only if the GM turns on **Allow
homebrew**. Homebrew that does not count stays on the sheet, marked. When a
sheet uses a piece of homebrew, it keeps its own copy — so an exported character
still adds up for your DM. Libraries also export and import as files. The
Content page, where homebrew is written, is there once you sign in.

## Using it

**Sign in with Google or Discord** to see, create and edit characters, and to
write homebrew: the Characters and Content pages appear once you have. Characters
are saved as you type and kept with your account, on every device you use. Signed
out, the site shows its front page.

**New characters are made in a creator** that walks through 3.5 creation a step
at a time - concept, race, class, ability scores, skills, feats, hit points and
wealth, spells, languages and story - with a running summary beside it and the
sheet's own checks at each step. A character left half-made is a draft that
picks up where it stopped; finishing opens the full sheet, where equipment is
bought and uses are tracked in play.

**On a phone** the site works as an app: install it from the browser (*Install
app* on Android, *Add to Home Screen* on an iPhone) and it opens full screen,
with its own icon, even offline.

**Every variant rule in the SRD** - defense bonus, armor as damage reduction,
vitality and wound points, spell points, recharge magic, magic rating, the
alternative skill systems, class variants, generic and paragon classes, craft
points, reputation, sanity and the rest - can be switched on from a character's
Rules page, or set for everyone by a campaign's GM, and the sheet follows it.

**Contact Me**, in the footer, sends feedback to the site's admins, who read it on
their Feedback page.

Each player has a **profile** and a **Settings** page: a username and profile
picture of their own, and how the site looks to them - day or night, an accent
color, larger text, reduced motion - kept with their account.

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
      ui/         the panels, the creator, the content editor, the effects editor
      data/       core 3.5 constants, SRD classes, skills, races, feat effects
        srd/      the SRD reference: spells, powers, feats, classes, traits, languages...
        rulesets/ srd.json, antaera.json, and the campaign's backgrounds
      icons/      the installable app's icons
    worker/       the server: accounts, characters, homebrew, campaigns
      migrations/ the database, one numbered change at a time
    test/         engine, server and account tests, run in a browser
    scripts/      the dev server, the data builders, the housekeeping sweep
    .githooks/    the pre-push guard (enable with: git config core.hooksPath .githooks)

Technical documentation is in [MAINTAINING.md](MAINTAINING.md).

## Legal

The sheets share the Antæra Wiki's
[Disclaimer & Legal Information](https://dndantaera.github.io/antaera-wiki/disclaimer-legal/)
page, which carries the Open Game License and the Fan Content Policy notice, and
every page of the app links to it. [LEGAL.md](LEGAL.md) lists which files here
are Open Game Content.
