// Where the sheets live.
//
// Empty apiBase means this build is local-only: sheets are kept in the
// browser and exported as files. Set it to the deployed Worker and the app
// gains sign-in, the DM's roster, and sheets that follow a player between
// devices. Everything else about the app is the same either way, which is
// deliberate - the sheet has to keep working when the network does not.
//
// See MAINTAINING.md for deploying the Worker and filling this in.

export const config = {
  apiBase: '',

  // Shown in the header, so a player can get back to the rules in one click.
  wikiUrl: 'https://dndantaera.github.io/antaera-wiki/',

  // What a local, not-signed-in build calls itself in the header.
  title: 'Antaera Sheets',
};
