// Inventory, equipment slots, and what they carry into the numbers.
//
// The inventory is `character.wealth.items`: one row an item, with how many,
// what one weighs and is worth, what was paid for it, and - for a weapon,
// armor or shield - its statistics, copied from the SRD or entered by hand, so
// a sheet is whole without the reference loaded. `character.equipment` says
// what is worn or held: armor, shield, any number of weapon slots, and the
// body slots a magic item goes in. Slots hold item ids, never names.
//
// Money is a ledger, not a number typed in: coins are the starting wealth plus
// every entry in `character.wealth.ledger` - a purchase (negative, linked to its
// item), a sale, or anything else written down. Buying writes the purchase then
// and there, so using up arrows or dropping a torch never gives coins back; an
// item removed can undo its purchase, and an item sold brings half its value.
//
// Pure: no DOM, no fetch.

import { num } from './util.js';

/** 3.5's body slots for magic items (the DMG's "Magic Items on the Body"). */
export const BODY_SLOTS = [
  { key: 'head', label: 'Head', examples: 'headband, helm, hat' },
  { key: 'face', label: 'Face', examples: 'goggles, lenses, mask' },
  { key: 'neck', label: 'Neck', examples: 'amulet, periapt, necklace' },
  { key: 'shoulders', label: 'Shoulders', examples: 'cloak, cape, mantle' },
  { key: 'body', label: 'Body', examples: 'robe, vestment' },
  { key: 'torso', label: 'Torso', examples: 'shirt, vest' },
  { key: 'arms', label: 'Arms', examples: 'bracers, bracelets' },
  { key: 'hands', label: 'Hands', examples: 'gloves, gauntlets' },
  { key: 'ring1', label: 'Ring', examples: 'ring' },
  { key: 'ring2', label: 'Ring', examples: 'ring' },
  { key: 'waist', label: 'Waist', examples: 'belt, girdle' },
  { key: 'feet', label: 'Feet', examples: 'boots, shoes' },
];

export const ITEM_CATEGORIES = ['Weapon', 'Armor', 'Shield', 'Ring', 'Wondrous item', 'Potion', 'Scroll', 'Wand', 'Rod', 'Staff', 'Ammunition', 'Gear', 'Tool', 'Clothing', 'Mount or vehicle', 'Trade good', 'Other'];

const lower = (s) => String(s || '').trim().toLowerCase();

export const newItemId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** "1,500 gp" -> 1500; "5 sp" -> 0.5; "2 cp" -> 0.02. */
export function parseGp(cost) {
  const m = String(cost || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(pp|gp|sp|cp)\b/i);
  if (!m) return 0;
  return Number(m[1]) * { pp: 10, gp: 1, sp: 0.1, cp: 0.01 }[m[2].toLowerCase()];
}

/** "4 lb." -> 4; "1/2 lb." -> 0.5; anything else -> null. */
export function parseWeight(text) {
  const m = String(text || '').match(/(\d+)(?:\/(\d+))?\s*lb/);
  if (!m) return null;
  return m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
}

const FINESSE_WEAPONS = new Set(['rapier', 'whip', 'chain, spiked']);
const THROWN_RANGED = /dart|javelin|shuriken|bolas|net\b|sling/i;

/**
 * An inventory row from an SRD equipment entry: its cost, weight and - for a
 * weapon, armor or shield - the statistics the sheet reads.
 */
export function itemFromReference(entry) {
  const weight = parseWeight(entry.weight) ?? parseWeight(entry.range) ?? parseWeight(entry.critical) ?? 0;
  const row = { id: newItemId(), name: entry.name, ref: entry.name, qty: 1, weight, value: parseGp(entry.cost), paid: null, category: 'Gear' };
  const sub = entry.subcategory || '';
  if (entry.family === 'Weapons') {
    if (sub === 'Ammunition') return { ...row, category: 'Ammunition' };
    const ranged = sub === 'Ranged Weapons';
    row.category = 'Weapon';
    row.stats = {
      kind: 'weapon',
      proficiency: (entry.category || '').replace(' Weapons', '').toLowerCase(),
      hands: ranged ? 'ranged' : sub.startsWith('Light') || sub === 'Unarmed Attacks' ? 'light' : sub.startsWith('Two-Handed') ? 'two-handed' : 'one-handed',
      damageSmall: /^\d+d\d+/.test(entry.damageSmall || '') ? entry.damageSmall : '',
      damageMedium: /^\d+d\d+/.test(entry.damageMedium || '') ? entry.damageMedium : '',
      critical: /x\d|\//.test(entry.critical || '') ? (entry.critical.includes('/') ? entry.critical : `20/${entry.critical}`) : '20/x2',
      range: /ft/.test(entry.range || '') ? Number(entry.range.match(/\d+/)[0]) : null,
      damageType: entry.damageType && !/lb\./.test(entry.damageType) ? entry.damageType : '',
      ranged,
      thrown: ranged ? THROWN_RANGED.test(entry.name) : /ft/.test(entry.range || ''),
      finesse: !ranged && (sub.startsWith('Light') || sub === 'Unarmed Attacks' || FINESSE_WEAPONS.has(lower(entry.name))),
      enhancement: 0,
      masterwork: false,
    };
  } else if (entry.category === 'Armor' && sub !== 'Extras') {
    const shield = sub === 'Shields';
    row.category = shield ? 'Shield' : 'Armor';
    row.stats = {
      kind: shield ? 'shield' : 'armor',
      armorType: shield ? 'shield' : lower(sub).replace(' armor', ''),
      bonus: num(entry.armorBonus),
      maxDex: entry.maxDex ?? null,
      acp: Math.abs(num(entry.checkPenalty)),
      asf: num(String(entry.spellFailure || '').match(/\d+/)?.[0]),
      speed30: entry.speed30 ? Number(String(entry.speed30).match(/\d+/)?.[0]) : null,
      speed20: entry.speed20 ? Number(String(entry.speed20).match(/\d+/)?.[0]) : null,
      enhancement: 0,
      masterwork: false,
    };
  } else if (/Tools/.test(sub)) {
    row.category = 'Tool';
  } else if (/Clothing/.test(sub)) {
    row.category = 'Clothing';
  } else if (/Mounts|Transport/.test(sub)) {
    row.category = 'Mount or vehicle';
  } else if (entry.family === 'Trade Goods') {
    row.category = 'Trade good';
  }
  return row;
}

/* ==========================================================================
   Carrying and wealth
   ========================================================================== */

// The heaviest load at each Strength score, 1 to 29 (Table: Carrying Capacity).
const HEAVY = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 115, 130, 150, 175, 200, 230, 260, 300, 350, 400, 460, 520, 600, 700, 800, 920, 1040, 1200, 1400];
const SIZE_CARRY = { Fine: 1 / 8, Diminutive: 1 / 4, Tiny: 1 / 2, Small: 3 / 4, Medium: 1, Large: 2, Huge: 4, Gargantuan: 8, Colossal: 16 };

/** Light, medium and heavy load limits in pounds, for a Strength score and size. */
export function carryingCapacity(str, size = 'Medium') {
  let score = Math.max(0, Math.floor(num(str)));
  let factor = 1;
  while (score > 29) { score -= 10; factor *= 4; }
  const heavy = HEAVY[score] * factor * (SIZE_CARRY[size] || 1);
  return { light: Math.floor(heavy / 3), medium: Math.floor((heavy * 2) / 3), heavy };
}

/** What a load does, as the SRD's Table: Carrying Loads. */
const LOADS = {
  light: { maxDex: null, acp: 0 },
  medium: { maxDex: 3, acp: 3 },
  heavy: { maxDex: 1, acp: 6 },
  overloaded: { maxDex: 0, acp: 6 },
};

/**
 * The money and the weight: rows totalled, coins from the ledger, total wealth,
 * and the load all of it makes.
 *
 * @param startingGold  the starting wealth in force (houserules.js wealth)
 */
export function inventoryTotals(character, startingGold, strScore, size) {
  const w = character.wealth || {};
  const equipped = equippedIds(character);
  const items = (w.items || []).map((item) => {
    const qty = Math.max(0, num(item.qty, 1));
    return {
      ...item,
      qty,
      lineWeight: num(item.weight) * qty,
      lineValue: num(item.value) * qty,
      slots: equipped.get(item.id) || [],
    };
  });
  const ledger = w.ledger || [];
  const spent = -ledger.filter((e) => e.kind === 'purchase').reduce((t, e) => t + num(e.amount), 0);
  const gains = ledger.filter((e) => e.kind !== 'purchase').reduce((t, e) => t + num(e.amount), 0);
  // A sheet from before the ledger counted its coins by hand; that count stands in for starting wealth.
  const basis = w.legacyCoins !== undefined && w.legacyCoins !== null ? num(w.legacyCoins) : num(startingGold);
  const coins = Math.round((basis - spent + gains) * 100) / 100;
  const itemsValue = items.reduce((t, i) => t + i.lineValue, 0);
  const itemsWeight = items.reduce((t, i) => t + i.lineWeight, 0);
  const coinWeight = Math.max(0, coins) / 50;
  const carried = Math.round((itemsWeight + coinWeight) * 100) / 100;
  const capacity = carryingCapacity(strScore, size);
  const load = carried <= capacity.light ? 'light' : carried <= capacity.medium ? 'medium' : carried <= capacity.heavy ? 'heavy' : 'overloaded';
  return {
    items,
    spent,
    gains,
    basis,
    legacy: basis !== num(startingGold) || (w.legacyCoins !== undefined && w.legacyCoins !== null),
    coins,
    itemsValue,
    total: itemsValue + coins,
    itemsWeight,
    coinWeight,
    carried,
    capacity,
    load,
    loadEffects: LOADS[load],
  };
}

/**
 * Buy an item: it joins the inventory (or adds to a row of the same thing), and
 * the ledger records what it cost. Returns new `items` and `ledger`; the
 * character is not changed.
 *
 * @param row  an inventory row, from itemFromReference or a custom item
 */
export function buyItem(character, row, qty = 1, { free = false } = {}) {
  const items = [...(character.wealth?.items || [])];
  const ledger = [...(character.wealth?.ledger || [])];
  const count = Math.max(1, Math.floor(num(qty, 1)));
  const same = items.findIndex((i) => i.ref && i.ref === row.ref && i.name === row.name && !num(i.stats?.enhancement) && !i.stats?.masterwork);
  let id;
  if (same >= 0 && row.ref) {
    items[same] = { ...items[same], qty: num(items[same].qty, 1) + count };
    id = items[same].id;
  } else {
    id = row.id || newItemId();
    items.push({ ...row, id, qty: count, paid: free ? null : num(row.value), equipped: false });
  }
  const cost = Math.round(num(row.value) * count * 100) / 100;
  if (!free && cost > 0) {
    ledger.push({ id: newItemId(), kind: 'purchase', itemId: id, label: `Bought ${count > 1 ? `${count} x ` : ''}${row.name}`, amount: -cost });
  }
  return { items, ledger, id };
}

/**
 * Take an item out of the inventory, and out of any slot it fills.
 *
 * @param how  'refund' undoes its purchases; 'sell' brings half its value back;
 *             'discard' just takes it away
 */
export function removeItem(character, itemId, how = 'discard') {
  const item = (character.wealth?.items || []).find((i) => i.id === itemId);
  let ledger = [...(character.wealth?.ledger || [])];
  if (item && how === 'refund') ledger = ledger.filter((e) => !(e.kind === 'purchase' && e.itemId === itemId));
  if (item && how === 'sell') {
    const back = Math.round((num(item.value) * Math.max(0, num(item.qty, 1))) / 2 * 100) / 100;
    if (back > 0) ledger.push({ id: newItemId(), kind: 'sale', itemId, label: `Sold ${item.name}`, amount: back });
  }
  const items = (character.wealth?.items || []).filter((i) => i.id !== itemId);
  const eq = structuredClone(character.equipment || { armor: null, shield: null, weapons: [], slots: {} });
  if (eq.armor === itemId) eq.armor = null;
  if (eq.shield === itemId) eq.shield = null;
  eq.weapons = (eq.weapons || []).map((id) => (id === itemId ? null : id));
  for (const key of Object.keys(eq.slots || {})) if (eq.slots[key] === itemId) eq.slots[key] = null;
  return { items, ledger, equipment: eq };
}

/** Whether an item has a purchase on the ledger that removing it could undo. */
export const purchaseOf = (character, itemId) => (character.wealth?.ledger || [])
  .filter((e) => e.kind === 'purchase' && e.itemId === itemId)
  .reduce((t, e) => t - num(e.amount), 0);

/* ==========================================================================
   Equipment slots
   ========================================================================== */

/** item id -> [slot keys it fills]. */
export function equippedIds(character) {
  const eq = character.equipment || {};
  const map = new Map();
  const put = (id, key) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(key);
  };
  put(eq.armor, 'armor');
  put(eq.shield, 'shield');
  (eq.weapons || []).forEach((id, i) => put(id, `weapon:${i}`));
  for (const [key, id] of Object.entries(eq.slots || {})) put(id, key);
  return map;
}

/** Which items may go in a slot, and how many of each are still free for it. */
export function slotChoices(character, slotKey) {
  const items = character.wealth?.items || [];
  const used = equippedIds(character);
  const current = slotKey === 'armor' ? character.equipment?.armor
    : slotKey === 'shield' ? character.equipment?.shield
      : slotKey.startsWith('weapon:') ? character.equipment?.weapons?.[Number(slotKey.slice(7))]
        : character.equipment?.slots?.[slotKey];
  const fits = (item) => {
    const kind = item.stats?.kind;
    if (slotKey === 'armor') return kind === 'armor' || item.category === 'Armor';
    if (slotKey === 'shield') return kind === 'shield' || item.category === 'Shield';
    if (slotKey.startsWith('weapon:')) return kind === 'weapon' || item.category === 'Weapon';
    if (['Weapon', 'Armor', 'Shield', 'Ammunition', 'Trade good', 'Mount or vehicle', 'Potion', 'Scroll'].includes(item.category)) return false;
    if (item.slot) return item.slot === slotKey || (item.slot === 'ring' && slotKey.startsWith('ring'));
    if (item.category === 'Ring') return slotKey.startsWith('ring');
    return true;
  };
  return items.filter(fits).map((item) => {
    const taken = (used.get(item.id) || []).filter((k) => k !== slotKey).length;
    const free = Math.max(0, num(item.qty, 1) - taken);
    return { item, free, current: item.id === current };
  }).filter((c) => c.free > 0 || c.current);
}

/** Armor, shield and the sheet's typed adjustments, as defense.js reads them. */
export function equippedGear(character, raceSpeed = 30) {
  const items = new Map((character.wealth?.items || []).map((i) => [i.id, i]));
  const eq = character.equipment || {};
  const typed = character.gear || {};
  const piece = (id) => {
    const item = items.get(id);
    if (!item) return { name: '', bonus: 0, maxDex: null, acp: 0, asf: 0, speed: null, enhancement: 0 };
    const s = item.stats || {};
    const enhancement = num(s.enhancement);
    const masterwork = Boolean(s.masterwork) || enhancement > 0;
    return {
      name: enhancement ? `${item.name} +${enhancement}` : item.name,
      itemId: item.id,
      bonus: num(s.bonus) + enhancement,
      maxDex: s.maxDex === '' || s.maxDex === undefined ? null : s.maxDex,
      acp: Math.max(0, num(s.acp) - (masterwork ? 1 : 0)),
      asf: num(s.asf),
      speed: raceSpeed >= 30 ? s.speed30 ?? null : s.speed20 ?? null,
      category: s.armorType ? `${s.armorType} armor` : '',
      enhancement,
    };
  };
  return {
    armor: piece(eq.armor),
    shield: piece(eq.shield),
    natural: typed.natural,
    deflection: typed.deflection,
    dodge: typed.dodge,
    misc: typed.misc,
  };
}

/** The weapons in the weapon slots, as the attack calculator reads them. */
export function equippedWeapons(character, size = 'Medium') {
  const items = new Map((character.wealth?.items || []).map((i) => [i.id, i]));
  const small = ['Small', 'Tiny', 'Diminutive', 'Fine'].includes(size);
  return (character.equipment?.weapons || []).map((id, slot) => {
    const item = items.get(id);
    if (!item) return null;
    const s = item.stats || {};
    return {
      slot,
      itemId: item.id,
      name: item.name,
      hands: s.hands || 'one-handed',
      ranged: Boolean(s.ranged),
      thrown: Boolean(s.thrown),
      finesse: Boolean(s.finesse),
      damageDice: s.damage || (small ? s.damageSmall : s.damageMedium) || s.damageMedium || '',
      critical: s.critical || '20/x2',
      range: s.range ?? null,
      damageType: s.damageType || '',
      enhancement: num(s.enhancement),
      masterwork: Boolean(s.masterwork),
      attackBonus: num(s.attackBonus),
      damageBonus: num(s.damageBonus),
    };
  });
}

/* ==========================================================================
   Attacks
   ========================================================================== */

/**
 * One weapon's attack and damage, with the choices a player makes at the
 * table: two-weapon fighting, Power Attack, Combat Expertise, fighting
 * defensively, charging, flanking, higher ground, Rapid Shot, Point Blank Shot.
 *
 * @param weapon   equippedWeapons()'s entry
 * @param ctx      { bab, str, dex, sizeAttack, meleeBonus, rangedBonus, damageMelee,
 *                   damageRanged, feats: Set of lowercase names, resolved }
 * @param options  { twoWeapon: 'primary' | 'off' | null, offHandLight, twoHands,
 *                   powerAttack, combatExpertise, defensive, charge, flanking,
 *                   higherGround, rapidShot, pointBlank }
 */
export function attackFor(weapon, ctx, options = {}) {
  const has = (feat) => ctx.feats.has(feat);
  const named = lower(weapon.name);
  const ranged = weapon.ranged;
  const notes = [];
  const lines = [];
  const add = (label, value) => { if (value) lines.push({ label, value }); };

  // Which ability: Dexterity for ranged, Strength for melee - or Dexterity with
  // Weapon Finesse and a weapon it works with, when that is better.
  const finesse = !ranged && weapon.finesse && has('weapon finesse') && ctx.dex > ctx.str;
  const abilityMod = ranged || finesse ? ctx.dex : ctx.str;
  add(ranged ? 'Dexterity' : finesse ? 'Dexterity (Weapon Finesse)' : 'Strength', abilityMod);
  add('Size', ctx.sizeAttack);
  add(ranged ? 'Ranged bonuses' : 'Melee bonuses', ranged ? ctx.rangedBonus : ctx.meleeBonus);
  const focus = num(ctx.resolved?.[`weapon.attack.${named}`]?.total);
  add('Weapon Focus', focus);
  const magic = weapon.enhancement || (weapon.masterwork ? 1 : 0);
  add(weapon.enhancement ? `Enhancement +${weapon.enhancement}` : 'Masterwork', magic);
  add('Weapon bonus', weapon.attackBonus);

  // Two-weapon fighting: SRD Table: Two-Weapon Fighting Penalties.
  const twf = options.twoWeapon === 'primary' || options.twoWeapon === 'off';
  if (twf) {
    const feat = has('two-weapon fighting');
    const light = Boolean(options.offHandLight);
    const penalty = options.twoWeapon === 'primary'
      ? (feat ? (light ? -2 : -4) : (light ? -4 : -6))
      : (feat ? (light ? -2 : -4) : (light ? -8 : -10));
    add(options.twoWeapon === 'primary' ? 'Two-weapon (primary hand)' : 'Two-weapon (off hand)', penalty);
  }
  const bab = Math.max(0, num(ctx.bab));
  const powerAttack = !ranged ? Math.min(bab, Math.max(0, num(options.powerAttack))) : 0;
  if (powerAttack && has('power attack')) add('Power Attack', -powerAttack);
  const expertise = !ranged ? Math.min(5, bab, Math.max(0, num(options.combatExpertise))) : 0;
  if (expertise && has('combat expertise')) add('Combat Expertise', -expertise);
  if (options.defensive && !expertise) add('Fighting defensively', -4);
  if (options.charge && !ranged) add('Charging', 2);
  if (options.flanking && !ranged) add('Flanking', 2);
  if (options.higherGround && !ranged) add('Higher ground', 1);
  const rapid = ranged && options.rapidShot && has('rapid shot');
  if (rapid) add('Rapid Shot', -2);
  const pointBlank = ranged && options.pointBlank && has('point blank shot');
  if (pointBlank) add('Point Blank Shot', 1);

  const modifier = lines.reduce((t, l) => t + l.value, 0);
  const first = bab + modifier;

  // Attacks in a full attack: from base attack bonus alone, plus the extras.
  let attacks = [];
  if (options.twoWeapon === 'off') {
    attacks = [first];
    if (has('improved two-weapon fighting')) attacks.push(first - 5);
    if (has('greater two-weapon fighting')) attacks.push(first - 10);
  } else {
    for (let b = bab; attacks.length === 0 || b > 0; b -= 5) {
      attacks.push(b + modifier);
      if (b - 5 <= 0) break;
    }
    if (rapid) attacks.unshift(first);
  }

  // Damage: Strength by how the weapon is held, and what adds to it.
  const damage = [];
  const addDamage = (label, value) => { if (value) damage.push({ label, value }); };
  const twoHanded = !ranged && (weapon.hands === 'two-handed' || (options.twoHands && weapon.hands === 'one-handed' && !twf));
  if (!ranged || weapon.thrown) {
    const str = ctx.str;
    const share = options.twoWeapon === 'off' && str > 0 ? Math.floor(str / 2) : twoHanded && str > 0 ? Math.floor(str * 1.5) : str;
    addDamage(options.twoWeapon === 'off' ? 'Strength (half, off hand)' : twoHanded ? 'Strength (one and a half, two hands)' : 'Strength', share);
  } else if (ctx.str < 0) {
    addDamage('Strength penalty', ctx.str);
    notes.push('A composite bow adds Strength up to its rating; enter it as a weapon damage bonus.');
  }
  addDamage(ranged ? 'Ranged damage bonuses' : 'Melee damage bonuses', ranged ? ctx.damageRanged : ctx.damageMelee);
  addDamage('Weapon Specialization', num(ctx.resolved?.[`weapon.damage.${named}`]?.total));
  addDamage(`Enhancement +${weapon.enhancement}`, weapon.enhancement);
  addDamage('Weapon bonus', weapon.damageBonus);
  if (powerAttack && has('power attack')) {
    if (weapon.hands === 'light' && named !== 'unarmed strike') notes.push('Power Attack adds no damage with a light weapon.');
    else addDamage(twoHanded ? 'Power Attack (two hands)' : 'Power Attack', twoHanded ? powerAttack * 2 : powerAttack);
  }
  if (pointBlank) addDamage('Point Blank Shot', 1);
  const damageMod = damage.reduce((t, d) => t + d.value, 0);

  const sign = (n) => (n < 0 ? String(n) : `+${n}`);
  const acChange = (expertise && has('combat expertise') ? expertise : 0) + (options.defensive && !expertise ? 2 : 0) - (options.charge && !ranged ? 2 : 0);
  if (acChange) notes.push(`Armor Class ${sign(acChange)} until your next turn.`);
  if (weapon.range) notes.push(`Range increment ${weapon.range} ft.`);

  return {
    name: weapon.name,
    attack: first,
    attacks,
    routine: attacks.map(sign).join('/'),
    attackParts: [{ label: 'Base attack bonus', value: bab }, ...lines],
    damageDice: weapon.damageDice,
    damageMod,
    damage: `${weapon.damageDice || '-'}${damageMod ? sign(damageMod) : ''}`,
    damageParts: damage,
    critical: weapon.critical,
    acChange,
    notes,
  };
}

/* ==========================================================================
   Older sheets
   ========================================================================== */

/**
 * A sheet from before the inventory: its armor, shield and weapons become
 * inventory rows in their slots, its typed coins become the ledger's starting
 * point, and every row gets an id. Idempotent.
 */
export function migrateInventory(character) {
  const c = character;
  c.wealth = { startingGold: null, items: [], ledger: [], ...(c.wealth || {}) };
  c.wealth.items = (c.wealth.items || []).map((item) => ({ qty: 1, weight: 0, value: 0, category: 'Gear', ...item, id: item.id || newItemId() }));
  c.wealth.ledger = c.wealth.ledger || [];
  if (c.equipment) return c;

  c.equipment = { armor: null, shield: null, weapons: [], slots: {} };
  const gear = c.gear || {};
  const armorRow = (piece, kind) => ({
    id: newItemId(), name: piece.name || (kind === 'armor' ? 'Armor' : 'Shield'), qty: 1, weight: 0, value: 0, paid: null,
    category: kind === 'armor' ? 'Armor' : 'Shield',
    stats: { kind, armorType: kind === 'shield' ? 'shield' : String(piece.category || '').replace(/ armor$/i, '').toLowerCase(), bonus: num(piece.bonus), maxDex: piece.maxDex ?? null, acp: num(piece.acp), asf: num(piece.asf), speed30: piece.speed ?? null, speed20: piece.speed ?? null, enhancement: num(piece.enhancement), masterwork: false },
  });
  for (const kind of ['armor', 'shield']) {
    const piece = gear[kind] || {};
    if (piece.name || num(piece.bonus)) {
      const row = armorRow(piece, kind);
      c.wealth.items.push(row);
      c.equipment[kind] = row.id;
    }
  }
  for (const w of c.weapons || []) {
    if (!w?.name) continue;
    const row = {
      id: newItemId(), name: w.name, qty: 1, weight: 0, value: 0, paid: null, category: 'Weapon',
      stats: { kind: 'weapon', hands: w.ranged ? 'ranged' : 'one-handed', damage: w.damageDice || '', critical: w.crit || '20/x2', ranged: Boolean(w.ranged), thrown: Boolean(w.thrown), finesse: Boolean(w.finesse), attackBonus: num(w.attackBonus), damageBonus: num(w.damageBonus), enhancement: 0, masterwork: false },
    };
    c.wealth.items.push(row);
    c.equipment.weapons.push(row.id);
  }
  if (c.wealth.gold !== undefined && c.wealth.gold !== null && num(c.wealth.gold) !== 0) c.wealth.legacyCoins = num(c.wealth.gold);
  delete c.wealth.gold;
  return c;
}

/** Everything the attack calculator needs from the derived sheet. */
export function attackContext(derived, character) {
  const r = derived.effects.resolved;
  const t = (k) => num(r[k]?.total);
  return {
    bab: derived.summary.bab,
    str: derived.abilities.str.mod,
    dex: derived.abilities.dex.mod,
    sizeAttack: derived.size.attack,
    meleeBonus: t('attack.melee') + t('attack.all') + num(character.combat?.misc?.melee),
    rangedBonus: t('attack.ranged') + t('attack.all') + num(character.combat?.misc?.ranged),
    damageMelee: t('damage.melee'),
    damageRanged: t('damage.ranged'),
    feats: new Set((derived.featPlan?.held || []).map((f) => lower(f.name))),
    resolved: r,
  };
}

