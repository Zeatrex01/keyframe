// IK constraints for the Keyframe engine: one bone aims at a target, two bones bend to reach
// it. Written from the geometry (the law of cosines), not from any runtime's code. It covers
// mix, bend direction, stretch and compress on the one-bone form and stretch on the two-bone
// form, for bones with uniform scale. Softness and non-uniform scale on an IK chain are listed
// as approximations by the model. Transform, path and physics constraints are not evaluated:
// the model lists them, and `bake_animation` with the Spine add-on turns them into plain keys.
//
// Pure and isomorphic.

import { compileChannel } from './curve.js';
import { StudioError } from '../shared/errors.js';

const DEG = Math.PI / 180;
const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const wrap = a => { a %= 360; return a > 180 ? a - 360 : a < -180 ? a + 360 : a; };

/** Compile the skeleton's `ik` array. */
export function compileIk(json, boneIndex, approximations) {
  return (json.ik ?? []).map((c, i) => {
    const bones = (c.bones ?? []).map(name => {
      const index = boneIndex.get(name);
      if (index === undefined) throw new StudioError('bad-skeleton', `IK "${c.name}" names bone "${name}", which does not exist.`, { constraint: c.name, bone: name });
      return index;
    });
    const target = boneIndex.get(c.target);
    if (target === undefined) throw new StudioError('bad-skeleton', `IK "${c.name}" names target "${c.target}", which does not exist.`, { constraint: c.name });
    if (bones.length < 1 || bones.length > 2) throw new StudioError('bad-skeleton', `IK "${c.name}" must have one or two bones.`, { constraint: c.name });
    if (isNumber(c.softness) && c.softness > 0) approximations.add(`ik-softness:${c.name}`);
    return { name: c.name, index: i, order: isNumber(c.order) ? c.order : i, bones, target,
      mix: isNumber(c.mix) ? c.mix : 1, softness: isNumber(c.softness) ? c.softness : 0,
      bendDirection: c.bendPositive === false ? -1 : 1, compress: !!c.compress, stretch: !!c.stretch, uniform: !!c.uniform };
  });
}

/** Compile an animation's `ik` section into timelines. */
export function compileIkTimelines(section, ikByName, where) {
  const out = [];
  for (const [name, keys] of Object.entries(section ?? {})) {
    const constraint = ikByName.get(name);
    if (!constraint) throw new StudioError('bad-animation', `${where}: IK "${name}" does not exist.`, { constraint: name });
    if (!Array.isArray(keys) || !keys.length) continue;
    const curveOf = (k, f) => (k.curve === 'stepped' ? 'stepped' : Array.isArray(k.curve) && k.curve.length >= f * 4 + 4 ? { absolute: k.curve.slice(f * 4, f * 4 + 4) } : undefined);
    out.push({
      kind: 'ik', constraint: constraint.index,
      times: Float32Array.from(keys.map(k => (isNumber(k.time) ? k.time : 0))),
      mix: compileChannel(keys.map(k => ({ time: k.time, value: isNumber(k.mix) ? k.mix : 1, curve: curveOf(k, 0) })), 1, `${where}/ik/${name}`),
      softness: compileChannel(keys.map(k => ({ time: k.time, value: isNumber(k.softness) ? k.softness : 0, curve: curveOf(k, 1) })), 0, `${where}/ik/${name}`),
      bend: keys.map(k => (k.bendPositive === false ? -1 : 1)),
      compress: keys.map(k => !!k.compress),
      stretch: keys.map(k => !!k.stretch),
    });
  }
  return out;
}

/** Bones below `root` (not including it), in bone order. */
function descendants(pose, root) {
  const inside = new Set([root]);
  const out = [];
  for (const bone of pose.bones) {
    if (bone.data.parent >= 0 && inside.has(bone.data.parent)) { inside.add(bone.data.index); out.push(bone); }
  }
  return out;
}

const localOf = bone => ({ x: bone.ax, y: bone.ay, rotation: bone.arotation, scaleX: bone.ascaleX, scaleY: bone.ascaleY, shearX: bone.ashearX, shearY: bone.ashearY });

/** A world point in the space of a bone's parent. */
function toParentSpace(pose, bone, wx, wy) {
  const p = bone.data.parent >= 0 ? pose.bones[bone.data.parent] : null;
  if (!p) return [wx - pose.x, wy - pose.y];
  const det = p.a * p.d - p.b * p.c;
  if (Math.abs(det) < 1e-9) return [0, 0];
  const dx = wx - p.worldX, dy = wy - p.worldY;
  return [(dx * p.d - dy * p.b) / det, (dy * p.a - dx * p.c) / det];
}

function solveOne(pose, bone, tx, ty, c) {
  const local = localOf(bone);
  const [lx, ly] = toParentSpace(pose, bone, tx, ty);
  const dx = lx - local.x, dy = ly - local.y;
  let aim = Math.atan2(dy, dx) / DEG - local.shearX;
  if (local.scaleX < 0) aim += 180;
  const delta = wrap(aim - local.rotation);
  let scaleX = local.scaleX, scaleY = local.scaleY;
  const reach = bone.data.length * scaleX;
  if ((c.stretch || c.compress) && reach > 1e-4) {
    const dist = Math.hypot(dx, dy);
    if ((c.compress && dist < reach) || (c.stretch && dist > reach)) {
      const s = (dist / reach - 1) * c.mix + 1;
      scaleX *= s;
      if (c.uniform) scaleY *= s;
    }
  }
  pose.updateBone(bone, { ...local, rotation: local.rotation + delta * c.mix, scaleX, scaleY });
}

function solveTwo(pose, parent, child, tx, ty, c) {
  const p = localOf(parent), k = localOf(child);
  // Lengths in the parent's parent space: the child's offset scaled by the parent, and the
  // child's own length scaled by both.
  const sp = Math.abs(p.scaleX);
  const l1 = Math.hypot(k.x * p.scaleX, k.y * p.scaleY);
  const l2 = child.data.length * Math.abs(k.scaleX) * sp;
  const [lx, ly] = toParentSpace(pose, parent, tx, ty);
  const dx = lx - p.x, dy = ly - p.y;
  const d = Math.hypot(dx, dy);
  if (l1 < 1e-4 || d < 1e-4) { solveOne(pose, parent, tx, ty, { ...c, stretch: false, compress: false }); return; }
  let scaleX = p.scaleX;
  if (l2 < 1e-4) {
    solveOne(pose, parent, tx, ty, { ...c, stretch: false, compress: false });
    pose.updateBone(child, k);
    return;
  }
  let cos = (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  if (cos > 1 && c.stretch) {
    const s = (d / (l1 + l2) - 1) * c.mix + 1;
    scaleX *= s;
    cos = 1;
  }
  cos = Math.max(-1, Math.min(1, cos));
  const bend = Math.acos(cos) * c.bendDirection;
  const reachAngle = Math.atan2(dy, dx) - Math.atan2(l2 * Math.sin(bend), l1 + l2 * Math.cos(bend));
  const offset = Math.atan2(k.y * p.scaleY, k.x * p.scaleX);
  const r1 = (reachAngle - offset) / DEG - p.shearX;
  const r2 = (bend + offset) / DEG - k.shearX;
  const d1 = wrap(r1 - p.rotation), d2 = wrap(r2 - k.rotation);
  pose.updateBone(parent, { ...p, rotation: p.rotation + d1 * c.mix, scaleX });
  pose.updateBone(child, { ...k, rotation: k.rotation + d2 * c.mix });
}

/** Apply every IK constraint in order, then refresh the bones below each solved chain. */
export function applyConstraints(pose) {
  const list = pose.model.ik ?? [];
  if (!list.length) return;
  for (const data of [...list].sort((a, b) => a.order - b.order)) {
    const c = pose.ik[data.index];
    if (!(c.mix > 0)) continue;
    const target = pose.bones[data.target];
    const first = pose.bones[data.bones[0]];
    if (data.bones.length === 1) solveOne(pose, first, target.worldX, target.worldY, c);
    else solveTwo(pose, first, pose.bones[data.bones[1]], target.worldX, target.worldY, c);
    const skip = new Set(data.bones);
    for (const bone of descendants(pose, data.bones[0])) if (!skip.has(bone.data.index)) pose.updateBone(bone, localOf(bone));
  }
}
