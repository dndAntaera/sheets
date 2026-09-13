// HTTP plumbing shared by every feature: responses, errors, bodies, tokens.

export const now = () => new Date().toISOString();

/** Comma-separated setting to a list: "a, b" -> ["a", "b"]. */
export const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

/** An error that becomes a response with this status and message. */
export const fail = (status, message) => Object.assign(new Error(message), { status });

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

export const noContent = () => new Response(null, { status: 204 });

export const redirect = (location) => new Response(null, { status: 302, headers: { location } });

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A short code a person can read aloud or type: no 0/O, no 1/I/L. */
export function friendlyCode(length = 10) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => alphabet[b % alphabet.length]).join('');
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const siteUrl = (env) => `${list(env.SITE_ORIGIN)[0] || ''}${env.SITE_PATH || '/'}`;

export async function readJson(request, limit) {
  const text = await request.text();
  if (text.length > limit) throw fail(413, 'that is too large');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw fail(400, 'the body was not a JSON object');
  }
}

/* -------------------------------------------------------------------------
   Cross-origin: the app is on github.io, this Worker on workers.dev
   ------------------------------------------------------------------------- */

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return list(env.SITE_ORIGIN).includes(origin) || isLocal ? origin : null;
}

export function withCors(response, request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('vary', 'origin');
  return new Response(response.body, { status: response.status, headers });
}

export function preflight(request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    },
  });
}
