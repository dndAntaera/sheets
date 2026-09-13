// The landing page, at #/: what the site is, what it does, and the way in.
//
// It is drawn on the sky rather than on parchment - it is the front of the
// book, not a page of it. The call to action follows the visitor: sign-in
// buttons for someone new, a new character and their list for someone signed
// in, and plain creation for a build with no server.
//
// The example sheet is illustrative, but its numbers are worked out by hand
// from the build it names, so a 3.5 player reading it finds them right.

import { h, refill } from './dom.js';

const FEATURES = [
  {
    title: 'Every total, worked out',
    text: 'Base attack, saves, hit points, skills, armor class and iterative attacks follow from your classes, scores and gear, and change the moment they do. Notices flag what a DM would send back.',
  },
  {
    title: 'The whole SRD',
    text: 'All twenty SRD classes, psionics included, every skill and core race, multiclassing, point buy, and the Unearthed Arcana variants: gestalt, action points, traits and flaws.',
  },
  {
    title: 'Homebrew that counts',
    text: 'Write your own races, classes, feats, items and templates in a library of your own. Give them effects, and they add into your sheets like anything printed.',
  },
  {
    title: 'Campaigns by invitation',
    text: 'A GM starts a campaign, sets its house rules, writes its homebrew, and invites players with a link. Characters brought in play by the table’s rules.',
  },
  {
    title: 'On any device',
    text: 'Sign in with Google or Discord. Sheets save as you type and follow you from laptop to phone to the table.',
  },
  {
    title: 'Print or export',
    text: 'A clean printed sheet for the table, and a file of your character, homebrew and all, to keep or share.',
  },
];

const STEPS = [
  ['Sign in', 'With Google or Discord. There is no password to make.'],
  ['Build', 'Pick a race and classes, spend your points, and watch the sheet add up.'],
  ['Play', 'Bring the character to your table, or into a campaign your GM invites you to.'],
];

/** Fighter 3 / Rogue 2, Str 16 Dex 14 Con 14, chain shirt and buckler. */
function exampleSheet() {
  const stat = (label, value) => h('div.example-stat', h('span.example-value', { text: value }), h('span.example-label', { text: label }));
  return h('figure.example-sheet', { 'aria-label': 'An example character sheet' },
    h('div.example-head',
      h('span.example-name', { text: 'Brom Ironvale' }),
      h('span.example-build', { text: 'Human Fighter 3 / Rogue 2' })),
    h('div.example-stats',
      stat('AC', '17'),
      stat('HP', '40'),
      stat('BAB', '+4'),
      stat('Init', '+2')),
    h('div.example-saves',
      stat('Fort', '+5'),
      stat('Ref', '+6'),
      stat('Will', '+1')),
    h('div.example-attack',
      h('span', { text: 'Longsword' }),
      h('span.example-value', { text: '+7  1d8+3' })),
    h('figcaption.example-note', { text: 'Worked out as you build: nothing here was typed in.' }));
}

/**
 * @param main   the page's main element
 * @param app    the app state (user, providers, serverDown)
 * @param ways   what the page can offer, from app.js:
 *               { signedIn, needsSignIn, signInButtons(), newCharacter(), rulesetName }
 */
export function showLanding(main, app, ways) {
  const cta = () => {
    if (ways.signedIn || !ways.needsSignIn) {
      return h('div.landing-cta',
        h('button.btn.primary', { type: 'button', onclick: ways.newCharacter }, `New ${ways.rulesetName} character`),
        ways.signedIn ? h('a.btn.ghost', { href: '#/characters' }, 'Your characters') : null);
    }
    if (app.serverDown) {
      return h('div.landing-cta', h('p.landing-muted', { text: 'Sign-in is unreachable right now. Please try again shortly.' }));
    }
    return h('div.landing-cta.providers', ways.signInButtons());
  };

  refill(main, h('div.landing',
    h('section.hero',
      h('div.hero-copy',
        h('p.eyebrow', { text: 'Dungeons & Dragons 3.5 edition' }),
        h('h1.hero-title', { text: 'Character sheets that do the math for you.' }),
        h('p.hero-lede', { text: 'A free character creator for the 3.5 System Reference Document. Choose your classes, spend your points, and every total on the sheet adds up as you go.' }),
        cta(),
        !ways.signedIn && ways.needsSignIn
          ? h('p.landing-muted', { text: 'Free. Your characters are kept with your account.' })
          : null),
      h('div.hero-art', exampleSheet())),

    h('section.landing-section',
      h('h2.section-title', { text: 'Everything a 3.5 sheet needs' }),
      h('div.feature-grid', FEATURES.map((f) => h('article.feature',
        h('h3', { text: f.title }),
        h('p', { text: f.text }))))),

    h('section.landing-section',
      h('h2.section-title', { text: 'How it works' }),
      h('ol.steps', STEPS.map(([title, text], i) => h('li.step',
        h('span.step-number', { text: String(i + 1) }),
        h('div', h('h3', { text: title }), h('p', { text: text })))))),

    h('section.landing-section.landing-closing',
      h('h2.section-title', { text: 'Playing in Antæra?' }),
      h('p.hero-lede', {},
        'Your GM will send you an invitation to the campaign. Until then, the ',
        h('a', { href: 'https://dndantaera.github.io/antaera-wiki/', target: '_blank', rel: 'noopener', text: 'Antæra Wiki' }),
        ' has the world and its rules.'),
      cta())));
}
