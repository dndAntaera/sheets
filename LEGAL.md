# Legal notes

The sheets are the Antæra wiki's sister site and share its legal page:

**[Disclaimer & Legal Information](https://dndantaera.github.io/antaera-wiki/disclaimer-legal/)**
(`docs/disclaimer-legal.md` in the wiki repository)

That page carries the full text of the Open Game License v1.0a, its Section 15
copyright notice for the System Reference Document, and the Fan Content Policy
notice. Every page of the app ends with a footer that repeats the Fan Content
Policy notice and links there, so the license accompanies the content wherever
the app is used. Keep the link in `web/config.js` (`legalUrl`) pointing at it if
the wiki's page ever moves.

## What in this repository is Open Game Content

The OGL asks that the Open Game Content in a work be identified. Here it is the
game mechanics taken from the 3.5 System Reference Document:

- `web/data/classes.json` — class hit dice, progressions, skill points and
  class skill lists
- `web/data/skills.json` — the skill list and its key abilities
- `web/data/races.json` — the core races
- `web/data/core.json` — sizes, the point-buy table, the standard array, bonus
  types and wealth by level

The app's code, the Antæra ruleset (`web/data/rulesets/antaera.json`) and the
campaign's backgrounds are not Open Game Content; they are the owner's own.

If content from another open source is ever added to the data files, add its
Section 15 notice to the wiki's legal page in the same change.

## Content players write

Homebrew written under Content stays in the player's browser and inside the
sheets that use it. The app ships no copyrighted non-SRD material, and should
not: if a campaign server is ever opened to the public, it will need terms
covering what players upload, since transcriptions of non-SRD books are not
open content.
