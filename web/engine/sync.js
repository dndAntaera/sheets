// Reconciling a homebrew library between this browser and an account.
//
// A player may edit their library on a phone and a desk, online and off, so
// neither copy can simply overwrite the other. Each entry carries an id and an
// `updated` timestamp, and the browser remembers, per id, the timestamp it last
// agreed with the server on - the `synced` map. From those three things every
// case can be told apart:
//
//                     | on the server             | not on the server
//   ------------------+---------------------------+------------------------------
//   here              | newer one wins            | new here: upload it
//                     |                           | or deleted elsewhere: drop it,
//                     |                           |   unless edited here since
//   ------------------+---------------------------+------------------------------
//   not here          | new elsewhere: take it    | gone everywhere: forget it
//                     | or deleted here: delete   |
//                     |   it there, unless edited |
//                     |   elsewhere since         |
//
// When an edit and a deletion collide, the edit wins. Losing a deletion costs a
// player one click; losing an edit costs them their work.
//
// This is pure: it decides, and the store carries the decisions out.

/**
 * @param local   entries in this browser: [{ id, kind, updated, ... }]
 * @param server  entries on the account
 * @param synced  { id: updated } as last agreed with the server
 * @returns {
 *   entries   the library this browser should now hold
 *   upload    entries to send to the server
 *   remove    ids to delete from the server
 *   synced    the agreement map once those requests succeed
 *   changed   whether `entries` differs from `local`
 * }
 */
export function mergeLibraries(local, server, synced = {}) {
  const here = new Map(local.filter((e) => e?.id).map((e) => [e.id, e]));
  const there = new Map(server.filter((e) => e?.id).map((e) => [e.id, e]));
  const ids = new Set([...here.keys(), ...there.keys(), ...Object.keys(synced)]);

  const entries = [];
  const upload = [];
  const remove = [];
  const agreed = {};
  let changed = false;

  const stamp = (e) => String(e.updated || '');

  for (const id of ids) {
    const L = here.get(id);
    const S = there.get(id);
    const k = synced[id];

    if (L && S) {
      if (stamp(L) > stamp(S)) {
        entries.push(L);
        upload.push(L);
        agreed[id] = stamp(L);
      } else if (stamp(S) > stamp(L)) {
        entries.push(S);
        agreed[id] = stamp(S);
        changed = true;
      } else {
        entries.push(L);
        agreed[id] = stamp(L);
      }
    } else if (L) {
      if (k === undefined || stamp(L) !== k) {
        // New here, or edited here after it was deleted elsewhere.
        entries.push(L);
        upload.push(L);
        agreed[id] = stamp(L);
      } else {
        // Unchanged here since we last agreed, and gone from the server:
        // deleted on another device.
        changed = true;
      }
    } else if (S) {
      if (k === undefined || stamp(S) !== k) {
        // New from another device, or edited there after it was deleted here.
        entries.push(S);
        agreed[id] = stamp(S);
        changed = true;
      } else {
        // Deleted here, and unchanged there since we last agreed.
        remove.push(id);
      }
    }
    // Neither side has it: nothing to keep, and nothing to remember.
  }

  return { entries, upload, remove, synced: agreed, changed };
}

/** A library grouped by kind, flattened to one list with each entry's kind set. */
export function flattenLibrary(shelf, types) {
  const out = [];
  for (const [kind, type] of Object.entries(types)) {
    for (const entry of shelf[type.plural] || []) out.push({ ...entry, kind });
  }
  return out;
}

/**
 * The reverse: a flat list back into the grouped shape.
 *
 * Order is kept exactly as given, and mergeLibraries gives entries in this
 * browser's order with anything new appended. The content editor addresses an
 * entry by its position, so re-sorting here would quietly swap the entry a
 * player has open for a different one.
 */
export function groupLibrary(entries, types) {
  const shelf = Object.fromEntries(Object.values(types).map((t) => [t.plural, []]));
  for (const entry of entries) {
    const type = types[entry.kind];
    if (type) shelf[type.plural].push(entry);
  }
  return shelf;
}
