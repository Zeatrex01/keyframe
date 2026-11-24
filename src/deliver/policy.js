// Which version of an animation wins in a delivery file. A policy, not Spine math and not
// file writing, so it lives alone (ported from legacy delivery.js).
//
// Silent data loss is the history behind every rule here. Legacy write_animation rebuilt
// the delivery from the base on every call and only carried clips the base did not have:
// twelve clips written in sequence each returned written: true, and only the last one was
// in the file. Later the same loss happened one level down, inside a clip: keying a second
// bone dropped the first. The precedence, applied between clips and, inside the clip being
// written, per timeline:
//   1. what is written now          -> the new version (that was the request)
//   2. what already sits in the target -> the target's version (accumulated work)
//   3. what only the base has        -> the base's version (the owner's, verbatim)

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merge clip maps by precedence.
 * @param {object} fromBase      animations of the base (the clip being written already replaced)
 * @param {object} inTarget      animations already in the delivery file ({} or null if none)
 * @param {string} writtenName   the clip written by this call (its new version wins)
 * @returns {{ animations: object, carried: string[], kept: string[] }}
 *   carried: only in the target, brought along; kept: in both, the target's version kept
 */
export function mergeAnimations(fromBase, inTarget, writtenName) {
  const animations = { ...(fromBase ?? {}) };
  const carried = [];
  const kept = [];
  for (const [name, clip] of Object.entries(inTarget ?? {})) {
    if (name === writtenName) continue;
    if (!(name in animations)) { animations[name] = clip; carried.push(name); continue; }
    if (!same(animations[name], clip)) { animations[name] = clip; kept.push(name); }
  }
  return { animations, carried, kept };
}

const CHANNEL_GROUPS = ['bones', 'slots', 'physics', 'ik', 'transform', 'path', 'attachments'];

/**
 * The same precedence inside one clip: per name (bone, slot, constraint), then per channel.
 * @param {object} lower  the lower-precedence clip (e.g. the base's, or the target's)
 * @param {object} upper  the higher-precedence clip
 * @returns {{ clip: object, carried: string[] }} carried: what only `lower` had and survived,
 *   as "group:name" or "group:name.channel/channel"
 */
export function mergeClip(lower, upper) {
  lower = lower ?? {};
  upper = upper ?? {};
  const clip = { ...lower, ...upper }; // drawOrder, events and anything scalar: upper wins
  const carried = [];
  for (const group of CHANNEL_GROUPS) {
    const a = lower[group];
    const u = upper[group];
    if (!a && !u) { delete clip[group]; continue; }
    if (!a) { clip[group] = u; continue; }
    if (!u) { clip[group] = a; carried.push(...Object.keys(a).map(n => `${group}:${n}`)); continue; }
    const merged = {};
    for (const name of new Set([...Object.keys(a), ...Object.keys(u)])) {
      if (!(name in u)) { merged[name] = a[name]; carried.push(`${group}:${name}`); continue; }
      if (!(name in a)) { merged[name] = u[name]; continue; }
      // ik/transform/path hold a key ARRAY per constraint, not a channel map: upper wins.
      if (Array.isArray(a[name]) || Array.isArray(u[name])) { merged[name] = u[name]; continue; }
      merged[name] = { ...a[name], ...u[name] };
      const rest = Object.keys(a[name]).filter(channel => !(channel in u[name]));
      if (rest.length) carried.push(`${group}:${name}.${rest.join('/')}`);
    }
    clip[group] = merged;
  }
  return { clip, carried };
}

/**
 * Delete clips, all or nothing: the caller must refuse and write nothing if `missing` is
 * non-empty, because a partial delete would report success for half a request.
 * Surviving clips keep their order and identity (carried by reference, not re-serialized).
 */
export function deleteAnimations(animations, names) {
  const source = animations ?? {};
  const requested = [];
  for (const name of names ?? []) {
    // Names are identity: no trimming. A leading or trailing space can be a real character.
    if (typeof name === 'string' && name.length && !requested.includes(name)) requested.push(name);
  }
  const missing = requested.filter(name => !(name in source));
  const deleted = requested.filter(name => name in source);
  const remaining = {};
  for (const [name, clip] of Object.entries(source)) if (!deleted.includes(name)) remaining[name] = clip;
  return { animations: remaining, deleted, missing, remainingNames: Object.keys(remaining) };
}

/** "I wrote it" is not proof it stayed: what actually changed between two clip maps. */
export function changesBetween(before, after) {
  const a = before ?? {};
  const b = after ?? {};
  const added = [], changed = [], removed = [];
  for (const name of Object.keys(b)) {
    if (!(name in a)) added.push(name);
    else if (!same(a[name], b[name])) changed.push(name);
  }
  for (const name of Object.keys(a)) if (!(name in b)) removed.push(name);
  return { added, changed, removed };
}
