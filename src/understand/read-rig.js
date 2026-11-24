// "What is in this rig": bone tree and setup pose, slots with their attachment type and
// mesh weights, constraints with their settings, an animation summary. The answer to an
// agent's first question before it writes motion on a finished rig.
// Ported from legacy inspect.js `rig()` and `attachmentsIndex()`.
//
// World transforms are not computed here. Legacy walked the bone tree with its own
// trigonometry (`worldOf`), which ignored every constraint and needed patch after patch
// for inherit modes, shear and reflection. Now the official runtime poses the setup and
// the reader takes that snapshot as an argument (ADR-2):
//
//   readRig(sk, { setup: await poseSetup(await parseSkeleton(sk)) })   // or:
//   await readRigOnRuntime(sk)
//
// Why injected rather than async throughout: the reader stays synchronous and pure, so it
// reads files the runtime refuses (another Spine version, a broken path) and its tests
// need no runtime. The bone tree is never hostage to the runtime: `readRigOnRuntime` falls
// back to the tree without world transforms and says why.

import { StudioError } from '../shared/errors.js';
import { skinsOf } from '../spine/check.js';
import { parseSkeleton, poseSetup } from '../runtime/index.js';
import { rigConventions } from './conventions.js';
import {
  round3, isNumber, issueCollector, animationDuration, frameGridReport, channelsOf, round6, runtimeRefusal,
} from './read-timelines.js';

// ── mesh weights: which bones does this art actually follow ──
// Legacy finding F (2026-08-10): the slot type said "mesh" but not
// which bones the mesh is weighted to. The agent writing motion on a chain could not know
// which art follows it, assumed "everything is weighted" and wrote 28 clips. The answer was
// in the file; it was not being read.
// A weighted vertex list is packed: [n, (boneIndex, x, y, weight) x n, ...]. An unweighted
// one holds plain positions: two numbers per vertex. Vertex data is not returned; the
// question is "does the motion reach this art", and the answer is bone names.

/**
 * @param {object} attachment mesh or path attachment JSON
 * @param {string[]} boneNames skeleton bone names by index
 * @returns {null | { weighted: false, vertexCount: number }
 *   | { weighted: true, vertexCount: number, bones: { bone: string, vertices: number }[] }}
 */
export function meshWeights(attachment, boneNames) {
  const v = attachment?.vertices;
  if (!Array.isArray(v) || !v.length) return null;
  // Meshes count vertices by their uvs; paths say vertexCount. Legacy only knew the uvs
  // rule, so a path never reported its weights although paths were meant to be covered.
  const plainCount = Array.isArray(attachment.uvs) ? attachment.uvs.length / 2
    : isNumber(attachment.vertexCount) ? attachment.vertexCount : null;
  if (plainCount === null) return null;
  if (v.length === plainCount * 2) return { weighted: false, vertexCount: plainCount };
  const counts = new Map();
  let i = 0;
  let vertexCount = 0;
  while (i < v.length) {
    const n = v[i++];
    if (!(n > 0) || i + n * 4 > v.length) return null; // a layout we do not know
    for (let j = 0; j < n; j++) {
      const boneIndex = v[i];
      i += 4;
      const bone = boneNames[boneIndex] ?? `#${boneIndex}`;
      counts.set(bone, (counts.get(bone) ?? 0) + 1);
    }
    vertexCount++;
  }
  return {
    weighted: true, vertexCount,
    bones: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([bone, vertices]) => ({ bone, vertices })),
  };
}

const WEIGHTED_TYPES = new Set(['mesh', 'linkedmesh', 'path']);

/**
 * Every attachment of every skin, by slot: what a slot can show and of which type.
 * @returns {Record<string, { name: string, skin: string, type: string, width?: number,
 *   height?: number, path?: string, weights?: ReturnType<typeof meshWeights> }[]>}
 */
export function attachmentsIndex(sk) {
  /** @type {Record<string, any[]>} */
  const index = {};
  const boneNames = (sk?.bones ?? []).map(b => b?.name);
  for (const skin of skinsOf(sk ?? {})) {
    for (const [slot, attachments] of Object.entries(skin?.attachments ?? {})) {
      for (const [name, a] of Object.entries(attachments ?? {})) {
        const type = a?.type ?? 'region';
        const weights = WEIGHTED_TYPES.has(type) ? meshWeights(a, boneNames) : null;
        (index[slot] ??= []).push({
          name, skin: skin.name, type,
          ...(isNumber(a?.width) ? { width: a.width } : {}),
          ...(isNumber(a?.height) ? { height: a.height } : {}),
          ...(a?.path ? { path: a.path } : {}),
          ...(weights ? { weights } : {}),
        });
      }
    }
  }
  return index;
}

// ── constraint settings ──
// The agent needs a constraint's settings, not only its existence. Legacy wrote only name, bones and target: "there is an IK"
// without whether its mix is 0 or 1. The rig's author builds the rig, but writing motion without
// its settings is working blind: a target animation for an IK with mix 0 does nothing, hard
// keys on a physics bone choke the sway.
export const CONSTRAINT_SETTINGS = Object.freeze({
  ik: ['mix', 'softness', 'bendPositive', 'compress', 'stretch', 'uniform'],
  transform: ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY',
    'rotation', 'x', 'y', 'scaleX', 'scaleY', 'shearY', 'local', 'relative'],
  path: ['positionMode', 'spacingMode', 'rotateMode', 'rotation', 'position', 'spacing', 'mixRotate', 'mixX', 'mixY'],
  // Spine JSON writes the simulation rate as `fps`, not `step` (legacy review 2026-08-07:
  // the file said fps 30 while the report said "step default 1/60", a plainly wrong answer).
  physics: ['x', 'y', 'rotate', 'scaleX', 'shearX', 'limit', 'fps', 'step', 'inertia',
    'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'],
});

// A field absent from the file is not "unreadable", it is Spine's default. Saying which
// fields are defaulted keeps "could not read" and "default" apart.
export const CONSTRAINT_DEFAULTS = Object.freeze({
  ik: { mix: 1, softness: 0, bendPositive: true, compress: false, stretch: false, uniform: false },
  transform: { mixRotate: 1, mixX: 1, mixY: 1, mixScaleX: 1, mixScaleY: 1, mixShearY: 1,
    rotation: 0, x: 0, y: 0, scaleX: 0, scaleY: 0, shearY: 0, local: false, relative: false },
  path: { positionMode: 'percent', spacingMode: 'length', rotateMode: 'tangent',
    rotation: 0, position: 0, spacing: 0, mixRotate: 1, mixX: 1, mixY: 1 },
  physics: { x: 0, y: 0, rotate: 0, scaleX: 0, shearX: 0, limit: 5000, fps: 60,
    inertia: 1, strength: 100, damping: 1, mass: 1, wind: 0, gravity: 0, mix: 1 },
});

export const IK_SILENT_NOTE = 'mix is 0: this IK has no effect, so animating its target does nothing.';
export const PHYSICS_NOTE = 'Physics simulates this bone; hard keys on it choke the sway. Measure the result by sampling on the runtime.';

function readConstraints(sk) {
  const out = [];
  for (const type of ['ik', 'transform', 'path', 'physics']) {
    for (const c of Array.isArray(sk[type]) ? sk[type] : []) {
      const settings = {};
      const defaulted = [];
      for (const field of CONSTRAINT_SETTINGS[type]) {
        if (c?.[field] !== undefined) settings[field] = c[field];
        else if (CONSTRAINT_DEFAULTS[type][field] !== undefined) defaulted.push(field);
      }
      out.push({
        type, name: c?.name,
        bones: [].concat(c?.bones ?? c?.bone ?? []),
        target: c?.target ?? null,
        ...(c?.order !== undefined ? { order: c.order } : {}),
        ...(c?.skinRequired ? { skinRequired: true } : {}),
        settings,
        ...(defaulted.length ? { defaulted } : {}),
        // Where an agent goes wrong most often: a constraint with mix 0 is silent.
        ...(type === 'ik' && c?.mix === 0 ? { note: IK_SILENT_NOTE } : {}),
        ...(type === 'physics' ? { note: PHYSICS_NOTE } : {}),
      });
    }
  }
  return out;
}

// The world transform of one bone from a runtime snapshot. The runtime reports world scale
// as a magnitude; a mirrored bone (negative determinant, a side copied with scaleX -1)
// shows up only in the matrix, so it is flagged instead of lost.
function worldOf(snapshotBone) {
  const { a, b, c, d } = snapshotBone.matrix;
  return {
    x: round3(snapshotBone.worldX), y: round3(snapshotBone.worldY),
    rotation: round3(snapshotBone.worldRotation),
    scaleX: round3(snapshotBone.worldScaleX), scaleY: round3(snapshotBone.worldScaleY),
    ...(a * d - b * c < 0 ? { mirrored: true } : {}),
  };
}

/**
 * @param {object} sk parsed skeleton JSON
 * @param {{ setup?: object, includeLength?: boolean, fps?: number }} [options]
 *   setup: a runtime snapshot of the setup pose (`poseSetup`); adds `world` per bone.
 *   fps: frame rate for the animation summary's off-grid count (default 30).
 */
export function readRig(sk, { setup, includeLength = true, fps } = {}) {
  if (!sk || typeof sk !== 'object' || !Array.isArray(sk.bones)) {
    throw new StudioError('bad-skeleton', 'This is not a skeleton: it has no bones array.');
  }
  let worldByName = null;
  if (setup !== undefined) {
    if (!Array.isArray(setup?.bones)) throw new StudioError('bad-argument', 'setup must be a runtime snapshot with a bones array.');
    worldByName = new Map(setup.bones.map(b => [b.name, b]));
    const missing = sk.bones.map(b => b?.name).filter(name => !worldByName.has(name));
    if (missing.length) {
      throw new StudioError('setup-mismatch', 'The setup snapshot does not belong to this skeleton.', { missing });
    }
  }

  const children = {};
  for (const b of sk.bones) if (b?.parent) (children[b.parent] ??= []).push(b.name);
  const slotsByBone = {};
  for (const s of sk.slots ?? []) (slotsByBone[s?.bone] ??= []).push(s?.name);

  const bones = sk.bones.map(b => {
    const inherit = b?.inherit ?? b?.transform ?? 'normal'; // 4.x name / 3.x name
    return {
      name: b?.name, parent: b?.parent ?? null,
      setup: {
        x: round3(b?.x ?? 0), y: round3(b?.y ?? 0), rotation: round3(b?.rotation ?? 0),
        scaleX: round3(b?.scaleX ?? 1), scaleY: round3(b?.scaleY ?? 1),
        // Shear only when present, so an unsheared rig reads exactly as before.
        ...(b?.shearX || b?.shearY ? { shearX: round3(b.shearX ?? 0), shearY: round3(b.shearY ?? 0) } : {}),
      },
      ...(inherit !== 'normal' ? { inherit } : {}),
      ...(worldByName ? { world: worldOf(worldByName.get(b.name)) } : {}),
      children: children[b?.name] ?? [],
      slots: slotsByBone[b?.name] ?? [],
      ...(includeLength && isNumber(b?.length) ? { length: b.length } : {}),
    };
  });

  const index = attachmentsIndex(sk);
  const slots = (sk.slots ?? []).map(s => {
    const list = index[s?.name] ?? [];
    const current = list.find(a => a.name === s?.attachment) ?? null;
    // Often no attachment is shown at setup. If the slot has exactly one, that one is
    // measured: "which bones does this art follow" must not go unanswered.
    const measured = current ?? (list.length === 1 ? list[0] : null);
    const w = measured?.weights;
    return {
      name: s?.name, bone: s?.bone,
      setupAttachment: s?.attachment ?? null,
      ...(s?.color && s.color.toLowerCase() !== 'ffffffff' ? { setupColor: s.color } : {}),
      ...(s?.blend && s.blend !== 'normal' ? { blend: s.blend } : {}),
      type: current ? current.type : (list[0]?.type ?? null),
      ...(current && isNumber(current.width) ? { width: current.width, height: current.height } : {}),
      // "Does the motion I write on this bone reach this art" (legacy finding F).
      ...(w ? { weights: w.weighted
        ? { weighted: true, vertexCount: w.vertexCount, bones: w.bones, ...(current ? {} : { attachment: measured.name }) }
        : { weighted: false, vertexCount: w.vertexCount, followsBone: s.bone } } : {}),
      ...(list.length > 1 ? { attachments: list.map(a => a.name) } : {}),
    };
  });

  const constraints = readConstraints(sk);

  // The animation summary may not hold the bone tree hostage (legacy FINDING-001): if an
  // animation cannot be read, its row says so and the tree is returned anyway.
  const issues = issueCollector();
  const animations = Object.entries(sk.animations ?? {}).map(([name, anim]) => {
    try {
      return {
        name, duration: round6(animationDuration(anim, issues)),
        offGridKeys: frameGridReport(anim, fps, issues).offGridKeys,
        boneCount: Object.keys(anim.bones ?? {}).length,
        slotCount: Object.keys(anim.slots ?? {}).length,
        channels: channelsOf(anim, issues),
      };
    } catch (err) {
      issues.add('animation-unreadable', `animations/${name}`, `This animation could not be read: ${err.message}`, { animation: name, cause: err.message });
      return {
        name, error: err.message,
        boneCount: Object.keys(anim?.bones ?? {}).length,
        slotCount: Object.keys(anim?.slots ?? {}).length,
      };
    }
  });

  return {
    skeleton: sk.skeleton ?? {},
    counts: { bones: bones.length, slots: slots.length, constraints: constraints.length, animations: animations.length },
    bones, slots, constraints, animations,
    // The order of the slots array is the setup draw order, back to front. Draw-order keys
    // inside an animation are always offsets against it.
    setupDrawOrder: slots.map(s => s.name),
    skins: skinsOf(sk).map(s => s?.name),
    ...conventionsOf(sk),
    ...(issues.list.length ? {
      issues: issues.list,
      issuesNote: 'These channels could not be read and were skipped. The bone tree, slots and setup pose are unaffected.',
    } : {}),
  };
}

// The rig's unwritten rules, mined from its clips (src/understand/conventions.js): when one
// slot switches to an attachment, which other slots the owner's clips always switch with it.
function conventionsOf(sk) {
  let list;
  try { list = rigConventions(sk); } catch { return {}; }
  if (!list.length) return {};
  return {
    conventions: list.map(c => ({
      when: { slot: c.slot, attachment: c.attachment },
      alsoSets: Object.fromEntries(c.alsoSets.map(x => [x.slot, x.attachment])),
      ...(c.inBetweens.length ? { inBetweens: c.inBetweens } : {}),
      seenIn: c.clips,
    })),
    conventionsNote: 'Seen in the owner\'s own clips: whenever `when` switches, the slots in `alsoSets` switch with it in the same instant (null = hidden). Do the same in a new clip (a blink that shows the closed lid also hides the eye and pupil), and switch them back together. `inBetweens` are attachments the owner\'s clips pass through next to `when` (a half-closed lid): a frame or two of one makes the switch read softer (slow in and out). Before writing a clip, read a similar existing clip with describe_animation.',
  };
}

/**
 * readRig with world transforms from the official runtime's setup pose (constraints
 * applied, as the editor shows it). If the runtime cannot pose this file, the rig is
 * returned without `world` and `worldUnavailable` says why.
 * @param {object} sk
 * @param {{ includeLength?: boolean, fps?: number, skin?: string }} [options]
 */
export async function readRigOnRuntime(sk, options = {}) {
  const plain = readRig(sk, options); // validates, and is the fallback
  let setup;
  const unavailable = await runtimeRefusal(sk, async () => {
    setup = await poseSetup(await parseSkeleton(sk), { skin: options.skin });
  });
  if (unavailable) return { ...plain, worldUnavailable: unavailable };
  return readRig(sk, { ...options, setup });
}
