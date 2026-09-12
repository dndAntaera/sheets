// Small shared arithmetic. Kept in one place because 3.5e rounds down almost
// everywhere, and a stray Math.round in the wrong formula is the kind of bug
// that silently gives a character an extra point of something for ten levels.

export const floorDiv = (n, d) => Math.floor(n / d);

/** A 3.5e ability modifier: (score - 10) / 2, rounded down, and -5 at score 0. */
export function abilityMod(score) {
  if (score === null || score === undefined || score === '') return 0;
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.floor((n - 10) / 2);
}

export const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** "+3" / "-1" / "+0" - how a bonus is written on a sheet. */
export const signed = (n) => (n < 0 ? String(n) : `+${n}`);

/** Numbers arrive from input fields as strings, and "" must read as 0. */
export const num = (v, fallback = 0) => {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
