// The sheets server.
//
// A Cloudflare Worker in front of a D1 database. It signs players in, and keeps
// their characters, their homebrew, and the campaigns they play in. It does no
// arithmetic: the engine in web/engine computes every sheet, in the browser.
//
// THE SHAPE OF IT
//
//   index.js      this file: assembles the features into one router
//   router.js     matches a request to a feature's route, and checks sign-in
//   http.js       responses, errors, bodies, tokens, cross-origin headers
//   sessions.js   bearer-token sessions
//   roles.js      site-wide roles: player < gm < admin
//   policy.js     every permission rule, as pure functions
//   rulesets.js   the rulesets, read from the app's own data files
//   features/     one module per feature, each exporting `routes`
//
// ADDING A FEATURE: write features/thing.js exporting `routes` (see router.js
// for their shape), put its permission rules in policy.js, its tables in a new
// migration, and add it to FEATURES below. Nothing else needs to change.

import { createRouter } from './router.js';
import { json, now, preflight, withCors } from './http.js';
import * as auth from './features/auth.js';
import { signInSetup } from './features/auth.js';
import * as accounts from './features/accounts.js';
import * as characters from './features/characters.js';
import * as content from './features/content.js';
import * as campaigns from './features/campaigns.js';
import * as campaignContent from './features/campaign-content.js';
import * as profile from './features/profile.js';
import * as feedback from './features/feedback.js';

const health = {
  routes: [
    { method: 'GET', path: '/', auth: 'none', handler: () => json({ ok: true, service: 'sheets', now: now() }) },
    // With what sign-in is missing, by setting name, so a deploy can be checked from a browser.
    { method: 'GET', path: '/health', auth: 'none', handler: ({ env }) => json({ ok: true, service: 'sheets', now: now(), signIn: signInSetup(env) }) },
  ],
};

export const FEATURES = [health, auth, accounts, characters, content, campaigns, campaignContent, profile, feedback];

const route = createRouter(FEATURES);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return preflight(request, env);
    try {
      return withCors(await route(request, env), request, env);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      return withCors(json({ error: status === 500 ? 'server error' : err.message }, status), request, env);
    }
  },
};

