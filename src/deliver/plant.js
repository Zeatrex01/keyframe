// Planted feet: a foot that stays where it stands while the body above it moves.
//
//   write_animation { ..., plant: ["footFront", "footBack"] }
//   write_animation { ..., plant: [{ bone: "footFront", from: 0, to: 0.4 }] }
//
// For each planted foot the two bones above it (the shin and the thigh, or a forearm and an upper
// arm for a hand on a wall) are turned, frame by frame, so the foot's joint stays on the point it
// stood on at `from` (or `at`, in world units), whatever the body does: a lean, a lunge, a crouch,
// a punch. The foot keeps the angle it stood at (flat stays flat, whatever the leg does). It is solved as two-bone
// inverse kinematics on the studio's engine and baked to ordinary rotate keys, so the delivery is
// plain animation data: every runtime, a sprite sheet and Godot play it the same. Outside its
// window a foot follows the clip as written.
//
// Pure: no I/O. Mutates the clip in `skeleton.animations[name]`.

import { StudioError } from '../shared/errors.js';
import { compileSkeleton, Pose } from '../engine/index.js';

const DEG = Math.PI / 180;
const fail = (where, message) => { throw new StudioError('bad-animation', `plant: ${where}: ${message}`, { where }); };
const r3 = v => Math.round(v * 1000) / 1000;
const wrap = a => { let x = a % 360; if (x > 180) x -= 360; if (x < -180) x += 360; return x; };

function durationOf(node) {
  let end = 0;
  const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.time === 'number') end = Math.max(end, v.time); Object.values(v).forEach(walk); } };
  walk(node);
  return end;
}

/** The plant requests, checked. */
function readRequests(plant, skeleton, end) {
  if (!Array.isArray(plant) || !plant.length || plant.length > 8) fail('plant', 'a list of 1-8 feet: "footFront" or { bone, from, to, at }.');
  const bones = new Map(skeleton.bones.map(b => [b.name, b]));
  return plant.map((p, i) => {
    const req = typeof p === 'string' ? { bone: p } : p;
    if (!req || typeof req.bone !== 'string') fail(`plant[${i}]`, 'name the foot bone.');
    for (const k of Object.keys(req)) if (!['bone', 'from', 'to', 'at'].includes(k)) fail(`plant[${i}]`, `"${k}" is not part of a plant (bone, from, to, at).`);
    const foot = bones.get(req.bone), shin = foot && bones.get(foot.parent), thigh = shin && bones.get(shin.parent);
    if (!foot) fail(`plant[${i}]`, `there is no bone "${req.bone}".`);
    if (!shin || !thigh) fail(`plant[${i}]`, `"${req.bone}" needs two bones above it (a shin and a thigh) to stay planted.`);
    const from = req.from ?? 0, to = req.to ?? end;
    if (!(from >= 0 && to >= from && to <= end + 1e-9)) fail(`plant[${i}]`, `from and to must lie in the clip (0 to ${r3(end)} s), from before to.`);
    if (req.at !== undefined && !(Array.isArray(req.at) && req.at.length === 2 && req.at.every(Number.isFinite))) fail(`plant[${i}]`, 'at is [x, y] in world units.');
    return { foot: foot.name, shin: shin.name, thigh: thigh.name, from, to, at: req.at ?? null };
  });
}

const det = b => (b ? b.a * b.d - b.b * b.c : 1);
const worldAngle = b => Math.atan2(b.c, b.a) / DEG;

/**
 * Bake planted feet into the clip `name` of `skeleton`.
 * @param {object} skeleton  the delivery, with the clip already composed in
 * @param {string} name
 * @param {Array<string|object>} plant
 * @param {{ fps?: number }} [options]
 * @returns {{ planted: Array<{ bone: string, from: number, to: number, at: number[], reach: number }>, bones: string[] }}
 *   planted: each foot, with reach, the farthest its leg had to stretch as a share of its length (1 means
 *   fully straight; above 1 the foot could not stay and lifted); bones: the bones whose rotate keys were baked
 */
export function plantFeet(skeleton, name, plant, { fps = 30 } = {}) {
  const clip = skeleton.animations?.[name];
  if (!clip) fail(name, 'no such clip.');
  const end = durationOf(clip);
  if (!(end > 0)) fail(name, 'the clip has no keys after 0: there is nothing for a foot to stand through.');
  const requests = readRequests(plant, skeleton, end);
  const model = compileSkeleton(skeleton);
  const anim = model.animations.get(name);
  const index = n => model.boneIndex.get(n);
  const pose = new Pose(model);
  const times = [...new Set([...Array.from({ length: Math.round(end * fps) + 1 }, (_, i) => Math.min(end, i / fps)), ...requests.flatMap(r => [r.from, r.to])].map(r3))].sort((a, b) => a - b);

  // Where each foot stands: its joint at `from` in the clip as written, unless `at` says.
  for (const r of requests) {
    if (r.at) continue;
    pose.apply(anim, r.from).updateWorld();
    const f = pose.bones[index(r.foot)];
    r.at = [f.worldX, f.worldY];
  }
  // And the angle it stands at: a foot flat on the ground stays flat while the leg above it turns.
  for (const r of requests) {
    pose.apply(anim, r.from).updateWorld();
    r.angle = worldAngle(pose.bones[index(r.foot)]);
  }

  const reach = new Map();
  /** The rotate value of every leg bone at time t, planted feet solved. */
  const solveAt = t => {
    pose.apply(anim, t).updateWorld();
    const offsets = new Map();
    for (const r of requests) {
      const thigh = pose.bones[index(r.thigh)], shin = pose.bones[index(r.shin)], foot = pose.bones[index(r.foot)];
      const offset = b => b.rotation - b.data.rotation;
      if (!offsets.has(r.thigh)) offsets.set(r.thigh, offset(thigh));
      if (!offsets.has(r.shin)) offsets.set(r.shin, offset(shin));
      if (!offsets.has(r.foot)) offsets.set(r.foot, offset(foot));
      if (t < r.from - 1e-9 || t > r.to + 1e-9) continue;
      const hip = [thigh.worldX, thigh.worldY], knee = [shin.worldX, shin.worldY], ankle = [foot.worldX, foot.worldY];
      const L1 = Math.hypot(knee[0] - hip[0], knee[1] - hip[1]), L2 = Math.hypot(ankle[0] - knee[0], ankle[1] - knee[1]);
      if (!(L1 > 0 && L2 > 0)) continue;
      const D = [r.at[0] - hip[0], r.at[1] - hip[1]], dRaw = Math.hypot(D[0], D[1]);
      const d = Math.max(Math.abs(L1 - L2) + 1e-6, Math.min(L1 + L2 - 1e-6, dRaw));
      reach.set(r.foot, Math.max(reach.get(r.foot) ?? 0, dRaw / (L1 + L2)));
      // The knee bends to the side it bends to in the clip as written.
      const cross = (knee[0] - hip[0]) * (ankle[1] - hip[1]) - (knee[1] - hip[1]) * (ankle[0] - hip[0]);
      const side = cross === 0 ? 1 : Math.sign(cross);
      const phi = Math.atan2(D[1], D[0]) / DEG;
      const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))) / DEG;
      const a1 = phi - side * alpha;
      const kneeNew = [hip[0] + L1 * Math.cos(a1 * DEG), hip[1] + L1 * Math.sin(a1 * DEG)];
      const a2 = Math.atan2(r.at[1] - kneeNew[1], r.at[0] - kneeNew[0]) / DEG;
      const w1 = Math.atan2(knee[1] - hip[1], knee[0] - hip[0]) / DEG, w2 = Math.atan2(ankle[1] - knee[1], ankle[0] - knee[0]) / DEG;
      const d1 = wrap(a1 - w1), dShin = wrap(a2 - w2);   // world turns of the thigh, and of the shin all told
      const parentOf = b => (b.data.parent >= 0 ? pose.bones[b.data.parent] : null);
      // A reflected parent turns its child the other way.
      offsets.set(r.thigh, offsets.get(r.thigh) + d1 * Math.sign(det(parentOf(thigh)) || 1));
      offsets.set(r.shin, offsets.get(r.shin) + (dShin - d1) * Math.sign(det(thigh) || 1));
      offsets.set(r.foot, offsets.get(r.foot) + wrap(r.angle - worldAngle(foot) - dShin) * Math.sign(det(shin) || 1));
    }
    return offsets;
  };
  // Sampled on the frame grid, then halved where a straight line between two samples strays from
  // the solution by more than a quarter of a degree, down to 1/8 of a frame: fast moves get dense keys.
  /** @type {Array<[number, Map<string, number>]>} */
  let samples = times.map(t => [t, solveAt(t)]);
  for (let pass = 0; pass < 3; pass++) {
    const next = [samples[0]];
    for (let i = 1; i < samples.length; i++) {
      const [t0, a] = samples[i - 1], [t1, b] = samples[i];
      const tm = (t0 + t1) / 2, m = solveAt(tm);
      if ([...m].some(([bone, v]) => Math.abs(v - (a.get(bone) + b.get(bone)) / 2) > 0.25)) next.push([tm, m]);
      next.push(samples[i]);
    }
    if (next.length === samples.length) break;
    samples = next;
  }
  const values = new Map();   // bone -> [time, value]
  for (const [t, offsets] of samples) for (const [bone, v] of offsets) { if (!values.has(bone)) values.set(bone, []); values.get(bone).push([t, v]); }

  // Dense linear keys; a value that does not change between neighbours is left out.
  clip.bones ??= {};
  for (const [bone, list] of values) {
    const keys = [];
    list.forEach(([t, v], i) => {
      const prev = list[i - 1], next = list[i + 1];
      if (prev && next && Math.abs(prev[1] - v) < 1e-3 && Math.abs(next[1] - v) < 1e-3) return;
      keys.push({ ...(t > 0 ? { time: Math.round(t * 1e5) / 1e5 } : {}), value: r3(v) });
    });
    clip.bones[bone] = { ...(clip.bones[bone] ?? {}), rotate: keys };
  }
  return {
    planted: requests.map(r => ({ bone: r.foot, from: r.from, to: r.to, at: r.at.map(r3), reach: r3(reach.get(r.foot) ?? 0) })),
    bones: [...values.keys()],
  };
}
