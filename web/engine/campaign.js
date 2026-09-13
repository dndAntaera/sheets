// Campaigns, as far as the rules are concerned.
//
// A campaign is a table: a GM, the players they invited, one ruleset, and the
// choices the GM has made for everyone - gestalt or not, which level characters
// start at, whether players may look at each other's sheets. Those choices are
// the campaign's SETTINGS, and this file is the one description of them.
//
// Both halves read it. The server imports it to accept only settings that
// exist and to coerce their values; the app imports it to draw the settings
// form, and to apply a campaign's choices to a character in it. So a setting
// added here is validated, editable, and in force everywhere at once.
//
// Pure: no DOM, no fetch, no database.

import { MODULES, MODULE_LABELS } from './modules.js';

/**
 * Settings every campaign has, whatever its ruleset.
 *
 * type    bool | int | text | textarea | url
 * default a value, or a function of the ruleset
 */
export const GENERAL_SETTINGS = [
  {
    key: 'startingLevel',
    type: 'int',
    label: 'Starting level',
    min: 1,
    max: 20,
    default: (ruleset) => ruleset.startingLevel || 1,
    hint: 'New characters in this campaign are measured against this level.',
  },
  {
    key: 'partyVisible',
    type: 'bool',
    label: 'Players can see each other’s characters',
    default: false,
    hint: 'Read only. The GMs can always see and edit every character in the campaign.',
  },
  {
    key: 'allowHomebrew',
    type: 'bool',
    label: 'Allow homebrew',
    default: false,
    hint: 'Players may use homebrew from their own libraries on characters here. Homebrew the GMs write for this campaign is always allowed.',
  },
  {
    key: 'houseRules',
    type: 'textarea',
    label: 'House rules',
    maxLength: 8000,
    default: '',
    hint: 'Anything the sheet cannot enforce. Shown to everyone in the campaign.',
  },
  {
    key: 'link',
    type: 'url',
    label: 'Campaign link',
    default: '',
    hint: 'A wiki, a Discord server, a shared document.',
  },
];

/**
 * The rules modules a campaign's GM decides for the table.
 *
 * Under a ruleset whose variants are the player's choice (the SRD), a campaign
 * takes that choice over. Under a ruleset that fixes its own modules (Antaera),
 * only the ones it hands to the GM - gestalt - are the campaign's to set.
 */
export function settableModules(ruleset) {
  return MODULES.filter((name) => {
    const def = ruleset?.modules?.[name];
    return def?.available && (ruleset.variantsChosenBy === 'player' || def.lockedBy === 'gm');
  });
}

/** Every setting for a campaign under this ruleset, as fields to draw or check. */
export function settingsSchema(ruleset) {
  const modules = settableModules(ruleset).map((name) => ({
    key: `modules.${name}`,
    module: name,
    type: 'bool',
    label: MODULE_LABELS[name],
    default: Boolean(ruleset.modules[name].enabled),
    hint: ruleset.variantNotes?.[name] || '',
    group: 'rules',
  }));
  return [
    ...modules,
    ...GENERAL_SETTINGS.map((s) => ({ ...s, group: 'table', default: typeof s.default === 'function' ? s.default(ruleset) : s.default })),
  ];
}

const get = (object, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), object);

/**
 * Accept only settings that exist for this ruleset, coerced to their types.
 * Unknown keys are dropped rather than refused, so an older app talking to a
 * newer server - or the reverse - never fails to save a campaign.
 *
 * @returns { settings, dropped } - `dropped` names what was not accepted
 */
export function normalizeSettings(input = {}, ruleset) {
  const schema = settingsSchema(ruleset);
  const settings = { modules: {} };
  const dropped = [];
  const known = new Set(schema.map((s) => s.key));

  for (const field of schema) {
    const raw = get(input, field.key);
    if (raw === undefined || raw === null || raw === '') {
      if (field.type === 'bool' && field.module) continue;   // unset: the ruleset's default applies
      continue;
    }
    let value;
    switch (field.type) {
      case 'bool':
        value = raw === true || raw === 'true' || raw === 1;
        break;
      case 'int': {
        const n = Math.round(Number(raw));
        if (!Number.isFinite(n)) { dropped.push(field.key); continue; }
        value = Math.min(field.max ?? n, Math.max(field.min ?? n, n));
        break;
      }
      case 'url': {
        const text = String(raw).trim();
        if (!/^https?:\/\/[^\s]+$/i.test(text)) { dropped.push(field.key); continue; }
        value = text.slice(0, 500);
        break;
      }
      default:
        value = String(raw).slice(0, field.maxLength ?? 500);
    }
    if (field.module) settings.modules[field.module] = value;
    else settings[field.key] = value;
  }

  // Report anything offered that is not a setting, for the caller's benefit.
  for (const key of Object.keys(input || {})) {
    if (key === 'modules') {
      for (const name of Object.keys(input.modules || {})) {
        if (!known.has(`modules.${name}`)) dropped.push(`modules.${name}`);
      }
    } else if (!known.has(key)) {
      dropped.push(key);
    }
  }
  return { settings, dropped };
}

/** A setting's value in force: the campaign's if set, otherwise its default. */
export function settingValue(campaign, ruleset, key) {
  const field = settingsSchema(ruleset).find((s) => s.key === key);
  const set = get(campaign?.settings || {}, key);
  return set === undefined ? field?.default : set;
}

/**
 * What a campaign changes about the rules for a character in it.
 *
 * @param rules     the rules context for the campaign's ruleset
 * @param campaign  { ruleset, settings }
 * @returns { rules, overrides }
 *   rules      the same context, with the campaign's starting level
 *   overrides  module on/off decisions, for derive() and moduleState()
 */
export function applyCampaign(rules, campaign) {
  if (!campaign) return { rules, overrides: {} };
  const ruleset = rules.ruleset;
  const overrides = {};
  for (const name of settableModules(ruleset)) {
    overrides[name] = Boolean(settingValue(campaign, ruleset, `modules.${name}`));
  }
  const startingLevel = settingValue(campaign, ruleset, 'startingLevel');
  const allowHomebrew = Boolean(settingValue(campaign, ruleset, 'allowHomebrew'));
  return {
    rules: { ...rules, ruleset: { ...ruleset, startingLevel }, campaign: { ...campaign, allowHomebrew } },
    overrides,
  };
}
