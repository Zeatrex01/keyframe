// How a key is written correctly: its time (the frame grid) and its curve (the ease).
// Ported from legacy keymath.js.
//
// Why it exists once: the rounding helpers, ease1/ease2 and the ease table used to live
// byte for byte in two writers. A duplicated ease table is drift no eye can see on a
// filmstrip: add a curve name to one copy and the same word means two curves.
//
// The one design decision: the frame grid is a factory, never module state. A writer once
// kept `let FPS` at module level and returned whatever the last build left behind.
// frameGrid(fps) returns a self-contained { fps, snap, shift }, so two builds can never see
// each other's frame rate; the resolved fps is a value passed around, not a global.
//
// Pure and isomorphic.

import { handlesFor } from './presets.js';

export const isNumber = v => typeof v === 'number' && Number.isFinite(v);
/** Every written value except key times: 4 decimals. */
export const round4 = v => +(+v).toFixed(4);

export const FPS_DEFAULT = 30;
export const MAX_FPS = 240;

/*
 * The frame grid. The studio once placed half-frame keys (23.5, 21.5) where an animator
 * keys whole frames. The cause was ours: times were produced
 * in seconds rounded to 4 decimals, but Spine works in frames, and 0.7833 s at 30 fps is
 * frame 23.5: a valid file, but a key between two frames, hard to select and impossible to
 * align with hand-made keys. What the studio delivers is a timeline to be worked on.
 *
 * Times use 6 decimals where every other value uses 4. Measured: 23/30 = 0.7666...
 * rounds at 4 decimals to 0.7667 = frame 23.001, so the very key that was snapped falls off
 * the grid again. At 6 decimals the error is 1.5e-5 frames. Bezier handles are deliberately
 * not snapped: they are not keys, carry no frame line in the editor, and snapping them
 * distorts the easing.
 */
/**
 * @param {number} [fps] frames per second; anything that does not round to 1..240 falls
 *   back to FPS_DEFAULT
 * @returns {{ fps: number, snap: (t: number) => number, shift: (t: number) => number }}
 */
export function frameGrid(fps) {
  const rate = isNumber(fps) && Math.round(fps) >= 1 && fps <= MAX_FPS ? Math.round(fps) : FPS_DEFAULT;
  // The one gate every written time passes through: snap to the grid, then round.
  const snap = t => +(Math.round((+t || 0) * rate) / rate).toFixed(6);
  // How far snapping moved a key: never more than half a frame. The caller reports it,
  // because a silent shift is as bad as a silent drop.
  const shift = t => Math.abs((+t || 0) - snap(t));
  return { fps: rate, snap, shift };
}

/*
 * `k` is either a ratio or a shape (2026-08-25). Historically k was one number, the
 * handle's ratio within the segment, which always gave a symmetric ease because both
 * handles sat on the key values. A named preset arrives instead as four normalized handles
 * [x1, y1, x2, y2] (presets.js), and every call site that forwards easeOf's result gains
 * the whole preset set unchanged. The numeric form is exactly the handle pair [k, 0, 1-k, 1].
 */
const normalize = k => (Array.isArray(k) && k.length === 4 ? k : [k, 0, 1 - k, 1]);

// A handle time is rounded to 4 decimals, but a key time may carry 6 (frame grid). Rounding
// must never push a handle outside its key pair: the checker flags cx outside [t0, t1].
const handleTimes = (t0, t1, x1, x2) => {
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  const at = x => Math.min(hi, Math.max(lo, round4(t0 + (t1 - t0) * x)));
  return [at(x1), at(x2)];
};

/**
 * Single-property timeline (rotate, translatex/y, scalex/y, shearx/y, alpha): 4 numbers,
 * absolute [cx1, cy1, cx2, cy2]. Writing 8 makes the file unreadable: the runtime reads 4
 * per property and takes the overflow for the next key's curve.
 * @param {number | number[]} k ratio 0..0.5 or normalized handles
 */
export function ease1(t0, t1, v0, v1, k) {
  const [x1, y1, x2, y2] = normalize(k);
  const [cx1, cx2] = handleTimes(t0, t1, x1, x2);
  return [cx1, round4(v0 + (v1 - v0) * y1), cx2, round4(v0 + (v1 - v0) * y2)];
}

/** Two-property timeline (translate, scale, shear): one bezier per property, 8 numbers. */
export function ease2(t0, t1, a0, a1, b0, b1, k) {
  const [x1, y1, x2, y2] = normalize(k);
  const [cx1, cx2] = handleTimes(t0, t1, x1, x2);
  return [cx1, round4(a0 + (a1 - a0) * y1), cx2, round4(a0 + (a1 - a0) * y2),
    cx1, round4(b0 + (b1 - b0) * y1), cx2, round4(b0 + (b1 - b0) * y2)];
}

/*
 * Per-key ease names: k is the bezier handle's ratio within the segment; 'stepped' drops
 * the curve entirely (the value holds until the next key).
 * Key order is contract: the strict writer builds its refusal message from
 * Object.keys(EASE_RATIOS). Append, do not reorder.
 * Recorded, not changed: the strict writer refuses an unknown name, easeOf below falls
 * back to normal. Unifying them is a behaviour change that waits for the owner.
 */
export const EASE_RATIOS = Object.freeze({
  linear: 0, sharp: 0.08, fast: 0.15, normal: 1 / 3, soft: 0.45, softest: 0.5,
  smooth: 1 / 3, ease: 1 / 3, softer: 0.45,
});

/**
 * The lenient reading of a key's `ease` (layer tracks and colours). A preset name resolves
 * to four handles and is returned as is; ease1/ease2 accept both forms.
 * @param {{ ease?: unknown } | null | undefined} key
 * @returns {number | number[] | 'stepped'}
 */
export function easeOf(key) {
  const e = /** @type {any} */ (key?.ease);
  if (e === undefined || e === null) return 1 / 3;
  if (isNumber(e)) return Math.min(0.5, Math.max(0, e));
  const name = String(e).toLowerCase();
  if (name === 'stepped') return 'stepped';
  if (Object.hasOwn(EASE_RATIOS, name)) return EASE_RATIOS[name];
  return handlesFor(e) ?? 1 / 3;
}
