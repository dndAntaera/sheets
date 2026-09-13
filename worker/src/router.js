// The router: how features plug into the server.
//
// A feature is a module that exports `routes`, a list of plain objects:
//
//   { method: 'GET', path: '/api/campaigns/:id', auth: 'user', handler }
//
// `auth` is checked before the handler runs, against the account's site-wide
// role: 'none' (anyone), 'user' (signed in), 'gm', or 'admin'. Finer rules -
// who may edit THIS campaign - belong to the feature, through policy.js.
//
// A handler receives one context object and returns a Response:
//
//   ctx.request  the Request
//   ctx.env      bindings and settings
//   ctx.url      the parsed URL
//   ctx.params   the :named parts of the path
//   ctx.user     the signed-in account, when auth is not 'none'
//   ctx.body(n)  the JSON body, refused if longer than n characters
//
// Adding a feature is a new module and one line in index.js.

import { fail, readJson } from './http.js';
import { currentUser } from './sessions.js';
import { atLeast } from './roles.js';

const SEGMENT = '([A-Za-z0-9_-]{1,64})';

function compile(route) {
  const names = [];
  const pattern = route.path.replace(/:([a-zA-Z]+)/g, (_, name) => {
    names.push(name);
    return SEGMENT;
  });
  return { ...route, auth: route.auth || 'user', names, regex: new RegExp(`^${pattern}$`) };
}

export function createRouter(features) {
  const routes = features.flatMap((feature) => (feature.routes || []).map(compile));

  return async function route(request, env) {
    const url = new URL(request.url);
    let pathMatched = false;

    for (const r of routes) {
      const match = url.pathname.match(r.regex);
      if (!match) continue;
      pathMatched = true;
      if (r.method !== request.method) continue;

      const params = Object.fromEntries(r.names.map((name, i) => [name, match[i + 1]]));
      const ctx = { request, env, url, params, user: null, body: (limit = 64 * 1024) => readJson(request, limit) };

      if (r.auth !== 'none') {
        ctx.user = await currentUser(request, env);
        if (!ctx.user) throw fail(401, 'not signed in');
        if (r.auth !== 'user' && !atLeast(ctx.user, r.auth)) {
          throw fail(403, r.auth === 'admin' ? 'only an admin can do that' : 'only a GM can do that');
        }
      }
      return r.handler(ctx);
    }

    throw fail(pathMatched ? 405 : 404, pathMatched ? 'not allowed on that address' : 'no such endpoint');
  };
}
