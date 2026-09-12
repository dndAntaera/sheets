# Antæra Sheets

Character sheets for **Antæra**, the Dungeons & Dragons 3.5 setting documented
in the [Antæra Wiki](https://dndantaera.github.io/antaera-wiki/). This is that
wiki's sister: the wiki says what the rules are, and this works them out for a
particular character.

**Open it at [dndantaera.github.io/sheets](https://dndantaera.github.io/sheets)**

## What it does

Players build a character and the sheet keeps the arithmetic, including the
parts of it that are specific to this campaign:

- **Gestalt**, when the DM has switched it on — every level takes two classes
  and the sheet keeps the better hit die, attack progression, saves and skill
  points, and treats both class skill lists as its own
- **Base attack bonus, saves and hit dice** across any number of classes, summed
  per class the way 3.5 actually does it rather than averaged
- **Hit points** — maximum at 1st level, then average or rolled, the choice made
  once and held
- **Skills** — the points each level grants, class and cross-class costs and
  caps, the armour check penalty where it applies (twice, for Swim)
- **Armour class**, touch and flat-footed, with Dexterity capped by what is worn
- **Attack routines** from the base attack bonus, so a second attack appears
  when it is earned and not before
- **Action points**, the pool and the dice one point rolls
- **Taint** — corruption against Constitution and depravity against Wisdom, the
  symptom threshold each has reached, and how far the next one is
- **Wealth by level**, the single-item cap, and the background item cap
- **Level adjustment** against the quarter-of-ECL limit, **traits and flaws**
  with the feat each flaw buys, and the **training time** for the next level

Anything the sheet cannot know — class features, spells, the campaign's altered
content — is free text, and the wiki is one click away in the header.

It also tells a player what is still wrong: skill points overspent, a rolled
array that has to be rerolled, two prestige classes on one gestalt level, an
item over the wealth cap, no background chosen. Those notices sit beside the
sheet while it is being built, which is a better time to find out than when the
DM reads it.

## Using it

A character is made in the browser and saved as you type. If the campaign
server has been deployed, signing in with Discord puts a player's sheets on
every device they use and shows the DM the whole roster; if it has not, sheets
live in the browser and travel as exported files. Either way the sheet itself is
the same, and it keeps working with no network at all.

Sheets export as JSON to post in a `#scars-characters` thread, and print to
something that can be carried to a table.

## Repository

    web/        the sheet: the app, the engine, the data
      engine/   all the arithmetic, browser-free and tested
      data/     SRD classes and skills, and this campaign's constants
    worker/     the optional campaign server: Cloudflare Worker and D1
    test/       the engine's test suite, runnable in Node or a browser
    scripts/    the development server, and the background sync from the wiki

The engine does not touch the DOM and the interface does no arithmetic. That
separation is what lets the same code run the sheet, the tests, and anything
else later.

Rules data lives in `web/data/`, with every houserule naming the wiki page it
came from. **The wiki is the authority**: if the two disagree, the wiki is right
and the data file is stale.

Technical documentation — running it locally, the tests, deploying both halves —
is in [MAINTAINING.md](MAINTAINING.md).

## Credits

Built with no framework and no build step: plain ES modules, so the sheet you
read in the repository is the sheet the browser runs. Class and skill
progressions are from the 3.5 SRD.
