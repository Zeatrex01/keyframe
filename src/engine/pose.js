// Posing a compiled skeleton (src/engine/model.js): apply an animation at an instant, compute
// world transforms, and collect what is drawn. The arithmetic follows the Spine 4.2 format's
// documented semantics (offsets from setup for rotate, translate and shear; a multiplier for
// scale; bezier segments read as a nine-point polyline), so a clip plays the same here and in
// any Spine runtime. test/engine-parity.test.js holds the two side by side.
//
// Stateless per instant: posing at t never depends on which instants were posed before. The one
// exception is physics, which integrates over time: its state lives in the pose and moves only
// when updateWorld is asked to step it (src/engine/index.js replays it from 0 for a sample).
//
// Mixing: `apply` can lay a clip over what the pose holds instead of over the setup pose, and a
// pose's state can be captured, restored and blended, which is all src/engine/mixer.js needs for
// tracks, layers and crossfades.
//
// Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { channelValue, keyIndex, segmentPercent } from './curve.js';
import { colorAt, sequenceFrame } from './model.js';
import { applyConstraints, freshPhysicsState } from './constraints.js';

const DEG = Math.PI / 180;
const cosDeg = d => Math.cos(d * DEG);
const sinDeg = d => Math.sin(d * DEG);

/** A live pose of a compiled skeleton. */
export class Pose {
  /**
   * @param {ReturnType<import('./model.js').compileSkeleton>} model
   * @param {{ skin?: string }} [options]
   */
  constructor(model, { skin } = {}) {
    this.model = model;
    if (skin && !model.skins.has(skin)) throw new StudioError('unknown-skin', `No skin named "${skin}".`, { skin, available: [...model.skins.keys()] });
    this.skin = skin ? model.skins.get(skin) : null;
    this.scaleX = 1; this.scaleY = 1; this.x = 0; this.y = 0;
    this.color = { r: 1, g: 1, b: 1, a: 1 };
    this.bones = model.bones.map(data => ({ data, inherit: data.inherit, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 }));
    this.slots = model.slots.map(data => ({ data, color: { ...data.color }, dark: data.dark ? { ...data.dark } : null, attachment: null, deform: null, sequenceIndex: -1 }));
    this.drawOrder = this.slots.slice();
    this.ik = (model.ik ?? []).map(c => ({ mix: c.mix, softness: c.softness, bendDirection: c.bendDirection, compress: c.compress, stretch: c.stretch, uniform: c.uniform }));
    this.transform = (model.transform ?? []).map(c => ({ ...TRANSFORM_SETUP(c) }));
    this.physics = (model.physics ?? []).map(c => ({ ...PHYSICS_SETUP(c), state: freshPhysicsState() }));
    this.path = (model.path ?? []).map(c => ({ ...PATH_SETUP(c) }));
    this.activate(skin ?? 'default');
    this.setupPose();
  }

  /** The attachment a slot shows under a name: the active skin first, then the default skin. */
  attachmentFor(slotIndex, name) {
    if (name === null || name === undefined) return null;
    return this.skin?.get(slotIndex)?.get(name) ?? this.model.defaultSkin?.get(slotIndex)?.get(name) ?? null;
  }

  setupPose() {
    for (const b of this.bones) {
      const d = b.data;
      b.inherit = d.inherit;
      b.x = d.x; b.y = d.y; b.rotation = d.rotation; b.scaleX = d.scaleX; b.scaleY = d.scaleY; b.shearX = d.shearX; b.shearY = d.shearY;
    }
    for (const s of this.slots) this.setupSlot(s);
    this.drawOrder = this.slots.slice();
    (this.model.ik ?? []).forEach((c, i) => Object.assign(this.ik[i], { mix: c.mix, softness: c.softness, bendDirection: c.bendDirection, compress: c.compress, stretch: c.stretch }));
    (this.model.transform ?? []).forEach((c, i) => Object.assign(this.transform[i], TRANSFORM_SETUP(c)));
    (this.model.physics ?? []).forEach((c, i) => Object.assign(this.physics[i], PHYSICS_SETUP(c)));
    (this.model.path ?? []).forEach((c, i) => Object.assign(this.path[i], PATH_SETUP(c)));
  }

  /**
   * Which bones and constraints act under a skin: those not marked `skin`, and those the skin
   * lists. A bone acts only while its parent does; a constraint only while its bones, its target
   * bone (or the target slot's bone) act too. What does not act is not posed and not drawn.
   */
  activate(skinName) {
    const listed = this.model.skinRequires?.get(skinName) ?? { bones: new Set(), constraints: new Set() };
    this.active = this.model.bones.map(() => true);
    for (const b of this.model.bones) {
      this.active[b.index] = (!b.skinRequired || listed.bones.has(b.index)) && (b.parent < 0 || this.active[b.parent]);
    }
    const on = c => {
      if (c.skinRequired && !listed.constraints.has(c.name)) return false;
      const bones = c.kind === 'physics' ? [c.bone] : c.bones;
      const target = c.kind === 'path' ? this.model.slots[c.target].bone : c.target;
      return bones.every(i => this.active[i]) && (target === undefined || this.active[target]);
    };
    this.constraintActive = (this.model.constraints ?? []).map(on);
  }

  /** A mesh's or a path's vertices in world space, with the slot's deform. */
  worldVertices(slot, att) { return meshVertices(this, slot, att); }

  /** Physics at rest where the bones are now (at the next updateWorld). */
  resetPhysics() { for (const c of this.physics) c.state = freshPhysicsState(); }

  /** A copy of the physics simulation, to step ahead and come back. */
  savePhysics() { return this.physics.map(c => ({ ...c.state })); }
  restorePhysics(saved) { this.physics.forEach((c, i) => { c.state = { ...saved[i] }; }); }

  setupSlot(s) {
    Object.assign(s.color, s.data.color);
    if (s.dark && s.data.dark) Object.assign(s.dark, s.data.dark);
    s.deform = null;
    s.sequenceIndex = -1;
    this.setAttachment(s, s.data.attachmentName);
  }

  setAttachment(s, name) {
    const attachment = this.attachmentFor(s.data.index, name);
    if (attachment !== s.attachment) { s.deform = null; s.sequenceIndex = -1; }
    s.attachment = attachment;
  }

  /**
   * Apply an animation at `time` (seconds) over the setup pose: what a property's timeline does
   * not key stays at setup. With `fromSetup: false` it lays over what the pose holds instead
   * (what it keys is set, the rest is left alone). `lastTime`, the instant posed before, lets a
   * physics reset key between the two take effect.
   */
  apply(animation, time, { loop = false, fromSetup = true, lastTime = null } = {}) {
    if (loop && animation.duration > 0) {
      const d = animation.duration;
      // A reset key is crossed between the last instant and this one; a new lap starts from before 0.
      if (lastTime !== null) lastTime = Math.floor(lastTime / d) === Math.floor(time / d) ? lastTime % d : -1;
      time %= d;
    }
    if (fromSetup) this.setupPose();
    for (const t of animation.timelines) {
      switch (t.kind) {
        case 'bone': {
          const value = channelValue(t.channel, time);
          if (value === undefined) break;
          const bone = this.bones[t.bone];
          const setup = bone.data[t.property];
          bone[t.property] = t.property === 'scaleX' || t.property === 'scaleY' ? setup * value : setup + value;
          break;
        }
        case 'color': {
          const values = colorAt(t.channel, time);
          if (values === undefined) break;
          const slot = this.slots[t.slot];
          t.channel.parts.forEach((p, i) => {
            const v = Math.min(1, Math.max(0, values[i]));
            if (p.property.length === 1) slot.color[p.property] = v;
            else if (slot.dark) slot.dark[p.property[1]] = v;
          });
          break;
        }
        case 'attachment': {
          const i = keyIndex(t.times, time);
          if (i >= 0) this.setAttachment(this.slots[t.slot], t.names[i]);
          break;
        }
        case 'drawOrder': {
          const i = keyIndex(t.times, time);
          if (i >= 0 && t.orders[i]) this.drawOrder = t.orders[i].map(index => this.slots[index]);
          break;
        }
        case 'ik': {
          const i = keyIndex(t.times, time);
          if (i < 0) break;
          const c = this.ik[t.constraint];
          c.mix = channelValue(t.mix, time);
          c.softness = channelValue(t.softness, time);
          c.bendDirection = t.bend[i]; c.compress = t.compress[i]; c.stretch = t.stretch[i];
          break;
        }
        case 'inherit': {
          const i = keyIndex(t.times, time);
          if (i >= 0) this.bones[t.bone].inherit = t.modes[i];
          break;
        }
        case 'path': {
          const c = this.path[t.constraint];
          for (const [field, channel] of t.channels) { const v = channelValue(channel, time); if (v !== undefined) c[field] = v; }
          break;
        }
        case 'transform': {
          const c = this.transform[t.constraint];
          for (const [mix, channel] of t.channels) { const v = channelValue(channel, time); if (v !== undefined) c[mix] = v; }
          break;
        }
        case 'physics': {
          const v = channelValue(t.channel, time);
          if (v === undefined) break;
          for (const index of t.constraints) this.physics[index][t.property] = t.property === 'mass' ? Math.max(1e-4, v) : v;
          break;
        }
        case 'physicsReset': {
          // A reset key between the last instant posed and this one puts the simulation at rest.
          if (lastTime === null) break;
          for (let i = 0; i < t.times.length; i++) {
            if (t.times[i] > lastTime && t.times[i] <= time) { for (const index of t.constraints) this.physics[index].state = freshPhysicsState(); break; }
          }
          break;
        }
        default: break; // deform and sequences after attachments are settled; events draw nothing
      }
    }
    for (const t of animation.timelines) {
      if (t.kind === 'sequence') {
        const slot = this.slots[t.slot];
        const current = slot.attachment;
        if (!current || (current !== t.attachment && current.deformFrom !== t.attachment)) continue;
        const i = keyIndex(t.times, time);
        if (i < 0) { slot.sequenceIndex = -1; continue; }
        const k = t.keys[i];
        slot.sequenceIndex = sequenceFrame(k.mode, k.index, k.delay, time - k.time, current.sequence.count);
        continue;
      }
      if (t.kind !== 'deform') continue;
      const slot = this.slots[t.slot];
      const current = slot.attachment;
      if (!current || (current !== t.attachment && current.deformFrom !== t.attachment)) continue;
      const i = keyIndex(t.times, time);
      if (i < 0) { slot.deform = null; continue; }
      if (i === t.times.length - 1) { slot.deform = t.frames[i].slice(); continue; }
      const p = segmentPercent(t.curves[i], t.times[i], t.times[i + 1], time);
      const a = t.frames[i], b = t.frames[i + 1];
      const out = new Float64Array(a.length);
      for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * p;
      slot.deform = out;
    }
    return this;
  }

  /**
   * World transforms of every bone, parents first (bones are ordered parents first).
   * @param {{ physics?: 'pose' | 'none' | 'update' | 'reset', delta?: number }} [options]
   */
  updateWorld({ physics = /** @type {'pose' | 'none' | 'update' | 'reset'} */ ('pose'), delta = 0 } = {}) {
    for (const bone of this.bones) if (this.active[bone.data.index]) this.updateBone(bone, bone);
    applyConstraints(this, { physics, delta });
    return this;
  }

  /**
   * What an animation sets, as plain data: bone locals, slot colours, attachments, deform,
   * sequence frames, draw order and constraint mixes. Not the physics simulation, which goes on
   * across whatever is mixed.
   */
  captureState() {
    const bones = new Float64Array(this.bones.length * 7);
    this.bones.forEach((b, i) => { const o = i * 7; bones[o] = b.x; bones[o + 1] = b.y; bones[o + 2] = b.rotation; bones[o + 3] = b.scaleX; bones[o + 4] = b.scaleY; bones[o + 5] = b.shearX; bones[o + 6] = b.shearY; });
    return {
      bones,
      inherits: this.bones.map(b => b.inherit),
      slots: this.slots.map(s => ({ color: { ...s.color }, dark: s.dark ? { ...s.dark } : null, attachment: s.attachment, deform: s.deform, sequenceIndex: s.sequenceIndex })),
      drawOrder: this.drawOrder.slice(),
      ik: this.ik.map(c => ({ ...c })),
      transform: this.transform.map(c => ({ ...c })),
      physics: this.physics.map(({ state, ...c }) => c),
      path: this.path.map(c => ({ ...c })),
    };
  }

  restoreState(st) {
    this.bones.forEach((b, i) => { const o = i * 7; b.x = st.bones[o]; b.y = st.bones[o + 1]; b.rotation = st.bones[o + 2]; b.scaleX = st.bones[o + 3]; b.scaleY = st.bones[o + 4]; b.shearX = st.bones[o + 5]; b.shearY = st.bones[o + 6]; });
    this.slots.forEach((s, i) => { const v = st.slots[i]; Object.assign(s.color, v.color); if (s.dark && v.dark) Object.assign(s.dark, v.dark); s.attachment = v.attachment; s.deform = v.deform; s.sequenceIndex = v.sequenceIndex; });
    this.drawOrder = st.drawOrder.slice();
    if (st.inherits) this.bones.forEach((b, i) => { b.inherit = st.inherits[i]; });
    this.ik.forEach((c, i) => Object.assign(c, st.ik[i]));
    this.transform.forEach((c, i) => Object.assign(c, st.transform[i]));
    this.physics.forEach((c, i) => Object.assign(c, st.physics[i]));
    this.path.forEach((c, i) => Object.assign(c, st.path[i]));
    return this;
  }

  /**
   * Set the pose to `a` blended toward `b` by `t` (0 = a, 1 = b). Numbers are interpolated
   * (rotation the short way round); what has no in-between (an attachment, a sequence frame,
   * the draw order, a bend direction) switches at half way. With `add`, `b` is an offset from
   * `base` (both captured over the setup pose) added on top of `a` by `t`: the bone transforms of
   * an additive layer.
   */
  blendStates(a, b, t, { add = null } = {}) {
    const lerp = (x, y) => x + (y - x) * t;
    const turn = (x, y) => { let d = (y - x) % 360; if (d > 180) d -= 360; else if (d < -180) d += 360; return x + d * t; };
    this.bones.forEach((bone, i) => {
      const o = i * 7;
      if (add) {
        const base = add.bones;
        bone.x = a.bones[o] + (b.bones[o] - base[o]) * t; bone.y = a.bones[o + 1] + (b.bones[o + 1] - base[o + 1]) * t;
        bone.rotation = a.bones[o + 2] + (b.bones[o + 2] - base[o + 2]) * t;
        bone.scaleX = a.bones[o + 3] + (b.bones[o + 3] - base[o + 3]) * t; bone.scaleY = a.bones[o + 4] + (b.bones[o + 4] - base[o + 4]) * t;
        bone.shearX = a.bones[o + 5] + (b.bones[o + 5] - base[o + 5]) * t; bone.shearY = a.bones[o + 6] + (b.bones[o + 6] - base[o + 6]) * t;
        return;
      }
      bone.x = lerp(a.bones[o], b.bones[o]); bone.y = lerp(a.bones[o + 1], b.bones[o + 1]); bone.rotation = turn(a.bones[o + 2], b.bones[o + 2]);
      bone.scaleX = lerp(a.bones[o + 3], b.bones[o + 3]); bone.scaleY = lerp(a.bones[o + 4], b.bones[o + 4]);
      bone.shearX = lerp(a.bones[o + 5], b.bones[o + 5]); bone.shearY = lerp(a.bones[o + 6], b.bones[o + 6]);
    });
    const late = t >= 0.5;
    const inherits = (late && !add ? b : a).inherits;
    if (inherits) this.bones.forEach((bone, i) => { bone.inherit = inherits[i]; });
    this.slots.forEach((s, i) => {
      const x = a.slots[i], y = add ? a.slots[i] : b.slots[i];
      for (const k of ['r', 'g', 'b', 'a']) s.color[k] = lerp(x.color[k], y.color[k]);
      if (s.dark && x.dark && y.dark) for (const k of ['r', 'g', 'b']) s.dark[k] = lerp(x.dark[k], y.dark[k]);
      const pick = late ? y : x;
      s.attachment = pick.attachment; s.sequenceIndex = pick.sequenceIndex;
      if (x.attachment === y.attachment && x.deform && y.deform && x.deform.length === y.deform.length) {
        const out = new Float64Array(x.deform.length);
        for (let k = 0; k < out.length; k++) out[k] = x.deform[k] + (y.deform[k] - x.deform[k]) * t;
        s.deform = out;
      } else if (x.attachment === y.attachment && (x.deform || y.deform)) {
        const setup = setupDeform(s.attachment);
        const from = x.deform ?? setup, to = y.deform ?? setup;
        if (from && to && from.length === to.length) { const out = new Float64Array(from.length); for (let k = 0; k < out.length; k++) out[k] = from[k] + (to[k] - from[k]) * t; s.deform = out; }
        else s.deform = pick.deform;
      } else s.deform = pick.deform;
    });
    if (!add) this.drawOrder = (late ? b : a).drawOrder.slice();
    else this.drawOrder = a.drawOrder.slice();
    const mixNumbers = (list, from, to, discrete = []) => list.forEach((c, i) => {
      for (const k of Object.keys(from[i])) {
        if (typeof from[i][k] === 'number' && !discrete.includes(k)) c[k] = lerp(from[i][k], to[i][k]);
        else c[k] = (late ? to : from)[i][k];
      }
    });
    if (!add) {
      mixNumbers(this.ik, a.ik, b.ik, ['bendDirection']);
      mixNumbers(this.transform, a.transform, b.transform);
      mixNumbers(this.physics, a.physics, b.physics);
      mixNumbers(this.path, a.path, b.path);
    } else {
      this.ik.forEach((c, i) => Object.assign(c, a.ik[i]));
      this.transform.forEach((c, i) => Object.assign(c, a.transform[i]));
      this.physics.forEach((c, i) => Object.assign(c, a.physics[i]));
      this.path.forEach((c, i) => Object.assign(c, a.path[i]));
    }
    return this;
  }

  /**
   * One bone's world transform from local values `t` (its own or a constraint's).
   *
   * world = P * L, where L = [x axis, y axis] of the local transform: the x axis turned by
   * rotation + shearX and scaled by scaleX, the y axis turned by rotation + 90 + shearY and
   * scaled by scaleY. The inherit modes change only P, the part of the parent that is kept:
   *   normal                  the whole parent matrix
   *   onlyTranslation         nothing (position only)
   *   noRotationOrReflection  the parent's scale with its rotation taken out
   *   noScale(OrReflection)   the parent's direction with its scale taken out
   * The skeleton's own scale applies on top in every mode except normal, where the parent
   * already carries it.
   */
  updateBone(bone, t) {
    const { x, y, rotation, scaleX, scaleY, shearX, shearY } = t;
    bone.ax = x; bone.ay = y; bone.arotation = rotation; bone.ascaleX = scaleX; bone.ascaleY = scaleY; bone.ashearX = shearX; bone.ashearY = shearY;
    const sx = this.scaleX, sy = this.scaleY;
    const axisX = (angle, length) => [Math.cos(angle * DEG) * length, Math.sin(angle * DEG) * length];
    const parent = bone.data.parent >= 0 ? this.bones[bone.data.parent] : null;
    if (!parent) {
      const [la, lc] = axisX(rotation + shearX, scaleX), [lb, ld] = axisX(rotation + 90 + shearY, scaleY);
      bone.a = la * sx; bone.b = lb * sx; bone.c = lc * sy; bone.d = ld * sy;
      bone.worldX = x * sx + this.x; bone.worldY = y * sy + this.y;
      return;
    }
    const { a: pa, b: pb, c: pc, d: pd } = parent;
    bone.worldX = pa * x + pb * y + parent.worldX;
    bone.worldY = pc * x + pd * y + parent.worldY;
    const mode = bone.inherit ?? bone.data.inherit;
    let m; // [a, b, c, d] before the skeleton's scale
    if (mode === 0) {
      const [la, lc] = axisX(rotation + shearX, scaleX), [lb, ld] = axisX(rotation + 90 + shearY, scaleY);
      bone.a = pa * la + pb * lc; bone.b = pa * lb + pb * ld; bone.c = pc * la + pd * lc; bone.d = pc * lb + pd * ld;
      return;
    } else if (mode === 1) {
      const [la, lc] = axisX(rotation + shearX, scaleX), [lb, ld] = axisX(rotation + 90 + shearY, scaleY);
      m = [la, lb, lc, ld];
    } else if (mode === 2) {
      // Keep the parent's scale, drop its rotation: measure the parent's x axis (in the
      // skeleton's unscaled space), turn the local transform back by that angle, and map it
      // through a parent made orthogonal (y axis perpendicular to x, same determinant).
      const ux = pa / sx, uy = pc / sy;
      const len2 = ux * ux + uy * uy;
      let qa, qb, qc, qd, angle;
      if (len2 > 1e-4) {
        const k = Math.abs(ux * (pd / sy) - (pb / sx) * uy) / len2;
        qa = ux; qc = uy; qb = -uy * k; qd = ux * k;
        angle = Math.atan2(uy, ux) / DEG;
      } else {
        qa = 0; qc = 0; qb = pb; qd = pd;
        angle = 90 - Math.atan2(pd, pb) / DEG;
      }
      const [la, lc] = axisX(rotation + shearX - angle, scaleX), [lb, ld] = axisX(rotation + 90 + shearY - angle, scaleY);
      m = [qa * la + qb * lc, qa * lb + qb * ld, qc * la + qd * lc, qc * lb + qd * ld];
    } else {
      // Keep the parent's direction, drop its scale: the bone's x axis is the parent matrix
      // applied to the local rotation, normalized; its y axis is perpendicular (flipped when
      // the parent reflects, in noScale); shear and scale are local to that frame.
      let ex = (pa * Math.cos(rotation * DEG) + pb * Math.sin(rotation * DEG)) / sx;
      let ey = (pc * Math.cos(rotation * DEG) + pd * Math.sin(rotation * DEG)) / sy;
      const len = Math.hypot(ex, ey);
      if (len > 1e-5) { ex /= len; ey /= len; }
      let side = Math.hypot(ex, ey);
      if (mode === 3 && (pa * pd - pb * pc < 0) !== (sx < 0 !== sy < 0)) side = -side;
      const fx = -ey * side, fy = ex * side;
      const [la, lc] = axisX(shearX, scaleX), [lb, ld] = axisX(90 + shearY, scaleY);
      m = [ex * la + fx * lc, ex * lb + fx * ld, ey * la + fy * lc, ey * lb + fy * ld];
    }
    bone.a = m[0] * sx; bone.b = m[1] * sx; bone.c = m[2] * sy; bone.d = m[3] * sy;
  }

  /**
   * The local values that reproduce a bone's world transform. Generic linear algebra: undo
   * the part of the parent the bone inherits, then read rotation, scale and shear off the
   * remaining 2x2 matrix (x axis gives rotation and scaleX, the determinant gives scaleY, the
   * angle between the axes gives shearY).
   */
  applied(bone) {
    const parent = bone.data.parent >= 0 ? this.bones[bone.data.parent] : null;
    const { a, b, c, d } = bone;
    const decompose = (ra, rb, rc, rd, x, y) => {
      const scaleX = Math.hypot(ra, rc);
      if (scaleX > 1e-4) {
        const det = ra * rd - rb * rc;
        return { x, y, rotation: Math.atan2(rc, ra) / DEG, scaleX, scaleY: det / scaleX, shearX: 0, shearY: -Math.atan2(ra * rb + rc * rd, det) / DEG };
      }
      return { x, y, rotation: 90 - Math.atan2(rd, rb) / DEG, scaleX: 0, scaleY: Math.hypot(rb, rd), shearX: 0, shearY: 0 };
    };
    if (!parent) {
      return { x: bone.worldX - this.x, y: bone.worldY - this.y, rotation: Math.atan2(c, a) / DEG, scaleX: Math.hypot(a, c),
        scaleY: Math.hypot(b, d), shearX: 0, shearY: Math.atan2(a * b + c * d, a * d - b * c) / DEG };
    }
    const inv = (m0, m1, m2, m3) => { const k = 1 / (m0 * m3 - m1 * m2); return [m3 * k, -m1 * k, -m2 * k, m0 * k]; };
    const [ia, ib, ic, id] = inv(parent.a, parent.b, parent.c, parent.d);
    const dx = bone.worldX - parent.worldX, dy = bone.worldY - parent.worldY;
    const x = ia * dx + ib * dy, y = ic * dx + id * dy;
    const mode = bone.inherit ?? bone.data.inherit;
    if (mode === 1) return decompose(a, b, c, d, x, y);
    let q = [parent.a, parent.b, parent.c, parent.d];
    if (mode === 2) {
      const [pa, , pc] = q;
      const k = Math.abs(q[0] * q[3] - q[1] * q[2]) / (pa * pa + pc * pc);
      q = [pa, -pc * this.scaleX * k / this.scaleY, pc, pa * this.scaleY * k / this.scaleX];
    } else if (mode === 3 || mode === 4) {
      const [pa, pb, pc, pd] = q;
      let ex = (pa * Math.cos(bone.rotation * DEG) + pb * Math.sin(bone.rotation * DEG)) / this.scaleX;
      let ey = (pc * Math.cos(bone.rotation * DEG) + pd * Math.sin(bone.rotation * DEG)) / this.scaleY;
      const len = Math.hypot(ex, ey);
      if (len > 1e-5) { ex /= len; ey /= len; }
      let side = Math.hypot(ex, ey);
      if (mode === 3 && (pa * pd - pb * pc < 0) !== (this.scaleX < 0 !== this.scaleY < 0)) side = -side;
      q = [ex, -ey * side, ey, ex * side];
    }
    if (mode === 0) {
      const r = [ia * a + ib * c, ia * b + ib * d, ic * a + id * c, ic * b + id * d];
      return decompose(r[0], r[1], r[2], r[3], x, y);
    }
    const [qa, qb, qc, qd] = inv(q[0], q[1], q[2], q[3]);
    return decompose(qa * a + qb * c, qa * b + qb * d, qc * a + qd * c, qc * b + qd * d, x, y);
  }

  /** Plain data, the same shape src/runtime's snapshot returns. */
  snapshot() {
    return {
      bones: this.bones.map(b => ({
        name: b.data.name,
        x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX, scaleY: b.scaleY, shearX: b.shearX, shearY: b.shearY,
        applied: this.applied(b),
        worldX: b.worldX, worldY: b.worldY,
        matrix: { a: b.a, b: b.b, c: b.c, d: b.d },
        worldRotation: Math.atan2(b.c, b.a) / DEG, worldScaleX: Math.sqrt(b.a * b.a + b.c * b.c), worldScaleY: Math.sqrt(b.b * b.b + b.d * b.d),
        active: true,
      })),
      slots: this.slots.map(s => ({ name: s.data.name, bone: this.bones[s.data.bone].data.name, attachment: s.attachment?.name ?? null,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a } })),
      drawOrder: this.drawOrder.map(s => s.data.name),
    };
  }

  /** Events whose time lies in (from, to]; `from` < 0 includes events at 0. */
  static eventsBetween(animation, from, to) {
    const out = [];
    for (const t of animation.timelines) if (t.kind === 'event') for (const e of t.events) if (e.time > from && e.time <= to) out.push(e);
    return out;
  }
}

const TRANSFORM_SETUP = c => ({ mixRotate: c.mixRotate, mixX: c.mixX, mixY: c.mixY, mixScaleX: c.mixScaleX, mixScaleY: c.mixScaleY, mixShearY: c.mixShearY });
const PATH_SETUP = c => ({ position: c.position, spacing: c.spacing, mixRotate: c.mixRotate, mixX: c.mixX, mixY: c.mixY });
const PHYSICS_SETUP = c => ({ inertia: c.inertia, strength: c.strength, damping: c.damping, mass: c.mass, wind: c.wind, gravity: c.gravity, mix: c.mix });

/** The deform values a mesh has with no deform key: its own vertices (unweighted) or zero offsets (weighted). */
function setupDeform(att) {
  if (!att || att.type !== 'mesh') return null;
  return att.vertices.weighted ? new Float64Array(att.vertices.data.length / 3 * 2) : Float64Array.from(att.vertices.data);
}

/** The region path an attachment draws now: its own, or the frame of its sequence the slot shows. */
export function attachmentPath(slot, att) {
  if (!att.sequence) return att.path;
  const i = slot.sequenceIndex >= 0 ? slot.sequenceIndex : att.sequence.setup;
  return att.sequence.paths[Math.min(att.sequence.count - 1, i)];
}

/** World vertices of a region attachment: four corners in Spine's order (BL, UL, UR, BR). */
export function regionVertices(bone, att, region) {
  const r = region ?? { offsetX: 0, offsetY: 0, width: att.width, height: att.height, originalWidth: att.width, originalHeight: att.height };
  const rsx = att.width / r.originalWidth * att.scaleX, rsy = att.height / r.originalHeight * att.scaleY;
  const lx = -att.width / 2 * att.scaleX + r.offsetX * rsx, ly = -att.height / 2 * att.scaleY + r.offsetY * rsy;
  const lx2 = lx + r.width * rsx, ly2 = ly + r.height * rsy;
  const cos = cosDeg(att.rotation), sin = sinDeg(att.rotation);
  const lxc = lx * cos + att.x, lxs = lx * sin, lyc = ly * cos + att.y, lys = ly * sin;
  const lx2c = lx2 * cos + att.x, lx2s = lx2 * sin, ly2c = ly2 * cos + att.y, ly2s = ly2 * sin;
  const local = [lxc - lys, lyc + lxs, lxc - ly2s, ly2c + lxs, lx2c - ly2s, ly2c + lx2s, lx2c - lys, lyc + lx2s];
  const out = new Float64Array(8);
  for (let i = 0; i < 8; i += 2) {
    out[i] = local[i] * bone.a + local[i + 1] * bone.b + bone.worldX;
    out[i + 1] = local[i] * bone.c + local[i + 1] * bone.d + bone.worldY;
  }
  return out;
}

/** World vertices of a mesh or clipping attachment on a posed slot. */
export function meshVertices(pose, slot, att) {
  const v = att.vertices;
  const deform = slot.deform && slot.attachment === att ? slot.deform : null;
  const out = new Float64Array(v.count * 2);
  if (!v.weighted) {
    const bone = pose.bones[slot.data.bone];
    const src = deform ?? v.data;
    for (let i = 0; i < v.count * 2; i += 2) {
      const x = src[i], y = src[i + 1];
      out[i] = x * bone.a + y * bone.b + bone.worldX;
      out[i + 1] = x * bone.c + y * bone.d + bone.worldY;
    }
    return out;
  }
  let bi = 0, wi = 0, fi = 0;
  for (let i = 0; i < v.count * 2; i += 2) {
    let wx = 0, wy = 0;
    const n = v.bones[bi++];
    for (let j = 0; j < n; j++) {
      const bone = pose.bones[v.bones[bi++]];
      let x = v.data[wi], y = v.data[wi + 1];
      const w = v.data[wi + 2];
      wi += 3;
      if (deform) { x += deform[fi]; y += deform[fi + 1]; }
      fi += 2;
      wx += (x * bone.a + y * bone.b + bone.worldX) * w;
      wy += (x * bone.c + y * bone.d + bone.worldY) * w;
    }
    out[i] = wx; out[i + 1] = wy;
  }
  return out;
}
