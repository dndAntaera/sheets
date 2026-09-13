# Legal notes

This is a working note for whoever publishes the app, not legal advice. Read it
before the public URL is announced.

## The SRD material is Open Game Content

The class progressions (`web/data/classes.json`), skills (`skills.json`), the
core races (`races.json`) and the constants in `core.json` are taken from the
3.5 System Reference Document, which Wizards of the Coast published under the
**Open Game License version 1.0a**. Redistributing it — which a public web app
serving those files does — is permitted, on the license's terms. In short:

1. **A copy of the OGL 1.0a must accompany the content.** Copy the license text
   exactly from the `Legal.rtf` / "Legal Information" file distributed with the
   SRD itself, into a file in this repository (for example
   `web/OGL-1.0a.txt`), and link to it from the app's footer.

   **This has not been done yet.** The license text is not reproduced here from
   memory, because a paraphrased or mistyped license is not the license. Take
   it from the SRD's own file.

2. **Section 15 must carry the copyright notices** for the Open Game Content
   used. For the 3.5 SRD, the notice published with it reads:

   > System Reference Document Copyright 2000-2003, Wizards of the Coast, Inc.;
   > Authors Jonathan Tweet, Monte Cook, Skip Williams, Rich Baker, Andy
   > Collins, David Noonan, Rich Redman, Bruce R. Cordell, John D. Rateliff,
   > Thomas Reid, James Wyatt, based on original material by E. Gary Gygax and
   > Dave Arneson.

   Check it word for word against the SRD's legal file before relying on it,
   and add this project's own line after it.

3. **Declare what in the project is Open Game Content.** The data files named
   above are. The application code, the Antæra ruleset, and the campaign's
   backgrounds are not, unless the owner chooses to make them so.

## Trademarks

The OGL does not license Product Identity or trademarks. Do not describe the
app with **"Dungeons & Dragons"**, **"D&D"**, **"D&D Beyond"** or other Wizards
of the Coast trademarks in its name, title, or to claim compatibility. That is
why the app calls itself *3.5 Sheets* and refers to "the 3.5 System Reference
Document". Keep `config.title` and `config.tagline` in `web/config.js` free of
trademarks.

(The old d20 System Trademark License, which once allowed a "d20 System" logo,
was withdrawn years ago; do not rely on it.)

## Content players write

Homebrew entered under Content stays in the player's own browser and is not
sent anywhere unless they export a file themselves, or sign in to a campaign
server that stores their sheets. If a server is ever opened to the public
rather than to one campaign, it will need terms covering what players upload —
particularly transcriptions of non-SRD books, which are not open content and
must not be published by the app.

## Antæra

Everything in `web/data/rulesets/antaera.json` and
`antaera-backgrounds.json` is the campaign owner's own material, taken from the
Antæra Wiki, and is theirs to license as they see fit.
