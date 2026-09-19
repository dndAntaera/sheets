// The Discord bot: rolling from a sheet with a slash command.
//
//   POST /discord/interactions     Discord's interactions endpoint for the app
//
// Discord sends every command here, signed with the application's key; nothing
// unsigned is answered. A person is recognized by the Discord account they
// signed in to the sheets with (or linked in Settings), and rolls from the
// characters that account can see. No bot token is needed to answer commands -
// only to register them, which scripts/register-discord-commands.py does once.
//
// The commands (scripts/discord-commands.json):
//
//   /roll what [character]     a skill, save, ability, initiative, weapon or dice
//   /sheet [character]         a character's numbers at a glance
//   /character name            which character this Discord account rolls as
//
// Each has a one-letter shortcut that works the same: /r 1d6 is /roll 1d6,
// /s is /sheet and /c is /character (SHORTCUTS below).
//
// A roll reads `character.rolls`, the snapshot the app writes each time a sheet
// is saved (web/engine/rolls.js): the server does no arithmetic of its own.
//
// Settings: DISCORD_PUBLIC_KEY, the application's public key from the Discord
// developer portal. Without it the endpoint says it is not set up.

import { json, now } from '../http.js';
import { visibleCharacters } from './characters.js';
import { rollFor, rollChoices } from '../../../web/engine/rolls.js';

const PING = 1;
const COMMAND = 2;
const AUTOCOMPLETE = 4;
const PONG = 1;
const MESSAGE = 4;
const CHOICES = 8;
const EPHEMERAL = 64;
const COLOR = 0x7c5cff;

const hexBytes = (hex) => new Uint8Array((String(hex).match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));

/**
 * Whether Discord signed this request: Ed25519 over the timestamp and the body,
 * with the application's public key.
 */
export async function verifyDiscord(publicKey, signature, timestamp, body) {
  if (!publicKey || !/^[0-9a-f]{128}$/i.test(signature || '') || !timestamp || !/^[0-9a-f]{64}$/i.test(publicKey)) return false;
  const data = new TextEncoder().encode(timestamp + body);
  for (const algorithm of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try {
      const key = await crypto.subtle.importKey('raw', hexBytes(publicKey), algorithm, false, ['verify']);
      return await crypto.subtle.verify(algorithm, key, hexBytes(signature), data);
    } catch {
      // Not this runtime's name for the algorithm: try the next.
    }
  }
  return false;
}

/** The one-letter commands, and the command each stands for. */
export const SHORTCUTS = { r: 'roll', s: 'sheet', c: 'character' };
const commandName = (interaction) => SHORTCUTS[interaction.data?.name] || interaction.data?.name;

const option = (interaction, name) => (interaction.data?.options || []).find((o) => o.name === name);
const say = (content, { ephemeral = true } = {}) => json({ type: MESSAGE, data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } } });

/** The sheets account a Discord user signed in with, or null. */
async function accountFor(env, discordId) {
  if (!discordId) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.name FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = 'discord' AND i.subject = ?"
  ).bind(discordId).first();
  return row || null;
}

/** The character a command means: named, or the one chosen with /character, or the only one. */
async function characterFor(env, account, named) {
  const rows = await visibleCharacters(env, account.id);
  if (!rows.length) return { error: 'You have no characters on the sheets yet.' };
  const lower = (s) => String(s || '').trim().toLowerCase();
  let row = null;
  if (named) {
    row = rows.find((r) => r.id === named) || rows.find((r) => lower(r.name) === lower(named))
      || rows.find((r) => lower(r.name).startsWith(lower(named)));
    if (!row) return { error: `None of your characters is called "${named}".` };
  } else {
    const chosen = await env.DB.prepare('SELECT character_id FROM discord_links WHERE user_id = ?').bind(account.id).first();
    row = rows.find((r) => r.id === chosen?.character_id) || (rows.length === 1 ? rows[0] : null);
    if (!row) return { error: 'Which character? Choose one with /character, or name one in the command.' };
  }
  // Only the snapshot, not the whole sheet: autocomplete asks on every keystroke.
  const stored = await env.DB.prepare("SELECT json_extract(data, '$.rolls') AS rolls FROM characters WHERE id = ?").bind(row.id).first();
  const rolls = stored?.rolls ? JSON.parse(stored.rolls) : null;
  if (!rolls) return { error: `${row.name || 'That character'} has not been saved since rolling arrived. Open the sheet once and it is ready.` };
  return { row, sheet: rolls };
}

const signed = (n) => (n < 0 ? `${n}` : `+${n}`);

async function command(env, interaction, account) {
  const name = commandName(interaction);

  if (name === 'character') {
    const found = await characterFor(env, account, option(interaction, 'name')?.value);
    if (found.error) return say(found.error);
    await env.DB.prepare(
      `INSERT INTO discord_links (user_id, character_id, updated) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET character_id = excluded.character_id, updated = excluded.updated`
    ).bind(account.id, found.row.id, now()).run();
    return say(`You roll as **${found.sheet.name}** now.`);
  }

  if (name === 'roll') {
    const found = await characterFor(env, account, option(interaction, 'character')?.value);
    if (found.error) return say(found.error);
    const result = rollFor(found.sheet, option(interaction, 'what')?.value || '');
    if (result.error) return say(result.error);
    return json({
      type: MESSAGE,
      data: {
        embeds: [{ title: result.title, description: result.text, color: COLOR, footer: { text: found.sheet.build || '' } }],
        allowed_mentions: { parse: [] },
      },
    });
  }

  if (name === 'sheet') {
    const found = await characterFor(env, account, option(interaction, 'character')?.value);
    if (found.error) return say(found.error);
    const s = found.sheet;
    const attacks = (s.attacks || []).map((a) => `${a.name} ${a.bonuses.map(signed).join('/')}${a.damage ? ` (${a.damage}, ${a.critical})` : ''}`);
    return json({
      type: MESSAGE,
      data: {
        embeds: [{
          title: s.name,
          description: s.build || '',
          color: COLOR,
          fields: [
            { name: 'AC', value: `${s.ac.total} (touch ${s.ac.touch}, flat-footed ${s.ac.flatFooted})`, inline: true },
            { name: 'HP', value: s.hp.current !== null && s.hp.current !== undefined ? `${s.hp.current} / ${s.hp.max}` : `${s.hp.max}`, inline: true },
            { name: 'Initiative', value: signed(s.initiative), inline: true },
            { name: 'Saves', value: `Fort ${signed(s.saves.fort)}, Ref ${signed(s.saves.ref)}, Will ${signed(s.saves.will)}`, inline: true },
            { name: 'Speed', value: `${s.speed} ft.`, inline: true },
            { name: 'BAB', value: `${signed(s.bab)}${s.grapple !== null ? `, grapple ${signed(s.grapple)}` : ''}`, inline: true },
            { name: 'Abilities', value: Object.entries(s.abilities).map(([k, a]) => `${k.toUpperCase()} ${a.score} (${signed(a.mod)})`).join(' · ') },
            ...(attacks.length ? [{ name: 'Attacks', value: attacks.join('\n').slice(0, 1024) }] : []),
          ],
        }],
        allowed_mentions: { parse: [] },
      },
    });
  }

  return say('That command is not one this bot knows.');
}

async function autocomplete(env, interaction, account) {
  const focused = (interaction.data?.options || []).find((o) => o.focused);
  const typed = String(focused?.value || '');
  const choices = (list) => json({ type: CHOICES, data: { choices: list.slice(0, 25).map((c) => (typeof c === 'string' ? { name: c.slice(0, 100), value: c.slice(0, 100) } : c)) } });
  if (!account || !focused) return choices([]);

  if (focused.name === 'character' || focused.name === 'name') {
    const rows = await visibleCharacters(env, account.id);
    const t = typed.toLowerCase();
    return choices(rows.filter((r) => !t || String(r.name || '').toLowerCase().includes(t))
      .map((r) => ({ name: `${r.name || 'Unnamed'}${r.build ? ` - ${r.build}` : ''}`.slice(0, 100), value: r.id })));
  }
  if (focused.name === 'what') {
    const found = await characterFor(env, account, option(interaction, 'character')?.value);
    return choices(found.sheet ? rollChoices(found.sheet, typed) : []);
  }
  return choices([]);
}

async function interactions({ env, request }) {
  if (!env.DISCORD_PUBLIC_KEY) return json({ error: 'the Discord bot is not set up on this server' }, 503);
  const body = await request.text();
  if (body.length > 64 * 1024) return json({ error: 'that is too large' }, 413);
  const ok = await verifyDiscord(env.DISCORD_PUBLIC_KEY, request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'), body);
  if (!ok) return json({ error: 'invalid request signature' }, 401);

  let interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return json({ error: 'the body was not JSON' }, 400);
  }
  return handleInteraction(env, interaction);
}

/** An interaction whose signature has been checked. */
export async function handleInteraction(env, interaction) {
  if (interaction.type === PING) return json({ type: PONG });
  const discordId = interaction.member?.user?.id || interaction.user?.id;
  const account = await accountFor(env, discordId);
  if (interaction.type === AUTOCOMPLETE) return autocomplete(env, interaction, account);
  if (interaction.type !== COMMAND) return json({ error: 'not an interaction this bot answers' }, 400);
  if (!account) {
    const site = String(env.SITE_ORIGIN || '').split(',')[0].trim();
    return say(`Sign in to the sheets${site ? ` (${site}${env.SITE_PATH || '/'})` : ''} with Discord - or add Discord in Settings - and your characters can roll here.`);
  }
  return command(env, interaction, account);
}

export const routes = [
  { method: 'POST', path: '/discord/interactions', auth: 'none', handler: interactions },
];
