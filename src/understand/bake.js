// Bake, measured and proven on the official runtime.
// Ported from the measuring half of legacy player_scrub.js `bakeGecisi` (which needed an
// open studio window behind a file bridge) and the orchestration and self-check of
// legacy server/tools/bake_animation.js. The conversion itself is src/spine/bake.js.
//
// A physics bake is a recording of one deterministic playthrough: an exact replacement
// for decorative motion that always plays the same way, and a loss for physics that
// reacts to gameplay. The report says which it produced.
//
// The numbers come from the runtime, never from our own maths: constraints exist only in
// the engine. Physics is stepped on a fixed 1/60 grid from t=0, so baking twice gives the
// same numbers.
//
// Isomorphic: no node:* imports. Nothing here writes a file; delivery is another layer.

import { StudioError } from '../shared/errors.js';
import { parseSkeleton, sampleAnimation, MAX_SAMPLE_SECONDS } from '../runtime/index.js';
import {
  removalList, canonicalAnimationName, bakeableBones, drivenBones, physicsBones,
  boneTracks, selectBones, applyBakedTracks, dropConstraints,
} from '../spine/bake.js';
import { checkSkeleton } from '../spine/check.js';
import { splitFatals, describe } from '../spine/findings.js';

/** Physics simulation steps per second (legacy PHYSICS_STEP = 1/60). */
export const PHYSICS_RATE = 60;
export const DEFAULT_BAKE_FPS = 30;
/** A bone whose every channel stays within this of setup never moved (legacy EPS). */
export const MOVE_EPS = 0.001;
/** The self-check's limit on world position error: half a source pixel (legacy TOLERANS). */
export const WORLD_TOLERANCE = 0.5;

export const RECORDING_NOTE = 'A physics bake is a recording of one deterministic playthrough: exact for decorative motion that always plays the same way, a loss for physics that reacts to gameplay.';

const round3 = v => Math.round(v * 1000) / 1000;
const nfc = x => (typeof x === 'string' ? x.normalize('NFC') : x);
const LOCAL_FIELDS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'];
const angleGap = d => Math.abs((((d + 180) % 360) + 360) % 360 - 180);

/**
 * Snap a requested sample rate to 60/N so every sample lands on a simulation step.
 * @returns {{ fps: number, every: number }} every: simulation steps per sample
 */
export function snapFps(requested) {
  const wanted = Math.min(PHYSICS_RATE, Math.max(1, Number(requested) || DEFAULT_BAKE_FPS));
  const every = Math.max(1, Math.round(PHYSICS_RATE / wanted));
  return { fps: PHYSICS_RATE / every, every };
}

/** Sample instants: every `every` simulation steps from 0, plus the end of the clip. */
export function sampleTimes(duration, every) {
  const times = [];
  for (let s = 0; ; s++) {
    const step = s * every;
    const t = step / PHYSICS_RATE;
    if (t > duration + 1e-9) break;
    times.push(t);
  }
  if (duration - times[times.length - 1] > 1e-9) times.push(duration);
  return times;
}

const localOf = o => Object.fromEntries(LOCAL_FIELDS.map(f => [f, o[f]]));

// Where a bone puts the world: its origin, and for a bone with length its tip and the end
// of its local Y axis at the same distance. The origin alone never sees a leaf bone's own
// rotation, scale or reflection (a physics pendulum swings around a fixed origin); the two
// axis points do. Legacy compared origins only, though its comment meant to catch a lost
// reflection.
function worldPoints(bone, length) {
  const points = [[bone.worldX, bone.worldY]];
  if (length > 0) {
    const { a, b, c, d } = bone.matrix;
    points.push([bone.worldX + a * length, bone.worldY + c * length],
      [bone.worldX + b * length, bone.worldY + d * length]);
  }
  return points;
}

function leavesSetup(local, setup) {
  return LOCAL_FIELDS.some(f => (f === 'rotation'
    ? angleGap(local[f] - setup[f]) > MOVE_EPS
    : Math.abs(local[f] - setup[f]) > MOVE_EPS));
}

/**
 * Walk one clip on the runtime and record, per sample, every bone's keyed local, applied
 * local (after constraints) and world position.
 *
 * Applied, not keyed, is what a removed constraint leaves behind: updateAppliedTransform
 * back-computes local values from the world transform the constraints produced. Keyed
 * (b.x, b.rotation) is what the animation set before any constraint touched it.
 *
 * A bone that never leaves setup is not listed in `moving` and carries no locals in the
 * frames: otherwise a 30-bone rig ships 30 dense tracks to say that 27 never moved. World
 * points (origin, tip, Y axis) are kept for every bone; the self-check compares all of them.
 *
 * @param {object} data spine.SkeletonData
 * @param {string} animationName the runtime's name for the clip
 * @param {{ fps?: number, skin?: string }} [options]
 */
export async function measureBake(data, animationName, { fps, skin } = {}) {
  // A bake records what the constraints do; a constraint the engine does not evaluate would be
  // baked as if it did nothing. That needs the official runtime.
  if (data.backend === 'keyframe' && data.limits?.length) {
    throw new StudioError('spine-addon-off', `Baking this rig needs the Spine add-on: the studio's engine does not evaluate ${data.limits.join(', ')} yet.`,
      { limits: data.limits });
  }
  const animation = data.findAnimation(animationName);
  if (!animation) {
    throw new StudioError('unknown-animation', `No animation named "${animationName}".`,
      { animation: animationName, available: data.animations.map(a => a.name) });
  }
  const { fps: rate, every } = snapFps(fps);
  const duration = animation.duration;
  // The runtime samples at most MAX_SAMPLE_SECONDS; a longer clip is baked up to there and
  // the report says so instead of pretending the bake covers the whole clip.
  const truncated = duration > MAX_SAMPLE_SECONDS;
  const times = sampleTimes(Math.min(duration, MAX_SAMPLE_SECONDS), every);
  const samples = await sampleAnimation(data, animationName, times, { fps: PHYSICS_RATE, skin });

  const setup = Object.fromEntries(data.bones.map(b => [b.name, localOf(b)]));
  const moving = data.bones.map(b => b.name).filter(name => samples.some(sample => {
    const bone = sample.bones.find(x => x.name === name);
    return leavesSetup(localOf(bone), setup[name]) || leavesSetup(bone.applied, setup[name]);
  }));
  const movingSet = new Set(moving);
  const lengths = Object.fromEntries(data.bones.map(b => [b.name, b.length]));
  const frames = samples.map(sample => {
    const bones = {}, world = {};
    for (const bone of sample.bones) {
      world[bone.name] = worldPoints(bone, lengths[bone.name]);
      if (movingSet.has(bone.name)) bones[bone.name] = { keyed: localOf(bone), applied: { ...bone.applied } };
    }
    return { time: sample.time, bones, world };
  });

  const requested = Number(fps) || DEFAULT_BAKE_FPS;
  return {
    animation: animationName,
    fps: rate,
    ...(rate !== requested ? { requestedFps: requested } : {}),
    duration,
    physics: data.physicsConstraints.length > 0,
    truncated,
    setup,
    moving,
    frames,
  };
}

/**
 * Prove a bake: parse the baked skeleton with the official runtime, replay the clip as
 * delivered (the removed constraints are gone; the kept ones stay live), and compare every
 * bone's world points with the measurement. The keys have to land where the engine put
 * the bones. Every measured sample is replayed, including those `physicsStep` thinned out.
 *
 * @returns {Promise<{ passed: boolean, maxWorldError?: number, tolerance: number,
 *   worst?: { bone: string, time: number }, error?: string }>}
 * @param {object} bakedJson
 * @param {string} animationName
 * @param {object} measurement
 * @param {{ skin?: string }} [options]
 */
export async function verifyBake(bakedJson, animationName, measurement, { skin } = {}) {
  let samples, data;
  try {
    data = await parseSkeleton(bakedJson);
    const name = canonicalAnimationName(bakedJson, animationName);
    samples = await sampleAnimation(data, name, measurement.frames.map(f => f.time), { fps: PHYSICS_RATE, skin });
  } catch (err) {
    return { passed: false, tolerance: WORLD_TOLERANCE, error: err.message };
  }
  const lengths = Object.fromEntries(data.bones.map(b => [b.name, b.length]));
  let max = 0, worst = null;
  samples.forEach((sample, i) => {
    const measured = measurement.frames[i].world;
    for (const bone of sample.bones) {
      const m = measured[bone.name];
      if (!m) continue;
      const replayed = worldPoints(bone, lengths[bone.name]);
      m.forEach(([x, y], k) => {
        if (!replayed[k]) return;
        const d = Math.max(Math.abs(replayed[k][0] - x), Math.abs(replayed[k][1] - y));
        if (d > max) { max = d; worst = { bone: bone.name, time: sample.time }; }
      });
    }
  });
  const passed = max <= WORLD_TOLERANCE;
  return { passed, maxWorldError: round3(max), tolerance: WORLD_TOLERANCE, ...(passed ? {} : { worst }) };
}

/**
 * Bake one or more animations of a skeleton into plain linear bone keys.
 *
 * Every animation is measured on the source, constraints still live, and the constraint
 * blocks are dropped once at the end: drop physics after the first clip and the rest have
 * nothing left to simulate.
 *
 * Which bones are baked: those the clip keys or a constraint drives, minus `keepLive`
 * (left exactly as the base has them). A bone driven by a removed constraint is baked
 * from its applied transform; every other bone from its keyed transform, resampled into
 * dense linear keys, because a constraint that stays live re-applies itself on top.
 *
 * @param {object} json skeleton JSON (not modified)
 * @param {{ animations?: string[], animation?: string, what?: 'physics'|'curves'|'all',
 *   remove?: string[], fps?: number, physicsStep?: number, keepLive?: string[], skin?: string }} [options]
 * @returns {Promise<{ skeleton: object, what: string, remove: string[], removed: Record<string, string[]>, physicsStep?: number,
 *   keptLive: string[], animations: object[], verification: { passed: boolean, maxWorldError: number }, note?: string }>}
 */
export async function bakeAnimations(json, options = {}) {
  const { what = 'physics', remove, fps, skin } = options;
  const physicsStep = Math.max(1, Math.round(options.physicsStep) || 1);
  const keepLive = (options.keepLive ?? []).map(x => nfc(String(x)));
  const kinds = removalList(remove, what);
  const requested = options.animations ?? [options.animation ?? Object.keys(json?.animations ?? {})[0]];
  if (!requested.length || requested.some(n => typeof n !== 'string')) {
    throw new StudioError('unknown-animation', 'Name the animation(s) to bake; this skeleton has none to default to.',
      { available: Object.keys(json?.animations ?? {}) });
  }

  const data = await parseSkeleton(json);
  const fromApplied = drivenBones(json, kinds);
  const thinnable = physicsBones(json);
  const keep = new Set(keepLive);
  const skeletonBones = (json.bones ?? []).map(b => b.name);

  let work = json;
  const baked = [];
  const keptLive = new Set();
  for (const name of requested) {
    const animation = canonicalAnimationName(json, name);
    const measurement = await measureBake(data, animation, { fps, skin });
    const allowed = bakeableBones(json, animation);
    const selected = selectBones(measurement.moving, allowed, keepLive);
    for (const bone of selected.keptLive) keptLive.add(bone);
    const { tracks, keys } = boneTracks(measurement.frames, measurement.setup, selected.bones,
      { useApplied: fromApplied, physicsStep, physicsBones: thinnable });
    // The bake owns every bakeable bone of the clip, moving or not: a static one loses its
    // authored timelines too, or they would play once the constraint holding it is gone.
    const owned = skeletonBones.filter(b => allowed.has(nfc(b)) && !keep.has(nfc(b)));
    work = applyBakedTracks(work, animation, tracks, owned);
    baked.push({ animation, measurement, bones: Object.keys(tracks).length, keys });
  }
  if (baked.every(b => b.bones === 0)) {
    throw new StudioError('nothing-to-bake', `Nothing moves in ${baked.map(b => `"${b.animation}"`).join(', ')}: there is nothing to bake.`,
      { animations: baked.map(b => b.animation) });
  }

  const { skeleton, removed } = dropConstraints(work, kinds);
  // Baking must not break the file. Only fresh fatals count: what the source already
  // carried is the owner's, not ours (ADR-5).
  const { fresh } = splitFatals(checkSkeleton(json), checkSkeleton(skeleton));
  if (fresh.length) {
    throw new StudioError('bake-broke-file', `The baked skeleton has new fatal problems: ${describe(fresh).join('; ')}`,
      { fatals: fresh });
  }

  const animations = [];
  let passed = true, maxWorldError = 0;
  for (const b of baked) {
    const m = b.measurement;
    const verification = await verifyBake(skeleton, b.animation, m, { skin });
    if (!verification.passed) passed = false;
    if ((verification.maxWorldError ?? 0) > maxWorldError) maxWorldError = verification.maxWorldError;
    animations.push({
      animation: b.animation, fps: m.fps, ...(m.requestedFps !== undefined ? { requestedFps: m.requestedFps } : {}),
      duration: m.duration, truncated: m.truncated, physics: m.physics,
      bones: b.bones, keys: b.keys, samples: m.frames.length, ...(b.bones === 0 ? { static: true } : {}),
      verification,
    });
  }
  // Only a removed physics constraint was recorded; one left live still simulates.
  const recorded = Object.prototype.hasOwnProperty.call(removed, 'physics');
  return {
    skeleton,
    what, remove: kinds, removed,
    ...(physicsStep > 1 ? { physicsStep } : {}),
    keptLive: [...keptLive],
    animations,
    verification: { passed, maxWorldError },
    ...(recorded ? { note: RECORDING_NOTE } : {}),
  };
}
