// The rulesets the server knows, read from the same files the app loads, so a
// campaign's settings are checked against exactly the rules the app will apply.
//
// A new ruleset is one import and one entry here, beside its file in web/data.

import srd from '../../web/data/rulesets/srd.json' with { type: 'json' };
import antaera from '../../web/data/rulesets/antaera.json' with { type: 'json' };

export const RULESETS = { srd, antaera };
export const RULESET_IDS = Object.keys(RULESETS);
export const isRuleset = (id) => Object.hasOwn(RULESETS, id);
