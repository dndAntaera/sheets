// The Contact Me page, and the admins' Feedback page.
//
//   #/contact    anyone: a name, Discord username or email - all optional - and a message
//   #/feedback   admins: every message, newest first, to read, mark and remove
//
// A message is checked against engine/feedback.js before it is sent; the server
// checks it again (worker/src/features/feedback.js).

import { h, refill, button } from './dom.js';
import { checkFeedback, FEEDBACK_LIMITS } from '../engine/feedback.js';
import { remote } from '../store.js';

/* ==========================================================================
   Contact Me
   ========================================================================== */

export function showContact(main, app) {
  const L = FEEDBACK_LIMITS;
  const values = { name: app.user?.name || '', discord: '', email: '', message: '', website: '' };
  const errors = {};
  const said = h('p.banner', { hidden: true, role: 'status' });
  const say = (level, text) => { said.className = `banner ${level}`; said.textContent = text; said.hidden = false; };

  const errorFor = (key) => h('span.contact-error', { dataset: { errorFor: key } });
  const fieldFor = (key, label, input, hint) => h('label.contact-field',
    h('span.label', { text: label }),
    input,
    hint ? h('span.hint', { text: hint }) : null,
    errorFor(key));
  const textInput = (key, opts) => h('input.field', {
    type: opts.type || 'text', value: values[key], maxLength: opts.max, autocomplete: opts.autocomplete || 'off', placeholder: opts.placeholder || '',
    oninput: (ev) => { values[key] = ev.target.value; },
  });
  const counter = h('span.hint.contact-count', { text: `0 / ${L.messageMax.toLocaleString()}` });
  const message = h('textarea.field.text-block', {
    rows: 8, maxLength: L.messageMax, placeholder: 'What worked, what did not, what you would like to see.',
    oninput: (ev) => { values.message = ev.target.value; counter.textContent = `${ev.target.value.length.toLocaleString()} / ${L.messageMax.toLocaleString()}`; },
  });
  // A field people never see: a bot filling in every box fills this one too.
  const trap = h('input', { type: 'text', name: 'website', tabIndex: -1, autocomplete: 'off', 'aria-hidden': 'true', oninput: (ev) => { values.website = ev.target.value; } });

  const showErrors = (found) => {
    for (const el of form.querySelectorAll('[data-error-for]')) el.textContent = found[el.dataset.errorFor] || '';
  };

  const sendButton = h('button.btn.primary', { type: 'submit' }, 'Send');
  const form = h('form.contact-form', {
    novalidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      const check = checkFeedback(values);
      Object.assign(errors, check.errors);
      showErrors(check.errors);
      if (!check.ok) return;
      if (!remote.enabled()) { say('fail', 'Messages cannot be sent from this copy of the site.'); return; }
      sendButton.disabled = true;
      sendButton.textContent = 'Sending…';
      try {
        await remote.feedback.send({ ...check.value, website: values.website });
        refill(main, h('div.roster.contact-page',
          h('h1', { text: 'Thank you' }),
          h('p', { text: 'Your message is with the site’s admins.' }),
          check.value.email || check.value.discord ? h('p.hint', { text: 'If it needs an answer, you will hear back through the details you left.' }) : null,
          h('p', h('a.btn', { href: '#/' }, 'Back to the front page'))));
      } catch (err) {
        say('fail', err.code === 429 ? 'That is a lot of messages at once. Please try again in an hour.' : `The message was not sent: ${err.message}. Please try again.`);
        sendButton.disabled = false;
        sendButton.textContent = 'Send';
      }
    },
  },
  h('div.contact-grid',
    fieldFor('name', 'Your name', textInput('name', { max: L.name, autocomplete: 'name', placeholder: 'Optional' })),
    fieldFor('discord', 'Discord username', textInput('discord', { max: L.discord, placeholder: 'Optional' })),
    fieldFor('email', 'Email', textInput('email', { type: 'email', max: L.email, autocomplete: 'email', placeholder: 'Optional' }))),
  fieldFor('message', 'Message', message, null),
  counter,
  h('div.contact-trap', { 'aria-hidden': 'true' }, h('label', {}, 'Leave this empty ', trap)),
  said,
  h('div.row', sendButton));

  refill(main, h('div.roster.contact-page',
    h('h1', { text: 'Contact Me' }),
    h('p', { text: 'Feedback, a bug, a rule the sheet gets wrong, or an idea: send it here. The site is in alpha, and every report helps.' }),
    h('p.hint', {}, 'A name, Discord username or email is up to you - leave one if you would like a reply. Only the site’s admins see what you send; see the ', h('a', { href: 'legal/#privacy-policy', text: 'Privacy Policy' }), '.'),
    form));
}

/* ==========================================================================
   Feedback, for admins
   ========================================================================== */

const feedbackState = { status: 'new' };

export async function showFeedback(main, app) {
  if (!app.user?.admin) {
    refill(main, h('div.roster', h('h1', { text: 'Feedback' }), h('p.empty', { text: 'Only an admin can read feedback.' })));
    return;
  }
  const list = h('div.feedback-list', h('p.empty', { text: 'Loading…' }));
  const tally = h('p.hint');
  const tabs = h('div.feedback-tabs');

  const draw = async () => {
    let data;
    try {
      data = await remote.feedback.list(feedbackState.status === 'all' ? null : feedbackState.status);
    } catch (err) {
      refill(list, h('p.empty', { text: `Feedback could not be loaded: ${err.message}.` }));
      return;
    }
    tally.textContent = `${data.counts.new} new of ${data.counts.total} message${data.counts.total === 1 ? '' : 's'}.`;
    refill(tabs, [['new', 'New'], ['read', 'Read'], ['all', 'All']].map(([key, label]) => h(`button.btn${feedbackState.status === key ? '.primary' : '.subtle'}`, {
      type: 'button', onclick: () => { feedbackState.status = key; draw(); },
    }, key === 'new' && data.counts.new ? `${label} (${data.counts.new})` : label)));

    if (!data.messages.length) {
      refill(list, h('p.empty', { text: feedbackState.status === 'new' ? 'Nothing new.' : 'No messages.' }));
      return;
    }
    refill(list, data.messages.map((m) => {
      const actions = h('div.feedback-actions');
      const normal = () => refill(actions,
        button(m.status === 'new' ? 'Mark read' : 'Mark new', async () => {
          await remote.feedback.mark(m.id, m.status === 'new' ? 'read' : 'new').catch(() => {});
          draw();
        }, { subtle: true }),
        button('Delete', () => refill(actions,
          h('span.hint', { text: 'Delete this message?' }),
          button('Delete', async () => { await remote.feedback.remove(m.id).catch(() => {}); draw(); }, { subtle: true, danger: true }),
          button('Cancel', normal, { subtle: true })), { subtle: true, danger: true }));
      normal();
      const when = new Date(m.created);
      return h(`article.feedback-item${m.status === 'new' ? '.is-new' : ''}`,
        h('header.feedback-head',
          h('span.feedback-from', { text: m.name || 'No name given' }),
          m.status === 'new' ? h('span.tag.is-equipped', { text: 'new' }) : null,
          h('time.hint', { dateTime: m.created, text: when.toLocaleString() })),
        h('div.feedback-contact',
          m.discord ? h('span', {}, h('span.label', { text: 'Discord ' }), h('span', { text: m.discord })) : null,
          m.email ? h('span', {}, h('span.label', { text: 'Email ' }), h('a', { href: `mailto:${m.email}`, text: m.email })) : null,
          m.account ? h('span', {}, h('span.label', { text: 'Account ' }), h('a', { href: `#/profile/${m.account.id}`, text: m.account.name || 'profile' })) : null,
          !m.discord && !m.email && !m.account ? h('span.hint', { text: 'No way to reply was left.' }) : null),
        h('p.feedback-message', { text: m.message }),
        actions);
    }));
  };

  refill(main, h('div.roster.feedback-page',
    h('div.roster-intro',
      h('h1', { text: 'Feedback' }),
      h('p.hint', { text: 'Messages sent from the Contact Me page, newest first. Contact details are for replying only.' })),
    tabs,
    tally,
    list));
  draw();
}
