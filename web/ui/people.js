// The few things about a person the whole app needs: their face, what their
// role is called, and the invitation they arrived with.
//
// These are small, and the header draws them on every page. They live here
// rather than in profile.js, admin.js and campaigns.js so that opening a
// character sheet does not fetch the Accounts page to draw an avatar - those
// pages are loaded only when somebody goes to them (ui/lazy.js).

import { h } from './dom.js';

export const ROLE_LABELS = { player: 'Player', gm: 'GM', admin: 'Admin' };
export const CAMPAIGN_ROLE_LABELS = { owner: 'Owner', gm: 'GM', player: 'Player' };

const PENDING_INVITE = 'antaera-sheets/v1/pending-invite';

/** An invitation followed before signing in, kept until the sign-in comes back. */
export function keepPendingInvite(code) {
  try { sessionStorage.setItem(PENDING_INVITE, code); } catch { /* the link can be opened again */ }
}

/** The invitation waiting, if any - taken, so it is acted on once. */
export function takePendingInvite() {
  try {
    const code = sessionStorage.getItem(PENDING_INVITE);
    sessionStorage.removeItem(PENDING_INVITE);
    return code;
  } catch {
    return null;
  }
}

/** Someone's picture, or their initials on a colour of their own. */
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
