// Site-wide roles: player < gm < admin, each with everything below it.
//
//   player  their own characters and homebrew; joins campaigns by invitation
//   gm      also creates and runs campaigns
//   admin   also manages accounts: roles, and removing an account
//
// What a GM may do inside ONE campaign is not a site-wide role; see policy.js.

export const ROLES = ['player', 'gm', 'admin'];
export const rank = (role) => Math.max(0, ROLES.indexOf(role));
export const atLeast = (user, role) => Boolean(user) && rank(user.role) >= rank(role);
export const higher = (a, b) => (rank(a) >= rank(b) ? a : b);

/** The account as the app sees it. `gm` and `admin` are kept for plain checks. */
export function describe(row) {
  const role = ROLES.includes(row.role) ? row.role : 'player';
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar ?? null,
    role,
    gm: rank(role) >= rank('gm'),
    admin: role === 'admin',
  };
}
