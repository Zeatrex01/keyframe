// Body forms for the bare side-view figure (src/art/figure-side.js with `bare: true`) and the wardrobe
// worn over it (src/art/figure-wardrobe.js): each limb and the torso is a profile, a front and a back
// half-width at stations down its length, so a thigh narrows to the knee, a calf bulges at the back,
// a forearm is wider at the elbow than at the wrist and the torso has a chest, a waist and a seat.
// A worn piece is the same profile grown by its thickness, so it fits by construction.
//
// Shading follows one light from the upper front: a hard-edged shadow down the back of each form
// and a light down the front, hue-shifted (skin warmer, metal cooler), never one global gradient.
// Pure: paths and shapes only.

import { darken, lighten, mix } from './style.js';

const r2 = v => Math.round(v * 100) / 100;

/** [t, front, back]: t from the joint (0) to the end (1), half-widths in units of the joint width. */
export const PROFILES = Object.freeze({
  thigh: [[0, 0.54, 0.5], [0.3, 0.56, 0.46], [0.72, 0.44, 0.4], [1, 0.38, 0.36]],
  shin: [[0, 0.42, 0.42], [0.24, 0.38, 0.58], [0.55, 0.32, 0.42], [0.88, 0.25, 0.25], [1, 0.26, 0.26]],
  upperArm: [[0, 0.55, 0.55], [0.3, 0.5, 0.52], [0.75, 0.4, 0.4], [1, 0.38, 0.37]],
  forearm: [[0, 0.43, 0.45], [0.24, 0.48, 0.46], [0.85, 0.31, 0.3], [1, 0.31, 0.31]],
  // The torso, top (shoulders) to bottom (hips): rib cage tipped back, a waist, the pelvis.
  torso: [[0, 0.3, 0.44], [0.2, 0.44, 0.5], [0.42, 0.47, 0.46], [0.66, 0.4, 0.37], [0.86, 0.45, 0.47], [1, 0.44, 0.44]],
});

/** The width ratio, widest to narrowest, of a profile: the taper the eye reads as a shaped limb. */
export const taper = name => { const ws = PROFILES[name].map(([, f, b]) => f + b); return Math.max(...ws) / Math.min(...ws); };

const at = (prof, t) => {
  for (let i = 1; i < prof.length; i++) {
    const [t0, f0, b0] = prof[i - 1], [t1, f1, b1] = prof[i];
    if (t <= t1) { const u = (t - t0) / (t1 - t0 || 1); return [f0 + (f1 - f0) * u, b0 + (b1 - b0) * u]; }
  }
  const [, f, b] = prof[prof.length - 1];
  return [f, b];
};

const pt = ([x, y]) => `${r2(x)} ${r2(y)}`;
/** Catmull-Rom through the points, as cubic segments (no move): smooth, through every point. */
function through(pts, closed) {
  const n = pts.length, get = i => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = '';
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    d += ` C${pt([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${pt([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${pt(p2)}`;
  }
  return d;
}
const closed = pts => `M${pt(pts[0])}${through(pts, true)} Z`;
/** Two smooth edges joined straight at their ends (a band inside a form). */
const strip = (a, b) => `M${pt(a[0])}${through(a, false)} L${pt(b[0])}${through(b, false)} Z`;

/**
 * A form: a profile `len` long, `w` wide at its joint, grown by `grow` all round, from `from` (0-1) down.
 * Its box is y down with the joint at (cx, top); `edge(t, side, inset)` is a point on its outline.
 */
export function form(name, len, w, grow = 0, from = 0) {
  const prof = PROFILES[name];
  const F = t => at(prof, t)[0] * w + grow, B = t => at(prof, t)[1] * w + grow;
  const ts = [from, ...prof.map(s => s[0]).filter(t => t > from + 1e-6)];
  const cx = Math.max(...ts.map(B)), maxF = Math.max(...ts.map(F));
  const r0 = (F(from) + B(from)) / 2, r1 = (F(1) + B(1)) / 2, top = r0;
  const y = t => top + (t - from) * len;
  const W = cx + maxF, H = y(1) + r1;
  const x0 = cx + (F(from) - B(from)) / 2, x1 = cx + (F(1) - B(1)) / 2;
  const cap = (xc, yc, r, from, to) => [0.25, 0.5, 0.75].map(u => { const a = from + (to - from) * u; return [xc + r * Math.cos(a), yc + r * Math.sin(a)]; });
  const outline = [
    ...ts.map(t => [cx + F(t), y(t)]), ...cap(x1, y(1), r1, 0, Math.PI),
    ...ts.slice().reverse().map(t => [cx - B(t), y(t)]), ...cap(x0, y(from), r0, Math.PI, 2 * Math.PI),
  ];
  const sample = (t0, t1, n = 6) => Array.from({ length: n + 1 }, (_, i) => t0 + (t1 - t0) * i / n);
  /** A point on the front (+1) or back (-1) edge at t, `inset` (0-1) of the local width inward. */
  const edge = (t, side, inset = 0) => {
    const f = F(t), b = B(t), x = side > 0 ? cx + f - (f + b) * inset : cx - b + (f + b) * inset;
    return [x, y(t)];
  };
  return {
    W, H, cx, top, len, from, path: closed(outline), edge,
    /** A band down one side from t0 to t1, `depth` (0-1) of the width deep, `start` in from the edge. */
    side: (side, t0, t1, depth, start = 0) => strip(sample(t0, t1).map(t => edge(t, side, start)), sample(t1, t0).map(t => edge(t, side, start + depth))),
    /** The form from t0 down, round end and all (a waistband, a boot's foot end). */
    tail: t0 => closed([...sample(t0, 1, 4).map(t => edge(t, 1)), ...cap(x1, y(1), r1, 0, Math.PI), ...sample(1, t0, 4).map(t => edge(t, -1))]),
    /** A band right across the form from t0 to t1, `inset` in from both edges. */
    across: (t0, t1, inset = 0) => strip(sample(t0, t1, 3).map(t => edge(t, 1, inset)), sample(t1, t0, 3).map(t => edge(t, -1, inset))),
  };
}

/**
 * A form as a part on its parent bone, its pivot at the joint; `shapes(f)` draws inside it.
 * @param {string} name @param {string} parent @param {any[]} limb @param {number} grow @param {(f: any) => any[]} shapes
 */
export function formPart(name, parent, limb, grow, shapes) {
  const [joint, len, w, , prof, from = 0] = limb;
  const f = form(prof, len, w, grow, from), jy = joint[1] - len * from;
  return { name, parent, box: [r2(f.W), r2(f.H)], offset: [r2(joint[0] + f.W / 2 - f.cx), r2(jy + f.top - f.H / 2)], pivot: [r2(f.cx - f.W / 2), r2(f.H / 2 - f.top)], shapes: shapes(f) };
}

/** Shadow colours shift hue: skin and leather warmer, metal cooler, cloth a little cool. */
export const shadowOf = (c, mat) => mat === 'metal' ? mix(darken(c, 0.24), '#24365e', 0.2)
  : mat === 'skin' ? mix(darken(c, 0.09), '#9c3c40', 0.08) : mix(darken(c, 0.2), '#2e2950', 0.1);

/**
 * The fill of a form, lit from the upper front: base, a cel shadow down the back, a light down the
 * front; metal adds a sharp specular band and a dark underside.
 */
export function shade(f, fill, mat = 'cloth') {
  const box = { bbox: [0, 0, f.W, f.H] }, flat = { stroke: false, shade: false };
  /** @type {any[]} */
  const s = [{ path: f.path, fill, sw: 'regular', shade: false, ...box },
    { path: f.side(-1, f.from, 1, mat === 'metal' ? 0.36 : mat === 'skin' ? 0.3 : 0.4), fill: shadowOf(fill, mat), ...flat }];
  if (mat === 'metal') {
    s.push({ path: f.side(1, f.from + 0.04, 0.9, 0.26), fill: lighten(fill, 0.22), ...flat },
      { path: f.side(1, f.from + 0.08, 0.78, 0.07, 0.14), fill: lighten(fill, 0.7), ...flat },
      { path: f.side(-1, f.from + 0.06, 0.94, 0.05), fill: lighten(fill, 0.18), opacity: 0.8, ...flat });   // rim off the back edge
  } else {
    s.push({ path: f.side(1, f.from + 0.06, 0.8, 0.16), fill: lighten(fill, mat === 'skin' ? 0.06 : 0.12), ...flat });
  }
  return s;
}

/**
 * A plate's lame edge across a form at t: a light rolled lip over a dark band of shadow cast on the
 * plate below, so each lame reads as overlapping the next.
 */
export function lame(f, t, fill, h = 0.05) {
  return [{ path: f.across(t, t + h), fill: shadowOf(fill, 'metal'), stroke: false, shade: false },
    { path: f.across(t - h * 0.55, t), fill: lighten(fill, 0.35), stroke: false, shade: false }];
}

/** Rivets: small light domes with a dark side, at [t, inset-from-front] points. */
export function rivets(f, points, fill, r) {
  return points.flatMap(([t, inset]) => { const [x, y] = f.edge(t, 1, inset); return [
    { circle: [r2(x), r2(y), r2(r)], fill: shadowOf(fill, 'metal'), stroke: false, shade: false },
    { circle: [r2(x - r * 0.25), r2(y - r * 0.25), r2(r * 0.6)], fill: lighten(fill, 0.6), stroke: false, shade: false }]; });
}

/** A bare foot or a shoe pointing forward in a fw x fh box: heel, instep, toe box, and an arch under the sole. */
export function footPath(fw, fh) {
  const p = (x, y) => `${r2(x * fw)} ${r2(y * fh)}`;
  return `M${p(0.04, 0.42)} Q${p(0.04, 0.02)} ${p(0.28, 0.02)} L${p(0.46, 0.04)} Q${p(0.62, 0.3)} ${p(0.84, 0.38)} Q${p(1, 0.46)} ${p(0.99, 0.78)} Q${p(0.99, 0.98)} ${p(0.86, 0.98)} L${p(0.66, 0.98)} Q${p(0.52, 0.88)} ${p(0.4, 0.98)} L${p(0.14, 0.98)} Q${p(0.04, 0.98)} ${p(0.04, 0.72)} Z`;
}

/** The sole under a foot path, a darker band that lifts at the arch. */
export function solePath(fw, fh) {
  const p = (x, y) => `${r2(x * fw)} ${r2(y * fh)}`;
  return `M${p(0.05, 0.8)} L${p(0.4, 0.84)} Q${p(0.52, 0.76)} ${p(0.66, 0.84)} L${p(0.985, 0.8)} Q${p(0.99, 0.98)} ${p(0.86, 0.98)} L${p(0.66, 0.98)} Q${p(0.52, 0.88)} ${p(0.4, 0.98)} L${p(0.14, 0.98)} Q${p(0.05, 0.98)} ${p(0.05, 0.8)} Z`;
}

/** A closed fist in a d x d box, knuckles to the front, the thumb across the top. */
export function fistShapes(d, fill) {
  const p = (x, y) => `${r2(x * d)} ${r2(y * d)}`, flat = { stroke: false, shade: false };
  return [
    { path: `M${p(0.3, 0.2)} L${p(0.84, 0.18)} Q${p(1.08, 0.2)} ${p(1.08, 0.5)} L${p(1.06, 0.86)} Q${p(1.04, 1.1)} ${p(0.78, 1.1)} L${p(0.34, 1.1)} Q${p(0.12, 1.08)} ${p(0.12, 0.8)} L${p(0.12, 0.44)} Q${p(0.12, 0.2)} ${p(0.3, 0.2)} Z`, fill, sw: 'regular', shade: false, bbox: [0, 0, d * 1.2, d * 1.2] },
    { path: `M${p(0.14, 0.7)} Q${p(0.5, 0.86)} ${p(1.06, 0.74)} L${p(1.05, 0.88)} Q${p(1.02, 1.08)} ${p(0.78, 1.08)} L${p(0.34, 1.08)} Q${p(0.15, 1.06)} ${p(0.14, 0.86)} Z`, fill: shadowOf(fill, 'skin'), ...flat },
    { path: `M${p(0.82, 0.56)} L${p(1.04, 0.56)}`, fill: 'none', stroke: shadowOf(fill, 'skin'), sw: 'thin' },
    { path: `M${p(0.8, 0.8)} L${p(1.03, 0.8)}`, fill: 'none', stroke: shadowOf(fill, 'skin'), sw: 'thin' },
    { path: `M${p(0.42, 0.44)} Q${p(0.62, 0.22)} ${p(0.98, 0.3)} Q${p(1.06, 0.42)} ${p(0.92, 0.5)} Q${p(0.7, 0.54)} ${p(0.42, 0.44)} Z`, fill: lighten(fill, 0.08), sw: 'thin', shade: false },
  ];
}
