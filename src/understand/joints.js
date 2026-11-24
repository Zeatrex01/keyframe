// Limbs that come apart: a part drawn on a child bone (an arm, a hand, a leg, a tail) that drifts
// off the part it hangs from during a clip. The arm that floats away from the shoulder in a wave,
// because its bone was translated or its pivot is not at the joint.
//
// For each bone whose art is mostly outside its nearest drawn ancestor's art (a limb, not a
// detail painted on top like an eye), the joint is the point of the limb's art that touches the
// parent's art, nearest the limb's pivot. Through the clip the joint must stay on the parent's
// art: how far it leaves it is the separation. Measured on the posed skeleton with the region
// attachments' own sizes, so no atlas is needed. Pure and isomorphic.

import { compileSkeleton, Pose, regionVertices } from '../engine/index.js';

const FPS = 30;
const GRID = 6;

/** Points of a region's quad: a GRID x GRID lattice, as [u, v] in 0..1. */
const LATTICE = Array.from({ length: (GRID + 1) ** 2 }, (_, i) => [(i % (GRID + 1)) / GRID, Math.floor(i / (GRID + 1)) / GRID]);

/** A point on a quad (corners in regionVertices order) at lattice [u, v]. */
/** @param {ArrayLike<number>} q @param {number[]} uv @returns {number[]} */
function onQuad(q, [u, v]) {
  const x0 = q[0] + (q[6] - q[0]) * u, y0 = q[1] + (q[7] - q[1]) * u;   // bottom edge: corner 0 to 3
  const x1 = q[2] + (q[4] - q[2]) * u, y1 = q[3] + (q[5] - q[3]) * u;   // top edge: corner 1 to 2
  return [x0 + (x1 - x0) * v, y0 + (y1 - y0) * v];
}

const cross = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
/** Distance from a point to a quad: 0 inside. */
/** @param {ArrayLike<number>} q @param {number[]} p */
function quadDist(q, [px, py]) {
  const s = [0, 1, 2, 3].map(i => Math.sign(cross(q[i * 2], q[i * 2 + 1], q[(i * 2 + 2) % 8], q[(i * 2 + 3) % 8], px, py)));
  if (s.every(v => v >= 0) || s.every(v => v <= 0)) return 0;
  return Math.min(...[0, 1, 2, 3].map(i => segDist(px, py, q[i * 2], q[i * 2 + 1], q[(i * 2 + 2) % 8], q[(i * 2 + 3) % 8])));
}

/** World point of a bone-local point, and back. */
const toWorld = (/** @type {any} */ b, /** @type {number[]} */ [x, y]) => [x * b.a + y * b.b + b.worldX, x * b.c + y * b.d + b.worldY];
/** @param {any} b @param {number[]} p */
function toLocal(b, [x, y]) {
  const det = b.a * b.d - b.b * b.c || 1e-9, dx = x - b.worldX, dy = y - b.worldY;
  return [(dx * b.d - dy * b.b) / det, (dy * b.a - dx * b.c) / det];
}

/** The region a bone's art is: its largest region attachment shown in the setup pose. */
function artOf(pose) {
  const out = new Map();
  for (const slot of pose.slots) {
    const att = slot.attachment;
    if (!att || att.type !== 'region' || slot.data.blend !== 0) continue;   // additive glows and the like are not limbs
    const bone = pose.bones[slot.data.bone];
    const area = Math.abs(att.width * att.scaleX * att.height * att.scaleY);
    if (!(area > 0)) continue;
    const prev = out.get(bone);
    if (!prev || area > prev.area) out.set(bone, { slot, att, area });
  }
  return out;
}

/**
 * Where a clip pulls a limb off the part it hangs from.
 * @param {object} sk  skeleton JSON
 * @param {string} name  the clip
 * @returns {Array<{ limb: string, parent: string, bone: string, separation: number, time: number, size: number }>}
 */
export function jointSeparations(sk, name) {
  let model;
  try { model = compileSkeleton(sk); } catch { return []; }
  const anim = model.animations.get(name);
  if (!anim) return [];
  const pose = new Pose(model).updateWorld();
  const art = artOf(pose);
  // Each limb, with its joint, on the nearest ancestor that has art.
  const joints = [];
  for (const [bone, mine] of art) {
    let up = bone.data.parent === null || bone.data.parent === undefined ? null : pose.bones[bone.data.parent];
    while (up && !art.has(up)) up = up.data.parent === null || up.data.parent === undefined ? null : pose.bones[up.data.parent];
    if (!up) continue;
    const theirs = art.get(up);
    const q = regionVertices(bone, mine.att), p = regionVertices(up, theirs.att);
    const points = LATTICE.map(uv => onQuad(q, uv));
    const dist = points.map(pt => quadDist(p, pt));
    const inside = dist.filter(d => d === 0).length / points.length;
    if (inside > 0.9) continue;                       // painted on top (an eye, a pocket): not a limb
    const gap = Math.min(...dist);
    const size = Math.min(Math.abs(mine.att.width * mine.att.scaleX), Math.abs(mine.att.height * mine.att.scaleY));
    if (gap > Math.max(2, size * 0.25)) continue;     // drawn apart on purpose (a floating prop)
    // The joint: of the points that touch the parent, the one nearest the limb's pivot.
    let best = -1;
    points.forEach((pt, i) => {
      if (dist[i] > gap + 0.01) return;
      if (best < 0 || Math.hypot(pt[0] - bone.worldX, pt[1] - bone.worldY) < Math.hypot(points[best][0] - bone.worldX, points[best][1] - bone.worldY)) best = i;
    });
    joints.push({ bone, up, slot: mine.slot, parentSlot: theirs.slot, local: toLocal(bone, points[best]), gap, size });
  }
  if (!joints.length || !(anim.duration > 0)) return [];
  const worst = new Map();
  const steps = Math.max(2, Math.min(300, Math.ceil(anim.duration * FPS)));
  for (let i = 0; i <= steps; i++) {
    const time = anim.duration * i / steps;
    pose.apply(anim, time).updateWorld();
    for (const j of joints) {
      const mine = j.slot.attachment, theirs = j.parentSlot.attachment;
      if (!mine || !theirs || mine.type !== 'region' || theirs.type !== 'region') continue;   // a hidden part cannot come apart
      const sep = quadDist(regionVertices(j.up, theirs), toWorld(j.bone, j.local)) - j.gap;
      if (sep > (worst.get(j)?.separation ?? 0)) worst.set(j, { separation: sep, time });
    }
  }
  return [...worst].map(([j, w]) => ({ limb: j.slot.data.name, parent: j.parentSlot.data.name, bone: j.bone.data.name,
    separation: Math.round(w.separation * 10) / 10, time: Math.round(w.time * 1000) / 1000, size: Math.round(j.size * 10) / 10 }))
    .filter(s => s.separation > Math.max(2, s.size * 0.15));
}
