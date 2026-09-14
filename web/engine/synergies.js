// Skill synergies: 5 or more ranks in one skill give +2 on another.
//
// The table is data/synergies.json (the SRD's Table: Skill Synergies). A synergy
// is read from ranks, not totals, so derive() works out the skill table once,
// asks here what the ranks earn, and adds the answer as effects - untyped, so
// Diplomacy's synergies from Bluff, Sense Motive and Knowledge (nobility and
// royalty) all count. A synergy that applies only in some checks is conditional,
// and one on something that is not a skill (bardic knowledge, turning) is a note.
//
// Pure: no DOM, no fetch.

const lower = (s) => String(s || '').trim().toLowerCase();

/**
 * @param lines  the skill table's lines, with `name`, `label` and `ranks`
 * @returns { effects: [effect], notes: [{ source, kind, text }], earned: [{ from, to, ranks }] }
 */
export function synergiesFor(lines, rules) {
  const table = rules.synergies;
  const out = { effects: [], notes: [], earned: [] };
  if (!table?.synergies) return out;
  const need = table.ranks ?? 5;
  const value = table.value ?? 2;

  // "Knowledge (arcana)" names one subject; "Craft" alone, any one Craft.
  const ranksIn = (from) => Math.max(0, ...(lines || [])
    .filter((l) => (from.includes('(') ? lower(l.label) === lower(from) : lower(l.name) === lower(from)))
    .map((l) => Number(l.ranks) || 0));

  for (const s of table.synergies) {
    const ranks = ranksIn(s.from);
    if (ranks < need) continue;
    const source = `Synergy: ${s.from} ${ranks} ranks`;
    out.earned.push({ from: s.from, to: s.to, ranks });
    if (!s.to) {
      out.notes.push({ source: `${s.from} (${ranks} ranks)`, kind: 'synergy', text: s.note });
      continue;
    }
    out.effects.push({
      target: `skill.${s.to}`,
      type: 'untyped',
      value,
      condition: s.condition || null,
      perLevel: false,
      note: null,
      source,
    });
  }
  return out;
}
