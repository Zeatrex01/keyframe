// Low-poly models from drawn views: the look of early 3D games, where a very simple mesh carries a
// painted texture that holds all the detail (docs/low-poly-models.md).
//
// A drawing names its parts after the sides of the object, each drawn flat as seen from that side:
//
//   front   facing the object's nose (+Z); its left side (+X) is on your right
//   back    facing its tail (-Z)
//   left    standing at its left side (+X); the nose points to your left
//   right   standing at its right side (-X); the nose points to your right
//   top     from above, the nose up, its right side on your right
//   bottom  from below, the nose up, its left side on your right
//
// Only front (or back), one side and top (or bottom) are needed: a missing back, side or bottom is
// the opposite one mirrored (the bottom darkened). Each view is stretched over the object's box:
// width from the front, length from the side, height from both.
//
// Three shapes, all a few hundred triangles at most:
//
//   box    six quads, one view on each (a crate, a cabinet, a building block)
//   round  turned around the up axis, `sides` faces round, its outline from the front and the side
//          views (a barrel, a lamp post, a bottle, a tree trunk)
//   hull   lofted along the length: cross-sections at the stations where the side and top
//          outlines change, each cut to the front outline (a car, a boat, a body, a sofa)
//
// Every triangle takes the view it faces most (box projection), so a side wall shows the side
// drawing and the roof the top drawing. Pure: returns the mesh, the texture atlas and the bytes of
// a binary glTF (.glb) that Godot, Blender, Unity and three.js import as they are.

import { rasterizeSvg } from '../engine/svg.js';
import { StudioError } from '../shared/errors.js';

export const VIEWS = Object.freeze(['front', 'back', 'left', 'right', 'top', 'bottom']);
export const SHAPES = Object.freeze(['box', 'round', 'hull']);
const OPPOSITE = { front: 'back', back: 'front', left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const r4 = v => Math.round(v * 1e4) / 1e4;

/**
 * The model settings with their defaults; throws on a bad value.
 * @param {any} [o]
 */
export function modelOptions(o = {}) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new StudioError('bad-argument', 'model is an object: { shape, texture, filter, meters, sides, levels, segments, smooth, lit }.', {});
  const known = ['shape', 'texture', 'filter', 'meters', 'sides', 'levels', 'segments', 'smooth', 'lit'];
  for (const k of Object.keys(o)) if (!known.includes(k)) throw new StudioError('bad-argument', `model.${k} is not a model setting (${known.join(', ')}).`, { key: k });
  const num = (k, d, lo, hi, int = false) => {
    const v = o[k] ?? d;
    if (!Number.isFinite(v) || v < lo || v > hi || (int && !Number.isInteger(v))) throw new StudioError('bad-argument', `model.${k} is ${int ? 'a whole number ' : ''}from ${lo} to ${hi}.`, { key: k, value: v });
    return v;
  };
  const shape = o.shape ?? 'hull';
  if (!SHAPES.includes(shape)) throw new StudioError('bad-argument', `model.shape is ${SHAPES.join(', ')}.`, { shape });
  const filter = o.filter ?? 'nearest';
  if (!['nearest', 'linear'].includes(filter)) throw new StudioError('bad-argument', 'model.filter is nearest (crisp texels) or linear (smooth).', { filter });
  if (o.lit !== undefined && typeof o.lit !== 'boolean') throw new StudioError('bad-argument', 'model.lit is true (the engine lights it) or false (the painted light is all there is).', {});
  return {
    shape, filter, lit: o.lit ?? true,
    texture: num('texture', 128, 16, 1024, true), meters: num('meters', 0.01, 0.0001, 100),
    sides: num('sides', 8, 3, 32, true), levels: num('levels', 4, 2, 8, true),
    segments: num('segments', 12, 1, 64, true), smooth: num('smooth', 40, 0, 90),
  };
}

// ------------------------------------------------------------------ views

/**
 * A view's texture coordinates (0..1, v down) for a point of the model box (origin bottom centre).
 * @param {string} view @param {number[]} p @param {number[]} box
 */
export function viewUV(view, [x, y, z], [W, H, L]) {
  switch (view) {
    case 'front': return [(x + W / 2) / W, (H - y) / H];
    case 'back': return [(W / 2 - x) / W, (H - y) / H];
    case 'left': return [(L / 2 - z) / L, (H - y) / H];
    case 'right': return [(z + L / 2) / L, (H - y) / H];
    case 'top': return [(W / 2 - x) / W, (L / 2 - z) / L];
    default: return [(x + W / 2) / W, (L / 2 - z) / L];
  }
}

/**
 * The view a face shows: the side its normal points to most.
 * @param {number[]} n
 */
export function viewOf([nx, ny, nz]) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) return ny >= 0 ? 'top' : 'bottom';
  if (az >= ax) return nz >= 0 ? 'front' : 'back';
  return nx >= 0 ? 'left' : 'right';
}

const mirror = img => {
  const out = new Uint8Array(img.data.length), w = img.width;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < w; x++) out.set(img.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + (w - 1 - x)) * 4);
  return { width: w, height: img.height, data: out };
};
const darken = (img, k) => {
  const out = new Uint8Array(img.data);
  for (let i = 0; i < out.length; i += 4) { out[i] = Math.round(out[i] * k); out[i + 1] = Math.round(out[i + 1] * k); out[i + 2] = Math.round(out[i + 2] * k); }
  return { ...img, data: out };
};

/** The drawn views of a drawing, which ones are mirrored, and the model box [W, H, L] in rig units. */
export function readViews(doc) {
  const byName = new Map(doc.parts.filter(p => VIEWS.includes(p.name)).map(p => [p.name, p]));
  const need = [['front', 'back'], ['left', 'right'], ['top', 'bottom']];
  for (const pair of need) if (!pair.some(v => byName.has(v))) throw new StudioError('bad-argument', `A model needs a part named ${pair[0]} (or ${pair[1]}): draw the object flat as seen from each side, parts named ${VIEWS.join(', ')}.`, { missing: pair });
  const front = byName.get('front') ?? byName.get('back'), side = byName.get('left') ?? byName.get('right'), top = byName.get('top') ?? byName.get('bottom');
  const W = front.size[0], H = Math.max(front.size[1], side.size[1]), L = side.size[0];
  const notes = [];
  const off = (a, b) => Math.abs(a - b) > 0.1 * Math.max(a, b);
  if (off(front.size[1], side.size[1])) notes.push(`front is ${front.size[1]} high and the side ${side.size[1]}: both are stretched to ${H}.`);
  if (off(top.size[0], W) || off(top.size[1], L)) notes.push(`top is ${top.size[0]} x ${top.size[1]}, the box ${W} x ${L}: it is stretched to fit.`);
  /** @type {Record<string, string>} */
  const source = {};
  for (const v of VIEWS) source[v] = byName.has(v) ? 'drawn' : `mirrored ${OPPOSITE[v]}`;
  return { parts: byName, box: [W, H, L], source, notes };
}

/** Each view drawn at `k` px per rig unit over its face of the box, mirrored where it was not drawn. */
function viewImages(views, k) {
  const [W, H, L] = views.box;
  const dims = { front: [W, H], back: [W, H], left: [L, H], right: [L, H], top: [W, L], bottom: [W, L] };
  const out = {};
  for (const v of VIEWS) {
    const [w, h] = dims[v].map(d => Math.max(2, Math.round(d * k)));
    const part = views.parts.get(v);
    if (part) { out[v] = rasterizeSvg(part.svg, { width: w, height: h }); continue; }
    const other = views.parts.get(OPPOSITE[v]);
    const img = mirror(rasterizeSvg(other.svg, { width: w, height: h }));
    out[v] = v === 'bottom' ? darken(img, 0.45) : img;
  }
  return out;
}

/** Opaque-pixel masks of the views, for the outlines (about `res` px on the box's longest side). */
function masks(views, res = 256) {
  const k = res / Math.max(...views.box);
  const imgs = viewImages(views, k);
  return Object.fromEntries(Object.entries(imgs).map(([v, img]) => {
    const m = new Uint8Array(img.width * img.height);
    for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;
    return [v, { width: img.width, height: img.height, m }];
  }));
}

/** First and last opaque index along a row (or a column) of a mask, or null. */
function run(mask, index, column) {
  const n = column ? mask.height : mask.width;
  let a = -1, b = -1;
  for (let i = 0; i < n; i++) {
    const on = column ? mask.m[i * mask.width + index] : mask.m[index * mask.width + i];
    if (on) { if (a < 0) a = i; b = i; }
  }
  return a < 0 ? null : [a, b + 1];
}

/** Keep the samples where a profile changes: endpoints, then the worst-fitting sample, until close or `max`. */
function keyStations(samples, max, tol = 0.012) {
  const n = samples.length;
  if (n <= 2) return samples;
  const keep = new Set([0, n - 1]);
  for (;;) {
    const idx = [...keep].sort((a, b) => a - b);
    let worst = -1, err = tol;
    for (let s = 0; s + 1 < idx.length; s++) {
      const a = samples[idx[s]], b = samples[idx[s + 1]];
      for (let i = idx[s] + 1; i < idx[s + 1]; i++) {
        const t = (samples[i].t - a.t) / (b.t - a.t || 1);
        const e = Math.max(...samples[i].v.map((x, j) => Math.abs(x - (a.v[j] + (b.v[j] - a.v[j]) * t))));
        if (e > err) { err = e; worst = i; }
      }
    }
    if (worst < 0 || keep.size >= max + 1) break;
    keep.add(worst);
  }
  return [...keep].sort((a, b) => a - b).map(i => samples[i]);
}

// ------------------------------------------------------------------ shapes

/**
 * Triangles of a box over the whole model box.
 * @param {number[]} box
 */
function boxTriangles([W, H, L]) {
  const x = W / 2, z = L / 2;
  const quad = (a, b, c, d, hint) => [[a, b, c, hint], [a, c, d, hint]];
  const P = (sx, y, sz) => [sx * x, y, sz * z];
  return [
    ...quad(P(-1, 0, 1), P(1, 0, 1), P(1, H, 1), P(-1, H, 1), [0, 0, 1]),
    ...quad(P(1, 0, -1), P(-1, 0, -1), P(-1, H, -1), P(1, H, -1), [0, 0, -1]),
    ...quad(P(1, 0, 1), P(1, 0, -1), P(1, H, -1), P(1, H, 1), [1, 0, 0]),
    ...quad(P(-1, 0, -1), P(-1, 0, 1), P(-1, H, 1), P(-1, H, -1), [-1, 0, 0]),
    ...quad(P(-1, H, 1), P(1, H, 1), P(1, H, -1), P(-1, H, -1), [0, 1, 0]),
    ...quad(P(-1, 0, -1), P(1, 0, -1), P(1, 0, 1), P(-1, 0, 1), [0, -1, 0]),
  ];
}

/** Triangles of a shape turned around the up axis, its outline from the front and side views. */
function roundTriangles(views, opt) {
  const [W, H, L] = views.box;
  const M = masks(views);
  const front = M.front, side = M.left;
  const samples = [];
  for (let row = 0; row < front.height; row++) {
    const vf = (row + 0.5) / front.height;
    const fr = run(front, row, false), sr = run(side, Math.min(side.height - 1, Math.floor(vf * side.height)), false);
    if (!fr || !sr) continue;
    const xa = fr[0] / front.width * W - W / 2, xb = fr[1] / front.width * W - W / 2;
    const za = L / 2 - sr[1] / side.width * L, zb = L / 2 - sr[0] / side.width * L;
    samples.push({ y: H * (1 - vf), t: 1 - vf, v: [(xa + xb) / 2 / W, (xb - xa) / 2 / W, (za + zb) / 2 / L, (zb - za) / 2 / L], ring: [(xa + xb) / 2, (xb - xa) / 2, (za + zb) / 2, (zb - za) / 2] });
  }
  if (samples.length < 2) throw new StudioError('bad-argument', 'The front and side views have no outline to turn: draw them filled.', {});
  samples.reverse();                                            // bottom first
  samples[0] = { ...samples[0], y: Math.max(0, samples[0].y - H / front.height / 2) };
  const last = samples.length - 1;
  samples[last] = { ...samples[last], y: Math.min(H, samples[last].y + H / front.height / 2) };
  const stations = keyStations(samples, opt.segments);
  const n = opt.sides;
  const rings = stations.map(s => {
    const [cx, rx, cz, rz] = s.ring;
    return Array.from({ length: n }, (_, j) => { const a = (j / n) * Math.PI * 2; return [cx + rx * Math.cos(a), s.y, cz + rz * Math.sin(a)]; });
  });
  const tris = [];
  for (let s = 0; s + 1 < rings.length; s++) {
    const A = rings[s], B = rings[s + 1], c = stations[s].ring;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n, mid = [(A[j][0] + A[k][0]) / 2, 0, (A[j][2] + A[k][2]) / 2];
      const hint = [mid[0] - c[0], 0, mid[2] - c[2]];
      tris.push([A[j], A[k], B[k], hint], [A[j], B[k], B[j], hint]);
    }
  }
  const cap = (ring, y, up) => {
    const c = [ring.reduce((s, p) => s + p[0], 0) / n, y, ring.reduce((s, p) => s + p[2], 0) / n];
    for (let j = 0; j < n; j++) tris.push([c, ring[j], ring[(j + 1) % n], [0, up, 0]]);
  };
  cap(rings[0], stations[0].y, -1);
  cap(rings[rings.length - 1], stations[stations.length - 1].y, 1);
  return tris;
}

/** Triangles of a hull lofted along the length (+Z is the nose). */
function hullTriangles(views, opt) {
  const [W, H, L] = views.box;
  const M = masks(views);
  const side = M.left, top = M.top, front = M.front;
  const frontAt = y => {
    const row = Math.min(front.height - 1, Math.max(0, Math.floor((H - y) / H * front.height)));
    const r = run(front, row, false);
    return r ? [r[0] / front.width * W - W / 2, r[1] / front.width * W - W / 2] : null;
  };
  // The cross-section's levels: heights where the front outline changes most.
  const rows = [];
  for (let row = 0; row < front.height; row++) {
    const r = run(front, row, false);
    if (r) rows.push({ t: 1 - (row + 0.5) / front.height, v: [r[0] / front.width, r[1] / front.width] });
  }
  if (rows.length < 2) throw new StudioError('bad-argument', 'The front view has no outline: draw it filled.', {});
  rows.reverse();
  const levelT = keyStations(rows, opt.levels - 1, 0.02).map(s => s.t);
  const inner = levelT.slice(1, -1).slice(0, opt.levels - 2);
  // Stations along the length, where the side or top outline changes.
  const samples = [];
  for (let col = 0; col < side.width; col++) {
    const u = (col + 0.5) / side.width, z = L / 2 - u * L;
    const sr = run(side, col, true);
    const trow = Math.min(top.height - 1, Math.max(0, Math.floor((L / 2 - z) / L * top.height)));
    const tr = run(top, trow, false);
    if (!sr || !tr) continue;
    const yt = H * (1 - sr[0] / side.height), yb = H * (1 - sr[1] / side.height);
    const xa = W / 2 - tr[1] / top.width * W, xb = W / 2 - tr[0] / top.width * W;
    samples.push({ z, t: -z / L, v: [yb / H, yt / H, xa / W, xb / W], cut: { yb, yt, xa, xb } });
  }
  if (samples.length < 2) throw new StudioError('bad-argument', 'The side and top views do not overlap along the length: draw them filled and over the same length.', {});
  samples.reverse();                                            // tail (-Z) first
  const half = L / side.width / 2;
  samples[0] = { ...samples[0], z: samples[0].z - half };
  samples[samples.length - 1] = { ...samples[samples.length - 1], z: samples[samples.length - 1].z + half };
  const stations = keyStations(samples.map(s => ({ ...s, t: s.z })), opt.segments);
  // Each section: right side bottom to top, then left side top to bottom (counter-clockwise seen from the nose).
  const rings = stations.map(({ z, cut: { yb, yt, xa, xb } }) => {
    const ys = [yb, ...inner.map(t => Math.min(yt, Math.max(yb, t * H))), yt];
    const rng = ys.map(y => {
      const f = frontAt(Math.min(H - 1e-6, Math.max(1e-6, y)));
      let l = f ? Math.max(xa, f[0]) : xa, r = f ? Math.min(xb, f[1]) : xb;
      if (l > r) l = r = (l + r) / 2;
      return [l, r];
    });
    return [...ys.map((y, i) => [rng[i][1], y, z]), ...ys.map((y, i) => [rng[i][0], y, z]).reverse()];
  });
  const tris = [];
  const m = rings[0].length;
  for (let s = 0; s + 1 < rings.length; s++) {
    const A = rings[s], B = rings[s + 1];
    for (let i = 0; i < m; i++) { const j = (i + 1) % m; tris.push([A[i], A[j], B[j]], [A[i], B[j], B[i]]); }
  }
  const K = m / 2;
  const cap = (ring, nose) => {
    for (let k = 0; k + 1 < K; k++) {
      const R0 = ring[k], R1 = ring[k + 1], L1 = ring[m - 2 - k], L0 = ring[m - 1 - k];
      if (nose) tris.push([R0, R1, L1], [R0, L1, L0]); else tris.push([R0, L1, R1], [R0, L0, L1]);
    }
  };
  cap(rings[0], false);
  cap(rings[rings.length - 1], true);
  return tris;
}

// ------------------------------------------------------------------ mesh

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Pack images on shelves, `pad` px apart, each image's edge pixels repeated into its padding. */
function packAtlas(images, pad = 2) {
  const order = Object.keys(images).sort((a, b) => images[b].height - images[a].height);
  const area = order.reduce((s, k) => s + (images[k].width + pad * 2) * (images[k].height + pad * 2), 0);
  let width = 16;
  while (width * width < area * 1.4 || order.some(k => images[k].width + pad * 2 > width)) width *= 2;
  const at = {};
  let x = 0, y = 0, row = 0;
  for (const k of order) {
    const w = images[k].width + pad * 2, h = images[k].height + pad * 2;
    if (x + w > width) { x = 0; y += row; row = 0; }
    at[k] = { x: x + pad, y: y + pad, w: images[k].width, h: images[k].height };
    x += w; row = Math.max(row, h);
  }
  let height = 16;
  while (height < y + row) height *= 2;
  const data = new Uint8Array(width * height * 4);
  for (const k of order) {
    const img = images[k], a = at[k];
    for (let yy = -pad; yy < img.height + pad; yy++) for (let xx = -pad; xx < img.width + pad; xx++) {
      const sx = Math.min(img.width - 1, Math.max(0, xx)), sy = Math.min(img.height - 1, Math.max(0, yy));
      data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), ((a.y + yy) * width + a.x + xx) * 4);
    }
  }
  return { image: { width, height, data }, at };
}

/** Fill every clear pixel with the colour of the nearest painted one and make the image opaque, so no edge samples the background. */
function fillClear(img) {
  const { width: w, height: h } = img, data = new Uint8Array(img.data);
  const done = new Uint8Array(w * h);
  let front = [];
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 0) { done[i] = 1; front.push(i); }
  if (!front.length) { for (let i = 0; i < w * h; i++) { data.set([128, 128, 128, 255], i * 4); } return { width: w, height: h, data }; }
  // Partly clear pixels keep their colour; their alpha goes to full.
  while (front.length) {
    const next = [];
    for (const i of front) {
      const x = i % w, y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (done[j]) continue;
        done[j] = 1; data.set(data.subarray(i * 4, i * 4 + 3), j * 4); next.push(j);
      }
    }
    front = next;
  }
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
  return { width: w, height: h, data };
}

/**
 * Build a model from a drawing's views.
 * @param {{ name: string, parts: any[] }} doc  the parts document (svg-rig.js)
 * @param {object} [options]  model settings (modelOptions)
 * @returns {{ name: string, shape: string, positions: Float32Array, normals: Float32Array, uvs: Float32Array,
 *   indices: Uint16Array | Uint32Array, texture: { width: number, height: number, data: Uint8Array }, box: number[],
 *   size: number[], triangles: number, vertices: number, source: Record<string, string>, notes: string[], faces: Record<string, number>, options: any }}
 */
export function buildModel(doc, options = {}) {
  const opt = modelOptions(options);
  const views = readViews(doc);
  const [W, H, L] = views.box;
  const raw = opt.shape === 'box' ? boxTriangles(views.box) : opt.shape === 'round' ? roundTriangles(views, opt) : hullTriangles(views, opt);
  // Clean the triangles: drop slivers, face them outward (by their hint), find their view.
  const tris = [];
  for (const [a, b, c, hint] of raw) {
    let n = cross(sub(b, a), sub(c, a));
    const area = Math.hypot(...n) / 2;
    if (area < 1e-6 * Math.max(W, H, L) ** 2) continue;
    let p = [a, b, c];
    if (hint && dot(n, hint) < 0) { p = [a, c, b]; n = n.map(v => -v); }
    n = unit(n);
    tris.push({ p, n, view: viewOf(n), area });
  }
  // Texture: the views at one texel density, packed.
  const k = opt.texture / Math.max(W, H, L);
  const images = Object.fromEntries(Object.entries(viewImages(views, k)).map(([v, img]) => [v, fillClear(img)]));
  const atlas = packAtlas(images);
  // Smooth normals across faces that meet at less than `smooth` degrees; a sharper edge stays hard.
  const key = q => q.map(v => Math.round(v * 1e3)).join(',');
  const around = new Map();
  tris.forEach((t, i) => t.p.forEach(q => { const kk = key(q); if (!around.has(kk)) around.set(kk, []); around.get(kk).push(i); }));
  const limit = Math.cos(opt.smooth * Math.PI / 180);
  const verts = new Map(), pos = [], nor = [], uv = [], idx = [];
  /** @type {Record<string, number>} */
  const faces = {};
  for (const t of tris) {
    faces[t.view] = (faces[t.view] ?? 0) + 1;
    const cell = atlas.at[t.view];
    for (const q of t.p) {
      let n = t.n;
      if (opt.smooth > 0) {
        const sum = [0, 0, 0];
        for (const j of around.get(key(q))) { const o = tris[j]; if (dot(o.n, t.n) >= limit) for (let c = 0; c < 3; c++) sum[c] += o.n[c] * o.area; }
        n = unit(sum);
      }
      const [u, v] = viewUV(t.view, q, views.box);
      const U = (cell.x + Math.min(1, Math.max(0, u)) * cell.w) / atlas.image.width, V = (cell.y + Math.min(1, Math.max(0, v)) * cell.h) / atlas.image.height;
      const P = q.map(c => c * opt.meters);
      const id = [...P, ...n, U, V].map(r4).join(',');
      if (!verts.has(id)) { verts.set(id, pos.length / 3); pos.push(...P); nor.push(...n); uv.push(U, V); }
      idx.push(verts.get(id));
    }
  }
  const count = pos.length / 3;
  return {
    name: doc.name, shape: opt.shape,
    positions: new Float32Array(pos), normals: new Float32Array(nor), uvs: new Float32Array(uv),
    indices: count < 65536 ? new Uint16Array(idx) : new Uint32Array(idx),
    texture: atlas.image, box: views.box, size: views.box.map(v => r4(v * opt.meters)),
    triangles: tris.length, vertices: count, source: views.source, notes: views.notes, faces, options: opt,
  };
}

// ------------------------------------------------------------------ glTF

/**
 * A model as a binary glTF 2.0 file (.glb) with its texture inside.
 * @param {ReturnType<typeof buildModel>} model
 * @param {Uint8Array} png  the texture atlas encoded as PNG
 */
export function encodeGlb(model, png) {
  const chunks = [];
  let length = 0;
  const view = (bytes, target) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); length += pad; }
    const b = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entry = { buffer: 0, byteOffset: length, byteLength: b.byteLength, ...(target ? { target } : {}) };
    chunks.push(b); length += b.byteLength;
    return entry;
  };
  const bounds = arr => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], arr[i + c]); max[c] = Math.max(max[c], arr[i + c]); }
    return { min, max };
  };
  const bufferViews = [view(model.positions, 34962), view(model.normals, 34962), view(model.uvs, 34962), view(model.indices, 34963), view(png)];
  const n = model.vertices;
  const nearest = model.options.filter === 'nearest';
  const gltf = {
    asset: { version: '2.0', generator: 'Keyframe Studio' },
    scene: 0, scenes: [{ name: model.name, nodes: [0] }],
    nodes: [{ name: model.name, mesh: 0 }],
    meshes: [{ name: model.name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [{
      name: `${model.name}_paint`,
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
      ...(model.options.lit ? {} : { extensions: { KHR_materials_unlit: {} } }),
    }],
    ...(model.options.lit ? {} : { extensionsUsed: ['KHR_materials_unlit'] }),
    textures: [{ sampler: 0, source: 0 }],
    images: [{ name: `${model.name}_texture`, mimeType: 'image/png', bufferView: 4 }],
    samplers: [{ magFilter: nearest ? 9728 : 9729, minFilter: nearest ? 9984 : 9987, wrapS: 33071, wrapT: 33071 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', ...bounds(model.positions) },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: n, type: 'VEC2' },
      { bufferView: 3, componentType: model.indices instanceof Uint16Array ? 5123 : 5125, count: model.indices.length, type: 'SCALAR' },
    ],
    bufferViews,
    buffers: [{ byteLength: 0 }],
  };
  const binPad = (4 - (length % 4)) % 4;
  if (binPad) { chunks.push(new Uint8Array(binPad)); length += binPad; }
  gltf.buffers[0].byteLength = length;
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) { const j = new Uint8Array(json.length + jsonPad).fill(0x20); j.set(json); json = j; }
  const total = 12 + 8 + json.length + 8 + length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, json.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
  let o = 20 + json.length;
  dv.setUint32(o, length, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/** Read a .glb back: its JSON and binary chunk (for checks). */
export function readGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new StudioError('bad-argument', 'Not a glTF 2.0 binary.', {});
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl)));
  const bl = dv.getUint32(20 + jl, true);
  return { json, bin: bytes.subarray(28 + jl, 28 + jl + bl) };
}

// ------------------------------------------------------------------ preview

/**
 * The model seen turned by `yaw` (degrees, 0 = nose towards the viewer's right) and tilted down
 * `pitch` degrees, orthographic, lit from the upper left; a small depth-buffered rasterizer.
 */
export function renderModel(model, { yaw = 35, pitch = 22, size = 256, background = [244, 241, 234] } = {}) {
  const { positions: P, normals: N, uvs: T, indices: I, texture } = model;
  const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // Turn around the up axis so the nose (+Z) points right at yaw 0, then tilt towards the viewer.
  const rot = ([x, y, z]) => { const x1 = z * ca + x * sa, z1 = z * sa - x * ca; return [x1, y * cb - z1 * sb, y * sb + z1 * cb]; };
  const pts = [], nrm = [];
  for (let i = 0; i < P.length; i += 3) { pts.push(rot([P[i], P[i + 1], P[i + 2]])); nrm.push(rot([N[i], N[i + 1], N[i + 2]])); }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const scale = size * 0.86 / Math.max(x1 - x0, y1 - y0, 1e-6);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const scr = pts.map(([x, y, z]) => [size / 2 + (x - cx) * scale, size / 2 - (y - cy) * scale, z]);
  const light = unit([-0.5, 0.8, 0.6]);
  const color = new Float32Array(size * size * 3), depth = new Float32Array(size * size).fill(-Infinity);
  for (let i = 0; i < size * size; i++) color.set(background.map(c => c / 255), i * 3);
  const tex = (u, v, out) => {
    const nearest = model.options.filter === 'nearest';
    const fx = u * texture.width - (nearest ? 0 : 0.5), fy = v * texture.height - (nearest ? 0 : 0.5);
    const px = Math.min(texture.width - 1, Math.max(0, Math.floor(fx))), py = Math.min(texture.height - 1, Math.max(0, Math.floor(fy)));
    const j = (py * texture.width + px) * 4;
    out[0] = texture.data[j] / 255; out[1] = texture.data[j + 1] / 255; out[2] = texture.data[j + 2] / 255;
  };
  const texel = [0, 0, 0];
  for (let t = 0; t < I.length; t += 3) {
    const [i0, i1, i2] = [I[t], I[t + 1], I[t + 2]];
    const [ax, ay, az] = scr[i0], [bx, by, bz] = scr[i1], [qx, qy, qz] = scr[i2];
    const area = (bx - ax) * (qy - ay) - (qx - ax) * (by - ay);
    if (area >= 0) continue;                                      // facing away (screen y is down)
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, qx))), maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, qx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, qy))), maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, qy)));
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const sx = px + 0.5, sy = py + 0.5;
      const w0 = ((bx - sx) * (qy - sy) - (qx - sx) * (by - sy)) / area;
      const w1 = ((qx - sx) * (ay - sy) - (ax - sx) * (qy - sy)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = az * w0 + bz * w1 + qz * w2, o = py * size + px;
      if (z <= depth[o]) continue;
      depth[o] = z;
      tex(T[i0 * 2] * w0 + T[i1 * 2] * w1 + T[i2 * 2] * w2, T[i0 * 2 + 1] * w0 + T[i1 * 2 + 1] * w1 + T[i2 * 2 + 1] * w2, texel);
      const n = unit([0, 1, 2].map(c => nrm[i0][c] * w0 + nrm[i1][c] * w1 + nrm[i2][c] * w2));
      const k = model.options.lit ? 0.62 + 0.45 * Math.max(0, dot(n, light)) : 1;
      for (let c = 0; c < 3; c++) color[o * 3 + c] = Math.min(1, texel[c] * k);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(color[i * 3 + c] * 255); data[i * 4 + 3] = 255; }
  return { width: size, height: size, data };
}

/** Several turns of the model side by side, one image to look at. */
export function previewSheet(model, { yaws = [35, 125, 215, 305], pitch = 22, size = 256 } = {}) {
  const frames = yaws.map(yaw => renderModel(model, { yaw, pitch, size }));
  const width = size * frames.length, data = new Uint8Array(width * size * 4);
  frames.forEach((f, i) => { for (let y = 0; y < size; y++) data.set(f.data.subarray(y * size * 4, (y + 1) * size * 4), (y * width + i * size) * 4); });
  return { width, height: size, data };
}
