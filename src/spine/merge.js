// Skeleton merge: carry one animation, with everything it needs, from one Spine skeleton
// JSON into another, producing a NEW skeleton. Neither input is modified. Ported from
// legacy merge.js.
//
// Why it exists: the Spine editor cannot merge two skeletons. CLI import appends a second
// skeleton beside the first, and Import Data drops the animations. Merging the exports
// BEFORE the editor, and importing ONE file, is the only way to get an animation from one
// rig onto another. The owner's .spine files are never touched: inputs are exports, the
// output is a new export.
//
// Conflict policy (`onConflict`) decides whether the game keeps working: WHICH name
// survives when both files have a "camera"?
//   * 'retarget' (default): the TARGET's bone or slot is used as is, and the incoming
//     animation is remapped onto it. Runtime bone names never change, so the game only
//     swaps the file. The incoming bone's own definition is discarded (the target's setup
//     pose wins).
//   * 'rename': the incoming bone or slot arrives separately under a prefix
//     (`merged_` by default) and every reference is remapped; nothing in the target is
//     driven by the incoming animation.
// Identical definitions are always shared, in both modes.
//   * New slots are appended on top (end of the slots array); the draw order inside the
//     target is the owner's call afterwards.
//   * The same Spine major.minor is required (an editor rule).
//
// Pure: takes parsed JSON objects, returns new objects. Refusals are StudioError.

import { StudioError } from '../shared/errors.js';
import { finding } from './findings.js';
import { skinsOf } from './check.js';

export const CONFLICT_POLICIES = Object.freeze(['retarget', 'rename']);
export const DEFAULT_PREFIX = 'merged_';
const CONSTRAINT_KINDS = ['ik', 'transform', 'path', 'physics'];

const clone = value => structuredClone(value);
const majorMinor = version => String(version ?? '').split('.').slice(0, 2).join('.');
const sameDef = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

function animationOf(sk, name) {
  const animations = sk?.animations ?? {};
  if (!own(animations, name)) {
    throw new StudioError('unknown-animation', `No animation named "${name}".`,
      { animation: name, available: Object.keys(animations) });
  }
  return animations[name];
}

// The number of vertices an attachment's `vertices` array describes, or null when it has
// none. Meshes count by uvs; path, bounding box and clipping carry vertexCount.
function vertexCountOf(att) {
  if (!att || !Array.isArray(att.vertices)) return null;
  if ((att.type ?? 'region') === 'mesh') return Array.isArray(att.uvs) ? att.uvs.length / 2 : null;
  return Number.isInteger(att.vertexCount) ? att.vertexCount : null;
}

// Weighted vertices are groups of [count, (boneIndex, x, y, weight) * count]; unweighted
// ones are exactly count * 2 numbers. Calls `visit(boneIndex)` for each influence and
// returns the rebuilt array with each index replaced by visit's result.
function mapWeightedBones(att, visit) {
  const count = vertexCountOf(att);
  const v = att?.vertices;
  if (count === null || v.length === count * 2) return null;
  const out = [];
  let i = 0;
  while (i < v.length) {
    const n = v[i++];
    out.push(n);
    for (let k = 0; k < n && i < v.length; k++) {
      out.push(visit(v[i]), v[i + 1], v[i + 2], v[i + 3]);
      i += 4;
    }
  }
  return out;
}

/**
 * Everything one animation touches in its source skeleton.
 * @returns {{ bones: Set<string>, slots: Set<string>, constraints: { kind: string, def: object }[], events: Set<string> }}
 */
export function animationDependencies(sk, animationName) {
  const a = animationOf(sk, animationName);
  const bones = new Set(Object.keys(a?.bones ?? {}));
  const slots = new Set(Object.keys(a?.slots ?? {}));
  const keyedConstraints = Object.fromEntries(CONSTRAINT_KINDS.map(kind => [kind, new Set(Object.keys(a?.[kind] ?? {}))]));
  for (const key of a?.drawOrder ?? []) for (const offset of key?.offsets ?? []) slots.add(offset.slot);
  // 4.2: deform and sequence timelines live under animations.X.attachments as
  // {skin: {slot: {attachment: {...}}}}. Without this scan, a meshed file's slot
  // dependency stays incomplete and the editor rejects the merged file.
  for (const skinTimelines of Object.values(a?.attachments ?? {})) for (const slot of Object.keys(skinTimelines ?? {})) slots.add(slot);
  const events = new Set();
  for (const key of a?.events ?? []) if (key?.name) events.add(key.name);

  // Constraints keyed by name, and the bones or slots they reach.
  const constraints = [];
  for (const kind of CONSTRAINT_KINDS) {
    for (const c of sk[kind] ?? []) {
      if (!keyedConstraints[kind].has(c.name)) continue;
      constraints.push({ kind, def: c });
      for (const bone of c.bones ?? []) bones.add(bone);
      if (kind === 'path') slots.add(c.target); // a path constraint targets the slot carrying the path
      else if (c.target) bones.add(c.target);
      if (c.bone) bones.add(c.bone);
    }
  }

  // Each slot's bone, and every bone a weighted attachment in that slot is bound to.
  // (Legacy missed the weighted bones: a carried mesh kept source bone indices that
  // pointed at whatever bone sat at that index in the target.)
  const slotBy = new Map((sk.slots ?? []).map(s => [s.name, s]));
  const sourceBones = sk.bones ?? [];
  const skin = skinsOf(sk)[0]?.attachments ?? {};
  for (const slot of slots) {
    if (slotBy.has(slot)) bones.add(slotBy.get(slot).bone);
    for (const att of Object.values(skin[slot] ?? {})) {
      mapWeightedBones(att, index => { if (sourceBones[index]) bones.add(sourceBones[index].name); return index; });
    }
  }

  // Full parent chains. Cycle-safe by a visited set; legacy capped the walk at 64 levels
  // and silently cut deeper chains (a long tail or hair chain).
  const boneBy = new Map(sourceBones.map(b => [b.name, b]));
  const withParents = new Set();
  for (const name of bones) {
    let current = name;
    while (current && boneBy.has(current) && !withParents.has(current)) {
      withParents.add(current);
      current = boneBy.get(current).parent;
    }
  }
  return { bones: withParents, slots, constraints, events };
}

/**
 * Merge `animationName` from `source` into a copy of `target`.
 * @param {object} target  skeleton JSON that receives the animation (not modified)
 * @param {object} source  skeleton JSON that owns the animation (not modified)
 * @param {string} animationName
 * @param {{ onConflict?: 'retarget'|'rename', prefix?: string, as?: string }} [options]
 * @returns {{ skeleton: object, report: object }}
 */
export function mergeAnimation(target, source, animationName, options = {}) {
  const { onConflict = 'retarget', prefix = DEFAULT_PREFIX, as } = options;
  // Legacy treated any value other than 'retarget' as rename, so a typo silently renamed.
  if (!CONFLICT_POLICIES.includes(onConflict)) {
    throw new StudioError('bad-argument', `onConflict must be one of: ${CONFLICT_POLICIES.join(', ')}.`, { onConflict });
  }
  const retarget = onConflict === 'retarget';
  const targetVersion = target?.skeleton?.spine;
  const sourceVersion = source?.skeleton?.spine;
  if (majorMinor(targetVersion) !== majorMinor(sourceVersion)) {
    throw new StudioError('merge-version',
      `Spine versions differ: target ${targetVersion ?? '(none)'}, source ${sourceVersion ?? '(none)'}. The major.minor must match.`,
      { target: targetVersion ?? null, source: sourceVersion ?? null });
  }
  const deps = animationDependencies(source, animationName);

  const out = clone(target);
  out.bones ??= [];
  out.slots ??= [];
  // The output carries the NEWER of the two versions: the editor dislikes a file that
  // holds new-format data but claims an old version.
  const versions = [targetVersion, sourceVersion].filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  if (versions.length && out.skeleton) out.skeleton.spine = versions[versions.length - 1];

  const report = {
    animation: null, bonesAdded: [], bonesReused: [], slotsAdded: [], slotsReused: [],
    // One map per namespace: a bone, a slot and a constraint may share a name. Legacy kept
    // one map, so a renamed bone "aim" redirected the timeline of an ik constraint "aim".
    renamed: { bones: {}, slots: {}, ik: {}, transform: {}, path: {}, physics: {} },
    constraintsAdded: 0, attachmentsCopied: 0, warnings: [],
  };
  const warn = (code, where, message, params) => report.warnings.push(finding('warn', code, where, message, params));
  const freeName = (base, taken) => {
    let name = prefix + base;
    for (let i = 2; taken(name); i++) name = `${prefix}${base}_${i}`;
    return name;
  };

  // ── bones (source order is parent-first, a Spine rule) ──
  const targetBone = new Map(out.bones.map(b => [b.name, b]));
  const boneMap = {}; // source name -> output name
  for (const b of source.bones ?? []) {
    if (!deps.bones.has(b.name)) continue;
    const incoming = clone(b);
    if (incoming.parent) incoming.parent = boneMap[incoming.parent] ?? incoming.parent;
    const existing = targetBone.get(incoming.name);
    if (existing && (retarget || sameDef(existing, incoming))) {
      // Sit on top: the target's bone stays and the animation attaches to it.
      boneMap[b.name] = b.name;
      report.bonesReused.push(b.name);
      continue;
    }
    if (existing) {
      incoming.name = freeName(b.name, name => targetBone.has(name));
      report.renamed.bones[b.name] = incoming.name;
    }
    boneMap[b.name] = incoming.name;
    out.bones.push(incoming);
    targetBone.set(incoming.name, incoming);
    report.bonesAdded.push(incoming.name);
  }

  // Source bone index -> output bone index, for weighted vertices.
  const outIndex = new Map(out.bones.map((b, i) => [b.name, i]));
  const indexMap = new Map();
  (source.bones ?? []).forEach((b, i) => {
    const mapped = outIndex.get(boneMap[b.name] ?? b.name);
    if (mapped !== undefined) indexMap.set(i, mapped);
  });
  const carryAttachment = att => {
    const copy = clone(att);
    const vertices = mapWeightedBones(copy, index => indexMap.get(index) ?? index);
    if (vertices) copy.vertices = vertices;
    return copy;
  };

  // ── slots ──
  // Keep the target's skins whatever their format: the object format (3.x) becomes an
  // array, an empty list gets a default skin; never overwritten (the object format's
  // undefined .length was exactly that trap in legacy).
  if (!Array.isArray(out.skins)) out.skins = skinsOf(out).map(s => ({ name: s.name, attachments: s.attachments }));
  if (!out.skins.length) out.skins = [{ name: 'default', attachments: {} }];
  out.skins[0].attachments ??= {};
  const outSkin = out.skins[0].attachments;
  const sourceSkin = skinsOf(source)[0]?.attachments ?? {};

  const targetSlot = new Map(out.slots.map(s => [s.name, s]));
  const slotMap = {};
  for (const s of source.slots ?? []) {
    if (!deps.slots.has(s.name)) continue;
    const incoming = clone(s);
    incoming.bone = boneMap[incoming.bone] ?? incoming.bone;
    const existing = targetSlot.get(incoming.name);
    if (existing && (retarget
        || (sameDef(existing, incoming) && sameDef(outSkin[s.name] ?? null, sourceSkin[s.name] ?? null)))) {
      // Sit on top: the target's slot and its art stay; its skin entry is not touched.
      slotMap[s.name] = s.name;
      report.slotsReused.push(s.name);
      continue;
    }
    if (existing) {
      incoming.name = freeName(s.name, name => targetSlot.has(name));
      report.renamed.slots[s.name] = incoming.name;
    }
    slotMap[s.name] = incoming.name;
    out.slots.push(incoming);
    targetSlot.set(incoming.name, incoming);
    report.slotsAdded.push(incoming.name);
    if (own(sourceSkin, s.name)) {
      outSkin[incoming.name] = Object.fromEntries(Object.entries(sourceSkin[s.name] ?? {})
        .map(([name, att]) => [name, carryAttachment(att)]));
      report.attachmentsCopied++;
    } else {
      warn('slot-no-skin-entry', `slots/${s.name}`, `Slot "${s.name}" has no entry in the source skin; it arrives without art.`,
        { slot: s.name });
    }
  }

  // ── constraints ──
  for (const { kind, def } of deps.constraints) {
    const c = clone(def);
    if (c.bones) c.bones = c.bones.map(b => boneMap[b] ?? b);
    // A path constraint targets a slot; the others target a bone. Legacy looked the
    // target up in the slot map first for every kind.
    if (c.target) c.target = kind === 'path' ? (slotMap[c.target] ?? c.target) : (boneMap[c.target] ?? c.target);
    if (c.bone) c.bone = boneMap[c.bone] ?? c.bone;
    out[kind] ??= [];
    const existing = out[kind].find(x => x.name === c.name);
    if (existing && retarget && sameDef({ ...existing, order: 0 }, { ...c, order: 0 })) continue; // already there
    if (existing) {
      // Legacy took prefix + name without a collision check, so a second merge
      // produced two constraints with the same name.
      c.name = freeName(def.name, name => out[kind].some(x => x.name === name));
      report.renamed[kind][def.name] = c.name;
    }
    // Appended last, so the target's own constraint order is not disturbed.
    c.order = out[kind].length ? Math.max(...out[kind].map(x => x.order ?? 0)) + 1 : 0;
    out[kind].push(c);
    report.constraintsAdded++;
  }

  // ── the animation itself, every reference remapped ──
  const anim = clone(animationOf(source, animationName));
  const remapKeys = (obj, map) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [map[k] ?? k, v]));
  if (anim.bones) anim.bones = remapKeys(anim.bones, boneMap);
  if (anim.slots) anim.slots = remapKeys(anim.slots, slotMap);
  // Deform and sequence timelines: slot names are remapped; a skin name the target does
  // not have is bound to its first skin (the editor rejects an unknown skin name).
  if (anim.attachments) {
    const firstSkin = out.skins[0].name || 'default';
    const outSkinNames = new Set(out.skins.map(s => s.name));
    const rebuilt = {};
    for (const [skinName, slotTimelines] of Object.entries(anim.attachments)) {
      const key = outSkinNames.has(skinName) ? skinName : firstSkin;
      rebuilt[key] = Object.assign(rebuilt[key] ?? {}, remapKeys(slotTimelines ?? {}, slotMap));
    }
    anim.attachments = rebuilt;
  }
  // Event definitions: the target must define every event the animation fires.
  if (deps.events.size) {
    out.events ??= {};
    for (const name of deps.events) {
      if (own(out.events, name)) continue;
      if (own(source.events, name)) out.events[name] = clone(source.events[name]);
      else warn('event-undefined', `events/${name}`, `Event "${name}" is not defined in the source either.`, { event: name });
    }
  }
  // Every attachment the animation shows must exist in the target skin, above all on
  // slots reused by retarget. Missing ones are filled from the source; if the source
  // lacks it too, say so.
  const sourceSlotOf = Object.fromEntries(Object.entries(slotMap).map(([from, to]) => [to, from]));
  const ensureAttachment = (slot, name) => {
    if (!name || own(outSkin[slot], name)) return;
    const from = sourceSkin[sourceSlotOf[slot] ?? slot];
    if (own(from, name)) {
      outSkin[slot] ??= {};
      // Legacy copied this one without remapping weighted bone indices.
      outSkin[slot][name] = carryAttachment(from[name]);
      report.attachmentsCopied++;
    } else {
      warn('attachment-missing', `skins/${out.skins[0].name}/${slot}/${name}`,
        `Attachment "${slot}/${name}" is in neither the target skin nor the source skin.`, { slot, attachment: name });
    }
  };
  for (const [slot, timelines] of Object.entries(anim.slots ?? {})) for (const key of timelines?.attachment ?? []) ensureAttachment(slot, key?.name);
  for (const slotTimelines of Object.values(anim.attachments ?? {})) {
    for (const [slot, attachments] of Object.entries(slotTimelines ?? {})) for (const name of Object.keys(attachments ?? {})) ensureAttachment(slot, name);
  }
  // Constraint timelines follow a rename, for all four kinds. Legacy once remapped only
  // `path`; since renaming happens only on a collision, the target already owned a
  // constraint of that name, and the imported animation quietly drove the TARGET's
  // constraint instead of its own. No check caught it: anim-constraint only fires when
  // the name is missing, and here it exists.
  for (const kind of CONSTRAINT_KINDS) if (anim[kind]) anim[kind] = remapKeys(anim[kind], report.renamed[kind]);
  for (const key of anim.drawOrder ?? []) for (const offset of key?.offsets ?? []) offset.slot = slotMap[offset.slot] ?? offset.slot;

  out.animations ??= {};
  let outName = as || animationName;
  if (own(out.animations, outName)) {
    const base = outName;
    for (let i = 2; own(out.animations, outName); i++) outName = `${base}_${i}`;
  }
  out.animations[outName] = anim;
  report.animation = outName;

  structuralGate(out, anim);
  return { skeleton: out, report };
}

// Never hand back a file the editor would reject. Rule names match src/spine/check.js.
function structuralGate(out, anim) {
  const refuse = (rule, message, details) => {
    throw new StudioError('merge-gate', `The merged skeleton would be rejected: ${message}`, { rule, ...details });
  };
  const bones = new Set(out.bones.map(b => b.name));
  for (const b of out.bones) {
    if (b.parent && !bones.has(b.parent)) refuse('bone-order', `bone "${b.name}" has no parent "${b.parent}".`, { bone: b.name, parent: b.parent });
  }
  const slots = new Set();
  for (const s of out.slots) {
    if (slots.has(s.name)) refuse('slot-dup', `slot name "${s.name}" is used twice.`, { slot: s.name });
    slots.add(s.name);
    if (!bones.has(s.bone)) refuse('slot-bone', `slot "${s.name}" has no bone "${s.bone}".`, { slot: s.name, bone: s.bone });
  }
  for (const bone of Object.keys(anim.bones ?? {})) {
    if (!bones.has(bone)) refuse('anim-bone', `the animation keys unknown bone "${bone}".`, { bone });
  }
  for (const slot of Object.keys(anim.slots ?? {})) {
    if (!slots.has(slot)) refuse('anim-slot', `the animation keys unknown slot "${slot}".`, { slot });
  }
  for (const slotTimelines of Object.values(anim.attachments ?? {})) {
    for (const slot of Object.keys(slotTimelines ?? {})) {
      if (!slots.has(slot)) refuse('anim-deform-slot', `a deform timeline keys unknown slot "${slot}".`, { slot });
    }
  }
  for (const key of anim.events ?? []) {
    if (key?.name && !own(out.events, key.name)) refuse('anim-event', `the animation fires undefined event "${key.name}".`, { event: key.name });
  }
}

/** What the merge page lists: each animation with a dependency summary. */
export function describeAnimations(sk) {
  return Object.keys(sk?.animations ?? {}).map(name => {
    const d = animationDependencies(sk, name);
    return { name, bones: d.bones.size, slots: d.slots.size, constraints: d.constraints.length };
  });
}

/**
 * Keep only the named animation(s); THE RIG STAYS AS IS.
 *
 * The use: several animations sit together in one file and one is wanted on its
 * own. The rig is deliberately not touched: bones, slots, skins (mesh, weights),
 * constraints and the `skeleton` header stay identical, only `animations` is filtered.
 * Pruning unused bones is tempting but wrong: opening the file in Spine, the owner would
 * find the rig pruned, and the rig is the owner's (concept.md, division of labour).
 */
export function extractAnimations(sk, names) {
  const wanted = [].concat(names ?? []).filter(Boolean);
  if (!wanted.length) throw new StudioError('bad-argument', 'Name at least one animation to extract.');
  const available = Object.keys(sk?.animations ?? {});
  const missing = wanted.filter(n => !available.includes(n));
  if (missing.length) {
    throw new StudioError('unknown-animation', `No animation named: ${missing.join(', ')} (available: ${available.join(', ')}).`,
      { missing, available });
  }
  const out = clone(sk);
  out.animations = {};
  for (const name of wanted) out.animations[name] = clone(sk.animations[name]);
  return {
    skeleton: out,
    report: { kept: wanted, removed: available.filter(n => !wanted.includes(n)), rigUntouched: true },
  };
}
