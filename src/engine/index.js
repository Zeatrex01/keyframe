// The Keyframe engine: the studio's own player for skeletal animation. No Spine code, no
// Spine license. Reads Spine 4.2 JSON as a data format (and the Keyframe format, which
// src/engine/keyframe-format.js turns into it), poses it, and lists what it draws.
//
// Pure and isomorphic: the page, the standalone player and Node all load these modules as is.

import { StudioError } from '../shared/errors.js';
import { compileSkeleton } from './model.js';
import { Pose, regionVertices, meshVertices } from './pose.js';
import { collectDraws, boundsOf } from './draws.js';

export { compileSkeleton, parseColor, INHERIT, BLEND } from './model.js';
export { Pose, regionVertices, meshVertices } from './pose.js';
export { collectDraws, boundsOf, applyClip, triangulate } from './draws.js';
export { parseAtlas, atlasRegions, imageRegions } from './atlas.js';
export { resolveCurve } from './curve.js';

export const ENGINE_NAME = 'keyframe';
export const MAX_SAMPLE_SECONDS = 600;

/**
 * A pose of one animation at an instant, world transforms updated.
 * @param {ReturnType<typeof compileSkeleton>} model @param {string} animationName @param {number} time
 * @param {{ skin?: string, loop?: boolean }} [options]
 */
export function poseAt(model, animationName, time, { skin, loop = false } = {}) {
  const animation = requireAnimation(model, animationName);
  if (!(time >= 0) || time > MAX_SAMPLE_SECONDS) {
    throw new StudioError('bad-argument', `Sample times must be numbers between 0 and ${MAX_SAMPLE_SECONDS} s.`, { time, max: MAX_SAMPLE_SECONDS });
  }
  // Key times are float32 (as in every Spine runtime); posing at the float32 instant lands on them.
  return new Pose(model, { skin }).apply(animation, Math.fround(time), { loop }).updateWorld();
}

export function requireAnimation(model, name) {
  const animation = model.animations.get(name);
  if (!animation) throw new StudioError('unknown-animation', `No animation named "${name}".`, { animation: name, available: [...model.animations.keys()] });
  return animation;
}

/**
 * The setup pose, no animation applied.
 * @param {ReturnType<typeof compileSkeleton>} model @param {{ skin?: string }} [options]
 */
export function setupPose(model, { skin } = {}) {
  return new Pose(model, { skin }).updateWorld();
}

/** Snapshots of one animation at the given times, in the order given. */
export function sample(model, animationName, times, options = {}) {
  return times.map(time => ({ time, ...poseAt(model, animationName, time, options).snapshot() }));
}

/**
 * The box to frame each clip in: the setup pose and everything the clip draws, sampled `perSecond`
 * (at least 8, at most `max` samples a clip) so a swing at its extreme is not cut off between
 * samples; `all` is the union of every clip. The stage frames the clip it plays with it.
 * @param {ReturnType<typeof compileSkeleton>} model
 * @param {(name: string) => any} regionOf atlas regions by name (atlasRegions)
 * @returns {{ all: {x:number,y:number,width:number,height:number}|null, clips: Map<string, {x:number,y:number,width:number,height:number}|null> }}
 */
export function clipFrames(model, regionOf, { perSecond = 30, max = 60 } = {}) {
  const pose = new Pose(model);
  const setup = collectDraws(pose.updateWorld(), regionOf).draws;
  const clips = new Map(), all = [setup];
  for (const [name, animation] of model.animations) {
    const steps = Math.max(8, Math.min(max, Math.ceil(animation.duration * perSecond)));
    const lists = [setup];
    for (let i = 0; i <= steps; i++) lists.push(collectDraws(pose.apply(animation, animation.duration * i / steps).updateWorld(), regionOf).draws);
    clips.set(name, boundsOf(lists));
    all.push(...lists.slice(1));
  }
  return { all: boundsOf(all), clips };
}

/** Convenience: compile JSON and keep the result (the model is immutable once built). */
export function load(json) { return compileSkeleton(json); }

/**
 * World vertices (x, y pairs) of one attachment of one slot, at the setup pose or at `time` of
 * `animation`. Without a name, the attachment the slot shows. Regions give four corners (BL, UL,
 * UR, BR) as an untrimmed atlas region would place them.
 * @param {ReturnType<typeof compileSkeleton>} model
 * @param {string} slotName @param {string|null} [attachmentName]
 * @param {{ animation?: string, time?: number, skin?: string }} [options]
 * @returns {number[]}
 */
export function attachmentWorldVertices(model, slotName, attachmentName = null, { animation, time = 0, skin } = {}) {
  const pose = animation ? poseAt(model, animation, time, { skin }) : setupPose(model, { skin });
  const index = model.slotIndex.get(slotName);
  if (index === undefined) throw new StudioError('unknown-slot', `No slot named "${slotName}".`, { slot: slotName });
  const slot = pose.slots[index];
  const att = attachmentName === null ? slot.attachment : pose.attachmentFor(index, attachmentName);
  if (!att) throw new StudioError('unknown-attachment', `Slot "${slotName}" has no attachment "${attachmentName}".`, { slot: slotName, attachment: attachmentName });
  const flat = att.type === 'region' ? regionVertices(pose.bones[slot.data.bone], att) : meshVertices(pose, slot, att);
  return Array.from(flat);
}
