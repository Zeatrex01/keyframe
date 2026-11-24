// Curves of the Keyframe engine: how a value moves between two keys.
//
// A key's `curve` describes the segment from that key to the next one:
//   "linear" (or absent)        straight line
//   "stepped"                   hold the value until the next key
//   [x1, y1, x2, y2]            cubic bezier handles, normalized to the segment (CSS style):
//                               x across the segment's time, y across its value change
//   "<preset>"                  a named easing (src/spine/curves/presets.js: outCubic, inOutSine, ...)
//   { "absolute": [cx1, cy1, cx2, cy2] }  handles in time and value units, Spine's own form;
//                               written by the Spine importer when the two keys hold the same
//                               value and the normalized form would lose the bump between them
//
// A bezier is played the way the Spine runtime plays it: the curve is sampled at nine evenly
// spaced parameters and read as a polyline. The polyline differs from the exact cubic by a
// fraction of a percent of the segment, and using the same one keeps a clip identical in the
// Keyframe player and in any Spine runtime (test/engine-parity.test.js).
//
// Pure and isomorphic.

import { handlesFor } from '../spine/curves/presets.js';
import { StudioError } from '../shared/errors.js';

export const LINEAR = Object.freeze({ kind: 'linear' });
export const STEPPED = Object.freeze({ kind: 'stepped' });

const isNumber = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Resolve a key's curve to { kind: 'linear' | 'stepped' } or
 * { kind: 'bezier', handles } or { kind: 'absolute', points }.
 * Throws `bad-curve` for anything else, so a typo never plays as linear in silence.
 * @param {unknown} curve
 * @param {string} [where]
 */
export function resolveCurve(curve, where = 'curve') {
  if (curve === undefined || curve === null || curve === 'linear') return LINEAR;
  if (curve === 'stepped') return STEPPED;
  if (Array.isArray(curve)) {
    if (curve.length === 4 && curve.every(isNumber) && curve[0] >= 0 && curve[0] <= 1 && curve[2] >= 0 && curve[2] <= 1) {
      return { kind: 'bezier', handles: curve.slice() };
    }
    throw new StudioError('bad-curve', `${where}: a curve array is four numbers [x1, y1, x2, y2] with x1 and x2 between 0 and 1.`, { where, curve });
  }
  if (typeof curve === 'object' && Array.isArray(/** @type {any} */ (curve).absolute)) {
    const points = /** @type {any} */ (curve).absolute;
    if (points.length === 4 && points.every(isNumber)) return { kind: 'absolute', points: points.slice() };
    throw new StudioError('bad-curve', `${where}: "absolute" is four numbers [cx1, cy1, cx2, cy2].`, { where, curve });
  }
  if (typeof curve === 'string') {
    const handles = handlesFor(curve);
    if (handles) return { kind: 'bezier', handles };
  }
  throw new StudioError('bad-curve', `${where}: unknown curve ${JSON.stringify(curve)}. Use "linear", "stepped", a preset name or [x1, y1, x2, y2].`, { where, curve });
}

/** The absolute control points of a resolved bezier on one segment. */
export function controlPoints(resolved, t0, v0, t1, v1) {
  if (resolved.kind === 'absolute') return resolved.points;
  const [x1, y1, x2, y2] = resolved.handles;
  return [t0 + (t1 - t0) * x1, v0 + (v1 - v0) * y1, t0 + (t1 - t0) * x2, v0 + (v1 - v0) * y2];
}

/**
 * Nine samples (time, value) of the cubic at parameters 0.1 .. 0.9, the polyline the Spine
 * runtime reads a bezier segment as.
 * @returns {Float64Array} 18 numbers
 */
export function bezierSamples(t0, v0, cx1, cy1, cx2, cy2, t1, v1) {
  const out = new Float64Array(18);
  for (let i = 1; i <= 9; i++) {
    const u = i / 10, m = 1 - u;
    const b0 = m * m * m, b1 = 3 * m * m * u, b2 = 3 * m * u * u, b3 = u * u * u;
    out[(i - 1) * 2] = b0 * t0 + b1 * cx1 + b2 * cx2 + b3 * t1;
    out[(i - 1) * 2 + 1] = b0 * v0 + b1 * cy1 + b2 * cy2 + b3 * v1;
  }
  return out;
}

/** Read a sampled bezier at `time` (t0 <= time <= t1). */
export function readSamples(samples, time, t0, v0, t1, v1) {
  let px = t0, py = v0;
  for (let i = 0; i < 18; i += 2) {
    const x = samples[i], y = samples[i + 1];
    if (x >= time) return x === px ? y : py + (time - px) / (x - px) * (y - py);
    px = x; py = y;
  }
  return t1 === px ? v1 : py + (time - px) / (t1 - px) * (v1 - py);
}

/**
 * The fraction 0..1 (or beyond, for overshoot) of a segment at `time`, for channels whose
 * value is not one number (colours, deform). Same polyline rule as values.
 */
export function segmentPercent(resolved, t0, t1, time) {
  if (resolved.kind === 'stepped') return 0;
  const span = t1 - t0;
  if (resolved.kind === 'linear' || span <= 0) return span <= 0 ? 1 : (time - t0) / span;
  const [cx1, cy1, cx2, cy2] = controlPoints(resolved, t0, 0, t1, 1);
  return readSamples(bezierSamples(t0, 0, cx1, cy1, cx2, cy2, t1, 1), time, t0, 0, t1, 1);
}

/**
 * Compile one channel's keys into something cheap to evaluate many times.
 * @param {Array<{ time?: number, value?: number, curve?: unknown }>} keys sorted by time
 * @param {number} defaultValue  the value of a key that leaves `value` out
 * @param {string} where
 */
export function compileChannel(keys, defaultValue, where) {
  const times = new Float32Array(keys.length);
  const values = new Float32Array(keys.length);
  const curves = [];
  keys.forEach((k, i) => {
    times[i] = isNumber(k.time) ? k.time : 0;
    values[i] = isNumber(k.value) ? k.value : defaultValue;
    curves.push(resolveCurve(k.curve, `${where}[${i}]`));
  });
  const samples = curves.map((c, i) => {
    if ((c.kind !== 'bezier' && c.kind !== 'absolute') || i === keys.length - 1) return null;
    const [cx1, cy1, cx2, cy2] = controlPoints(c, times[i], values[i], times[i + 1], values[i + 1]);
    return bezierSamples(times[i], values[i], cx1, cy1, cx2, cy2, times[i + 1], values[i + 1]);
  });
  return { times, values, curves, samples };
}

/** Index of the last key at or before `time`; -1 before the first key. */
export function keyIndex(times, time) {
  if (!times.length || time < times[0]) return -1;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= time) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Value of a compiled channel at `time`, or undefined before its first key. */
export function channelValue(channel, time) {
  const { times, values, curves, samples } = channel;
  const i = keyIndex(times, time);
  if (i < 0) return undefined;
  if (i === times.length - 1) return values[i];
  const c = curves[i];
  if (c.kind === 'stepped') return values[i];
  const t0 = times[i], t1 = times[i + 1], v0 = values[i], v1 = values[i + 1];
  if (c.kind === 'linear') return t1 === t0 ? v1 : v0 + (time - t0) / (t1 - t0) * (v1 - v0);
  return readSamples(samples[i], time, t0, v0, t1, v1);
}

/** The value of one segment at `time` (t0 <= time <= t1) under a resolved curve. */
export function segmentValue(resolved, t0, v0, t1, v1, time) {
  if (resolved.kind === 'stepped') return v0;
  if (resolved.kind === 'linear') return t1 === t0 ? v1 : v0 + (time - t0) / (t1 - t0) * (v1 - v0);
  const [cx1, cy1, cx2, cy2] = controlPoints(resolved, t0, v0, t1, v1);
  return readSamples(bezierSamples(t0, v0, cx1, cy1, cx2, cy2, t1, v1), time, t0, v0, t1, v1);
}
