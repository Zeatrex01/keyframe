// A skeleton as Godot 4 builds it: the scene description the Keyframe add-on for Godot
// (integrations/godot) turns into Skeleton2D / Bone2D / Polygon2D nodes and an AnimationPlayer.
//
// Everything Godot's own 2D stack can carry stays editable there: a bone channel with normal
// inheritance and no constraint becomes a bezier track that keeps the authored handles. What
// Godot has no counterpart for (IK, transform and physics constraints, inherit modes other than
// normal, shear under rotation) is baked from the engine's world transforms into dense keys, and
// named in `report`; physics is played from the start on the engine's fixed grid, a looping clip
// one lap warmed up so its seam closes. Colour, draw order and mesh deform are sampled at `fps`;
// attachments switch on a nearest track, and a sequence (a flipbook) switches its polygon's
// texture coordinates frame by frame.
//
// Coordinates: Godot's y points down, so every y and every angle is mirrored; angles are radians.
// Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { compileSkeleton } from './model.js';
import { Pose, regionVertices, meshVertices } from './pose.js';
import { Playhead } from './index.js';
import { regionUVs, meshUVs } from './draws.js';
import { parseAtlas, atlasRegions } from './atlas.js';
import { controlPoints } from './curve.js';
import { toSkeletonJson, isKeyframeDocument } from './keyframe-format.js';
import { clipLoops, loopAnswer } from './loops.js';

export const GODOT_FORMAT = 'keyframe-godot';
const DEG = Math.PI / 180;
const EPS = 1e-4;
const BLEND_NAMES = ['normal', 'add', 'mul', 'screen'];

/** Spine world matrix -> Godot global { x: [x, y], y: [x, y], o: [x, y] } (columns, origin). */
const toGodot = b => ({ x: [b.a, -b.c], y: [-b.b, b.d], o: [b.worldX, -b.worldY] });
const IDENTITY = { x: [1, 0], y: [0, 1], o: [0, 0] };

function multiply(p, c) {
  return { x: [p.x[0] * c.x[0] + p.y[0] * c.x[1], p.x[1] * c.x[0] + p.y[1] * c.x[1]],
    y: [p.x[0] * c.y[0] + p.y[0] * c.y[1], p.x[1] * c.y[0] + p.y[1] * c.y[1]],
    o: [p.x[0] * c.o[0] + p.y[0] * c.o[1] + p.o[0], p.x[1] * c.o[0] + p.y[1] * c.o[1] + p.o[1]] };
}
function inverse(t) {
  const det = t.x[0] * t.y[1] - t.y[0] * t.x[1];
  const x = [t.y[1] / det, -t.x[1] / det], y = [-t.y[0] / det, t.x[0] / det];
  return { x, y, o: [-(x[0] * t.o[0] + y[0] * t.o[1]), -(x[1] * t.o[0] + y[1] * t.o[1])] };
}
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };

/** Godot's Node2D properties for a transform (inverse of Transform2D.set_rotation_scale_and_skew). */
export function decompose(t) {
  const rotation = Math.atan2(t.x[1], t.x[0]);
  const sx = Math.hypot(t.x[0], t.x[1]);
  const det = t.x[0] * t.y[1] - t.y[0] * t.x[1];
  const sign = det < 0 ? -1 : 1;
  const sy = sign * Math.hypot(t.y[0], t.y[1]);
  const skew = wrap(Math.atan2(sign * t.y[1], sign * t.y[0]) - Math.PI / 2 - rotation);
  return { position: [t.o[0], t.o[1]], rotation, scale: [sx, sy], skew };
}
/** Transform2D from Node2D properties (Godot's set_rotation_scale_and_skew plus origin). */
export function compose({ position, rotation, scale, skew }) {
  return { x: [Math.cos(rotation) * scale[0], Math.sin(rotation) * scale[0]],
    y: [-Math.sin(rotation + skew) * scale[1], Math.cos(rotation + skew) * scale[1]], o: [position[0], position[1]] };
}

const flipPairs = values => Array.from(values, (v, i) => (i % 2 ? -v : v));
const round = v => Math.round(v * 1e6) / 1e6;
const color = c => [round(c.r), round(c.g), round(c.b), round(c.a)];

function frames(duration, fps) {
  const out = [];
  const n = Math.max(1, Math.ceil(duration * fps - 1e-6));
  for (let i = 0; i <= n; i++) out.push(Math.min(duration, i / fps));
  return out;
}

/** Which bones a clip can key as Godot tracks (the rest are baked), and why not. */
function keyability(model) {
  const why = new Map();
  for (const c of model.ik) for (const b of c.bones) why.set(b, `ik ${c.name}`);
  for (const c of model.transform) for (const b of c.bones) why.set(b, `transform ${c.name}`);
  for (const c of model.physics) why.set(c.bone, `physics ${c.name}`);
  for (const b of model.bones) {
    if (b.inherit !== 0) why.set(b.index, 'inherit mode');
    else if (b.shearX || b.shearY) why.set(b.index, 'shear');
  }
  return why;
}

/** One bone property as a Godot bezier track that keeps the authored curves. */
function bezierTrack(bone, property, channel, map, duration, identity) {
  const { times, values, curves } = channel;
  const keys = [];
  const at = i => ({ time: times[i], value: map(values[i]) });
  const setup = map(identity);
  if (times[0] > EPS) keys.push({ time: 0, value: setup, in: [0, 0], out: [0, 0] }, { time: Math.max(0, times[0] - 1e-3), value: setup, in: [0, 0], out: [0, 0] });
  for (let i = 0; i < times.length; i++) {
    const k = { ...at(i), in: [0, 0], out: [0, 0] };
    const prev = keys[keys.length - 1];
    if (i > 0) {
      const c = curves[i - 1];
      if (c.kind === 'stepped') keys.push({ time: Math.max(prev.time, times[i] - 1e-3), value: prev.value, in: [0, 0], out: [0, 0] });
      else if (c.kind !== 'linear') {
        const [cx1, cy1, cx2, cy2] = controlPoints(c, times[i - 1], values[i - 1], times[i], values[i]);
        prev.out = [cx1 - prev.time, map(cy1) - prev.value];
        k.in = [cx2 - k.time, map(cy2) - k.value];
      }
    }
    keys.push(k);
  }
  if (keys[keys.length - 1].time < duration - EPS) keys.push({ ...keys[keys.length - 1], time: duration, in: [0, 0], out: [0, 0] });
  for (const k of keys) { k.time = round(k.time); k.value = round(k.value); k.in = k.in.map(round); k.out = k.out.map(round); }
  return { target: 'bone', name: bone.name, property, type: 'bezier', keys };
}

const KEYED = {
  rotation: (b, v) => -(b.rotation + v) * DEG, x: (b, v) => b.x + v, y: (b, v) => -(b.y + v),
  scaleX: (b, v) => b.scaleX * v, scaleY: (b, v) => b.scaleY * v,
};
const GODOT_PROPERTY = { rotation: 'rotation', x: 'position:x', y: 'position:y', scaleX: 'scale:x', scaleY: 'scale:y' };

/**
 * The scene description of a skeleton for the Godot add-on.
 * @param {object} json  Spine 4.2 JSON or a Keyframe document
 * @param {{ atlasText: string, fps?: number, skin?: string, name?: string, loops?: Record<string, boolean> }} options  `loops`: per clip, loops or plays once (wins over the written answer and the guess)
 */
export function godotScene(json, { atlasText, fps = 30, skin, name, loops } = /** @type {any} */ ({})) {
  if (typeof atlasText !== 'string') throw new StudioError('bad-argument', 'The Godot scene needs the skeleton\'s atlas.');
  if (!(fps >= 1 && fps <= 240)) throw new StudioError('bad-argument', 'fps must be between 1 and 240.', { fps });
  const source = isKeyframeDocument(json) ? toSkeletonJson(json) : json;
  const model = compileSkeleton(source);
  const atlas = parseAtlas(atlasText);
  const regionOf = atlasRegions(atlas);
  const report = { baked: [], approximated: [], skipped: [...model.unsupported] };
  const blocked = keyability(model);

  const setup = new Pose(model, { skin }).updateWorld();
  const globals = setup.bones.map(toGodot);
  const bones = model.bones.map((b, i) => {
    const local = decompose(b.parent >= 0 ? multiply(inverse(globals[b.parent]), globals[i]) : globals[i]);
    return { name: b.name, parent: b.parent >= 0 ? model.bones[b.parent].name : null, length: round(b.length),
      rest: { position: local.position.map(round), rotation: round(local.rotation), scale: local.scale.map(round), skew: round(local.skew) } };
  });
  for (const [index, reason] of blocked) report.baked.push(`bone ${model.bones[index].name}: ${reason}`);

  // Attachments as polygons: in bone space, or skinned in skeleton space when weighted.
  const pages = new Map(atlas.pages.map(p => [p.name, p]));
  const slots = model.slots.map((s, index) => {
    const attachments = [];
    for (const table of [setup.skin, model.defaultSkin]) {
      for (const [, att] of table?.get(index) ?? []) {
        if (attachments.some(a => a.name === att.name) || (att.type !== 'region' && att.type !== 'mesh')) {
          // A clipping mask the slot shows in the setup pose becomes the slot's `clip` (below).
          if (att.type === 'clipping' && !(setup.slots[index].attachment === att && !att.vertices.weighted)) report.skipped.push(`clipping:${s.name}/${att.name}`);
          continue;
        }
        const path = att.sequence ? att.sequence.paths[att.sequence.setup] : att.path;
        const region = regionOf(path);
        if (!region) { report.skipped.push(`missing-region:${path}`); continue; }
        const page = pages.get(region.page);
        const uvs = att.type === 'region' ? regionUVs(region) : meshUVs(att.uvs, region);
        const uv = Array.from(uvs, (v, i) => round(v * (i % 2 ? page.height : page.width)));
        const base = { name: att.name, page: region.page, color: color(att.color), uv };
        if (att.sequence) {
          // A flipbook: each frame's texture coordinates (and its polygon, for a region trimmed differently).
          base.frames = att.sequence.paths.map(p => {
            const r = regionOf(p);
            if (!r) { report.skipped.push(`missing-region:${p}`); return null; }
            const pg = pages.get(r.page);
            const fuv = att.type === 'region' ? regionUVs(r) : meshUVs(att.uvs, r);
            return { page: r.page, uv: Array.from(fuv, (v, i) => round(v * (i % 2 ? pg.height : pg.width))),
              ...(att.type === 'region' ? { polygon: flipPairs(regionVertices({ a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 }, att, r)).map(round) } : {}) };
          });
        }
        if (att.type === 'region') {
          const corners = regionVertices({ a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 }, att, region);
          attachments.push({ ...base, type: 'region', polygon: flipPairs(corners).map(round), triangles: [0, 1, 2, 2, 3, 0] });
        } else if (!att.vertices.weighted) {
          attachments.push({ ...base, type: 'mesh', polygon: flipPairs(att.vertices.data).map(round), triangles: Array.from(att.triangles) });
        } else {
          const slot = setup.slots[index];
          const was = slot.attachment;
          slot.attachment = att;
          const rest = meshVertices(setup, slot, att);
          slot.attachment = was;
          const weights = new Map();
          const v = att.vertices;
          for (let i = 0, bi = 0, wi = 0; i < v.count; i++) {
            const n = v.bones[bi++];
            for (let j = 0; j < n; j++, wi += 3) {
              const bone = model.bones[v.bones[bi++]].name;
              if (!weights.has(bone)) weights.set(bone, new Array(v.count).fill(0));
              weights.get(bone)[i] += v.data[wi + 2];
            }
          }
          attachments.push({ ...base, type: 'skinned', polygon: flipPairs(rest).map(round), triangles: Array.from(att.triangles),
            weights: Object.fromEntries([...weights].map(([bone, w]) => [bone, w.map(round)])) });
        }
      }
    }
    if (s.blend === 3) report.approximated.push(`blend screen:${s.name}`);
    if (s.dark) report.skipped.push(`tint-black:${s.name}`);
    // A clipping mask: its polygon in bone space, and the last slot it clips (the next slots in draw order up to it).
    const shown = setup.slots[index].attachment;
    const clip = shown?.type === 'clipping' && !shown.vertices.weighted
      ? { polygon: flipPairs(shown.vertices.data).map(round), end: shown.end ?? model.slots[model.slots.length - 1].name } : null;
    return { name: s.name, bone: model.bones[s.bone].name, z: setup.drawOrder.indexOf(setup.slots[index]), color: color(s.color),
      blend: BLEND_NAMES[s.blend] ?? 'normal', attachment: shown?.name ?? null, attachments, ...(clip ? { clip } : {}) };
  });

  const animations = [...model.animations.values()].map(animation => sceneAnimation(model, animation, { fps, skin, blocked, slots, report, asked: loopAnswer(animation.name, loops, json) }));
  return { format: GODOT_FORMAT, version: 1, name: name ?? model.name ?? 'skeleton', fps,
    pages: atlas.pages.map(p => ({ name: p.name, width: p.width, height: p.height, pma: p.pma })), bones, slots, animations,
    report: { baked: [...new Set(report.baked)], approximated: [...new Set(report.approximated)], skipped: [...new Set(report.skipped)].sort() } };
}

function sceneAnimation(model, animation, { fps, skin, blocked: always, slots, report, asked }) {
  const blocked = new Map(always);
  const duration = animation.duration;
  const times = frames(duration, fps);
  let poses = times.map(t => new Pose(model, { skin }).apply(animation, Math.fround(t)).updateWorld());
  // Whether it loops is read off the motion as written: physics never lands exactly where it started.
  const loops = clipLoops(animation.name, seamless(poses), asked);
  if (model.physics.length) {
    // Physics plays from the start; a clip that loops is recorded on its second lap, so the swing
    // at its end runs on into its start.
    const warm = loops && duration > 0 ? duration : 0;
    const head = new Playhead(model, animation, { skin, loop: warm > 0 });
    poses = times.map(t => frozen(head.at(Math.min(warm + t, warm + duration))));
    report.baked.push(`physics in ${animation.name}${warm ? ' (second lap, so the loop closes)' : ''}`);
  }
  const tracks = [];
  const touched = new Set();
  const keyed = new Map();
  for (const t of animation.timelines) if (t.kind === 'bone') touched.add(t.bone);
  for (const t of animation.timelines) if (t.kind === 'bone' && (t.property === 'shearX' || t.property === 'shearY')) blocked.set(t.bone, 'shear keys');
  for (const t of animation.timelines) {
    if (t.kind !== 'bone' || blocked.has(t.bone)) continue;
    const bone = model.bones[t.bone];
    keyed.set(t.bone, true);
    tracks.push(bezierTrack(bone, GODOT_PROPERTY[t.property], t.channel, v => KEYED[t.property](bone, v), duration, t.property.startsWith('scale') ? 1 : 0));
  }
  // Baked: every bone a constraint or an inherit mode moves, and the bones it keys that cannot be keyed.
  const ikBones = new Set([...model.ik.flatMap(c => c.bones), ...model.transform.flatMap(c => c.bones), ...model.physics.map(c => c.bone)]);
  for (const bone of model.bones) {
    const i = bone.index;
    if (!blocked.has(i) || !(touched.has(i) || ikBones.has(i) || bone.inherit !== 0 || hasMovingAncestor(model, i, touched))) continue;
    const props = poses.map(p => {
      const g = toGodot(p.bones[i]);
      return decompose(bone.parent >= 0 ? multiply(inverse(toGodot(p.bones[bone.parent])), g) : g);
    });
    let last = props[0].rotation;
    const rotations = props.map(p => { last += wrap(p.rotation - last); return last; });
    const key = (values, map) => values.map((v, f) => ({ time: round(times[f]), value: map(v, f) }));
    tracks.push({ target: 'bone', name: bone.name, property: 'position', type: 'value', interpolation: 'linear', keys: key(props, p => p.position.map(round)) });
    tracks.push({ target: 'bone', name: bone.name, property: 'rotation', type: 'value', interpolation: 'linear', keys: key(rotations, round) });
    tracks.push({ target: 'bone', name: bone.name, property: 'scale', type: 'value', interpolation: 'linear', keys: key(props, p => p.scale.map(round)) });
    tracks.push({ target: 'bone', name: bone.name, property: 'skew', type: 'value', interpolation: 'linear', keys: key(props, p => round(p.skew)) });
    if (touched.has(i)) report.baked.push(`bone ${bone.name} in ${animation.name}`);
  }

  for (const t of animation.timelines) {
    if (t.kind === 'attachment') {
      tracks.push({ target: 'slot', name: model.slots[t.slot].name, property: 'attachment', type: 'value', interpolation: 'nearest',
        keys: changes(times, poses.map(p => p.slots[t.slot].attachment?.name ?? null), t.times) });
    }
  }
  const colored = new Set(animation.timelines.filter(t => t.kind === 'color').map(t => t.slot));
  for (const s of colored) {
    tracks.push({ target: 'slot', name: model.slots[s].name, property: 'modulate', type: 'value', interpolation: 'linear',
      keys: poses.map((p, f) => ({ time: round(times[f]), value: color(p.slots[s].color) })) });
  }
  const order = animation.timelines.find(t => t.kind === 'drawOrder');
  if (order) {
    for (const slot of model.slots) {
      tracks.push({ target: 'slot', name: slot.name, property: 'z_index', type: 'value', interpolation: 'nearest',
        keys: changes(times, poses.map(p => p.drawOrder.findIndex(x => x.data.index === slot.index)), order.times) });
    }
  }
  for (const t of animation.timelines) {
    if (t.kind !== 'sequence') continue;
    const slot = model.slots[t.slot];
    const scene = slots[t.slot].attachments.find(a => a.name === t.attachment.name);
    if (!scene?.frames) continue;
    const shown = poses.map(p => (p.slots[t.slot].attachment === t.attachment ? Math.max(0, p.slots[t.slot].sequenceIndex >= 0 ? p.slots[t.slot].sequenceIndex : t.attachment.sequence.setup) : t.attachment.sequence.setup));
    const keysOf = read => changes(times, shown.map(i => JSON.stringify(read(scene.frames[i] ?? scene.frames[t.attachment.sequence.setup]))), t.times).map(k => ({ time: k.time, value: JSON.parse(k.value) }));
    tracks.push({ target: 'attachment', name: slot.name, attachment: t.attachment.name, property: 'uv', type: 'value', interpolation: 'nearest', keys: keysOf(f => f?.uv ?? scene.uv) });
    if (scene.type === 'region') tracks.push({ target: 'attachment', name: slot.name, attachment: t.attachment.name, property: 'polygon', type: 'value', interpolation: 'nearest', keys: keysOf(f => f?.polygon ?? scene.polygon) });
    if (new Set(scene.frames.map(f => f?.page)).size > 1) tracks.push({ target: 'attachment', name: slot.name, attachment: t.attachment.name, property: 'texture', type: 'value', interpolation: 'nearest', keys: keysOf(f => f?.page ?? scene.page) });
  }
  for (const t of animation.timelines) {
    if (t.kind !== 'deform') continue;
    const slot = model.slots[t.slot];
    const scene = slots[t.slot].attachments.find(a => a.name === t.attachment.name);
    if (!scene) continue;
    tracks.push({ target: 'attachment', name: slot.name, attachment: t.attachment.name, property: 'polygon', type: 'value', interpolation: 'linear',
      keys: poses.map((p, f) => ({ time: round(times[f]), value: deformed(p, t.slot, t.attachment, scene.type).map(round) })) });
    report.baked.push(`deform ${slot.name}/${t.attachment.name} in ${animation.name}`);
  }
  const events = animation.timelines.find(t => t.kind === 'event');
  if (events) {
    tracks.push({ target: 'root', property: 'events', type: 'method', keys: events.events.map(e => ({ time: round(e.time), name: e.name,
      int: e.int ?? 0, float: e.float ?? 0, string: e.string ?? '' })) });
  }
  return { name: animation.name, length: round(duration), loop: loops, tracks };
}

/** A copy of what a sampled pose shows, so a playhead can go on posing the next frame. @returns {any} */
function frozen(pose) {
  const slots = pose.slots.map(s => ({ ...s, color: { ...s.color }, dark: s.dark ? { ...s.dark } : null }));
  return { model: pose.model, bones: pose.bones.map(b => ({ ...b })), slots, drawOrder: pose.drawOrder.map(s => slots[s.data.index]) };
}

function hasMovingAncestor(model, index, touched) {
  for (let p = model.bones[index].parent; p >= 0; p = model.bones[p].parent) if (touched.has(p)) return true;
  return false;
}

/** Keys only where a sampled value changes, plus at each authored key time (nearest tracks). */
function changes(times, values, keyTimes) {
  const keys = [{ time: 0, value: values[0] }];
  for (let f = 1; f < times.length; f++) if (values[f] !== values[f - 1]) keys.push({ time: round(times[f]), value: values[f] });
  for (const t of keyTimes) {
    if (t <= 0 || keys.some(k => Math.abs(k.time - t) < EPS)) continue;
    const f = times.findIndex(x => x >= t - EPS);
    if (f >= 0) keys.push({ time: round(t), value: values[f] });
  }
  return keys.sort((a, b) => a.time - b.time);
}

/** A deformed mesh's polygon in the space its Polygon2D lives in. */
function deformed(pose, slotIndex, attachment, type) {
  const slot = pose.slots[slotIndex];
  const was = slot.attachment;
  slot.attachment = attachment;
  let out;
  if (type === 'skinned') {
    // The rest polygon a skinned Polygon2D starts from: the deform applied at the setup bones.
    const rest = new Pose(pose.model).updateWorld();
    rest.slots[slotIndex].attachment = attachment;
    rest.slots[slotIndex].deform = slot.deform;
    out = meshVertices(rest, rest.slots[slotIndex], attachment);
  } else {
    out = slot.deform && was === attachment ? Float64Array.from(slot.deform) : Float64Array.from(attachment.vertices.data);
  }
  slot.attachment = was;
  return flipPairs(out);
}

/** A clip whose last pose is its first (it loops in Godot unless its name says it plays once). */
function seamless(poses) {
  const [a, b] = [poses[0], poses[poses.length - 1]];
  if (poses.length < 3) return false;
  return a.bones.every((x, i) => Math.abs(x.worldX - b.bones[i].worldX) < 0.01 && Math.abs(x.worldY - b.bones[i].worldY) < 0.01
    && Math.abs(x.a - b.bones[i].a) < 1e-4 && Math.abs(x.c - b.bones[i].c) < 1e-4);
}

export { IDENTITY, multiply, inverse, toGodot };
