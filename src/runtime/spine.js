// The official spine-ts 4.2 runtime: the Spine add-on's backend (src/runtime/index.js picks it).
//
// The runtime is NOT part of this repository (Spine Runtimes License: every user of a product
// that integrates it needs their own Spine Editor license). It is here only when the owner
// enabled the Spine add-on, which downloads Esoteric Software's own package into the user's app
// data (src/core/spine-addon.js) and tells this module where it is (configureSpineRuntime).
//
// Node: the player bundle is evaluated in a bare vm context; it exposes the whole spine-core
// API and needs no DOM. Browser: the page loads the bundle as a script only when the add-on is
// on, and this module uses its `spine` global.
//
// Isomorphic: no static node:* imports. The Node path imports them dynamically.

import { StudioError } from '../shared/errors.js';
import { drawOrderHazards } from '../spine/draw-order.js';

export const RUNTIME_VERSION = '4.2';
/** Longest instant a sample may ask for: ten minutes of physics at 60 fps is 36,000 steps. */
export const MAX_SAMPLE_SECONDS = 600;

/** @type {() => (string | null)} where the add-on's spine-player.min.js is, or null when it is off */
let locate = () => null;
let cached = null;

/**
 * Tell the backend where the Spine add-on keeps the official runtime. `locate` is asked again on
 * every load until it answers, so enabling the add-on needs no restart.
 * @param {{ locate?: () => (string | null) }} options
 */
export function configureSpineRuntime({ locate: next } = {}) {
  locate = typeof next === 'function' ? next : () => null;
  cached = null;
}

/** Is the official runtime here (the page loaded it, or the add-on is installed)? */
export function spineRuntimeAvailable() {
  if (globalThis.spine) return true;
  try { return !!locate(); } catch { return false; }
}

/** Load (once) and return the spine namespace; refuses with spine-addon-off when it is not here. */
export function loadRuntime() {
  if (cached) return cached;
  if (globalThis.spine) return (cached = Promise.resolve(globalThis.spine));
  let file = null;
  try { file = locate(); } catch { file = null; }
  if (!file) {
    return Promise.reject(new StudioError('spine-addon-off',
      'This needs the official Spine runtime, which comes with the Spine add-on. The add-on is off: enable it in Settings (it needs your own Spine license).'));
  }
  cached = loadInNode(file);
  cached.catch(() => { cached = null; });
  return cached;
}

async function loadInNode(file) {
  const [{ readFileSync }, vm] = await Promise.all([import('node:fs'), import('node:vm')]);
  const source = readFileSync(file, 'utf8');
  // Only what the bundle touches while defining itself. No timers, no I/O, no process.
  const context = {
    console, Math, Date, JSON, Array, Object, Map, Set, WeakMap, Error, TypeError, RangeError,
    String, Number, Boolean, Symbol, Promise, Reflect, Proxy,
    Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array,
    Uint32Array, Uint8ClampedArray, ArrayBuffer, DataView,
  };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source + '\n;globalThis.spine = spine;', context, { filename: 'spine-player.min.js' });
  if (!context.spine || typeof context.spine.SkeletonJson !== 'function') {
    throw new StudioError('runtime-load', 'The Spine add-on\'s runtime did not expose the spine API. Turn the add-on off and on again in Settings to download it afresh.');
  }
  return context.spine;
}

/** "4.2.43" -> "4.2"; null when absent or malformed. */
export function majorMinor(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version ?? ''));
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Refuse, by name, a skeleton exported for another runtime line. */
export function assertRuntimeVersion(json) {
  const exported = json?.skeleton?.spine;
  const line = majorMinor(exported);
  if (line !== RUNTIME_VERSION) {
    throw new StudioError('runtime-version',
      `This skeleton was exported for Spine ${exported ?? '(no version)'}; the studio runs the ${RUNTIME_VERSION} runtime. Re-export it from Spine ${RUNTIME_VERSION}.`,
      { exported: exported ?? null, runtime: RUNTIME_VERSION });
  }
}

// Builds attachments without textures: enough for structure, poses and world vertices
// of untrimmed regions. Pass an atlas to parseSkeleton when trim offsets matter.
//
// Every region and mesh gets a neutral 1x1 untrimmed region. SkeletonJson skips
// updateRegion() when a region is missing, but SkeletonBinary calls it unconditionally
// and throws "Region not set." (found by the binary port). In Spine's offset formula a
// 1x1 untrimmed region scales to the attachment's own width and height, so world
// vertices come out exactly as an untrimmed atlas region would give them.
function textureFreeLoader(spine) {
  const neutralRegion = () => {
    const region = new spine.TextureRegion();
    region.u = 0; region.v = 0; region.u2 = 1; region.v2 = 1;
    region.width = 1; region.height = 1; region.originalWidth = 1; region.originalHeight = 1;
    region.offsetX = 0; region.offsetY = 0; region.degrees = 0;
    return region;
  };
  const withRegion = attachment => { attachment.region = neutralRegion(); return attachment; };
  return {
    newRegionAttachment: (skin, name, path) => withRegion(new spine.RegionAttachment(name, path)),
    newMeshAttachment: (skin, name, path) => withRegion(new spine.MeshAttachment(name, path)),
    newBoundingBoxAttachment: (skin, name) => new spine.BoundingBoxAttachment(name),
    newPathAttachment: (skin, name) => new spine.PathAttachment(name),
    newPointAttachment: (skin, name) => new spine.PointAttachment(name),
    newClippingAttachment: (skin, name) => new spine.ClippingAttachment(name),
  };
}

// The atlas parser wants a texture object per page; poses never sample it.
const STUB_TEXTURE = Object.freeze({
  setFilters() {}, setWraps() {}, dispose() {}, getImage: () => null,
});

/**
 * Parse a skeleton JSON object with the official parser.
 * @param {object} json   parsed skeleton JSON
 * @param {{ atlasText?: string, scale?: number }} [options]
 * @returns {Promise<object>} spine.SkeletonData
 */
export async function parseSkeleton(json, { atlasText, scale = 1 } = {}) {
  assertRuntimeVersion(json);
  // Some draw-order keys make the official parser run until the process is out of memory
  // (unsorted offsets, measured on 4.2.119); others parse and then crash every pose. They are
  // refused here, before the parser sees them: broken input must fail one call, not the server.
  const hazards = drawOrderHazards(json);
  if (hazards.length) {
    throw new StudioError('runtime-guard', `The official runtime cannot survive this file: ${hazards.map(h => `${h.where}: ${h.message}`).join('; ')}`,
      { findings: hazards });
  }
  const spine = await loadRuntime();
  let loader;
  if (atlasText !== undefined) {
    const atlas = new spine.TextureAtlas(atlasText);
    for (const page of atlas.pages) page.setTexture(STUB_TEXTURE);
    loader = new spine.AtlasAttachmentLoader(atlas);
  } else {
    loader = textureFreeLoader(spine);
  }
  const reader = new spine.SkeletonJson(loader);
  reader.scale = scale;
  try {
    return Object.assign(reader.readSkeletonData(json), { backend: 'spine', limits: [] });
  } catch (err) {
    throw new StudioError('runtime-parse', `The official spine-ts ${RUNTIME_VERSION} parser rejected this skeleton: ${err.message}`,
      { cause: err.message });
  }
}

/**
 * Parse a binary .skel export with the official reader.
 * @param {Uint8Array} bytes
 * @returns {Promise<object>} spine.SkeletonData
 */
export async function parseSkeletonBinary(bytes, { scale = 1 } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new StudioError('bad-argument', 'Binary skeleton must be a Uint8Array.');
  const spine = await loadRuntime();
  const reader = new spine.SkeletonBinary(textureFreeLoader(spine));
  reader.scale = scale;
  let data;
  try {
    data = reader.readSkeletonData(bytes);
  } catch (err) {
    throw new StudioError('runtime-parse', `The official spine-ts ${RUNTIME_VERSION} binary reader rejected this file: ${err.message}`,
      { cause: err.message });
  }
  if (majorMinor(data.version) !== RUNTIME_VERSION) {
    throw new StudioError('runtime-version', `This binary was exported for Spine ${data.version}; the studio runs the ${RUNTIME_VERSION} runtime.`,
      { exported: data.version, runtime: RUNTIME_VERSION });
  }
  return Object.assign(data, { backend: 'spine', limits: [] });
}

/**
 * The setup pose, with no animation applied: what the rig looks like in the editor.
 * @param {object} data spine.SkeletonData
 * @param {{ skin?: string }} [options]
 */
export async function poseSetup(data, { skin } = {}) {
  const spine = await loadRuntime();
  const skeleton = new spine.Skeleton(data);
  if (skin) {
    if (!data.findSkin(skin)) throw new StudioError('unknown-skin', `No skin named "${skin}".`, { skin });
    skeleton.setSkinByName(skin);
  }
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform(spine.Physics.reset);
  return snapshot(skeleton);
}

/**
 * Snapshot of a posed skeleton: plain data, safe to serialize.
 * Per bone: the keyed local transform (x, y, rotation, ...), the applied local transform
 * after constraints (`applied`, what a bake writes as keys), and the world transform.
 */
export function snapshot(skeleton) {
  return {
    bones: skeleton.bones.map(b => {
      // IK and physics write the world transform; this derives the local values from it.
      b.updateAppliedTransform();
      return {
        name: b.data.name,
        x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX, scaleY: b.scaleY,
        shearX: b.shearX, shearY: b.shearY,
        applied: { x: b.ax, y: b.ay, rotation: b.arotation, scaleX: b.ascaleX, scaleY: b.ascaleY,
          shearX: b.ashearX, shearY: b.ashearY },
        worldX: b.worldX, worldY: b.worldY,
        // The world matrix: world = [a b; c d] * local + (worldX, worldY).
        matrix: { a: b.a, b: b.b, c: b.c, d: b.d },
        worldRotation: b.getWorldRotationX(), worldScaleX: b.getWorldScaleX(), worldScaleY: b.getWorldScaleY(),
        active: b.active,
      };
    }),
    slots: skeleton.slots.map(s => ({
      name: s.data.name,
      bone: s.bone.data.name,
      attachment: s.getAttachment()?.name ?? null,
      color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
    })),
    drawOrder: skeleton.drawOrder.map(s => s.data.name),
  };
}

/**
 * A live skeleton walked forward through one animation, engine-exact.
 *
 * Two clocks. The animation is applied statelessly at exactly each requested time, so
 * keys land on their authored values. Physics is the only stateful part of a pose: it is
 * stepped on a fixed 1/fps grid from t=0, and a time between grid points shows the
 * animation at that time with the physics state of the last grid point (Physics.pose).
 * The pose at an instant therefore never depends on which other instants were visited.
 *
 * Time only moves forward: `at(t)` with t earlier than the last grid point refuses.
 * Use a new poser to go back.
 */
export class Poser {
  /** Use createPoser; the constructor assumes validated arguments. */
  constructor(spine, data, animation, { fps, skin, loop }) {
    this.spine = spine;
    this.animation = animation;
    this.fps = fps;
    this.loop = loop;
    this.skeleton = new spine.Skeleton(data);
    if (skin) this.skeleton.setSkinByName(skin);
    this.skeleton.setToSetupPose();
    this.frame = 0;
    this.applyAt(0);
    this.skeleton.time = 0;
    this.skeleton.updateWorldTransform(spine.Physics.reset);
  }

  // Key times are stored as float32; applying at the float32 time lands exactly on them.
  applyAt(time) {
    const t = Math.fround(time);
    this.animation.apply(this.skeleton, t, t, this.loop, null, 1, this.spine.MixBlend.setup, this.spine.MixDirection.mixIn);
  }

  /** Pose the skeleton at `time` (seconds) and return the live spine.Skeleton. */
  at(time) {
    const EPS = 1e-9;
    if (!(time >= 0) || time > MAX_SAMPLE_SECONDS) {
      throw new StudioError('bad-argument', `Sample times must be numbers between 0 and ${MAX_SAMPLE_SECONDS} s.`, { time, max: MAX_SAMPLE_SECONDS });
    }
    if (time + EPS < this.frame / this.fps) {
      throw new StudioError('bad-argument', 'A poser only moves forward in time.', { time, current: this.frame / this.fps });
    }
    const { skeleton, fps, spine } = this;
    while ((this.frame + 1) / fps <= time + EPS) {
      this.frame++;
      this.applyAt(this.frame / fps);
      skeleton.time = this.frame / fps;
      skeleton.updateWorldTransform(spine.Physics.update);
    }
    if (Math.abs(time - this.frame / fps) > EPS) {
      this.applyAt(time);
      skeleton.updateWorldTransform(spine.Physics.pose);
    } else {
      // Re-apply the grid pose: an earlier off-grid visit may have left another pose behind.
      this.applyAt(this.frame / fps);
      skeleton.updateWorldTransform(spine.Physics.pose);
    }
    return skeleton;
  }
}

/**
 * @param {object} data spine.SkeletonData from parseSkeleton
 * @param {string} animationName
 * @param {{ fps?: number, skin?: string, loop?: boolean }} [options]
 */
export async function createPoser(data, animationName, { fps = 60, skin, loop = false } = {}) {
  const spine = await loadRuntime();
  const animation = data.findAnimation(animationName);
  if (!animation) {
    throw new StudioError('unknown-animation', `No animation named "${animationName}".`,
      { animation: animationName, available: data.animations.map(a => a.name) });
  }
  if (!(fps > 0)) throw new StudioError('bad-argument', 'fps must be a positive number.', { fps });
  if (skin && !data.findSkin(skin)) throw new StudioError('unknown-skin', `No skin named "${skin}".`, { skin });
  return new Poser(spine, data, animation, { fps, skin, loop });
}

/**
 * Sample one animation at the given times, engine-exact (see Poser).
 *
 * @param {object} data     spine.SkeletonData from parseSkeleton
 * @param {string} animationName
 * @param {number[]} times  seconds; any order, duplicates allowed
 * @param {{ fps?: number, skin?: string, loop?: boolean }} [options]
 * @returns {Promise<Array<{ time: number } & ReturnType<typeof snapshot>>>} in the order of `times`
 */
export async function sampleAnimation(data, animationName, times, options = {}) {
  const poser = await createPoser(data, animationName, options);
  for (const time of times) {
    if (!(time >= 0)) throw new StudioError('bad-argument', 'Sample times must be numbers >= 0.', { time });
    if (time > MAX_SAMPLE_SECONDS) {
      throw new StudioError('bad-argument', `Sample times are limited to ${MAX_SAMPLE_SECONDS} s.`, { time, max: MAX_SAMPLE_SECONDS });
    }
  }
  const order = times.map((time, index) => ({ time, index })).sort((a, b) => a.time - b.time);
  const results = new Array(times.length);
  for (const { time, index } of order) results[index] = { time, ...snapshot(poser.at(time)) };
  return results;
}
