// Composes one written animation onto the owner's base, producing the delivery skeleton.
//
// The one-way rule in code: the base is the authority for everything the studio did not
// write. The result is built from a copy of the base; the written clip goes on top by the
// precedence policy (src/deliver/policy.js); work accumulated in the previous delivery is
// kept; a mechanical weight repair travels only while the base mesh is the one it was made
// for, and when the owner changed that mesh in Spine the base wins and the report says so.
//
// Nothing is returned unless it is proven: the static check must find no fatal the base
// did not already have, and the official runtime must parse the result (or have refused
// the base for the same reason already).

import { plantFeet } from './plant.js';
import { StudioError } from '../shared/errors.js';
import { checkSkeleton } from '../spine/check.js';
import { splitFatals, describe, identity } from '../spine/findings.js';
import { listMeshes, signature } from '../spine/weights.js';
import { readRepairMarker, REPAIR_MARKER } from '../spine/weight-repair.js';
import { parseSkeleton } from '../runtime/index.js';
import { normalizeAnimation } from './normalize.js';
import { carryPaints } from '../spine/paint.js';
import { mergeAnimations, mergeClip, changesBetween } from './policy.js';

/** Marks a file as a studio delivery; only such files (or new ones) may be overwritten. */
export const DELIVERY_MARKER = '_kfDelivery';

// Markers of features this tree does not carry. Present in a previous delivery, they are
// dropped on rebuild and named in the report rather than silently lost.
const UNCARRIED_MARKERS = ['_kfRig', '_kfBind', '_kfMesh', '_kfLiked', '_kfRecipe', '_kfPlaceholder', '_kfPlaceholderSlots'];

const meshAt = (sk, key) => {
  const [slot, ...rest] = key.split('/');
  const attachment = rest.join('/');
  const found = listMeshes(sk).filter(m => m.slot === slot && m.attachment === attachment);
  return found.length === 1 ? found[0] : null;
};

// Carry mechanical weight repairs from the previous delivery onto the rebuilt skeleton.
function carryWeightRepairs(out, previous) {
  const kept = [];
  const dropped = [];
  const records = readRepairMarker(previous);
  const carried = {};
  for (const [key, record] of Object.entries(records)) {
    const fixed = meshAt(previous, key);
    const fromBase = meshAt(out, key);
    if (!fixed || !fromBase) {
      dropped.push({ mesh: key, reason: fromBase ? 'missing-in-previous' : 'missing-in-base' });
      continue;
    }
    if (record.baseSignature && record.baseSignature !== signature(fromBase.mesh.vertices)) {
      dropped.push({ mesh: key, reason: 'base-changed' });
      continue;
    }
    fromBase.mesh.vertices = structuredClone(fixed.mesh.vertices);
    carried[key] = record;
    kept.push(key);
  }
  // The base's own markers (a base can itself be an older delivery) pass through untouched,
  // as everything of the owner's does; carried records are added under the English name.
  if (kept.length) out[REPAIR_MARKER] = { ...(out[REPAIR_MARKER] ?? {}), ...carried };
  return { kept, dropped };
}

async function runtimeVerdict(skeleton) {
  try { await parseSkeleton(skeleton); return null; } catch (err) { return err.message; }
}

/**
 * @param {object} options
 * @param {object} options.base         the owner's skeleton JSON (never mutated)
 * @param {object|null} [options.previous] the current delivery file, if one exists
 * @param {string} options.name         animation name, used exactly as given
 * @param {object} options.animation    native Spine 4.2 animation JSON
 * @param {boolean} [options.replace]   rebuild this clip from the base, dropping what accumulated
 * @param {number} [options.fps]        snap key times to this grid
 * @param {boolean} [options.holdFromStart]
 * @param {object} [options.deliveryInfo] stored under DELIVERY_MARKER (e.g. { base: 'hero.json' })
 * @returns {Promise<{ skeleton: object, report: object }>}
 */
// What a physics constraint drives on its bone, as the channels a clip would key.
const PHYSICS_DRIVES = { rotate: ['rotate'], x: ['translate', 'translatex'], y: ['translate', 'translatey'], scaleX: ['scale', 'scalex'], shearX: ['shear', 'shearx'] };

/**
 * Channels this clip keys on bones the rig already moves by physics. The owner built that sway
 * in Spine; keys on the same channel fight it. Reported, not refused: sometimes it is meant.
 */
export function keysOnPhysicsBones(base, clip) {
  const out = [];
  for (const constraint of base.physics ?? []) {
    const keyed = Object.keys(clip.bones?.[constraint.bone] ?? {});
    const driven = Object.entries(PHYSICS_DRIVES).filter(([setting]) => (constraint[setting] ?? 0) !== 0).flatMap(([, channels]) => channels);
    const clash = keyed.filter(channel => driven.includes(channel));
    if (clash.length) out.push({ bone: constraint.bone, constraint: constraint.name, channels: clash,
      note: `"${constraint.bone}" is moved by the rig's physics constraint "${constraint.name}"; these keys fight its sway. Move its parent instead and let the physics follow, or leave this bone out.` });
  }
  return out;
}

export async function composeDelivery({ base, previous = null, name, animation, replace = false, fps, holdFromStart = true, plant, deliveryInfo = {} }) {
  if (typeof name !== 'string' || !name.length) throw new StudioError('bad-argument', 'The animation name must be a non-empty string.');
  if (!base || typeof base !== 'object') throw new StudioError('bad-argument', 'A base skeleton is required.');
  const normalized = normalizeAnimation(animation, { fps, holdFromStart });

  const baseClip = base.animations?.[name];
  const targetClip = previous?.animations?.[name];
  const lower = replace ? (baseClip ?? {}) : mergeClip(baseClip, targetClip).clip;
  const { clip, carried: carriedInClip } = mergeClip(lower, normalized.animation);

  const out = structuredClone(base);
  const merged = mergeAnimations({ ...(base.animations ?? {}), [name]: clip }, previous?.animations, name);
  out.animations = merged.animations;
  // Planted feet are solved on the clip as composed, and baked to rotate keys (src/deliver/plant.js).
  const baked = plant ? plantFeet(out, name, plant, { fps: fps ?? 30 }) : null;
  const planted = baked?.planted ?? null;
  // Which bones of which clip the solver wrote: critique judges the rhythm the author wrote, not the bake.
  const plantedBones = Object.fromEntries(Object.entries(previous?.[DELIVERY_MARKER]?.planted ?? {})
    .filter(([clipName]) => out.animations?.[clipName] && !(clipName === name && (replace || baked))));
  if (baked) plantedBones[name] = baked.bones;

  const weights = previous ? carryWeightRepairs(out, previous) : { kept: [], dropped: [] };
  const paints = previous ? carryPaints(out, previous) : { kept: [], dropped: [] };
  const droppedMarkers = previous ? UNCARRIED_MARKERS.filter(m => previous[m] !== undefined && base[m] === undefined) : [];
  out[DELIVERY_MARKER] = { ...deliveryInfo, baseHash: base.skeleton?.hash ?? null, ...(Object.keys(plantedBones).length ? { planted: plantedBones } : {}) };

  const baseFindings = checkSkeleton(base);
  const outFindings = checkSkeleton(out);
  const { fresh, inherited } = splitFatals(baseFindings, outFindings);
  if (fresh.length) {
    throw new StudioError('delivery-refused', `Nothing was written: the result fails checks the base passes. ${describe(fresh).join('; ')}`,
      { findings: fresh });
  }
  const outRuntime = await runtimeVerdict(out);
  let inheritedRuntimeError = null;
  if (outRuntime) {
    const baseRuntime = await runtimeVerdict(base);
    if (!baseRuntime) {
      throw new StudioError('delivery-refused', `Nothing was written: the official runtime refuses the result but accepts the base. ${outRuntime}`,
        { runtime: outRuntime });
    }
    inheritedRuntimeError = baseRuntime;
  }
  const baseKeys = new Set(baseFindings.map(identity));
  const onPhysics = keysOnPhysicsBones(base, normalized.animation);
  return {
    skeleton: out,
    report: {
      animation: name,
      held: normalized.held,
      snapped: normalized.snapped,
      presets: normalized.presets,
      ...(normalized.followed.length ? { followed: normalized.followed } : {}),
      ...(planted ? { planted } : {}),
      ...(planted?.some(p => p.reach > 1) ? { plantWarning: `${planted.filter(p => p.reach > 1).map(p => p.bone).join(', ')}: the leg is too short to stay on its point at times (reach above 1), so the foot lifts there. Move the hips less far, or bend the knees more.` } : {}),
      ...(onPhysics.length ? { onPhysicsBones: onPhysics } : {}),
      replacedFromBase: replace && targetClip !== undefined,
      carriedInClip,
      carriedClips: merged.carried,
      keptClips: merged.kept,
      changes: changesBetween(previous?.animations ?? base.animations, out.animations),
      weightRepairs: weights,
      ...(paints.kept.length || paints.dropped.length ? { paintedMeshes: paints } : {}),
      droppedMarkers,
      inheritedFatals: inherited,
      warnings: outFindings.filter(f => f.level === 'warn' && !baseKeys.has(identity(f))),
      inheritedRuntimeError,
    },
  };
}
