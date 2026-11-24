// Bake: what the constraints compute, written down as plain linear bone keys.
// Ported from legacy mcp/bake.js (the pure conversion). The measuring half lives in
// src/understand/bake.js on the official runtime.
//
// Decorative physics makes icons look alive, but a phone engine pays
// for it every frame. A bake records one deterministic playthrough as keys, so the
// constraint can go and the effect stays.
//
// Pure: takes parsed JSON and measured frames, returns new objects. No runtime, no I/O.
//
// Frame shape (from src/understand/bake.js):
//   { time, bones: { [name]: { keyed: Local, applied: Local } } }
//   Local = { x, y, rotation, scaleX, scaleY, shearX, shearY }
// `keyed` is the local transform the animation set, before any constraint; `applied` is
// the local transform after constraints (updateAppliedTransform).

import { StudioError } from '../shared/errors.js';

export const CONSTRAINT_KINDS = Object.freeze(['physics', 'ik', 'transform', 'path']);

// Baking and removing are two decisions: baking physics removes only physics, and removing
// a path or an IK constraint is a separate choice. `what` is the
// coarse preset for what to remove; an explicit `remove` list overrides it.
export const WHAT_PRESETS = Object.freeze({
  physics: Object.freeze(['physics']),
  curves: Object.freeze([]),
  all: CONSTRAINT_KINDS,
});

/** Below this a channel value counts as "never left setup" (legacy EPS). */
export const VALUE_EPS = 0.001;

const round3 = v => Math.round(v * 1000) / 1000;
// Times keep four decimals: below a twentieth of a millisecond, short enough to read.
const roundTime = t => Math.round(t * 10000) / 10000;

// NFC so a Mac-authored (NFD) name still matches the same name typed elsewhere.
const nfc = x => (typeof x === 'string' ? x.normalize('NFC') : x);

/**
 * The constraint kinds to remove after baking.
 * @param {string[]|undefined} remove explicit list; wins over `what`
 * @param {string} [what] 'physics' | 'curves' | 'all'
 */
export function removalList(remove, what = 'physics') {
  if (remove !== undefined && remove !== null) {
    if (!Array.isArray(remove)) throw new StudioError('bad-argument', '`remove` must be a list of constraint kinds.', { remove });
    const unknown = remove.filter(k => !CONSTRAINT_KINDS.includes(k));
    if (unknown.length) {
      throw new StudioError('bad-argument', `Unknown constraint kind(s) in \`remove\`: ${unknown.join(', ')}.`,
        { unknown, allowed: [...CONSTRAINT_KINDS] });
    }
    return CONSTRAINT_KINDS.filter(k => remove.includes(k));
  }
  const preset = WHAT_PRESETS[what ?? 'physics'];
  if (!preset) {
    throw new StudioError('bad-argument', `Unknown \`what\` "${what}"; use physics, curves or all.`,
      { what, allowed: Object.keys(WHAT_PRESETS) });
  }
  return [...preset];
}

/** The skeleton's own key for an animation, matched regardless of Unicode normal form. */
export function findAnimationKey(sk, name) {
  const animations = sk?.animations ?? {};
  if (Object.prototype.hasOwnProperty.call(animations, name)) return name;
  return Object.keys(animations).find(key => nfc(key) === nfc(name)) ?? null;
}

/**
 * The base's own spelling of an animation name. Writing the baked clip under the runtime's
 * spelling when the file uses another Unicode form created a SECOND animation (the
 * un-baked original, constraint still inside, beside the baked one). The base's key makes
 * the write replace, not duplicate.
 */
export const canonicalAnimationName = (sk, name) => findAnimationKey(sk, name) ?? name;

const constraintBones = c => [
  ...(c && typeof c.bone === 'string' ? [c.bone] : []),
  ...(c && Array.isArray(c.bones) ? c.bones : []),
];

/**
 * Which bones may be baked: those the animation keys or a constraint drives.
 *
 * A bone that is neither (a static flip parent the owner made by mirroring a side,
 * scaleX=-1) never moves, but updateAppliedTransform re-expresses its reflection every
 * frame (scaleX=-1 comes back as scaleY=-1 plus rotate 180). A "did it move" filter is
 * fooled by that and writes keys that break the mirror for every child. Measured
 * 2026-08-20 with a mirrored curtain: the flipped side came out 27 px wrong at the tip.
 *
 * The animation is found normalization-insensitively: an exact miss used to return an
 * empty set, and every hand-keyed bone was dropped as "not keyed here" (measured
 * 2026-08-20 with a Turkish animation name). Names come back NFC.
 */
export function bakeableBones(sk, animationName) {
  const set = new Set();
  const key = findAnimationKey(sk, animationName);
  const animation = key === null ? {} : sk.animations[key] ?? {};
  for (const bone of Object.keys(animation.bones ?? {})) set.add(nfc(bone));
  for (const kind of CONSTRAINT_KINDS) {
    for (const c of sk?.[kind] ?? []) for (const bone of constraintBones(c)) set.add(nfc(bone));
  }
  return set;
}

/**
 * Bones a constraint of the given kinds drives (NFC). The physics set is what
 * `physicsStep` thins; the set for the removed kinds decides which bones are baked from
 * their applied transform.
 */
export function drivenBones(sk, kinds = CONSTRAINT_KINDS) {
  const set = new Set();
  for (const kind of kinds) {
    for (const c of sk?.[kind] ?? []) for (const bone of constraintBones(c)) set.add(nfc(bone));
  }
  return set;
}

/** Bones a physics constraint drives: the narrower set `physicsStep` thins. */
export const physicsBones = sk => drivenBones(sk, ['physics']);

const DEFAULT_SETUP = Object.freeze({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 });

// The runtime's applied rotation comes from atan2, so it wraps at +-180. Spine interpolates
// a rotate timeline on the raw value: keys at 179 and -179 spin the bone 358 degrees in
// one frame. Unwrapping keeps consecutive keys within half a turn; at the keys the pose
// is identical.
function unwrapRotations(values) {
  const out = [];
  for (const v of values) {
    if (!out.length) { out.push((((v + 180) % 360) + 360) % 360 - 180); continue; }
    const previous = out[out.length - 1];
    out.push(v + 360 * Math.round((previous - v) / 360));
  }
  return out;
}

/**
 * Applied or keyed local transforms become Spine 4.2 linear bone timelines.
 *
 * A key adds onto the setup pose for translate/rotate/shear and multiplies it for scale;
 * the conversion is that reading run backwards. Getting it wrong would not crash: it
 * would write a plausible animation that is not the one the engine showed.
 *
 * Source per bone: `applied` for a bone in `useApplied` (driven by a constraint that is
 * being removed: the keys must carry what the constraint did), `keyed` for every other
 * bone (a constraint that stays live re-applies itself on top of the keyed input, so
 * baking its output as well would apply it twice).
 *
 * A channel that never leaves setup is dropped: a dense track saying "nothing happened"
 * is the file size a bake is meant to spend carefully.
 *
 * Physics step (physics baked at intervals, not every frame): bones in
 * `physicsBones` keep one sample in every `physicsStep`. Physics is the one motion that is
 * dense by construction, so that is where a bake's size goes; authored keys and other
 * constraints are never thinned. The first and last sample always survive, so the clip's
 * start pose, end pose and loop point are untouched. The self-check replays every
 * measured sample, so a step too large shows up there.
 *
 * @param {Array} frames measured frames, in time order
 * @param {Record<string, object>} setup bone name -> setup Local
 * @param {string[]} bones the bones to convert
 * @param {{ useApplied?: Iterable<string>, physicsStep?: number, physicsBones?: Iterable<string> }} [options]
 * @returns {{ tracks: Record<string, object>, keys: number }} tracks: bone -> { translate?, rotate?, scale?, shear? }
 */
export function boneTracks(frames, setup, bones, options = {}) {
  const step = Math.max(1, Math.round(options.physicsStep) || 1);
  const applied = new Set([...(options.useApplied ?? [])].map(nfc));
  const thinned = new Set([...(options.physicsBones ?? [])].map(nfc));
  const tracks = {};
  let keys = 0;
  for (const name of bones) {
    const s = { ...DEFAULT_SETUP, ...(setup[name] ?? {}) };
    const source = applied.has(nfc(name)) ? 'applied' : 'keyed';
    const thin = step > 1 && thinned.has(nfc(name));
    const last = frames.length - 1;
    const picked = [];
    frames.forEach((frame, i) => {
      const local = frame.bones?.[name]?.[source];
      if (!local) return;
      if (thin && i % step !== 0 && i !== last) return;
      picked.push({ time: roundTime(frame.time), v: local });
    });
    if (!picked.length) continue;
    const rotations = picked.map(p => p.v.rotation - s.rotation);
    const rotate = (source === 'applied' ? unwrapRotations(rotations) : rotations).map(round3);
    const channels = {};
    const translate = picked.map(p => ({ time: p.time, x: round3(p.v.x - s.x), y: round3(p.v.y - s.y) }));
    if (translate.some(k => Math.abs(k.x) > VALUE_EPS || Math.abs(k.y) > VALUE_EPS)) channels.translate = translate;
    if (rotate.some(v => Math.abs(v) > VALUE_EPS)) channels.rotate = picked.map((p, i) => ({ time: p.time, value: rotate[i] }));
    const scale = picked.map(p => ({ time: p.time,
      x: round3(s.scaleX ? p.v.scaleX / s.scaleX : p.v.scaleX),
      y: round3(s.scaleY ? p.v.scaleY / s.scaleY : p.v.scaleY) }));
    if (scale.some(k => Math.abs(k.x - 1) > VALUE_EPS || Math.abs(k.y - 1) > VALUE_EPS)) channels.scale = scale;
    const shear = picked.map(p => ({ time: p.time, x: round3(p.v.shearX - s.shearX), y: round3(p.v.shearY - s.shearY) }));
    if (shear.some(k => Math.abs(k.x) > VALUE_EPS || Math.abs(k.y) > VALUE_EPS)) channels.shear = shear;
    if (Object.keys(channels).length) {
      tracks[name] = channels;
      for (const list of Object.values(channels)) keys += list.length;
    }
  }
  return { tracks, keys };
}

/**
 * Keep the bones that may be baked; the rest stay as the base has them.
 * `keepLive` is the owner's explicit override: those bones keep their authored keys.
 * @returns {{ bones: string[], keptLive: string[] }}
 */
export function selectBones(bones, allowed, keepLive = []) {
  const allow = new Set([...allowed].map(nfc));
  const keep = new Set([...keepLive].map(nfc));
  const out = [], keptLive = [];
  for (const bone of bones) {
    if (allow.has(nfc(bone)) && !keep.has(nfc(bone))) out.push(bone);
    else keptLive.push(bone);
  }
  return { bones: out, keptLive };
}

/**
 * A new skeleton with the baked bones' timelines written into one animation.
 *
 * Every bone in `bakedBones` has its timelines REPLACED WHOLE by its baked channels, and
 * deleted when the bake found it static. The measurement covers everything such a bone
 * does; an authored channel left beside the baked ones would play on top of them.
 * (Legacy merged per channel, so a channel the bake dropped kept its authored keys.)
 * Every other bone, and every slot, deform, draw order, event and constraint timeline,
 * passes through untouched. Bone keys use the skeleton's own spelling of the name.
 *
 * @param {object} sk skeleton JSON (not modified)
 * @param {string} animationName
 * @param {Record<string, object>} tracks from boneTracks
 * @param {Iterable<string>} bakedBones every bone the bake owns in this animation
 */
export function applyBakedTracks(sk, animationName, tracks, bakedBones) {
  const out = structuredClone(sk);
  out.animations ??= {};
  const key = canonicalAnimationName(out, animationName);
  const animation = out.animations[key] ??= {};
  const ownSpelling = new Map((out.bones ?? []).map(b => [nfc(b.name), b.name]));
  const spell = name => ownSpelling.get(nfc(name)) ?? name;
  const bones = { ...(animation.bones ?? {}) };
  const existing = new Map(Object.keys(bones).map(name => [nfc(name), name]));
  for (const bone of bakedBones) {
    const old = existing.get(nfc(bone));
    if (old !== undefined) delete bones[old];
  }
  for (const [bone, channels] of Object.entries(tracks)) {
    if (Object.keys(channels).length) bones[spell(bone)] = structuredClone(channels);
  }
  if (Object.keys(bones).length) animation.bones = bones; else delete animation.bones;
  return out;
}

/**
 * Remove baked constraint blocks: the constraint arrays, every animation's timelines that
 * drove them (a timeline naming a missing constraint is a broken file), and skins' lists
 * of them (the runtime refuses a skin naming a missing constraint; legacy left those
 * behind). Attachments, slots and bones are never touched: a clipping mask is a slot
 * attachment, not a constraint, and survives byte for byte.
 *
 * @returns {{ skeleton: object, removed: Record<string, string[]> }} a new skeleton
 */
export function dropConstraints(sk, kinds) {
  const skeleton = structuredClone(sk);
  /** @type {Record<string, string[]>} */
  const removed = {};
  for (const kind of CONSTRAINT_KINDS.filter(k => kinds.includes(k))) {
    const list = skeleton[kind] ?? [];
    if (!list.length) continue;
    removed[kind] = list.map(c => c.name);
    delete skeleton[kind];
    for (const animation of Object.values(skeleton.animations ?? {})) delete animation[kind];
    if (Array.isArray(skeleton.skins)) {
      for (const skin of skeleton.skins) if (skin && Object.prototype.hasOwnProperty.call(skin, kind)) delete skin[kind];
    }
  }
  return { skeleton, removed };
}
