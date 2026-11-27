// The Keyframe engine's model of a skeleton: compiled once from Spine 4.2 JSON (the data
// format, read without any Spine code), then posed any number of times (src/engine/pose.js).
//
// Clean-room: written from the Spine JSON format documentation and checked number by number
// against the official runtime by test/engine-parity.test.js when the Spine add-on is present.
// What the engine does not evaluate (timelines it does not know, deform on an attachment that
// has no vertices) is listed in `unsupported`, never ignored in silence; where it evaluates
// something its own way (physics) the model says so in `approximations`.
//
// Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { compileChannel, resolveCurve, keyIndex, segmentPercent, segmentValue } from './curve.js';
import { compileIk, compileIkTimelines, compileTransform, compileTransformTimelines, compilePhysics, compilePhysicsTimelines, compilePath, compilePathTimelines, constraintOrder } from './constraints.js';

export const INHERIT = Object.freeze({ normal: 0, onlyTranslation: 1, noRotationOrReflection: 2, noScale: 3, noScaleOrReflection: 4 });
export const BLEND = Object.freeze({ normal: 0, additive: 1, multiply: 2, screen: 3 });

const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => (isNumber(v) ? v : d);

/** "rrggbbaa" or "rrggbb" -> { r, g, b, a } in 0..1. */
export function parseColor(hex, fallback = { r: 1, g: 1, b: 1, a: 1 }) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return { ...fallback };
  const byte = i => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: byte(0), g: byte(2), b: byte(4), a: hex.length === 8 ? byte(6) : 1 };
}

/** Spine's legacy curve form on a key: "stepped", or numbers [cx1, cy1, cx2, cy2, ...] in seconds/values. */
function spineCurve(curve, field) {
  if (curve === 'stepped') return 'stepped';
  if (Array.isArray(curve) && curve.length >= field * 4 + 4) return { absolute: curve.slice(field * 4, field * 4 + 4) };
  return undefined;
}

function compileAttachment(raw, name, slotName, skinName, unsupported) {
  const type = raw.type ?? 'region';
  const path = raw.path ?? raw.name ?? name;
  const color = parseColor(raw.color);
  const sequence = raw.sequence ? compileSequence(raw.sequence, path) : null;
  if (type === 'region') {
    return { type, name, path, color, sequence, x: num(raw.x, 0), y: num(raw.y, 0), rotation: num(raw.rotation, 0),
      scaleX: num(raw.scaleX, 1), scaleY: num(raw.scaleY, 1), width: num(raw.width, 32), height: num(raw.height, 32) };
  }
  if (type === 'mesh') {
    const uvs = Float64Array.from(raw.uvs ?? []);
    return { type, name, path, color, sequence, uvs, triangles: Uint32Array.from(raw.triangles ?? []), vertices: compileVertices(raw.vertices ?? [], uvs.length / 2),
      hull: num(raw.hull, 0), width: num(raw.width, 0), height: num(raw.height, 0) };
  }
  if (type === 'linkedmesh') return { type: 'linkedmesh', name, path, color, sequence, parent: raw.parent, skin: raw.skin ?? 'default', timelines: raw.timelines !== false };
  if (type === 'clipping') {
    const count = num(raw.vertexCount, 0);
    return { type, name, end: raw.end ?? null, vertices: compileVertices(raw.vertices ?? [], count), color };
  }
  if (type === 'path') {
    // A path's vertices are curve segments of three points each; any other count has no shape,
    // and the official runtime refuses the file ("Invalid array length"), so the engine does too.
    const count = num(raw.vertexCount, 0);
    if (count % 3 !== 0) {
      throw new StudioError('bad-skeleton', `Path attachment "${name}" on slot "${slotName}" has vertexCount ${count}, which is not a multiple of 3 (the studio's path repair fixes it).`,
        { slot: slotName, attachment: name, vertexCount: count });
    }
    return { type, name, color, closed: !!raw.closed, constantSpeed: raw.constantSpeed !== false,
      lengths: Float64Array.from(raw.lengths ?? []), vertices: compileVertices(raw.vertices ?? [], count) };
  }
  return { type, name, ignored: true };
}

/**
 * A sequence (a flipbook in one attachment): `count` images named <path><start + i>, the index
 * padded to `digits`; `setup` is the frame shown when no sequence timeline drives it.
 */
export function compileSequence(raw, path) {
  const count = Math.max(1, Math.floor(num(raw.count, 1)));
  const start = Math.floor(num(raw.start, 1)), digits = Math.max(0, Math.floor(num(raw.digits, 0)));
  const setup = Math.min(count - 1, Math.max(0, Math.floor(num(raw.setup, 0))));
  return { count, start, digits, setup, paths: Array.from({ length: count }, (_, i) => `${path}${String(start + i).padStart(digits, '0')}`) };
}

/** The frame a sequence key shows `elapsed` seconds after its key, by Spine's sequence modes. */
export const SEQUENCE_MODES = Object.freeze(['hold', 'once', 'loop', 'pingpong', 'onceReverse', 'loopReverse', 'pingpongReverse']);
export function sequenceFrame(mode, index, delay, elapsed, count) {
  if (mode === 'hold' || !(delay > 0)) return Math.min(count - 1, Math.max(0, index));
  const i = index + Math.floor(elapsed / delay + 1e-5);
  const n = count * 2 - 2;
  switch (mode) {
    case 'once': return Math.min(count - 1, i);
    case 'loop': return i % count;
    case 'pingpong': { if (n <= 0) return 0; const j = i % n; return j >= count ? n - j : j; }
    case 'onceReverse': return Math.max(count - 1 - i, 0);
    case 'loopReverse': return count - 1 - (i % count);
    case 'pingpongReverse': { if (n <= 0) return 0; const j = (i + count - 1) % n; return j >= count ? n - j : j; }
    default: return Math.min(count - 1, Math.max(0, index));
  }
}

/** Spine's vertex encoding: plain [x, y, ...] or weighted [count, bone, x, y, w, ...]. */
export function compileVertices(values, count) {
  if (values.length === count * 2) return { weighted: false, data: Float64Array.from(values), count };
  const bones = [], weights = [];
  for (let i = 0; i < values.length;) {
    const n = values[i++];
    bones.push(n);
    for (let j = 0; j < n; j++) { bones.push(values[i]); weights.push(values[i + 1], values[i + 2], values[i + 3]); i += 4; }
  }
  return { weighted: true, bones: Int32Array.from(bones), data: Float64Array.from(weights), count };
}

/** Bone channel compile: rotate/translate/scale/shear and their split forms. */
const BONE_CHANNELS = {
  rotate: [['value', 'rotation', 0]],
  translate: [['x', 'x', 0], ['y', 'y', 0]], translatex: [['value', 'x', 0]], translatey: [['value', 'y', 0]],
  scale: [['x', 'scaleX', 1], ['y', 'scaleY', 1]], scalex: [['value', 'scaleX', 1]], scaley: [['value', 'scaleY', 1]],
  shear: [['x', 'shearX', 0], ['y', 'shearY', 0]], shearx: [['value', 'shearX', 0]], sheary: [['value', 'shearY', 0]],
};

function channelFromSpine(keys, field, fieldIndex, defaultValue, where) {
  return compileChannel(keys.map(k => ({ time: num(k.time, 0), value: num(k[field], defaultValue), curve: spineCurve(k.curve, fieldIndex) })), defaultValue, where);
}

/** A colour channel: several values that share key times, each with its own curve field. */
function colorChannel(keys, parts, where) {
  const times = Float32Array.from(keys.map(k => num(k.time, 0)));
  const values = keys.map(k => parts.map(p => p.read(k)));
  const curves = keys.map((k, i) => parts.map((p, f) => resolveCurve(spineCurve(k.curve, f), `${where}[${i}]`)));
  return { times, values, curves, parts };
}

function colorAt(channel, time) {
  const { times, values, curves } = channel;
  const i = keyIndex(times, time);
  if (i < 0) return undefined;
  if (i === times.length - 1) return values[i];
  return values[i].map((v0, f) => segmentValue(curves[i][f], times[i], v0, times[i + 1], values[i + 1][f], time));
}

const hexPart = (hex, i, fallback) => (typeof hex === 'string' && hex.length >= i + 2 ? parseInt(hex.slice(i, i + 2), 16) / 255 : fallback);

/**
 * Compile Spine 4.2 skeleton JSON into the engine's model.
 * @param {object} json
 */
export function compileSkeleton(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.bones)) {
    throw new StudioError('bad-skeleton', 'A skeleton needs a "bones" array.');
  }
  const unsupported = new Set();
  const boneIndex = new Map();
  const bones = json.bones.map((b, index) => {
    if (typeof b?.name !== 'string') throw new StudioError('bad-skeleton', `Bone ${index} has no name.`, { index });
    if (boneIndex.has(b.name)) throw new StudioError('bad-skeleton', `Two bones are named "${b.name}".`, { bone: b.name });
    const parent = b.parent === undefined || b.parent === null ? -1 : boneIndex.get(b.parent);
    if (parent === undefined) throw new StudioError('bad-skeleton', `Bone "${b.name}" names parent "${b.parent}", which is not defined before it.`, { bone: b.name, parent: b.parent });
    boneIndex.set(b.name, index);
    const inheritName = b.inherit ?? b.transform ?? 'normal';
    if (!Object.hasOwn(INHERIT, inheritName)) throw new StudioError('bad-skeleton', `Bone "${b.name}" has an unknown inherit "${inheritName}".`, { bone: b.name });
    return { name: b.name, skinRequired: !!b.skin, index, parent, x: num(b.x, 0), y: num(b.y, 0), rotation: num(b.rotation, 0), scaleX: num(b.scaleX, 1), scaleY: num(b.scaleY, 1),
      shearX: num(b.shearX, 0), shearY: num(b.shearY, 0), length: num(b.length, 0), inherit: INHERIT[inheritName] };
  });
  const slotIndex = new Map();
  const slots = (json.slots ?? []).map((s, index) => {
    const bone = boneIndex.get(s.bone);
    if (bone === undefined) throw new StudioError('bad-skeleton', `Slot "${s.name}" names bone "${s.bone}", which does not exist.`, { slot: s.name, bone: s.bone });
    slotIndex.set(s.name, index);
    const blend = Object.hasOwn(BLEND, s.blend ?? 'normal') ? BLEND[s.blend ?? 'normal'] : 0;
    return { name: s.name, index, bone, color: parseColor(s.color), dark: s.dark ? parseColor(s.dark) : null, attachmentName: s.attachment ?? null, blend };
  });
  const approximations = new Set();
  const ik = compileIk(json, boneIndex);
  const ikByName = new Map(ik.map(c => [c.name, c]));
  const transform = compileTransform(json, boneIndex);
  const transformByName = new Map(transform.map(c => [c.name, c]));
  const physics = compilePhysics(json, boneIndex);
  const physicsByName = new Map(physics.map(c => [c.name, c]));
  const path = compilePath(json, boneIndex, slotIndex);
  const pathByName = new Map(path.map(c => [c.name, c]));
  for (const c of physics) approximations.add(`physics:${c.name}`);
  // A constraint marked `skin` acts only while the shown skin lists it, like a bone marked so.
  for (const [kind, list] of [['ik', ik], ['transform', transform], ['path', path], ['physics', physics]]) {
    list.forEach((c, i) => { c.skinRequired = !!json[kind][i]?.skin; });
  }

  // Skins: 4.x is an array of { name, attachments: { slot: { name: attachment } } }.
  const skins = new Map();
  const skinRequires = new Map();   // skin -> the bones and constraints it switches on
  const rawSkins = Array.isArray(json.skins) ? json.skins
    : Object.entries(json.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));
  for (const skin of rawSkins) {
    const table = new Map();
    for (const [slotName, entries] of Object.entries(skin.attachments ?? {})) {
      const si = slotIndex.get(slotName);
      if (si === undefined) continue;
      const map = new Map();
      for (const [name, raw] of Object.entries(entries ?? {})) map.set(name, compileAttachment(raw ?? {}, name, slotName, skin.name, unsupported));
      table.set(si, map);
    }
    skins.set(skin.name, table);
    const bonesOf = (skin.bones ?? []).map(name => boneIndex.get(name)).filter(i => i !== undefined);
    const constraintsOf = ['ik', 'transform', 'path', 'physics'].flatMap(kind => skin[kind] ?? []);
    skinRequires.set(skin.name, { bones: new Set(bonesOf), constraints: new Set(constraintsOf) });
  }
  // Linked meshes take the geometry of their parent mesh.
  for (const [, table] of skins) {
    for (const [si, map] of table) {
      for (const [name, att] of map) {
        if (att.type !== 'linkedmesh') continue;
        const parent = skins.get(att.skin)?.get(si)?.get(att.parent);
        if (!parent || parent.type !== 'mesh') throw new StudioError('bad-skeleton', `Linked mesh "${name}" names parent mesh "${att.parent}" in skin "${att.skin}", which does not exist.`, { attachment: name });
        map.set(name, { ...parent, name, path: att.path, color: att.color, sequence: att.sequence, deformFrom: att.timelines ? parent : null });
      }
    }
  }
  for (const [, table] of skins) {
    for (const [, map] of table) {
      for (const att of map.values()) {
        if (att.type === 'clipping' && att.end !== null) att.endIndex = slotIndex.get(att.end) ?? -1;
      }
    }
  }

  const events = new Map(Object.entries(json.events ?? {}));
  const animations = new Map();
  for (const [name, raw] of Object.entries(json.animations ?? {})) animations.set(name, compileAnimation(name, raw ?? {}, { boneIndex, slotIndex, slots, skins, events, unsupported, ikByName, transformByName, physicsByName, physics, pathByName }));

  return {
    name: json.skeleton?.name ?? null,
    version: json.skeleton?.spine ?? null,
    referenceScale: num(json.skeleton?.referenceScale, 100),
    bones, slots, ik, transform, physics, path, constraints: constraintOrder(ik, transform, physics, path),
    boneIndex, slotIndex, skins, skinRequires, defaultSkin: skins.get('default') ?? null, animations, events,
    unsupported: [...unsupported].sort(),
    approximations: [...approximations].sort(),
    findAnimation: animationName => animations.get(animationName) ?? null,
    findSkin: skinName => (skins.has(skinName) ? { name: skinName } : null),
  };
}

function compileAnimation(name, raw, ctx) {
  const timelines = [];
  let duration = 0;
  const seen = keys => { for (const k of keys) duration = Math.max(duration, Math.fround(num(k.time, 0))); };
  const where = `animations/${name}`;

  for (const [boneName, channels] of Object.entries(raw.bones ?? {})) {
    const bone = ctx.boneIndex.get(boneName);
    if (bone === undefined) throw new StudioError('bad-animation', `${where}: bone "${boneName}" does not exist.`, { bone: boneName });
    for (const [channel, keys] of Object.entries(channels ?? {})) {
      if (!Array.isArray(keys) || !keys.length) continue;
      seen(keys);
      if (channel === 'inherit') {
        const modes = keys.map(k => {
          const mode = k.inherit ?? 'normal';
          if (!Object.hasOwn(INHERIT, mode)) throw new StudioError('bad-animation', `${where}/bones/${boneName}/inherit: unknown inherit "${mode}".`, { bone: boneName, inherit: mode });
          return INHERIT[mode];
        });
        timelines.push({ kind: 'inherit', bone, times: Float32Array.from(keys.map(k => num(k.time, 0))), modes });
        continue;
      }
      const fields = BONE_CHANNELS[channel];
      if (!fields) { ctx.unsupported.add(`timeline:${name}/${boneName}/${channel}`); continue; }
      fields.forEach(([field, property, defaultValue], f) => {
        timelines.push({ kind: 'bone', bone, property, channel: channelFromSpine(keys, field, f, defaultValue, `${where}/bones/${boneName}/${channel}`) });
      });
    }
  }

  for (const [slotName, channels] of Object.entries(raw.slots ?? {})) {
    const slot = ctx.slotIndex.get(slotName);
    if (slot === undefined) throw new StudioError('bad-animation', `${where}: slot "${slotName}" does not exist.`, { slot: slotName });
    for (const [channel, keys] of Object.entries(channels ?? {})) {
      if (!Array.isArray(keys) || !keys.length) continue;
      seen(keys);
      const at = `${where}/slots/${slotName}/${channel}`;
      if (channel === 'attachment') {
        timelines.push({ kind: 'attachment', slot, times: Float32Array.from(keys.map(k => num(k.time, 0))), names: keys.map(k => k.name ?? null) });
      } else if (channel === 'rgba' || channel === 'rgb' || channel === 'alpha') {
        const parts = [];
        if (channel !== 'alpha') for (const [i, p] of [[0, 'r'], [2, 'g'], [4, 'b']]) parts.push({ property: p, read: k => hexPart(k.color, i, 1) });
        if (channel === 'rgba') parts.push({ property: 'a', read: k => hexPart(k.color, 6, 1) });
        if (channel === 'alpha') parts.push({ property: 'a', read: k => num(k.value, 1) });
        timelines.push({ kind: 'color', slot, channel: colorChannel(keys, parts, at) });
      } else if (channel === 'rgba2' || channel === 'rgb2') {
        const parts = [];
        if (channel === 'rgba2') parts.push({ property: 'a', read: k => hexPart(k.light, 6, 1) });
        for (const [i, p] of [[0, 'r'], [2, 'g'], [4, 'b']]) parts.push({ property: p, read: k => hexPart(k.light, i, 1) });
        for (const [i, p] of [[0, 'dr'], [2, 'dg'], [4, 'db']]) parts.push({ property: p, read: k => hexPart(k.dark, i, 0) });
        // rgba2 packs the curve as r, g, b, a, dr, dg, db in Spine; reorder parts to match.
        const ordered = channel === 'rgba2' ? [parts[1], parts[2], parts[3], parts[0], parts[4], parts[5], parts[6]] : parts;
        timelines.push({ kind: 'color', slot, channel: colorChannel(keys, ordered, at) });
      } else {
        ctx.unsupported.add(`timeline:${name}/${slotName}/${channel}`);
      }
    }
  }

  // Deform: 4.2 nests attachments -> skin -> slot -> attachment -> { deform: [keys] }.
  for (const [skinName, bySlot] of Object.entries(raw.attachments ?? {})) {
    for (const [slotName, byAttachment] of Object.entries(bySlot ?? {})) {
      const slot = ctx.slotIndex.get(slotName);
      for (const [attName, timelinesOf] of Object.entries(byAttachment ?? {})) {
        for (const [kind, keys] of Object.entries(timelinesOf ?? {})) {
          if (!Array.isArray(keys) || !keys.length) continue;
          seen(keys);
          const attachment = ctx.skins.get(skinName)?.get(slot)?.get(attName);
          if (kind === 'sequence') {
            if (!attachment?.sequence) { ctx.unsupported.add(`sequence-timeline:${name}/${slotName}/${attName}`); continue; }
            timelines.push({ kind: 'sequence', slot, attachment, times: Float32Array.from(keys.map(k => num(k.time, 0))),
              keys: keys.map(k => ({ time: Math.fround(num(k.time, 0)), mode: SEQUENCE_MODES.includes(k.mode) ? k.mode : 'hold', index: Math.floor(num(k.index, 0)), delay: num(k.delay, 0) })) });
            continue;
          }
          if (kind !== 'deform') { ctx.unsupported.add(`timeline:${name}/${slotName}/${attName}/${kind}`); continue; }
          if (!attachment || (attachment.type !== 'mesh' && attachment.type !== 'path')) { ctx.unsupported.add(`deform:${name}/${slotName}/${attName}`); continue; }
          timelines.push({ kind: 'deform', slot, attachment, ...compileDeform(keys, attachment, `${where}/attachments/${skinName}/${slotName}/${attName}`) });
        }
      }
    }
  }

  if (Array.isArray(raw.drawOrder) && raw.drawOrder.length) {
    seen(raw.drawOrder);
    const count = ctx.slots.length;
    const orders = raw.drawOrder.map(key => {
      if (!Array.isArray(key.offsets) || !key.offsets.length) return null;
      const order = new Array(count).fill(-1);
      const unchanged = [];
      let original = 0;
      for (const { slot, offset } of key.offsets) {
        const index = ctx.slotIndex.get(slot);
        if (index === undefined) throw new StudioError('bad-animation', `${where}/drawOrder: slot "${slot}" does not exist.`, { slot });
        while (original !== index) unchanged.push(original++);
        order[original + offset] = original++;
      }
      while (original < count) unchanged.push(original++);
      for (let i = count - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged.pop();
      return order;
    });
    timelines.push({ kind: 'drawOrder', times: Float32Array.from(raw.drawOrder.map(k => num(k.time, 0))), orders });
  }
  if (Array.isArray(raw.events) && raw.events.length) {
    seen(raw.events);
    timelines.push({ kind: 'event', events: raw.events.map(e => ({ time: Math.fround(num(e.time, 0)), name: e.name, ...(ctx.events.get(e.name) ?? {}), ...pick(e, ['int', 'float', 'string']) })) });
  }
  if (raw.ik && Object.keys(raw.ik).length) {
    for (const keys of Object.values(raw.ik)) if (Array.isArray(keys)) seen(keys);
    timelines.push(...compileIkTimelines(raw.ik, ctx.ikByName, where));
  }
  for (const kind of ['transform', 'path', 'physics']) {
    const section = raw[kind];
    if (!section || !Object.keys(section).length) continue;
    for (const k of Object.values(section)) if (Array.isArray(k)) seen(k); else if (k && typeof k === 'object') for (const v of Object.values(k)) if (Array.isArray(v)) seen(v);
    if (kind === 'path') timelines.push(...compilePathTimelines(section, ctx.pathByName, where));
    else if (kind === 'transform') timelines.push(...compileTransformTimelines(section, ctx.transformByName, where));
    else timelines.push(...compilePhysicsTimelines(section, ctx.physicsByName, ctx.physics, where));
  }
  return { name, duration, timelines };
}

const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

function compileDeform(keys, attachment, where) {
  const weighted = attachment.vertices.weighted;
  const length = weighted ? attachment.vertices.data.length / 3 * 2 : attachment.vertices.count * 2;
  const setup = weighted ? null : attachment.vertices.data;
  const times = Float32Array.from(keys.map(k => num(k.time, 0)));
  const frames = keys.map(k => {
    const out = new Float64Array(length);
    const vertices = k.vertices;
    if (Array.isArray(vertices)) {
      const start = num(k.offset, 0);
      for (let i = 0; i < vertices.length; i++) out[start + i] = vertices[i];
    }
    if (setup) for (let i = 0; i < length; i++) out[i] += setup[i];
    return out;
  });
  const curves = keys.map((k, i) => resolveCurve(spineCurve(k.curve, 0), `${where}[${i}]`));
  return { times, frames, curves };
}

export { colorAt, segmentPercent };
