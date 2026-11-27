// The Keyframe engine: the studio's own player for skeletal animation. No Spine code, no
// Spine license. Reads Spine 4.2 JSON as a data format (and the Keyframe format, which
// src/engine/keyframe-format.js turns into it), poses it, and lists what it draws.
//
// Pure and isomorphic: the page, the standalone player and Node all load these modules as is.

import { StudioError } from '../shared/errors.js';
import { compileSkeleton } from './model.js';
import { Pose, regionVertices, meshVertices } from './pose.js';
import { collectDraws, boundsOf } from './draws.js';

export { compileSkeleton, parseColor, INHERIT, BLEND, sequenceFrame, SEQUENCE_MODES } from './model.js';
export { Pose, regionVertices, meshVertices, attachmentPath } from './pose.js';
export { Mixer, MixPlayhead, DEFAULT_MIX } from './mixer.js';
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
  if (!model.physics?.length) return new Pose(model, { skin }).apply(animation, Math.fround(time), { loop }).updateWorld();
  return new Playhead(model, animation, { skin, loop }).at(time);
}

/** Physics steps per second when the engine replays a clip for a sample (a bake, a frame, a check). */
export const PHYSICS_RATE = 60;

/**
 * One clip played from 0 with its physics stepped on the fixed 1/60 grid, so the pose at an
 * instant is the pose a player shows there after playing from the start: the same numbers every
 * time. Moving forward continues the simulation; going back replays from 0. Without physics it
 * poses each instant on its own.
 */
export class Playhead {
  /** @param {ReturnType<typeof compileSkeleton>} model @param {any} animation @param {{ skin?: string, loop?: boolean }} [options] */
  constructor(model, animation, { skin, loop = false } = {}) {
    this.model = model;
    this.animation = typeof animation === 'string' ? requireAnimation(model, animation) : animation;
    this.pose = new Pose(model, { skin });
    this.loop = loop;
    this.physics = !!model.physics?.length;
    this.step = -1;
  }

  /** The pose at `time` seconds, world transforms and physics updated. */
  at(time) {
    if (!(time >= 0) || time > MAX_SAMPLE_SECONDS) {
      throw new StudioError('bad-argument', `Sample times must be numbers between 0 and ${MAX_SAMPLE_SECONDS} s.`, { time, max: MAX_SAMPLE_SECONDS });
    }
    const pose = this.pose, loop = this.loop, animation = this.animation;
    if (!this.physics) return pose.apply(animation, Math.fround(time), { loop }).updateWorld();
    const n = Math.floor(time * PHYSICS_RATE + 1e-6);
    if (n < this.step) { this.step = -1; pose.resetPhysics(); }
    for (let k = this.step + 1; k <= n; k++) {
      const t = Math.fround(k / PHYSICS_RATE);
      pose.apply(animation, t, { loop, lastTime: k > 0 ? Math.fround((k - 1) / PHYSICS_RATE) : null });
      pose.updateWorld(k === 0 ? { physics: 'reset' } : { physics: 'update', delta: 1 / PHYSICS_RATE });
    }
    this.step = Math.max(this.step, n);
    const rest = time - n / PHYSICS_RATE;
    if (rest > 1e-9) {
      // Between two steps: the lag of the part step is shown, then the simulation goes back to the step.
      const saved = pose.savePhysics();
      pose.apply(animation, Math.fround(time), { loop, lastTime: Math.fround(n / PHYSICS_RATE) });
      pose.updateWorld({ physics: 'update', delta: rest });
      pose.restorePhysics(saved);
    } else {
      pose.apply(animation, Math.fround(n / PHYSICS_RATE), { loop }).updateWorld({ physics: 'pose' });
    }
    return pose;
  }
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
  const head = new Playhead(model, requireAnimation(model, animationName), options);
  return times.map(time => ({ time, ...head.at(time).snapshot() }));
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
