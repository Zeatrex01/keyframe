// Motion out of pixels: follow one element through a run of frames and say what it did, in the
// terms an animation is written in (scale, translate, rotate, alpha; key times; an ease per
// segment). Pure and isomorphic: frames are { width, height, data: RGBA bytes }.
//
// How the element is found: the frames are a crop around it, so the ring of pixels along the
// crop's border is background. Everything far enough from that colour is the element. That
// holds for a UI element on a plain or softly shaded ground; on a busy ground the border colour
// spreads, and the result says so through `confidence` instead of pretending.

import { PRESETS, sampleCurve } from '../spine/curves/presets.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, digits = 3) => +(+v).toFixed(digits);
const median = values => { const s = [...values].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/**
 * The ground, from the border ring of every frame: a colour that may shade evenly across the
 * crop (a menu bar's gradient), fitted as a plane per channel, and how far the border strays
 * from that plane (`spread`: a busy ground).
 * @returns {{ color: number[], slopeX: number[], slopeY: number[], spread: number }}
 */
export function backgroundOf(frames) {
  const points = [];
  for (const { width, height, data } of frames) {
    const take = (x, y) => { const i = (y * width + x) * 4; points.push([x / width - 0.5, y / height - 0.5, data[i], data[i + 1], data[i + 2]]); };
    const stepX = Math.max(1, Math.floor(width / 48)), stepY = Math.max(1, Math.floor(height / 48));
    for (let x = 0; x < width; x += stepX) { take(x, 0); take(x, height - 1); }
    for (let y = 0; y < height; y += stepY) { take(0, y); take(width - 1, y); }
  }
  // Least squares for c + a*u + b*v per channel; u and v are centred, so the ring is nearly
  // symmetric and the system is well conditioned.
  const n = points.length;
  let su = 0, sv = 0, suu = 0, svv = 0, suv = 0;
  for (const [u, v] of points) { su += u; sv += v; suu += u * u; svv += v * v; suv += u * v; }
  const m = [[n, su, sv], [su, suu, suv], [sv, suv, svv]];
  const det = a => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  const color = [], slopeX = [], slopeY = [];
  for (let k = 0; k < 3; k++) {
    let s0 = 0, s1 = 0, s2 = 0;
    for (const p of points) { s0 += p[2 + k]; s1 += p[2 + k] * p[0]; s2 += p[2 + k] * p[1]; }
    const solve = col => det(m.map((row, r) => row.map((value, c) => (c === col ? [s0, s1, s2][r] : value)))) / d;
    if (Math.abs(d) < 1e-9) { color.push(median(points.map(p => p[2 + k]))); slopeX.push(0); slopeY.push(0); }
    else { color.push(solve(0)); slopeX.push(solve(1)); slopeY.push(solve(2)); }
  }
  const spread = Math.max(...[0, 1, 2].map(k => median(points.map(p => Math.abs(p[2 + k] - (color[k] + slopeX[k] * p[0] + slopeY[k] * p[1]))))));
  return { color: color.map(c => Math.round(c)), slopeX: slopeX.map(v => round(v, 2)), slopeY: slopeY.map(v => round(v, 2)), spread: round(spread, 2) };
}

/**
 * Where the element is in one frame and how big, or null when nothing stands out.
 *
 * Sizes are measured to a fraction of a pixel, because a squash of a few percent on a small
 * icon is less than one pixel: every pixel counts by how far it is from the ground (its
 * coverage), and the size along an axis is the spread of that coverage about its centre (the
 * second moment). Under a scale the spread follows the true scale exactly, whatever the shape,
 * and it barely moves when compression blurs the edges.
 */
export function measureFrame({ width, height, data }, background, floor) {
  const { color, slopeX = [0, 0, 0], slopeY = [0, 0, 0] } = background;
  const distance = new Float32Array(width * height);
  const strong = [];
  for (let y = 0, i = 0, p = 0; y < height; y++) {
    const v = y / height - 0.5;
    for (let x = 0; x < width; x++, i += 4, p++) {
      const u = x / width - 0.5;
      const d = Math.max(Math.abs(data[i] - (color[0] + slopeX[0] * u + slopeY[0] * v)), Math.abs(data[i + 1] - (color[1] + slopeX[1] * u + slopeY[1] * v)), Math.abs(data[i + 2] - (color[2] + slopeX[2] * u + slopeY[2] * v)));
      if (d >= floor) { distance[p] = d; strong.push(d); }
    }
  }
  if (strong.length < 12) return null;
  strong.sort((a, b) => a - b);
  // Full coverage is what the element's solid parts measure in THIS frame, so a fade does not
  // read as a shrink.
  const full = strong[Math.floor(strong.length * 0.6)];
  const rows = new Float64Array(height), cols = new Float64Array(width);
  let area = 0, sumX = 0, sumY = 0;
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p++) {
      // Glows, soft shadows and compression haze are far weaker than the element's solid
      // parts; they are not its shape.
      if (distance[p] < full * 0.5) { distance[p] = 0; continue; }
      const c = Math.min(1, distance[p] / full);
      area += c; sumX += c * x; sumY += c * y; rows[y] += c; cols[x] += c;
    }
  }
  const cx = sumX / area + 0.5, cy = sumY / area + 0.5;
  // Whole-pixel box, for placing the anchor at rest; thin stragglers (a sparkle) are ignored.
  const span = profile => { const least = Math.max(0.5, Math.max(...profile) * 0.04); let lo = 0, hi = profile.length - 1; while (lo < hi && profile[lo] < least) lo++; while (hi > lo && profile[hi] < least) hi--; return [lo, hi + 1]; };
  const [x0, x1] = span(cols), [y0, y1] = span(rows);
  let mxx = 0, myy = 0, mxy = 0;
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) { if (!distance[p]) continue; const c = Math.min(1, distance[p] / full), dx = x + 0.5 - cx, dy = y + 0.5 - cy; mxx += c * dx * dx; myy += c * dy * dy; mxy += c * dx * dy; }
  const common = Math.sqrt((mxx - myy) ** 2 + 4 * mxy * mxy);
  const elongation = Math.sqrt((mxx + myy + common) / Math.max(1e-9, mxx + myy - common));
  // For an evenly covered box, sqrt(12 * variance) is its side.
  const sizeX = Math.sqrt(12 * mxx / area), sizeY = Math.sqrt(12 * myy / area);
  // y grows downward in an image; the angle is reported counter-clockwise, as Spine rotates.
  const angle = -0.5 * Math.atan2(2 * mxy, mxx - myy) * 180 / Math.PI;
  // An element cut by the crop puts a real share of itself on the border.
  const edge = Math.max(rows[0], rows[height - 1]) / Math.max(1e-9, Math.max(...rows)) > 0.3 || Math.max(cols[0], cols[width - 1]) / Math.max(1e-9, Math.max(...cols)) > 0.3;
  // How the coverage is laid out across each axis, in units of the element's own size: the
  // same for any scale of a rigid shape, different once its parts move against each other.
  const layout = (profile, centre, size) => {
    const bins = new Float64Array(16);
    for (let i = 0; i < profile.length; i++) { if (!profile[i]) continue; const u = (i + 0.5 - centre) / (size / 2); const k = Math.floor((u + 1.6) / 3.2 * 16); if (k >= 0 && k < 16) bins[k] += profile[i]; }
    return Array.from(bins, v => v / area);
  };
  return { area, x0, x1, y0, y1, width: sizeX, height: sizeY, cx, cy, angle, elongation, strength: full, edge, layoutX: layout(cols, cx, sizeX), layoutY: layout(rows, cy, sizeY) };
}

const unwrap = (angle, previous) => { let a = angle; while (a - previous > 90) a -= 180; while (a - previous < -90) a += 180; return a; };

/**
 * Follow the element through the frames.
 * @param {Array<{width:number,height:number,data:Uint8Array|Uint8ClampedArray}>} frames
 * @param {object} [options]
 * @param {number} [options.fps]  frames per second of `frames` (required in practice)
 * @param {string} [options.anchor='bottom']  'bottom' | 'center' | 'top': the point whose travel is "translate"
 * @param {string} [options.rest='auto']      'auto' | 'first' | 'last': which state counts as scale 1, offset 0
 * @param {ReturnType<typeof backgroundOf>} [options.background]  the ground (default: read from the crop's border)
 * @returns {{ fps: number, samples: object[], confidence: number, background: any, note?: string,
 *   anchor?: string, rotates?: boolean, rest?: { width: number, height: number }, [more: string]: any }}
 */
export function trackFrames(frames, { fps, anchor = 'bottom', rest = 'auto', background = backgroundOf(frames) } = {}) {
  if (!frames.length) return { fps, samples: [], confidence: 0, background };
  const floor = Math.max(18, background.spread * 4);
  // The ground is read again in every frame: a button plate that lights up when pressed, or a
  // screen that dims, changes the ground under an element that has not changed at all.
  const raw = frames.map(frame => { const ground = backgroundOf([frame]); return measureFrame(frame, ground.spread <= background.spread + 6 ? ground : background, floor); });
  const seen = raw.filter(Boolean);
  if (!seen.length) return { fps, samples: [], confidence: 0, background, note: 'Nothing stands out from the ground in this crop.' };
  // 'auto': the state the element is in most often, which is the rest pose of a tap and the
  // end pose of a reveal that holds. (A motion with no hold has no such state: pass 'first'.)
  const pick = rest === 'first' ? raw.find(Boolean) : rest === 'last' ? [...raw].reverse().find(Boolean) : null;
  // The most common size is the rest size (not the median: an element that moves most of the
  // time has a median somewhere mid-move). Rest frames are the ones at that size.
  const common = values => {
    const sorted = [...values].sort((x, y) => x - y), width = Math.max(1e-6, median(sorted) * 0.03);
    let best = [0, 0];
    for (let lo = 0, hi = 0; lo < sorted.length; lo++) { while (hi < sorted.length && sorted[hi] - sorted[lo] <= width) hi++; if (hi - lo > best[1] - best[0]) best = [lo, hi]; }
    return { value: sorted.slice(best[0], best[1]).reduce((x, y) => x + y, 0) / (best[1] - best[0]), width };
  };
  const restW = common(seen.map(m => m.width)), restH = common(seen.map(m => m.height));
  const atRest = seen.filter(m => Math.abs(m.width - restW.value) <= restW.width && Math.abs(m.height - restH.value) <= restH.width);
  const calm = atRest.length ? atRest : seen;
  const mid = field => median(calm.map(m => m[field]));
  const base = pick ?? { width: restW.value, height: restH.value, cx: mid('cx'), cy: mid('cy'), x0: mid('x0'), x1: mid('x1'), y0: mid('y0'), y1: mid('y1'), angle: mid('angle'), strength: mid('strength') };
  // The anchor is a fixed point of the element; where it sits follows from the centroid and
  // the scale, both known to a fraction of a pixel.
  const offsetY = (anchor === 'top' ? base.y0 : anchor === 'center' ? (base.y0 + base.y1) / 2 : base.y1) - base.cy;
  // A turn is only readable from a clearly long shape whose axis moves smoothly; a compact
  // shape's axis flips at random and would read as a spin.
  const axes = seen.map(m => m.angle);
  const jumpy = axes.some((v, i) => i > 0 && Math.abs(unwrap(v, axes[i - 1]) - axes[i - 1]) > 25);
  const turns = median(seen.map(m => m.elongation)) > 1.5 && !jumpy;
  let previous = base.angle;
  const samples = raw.map((m, i) => {
    const time = round(i / fps, 4);
    if (!m) return { time, visible: false, alpha: 0 };
    previous = unwrap(m.angle, previous);
    const sx = m.width / base.width, sy = m.height / base.height;
    return { time, visible: true, sx: round(sx), sy: round(sy),
      tx: round((m.cx - base.cx) / base.height), ty: round(-((m.cy + offsetY * sy) - (base.cy + offsetY)) / base.height),
      rot: turns ? round(previous - base.angle, 2) : 0,
      alpha: round(clamp(m.strength / base.strength, 0, 1)) };
  });
  // Where the element is not there at all (before a fade-in, after a fade-out) it has no size
  // to report: carry the nearest shape, so only alpha tells the story.
  const shape = i => { for (let d = 1; d < samples.length; d++) for (const j of [i + d, i - d]) if (samples[j]?.visible) return samples[j]; return null; };
  samples.forEach((s, i) => { if (!s.visible) { const n = shape(i); Object.assign(s, { sx: n?.sx ?? 1, sy: n?.sy ?? 1, tx: n?.tx ?? 0, ty: n?.ty ?? 0, rot: n?.rot ?? 0 }); } });
  const cut = raw.map((m, i) => (m?.edge ? samples[i].time : null)).filter(t => t !== null);
  // A rigid element keeps its layout whatever its scale. When the layout shifts, the shape
  // itself is changing: parts move apart (a lid lifting off a box) or pixels appear (a burst).
  const restFrame = pick ?? calm[0];
  const shift = m => 0.5 * Math.max(...['layoutX', 'layoutY'].map(axis => m[axis].reduce((sum, v, k) => sum + Math.abs(v - restFrame[axis][k]), 0)));
  const loose = raw.map((m, i) => (m && shift(m) > 0.16 ? samples[i].time : null)).filter(t => t !== null);
  const shapeChanges = loose.length >= Math.max(2, raw.length * 0.05);
  const frame = frames[0];
  const fill = (base.x1 - base.x0) * (base.y1 - base.y0) / (frame.width * frame.height);
  // Low when the ground is noisy, or when the element fills the crop (its edge is then the "ground").
  const confidence = round(clamp(1 - background.spread / 40, 0, 1) * clamp((0.92 - fill) / 0.25, 0, 1) * (cut.length ? 0.3 : 1) * (shapeChanges ? 0.5 : 1), 2);
  return { fps, anchor, rotates: turns, rest: { width: round(base.x1 - base.x0, 1), height: round(base.y1 - base.y0, 1) }, samples, confidence, background,
    ...(cut.length ? { cutAt: cut.slice(0, 6), note: `The element touches the edge of the region (first at ${cut[0]} s), so its size is under-measured there. Widen the region; if the video itself cuts it off, the peak is a lower bound.` }
      : shapeChanges ? { shapeChangesAt: loose.slice(0, 6), note: `This is not one rigid element between ${loose[0]} s and ${loose[loose.length - 1]} s: its parts move apart or new pixels appear (a lid lifting, a glow, a burst), so the scale read here mixes them. Measure the parts separately with a tighter region each, or pick the part that carries the move.` }
      : confidence < 0.5 ? { note: 'Low confidence: the ground around the element is not plain, or the crop is too tight. Widen the region or pick a cleaner moment.' } : {}) };
}

// ── keys and eases ──

const TABLES = Object.fromEntries(Object.keys(PRESETS).map(name => [name, sampleCurve(name, 48).map(([, y]) => y)]));
// Simpler names first: on a near tie the plainer ease wins.
const CANDIDATES = ['linear', 'outSine', 'inSine', 'inOutSine', 'outQuad', 'inQuad', 'inOutQuad', 'outCubic', 'inCubic', 'inOutCubic',
  'outQuart', 'inQuart', 'inOutQuart', 'outExpo', 'inExpo', 'inOutExpo', 'outBack', 'inBack', 'inOutBack'].filter(n => n in TABLES);
const presetAt = (name, u) => { const t = TABLES[name], p = clamp(u, 0, 1) * (t.length - 1), i = Math.floor(p); return i >= t.length - 1 ? t[t.length - 1] : t[i] + (t[i + 1] - t[i]) * (p - i); };

// y of a normalized cubic bezier (handles [x1, y1, x2, y2]) at time fraction u: bisection on the
// curve parameter, which is monotone in x because both x handles lie in 0..1.
function handlesAt(h, u) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) { const s = (lo + hi) / 2, r = 1 - s; if (3 * r * r * s * h[0] + 3 * r * s * s * h[2] + s * s * s < u) lo = s; else hi = s; }
  const s = (lo + hi) / 2, r = 1 - s;
  return 3 * r * r * s * h[1] + 3 * r * s * s * h[3] + s * s * s;
}

/**
 * The cubic bezier that best explains the samples strictly between two keys, by least squares:
 * a coarse search over the four handles, then a descent that halves its step. This is what a
 * preset name cannot say: a move whose shape is the video's own.
 * @returns {{handles:number[], error:number}} normalized [x1, y1, x2, y2] and the RMS error, as a
 *   fraction of the move
 */
export function fitHandles(values, from, to) {
  const delta = values[to] - values[from], span = to - from, points = [];
  for (let i = from + 1; i < to; i++) points.push([(i - from) / span, (values[i] - values[from]) / delta]);
  const cost = h => { let sum = 0; for (const [u, want] of points) sum += (handlesAt(h, u) - want) ** 2; return sum; };
  const X = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1], Y = [-0.4, -0.1, 0, 0.2, 0.5, 0.8, 1, 1.1, 1.4];
  let best = [1 / 3, 1 / 3, 2 / 3, 2 / 3], least = cost(best);
  for (const x1 of X) for (const y1 of Y) for (const x2 of X) for (const y2 of Y) { const c = cost([x1, y1, x2, y2]); if (c < least) { least = c; best = [x1, y1, x2, y2]; } }
  for (let step = 0.08; step > 0.004; step /= 2) {
    for (let moved = true, rounds = 0; moved && rounds < 12; rounds++) {
      moved = false;
      for (let k = 0; k < 4; k++) for (const d of [-step, step]) {
        const next = best.slice(); next[k] += d;
        if (k % 2 === 0) next[k] = clamp(next[k], 0, 1);   // an x handle outside 0..1 runs time backwards
        const c = cost(next);
        if (c < least - 1e-12) { least = c; best = next; moved = true; }
      }
    }
  }
  return { handles: best.map(v => round(v)), error: round(Math.sqrt(least / points.length)) };
}

// A fitted curve replaces the preset only when the preset is visibly off, the fit is clearly
// closer, and there are enough samples to support four numbers.
const CUSTOM = { minSamples: 5, presetOff: 0.03, gain: 0.6 };

/**
 * The preset that best explains the samples strictly between two keys; and, when no preset
 * does, the fitted `curve` (the nearest preset name stays in `ease` for the reader).
 */
export function fitEase(values, from, to) {
  const delta = values[to] - values[from];
  const inner = to - from - 1;
  if (inner < 1 || Math.abs(delta) < 1e-9) return { ease: 'linear', error: 0, samples: Math.max(0, inner) };
  let best = null;
  // An overshoot is a strong claim; two samples cannot support it.
  for (const name of inner < 3 ? CANDIDATES.filter(n => !n.endsWith('Back')) : CANDIDATES) {
    let sum = 0;
    for (let i = from + 1; i < to; i++) { const want = (values[i] - values[from]) / delta; sum += (presetAt(name, (i - from) / (to - from)) - want) ** 2; }
    const error = Math.sqrt(sum / inner);
    if (!best || error < best.error - 0.012) best = { ease: name, error };
  }
  if (inner >= CUSTOM.minSamples && best.error > CUSTOM.presetOff) {
    const fit = fitHandles(values, from, to);
    if (fit.error < best.error * CUSTOM.gain) return { ease: best.ease, curve: fit.handles, error: fit.error, presetError: round(best.error), samples: inner };
  }
  return { ease: best.ease, error: round(best.error), samples: inner };
}

// An eased move is flat at its top for a few samples; its key is the middle of that flat.
function plateauMiddle(values, index, tolerance) {
  let lo = index, hi = index;
  while (lo > 0 && Math.abs(values[lo - 1] - values[index]) <= tolerance) lo--;
  while (hi < values.length - 1 && Math.abs(values[hi + 1] - values[index]) <= tolerance) hi++;
  return Math.round((lo + hi) / 2);
}

/** Indices of the samples that are keys: ends, turning points, and the edges of holds. */
export function findKeys(values, epsilon, holdSamples = 3) {
  const n = values.length;
  if (n < 2) return [0];
  const keys = new Set([0, n - 1]);
  // Turning points, with the turn at least `epsilon` away from the last key value.
  let anchor = 0, direction = 0, extreme = 0;
  for (let i = 1; i < n; i++) {
    const step = values[i] - values[extreme];
    if (direction === 0) { if (Math.abs(values[i] - values[anchor]) >= epsilon) { direction = Math.sign(values[i] - values[anchor]); extreme = i; } continue; }
    if (step * direction > 0) { extreme = i; continue; }
    if (Math.abs(values[i] - values[extreme]) >= epsilon) { const key = plateauMiddle(values, extreme, epsilon / 3); keys.add(key); anchor = key; direction = -direction; extreme = i; }
  }
  // Holds: a stretch of at least `holdSamples` that does not move marks both of its edges.
  // (The flat top of an eased move is shorter than that and is not a hold.)
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && Math.abs(values[i] - values[runStart]) < epsilon / 4) continue;
    if (i - runStart >= holdSamples) { keys.add(runStart); keys.add(i - 1); }
    runStart = i;
  }
  return [...keys].sort((a, b) => a - b);
}

const EPSILON = { scale: 0.02, translate: 0.02, rotate: 1.2, alpha: 0.06 };

function channelKeys(samples, fields, epsilon, fps) {
  const holdSamples = Math.max(3, Math.round(fps * 0.1));
  const series = fields.map(f => samples.map(s => s[f]));
  const moves = series.some(v => Math.max(...v) - Math.min(...v) >= epsilon);
  if (!moves) return null;
  let indices = [...new Set(series.flatMap(v => findKeys(v, epsilon, holdSamples)))].sort((a, b) => a - b);
  // Two components rarely turn on the very same frame; keys a frame apart are one key.
  indices = indices.filter((index, k) => k === 0 || index === samples.length - 1 || index - indices[k - 1] > 1 || false);
  // A segment no preset explains gets one more key at its worst sample.
  const lead = (from, to) => series.reduce((a, b) => Math.abs(a[to] - a[from]) >= Math.abs(b[to] - b[from]) ? a : b);
  for (let pass = 0; pass < 2; pass++) {
    const extra = [];
    for (let k = 0; k + 1 < indices.length; k++) {
      const from = indices[k], to = indices[k + 1], values = lead(from, to);
      const fit = fitEase(values, from, to);
      if (fit.samples >= 4 && fit.error > 0.14) {
        let worst = from + 1, gap = -1;
        for (let i = from + 1; i < to; i++) { const line = values[from] + (values[to] - values[from]) * (i - from) / (to - from); if (Math.abs(values[i] - line) > gap) { gap = Math.abs(values[i] - line); worst = i; } }
        if (worst - from > 1 && to - worst > 1) extra.push(worst);
      }
    }
    if (!extra.length) break;
    indices = [...new Set([...indices, ...extra])].sort((a, b) => a - b);
  }
  return indices.map((index, k) => {
    const key = { time: samples[index].time };
    fields.forEach((f, c) => { key[fields.length === 1 ? 'value' : (c ? 'y' : 'x')] = series[c][index]; });
    if (k + 1 < indices.length) {
      const next = indices[k + 1], values = lead(index, next);
      if (Math.abs(values[next] - values[index]) >= epsilon / 2) { const fit = fitEase(values, index, next); key.ease = fit.ease; if (fit.curve) key.curve = fit.curve; if (fit.samples < 2) key.guessed = true; }
    }
    return key;
  });
}

/** Keys with eases for one sampled channel (`fields` of each sample), or null when it does not move. */
export function fitKeys(samples, fields, epsilon, fps) { return channelKeys(samples, fields, epsilon, fps); }

/** A span where the element is moving or holding still, from frame-to-frame change. */
function beatsOf(samples, fps) {
  const change = samples.map((s, i) => i ? Math.abs(s.sx - samples[i - 1].sx) + Math.abs(s.sy - samples[i - 1].sy) + Math.abs(s.tx - samples[i - 1].tx) + Math.abs(s.ty - samples[i - 1].ty) + Math.abs(s.rot - samples[i - 1].rot) / 60 + Math.abs(s.alpha - samples[i - 1].alpha) : 0);
  const beats = [];
  let start = 0, moving = change[1] > 0.006;
  for (let i = 2; i <= samples.length; i++) {
    const now = i < samples.length ? change[i] > 0.006 : !moving;
    if (now === moving) continue;
    beats.push({ from: samples[start].time, to: samples[i - 1].time, kind: moving ? 'move' : 'hold' });
    start = i - 1; moving = now;
  }
  // Blips of a frame or two are noise: fold them into their neighbour.
  const merged = [];
  for (const beat of beats) {
    const last = merged[merged.length - 1];
    // A still moment shorter than a tenth of a second is the top of a move, not a hold.
    if (last && (beat.kind === last.kind || (beat.kind === 'hold' && beat.to - beat.from < 0.1))) last.to = beat.to;
    else if (last && last.kind === 'hold' && last.to - last.from < 0.1) { last.kind = beat.kind; last.to = beat.to; }
    else merged.push({ ...beat });
  }
  return merged;
}

/**
 * The track as a motion: keys with eases per channel, in rest-relative units
 * (scale as a ratio, translate as a fraction of the element's rest height, y up).
 */
export function motionFrom(track) {
  const { samples, fps } = track;
  if (samples.length < 2) return { duration: 0, tracks: {}, beats: [] };
  const tracks = {};
  const scale = channelKeys(samples, ['sx', 'sy'], EPSILON.scale, fps);
  const translate = channelKeys(samples, ['tx', 'ty'], EPSILON.translate, fps);
  const rotate = track.rotates ? channelKeys(samples, ['rot'], EPSILON.rotate, fps) : null;
  const alpha = channelKeys(samples, ['alpha'], EPSILON.alpha, fps);
  // Values a hair from rest ARE rest (measurement noise), and a clip that ends where it began
  // ends exactly there, so a loop does not pop.
  const settle = (keys, fields, rest, tolerance) => {
    if (!keys) return;
    for (const key of keys) for (const f of fields) if (Math.abs(key[f] - rest) <= tolerance) key[f] = rest;
    const first = keys[0], last = keys[keys.length - 1];
    // Ends that agree are one value: the one nearer rest (the other carries the noise of its frame).
    if (fields.every(f => Math.abs(first[f] - last[f]) <= tolerance * 2.5)) for (const f of fields) first[f] = last[f] = Math.abs(first[f] - rest) <= Math.abs(last[f] - rest) ? first[f] : last[f];
  };
  settle(scale, ['x', 'y'], 1, 0.008); settle(translate, ['x', 'y'], 0, 0.008); settle(rotate, ['value'], 0, 0.6); settle(alpha, ['value'], 1, 0.03);
  if (scale) tracks.scale = scale;
  if (translate) tracks.translate = translate;
  if (rotate) tracks.rotate = rotate;
  if (alpha) tracks.alpha = alpha;
  const motion = { duration: samples[samples.length - 1].time, fps, anchor: track.anchor, confidence: track.confidence, tracks, beats: beatsOf(samples, fps) };
  // How far the keys, played back, are from what was measured (the largest gap on any channel).
  const played = reconstruct(motion);
  let fitError = 0;
  for (let i = 0; i < Math.min(played.length, samples.length); i++) if (samples[i].visible) for (const f of ['sx', 'sy', 'tx', 'ty']) fitError = Math.max(fitError, Math.abs(played[i][f] - samples[i][f]));
  return { ...motion, fitError: round(fitError) };
}

/**
 * A motion that repeats: its period and where each repeat starts (at the calmest instant of
 * the cycle), or null when the samples do not repeat. From the self-similarity of the scale
 * and travel signals.
 */
export function findCycles(track) {
  const { samples, fps } = track;
  const n = samples.length;
  const signal = samples.map(s => [s.sx - 1, s.sy - 1, s.tx, s.ty]);
  const energy = signal.reduce((sum, v) => sum + v.reduce((a, b) => a + b * b, 0), 0);
  if (n < 12 || energy / n < 1e-4) return null;
  const score = lag => { let dot = 0, a = 0, b = 0; for (let i = 0; i + lag < n; i++) for (let c = 0; c < 4; c++) { dot += signal[i][c] * signal[i + lag][c]; a += signal[i][c] ** 2; b += signal[i + lag][c] ** 2; } return dot / Math.max(1e-12, Math.sqrt(a * b)); };
  const first = Math.max(4, Math.round(fps * 0.15)), limit = Math.floor(n / 2);
  const scores = []; for (let lag = first; lag <= limit; lag++) scores[lag] = score(lag);
  // The shortest lag at which the motion lines up with itself (a local maximum that is high)...
  let base = null;
  for (let lag = first; lag <= limit; lag++) if (scores[lag] > 0.8 && scores[lag] >= (scores[lag - 1] ?? -1) && scores[lag] >= (scores[lag + 1] ?? -1)) { base = lag; break; }
  if (base === null) return null;
  // ...and its multiples say what the period is between frames (25 fps cannot hold 12.5 frames).
  let period = base, best = { lag: base, value: scores[base] };
  for (let k = 2; k * base - 1 <= limit; k++) {
    let top = null;
    for (const lag of [k * base - 1, k * base, k * base + 1]) if (lag <= limit && scores[lag] !== undefined && (top === null || scores[lag] > scores[top])) top = lag;
    if (top !== null && scores[top] > 0.85) { period = top / k; best = { lag: top, value: Math.max(best.value, scores[top]) }; }
  }
  best.lag = Math.round(period);
  // Among the calm instants of one period, the one the move starts from (its next sample is
  // the least calm): a cycle then runs from rest, through the move, back to rest.
  const calm = i => (signal[Math.min(i, n - 1)] ?? [0]).reduce((x, y) => x + Math.abs(y), 0);
  let least = Infinity;
  for (let i = 0; i < best.lag; i++) least = Math.min(least, calm(i));
  let phase = 0, onset = -1;
  for (let i = 0; i < best.lag; i++) if (calm(i) <= least + 0.006 && calm(i + 1) > onset + 0.002) { phase = i; onset = calm(i + 1); }
  const starts = [];
  for (let c = 0; Math.round(phase + (c + 1) * period) <= n - 1; c++) starts.push(samples[Math.round(phase + c * period)].time);
  return starts.length > 1 ? { period: round(period / fps), repeats: starts.length, starts, similarity: round(best.value, 2) } : null;
}

/**
 * Play a motion back: the value of every channel at each sample time, from its keys and eases.
 * The inverse of motionFrom, used to say how well the keys reproduce what was measured.
 * @returns {{time:number, sx:number, sy:number, tx:number, ty:number, rot:number, alpha:number}}
 */
export function sampleMotion(motion, time) {
  const at = (keys, field, rest) => {
    if (!keys?.length) return rest;
    let k = 0;
    while (k + 1 < keys.length - 1 && keys[k + 1].time <= time) k++;
    const a = keys[k], b = keys[k + 1] ?? a;
    if (b === a || time <= a.time) return a[field];
    if (time >= b.time) return b[field];
    const u = (time - a.time) / (b.time - a.time);
    return a[field] + (b[field] - a[field]) * (a.curve ? handlesAt(a.curve, clamp(u, 0, 1)) : presetAt(a.ease ?? 'linear', u));
  };
  const { scale, translate, rotate, alpha } = motion.tracks ?? {};
  return { time, sx: at(scale, 'x', 1), sy: at(scale, 'y', 1), tx: at(translate, 'x', 0), ty: at(translate, 'y', 0), rot: at(rotate, 'value', 0), alpha: at(alpha, 'value', 1) };
}

export function reconstruct(motion, fps = motion.fps) {
  const count = Math.round(motion.duration * fps) + 1;
  return Array.from({ length: count }, (_, i) => sampleMotion(motion, round(i / fps, 4)));
}

/** How far two tracks sampled at the same times are apart, per channel, and the frame lag that fits best. */
export function compareTracks(reference, other) {
  const n = Math.min(reference.samples.length, other.samples.length);
  const fields = { scaleX: 'sx', scaleY: 'sy', translateX: 'tx', translateY: 'ty', rotate: 'rot', alpha: 'alpha' };
  const gap = (field, lag) => { let max = 0, sum = 0, count = 0; for (let i = Math.max(0, -lag); i < n - Math.max(0, lag); i++) { const d = Math.abs(reference.samples[i][field] - other.samples[i + lag][field]); max = Math.max(max, d); sum += d * d; count++; } return { max: round(max), rms: round(Math.sqrt(sum / Math.max(1, count))) }; };
  const total = lag => ['sx', 'sy', 'tx', 'ty'].reduce((s, f) => s + gap(f, lag).rms, 0);
  let lag = 0;
  for (let l = -4; l <= 4; l++) if (total(l) < total(lag) - 1e-6) lag = l;
  return { frames: n, lagFrames: lag, channels: Object.fromEntries(Object.entries(fields).map(([name, f]) => [name, gap(f, 0)])),
    ...(lag ? { atBestLag: Object.fromEntries(Object.entries(fields).map(([name, f]) => [name, gap(f, lag)])) } : {}) };
}
