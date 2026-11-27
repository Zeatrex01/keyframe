// The studio's pose truth (ADR-2, revised by ADR-11): one API, two backends.
//
//   keyframe  the studio's own engine (src/engine). The default; loads no Spine code and needs
//             no Spine license.
//   spine     the official spine-ts 4.2 runtime (src/runtime/spine.js), present only when the
//             owner enabled the Spine add-on.
//
// `parseSkeleton` picks the backend: the engine, unless the file uses something the engine does
// not evaluate yet (path constraints, skin-only bones and constraints) and the add-on is on. Without the add-on such a file still poses on the engine, and `data.limits`
// names what was left out, so every tool can say so instead of pretending.
//
// Callers get the same shapes from both: `data.animations[]`, `findAnimation(name).duration`,
// `findSkin`, `bones[]`, `physicsConstraints[]`; snapshots with bones, slots and draw order.
//
// Isomorphic: no static node:* imports.

import { StudioError } from '../shared/errors.js';
import { drawOrderHazards } from '../spine/draw-order.js';
import { compileSkeleton, setupPose, Playhead } from '../engine/index.js';
import { isKeyframeDocument, toSkeletonJson } from '../engine/keyframe-format.js';
import * as official from './spine.js';

export { RUNTIME_VERSION, MAX_SAMPLE_SECONDS, majorMinor, assertRuntimeVersion, configureSpineRuntime, spineRuntimeAvailable,
  loadRuntime, snapshot, parseSkeletonBinary } from './spine.js';
import { MAX_SAMPLE_SECONDS, assertRuntimeVersion, spineRuntimeAvailable } from './spine.js';

/** What the engine leaves out of a pose: the rule that sends a file to the add-on when it is on. */
const LIMIT = /^(path|skin-required-bone|skin-required-constraint):/;

/** The engine's compiled skeleton, dressed in the shape callers read from spine.SkeletonData. */
class EngineData {
  constructor(model) {
    this.backend = 'keyframe';
    this.model = model;
    this.name = model.name;
    this.version = model.version;
    this.animations = [...model.animations.values()].map(a => ({ name: a.name, duration: a.duration }));
    this.bones = model.bones.map(b => ({ name: b.name, length: b.length, x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX, scaleY: b.scaleY,
      shearX: b.shearX, shearY: b.shearY, parent: b.parent >= 0 ? { name: model.bones[b.parent].name } : null }));
    this.slots = model.slots.map(s => ({ name: s.name }));
    this.skins = [...model.skins.keys()].map(name => ({ name }));
    this.ikConstraints = model.ik.map(c => ({ name: c.name }));
    this.physicsConstraints = model.physics.map(c => ({ name: c.name }));
    this.transformConstraints = model.transform.map(c => ({ name: c.name }));
    // Evaluated the engine's own way (physics): close to Spine's, not number for number.
    this.approximations = model.approximations;
    this.unsupported = model.unsupported;
    this.limits = model.unsupported.filter(u => LIMIT.test(u));
  }
  findAnimation(name) { return this.animations.find(a => a.name === name) ?? null; }
  findSkin(name) { return this.model.skins.has(name) ? { name } : null; }
}

function refuseHazards(json) {
  // Some draw-order keys make the official parser run until the process is out of memory and
  // crash every pose after; the engine refuses the same files so both backends agree.
  const hazards = drawOrderHazards(json);
  if (hazards.length) {
    throw new StudioError('runtime-guard', `This file's draw-order keys cannot be played: ${hazards.map(h => `${h.where}: ${h.message}`).join('; ')}`,
      { findings: hazards });
  }
}

function compileOnEngine(json) {
  try {
    return compileSkeleton(json);
  } catch (err) {
    throw new StudioError('runtime-parse', `The studio's engine rejected this skeleton: ${err.message}`, { cause: err.message, ...(err.details ?? {}) });
  }
}

/**
 * Parse a skeleton (Spine 4.2 JSON or a Keyframe document).
 * @param {object} json
 * @param {{ atlasText?: string, scale?: number, backend?: 'auto'|'keyframe'|'spine' }} [options]
 *   backend: 'auto' (default) as described above; 'keyframe' never loads Spine code; 'spine'
 *   insists on the official runtime and refuses with spine-addon-off without it.
 */
export async function parseSkeleton(json, { atlasText, scale = 1, backend = 'auto' } = {}) {
  const source = isKeyframeDocument(json) ? toSkeletonJson(json) : json;
  if (backend === 'spine') return official.parseSkeleton(source, { atlasText, scale });
  assertRuntimeVersion(source);
  refuseHazards(source);
  const model = compileOnEngine(source);
  const data = new EngineData(model);
  const wantsOfficial = backend === 'auto' && (data.limits.length > 0 || scale !== 1);
  if (wantsOfficial && spineRuntimeAvailable()) return official.parseSkeleton(source, { atlasText, scale });
  if (scale !== 1) throw new StudioError('spine-addon-off', 'Scaling a skeleton on load needs the Spine add-on.');
  return data;
}

/**
 * The official runtime's verdict on a file, when the add-on is on.
 * @returns {Promise<{ available: false } | { available: true, opens: boolean, code?: string, message?: string }>}
 */
export async function officialVerdict(json) {
  if (!spineRuntimeAvailable()) return { available: false };
  try {
    await official.parseSkeleton(isKeyframeDocument(json) ? toSkeletonJson(json) : json);
    return { available: true, opens: true };
  } catch (err) {
    return { available: true, opens: false, code: err.code, message: err.message };
  }
}

const isEngine = data => data?.backend === 'keyframe';

/**
 * The setup pose, with no animation applied.
 * @param {any} data @param {{ skin?: string }} [options]
 */
export async function poseSetup(data, { skin } = {}) {
  if (!isEngine(data)) return official.poseSetup(data, { skin });
  return setupPose(data.model, { skin }).snapshot();
}

function requireAnimation(data, name) {
  if (!data.findAnimation(name)) {
    throw new StudioError('unknown-animation', `No animation named "${name}".`, { animation: name, available: data.animations.map(a => a.name) });
  }
}

/**
 * A poser on the engine: stateless, so `at(t)` may go in any order. It returns a posed
 * src/engine Pose (draws come from src/engine/draws.js).
 */
class EnginePoser {
  constructor(data, animationName, { skin, loop }) {
    this.backend = 'keyframe';
    this.data = data;
    this.animation = animationName;
    this.skin = skin;
    this.loop = loop;
    // A playhead carries physics forward between instants asked in order (frames, bake samples).
    this.head = new Playhead(data.model, animationName, { skin, loop });
  }
  at(time) {
    if (!(time >= 0) || time > MAX_SAMPLE_SECONDS) {
      throw new StudioError('bad-argument', `Sample times must be numbers between 0 and ${MAX_SAMPLE_SECONDS} s.`, { time, max: MAX_SAMPLE_SECONDS });
    }
    return this.head.at(time);
  }
}

/**
 * @param {object} data from parseSkeleton
 * @param {string} animationName
 * @param {{ fps?: number, skin?: string, loop?: boolean }} [options]
 */
export async function createPoser(data, animationName, { fps = 60, skin, loop = false } = {}) {
  if (!isEngine(data)) return official.createPoser(data, animationName, { fps, skin, loop });
  requireAnimation(data, animationName);
  if (!(fps > 0)) throw new StudioError('bad-argument', 'fps must be a positive number.', { fps });
  if (skin && !data.findSkin(skin)) throw new StudioError('unknown-skin', `No skin named "${skin}".`, { skin });
  return new EnginePoser(data, animationName, { skin, loop });
}

/**
 * Sample one animation at the given times.
 * @returns {Promise<Array<{ time: number, bones: any[], slots: any[], drawOrder: string[] }>>} in the order of `times`
 */
export async function sampleAnimation(data, animationName, times, options = {}) {
  if (!isEngine(data)) return official.sampleAnimation(data, animationName, times, options);
  const poser = await createPoser(data, animationName, options);
  for (const time of times) {
    if (!(time >= 0)) throw new StudioError('bad-argument', 'Sample times must be numbers >= 0.', { time });
    if (time > MAX_SAMPLE_SECONDS) throw new StudioError('bad-argument', `Sample times are limited to ${MAX_SAMPLE_SECONDS} s.`, { time, max: MAX_SAMPLE_SECONDS });
  }
  return times.map(time => ({ time, ...poser.at(time).snapshot() }));
}

/** A plain line for a tool's answer when the engine left something out of the pose. */
export function limitsNote(data) {
  if (!isEngine(data) || !data.limits.length) return null;
  return `The studio's engine posed this without ${data.limits.join(', ')} (not evaluated yet). With the Spine add-on on, the official runtime plays them.`;
}
