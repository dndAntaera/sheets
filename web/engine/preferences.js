// A player's profile and preferences, described once for both halves.
//
// The app draws the Settings page from APPEARANCE and applies the choices; the
// server stores only what normalizePreferences lets through, and checks a new
// username with checkUsername. A new appearance setting is one entry here and
// its CSS (see "Appearance" in css/sheet.css).

/** How the site looks. The first option of each is the default. */
export const APPEARANCE = [
  {
    key: 'theme',
    label: 'Theme',
    hint: 'Day is parchment, night is slate.',
    options: [
      ['system', 'Match my device'],
      ['light', 'Day'],
      ['dark', 'Night'],
    ],
  },
  {
    key: 'accent',
    label: 'Accent color',
    hint: 'Links, buttons and highlights.',
    options: [
      ['violet', 'Violet'],
      ['blue', 'Blue'],
      ['green', 'Green'],
      ['crimson', 'Crimson'],
      ['gold', 'Gold'],
    ],
  },
  {
    key: 'textSize',
    label: 'Text size',
    hint: 'Everything on the site grows with it, sheets included.',
    options: [
      ['standard', 'Standard'],
      ['large', 'Large'],
      ['larger', 'Larger'],
    ],
  },
  {
    key: 'motion',
    label: 'Motion',
    hint: 'Reduced turns off transitions and animation.',
    options: [
      ['standard', 'Standard'],
      ['reduced', 'Reduced'],
    ],
  },
];

/** Every setting at its default. */
export const DEFAULT_APPEARANCE = Object.fromEntries(APPEARANCE.map((s) => [s.key, s.options[0][0]]));

/**
 * Only settings that exist, with values they allow. Anything else is dropped
 * rather than refused, so an older app and a newer server never fail to agree.
 */
export function normalizePreferences(input = {}) {
  const out = {};
  for (const setting of APPEARANCE) {
    const value = input?.[setting.key];
    if (setting.options.some(([v]) => v === value)) out[setting.key] = value;
  }
  return out;
}

export const USERNAME_LIMITS = { min: 2, max: 32 };

/**
 * A username as it will be stored, or why it cannot be. Letters and numbers in
 * any script, with spaces, apostrophes, full stops, hyphens and underscores
 * between them; runs of spaces become one.
 *
 * @returns { ok: true, name } | { ok: false, error }
 */
export function checkUsername(input) {
  const name = String(input ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const { min, max } = USERNAME_LIMITS;
  if ([...name].length < min) return { ok: false, error: `a username needs at least ${min} characters` };
  if ([...name].length > max) return { ok: false, error: `a username can have at most ${max} characters` };
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N} '’._-]*[\p{L}\p{N}])?$/u.test(name)) {
    return { ok: false, error: 'a username uses letters and numbers, with spaces, apostrophes, full stops, hyphens or underscores between them' };
  }
  return { ok: true, name };
}

/** The most a profile picture may weigh, as the data URL the app sends. */
export const PICTURE_MAX_CHARS = 200_000;

/** Whether a string is a picture the server will keep: a small PNG, JPEG or WebP data URL. */
export function isPictureData(value) {
  return typeof value === 'string'
    && value.length <= PICTURE_MAX_CHARS
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
}
