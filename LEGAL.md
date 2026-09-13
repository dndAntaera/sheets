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

## Accounts and what players store

Players sign in with Google or Discord. Which are offered is `SIGN_IN_WITH` in
`worker/wrangler.toml`; if that changes, the privacy policy must say so. The server stores the provider's
user id, a display name and avatar URL, a role (player, GM or admin), and each
player's characters and homebrew. Email addresses are read at sign-in and not stored. There is no
password.

Homebrew written under Content is saved to the player's own account when they
are signed in, and is visible to nobody else except inside a sheet they choose
to share. The app ships no copyrighted non-SRD material and should not; but a
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