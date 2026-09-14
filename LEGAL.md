# Legal notes

The sheets are the Antæra Wiki's sister site and share its legal page:

**[Disclaimer & Legal Information](https://dndantaera.github.io/antaera-wiki/disclaimer-legal/)**
(`docs/disclaimer-legal.md` in the wiki repository)

That page carries the full text of the Open Game License v1.0a, its Section 15
copyright notice for the System Reference Document, and the Fan Content Policy
notice. Every page of the app ends with a footer that repeats the Fan Content
Policy notice and links there, so the license accompanies the content wherever
the app is used. Keep the link in `web/config.js` (`legalUrl`) pointing at it if
the Antæra Wiki's page ever moves.

## What in this repository is Open Game Content

The OGL asks that the Open Game Content in a work be identified. Here it is the
game mechanics taken from the 3.5 System Reference Document:

- `web/data/classes.json` — class hit dice, progressions, skill points and
  class skill lists
- `web/data/skills.json` — the skill list and its key abilities
- `web/data/races.json` — the core races
- `web/data/core.json` — sizes, the point-buy table, the standard array, bonus
  types and wealth by level
- `web/data/srd/` — every spell, psionic power, feat, class and class table,
  domain and piece of equipment in the SRD, built by `scripts/build-srd.py` from
  Andargor's SRD 3.5 database (SQLite conversion by highmage), whose Section 15
  lines are on the Antæra Wiki's legal page with the SRD's, the Expanded
  Psionics Handbook's and Unearthed Arcana's
- `web/data/variants.json` (its tables) and `web/data/srd/variants.json` (its
  rule text) — the variant rules from Unearthed Arcana, built by
  `scripts/build-variants.py`; the catalog's own descriptions are not Open Game
  Content
- `web/data/srd/traits.json` — Unearthed Arcana's character traits and flaws
- `web/data/srd/languages.json` — the SRD's languages
- `web/data/synergies.json` — the SRD's skill synergies
- `web/data/srd/feat-rules.json` and `web/data/feat-effects.json` — the SRD's feat
  prerequisites and benefits, restated for the engine

The app's code, the Antæra ruleset (`web/data/rulesets/antaera.json`), the
campaign's backgrounds and the Antæra logo (`web/icons/`, `web/brand/`) are not
Open Game Content; they are the owner's own.

If content from another open source is ever added to the data files, add its
Section 15 notice to the Antæra Wiki's legal page in the same change.

## Accounts and what players store

Players sign in with Google or Discord. Which are offered is `SIGN_IN_WITH` in
`worker/wrangler.toml`; if that changes, the privacy policy must say so. The server stores the provider's
user id, a display name and avatar URL, a role (player, GM or admin), and each
player's characters and homebrew. Email addresses are read at sign-in and not stored. There is no
password.

Homebrew written under Content is saved to the player's own account, and is
visible to nobody else except inside a sheet they choose to share. Homebrew a
GM writes for a campaign is saved with the campaign and visible to its members. The app ships no copyrighted non-SRD material and should not; but a
player can type anything into a homebrew entry, including text copied from
non-open books. The terms of service say players must only store content they have the right
to.

Removing an account and all its data on request does: an admin does it from the
Accounts page, and the account's sign-ins, characters and homebrew go with it.

The **Privacy Policy** and **Terms of Service** are two cards on this site's own
Legal page, `web/legal/index.html`, linked from the footer and given to Google
as the app's policy links:

- <https://dndantaera.github.io/sheets/legal/#privacy-policy>
- <https://dndantaera.github.io/sheets/legal/#terms-of-service>

Keep those two ids if the page is rewritten; the providers hold the links. If what
the server stores changes, update the privacy policy in the same change.