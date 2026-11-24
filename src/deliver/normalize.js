// Validates and normalizes an animation written by a model in native Spine 4.2 JSON,
// before it is composed onto the base.
//
// The input language is Spine's own animation format: every capable model already knows
// it, and there is no compiler between what was written and what is delivered. The
// legacy studio invented a simplified track language and compiled it through its scene
// machinery; that layer is gone.
//
// What normalization does, each step reported, never silent:
//   * validates shape and times (numbers >= 0, non-decreasing) and refuses with the path;
//   * holds the first key back to t=0 on value channels. A Spine timeline shows the setup
//     pose before its first key; a reveal keyed from 0.5 s showed the logo, snapped it
//     hidden, then faded it back in (the legacy ident double-take). Discrete channels
//     (attachment, draw order, events, inherit) are left alone: there, showing the setup
//     until the first key is a meaningful choice;
//   * optionally snaps key times to a frame grid, reporting every moved key;
//   * bakes follow requests (a bone that trails another through a damped spring, see
//     follow.js) into ordinary rotate keys;
//   * expands curve preset names ("easeOut", "backOut", ...) on bone and slot colour/alpha
//     channels into Spine's absolute bezier for that key pair, through the single
//     preset-to-bezier implementation (src/spine/curves/recurve.js segmentCurve). The bezier
//     form, with cx in seconds, is where hand-written curves usually go wrong.

import { StudioError } from '../shared/errors.js';
import { handlesFor, isValidHandles, presetNames } from '../spine/curves/presets.js';
import { BONE_CHANNELS, SLOT_CHANNELS, segmentCurve } from '../spine/curves/recurve.js';
import { bakeFollows } from './follow.js';

const BONE_VALUE_CHANNELS = new Set(['rotate', 'translate', 'translatex', 'translatey', 'scale', 'scalex', 'scaley',
  'shear', 'shearx', 'sheary']);
const BONE_DISCRETE_CHANNELS = new Set(['inherit']);
const SLOT_VALUE_CHANNELS = new Set(['rgba', 'rgb', 'alpha', 'rgba2', 'rgb2']);
const SLOT_DISCRETE_CHANNELS = new Set(['attachment', 'sequence']);
const TOP_LEVEL = new Set(['bones', 'slots', 'ik', 'transform', 'path', 'physics', 'attachments', 'drawOrder', 'events']);

const fail = (where, message) => { throw new StudioError('bad-animation', `${where}: ${message}`, { where }); };

function checkKeys(keys, where) {
  if (!Array.isArray(keys)) fail(where, 'expected an array of keys.');
  let last = -Infinity;
  keys.forEach((key, i) => {
    if (!key || typeof key !== 'object' || Array.isArray(key)) fail(`${where}[${i}]`, 'a key must be an object.');
    const time = key.time ?? 0;
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) fail(`${where}[${i}]`, `time must be a number >= 0 (got ${JSON.stringify(key.time)}).`);
    if (time < last) fail(`${where}[${i}]`, `keys must be in time order (${time} after ${last}).`);
    if (time === last && !where.startsWith('events')) fail(`${where}[${i}]`, `two keys share the time ${time}; the runtime plays only one of them. Move one by a frame, or use a "stepped" curve for a cut.`);
    if (key.curve !== undefined && typeof key.curve !== 'string' && !Array.isArray(key.curve) && !isShape(key.curve)) {
      fail(`${where}[${i}]`, 'curve must be "stepped", "linear", a preset name, { "handles": [x1, y1, x2, y2] } with both x in 0..1, or a bezier array.');
    }
    last = time;
  });
}

// Visit every key list with its path and whether it is a value channel.
function forEachTimeline(animation, visit) {
  for (const [bone, channels] of Object.entries(animation.bones ?? {})) {
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) fail(`bones/${bone}`, 'expected a map of channels.');
    for (const [channel, keys] of Object.entries(channels)) {
      if (!BONE_VALUE_CHANNELS.has(channel) && !BONE_DISCRETE_CHANNELS.has(channel)) fail(`bones/${bone}/${channel}`, 'not a Spine 4.2 bone timeline.');
      visit(keys, `bones/${bone}/${channel}`, BONE_VALUE_CHANNELS.has(channel), BONE_CHANNELS[channel]);
    }
  }
  for (const [slot, channels] of Object.entries(animation.slots ?? {})) {
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) fail(`slots/${slot}`, 'expected a map of channels.');
    for (const [channel, keys] of Object.entries(channels)) {
      if (!SLOT_VALUE_CHANNELS.has(channel) && !SLOT_DISCRETE_CHANNELS.has(channel)) fail(`slots/${slot}/${channel}`, 'not a Spine 4.2 slot timeline.');
      visit(keys, `slots/${slot}/${channel}`, SLOT_VALUE_CHANNELS.has(channel), SLOT_CHANNELS[channel]);
    }
  }
  for (const kind of ['ik', 'transform']) {
    for (const [name, keys] of Object.entries(animation[kind] ?? {})) visit(keys, `${kind}/${name}`, true);
  }
  for (const kind of ['path', 'physics']) {
    for (const [name, channels] of Object.entries(animation[kind] ?? {})) {
      if (!channels || typeof channels !== 'object' || Array.isArray(channels)) fail(`${kind}/${name}`, 'expected a map of channels.');
      for (const [channel, keys] of Object.entries(channels)) visit(keys, `${kind}/${name}/${channel}`, channel !== 'reset');
    }
  }
  for (const [skin, slots] of Object.entries(animation.attachments ?? {})) {
    for (const [slot, attachments] of Object.entries(slots ?? {})) {
      for (const [attachment, channels] of Object.entries(attachments ?? {})) {
        for (const [channel, keys] of Object.entries(channels ?? {})) {
          visit(keys, `attachments/${skin}/${slot}/${attachment}/${channel}`, channel === 'deform');
        }
      }
    }
  }
  if (animation.drawOrder !== undefined) visit(animation.drawOrder, 'drawOrder', false);
  if (animation.events !== undefined) visit(animation.events, 'events', false);
}

/**
 * @param {object} animation native Spine 4.2 animation object (one clip)
 * @param {{ holdFromStart?: boolean, fps?: number }} [options]
 * @returns {{ animation: object, held: string[], snapped: Array<{ where: string, from: number, to: number }>,
 *   presets: Array<{ where: string, preset: string }>, followed: object[] }}
 *   A new object; the input is never mutated.
 */
export function normalizeAnimation(animation, { holdFromStart = true, fps } = {}) {
  if (!animation || typeof animation !== 'object' || Array.isArray(animation)) fail('animation', 'expected an animation object.');
  for (const key of Object.keys(animation)) if (!TOP_LEVEL.has(key)) fail(key, 'not a Spine 4.2 animation section.');
  if (fps !== undefined && !(fps > 0 && fps <= 240)) throw new StudioError('bad-argument', 'fps must be between 0 and 240.', { fps });

  const out = structuredClone(animation);
  // follow requests become ordinary rotate keys before anything else looks at the clip
  const followed = bakeFollows(out, { fps: fps ?? 30 });
  const held = [];
  const snapped = [];
  const presets = [];
  forEachTimeline(out, (keys, where, isValue, curveSpec) => {
    checkKeys(keys, where);
    if (fps) {
      keys.forEach((key, i) => {
        const time = key.time ?? 0;
        const grid = Math.round(time * fps) / fps;
        if (Math.abs(grid - time) > 1e-9) {
          // Rounding of a time already on the grid (0.3333 -> 1/3) is not news.
          if (Math.abs(grid - time) > 5e-4) snapped.push({ where: `${where}[${i}]`, from: time, to: grid });
          key.time = grid;
        }
      });
      checkKeys(keys, `${where} (after snapping to ${fps} fps)`);
    }
    if (holdFromStart && isValue && keys.length && (keys[0].time ?? 0) > 0) {
      const { time, curve, ...value } = keys[0];
      keys.unshift(value);
      held.push(where);
    }
    expandPresets(keys, where, curveSpec, presets);
    for (const key of keys) if (key.time === 0) delete key.time; // Spine omits time 0
  });
  return { animation: out, held, snapped, presets, followed };
}

// A curve given as its shape: { handles: [x1, y1, x2, y2] }, normalized like a preset (x is the
// fraction across the segment's time, y across its value change). A measured move has a shape
// of its own; this is how it is written without working out the absolute numbers by hand.
const isShape = curve => curve !== null && typeof curve === 'object' && !Array.isArray(curve) && isValidHandles(curve.handles);

// Replace preset names and shapes with the absolute bezier of their key pair (or nothing for linear).
function expandPresets(keys, where, spec, report) {
  keys.forEach((key, i) => {
    if (isShape(key.curve)) {
      if (!spec) fail(`${where}[${i}]`, 'curve handles apply to bone channels and slot rgba/rgb/alpha; write a bezier array here.');
      const next = keys[i + 1], curve = next ? segmentCurve(spec, key, next, key.curve.handles.slice()) : null;
      if (curve === null) delete key.curve; else key.curve = curve;
      return;
    }
    if (typeof key.curve !== 'string') return;
    if (key.curve === 'stepped') return;
    if (key.curve === 'linear') { delete key.curve; return; }
    const handles = handlesFor(key.curve);
    if (!handles) {
      fail(`${where}[${i}]`, `curve "${key.curve}" is not a Spine curve or a preset. Presets: ${presetNames().join(', ')}.`);
    }
    if (!spec) {
      fail(`${where}[${i}]`, `curve presets apply to bone channels and slot rgba/rgb/alpha; write a bezier array here.`);
    }
    report.push({ where: `${where}[${i}]`, preset: key.curve });
    const next = keys[i + 1];
    const curve = next ? segmentCurve(spec, key, next, handles) : null;
    if (curve === null) delete key.curve; else key.curve = curve;
  });
}
