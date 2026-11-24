// The timeline walker shared by the rig and animation readers: which channels an
// animation carries, how long it is, how its keys sit on the frame grid, how much each
// channel moves, and the guard that keeps broken draw-order offsets away from the runtime.
// Ported from the reading half of legacy inspect.js.
//
// Nothing here evaluates a curve or computes a pose: the official runtime is the only
// source of pose truth (ADR-2). These functions read the keys as written.
//
// Pure and isomorphic: takes parsed JSON, returns plain data.

import { finding } from '../spine/findings.js';
import { drawOrderOffsetProblems, drawOrderHazards } from '../spine/draw-order.js';
import { isStudioError } from '../shared/errors.js';

export const round3 = v => Math.round(v * 1000) / 1000;
// Times get six digits: the frame grid does not fit in three (23/30 = 0.766667). Legacy
// rounded read-back times to three digits once, and the half-frame defect it had just
// fixed on the write side came back through the read path when an agent re-wrote keys.
export const round6 = v => +(+v).toFixed(6);
export const isNumber = v => typeof v === 'number' && Number.isFinite(v);
// A key without `time` is at t=0 (Spine's default). 4.2 exports write a single-key
// timeline as `{ "value": 8 }` and physics timelines usually open with no time at all.
export const keyTime = k => (k && isNumber(k.time) ? k.time : 0);

// The sections of a 4.2 animation. Everything outside bones/slots was invisible for a
// long time in legacy: an animation carrying only physics or deform measured as duration 0
// with no channels, and the agent concluded "the animation is empty".
export const CONSTRAINT_SECTIONS = Object.freeze(['ik', 'transform', 'path', 'physics']);

const typeName = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * Collects reader issues as warn findings, one per `code@where`.
 * A skipped channel never stops a read (legacy FINDING-001): losing the whole bone tree
 * over one exotic timeline is out of all proportion.
 */
export function issueCollector() {
  const list = [];
  const seen = new Set();
  return {
    add(code, where, message, params) {
      const id = `${code}@${where}`;
      if (seen.has(id)) return;
      seen.add(id);
      list.push(finding('warn', code, where, message, params));
    },
    list,
  };
}

/**
 * Visit every key array of an animation, labelled with its channel name.
 * `visit(channel, keys, where)`. Shapes the walker does not recognise are skipped and
 * reported, never thrown. Two 4.2 traps live here:
 *   - at the skeleton level ik/transform/path/physics are arrays; at the animation level
 *     the same names are objects keyed by constraint name;
 *   - deform is `deform: {skin:{slot:{att:[key]}}}` in 3.8 (three levels, array at the
 *     end) and `attachments: {skin:{slot:{att:{deform:[key]}}}}` in 4.2 (four levels).
 *     Treating the four-level form as three crashed legacy with "is not iterable".
 * @param {object} anim
 * @param {(channel: string, keys: object[], where: string) => void} visit
 * @param {ReturnType<typeof issueCollector>} [issues]
 */
export function walkSections(anim, visit, issues) {
  const emit = (channel, keys, where) => {
    if (Array.isArray(keys)) {
      try { visit(channel, keys, where); } catch (err) {
        issues?.add('channel-unreadable', where, `This channel could not be read and was skipped: ${err.message}`,
          { channel, cause: err.message });
      }
      return;
    }
    issues?.add('channel-shape', where, `Expected an array of keys, found ${typeName(keys)}; the channel was skipped.`,
      { channel, found: typeName(keys) });
  };
  for (const [bone, timelines] of Object.entries(anim?.bones ?? {})) {
    for (const [channel, keys] of Object.entries(timelines ?? {})) emit(channel, keys, `bones/${bone}/${channel}`);
  }
  for (const [slot, timelines] of Object.entries(anim?.slots ?? {})) {
    for (const [channel, keys] of Object.entries(timelines ?? {})) emit(`slot.${channel}`, keys, `slots/${slot}/${channel}`);
  }
  for (const section of CONSTRAINT_SECTIONS) {
    for (const [name, value] of Object.entries(anim?.[section] ?? {})) {
      const where = `${section}/${name}`;
      if (Array.isArray(value)) emit(section, value, where); // ik, transform
      else if (value && typeof value === 'object') { // path, physics
        for (const [property, keys] of Object.entries(value)) emit(`${section}.${property}`, keys, `${where}/${property}`);
      } else emit(section, value, where);
    }
  }
  const deform = anim?.attachments ?? anim?.deform; // 4.2 / 3.8
  for (const [skin, slots] of Object.entries(deform ?? {})) {
    for (const [slot, attachments] of Object.entries(slots ?? {})) {
      for (const [attachment, value] of Object.entries(attachments ?? {})) {
        const where = `deform/${skin}/${slot}/${attachment}`;
        if (Array.isArray(value)) { emit('deform', value, where); continue; } // 3.8: three levels
        if (value && typeof value === 'object') { // 4.2: four levels
          for (const [kind, keys] of Object.entries(value)) emit(kind === 'deform' ? 'deform' : `deform.${kind}`, keys, `${where}/${kind}`);
        } else emit('deform', value, where);
      }
    }
  }
  if (anim?.drawOrder !== undefined) emit('drawOrder', anim.drawOrder, 'drawOrder');
  if (anim?.events !== undefined) emit('events', anim.events, 'events');
}

/** Distinct channel names in an animation, in walk order. */
export function channelsOf(anim, issues) {
  const set = new Set();
  walkSections(anim, channel => set.add(channel), issues);
  return [...set];
}

/** The latest key time in any section, seconds (unrounded). */
export function animationDuration(anim, issues) {
  let max = 0;
  walkSections(anim, (channel, keys) => {
    for (const k of keys) max = Math.max(max, keyTime(k));
  }, issues);
  return max;
}

// ── frame grid ──
// The agent once dropped many half keyframes (23.5, 21.5). It
// read time in seconds and could not notice that 0.7833 s is frame 23.5. Every animation
// now reports how many keys sit between frames: it audits our output and diagnoses
// inherited files.
// The tolerance was measured (legacy finding M, 2026-08-10): at 1e-4 frames every Spine
// round-trip raised a false alarm, because Spine rounds times to four digits on export
// (frame 4 -> 0.1333 -> 3.999 frames). All 28 of the owner's clips were flagged while the
// keys sat exactly on frames in the editor, and a false alarm hides the real finding.
// Two counts are kept apart:
//   offGridKeys  - truly between two frames (>= 1/4 frame from one): hard to edit
//   roundedKeys  - Spine's own export rounding (< 1/4 frame): information, not a defect
export const DEFAULT_GRID_FPS = 30;
export const GRID_TOLERANCE_FRAMES = 0.25;
export const ROUNDING_EPSILON_FRAMES = 1e-4;
const GRID_EXAMPLES = 8;

/**
 * @param {object} anim
 * @param {number} fps frame rate of the grid (callers pass 30 when the skeleton states none)
 * @param {{ add(code: string, where: string, message: string, params?: object): void, list: object[] }} [issues] collects what the report finds
 * @returns {{ fps: number, keys: number, offGridKeys: number, roundedKeys?: number,
 *   roundedNote?: string, examples?: object[], note?: string }}
 */
export function frameGridReport(anim, fps, issues) {
  const rate = isNumber(fps) && fps > 0 ? fps : DEFAULT_GRID_FPS;
  const between = [];
  const rounded = [];
  let total = 0;
  walkSections(anim, (channel, keys, where) => {
    for (const k of keys) {
      const t = keyTime(k);
      total++;
      const frame = t * rate;
      const drift = Math.abs(frame - Math.round(frame));
      const entry = { channel, where, time: round6(t), frame: round3(frame) };
      if (drift > GRID_TOLERANCE_FRAMES) between.push(entry);
      else if (drift > ROUNDING_EPSILON_FRAMES) rounded.push(entry);
    }
  }, issues);
  return {
    fps: rate, keys: total, offGridKeys: between.length,
    ...(rounded.length ? {
      roundedKeys: rounded.length,
      roundedNote: `${rounded.length} key(s) sit within ${GRID_TOLERANCE_FRAMES} frame of a frame but not exactly on it (e.g. frame ${rounded[0].frame}). This is Spine's own export rounding (0.1333 s = frame 3.999): not a defect, nothing to fix.`,
    } : {}),
    ...(between.length ? {
      examples: between.slice(0, GRID_EXAMPLES),
      note: `These keys sit between two frames in Spine: hard to select or move, and they do not line up with whole-frame keys. Write times on multiples of 1/${rate} s. Exception: the Spine docs suggest a deliberate fractional frame for a very short transition (frame 15 followed by 15.01); such a pair is not a defect. This count is a readability report, not an error counter.`,
    } : {}),
  };
}

// ── per-channel measurement ──
// Channel -> its numeric fields and the neutral value of a missing field.
// Legacy measured every non-rotate channel on x/y, so a single-axis timeline
// (`translatex`, `scalex`, `shearx`, ...: one `value` per key, what the editor writes when
// only one axis is keyed) measured as amplitude 0: a door sliding 400 units read as still.
const PAIR_CHANNELS = { translate: 0, scale: 1, shear: 0 };
const VALUE_CHANNELS = { rotate: 0, translatex: 0, translatey: 0, scalex: 1, scaley: 1, shearx: 0, sheary: 0, alpha: 1 };

const fieldsOf = channel => {
  if (channel in PAIR_CHANNELS) return { fields: ['x', 'y'], neutral: PAIR_CHANNELS[channel] };
  if (channel in VALUE_CHANNELS) return { fields: ['value'], neutral: VALUE_CHANNELS[channel] };
  return null;
};

/**
 * "How much": key count, first/last time, min/max/amplitude per numeric field, stepped
 * count, average key spacing. The numbers a style card or a critique needs.
 * @param {string} channel bone channel name (rotate, translate, scalex, ...)
 * @param {object[]} keys
 */
export function measureChannel(channel, keys) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const first = keyTime(keys[0]);
  const last = keyTime(keys[keys.length - 1]);
  const out = { keys: keys.length, first: round6(first), last: round6(last) };
  const spec = fieldsOf(channel);
  for (const field of spec?.fields ?? []) {
    const values = keys.map(k => (isNumber(k?.[field]) ? k[field] : spec.neutral));
    const min = Math.min(...values);
    const max = Math.max(...values);
    out[field] = { min: round3(min), max: round3(max), amplitude: round3(max - min) };
  }
  const stepped = keys.filter(k => k?.curve === 'stepped').length;
  if (stepped) out.stepped = stepped;
  if (last > first && keys.length > 2) out.averageSpacing = round6((last - first) / (keys.length - 1));
  return out;
}

/** Key count and first/last time of any key array: the cheap summary. */
export const spanOf = keys => ({ keys: keys.length, first: round6(keyTime(keys[0])), last: round6(keyTime(keys[keys.length - 1])) });

/**
 * Compressed key form: column arrays instead of one object per key, the same
 * information without repeating field names. Curves are summarised by kind; pass
 * `raw` for Spine's own form with the full bezier numbers.
 * Measured in legacy: an ordinary 20-bone x 3-channel x 30-key scene cost ~28,000 tokens
 * as raw keys; the measurement answers "what does this animation do" for a fraction.
 */
export function compressKeys(channel, keys, raw = false) {
  if (raw) return keys;
  const out = { time: keys.map(k => round6(keyTime(k))) };
  const spec = fieldsOf(channel);
  if (spec) {
    for (const field of spec.fields) out[field] = keys.map(k => (isNumber(k?.[field]) ? round3(k[field]) : null));
  } else {
    // Slot and other channels: attachment name, colours (rgba/rgb, rgba2/rgb2), values.
    if (keys.some(k => k && 'name' in k)) out.name = keys.map(k => (k?.name === undefined ? null : k.name));
    if (keys.some(k => k?.color)) out.color = keys.map(k => k?.color ?? null);
    if (keys.some(k => k?.light)) out.light = keys.map(k => k?.light ?? null);
    if (keys.some(k => k?.dark)) out.dark = keys.map(k => k?.dark ?? null);
    if (keys.some(k => isNumber(k?.value))) out.value = keys.map(k => (isNumber(k?.value) ? round3(k.value) : null));
    if (keys.some(k => k && 'inherit' in k)) out.inherit = keys.map(k => k?.inherit ?? null);
  }
  const curves = keys.map(k => (k?.curve === 'stepped' ? 'stepped' : Array.isArray(k?.curve) ? 'bezier' : 'linear'));
  if (curves.some(c => c !== 'linear')) out.curve = curves;
  return out;
}

// ── draw order ──

/**
 * What changed against the setup order: for every slot not at its setup index, where
 * it is now. `steps` > 0 means drawn later, i.e. further in front.
 * @param {string[]} setupOrder slot names back to front, as in the skeleton's slots array
 * @param {string[]} order      slot names back to front at some instant
 * @returns {{ slot: string, setupIndex: number, index: number, steps: number }[]}
 */
export function drawOrderChanges(setupOrder, order) {
  const position = new Map(order.map((slot, i) => [slot, i]));
  const out = [];
  setupOrder.forEach((slot, setupIndex) => {
    const index = position.get(slot);
    if (index !== undefined && index !== setupIndex) out.push({ slot, setupIndex, index, steps: index - setupIndex });
  });
  return out;
}

// The draw-order guard lives in src/spine/draw-order.js (shared with check.js and the
// runtime); re-exported here for the readers' callers.
export { drawOrderOffsetProblems, drawOrderHazards };

/**
 * Run `work` on the runtime unless the file would crash it. Returns null on success, or
 * `{ code, message, findings? }` when the runtime cannot be used for this file: broken
 * draw-order offsets (checked first, see drawOrderOffsetProblems), another Spine version,
 * or a file the official parser rejects. Any other refusal (an unknown skin) is the
 * caller's mistake and is thrown.
 */
export async function runtimeRefusal(sk, work) {
  const hazards = drawOrderHazards(sk);
  if (hazards.length) {
    return { code: 'draw-order-offsets', message: 'A draw-order key would crash the runtime, so it was not used.', findings: hazards };
  }
  try {
    await work();
    return null;
  } catch (err) {
    if (isStudioError(err, 'runtime-version') || isStudioError(err, 'runtime-parse') || isStudioError(err, 'runtime-guard')) return { code: err.code, message: err.message };
    throw err;
  }
}
