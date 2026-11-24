// The difference between two skeletons, in plain words. Ported from legacy skeldiff.js.
//
// Why it exists: some things a page cannot show well:
// constraints, meshes, deform, IK. Building a JSON viewer is not the answer (Spine shows
// JSON better, and Spine is the owner's tool). The studio's job is to PROVE IT DID NOT
// TOUCH. Before taking a delivery back into Spine, the one thing to see is what changed
// and what did not. This module produces that.
//
// Rule: on the mesh, weight and constraint side the report says CHANGED or UNCHANGED,
// never the values. Printing a vertex list would be a poor imitation of a JSON viewer.
//
// The verdict ("rig untouched") is a claim that bones, slots, skins, constraints and the
// skeleton header are identical, so every field of those sections is compared: a
// fixed field list lets a change hide behind the verdict (legacy did that for
// `inherit` until 2026-08-08, and still did for every unlisted field).
//
// Pure: takes two parsed JSON objects, returns plain data.

import { skinsOf } from './check.js';

const json = value => JSON.stringify(value);
// Fields that move the bone in the setup pose. `inherit` (4.x; `transform` in 3.x) is
// one: a mode change changes the bone's WORLD transform.
export const SETUP_FIELDS = Object.freeze(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY', 'length',
  'inherit', 'transform']);
const GEOMETRY_FIELDS = ['vertices', 'uvs', 'triangles', 'hull', 'edges', 'vertexCount', 'lengths'];
const CONSTRAINT_KINDS = ['ik', 'transform', 'path', 'physics'];

// Maps, not plain objects: a bone named "constructor" or "toString" must not be found in
// a skeleton that lacks it (legacy used `{}` and missed such an addition).
const byName = list => {
  const m = new Map();
  for (const x of list ?? []) if (x?.name) m.set(x.name, x);
  return m;
};
const recordOf = obj => new Map(Object.entries(obj ?? {}));
const changedKeys = (a, b, skip = []) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
  .filter(k => !skip.includes(k) && json(a?.[k]) !== json(b?.[k]));
const addedRemoved = (before, after) => ({
  added: [...after.keys()].filter(k => !before.has(k)),
  removed: [...before.keys()].filter(k => !after.has(k)),
});

function attachmentsOf(sk) {
  const m = new Map();
  for (const skin of skinsOf(sk)) {
    for (const [slot, attachments] of Object.entries(skin?.attachments ?? {})) {
      for (const [name, att] of Object.entries(attachments ?? {})) m.set(`${skin.name}/${slot}/${name}`, att);
    }
  }
  return m;
}

/**
 * @param {object} before skeleton JSON (the base)
 * @param {object} after  skeleton JSON (the delivery)
 */
export function diffSkeletons(before, after) {
  // ── skeleton header (the version lives here) ──
  const headerFields = changedKeys(before?.skeleton, after?.skeleton)
    .map(field => ({ field, before: before?.skeleton?.[field], after: after?.skeleton?.[field] }));
  const skeleton = { changed: headerFields.length > 0, ...(headerFields.length ? { fields: headerFields } : {}) };

  // ── bones ──
  const ba = byName(before?.bones);
  const bb = byName(after?.bones);
  const parentChanged = [];
  const setupChanged = [];
  const otherChanged = [];
  for (const [name, a] of ba) {
    const b = bb.get(name);
    if (!b) continue;
    if ((a.parent ?? null) !== (b.parent ?? null)) parentChanged.push({ bone: name, before: a.parent ?? '(root)', after: b.parent ?? '(root)' });
    const setup = SETUP_FIELDS.filter(k => json(a[k]) !== json(b[k]));
    if (setup.length) setupChanged.push({ bone: name, fields: setup });
    const other = changedKeys(a, b, ['name', 'parent', ...SETUP_FIELDS]);
    if (other.length) otherChanged.push({ bone: name, fields: other });
  }
  const bones = {
    ...addedRemoved(ba, bb), parentChanged, setupChanged, otherChanged,
    orderChanged: json((before?.bones ?? []).map(x => x?.name)) !== json((after?.bones ?? []).map(x => x?.name)),
  };

  // ── slots (draw order included) ──
  const sa = byName(before?.slots);
  const sb = byName(after?.slots);
  const slotChanged = [];
  for (const [name, a] of sa) {
    const b = sb.get(name);
    if (!b) continue;
    const fields = changedKeys(a, b, ['name']);
    if (fields.length) slotChanged.push({ slot: name, fields });
  }
  const slots = {
    ...addedRemoved(sa, sb), changed: slotChanged,
    drawOrderChanged: json((before?.slots ?? []).map(x => x?.name)) !== json((after?.slots ?? []).map(x => x?.name)),
  };

  // ── skins: membership lists (skin bones and constraints) and the skins themselves ──
  const ska = byName(skinsOf(before ?? {}));
  const skb = byName(skinsOf(after ?? {}));
  const skinChanged = [];
  for (const [name, a] of ska) {
    const b = skb.get(name);
    if (!b) continue;
    const fields = changedKeys(a, b, ['name', 'attachments']);
    if (fields.length) skinChanged.push({ skin: name, fields });
  }
  const skins = { ...addedRemoved(ska, skb), changed: skinChanged };

  // ── attachments: meshes and weights live here; no values are reported ──
  const aa = attachmentsOf(before ?? {});
  const ab = attachmentsOf(after ?? {});
  const attachmentChanged = [];
  const geometryChanged = [];
  for (const [key, a] of aa) {
    if (!ab.has(key) || json(a) === json(ab.get(key))) continue;
    const b = ab.get(key);
    const geometry = GEOMETRY_FIELDS.some(f => json(a?.[f]) !== json(b?.[f]));
    (geometry ? geometryChanged : attachmentChanged).push({ attachment: key, type: a?.type ?? 'region' });
  }
  const attachments = { ...addedRemoved(aa, ab), changed: attachmentChanged, geometryChanged };

  // ── constraints ──
  const constraints = { added: [], removed: [], changed: [] };
  for (const kind of CONSTRAINT_KINDS) {
    const ca = byName(before?.[kind]);
    const cb = byName(after?.[kind]);
    for (const name of cb.keys()) if (!ca.has(name)) constraints.added.push(`${kind}/${name}`);
    for (const [name, c] of ca) {
      if (!cb.has(name)) constraints.removed.push(`${kind}/${name}`);
      else if (json(c) !== json(cb.get(name))) constraints.changed.push(`${kind}/${name}`);
    }
  }

  // ── event definitions (animation-side data, not rig) ──
  const ea = recordOf(before?.events);
  const eb = recordOf(after?.events);
  const events = { ...addedRemoved(ea, eb),
    changed: [...ea.keys()].filter(k => eb.has(k) && json(ea.get(k)) !== json(eb.get(k))) };

  // ── animations ──
  const na = recordOf(before?.animations);
  const nb = recordOf(after?.animations);
  const animations = { ...addedRemoved(na, nb), changed: [], untouched: [] };
  for (const [name, a] of na) {
    if (!nb.has(name)) continue;
    (json(a) === json(nb.get(name)) ? animations.untouched : animations.changed).push(name);
  }

  // ── the verdict: the one line the owner reads before taking the file into Spine ──
  const count = (n, what) => (n ? `${n} ${what}` : null);
  const rigParts = [
    count(bones.added.length, 'bone(s) added'),
    count(bones.removed.length, 'bone(s) removed'),
    count(parentChanged.length, 'bone parent(s) changed'),
    count(setupChanged.length, 'bone setup pose(s) changed'),
    count(otherChanged.length, 'bone(s) with other fields changed'),
    bones.orderChanged && 'bone order changed',
    count(slots.added.length, 'slot(s) added'),
    count(slots.removed.length, 'slot(s) removed'),
    count(slotChanged.length, 'slot(s) changed'),
    slots.drawOrderChanged && 'draw order changed',
    count(skins.added.length, 'skin(s) added'),
    count(skins.removed.length, 'skin(s) removed'),
    count(skinChanged.length, 'skin membership(s) changed'),
    count(attachments.added.length, 'attachment(s) added'),
    count(attachments.removed.length, 'attachment(s) removed'),
    count(attachmentChanged.length, 'attachment(s) changed'),
    count(geometryChanged.length, 'attachment GEOMETRY changed (mesh or weights)'),
    count(constraints.added.length, 'constraint(s) added'),
    count(constraints.removed.length, 'constraint(s) removed'),
    count(constraints.changed.length, 'constraint(s) changed'),
    skeleton.changed && 'skeleton header changed',
  ].filter(Boolean);
  const rigTouched = rigParts.length > 0;
  const list = names => names.join(', ');
  const animationParts = [
    animations.added.length && `${animations.added.length} added (${list(animations.added)})`,
    animations.removed.length && `${animations.removed.length} removed (${list(animations.removed)})`,
    animations.changed.length && `${animations.changed.length} changed (${list(animations.changed)})`,
    animations.untouched.length && `${animations.untouched.length} untouched (${list(animations.untouched)})`,
  ].filter(Boolean);
  const eventParts = [
    count(events.added.length, 'added'), count(events.removed.length, 'removed'), count(events.changed.length, 'changed'),
  ].filter(Boolean);
  // Legacy listed only some categories after "RIG CHANGED", so a slot-only change read
  // "RIG CHANGED: " with nothing after it.
  const summary = (rigTouched
    ? `RIG CHANGED: ${rigParts.join(', ')}.`
    : 'RIG UNTOUCHED: bones, slots, skins (mesh and weights), constraints and the skeleton header are identical.')
    + ` Animations: ${animationParts.length ? animationParts.join(', ') : 'none'}.`
    + (eventParts.length ? ` Event definitions: ${eventParts.join(', ')}.` : '');

  return {
    summary, rigTouched, skeleton,
    rig: { bones, slots, skins, attachments, constraints },
    events, animations,
  };
}
