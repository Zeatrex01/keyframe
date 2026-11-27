// Constraints for the Keyframe engine, evaluated in one list in the skeleton's `order`:
//
//   ik         one bone aims at a target, two bones bend to reach it (the law of cosines), with
//              mix, bend direction, stretch, compress, uniform and a soft reach near full length
//   transform  bones follow a target's rotation, position, scale and shear, in world or local
//              space, absolute or relative, each part by its own mix
//   path       bones are laid along a path attachment's bezier curves: placed at a distance along
//              it (fixed or a share of its length), spaced by their lengths, a fixed step, a share
//              of the path or in proportion, turned along its tangent or toward the next bone
//   physics    a bone's origin, direction and length lag behind the motion and spring back, with
//              inertia, strength, damping, mass, wind and gravity, stepped on a fixed grid
//
// Written from the geometry and from the documented meaning of each Spine 4.2 field, not from any
// runtime's code. IK and transform constraints are exact formulas; physics is the studio's own
// simulation: it reads the same fields and moves the same way, but its numbers are not Spine's
// to the pixel (the model says so in `approximations`). Path lengths follow the format's own
// convention: a constant-speed path measures each curve as ten straight pieces; any other path
// uses the `lengths` written into the attachment and moves along each curve's parameter.
//
// Physics needs time. A pose posed once shows the constraint's resting state; the engine's
// samplers (src/engine/index.js) replay physics from 0 on the fixed grid, and the players step it
// with the real frame time. Same inputs, same numbers.
//
// Pure and isomorphic.

import { compileChannel } from './curve.js';
import { StudioError } from '../shared/errors.js';

const DEG = Math.PI / 180;
const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => (isNumber(v) ? v : d);
const wrap = a => { a %= 360; return a > 180 ? a - 360 : a < -180 ? a + 360 : a; };
const wrapRad = a => { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; };
const clamp = (v, m) => (v > m ? m : v < -m ? -m : v);

function boneOf(boneIndex, name, kind, constraint) {
  const index = boneIndex.get(name);
  if (index === undefined) throw new StudioError('bad-skeleton', `${kind} "${constraint}" names bone "${name}", which does not exist.`, { constraint, bone: name });
  return index;
}

/** Compile the skeleton's `ik` array. */
export function compileIk(json, boneIndex) {
  return (json.ik ?? []).map((c, i) => {
    const bones = (c.bones ?? []).map(name => boneOf(boneIndex, name, 'IK', c.name));
    const target = boneOf(boneIndex, c.target, 'IK', c.name);
    if (bones.length < 1 || bones.length > 2) throw new StudioError('bad-skeleton', `IK "${c.name}" must have one or two bones.`, { constraint: c.name });
    return { kind: 'ik', name: c.name, index: i, order: num(c.order, 0), bones, target,
      mix: num(c.mix, 1), softness: num(c.softness, 0),
      bendDirection: c.bendPositive === false ? -1 : 1, compress: !!c.compress, stretch: !!c.stretch, uniform: !!c.uniform };
  });
}

/** Compile the skeleton's `transform` array. Mix defaults follow Spine: mixY is mixX, mixScaleY is mixScaleX. */
export function compileTransform(json, boneIndex) {
  return (json.transform ?? []).map((c, i) => {
    const bones = (c.bones ?? []).map(name => boneOf(boneIndex, name, 'Transform constraint', c.name));
    const target = boneOf(boneIndex, c.target, 'Transform constraint', c.name);
    const mixX = num(c.mixX, 1), mixScaleX = num(c.mixScaleX, 1);
    return { kind: 'transform', name: c.name, index: i, order: num(c.order, 0), bones, target, local: !!c.local, relative: !!c.relative,
      offsetRotation: num(c.rotation, 0), offsetX: num(c.x, 0), offsetY: num(c.y, 0),
      offsetScaleX: num(c.scaleX, 0), offsetScaleY: num(c.scaleY, 0), offsetShearY: num(c.shearY, 0),
      mixRotate: num(c.mixRotate, 1), mixX, mixY: num(c.mixY, mixX), mixScaleX, mixScaleY: num(c.mixScaleY, mixScaleX), mixShearY: num(c.mixShearY, 1) };
  });
}

/** The physics parameters a timeline can key, with Spine's defaults. */
export const PHYSICS_PARAMETERS = Object.freeze({ inertia: 1, strength: 100, damping: 1, mass: 1, wind: 0, gravity: 0, mix: 1 });

/** Compile the skeleton's `physics` array. */
export function compilePhysics(json, boneIndex) {
  return (json.physics ?? []).map((c, i) => {
    const bone = boneOf(boneIndex, c.bone, 'Physics constraint', c.name);
    const fps = num(c.fps, 60);
    return { kind: 'physics', name: c.name, index: i, order: num(c.order, 0), bone,
      x: num(c.x, 0), y: num(c.y, 0), rotate: num(c.rotate, 0), scaleX: num(c.scaleX, 0), shearX: num(c.shearX, 0),
      limit: num(c.limit, 5000), step: 1 / Math.min(240, Math.max(1, fps)),
      ...Object.fromEntries(Object.entries(PHYSICS_PARAMETERS).map(([k, d]) => [k, num(c[k], d)])),
      mass: Math.max(1e-4, num(c.mass, 1)) };
  });
}

const POSITION_MODES = ['fixed', 'percent'];
const SPACING_MODES = ['length', 'fixed', 'percent', 'proportional'];
const ROTATE_MODES = ['tangent', 'chain', 'chainScale'];

/** Compile the skeleton's `path` array. `target` is a slot whose attachment is the path. */
export function compilePath(json, boneIndex, slotIndex) {
  return (json.path ?? []).map((c, i) => {
    const bones = (c.bones ?? []).map(name => boneOf(boneIndex, name, 'Path constraint', c.name));
    const target = slotIndex.get(c.target);
    if (target === undefined) throw new StudioError('bad-skeleton', `Path constraint "${c.name}" names target slot "${c.target}", which does not exist.`, { constraint: c.name, slot: c.target });
    const mode = (value, list, fallback, field) => {
      const v = value ?? fallback;
      if (!list.includes(v)) throw new StudioError('bad-skeleton', `Path constraint "${c.name}" has ${field} "${v}"; it is one of ${list.join(', ')}.`, { constraint: c.name, [field]: v });
      return v;
    };
    const mixX = num(c.mixX, 1);
    return { kind: 'path', name: c.name, index: i, order: num(c.order, 0), bones, target,
      positionMode: mode(c.positionMode, POSITION_MODES, 'percent', 'positionMode'),
      spacingMode: mode(c.spacingMode, SPACING_MODES, 'length', 'spacingMode'),
      rotateMode: mode(c.rotateMode, ROTATE_MODES, 'tangent', 'rotateMode'),
      offsetRotation: num(c.rotation, 0), position: num(c.position, 0), spacing: num(c.spacing, 0),
      mixRotate: num(c.mixRotate, 1), mixX, mixY: num(c.mixY, mixX) };
  });
}

/** Every constraint in the order the skeleton evaluates them (by `order`, then by kind as Spine lists them). */
export function constraintOrder(ik, transform, physics, path = []) {
  const all = [...ik, ...transform, ...path, ...physics];
  return all.map((c, i) => ({ c, i })).sort((a, b) => a.c.order - b.c.order || a.i - b.i).map(({ c }) => c);
}

const curveOf = (k, f) => (k.curve === 'stepped' ? 'stepped' : Array.isArray(k.curve) && k.curve.length >= f * 4 + 4 ? { absolute: k.curve.slice(f * 4, f * 4 + 4) } : undefined);
const channelOf = (keys, read, f, where) => compileChannel(keys.map(k => ({ time: k.time, value: read(k), curve: curveOf(k, f) })), 0, where);

/** Compile an animation's `ik` section into timelines. */
export function compileIkTimelines(section, ikByName, where) {
  const out = [];
  for (const [name, keys] of Object.entries(section ?? {})) {
    const constraint = ikByName.get(name);
    if (!constraint) throw new StudioError('bad-animation', `${where}: IK "${name}" does not exist.`, { constraint: name });
    if (!Array.isArray(keys) || !keys.length) continue;
    out.push({
      kind: 'ik', constraint: constraint.index,
      times: Float32Array.from(keys.map(k => num(k.time, 0))),
      mix: channelOf(keys, k => num(k.mix, 1), 0, `${where}/ik/${name}`),
      softness: channelOf(keys, k => num(k.softness, 0), 1, `${where}/ik/${name}`),
      bend: keys.map(k => (k.bendPositive === false ? -1 : 1)),
      compress: keys.map(k => !!k.compress),
      stretch: keys.map(k => !!k.stretch),
    });
  }
  return out;
}

const TRANSFORM_MIXES = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];

/** Compile an animation's `transform` section into timelines (one channel per mix, curves packed in that order). */
export function compileTransformTimelines(section, byName, where) {
  const out = [];
  for (const [name, keys] of Object.entries(section ?? {})) {
    const constraint = byName.get(name);
    if (!constraint) throw new StudioError('bad-animation', `${where}: transform constraint "${name}" does not exist.`, { constraint: name });
    if (!Array.isArray(keys) || !keys.length) continue;
    const read = {
      mixRotate: k => num(k.mixRotate, 1), mixX: k => num(k.mixX, 1), mixY: k => num(k.mixY, num(k.mixX, 1)),
      mixScaleX: k => num(k.mixScaleX, 1), mixScaleY: k => num(k.mixScaleY, num(k.mixScaleX, 1)), mixShearY: k => num(k.mixShearY, 1),
    };
    out.push({ kind: 'transform', constraint: constraint.index,
      channels: TRANSFORM_MIXES.map((m, f) => [m, channelOf(keys, read[m], f, `${where}/transform/${name}`)]) });
  }
  return out;
}

/**
 * Compile an animation's `path` section: { <constraint>: { position|spacing: [{ time, value }], mix: [{ time, mixRotate, mixX, mixY }] } }.
 */
export function compilePathTimelines(section, byName, where) {
  const out = [];
  for (const [name, channels] of Object.entries(section ?? {})) {
    const constraint = byName.get(name);
    if (!constraint) throw new StudioError('bad-animation', `${where}: path constraint "${name}" does not exist.`, { constraint: name });
    for (const [property, keys] of Object.entries(channels ?? {})) {
      if (!Array.isArray(keys) || !keys.length) continue;
      const at = `${where}/path/${name}/${property}`;
      if (property === 'position' || property === 'spacing') {
        out.push({ kind: 'path', constraint: constraint.index, channels: [[property, channelOf(keys, k => num(k.value, 0), 0, at)]] });
      } else if (property === 'mix') {
        out.push({ kind: 'path', constraint: constraint.index, channels: [
          ['mixRotate', channelOf(keys, k => num(k.mixRotate, 1), 0, at)],
          ['mixX', channelOf(keys, k => num(k.mixX, 1), 1, at)],
          ['mixY', channelOf(keys, k => num(k.mixY, num(k.mixX, 1)), 2, at)]] });
      } else {
        throw new StudioError('bad-animation', `${at}: a path timeline is position, spacing or mix.`, { property });
      }
    }
  }
  return out;
}

/**
 * Compile an animation's `physics` section: { <constraint or "" for all>: { inertia|strength|damping|mass|wind|gravity|mix: [keys], reset: [keys] } }.
 */
export function compilePhysicsTimelines(section, byName, all, where) {
  const out = [];
  for (const [name, channels] of Object.entries(section ?? {})) {
    let targets;
    if (name === '') targets = all.map(c => c.index);
    else {
      const constraint = byName.get(name);
      if (!constraint) throw new StudioError('bad-animation', `${where}: physics constraint "${name}" does not exist.`, { constraint: name });
      targets = [constraint.index];
    }
    for (const [property, keys] of Object.entries(channels ?? {})) {
      if (!Array.isArray(keys) || !keys.length) continue;
      if (property === 'reset') { out.push({ kind: 'physicsReset', constraints: targets, times: Float32Array.from(keys.map(k => num(k.time, 0))) }); continue; }
      if (!Object.hasOwn(PHYSICS_PARAMETERS, property)) throw new StudioError('bad-animation', `${where}: physics timeline "${property}" is not one of ${Object.keys(PHYSICS_PARAMETERS).join(', ')}, reset.`, { property });
      out.push({ kind: 'physics', constraints: targets, property,
        channel: compileChannel(keys.map(k => ({ time: k.time, value: num(k.value, PHYSICS_PARAMETERS[property]), curve: curveOf(k, 0) })), PHYSICS_PARAMETERS[property], `${where}/physics/${name}/${property}`) });
    }
  }
  return out;
}

/** A physics constraint's simulation state, at rest. */
export function freshPhysicsState() {
  return { ready: false, ox: 0, oy: 0, vx: 0, vy: 0, rot: 0, vr: 0, scl: 0, vs: 0, lastX: 0, lastY: 0, tipX: 0, tipY: 0, remaining: 0 };
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

/** After a constraint changed a bone's world transform: its applied locals read back from the world. */
function syncApplied(pose, bone) {
  const l = pose.applied(bone);
  bone.ax = l.x; bone.ay = l.y; bone.arotation = l.rotation; bone.ascaleX = l.scaleX; bone.ascaleY = l.scaleY; bone.ashearX = l.shearX; bone.ashearY = l.shearY;
}

/** A world point in the space of a bone's parent. */
function toParentSpace(pose, bone, wx, wy) {
  const p = bone.data.parent >= 0 ? pose.bones[bone.data.parent] : null;
  if (!p) return [wx - pose.x, wy - pose.y];
  const det = p.a * p.d - p.b * p.c;
  if (Math.abs(det) < 1e-9) return [0, 0];
  const dx = wx - p.worldX, dy = wy - p.worldY;
  return [(dx * p.d - dy * p.b) / det, (dy * p.a - dx * p.c) / det];
}

// ── IK ───────────────────────────────────────────────────────────────────────

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

/**
 * The soft reach: a target within `softness` of full reach is pulled in along a quadratic that
 * meets the straight line at full reach minus softness and full reach at full reach plus
 * softness, so the knee never snaps straight. Returns the distance the chain aims for.
 */
export function softReach(d, reach, softness) {
  if (!(softness > 0)) return d;
  const start = reach - softness;
  if (d <= start) return d;
  if (d >= reach + softness) return reach;
  const over = d - start;
  return d - over * over / (4 * softness);
}

function solveTwo(pose, parent, child, tx, ty, c) {
  const p = localOf(parent), k = localOf(child);
  // Lengths in the parent's parent space: the child's offset scaled by the parent, and the
  // child's own length scaled by both.
  const sp = Math.abs(p.scaleX);
  const l1 = Math.hypot(k.x * p.scaleX, k.y * p.scaleY);
  const l2 = child.data.length * Math.abs(k.scaleX) * sp;
  const [lx, ly] = toParentSpace(pose, parent, tx, ty);
  let dx = lx - p.x, dy = ly - p.y;
  let d = Math.hypot(dx, dy);
  if (l1 < 1e-4 || d < 1e-4) { solveOne(pose, parent, tx, ty, { ...c, stretch: false, compress: false }); return; }
  let scaleX = p.scaleX;
  if (l2 < 1e-4) {
    solveOne(pose, parent, tx, ty, { ...c, stretch: false, compress: false });
    pose.updateBone(child, k);
    return;
  }
  if (c.softness > 0 && !c.stretch) {
    const soft = softReach(d, l1 + l2, c.softness * sp);
    dx *= soft / d; dy *= soft / d; d = soft;
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
  pose.updateBone(parent, { ...p, rotation: p.rotation + d1 * c.mix, scaleX, scaleY: c.uniform && c.stretch ? p.scaleY * scaleX / p.scaleX : p.scaleY });
  pose.updateBone(child, { ...k, rotation: k.rotation + d2 * c.mix });
}

function applyIk(pose, data) {
  const c = pose.ik[data.index];
  if (!(c.mix > 0)) return [];
  const target = pose.bones[data.target];
  const first = pose.bones[data.bones[0]];
  if (data.bones.length === 1) solveOne(pose, first, target.worldX, target.worldY, c);
  else solveTwo(pose, first, pose.bones[data.bones[1]], target.worldX, target.worldY, c);
  return data.bones;
}

// ── transform ────────────────────────────────────────────────────────────────

function rotateColumns(bone, r, both = true) {
  const cos = Math.cos(r), sin = Math.sin(r);
  const { a, b, c, d } = bone;
  bone.a = cos * a - sin * c; bone.c = sin * a + cos * c;
  if (both) { bone.b = cos * b - sin * d; bone.d = sin * b + cos * d; }
}

function applyTransform(pose, data) {
  const m = pose.transform[data.index];
  if (!(m.mixRotate || m.mixX || m.mixY || m.mixScaleX || m.mixScaleY || m.mixShearY)) return [];
  const target = pose.bones[data.target];
  if (data.local) {
    const t = localOf(target);
    for (const index of data.bones) {
      const bone = pose.bones[index];
      const l = localOf(bone);
      if (data.relative) {
        l.rotation += (t.rotation + data.offsetRotation) * m.mixRotate;
        l.x += (t.x + data.offsetX) * m.mixX;
        l.y += (t.y + data.offsetY) * m.mixY;
        l.scaleX *= (t.scaleX - 1 + data.offsetScaleX) * m.mixScaleX + 1;
        l.scaleY *= (t.scaleY - 1 + data.offsetScaleY) * m.mixScaleY + 1;
        l.shearY += (t.shearY + data.offsetShearY) * m.mixShearY;
      } else {
        l.rotation += wrap(t.rotation + data.offsetRotation - l.rotation) * m.mixRotate;
        l.x += (t.x + data.offsetX - l.x) * m.mixX;
        l.y += (t.y + data.offsetY - l.y) * m.mixY;
        if (l.scaleX !== 0) l.scaleX += (t.scaleX + data.offsetScaleX - l.scaleX) * m.mixScaleX;
        if (l.scaleY !== 0) l.scaleY += (t.scaleY + data.offsetScaleY - l.scaleY) * m.mixScaleY;
        l.shearY += wrap(t.shearY + data.offsetShearY - l.shearY) * m.mixShearY;
      }
      pose.updateBone(bone, l);
    }
    return data.bones;
  }
  // World space. A reflected target turns the offsets the other way, as it turns everything else.
  const { a: ta, b: tb, c: tc, d: td } = target;
  const reflect = ta * td - tb * tc > 0 ? 1 : -1;
  const offRot = data.offsetRotation * DEG * reflect, offShear = data.offsetShearY * DEG * reflect;
  const targetRot = Math.atan2(tc, ta);
  const tsx = Math.hypot(ta, tc), tsy = Math.hypot(tb, td);
  const targetShear = Math.atan2(td, tb) - targetRot;
  const px = ta * data.offsetX + tb * data.offsetY + target.worldX, py = tc * data.offsetX + td * data.offsetY + target.worldY;
  for (const index of data.bones) {
    const bone = pose.bones[index];
    if (m.mixRotate) {
      const r = data.relative ? (targetRot + offRot) * m.mixRotate : wrapRad(targetRot + offRot - Math.atan2(bone.c, bone.a)) * m.mixRotate;
      rotateColumns(bone, r);
    }
    if (data.relative) {
      bone.worldX += px * m.mixX; bone.worldY += py * m.mixY;
    } else {
      bone.worldX += (px - bone.worldX) * m.mixX; bone.worldY += (py - bone.worldY) * m.mixY;
    }
    if (m.mixScaleX) {
      const s = Math.hypot(bone.a, bone.c);
      const k = data.relative ? (tsx - 1 + data.offsetScaleX) * m.mixScaleX + 1 : s > 1e-5 ? (s + (tsx - s + data.offsetScaleX) * m.mixScaleX) / s : 1;
      bone.a *= k; bone.c *= k;
    }
    if (m.mixScaleY) {
      const s = Math.hypot(bone.b, bone.d);
      const k = data.relative ? (tsy - 1 + data.offsetScaleY) * m.mixScaleY + 1 : s > 1e-5 ? (s + (tsy - s + data.offsetScaleY) * m.mixScaleY) / s : 1;
      bone.b *= k; bone.d *= k;
    }
    if (m.mixShearY) {
      const xr = Math.atan2(bone.c, bone.a), yr = Math.atan2(bone.d, bone.b);
      const shear = yr - xr;
      const next = data.relative ? shear + (targetShear - Math.PI / 2 + offShear) * m.mixShearY : shear + wrapRad(targetShear + offShear - shear) * m.mixShearY;
      const len = Math.hypot(bone.b, bone.d);
      bone.b = Math.cos(xr + next) * len; bone.d = Math.sin(xr + next) * len;
    }
    syncApplied(pose, bone);
  }
  return data.bones;
}

// ── path ─────────────────────────────────────────────────────────────────────

const SEGMENTS = 10;   // a constant-speed curve is measured as this many straight pieces

/** The cubic bezier at `t`: [x, y], and the direction it travels there (radians). */
function bezierAt(q, t) {
  const u = 1 - t;
  const x = u * u * u * q[0] + 3 * u * u * t * q[2] + 3 * u * t * t * q[4] + t * t * t * q[6];
  const y = u * u * u * q[1] + 3 * u * u * t * q[3] + 3 * u * t * t * q[5] + t * t * t * q[7];
  // The derivative, up to its factor 3; at the very start the curve leaves toward its first handle.
  let dx = u * u * (q[2] - q[0]) + 2 * u * t * (q[4] - q[2]) + t * t * (q[6] - q[4]);
  let dy = u * u * (q[3] - q[1]) + 2 * u * t * (q[5] - q[3]) + t * t * (q[7] - q[5]);
  if (t < 0.001 || Math.hypot(dx, dy) < 1e-9) { dx = q[2] - q[0]; dy = q[3] - q[1]; }
  return [x, y, Math.atan2(dy, dx)];
}

/** The curves of a path in world space: eight numbers each (start, two handles, end). */
function pathCurves(pose, slot, att) {
  const w = pose.worldVertices(slot, att);
  const points = w.length / 2, triples = points / 3;
  const point = i => [w[(i % points) * 2], w[(i % points) * 2 + 1]];
  const curves = [];
  const count = att.closed ? triples : triples - 1;
  for (let k = 0; k < count; k++) curves.push([...point(3 * k + 1), ...point(3 * k + 2), ...point(3 * k + 3), ...point(3 * k + 4)]);
  return curves;
}

/** Cumulative chord lengths of one curve over SEGMENTS pieces. */
function chordLengths(q) {
  const out = new Float64Array(SEGMENTS);
  let [px, py] = [q[0], q[1]], sum = 0;
  for (let i = 1; i <= SEGMENTS; i++) {
    const [x, y] = bezierAt(q, i / SEGMENTS);
    sum += Math.hypot(x - px, y - py);
    out[i - 1] = sum; px = x; py = y;
  }
  return out;
}

/**
 * Points along a path at the given distances from its start: [x, y, direction] each. An open
 * path goes on in a straight line past either end, along its end handle; a closed one wraps.
 */
function pointsAlong(curves, att, cumulative, distances) {
  const total = cumulative.length ? cumulative[cumulative.length - 1] : 0;
  const chords = att.constantSpeed ? curves.map(chordLengths) : null;
  return distances.map(p => {
    if (att.closed) { p = total > 0 ? p % total : 0; if (p < 0) p += total; }
    else if (p < 0) {
      const q = curves[0], r = Math.atan2(q[3] - q[1], q[2] - q[0]);
      return [q[0] + p * Math.cos(r), q[1] + p * Math.sin(r), r];
    } else if (p > total) {
      const q = curves[curves.length - 1], r = Math.atan2(q[7] - q[5], q[6] - q[4]);
      return [q[6] + (p - total) * Math.cos(r), q[7] + (p - total) * Math.sin(r), r];
    }
    let k = 0;
    while (k < cumulative.length - 1 && p > cumulative[k]) k++;
    const start = k ? cumulative[k - 1] : 0, length = cumulative[k] - start;
    let t;
    if (!chords) t = length > 0 ? (p - start) / length : 0;
    else {
      // Distance along this curve, read off its chords and back to the curve parameter.
      const c = chords[k], local = length > 0 ? (p - start) / length * c[SEGMENTS - 1] : 0;
      let j = 0;
      while (j < SEGMENTS - 1 && local > c[j]) j++;
      const from = j ? c[j - 1] : 0, piece = c[j] - from;
      t = (j + (piece > 0 ? (local - from) / piece : 0)) / SEGMENTS;
    }
    return bezierAt(curves[k], Math.max(0, Math.min(1, t)));
  });
}

function applyPath(pose, data) {
  const m = pose.path[data.index];
  if (!(m.mixRotate > 0 || m.mixX > 0 || m.mixY > 0)) return [];
  const slot = pose.slots[data.target];
  const att = slot.attachment;
  if (!att || att.type !== 'path') return [];
  const curves = pathCurves(pose, slot, att);
  if (!curves.length) return [];
  let cumulative;
  if (att.constantSpeed) {
    cumulative = [];
    let sum = 0;
    for (const q of curves) { sum += chordLengths(q)[SEGMENTS - 1]; cumulative.push(sum); }
  } else cumulative = Array.from(att.lengths.slice(0, curves.length));
  const total = cumulative.length ? cumulative[cumulative.length - 1] : 0;

  const bones = data.bones.map(i => pose.bones[i]);
  const tangents = data.rotateMode === 'tangent', scaled = data.rotateMode === 'chainScale';
  const count = tangents ? bones.length : bones.length + 1;
  // The step from each bone to the next, along the path, and each bone's world length.
  const lengths = bones.map(b => b.data.length * Math.hypot(b.a, b.c));
  const steps = new Float64Array(count);
  if (data.spacingMode === 'percent') steps.fill(m.spacing * total, 1);
  else if (data.spacingMode === 'proportional') {
    let sum = 0;
    for (let i = 0; i < count - 1; i++) { const l = bones[i].data.length < 1e-5 ? 0 : lengths[i]; steps[i + 1] = l || m.spacing; sum += l; }
    if (sum > 0) for (let i = 1; i < count; i++) steps[i] *= m.spacing * total / sum;
  } else {
    for (let i = 0; i < count - 1; i++) {
      const setup = bones[i].data.length;
      steps[i + 1] = setup < 1e-5 ? m.spacing : (data.spacingMode === 'length' ? setup + m.spacing : m.spacing) * lengths[i] / setup;
    }
  }
  let at = data.positionMode === 'percent' ? m.position * total : m.position;
  const distances = Array.from(steps, s => (at += s));
  const points = pointsAlong(curves, att, cumulative, distances);

  const holder = pose.bones[slot.data.bone];
  const flipped = holder.a * holder.d - holder.b * holder.c < 0;
  const offset = data.offsetRotation * DEG * (flipped ? -1 : 1);
  const tip = data.offsetRotation === 0 && data.rotateMode === 'chain';
  let [x0, y0] = points[0];
  bones.forEach((bone, i) => {
    bone.worldX += (x0 - bone.worldX) * m.mixX;
    bone.worldY += (y0 - bone.worldY) * m.mixY;
    const next = points[i + 1] ?? points[i];
    const dx = next[0] - x0, dy = next[1] - y0;
    if (scaled && lengths[i] > 0) { const s = (Math.hypot(dx, dy) / lengths[i] - 1) * m.mixRotate + 1; bone.a *= s; bone.c *= s; }
    x0 = next[0]; y0 = next[1];
    if (m.mixRotate > 0) {
      const aim = tangents ? points[i][2] : steps[i + 1] === 0 ? next[2] : Math.atan2(dy, dx);
      let r = aim - Math.atan2(bone.c, bone.a);
      if (tip) {
        // The next bone starts at this one's tip, as far as the turn goes.
        const L = bone.data.length, cos = Math.cos(r), sin = Math.sin(r);
        x0 += (L * (cos * bone.a - sin * bone.c) - dx) * m.mixRotate;
        y0 += (L * (sin * bone.a + cos * bone.c) - dy) * m.mixRotate;
      } else r += offset;
      rotateColumns(bone, wrapRad(r) * m.mixRotate);
    }
    syncApplied(pose, bone);
  });
  return data.bones;
}

// ── physics ──────────────────────────────────────────────────────────────────

/**
 * One physics constraint. `mode`: 'update' moves the simulation by `delta` seconds (the lag of
 * this frame's motion, then whole fixed steps of springs, damping, wind and gravity), 'reset'
 * puts it at rest where the bone is now, 'pose' only shows the state it has.
 *
 * The model, in skeleton space (y up): the bone's origin and its tip each carry an offset from
 * where the animation puts them. Motion leaves the offset behind (inertia, the share of this
 * frame's motion it keeps), a spring of `strength` pulls it back, `damping` (per 1/60 s) bleeds
 * velocity, `mass` divides the forces, and wind (+x) and gravity (-y), in units of the skeleton's
 * reference scale per second squared, push on it; on the tip they turn the bone by the force
 * across it, a longer bone more. `x`, `y`, `rotate`, `scaleX` and `shearX` say how much of each
 * offset is shown; `mix` scales them all; `limit` caps how far the bone moves in one second.
 */
function applyPhysics(pose, data, mode, delta) {
  const c = pose.physics[data.index];
  const st = c.state;
  const bone = pose.bones[data.bone];
  const ref = pose.model.referenceScale || 100;
  const length = pose.model.bones[data.bone].length;
  const turns = data.rotate || data.shearX, stretches = data.scaleX, moves = data.x || data.y;
  const tipOf = () => [bone.worldX + bone.a * length, bone.worldY + bone.c * length];
  if (mode === 'reset' || !st.ready) {
    Object.assign(st, freshPhysicsState(), { ready: true, lastX: bone.worldX, lastY: bone.worldY });
    [st.tipX, st.tipY] = tipOf();
    return [];
  }
  const mix = c.mix;
  if (mode === 'update' && delta > 0) {
    const limit = data.limit * delta;
    const inertia = c.inertia;
    const movedX = clamp(st.lastX - bone.worldX, limit), movedY = clamp(st.lastY - bone.worldY, limit);
    if (data.x) st.ox += movedX * inertia;
    if (data.y) st.oy += movedY * inertia;
    const L = length * Math.hypot(bone.a, bone.c);
    const base = Math.atan2(bone.c, bone.a);
    const ox = bone.worldX + st.ox * mix * data.x, oy = bone.worldY + st.oy * mix * data.y;
    if (L > 1e-4) {
      if (turns) {
        const shown = base + st.rot * (data.rotate + data.shearX) * mix;
        const lag = wrapRad(Math.atan2(st.tipY - oy, st.tipX - ox) - shown);
        st.rot += clamp(lag, Math.PI / 2) * inertia;
      }
      if (stretches) st.scl += (movedX * Math.cos(base) + movedY * Math.sin(base)) * inertia / L;
    }
    st.lastX = bone.worldX; st.lastY = bone.worldY;
    st.remaining = Math.min(st.remaining + delta, 1);
    const h = data.step;
    if (st.remaining >= h) {
      const damp = Math.pow(c.damping, 60 * h), m = h / c.mass, k = c.strength;
      const fx = c.wind * ref, fy = -c.gravity * ref;
      while (st.remaining >= h) {
        st.remaining -= h;
        if (data.x) { st.vx += (fx - st.ox * k) * m; st.ox += st.vx * h; st.vx *= damp; }
        if (data.y) { st.vy += (fy - st.oy * k) * m; st.oy += st.vy * h; st.vy *= damp; }
        if (L > 1e-4 && (turns || stretches)) {
          const angle = base + st.rot * (data.rotate + data.shearX) * mix;
          const cos = Math.cos(angle), sin = Math.sin(angle);
          if (turns) { st.vr += ((cos * fy - sin * fx) * L / ref / ref - st.rot * k) * m; st.rot += st.vr * h; st.vr *= damp; }
          if (stretches) { st.vs += ((cos * fx + sin * fy) / ref / ref - st.scl * k) * m; st.scl += st.vs * h; st.vs *= damp; }
        }
      }
    }
  }
  if (!(mix > 0)) { if (mode === 'update') [st.tipX, st.tipY] = tipOf(); return []; }
  if (moves) { bone.worldX += st.ox * mix * data.x; bone.worldY += st.oy * mix * data.y; }
  if (data.rotate) rotateColumns(bone, st.rot * mix * data.rotate);
  if (data.shearX) rotateColumns(bone, st.rot * mix * data.shearX, false);
  if (stretches) { const s = 1 + st.scl * mix * data.scaleX; bone.a *= s; bone.c *= s; }
  if (mode === 'update') [st.tipX, st.tipY] = tipOf();
  syncApplied(pose, bone);
  return [data.bone];
}

/**
 * Apply every constraint in order, then refresh the bones below each one it moved.
 * @param {import('./pose.js').Pose} pose
 * @param {{ physics?: 'none'|'pose'|'update'|'reset', delta?: number }} [options]
 */
export function applyConstraints(pose, { physics = 'pose', delta = 0 } = {}) {
  const list = pose.model.constraints ?? [];
  for (const [n, data] of list.entries()) {
    if (pose.constraintActive && !pose.constraintActive[n]) continue;
    let moved;
    if (data.kind === 'ik') moved = applyIk(pose, data);
    else if (data.kind === 'transform') moved = applyTransform(pose, data);
    else if (data.kind === 'path') moved = applyPath(pose, data);
    else if (physics === 'none') continue;
    else moved = applyPhysics(pose, data, physics, delta);
    if (!moved.length) continue;
    const skip = new Set(moved);
    const done = new Set();
    for (const root of moved) {
      for (const bone of descendants(pose, root)) {
        if (skip.has(bone.data.index) || done.has(bone.data.index) || (pose.active && !pose.active[bone.data.index])) continue;
        done.add(bone.data.index);
        pose.updateBone(bone, localOf(bone));
      }
    }
  }
}
