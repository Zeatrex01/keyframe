// Posing a compiled skeleton (src/engine/model.js): apply an animation at an instant, compute
// world transforms, and collect what is drawn. The arithmetic follows the Spine 4.2 format's
// documented semantics (offsets from setup for rotate, translate and shear; a multiplier for
// scale; bezier segments read as a nine-point polyline), so a clip plays the same here and in
// any Spine runtime. test/engine-parity.test.js holds the two side by side.
//
// Stateless per instant: posing at t never depends on which instants were posed before.
//
// Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { channelValue, keyIndex, segmentPercent } from './curve.js';
import { colorAt } from './model.js';
import { applyConstraints } from './constraints.js';

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
    this.bones = model.bones.map(data => ({ data, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 }));
    this.slots = model.slots.map(data => ({ data, color: { ...data.color }, dark: data.dark ? { ...data.dark } : null, attachment: null, deform: null }));
    this.drawOrder = this.slots.slice();
    this.ik = (model.ik ?? []).map(c => ({ mix: c.mix, softness: c.softness, bendDirection: c.bendDirection, compress: c.compress, stretch: c.stretch, uniform: c.uniform }));
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
      b.x = d.x; b.y = d.y; b.rotation = d.rotation; b.scaleX = d.scaleX; b.scaleY = d.scaleY; b.shearX = d.shearX; b.shearY = d.shearY;
    }
    for (const s of this.slots) this.setupSlot(s);
    this.drawOrder = this.slots.slice();
    (this.model.ik ?? []).forEach((c, i) => Object.assign(this.ik[i], { mix: c.mix, softness: c.softness, bendDirection: c.bendDirection, compress: c.compress, stretch: c.stretch }));
  }

  setupSlot(s) {
    Object.assign(s.color, s.data.color);
    if (s.dark && s.data.dark) Object.assign(s.dark, s.data.dark);
    s.deform = null;
    this.setAttachment(s, s.data.attachmentName);
  }

  setAttachment(s, name) {
    const attachment = this.attachmentFor(s.data.index, name);
    if (attachment !== s.attachment) s.deform = null;
    s.attachment = attachment;
  }

  /**
   * Apply an animation at `time` (seconds) over the setup pose: what a property's timeline does
   * not key stays at setup.
   */
  apply(animation, time, { loop = false } = {}) {
    if (loop && animation.duration > 0) time %= animation.duration;
    this.setupPose();
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
        default: break; // deform after attachments are settled; events draw nothing
      }
    }
    for (const t of animation.timelines) {
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

  /** World transforms of every bone, parents first (bones are ordered parents first). */
  updateWorld() {
    for (const bone of this.bones) this.updateBone(bone, bone);
    applyConstraints(this);
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
    const mode = bone.data.inherit;
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
    const mode = bone.data.inherit;
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
