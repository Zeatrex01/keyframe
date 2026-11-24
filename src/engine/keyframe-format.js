// The Keyframe format: the studio's own skeleton and animation document (`*.keyframe.json`),
// and its conversion to and from Spine 4.2 JSON.
//
// Why a format of its own: it is written to be read and written by people and models without
// knowing Spine's packing rules. Every channel is one value per key (rotate, x, y, scaleX,
// scaleY, shearX, shearY; color, alpha, attachment), a curve is a preset name or four
// normalized handles, and draw order is the full list of slots. The rig fields (bones, slots,
// attachments) keep Spine's names, so nothing is renamed between the two.
//
//   { "format": "keyframe", "version": 1, "name": "cat", "fps": 30,
//     "bones": [{ "name": "root" }, { "name": "head", "parent": "root", "y": 120, "length": 40 }],
//     "slots": [{ "name": "head", "bone": "head", "attachment": "head" }],          // draw order
//     "skins": { "default": { "head": { "head": { "type": "region", "width": 80, "height": 90 } } } },
//     "animations": { "nod": {
//       "bones": { "head": { "rotate": [{ "time": 0, "value": 0, "curve": "outCubic" }, { "time": 0.3, "value": -12 }] } },
//       "slots": { "head": { "color": [{ "time": 0, "value": "ffffff00" }, { "time": 0.2, "value": "ffffffff" }] } },
//       "drawOrder": [{ "time": 0.5, "order": ["head"] }] } } }
//
// Values follow Spine's meaning: rotate, x, y and shear are offsets from the setup pose, scale
// multiplies it, time is in seconds. Anything this format does not model (constraints, deform,
// events, path attachments, Spine-only timelines) rides along under `spine` untouched, so
// Spine -> Keyframe -> Spine gives back a file that plays the same (test/keyframe-format.test.js).
//
// Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { resolveCurve, controlPoints } from './curve.js';

export const FORMAT = 'keyframe';
export const FORMAT_VERSION = 1;
const SPINE_VERSION = '4.2.43';

const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const round = v => Math.round(v * 1e6) / 1e6;

export const isKeyframeDocument = doc => !!doc && typeof doc === 'object' && doc.format === FORMAT;

const BONE_CHANNELS = { rotate: ['rotate', 0], x: ['translatex', 0], y: ['translatey', 0], scaleX: ['scalex', 1], scaleY: ['scaley', 1], shearX: ['shearx', 0], shearY: ['sheary', 0] };
const SPLIT = {
  rotate: [['value', 'rotate', 0]],
  translate: [['x', 'x', 0], ['y', 'y', 0]], translatex: [['value', 'x', 0]], translatey: [['value', 'y', 0]],
  scale: [['x', 'scaleX', 1], ['y', 'scaleY', 1]], scalex: [['value', 'scaleX', 1]], scaley: [['value', 'scaleY', 1]],
  shear: [['x', 'shearX', 0], ['y', 'shearY', 0]], shearx: [['value', 'shearX', 0]], sheary: [['value', 'shearY', 0]],
};

// ── Keyframe -> Spine ────────────────────────────────────────────────────────

/** A Spine curve (absolute numbers or "stepped") for the segment k0 -> k1 of one value. */
function spineCurveOf(curve, t0, v0, t1, v1, where) {
  const resolved = resolveCurve(curve, where);
  if (resolved.kind === 'linear') return undefined;
  if (resolved.kind === 'stepped') return 'stepped';
  return controlPoints(resolved, t0, v0, t1, v1).map(round);
}

const channelOf = (color, i) => (typeof color === 'string' && color.length >= i + 2 ? parseInt(color.slice(i, i + 2), 16) / 255 : 1);

/**
 * Turn a Keyframe document into Spine 4.2 skeleton JSON (the engine's and Spine's input).
 * @param {object} doc
 */
export function toSkeletonJson(doc) {
  if (!isKeyframeDocument(doc)) throw new StudioError('bad-skeleton', 'Not a Keyframe document: "format" must be "keyframe".');
  if (doc.version !== FORMAT_VERSION) throw new StudioError('bad-skeleton', `Keyframe format version ${doc.version} is not supported (this studio reads ${FORMAT_VERSION}).`, { version: doc.version });
  const spine = doc.spine ?? {};
  const json = { skeleton: { ...(spine.skeleton ?? {}), spine: spine.skeleton?.spine ?? SPINE_VERSION, ...(doc.name ? { name: doc.name } : {}), ...(isNumber(doc.fps) ? { fps: doc.fps } : {}) } };
  json.bones = (doc.bones ?? []).map(b => ({ ...b }));
  json.slots = (doc.slots ?? []).map(s => ({ ...s }));
  for (const kind of ['ik', 'transform', 'path', 'physics']) if (spine[kind]) json[kind] = spine[kind];
  json.skins = Object.entries(doc.skins ?? {}).map(([name, attachments]) => ({ name, attachments, ...(spine.skins?.[name] ?? {}) }));
  if (doc.events || spine.events) json.events = { ...(spine.events ?? {}), ...(doc.events ?? {}) };
  json.animations = {};
  const slotNames = json.slots.map(s => s.name);
  for (const [name, anim] of Object.entries(doc.animations ?? {})) json.animations[name] = animationToSpine(name, anim ?? {}, slotNames);
  return json;
}

function animationToSpine(name, anim, slotNames) {
  const where = `animations/${name}`;
  const out = { ...(anim.spine ?? {}) };
  for (const [bone, channels] of Object.entries(anim.bones ?? {})) {
    const target = (out.bones ??= {})[bone] ??= {};
    for (const [channel, keys] of Object.entries(channels ?? {})) {
      const spec = BONE_CHANNELS[channel];
      if (!spec) throw new StudioError('bad-animation', `${where}/bones/${bone}: unknown channel "${channel}". Use ${Object.keys(BONE_CHANNELS).join(', ')}.`, { channel });
      const [spineName, rest] = spec;
      target[spineName] = sorted(keys, `${where}/bones/${bone}/${channel}`).map((k, i, all) => {
        const value = isNumber(k.value) ? k.value : rest;
        const next = all[i + 1];
        const curve = next ? spineCurveOf(k.curve, time(k), value, time(next), isNumber(next.value) ? next.value : rest, `${where}/bones/${bone}/${channel}[${i}]`) : undefined;
        return { time: time(k), value, ...(curve !== undefined ? { curve } : {}) };
      });
    }
  }
  for (const [slot, channels] of Object.entries(anim.slots ?? {})) {
    const target = (out.slots ??= {})[slot] ??= {};
    for (const [channel, keys] of Object.entries(channels ?? {})) {
      const at = `${where}/slots/${slot}/${channel}`;
      const list = sorted(keys, at);
      if (channel === 'attachment') target.attachment = list.map(k => ({ time: time(k), name: k.name ?? null }));
      else if (channel === 'color') target.rgba = list.map((k, i) => colorKey(k, list[i + 1], [0, 2, 4, 6], at, i));
      else if (channel === 'rgb') target.rgb = list.map((k, i) => colorKey(k, list[i + 1], [0, 2, 4], at, i));
      else if (channel === 'alpha') {
        target.alpha = list.map((k, i, all) => {
          const value = isNumber(k.value) ? k.value : 1;
          const next = all[i + 1];
          const curve = next ? spineCurveOf(k.curve, time(k), value, time(next), isNumber(next.value) ? next.value : 1, `${at}[${i}]`) : undefined;
          return { time: time(k), value, ...(curve !== undefined ? { curve } : {}) };
        });
      } else throw new StudioError('bad-animation', `${at}: unknown slot channel "${channel}". Use attachment, color, rgb or alpha.`, { channel });
    }
  }
  if (Array.isArray(anim.drawOrder)) {
    out.drawOrder = sorted(anim.drawOrder, `${where}/drawOrder`).map(k => ({ time: time(k), ...(Array.isArray(k.order) ? { offsets: offsetsOf(k.order, slotNames, `${where}/drawOrder`) } : {}) }));
  }
  if (Array.isArray(anim.events)) out.events = anim.events.map(e => ({ ...e }));
  return out;
}

function colorKey(k, next, positions, at, i) {
  const value = typeof k.value === 'string' ? k.value : 'ffffffff';
  const key = { time: time(k), color: value };
  if (!next) return key;
  const to = typeof next.value === 'string' ? next.value : 'ffffffff';
  const perChannel = k.curves && typeof k.curves === 'object' ? ['r', 'g', 'b', 'a'].slice(0, positions.length).map(c => k.curves[c] ?? k.curve) : null;
  const parts = positions.map((p, c) => spineCurveOf(perChannel ? perChannel[c] : k.curve, time(k), channelOf(value, p), time(next), channelOf(to, p), `${at}[${i}]`));
  if (parts.every(c => c === undefined)) return key;
  if (parts.every(c => c === 'stepped')) return { ...key, curve: 'stepped' };
  key.curve = parts.flatMap((c, n) => (Array.isArray(c) ? c : [time(k) + (time(next) - time(k)) / 3, channelOf(value, positions[n]) + (channelOf(to, positions[n]) - channelOf(value, positions[n])) / 3,
    time(k) + (time(next) - time(k)) * 2 / 3, channelOf(value, positions[n]) + (channelOf(to, positions[n]) - channelOf(value, positions[n])) * 2 / 3].map(round)));
  return key;
}

/** Full draw order -> Spine offsets (every moved slot, in setup order). */
export function offsetsOf(order, slotNames, where = 'drawOrder') {
  if (order.length !== slotNames.length || new Set(order).size !== order.length || order.some(n => !slotNames.includes(n))) {
    throw new StudioError('bad-animation', `${where}: "order" must list every slot exactly once (${slotNames.length} slots).`, { slots: slotNames.length });
  }
  const position = new Map(order.map((n, i) => [n, i]));
  return slotNames.map((n, i) => ({ slot: n, offset: position.get(n) - i })).filter(o => o.offset !== 0);
}

const time = k => (isNumber(k?.time) ? k.time : 0);
function sorted(keys, where) {
  if (!Array.isArray(keys)) throw new StudioError('bad-animation', `${where}: keys must be an array.`);
  for (let i = 1; i < keys.length; i++) if (time(keys[i]) < time(keys[i - 1])) throw new StudioError('bad-animation', `${where}: key times must rise (key ${i}).`, { index: i });
  return keys;
}

// ── Spine -> Keyframe ────────────────────────────────────────────────────────

/** A Spine absolute curve on one field -> the Keyframe form (normalized when it can be). */
function keyframeCurveOf(curve, field, t0, v0, t1, v1) {
  if (curve === 'stepped') return 'stepped';
  if (!Array.isArray(curve) || curve.length < field * 4 + 4) return undefined;
  const [cx1, cy1, cx2, cy2] = curve.slice(field * 4, field * 4 + 4);
  const dt = t1 - t0, dv = v1 - v0;
  if (!(dt > 0)) return { absolute: [cx1, cy1, cx2, cy2] };
  const x1 = (cx1 - t0) / dt, x2 = (cx2 - t0) / dt;
  if (Math.abs(dv) < 1e-12) {
    if (Math.abs(cy1 - v0) < 1e-9 && Math.abs(cy2 - v0) < 1e-9) return undefined;
    return { absolute: [cx1, cy1, cx2, cy2] };
  }
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return { absolute: [cx1, cy1, cx2, cy2] };
  return [round(x1), round((cy1 - v0) / dv), round(x2), round((cy2 - v0) / dv)];
}

/**
 * Turn Spine 4.2 skeleton JSON into a Keyframe document.
 * @param {object} json
 */
export function fromSkeletonJson(json) {
  if (!json || !Array.isArray(json.bones)) throw new StudioError('bad-skeleton', 'Spine skeleton JSON needs a "bones" array.');
  const { spine: version, name, fps, ...header } = json.skeleton ?? {};
  /** @type {Record<string, any>} */
  const doc = { format: FORMAT, version: FORMAT_VERSION, ...(name ? { name } : {}), ...(isNumber(fps) ? { fps } : {}) };
  doc.bones = json.bones.map(b => ({ ...b }));
  doc.slots = (json.slots ?? []).map(s => ({ ...s }));
  doc.skins = {};
  const skinExtras = {};
  const skins = Array.isArray(json.skins) ? json.skins : Object.entries(json.skins ?? {}).map(([n, attachments]) => ({ name: n, attachments }));
  for (const { name: skinName, attachments, ...rest } of skins) {
    doc.skins[skinName] = attachments ?? {};
    if (Object.keys(rest).length) skinExtras[skinName] = rest;
  }
  if (json.events) doc.events = json.events;
  const spine = { skeleton: { spine: version ?? SPINE_VERSION, ...header } };
  for (const kind of ['ik', 'transform', 'path', 'physics']) if (json[kind]?.length) spine[kind] = json[kind];
  if (Object.keys(skinExtras).length) spine.skins = skinExtras;
  doc.spine = spine;
  const slotNames = doc.slots.map(s => s.name);
  doc.animations = {};
  for (const [animName, anim] of Object.entries(json.animations ?? {})) doc.animations[animName] = animationFromSpine(anim ?? {}, slotNames);
  return doc;
}

function animationFromSpine(anim, slotNames) {
  const out = {};
  const rest = {};
  for (const [key, value] of Object.entries(anim)) if (!['bones', 'slots', 'drawOrder', 'events'].includes(key)) rest[key] = value;
  for (const [bone, channels] of Object.entries(anim.bones ?? {})) {
    for (const [channel, keys] of Object.entries(channels ?? {})) {
      const split = SPLIT[channel];
      if (!split || !Array.isArray(keys)) { ((rest.bones ??= {})[bone] ??= {})[channel] = keys; continue; }
      split.forEach(([field, kfName, restValue], f) => {
        const target = ((out.bones ??= {})[bone] ??= {});
        target[kfName] = keys.map((k, i) => {
          const value = isNumber(k[field]) ? k[field] : restValue;
          const next = keys[i + 1];
          const curve = next ? keyframeCurveOf(k.curve, f, time(k), value, time(next), isNumber(next[field]) ? next[field] : restValue) : undefined;
          return { time: time(k), value, ...(curve !== undefined ? { curve } : {}) };
        });
      });
    }
  }
  for (const [slot, channels] of Object.entries(anim.slots ?? {})) {
    for (const [channel, keys] of Object.entries(channels ?? {})) {
      const target = ((out.slots ??= {})[slot] ??= {});
      if (channel === 'attachment') target.attachment = keys.map(k => ({ time: time(k), name: k.name ?? null }));
      else if (channel === 'rgba' || channel === 'rgb') {
        const positions = channel === 'rgba' ? [0, 2, 4, 6] : [0, 2, 4];
        target[channel === 'rgba' ? 'color' : 'rgb'] = keys.map((k, i) => {
          const key = { time: time(k), value: k.color ?? (channel === 'rgba' ? 'ffffffff' : 'ffffff') };
          const next = keys[i + 1];
          if (!next) return key;
          if (k.curve === 'stepped') return { ...key, curve: 'stepped' };
          if (!Array.isArray(k.curve)) return key;
          const per = positions.map((p, n) => keyframeCurveOf(k.curve, n, time(k), channelOf(k.color, p), time(next), channelOf(next.color, p)));
          const shapes = per.filter(c => c !== undefined).map(c => JSON.stringify(c));
          if (shapes.length && shapes.every(s => s === shapes[0]) && per.every(c => c !== undefined || true) && !shapes[0].includes('absolute')) return { ...key, curve: JSON.parse(shapes[0]) };
          return { ...key, curves: Object.fromEntries(['r', 'g', 'b', 'a'].slice(0, positions.length).map((c, n) => [c, per[n] ?? 'linear'])) };
        });
      } else if (channel === 'alpha') {
        target.alpha = keys.map((k, i) => {
          const value = isNumber(k.value) ? k.value : 1;
          const next = keys[i + 1];
          const curve = next ? keyframeCurveOf(k.curve, 0, time(k), value, time(next), isNumber(next.value) ? next.value : 1) : undefined;
          return { time: time(k), value, ...(curve !== undefined ? { curve } : {}) };
        });
      } else {
        ((rest.slots ??= {})[slot] ??= {})[channel] = keys;
        delete target[channel];
      }
      if (!Object.keys(target).length) delete out.slots[slot];
    }
  }
  if (Array.isArray(anim.drawOrder)) {
    out.drawOrder = anim.drawOrder.map(k => {
      if (!Array.isArray(k.offsets) || !k.offsets.length) return { time: time(k) };
      const count = slotNames.length;
      const order = new Array(count).fill(-1);
      const unchanged = [];
      let original = 0;
      for (const { slot, offset } of k.offsets) {
        const index = slotNames.indexOf(slot);
        while (original !== index) unchanged.push(original++);
        order[original + offset] = original++;
      }
      while (original < count) unchanged.push(original++);
      for (let i = count - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged.pop();
      return { time: time(k), order: order.map(i => slotNames[i]) };
    });
  }
  if (Array.isArray(anim.events)) out.events = anim.events.map(e => ({ ...e }));
  if (Object.keys(rest).length) out.spine = rest;
  return out;
}
