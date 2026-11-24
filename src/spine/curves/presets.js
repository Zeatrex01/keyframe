// Named interpolation curves, the asymmetric ones included. Ported from legacy
// curve_presets.js.
//
// Why a ratio could not do this: key-math's ease1/ease2 historically built the handles as
// [t0+d, v0, t1-d, v1] with d = (t1-t0)*k. Both handles sit on the key values, so the curve
// is always symmetric; `k` only chooses how soft that symmetric ease-in-out is (0 is linear,
// 0.5 is maximum smoothing). A pure ease-in (accelerate away, arrive hard) or ease-out
// (leave hard, settle in) is not a value of k, it is a different shape. That is why
// AI-written motion felt the same everywhere, and why "no curve at all" was the usual result.
//
// A Spine segment curve is a cubic bezier in (time, value) space, so any easing CSS or
// Blender can name is expressible; it needs four handle numbers instead of one ratio. The
// presets are the standard cubic-bezier easings (the CSS / easings.dev set), written
// normalized: x is the fraction across the segment's time, y the fraction across its value
// change. key-math maps them onto the real (t0, t1, v0, v1) box.
//
// y outside 0..1 is deliberate for the `back` family: the value overshoots past the key and
// settles (anticipation / overshoot). Spine stores absolute numbers, so it plays as authored.
// x outside 0..1 is refused: the runtime does not clamp it (the time would run backwards
// inside the segment) and the Spine editor cannot author it.
//
// Pure and isomorphic: the player draws the preview with sampleCurve in the page.

const freezeAll = table => Object.freeze(Object.fromEntries(
  Object.entries(table).map(([name, handles]) => [name, Object.freeze(handles)])));

/** name -> [x1, y1, x2, y2], normalized cubic-bezier control handles. */
export const PRESETS = freezeAll({
  linear: [0, 0, 1, 1],

  // Accelerate: leaves the first key slowly, arrives at speed. The suffix says how hard.
  inSine: [0.12, 0, 0.39, 0],
  inQuad: [0.11, 0, 0.5, 0],
  inCubic: [0.32, 0, 0.67, 0],
  inQuart: [0.5, 0, 0.75, 0],
  inExpo: [0.7, 0, 0.84, 0],

  // Decelerate: leaves at speed, settles into the second key. The most useful single curve
  // in character work: a limb arriving without a mechanical stop.
  outSine: [0.61, 1, 0.88, 1],
  outQuad: [0.5, 1, 0.89, 1],
  outCubic: [0.33, 1, 0.68, 1],
  outQuart: [0.25, 1, 0.5, 1],
  outExpo: [0.16, 1, 0.3, 1],

  // Both ends soft: what the old symmetric ratio names approximated.
  inOutSine: [0.37, 0, 0.63, 1],
  inOutQuad: [0.45, 0, 0.55, 1],
  inOutCubic: [0.65, 0, 0.35, 1],
  inOutQuart: [0.76, 0, 0.24, 1],
  inOutExpo: [0.87, 0, 0.13, 1],

  // Overshoot (anticipation / settle). y leaves 0..1 on purpose, see the header.
  inBack: [0.36, 0, 0.66, -0.56],
  outBack: [0.34, 1.56, 0.64, 1],
  inOutBack: [0.68, -0.6, 0.32, 1.6],
});

// Plain-word aliases for what people say out loud, so a spoken instruction lands without
// easing jargon. Keys are compared lowercased with spaces, '_' and '-' removed.
export const PRESET_ALIASES = Object.freeze({
  easein: 'inCubic', easeout: 'outCubic', easeinout: 'inOutCubic',
  accelerate: 'inCubic', decelerate: 'outCubic', overshoot: 'outBack',
});

export const presetNames = () => Object.keys(PRESETS);

const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const inUnit = x => x >= 0 && x <= 1;

/** True for four finite numbers whose x handles lie in 0..1 (y is free: overshoot is real). */
export const isValidHandles = h => Array.isArray(h) && h.length === 4 && h.every(isNumber)
  && inUnit(h[0]) && inUnit(h[2]);

const squash = s => s.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Resolve a preset name (any case, separators ignored), an alias, or raw handles.
 * @param {string | number[] | null | undefined} name
 * @returns {number[] | null} a fresh [x1, y1, x2, y2], or null when this is not a curve, so
 *   callers can fall back to the ratio names without a second lookup table
 */
export function handlesFor(name) {
  if (name === undefined || name === null) return null;
  if (Array.isArray(name)) return isValidHandles(name) ? name.slice() : null;
  const key = String(name).trim();
  if (Object.hasOwn(PRESETS, key)) return PRESETS[key].slice();
  const low = squash(key);
  for (const preset of Object.keys(PRESETS)) if (preset.toLowerCase() === low) return PRESETS[preset].slice();
  if (Object.hasOwn(PRESET_ALIASES, low)) return PRESETS[PRESET_ALIASES[low]].slice();
  return null;
}

/**
 * Sample the normalized curve for a preview: [x, y] pairs at x = 0, 1/steps, ... 1.
 * The exact cubic bezier, solved for y at each x by bisection on the curve parameter
 * (exact enough for a sparkline and free of solver edge cases). The runtime plays a
 * close polyline of the same bezier; test/curves.test.js measures the gap.
 * Anything that is not a curve previews as linear.
 * @param {string | number[]} handles
 * @param {number} [steps]
 * @returns {Array<[number, number]>}
 */
export function sampleCurve(handles, steps = 24) {
  const [x1, y1, x2, y2] = handlesFor(handles) ?? PRESETS.linear;
  const bezier = (a, b, t) => { const u = 1 - t; return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t; };
  const n = Math.max(2, Math.floor(steps) || 24);
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    let lo = 0, hi = 1, t = x;
    for (let g = 0; g < 24; g++) {
      t = (lo + hi) / 2;
      if (bezier(x1, x2, t) < x) lo = t; else hi = t;
    }
    out.push([x, bezier(y1, y2, t)]);
  }
  return out;
}
