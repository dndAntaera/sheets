// How the site looks for this player: theme, accent color, text size, motion.
//
// Choices are kept in this browser, so the page is drawn right before anything
// has loaded, and on the player's account, so they follow them to another
// device. The account's copy wins when both exist. What the options are is
// engine/preferences.js; what they do is "Appearance" in css/sheet.css.

import { preferences, remote } from '../store.js';
import { APPEARANCE, DEFAULT_APPEARANCE, normalizePreferences } from '../engine/preferences.js';

const ATTRIBUTES = { theme: 'data-theme', accent: 'data-accent', textSize: 'data-text-size', motion: 'data-motion' };

/** What this browser has kept, including a theme chosen before there were settings. */
function kept() {
  const stored = normalizePreferences(preferences.get('appearance', {}));
  const oldTheme = preferences.get('theme', null);
  if (!stored.theme && (oldTheme === 'light' || oldTheme === 'dark')) stored.theme = oldTheme;
  return stored;
}

/** Every setting, as chosen here or at its default. */
export function currentAppearance() {
  return { ...DEFAULT_APPEARANCE, ...kept() };
}

/** Put the choices on the page: attributes on <html>, left off at their defaults. */
export function applyAppearance(choices = currentAppearance()) {
  const root = document.documentElement;
  for (const setting of APPEARANCE) {
    const value = choices[setting.key];
    const attribute = ATTRIBUTES[setting.key];
    if (value && value !== DEFAULT_APPEARANCE[setting.key]) root.setAttribute(attribute, value);
    else root.removeAttribute(attribute);
  }
}

/** Keep choices in this browser and apply them. The Legal page reads `theme`, too. */
export function rememberAppearance(choices) {
  const clean = normalizePreferences(choices);
  preferences.set('appearance', clean);
  preferences.set('theme', clean.theme && clean.theme !== 'system' ? clean.theme : null);
  applyAppearance({ ...DEFAULT_APPEARANCE, ...clean });
  return clean;
}

/**
 * Change some settings: here at once, and on the account when signed in.
 * @returns the choices now in force
 */
export async function setAppearance(changes, { signedIn = false } = {}) {
  const clean = rememberAppearance({ ...kept(), ...changes });
  if (signedIn) await remote.profile.setPreferences(clean).catch(() => {});
  return { ...DEFAULT_APPEARANCE, ...clean };
}

/**
 * On signing in: the account's choices win. An account with none yet takes
 * this browser's, so nobody's first sign-in resets how the site looks to them.
 */
export function adoptAccountAppearance(fromAccount) {
  const theirs = normalizePreferences(fromAccount);
  if (Object.keys(theirs).length) return rememberAppearance(theirs);
  const mine = kept();
  if (Object.keys(mine).length) remote.profile.setPreferences(mine).catch(() => {});
  return mine;
}

/** Whether the page is dark right now - chosen, or by the device when set to match it. */
export function isDark() {
  const theme = currentAppearance().theme;
  if (theme === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  return theme === 'dark';
}
