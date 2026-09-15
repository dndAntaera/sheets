// A character's change history: what it is built of, each time that changed.
//
// Entries are written when a finished character leaves the creator with its
// held choices changed (engine/locks.js) - by the server when it is signed in,
// by this browser otherwise. The owner sees them; so do the GMs of its campaign,
// who are told of each on the campaign page.

import { h } from './dom.js';

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export function historyPanel(app) {
  const entries = [...(app.character.history || [])].reverse();
  return h('section.panel', { id: 'panel-history', dataset: { panel: 'history' } },
    h('h2.panel-title', h('span', { text: 'Change history' })),
    h('div.panel-body',
      h('p.hint', { text: 'Every change to what this character is built of - race, classes, scores, skills, feats, spells known, languages, the rules it plays by - once it was finished. In a campaign, its GMs see these too.' }),
      entries.length
        ? h('ol.history-list', entries.map((e) => h('li.history-entry',
          h('div.history-head',
            h('time', { dateTime: e.at, text: when(e.at) }),
            h('span.hint', { text: e.by?.name ? `by ${e.by.name}` : '' })),
          h('ul.history-changes', (e.changes || []).map((ch) => h('li', h('span.label', { text: ch.label }), ' ', h('span', { text: ch.text })))))))
        : h('p.empty', { text: 'No changes since the character was finished.' })));
}
