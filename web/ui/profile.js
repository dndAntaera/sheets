// A player's profile, and their Settings page.
//
//   #/profile        your own: picture, username, role, what you keep, where you sign in
//   #/profile/<id>   someone else's, if you share a campaign with them (or you are an admin)
//   #/settings       username, picture, how the site looks, sign-ins, signing out
//
// The Settings page is drawn from engine/preferences.js; the server checks every
// change against the same file.

import { h, button, refill } from './dom.js';
import { remote } from '../store.js';
import { config } from '../config.js';
import { ROLE_LABELS } from './admin.js';
import { APPEARANCE, USERNAME_LIMITS, PICTURE_MAX_CHARS } from '../engine/preferences.js';
import { currentAppearance, setAppearance } from './appearance.js';

const PROVIDER_LABELS = { google: 'Google', discord: 'Discord' };
const CAMPAIGN_ROLE_LABELS = { owner: 'Owner', gm: 'GM', player: 'Player' };

const since = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : '');

/**
 * A person's picture, or their initials on a colour of their own when they have
 * none - or when the picture will not load.
 *
 * @param person  { id, name, avatar }
 * @param size    'sm' | 'md' | 'xl'
 */
export function avatarFor(person, size = 'sm') {
  const initials = () => {
    const letters = String(person?.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
    const hue = [...String(person?.id || person?.name || '')].reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)) % 360, 7);
    return h(`span.avatar.avatar-${size}.avatar-initials`, { 'aria-hidden': 'true', style: `--avatar-hue: ${hue}`, text: letters });
  };
  if (!person?.avatar) return initials();
  const img = h(`img.avatar.avatar-${size}`, { src: person.avatar, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(initials()), { once: true });
  return img;
}

/* ==========================================================================
   The profile
   ========================================================================== */

export async function showProfile(main, app, id) {
  refill(main, h('div.roster', h('p.empty', { text: 'Opening the profile…' })));
  let p;
  try {
    p = id && id !== app.user.id ? await remote.profile.get(id) : await remote.profile.mine();
  } catch (err) {
    refill(main, h('div.roster', h('h1', { text: 'Profile' }), h('p.empty', { text: `${err.message}.` })));
    return;
  }
  document.title = `${p.name} - ${config.title}`;

  const stat = (label, value, href) => h('a.profile-stat', { href },
    h('span.profile-stat-value', { text: String(value) }),
    h('span.profile-stat-label', { text: label }));

  refill(main, h('div.roster.profile-page',
    h('div.profile-head',
      avatarFor(p, 'xl'),
      h('div.profile-title',
        h('h1', { text: p.name }),
        h('p.profile-meta',
          h('span.badge', { text: ROLE_LABELS[p.role] || 'Player' }),
          p.created ? h('span.hint', { text: `Member since ${since(p.created)}` }) : null),
        p.self ? h('a.btn', { href: '#/settings' }, 'Edit profile and settings') : null)),

    p.self
      ? h('div.profile-stats',
        stat(p.counts.characters === 1 ? 'Character' : 'Characters', p.counts.characters, '#/characters'),
        stat('Homebrew entries', p.counts.homebrew, '#/content'),
        stat(p.counts.campaigns === 1 ? 'Campaign' : 'Campaigns', p.counts.campaigns, '#/campaigns'))
      : null,

    h('section.campaign-section',
      h('h2', { text: p.self ? 'Campaigns' : 'Campaigns you share' }),
      p.campaigns.length
        ? h('ul.profile-campaigns', p.campaigns.map((c) => h('li',
          h('a', { href: `#/campaign/${c.id}`, text: c.name }),
          h(`span.badge.campaign-role-${c.role}`, { text: CAMPAIGN_ROLE_LABELS[c.role] }))))
        : h('p.hint', { text: p.self ? 'None yet. A GM invites you to one with a link.' : 'None.' })),

    p.self
      ? h('section.campaign-section',
        h('h2', { text: 'Signs in with' }),
        h('ul.profile-signins', p.signIns.map((s) => h('li',
          h('span', { text: PROVIDER_LABELS[s.provider] || s.provider }),
          h('span.hint', { text: `since ${since(s.since)}` })))))
      : null));
}

/* ==========================================================================
   Settings
   ========================================================================== */

/**
 * @param ways  from app.js: { signInLabels, linkable: [provider], onAccountChanged(profile), signOut() }
 */
export async function showSettings(main, app, ways) {
  refill(main, h('div.roster', h('p.empty', { text: 'Opening your settings…' })));
  let p;
  try {
    p = await remote.profile.mine();
  } catch (err) {
    refill(main, h('div.roster', h('h1', { text: 'Settings' }), h('p.empty', { text: `${err.message}.` })));
    return;
  }
  document.title = `Settings - ${config.title}`;
  const redraw = () => showSettings(main, app, ways);

  refill(main, h('div.roster.settings-page',
    h('div.settings-head',
      h('h1', { text: 'Settings' }),
      h('a.hint', { href: '#/profile', text: 'View your profile' })),
    profileSection(p, ways, redraw),
    appearanceSection(app),
    signInSection(p, ways),
    h('section.campaign-section',
      h('h2', { text: 'Signing out' }),
      h('p.hint', { text: 'Your characters, homebrew and settings stay with your account.' }),
      button('Sign out', ways.signOut))));
}

/** A line that says how the last change went. */
function messenger() {
  const line = h('p.banner', { hidden: true, role: 'status' });
  const say = (level, text) => {
    line.className = `banner ${level}`;
    line.textContent = text;
    line.hidden = false;
  };
  return { line, say };
}

function profileSection(p, ways, redraw) {
  const { line, say } = messenger();
  const preview = h('div.settings-avatar', avatarFor(p, 'xl'));

  const save = async (changes, done) => {
    try {
      const updated = await remote.profile.update(changes);
      ways.onAccountChanged(updated);
      p = updated;
      refill(preview, avatarFor(updated, 'xl'));
      say('pass', done);
      return updated;
    } catch (err) {
      say('fail', `${err.message}.`);
      return null;
    }
  };

  // The picture
  const file = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif',
    class: 'hidden',
    onchange: async (ev) => {
      const chosen = ev.target.files?.[0];
      ev.target.value = '';
      if (!chosen) return;
      try {
        const data = await squarePicture(chosen);
        await save({ picture: 'upload', data }, 'Picture saved.');
      } catch (err) {
        say('fail', `${err.message}.`);
      }
    },
  });
  const pictureChoices = [
    button('Upload a picture', () => file.click(), { title: 'A square is cut from the middle, and made small.' }),
    ...p.signIns.filter((s) => s.avatar).map((s) => button(`Use my ${PROVIDER_LABELS[s.provider]} picture`,
      () => save({ picture: 'provider', provider: s.provider }, `Using your ${PROVIDER_LABELS[s.provider]} picture.`), { subtle: true })),
    p.avatar ? button('Remove picture', () => save({ picture: 'none' }, 'Picture removed. Your initials show instead.'), { subtle: true }) : null,
  ];

  // The username
  const input = h('input.field', {
    type: 'text',
    value: p.name,
    maxLength: USERNAME_LIMITS.max,
    autocomplete: 'nickname',
    'aria-label': 'Username',
  });
  const nameForm = h('form.settings-name', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      if (input.value.trim() === p.name) return;
      const updated = await save({ name: input.value }, 'Username saved.');
      if (updated) input.value = updated.name;
    },
  },
  h('label.settings-label', { text: 'Username' }),
  h('div.row', input, h('button.btn', { type: 'submit' }, 'Save')),
  h('span.hint', { text: `${USERNAME_LIMITS.min} to ${USERNAME_LIMITS.max} letters and numbers; spaces, apostrophes, full stops, hyphens and underscores between them. Other players see it in campaigns you share.` }));

  return h('section.campaign-section',
    h('h2', { text: 'Profile' }),
    line,
    h('div.settings-profile',
      preview,
      h('div.settings-picture',
        h('span.settings-label', { text: 'Profile picture' }),
        h('div.row', file, pictureChoices),
        h('span.hint', { text: 'PNG, JPEG, WebP or GIF. It is shown to people in campaigns you share.' }))),
    nameForm);
}

function appearanceSection(app) {
  const { line, say } = messenger();
  let choices = currentAppearance();
  const groups = h('div.settings-appearance');

  const draw = () => refill(groups, APPEARANCE.map((setting) => h('fieldset.settings-choice',
    h('legend', { text: setting.label }),
    h('div.choice-row', setting.options.map(([value, label]) => h(`label.choice${setting.key === 'accent' ? `.accent-choice.accent-${value}` : ''}`,
      { class: choices[setting.key] === value ? 'is-on' : '' },
      h('input', {
        type: 'radio',
        name: `appearance-${setting.key}`,
        value,
        checked: choices[setting.key] === value,
        onchange: async () => {
          choices = await setAppearance({ [setting.key]: value }, { signedIn: Boolean(app.user) });
          draw();
          say('pass', app.user ? 'Saved to your account.' : 'Saved in this browser.');
        },
      }),
      setting.key === 'accent' ? h('span.swatch', { 'aria-hidden': 'true' }) : null,
      h('span', { text: label })))),
    h('span.hint', { text: setting.hint }))));
  draw();

  return h('section.campaign-section',
    h('h2', { text: 'Appearance' }),
    h('p.hint', { text: 'Changes show at once, and follow you to any device you sign in on.' }),
    line,
    groups);
}

function signInSection(p, ways) {
  const have = p.signIns.map((s) => s.provider);
  return h('section.campaign-section',
    h('h2', { text: 'Sign-in' }),
    h('ul.profile-signins', p.signIns.map((s) => h('li',
      h('span', { text: PROVIDER_LABELS[s.provider] || s.provider }),
      s.name ? h('span.hint', { text: `as ${s.name}` }) : null,
      h('span.hint', { text: `since ${since(s.since)}` })))),
    ways.linkable.filter((name) => !have.includes(name)).map((name) => button(`Also sign in with ${PROVIDER_LABELS[name]}`,
      () => ways.link(name), { subtle: true, title: `Reach this same account by signing in with ${PROVIDER_LABELS[name]} too.` })));
}

/**
 * A picture file, as a small square data URL: cut from the middle, drawn at
 * 256 pixels, and compressed until the server will take it.
 */
async function squarePicture(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('that file is not a picture this browser can read'));
      image.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    for (const [type, quality] of [['image/webp', 0.86], ['image/jpeg', 0.86], ['image/jpeg', 0.6]]) {
      const data = canvas.toDataURL(type, quality);
      if (data.startsWith(`data:${type};`) && data.length <= PICTURE_MAX_CHARS) return data;
    }
    throw new Error('that picture could not be made small enough');
  } finally {
    URL.revokeObjectURL(url);
  }
}
