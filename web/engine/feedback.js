// Feedback from the Contact Me page: what a message may hold.
//
// The page checks a message with this before sending it, and the server checks
// it again before storing it, so both refuse the same things for the same reasons.
//
// Pure: no DOM, no fetch.

export const FEEDBACK_LIMITS = {
  name: 80,
  discord: 40,
  email: 254,
  messageMin: 10,
  messageMax: 4000,
  /** How many messages one sender may send in an hour. */
  perHour: 5,
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * @param input { name, discord, email, message }
 * @returns { ok, errors: { field: text }, value: { name, discord, email, message } }
 */
export function checkFeedback(input = {}) {
  const L = FEEDBACK_LIMITS;
  const errors = {};
  const value = {
    name: clean(input.name),
    discord: clean(input.discord).replace(/^@/, ''),
    email: clean(input.email).toLowerCase(),
    // Line breaks are kept in a message; runs of blank lines are not.
    message: String(input.message ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
  };

  if (value.name.length > L.name) errors.name = `A name of up to ${L.name} characters.`;
  if (value.discord && (value.discord.length > L.discord || !/^[\w.#-]{2,40}$/.test(value.discord))) {
    errors.discord = 'A Discord username: letters, numbers, dots and underscores.';
  }
  if (value.email && (value.email.length > L.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.email))) {
    errors.email = 'An email address like name@example.com.';
  }
  if (value.message.length < L.messageMin) errors.message = `A message of at least ${L.messageMin} characters.`;
  else if (value.message.length > L.messageMax) errors.message = `A message of up to ${L.messageMax.toLocaleString()} characters.`;

  return { ok: Object.keys(errors).length === 0, errors, value };
}
