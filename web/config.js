// Where the sheets live, and what the app calls itself.
//
// Empty apiBase means this build is local-only: sheets and homebrew are kept in
// the browser and travel as exported files. Set it to the deployed Worker and
// the app gains sign-in, sheets that follow a player between devices, and the
// Antaera DM's roster. Everything else is the same either way, which is
// deliberate - the sheet has to keep working when the network does not.
//
// See MAINTAINING.md for deploying the Worker and filling this in.

export const config = {
  apiBase: '',

  // The public name. Deliberately generic: this is a creator for the 3.5 SRD
  // first, and a campaign's tool second. See LEGAL.md before putting a
  // trademark in it.
  title: '3.5 Sheets',
  tagline: 'A character creator for the 3.5 System Reference Document',

  // The ruleset a new character is built under when nobody has chosen.
  defaultRuleset: 'srd',
};
