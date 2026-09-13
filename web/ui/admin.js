// The accounts page: admins only.
//
// Who has an account, which role each holds, and the means to remove one. It
// shows how much an account holds - characters, homebrew entries - and never
// what: an admin manages accounts, and reading other players' sheets is not part
// of that. The server enforces every rule shown here; the page only explains
// them, so a refusal from the server is shown as it comes.

import { h, button, refill } from './dom.js';
import { remote } from '../store.js';

export const ROLE_LABELS = { player: 'Player', gm: 'GM', admin: 'Admin' };

const ROLE_POWERS = [
  ['Player', 'Their own characters and homebrew, and joins campaigns they are invited to.'],
  ['GM', 'Also starts campaigns, invites players to them, and runs them.'],
  ['Admin', 'Also manages accounts: gives and takes roles, and removes an account with everything in it.'],
];

const PROVIDER_LABELS = { google: 'Google', discord: 'Discord' };

export async function showAdmin(main, app) {
  if (!app.user?.admin) {
    refill(main, h('div.roster', h('h1', { text: 'Accounts' }), h('p.empty', { text: 'Only an admin can manage accounts.' })));
    return;
  }

  const message = h('p.banner', { hidden: true });
  const say = (level, text) => {
    message.className = `banner ${level}`;
    message.textContent = text;
    message.hidden = false;
  };

  const table = h('div.table-scroll');
  refill(main, h('div.roster.admin-page',
    h('div.roster-intro',
      h('h1', { text: 'Accounts' }),
      h('p.hint', { text: 'Every role has everything the one below it has.' })),
    h('dl.role-powers', ROLE_POWERS.map(([role, power]) => [h('dt', { text: role }), h('dd', { text: power })])),
    h('p.hint', { text: 'An account named in the server’s settings is at least the role they give it, and cannot be lowered or removed here. The site always keeps at least one admin.' }),
    message,
    table));

  const draw = async () => {
    let users;
    try {
      users = await remote.admin.users();
    } catch (err) {
      say('fail', `Could not load accounts: ${err.message}`);
      return;
    }
    const counts = users.reduce((acc, u) => ({ ...acc, [u.role]: (acc[u.role] || 0) + 1 }), {});

    refill(table, h('table.admin-table',
      h('caption.hint', { text: `${users.length} account${users.length === 1 ? '' : 's'}: ${['admin', 'gm', 'player'].map((r) => `${counts[r] || 0} ${ROLE_LABELS[r]}${(counts[r] || 0) === 1 ? '' : 's'}`).join(', ')}` }),
      h('thead', h('tr', ['Account', 'Signs in with', 'Role', 'Characters', 'Homebrew', 'Last seen', ''].map((c) => h('th', { text: c })))),
      h('tbody', users.map((u) => row(u)))));
  };

  const row = (u) => {
    const isMe = u.id === app.user.id;
    const choose = h('select.field.narrow', {
      'aria-label': `Role for ${u.name}`,
      onchange: async (ev) => {
        const role = ev.target.value;
        const leavingAdmin = isMe && role !== 'admin';
        if (leavingAdmin && !confirm('Give up your own admin role? You will lose this page as soon as it is saved.')) {
          ev.target.value = u.role;
          return;
        }
        ev.target.disabled = true;
        try {
          const updated = await remote.admin.setRole(u.id, role);
          say('pass', `${u.name} is now ${ROLE_LABELS[updated.role] === 'Admin' ? 'an' : 'a'} ${ROLE_LABELS[updated.role]}.`);
          if (leavingAdmin) { location.hash = '#/'; location.reload(); return; }
        } catch (err) {
          say('fail', `${u.name} was not changed: ${err.message}.`);
        }
        await draw();
      },
    }, Object.entries(ROLE_LABELS).map(([value, label]) => h('option', {
      value,
      text: label,
      selected: value === u.role,
      // The floor is shown by leaving lower roles unpickable.
      disabled: u.floor && ['player', 'gm', 'admin'].indexOf(value) < ['player', 'gm', 'admin'].indexOf(u.floor),
    })));

    const remove = isMe || u.floor
      ? h('span.hint', { text: isMe ? 'you' : 'set by server', title: isMe ? 'Another admin can remove your account.' : 'Named in the server’s settings.' })
      : button('Remove', async () => {
        const what = [u.characters && `${u.characters} character${u.characters === 1 ? '' : 's'}`, u.content && `${u.content} homebrew entr${u.content === 1 ? 'y' : 'ies'}`].filter(Boolean).join(' and ');
        if (!confirm(`Remove ${u.name}'s account${what ? `, with ${what}` : ''}? This cannot be undone.`)) return;
        try {
          await remote.admin.removeUser(u.id);
          say('pass', `${u.name}'s account was removed.`);
        } catch (err) {
          say('fail', `${u.name} was not removed: ${err.message}.`);
        }
        await draw();
      }, { subtle: true, danger: true });

    return h('tr', { class: isMe ? 'is-me' : '' },
      h('th', { scope: 'row' },
        h('span', { text: u.name }),
        isMe ? h('span.badge', { text: 'you' }) : null),
      h('td', { text: u.providers.map((p) => PROVIDER_LABELS[p] || p).join(', ') || '-' }),
      h('td',
        choose,
        u.floor ? h('span.hint.floor', { text: `at least ${ROLE_LABELS[u.floor]}`, title: 'Set by the server’s settings.' }) : null),
      h('td.num', { text: String(u.characters) }),
      h('td.num', { text: String(u.content) }),
      h('td', { text: u.lastSeen ? new Date(u.lastSeen).toLocaleDateString() : '-' }),
      h('td', remove));
  };

  await draw();
}
