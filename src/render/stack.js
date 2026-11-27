// Sprite stacking: a drawing seen from above, cut into thin horizontal slices and drawn as a pile,
// each slice one pixel above the last. Turned together, the pile reads as a solid object in a
// top-down or three-quarter game (cars, buildings, trees, props), with no 3D model.
//
// A part becomes a band of slices with `stack: [from, to]`: its drawing (seen from above) is the
// cut through the object at every height from `from` to `to`, in rig units. `taper: [bottom, top]`
// scales the cut along the band (1 is as drawn), so a cone, a dome or a tree crown is one part.
// Where bands overlap, parts are layered in drawing order (back to front), as on the flat drawing.
//
// The drawing is vector, so the slices can be as thin as the output pixel: one slice per pixel of
// height at every export scale, which gives a smooth wall instead of the stepped look of a
// hand-painted stack. Slices near the ground are shaded a little darker (contact shade), so the
// shading is in the pixels an engine stacks.
//
// Pure: returns images; the caller encodes and writes them. Uses the studio's own rasterizer.

import { rasterizeSvg } from '../engine/svg.js';
import { safeTree } from './svg-safe.js';
import { treeToSvg } from './compose-svg.js';
import { createCanvas, prepareTexture, drawTriangles, toImage } from './raster.js';
import { StudioError } from '../shared/errors.js';

const r2 = v => Math.round(v * 100) / 100;
export const MAX_SLICES = 512;

/** The band of a part, or null when the part is flat (not stacked). */
export function bandOf(part) {
  const s = part?.stack;
  if (!Array.isArray(s) || s.length !== 2 || !s.every(Number.isFinite) || !(s[1] > s[0]) || s[0] < 0) return null;
  const t = Array.isArray(part.taper) && part.taper.length === 2 && part.taper.every(v => Number.isFinite(v) && v >= 0) ? part.taper : [1, 1];
  return { from: s[0], to: s[1], taper: t };
}

/** Problems with a part's stack and taper fields, for the drawing's validation. */
export function stackProblems(part, where) {
  const out = [];
  if (part.stack !== undefined && !bandOf({ stack: part.stack })) out.push(`${where}.stack is [from, to] in rig units, 0 <= from < to.`);
  if (part.taper !== undefined) {
    if (part.stack === undefined) out.push(`${where}.taper needs stack.`);
    else if (!(Array.isArray(part.taper) && part.taper.length === 2 && part.taper.every(v => Number.isFinite(v) && v >= 0 && v <= 4))) out.push(`${where}.taper is [bottom, top], each 0 to 4.`);
  }
  return out;
}

/**
 * Cut a drawing into slices.
 * @param {{ name: string, parts: any[] }} doc  the parts document; only parts with `stack` are cut
 * @param {{ scale?: number, shade?: number }} [options]  scale: pixels per rig unit (one slice per
 *   pixel of height); shade: how much darker the ground slice is (0-1, default 0.2)
 * @returns {{ slices: Array<{ width: number, height: number, data: Uint8Array }>, size: number[], pivot: number[], height: number, scale: number }}
 *   pivot: the drawing's origin (0, 0) in slice pixels, y down; height: the stack's height in units
 */
export function stackSlices(doc, { scale = 2, shade = 0.2 } = {}) {
  const parts = doc.parts.filter(p => bandOf(p) && !p.hidden);
  if (!parts.length) throw new StudioError('bad-argument', `${doc.name} has no stacked part: give parts a height band, stack: [from, to].`, {});
  // The footprint: every stacked part at its widest along its band.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, top = 0;
  for (const p of parts) {
    const b = bandOf(p), k = Math.max(b.taper[0], b.taper[1]);
    x0 = Math.min(x0, p.at[0] - p.size[0] * k / 2); x1 = Math.max(x1, p.at[0] + p.size[0] * k / 2);
    y0 = Math.min(y0, p.at[1] - p.size[1] * k / 2); y1 = Math.max(y1, p.at[1] + p.size[1] * k / 2);
    top = Math.max(top, b.to);
  }
  x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
  const width = Math.max(1, Math.ceil((x1 - x0) * scale)), height = Math.max(1, Math.ceil((y1 - y0) * scale));
  const count = Math.ceil(top * scale - 1e-6);
  if (count > MAX_SLICES) throw new StudioError('bad-argument', `The stack would be ${count} slices: lower the scale or the height (at most ${MAX_SLICES}).`, { count });
  if (width > 2048 || height > 2048) throw new StudioError('bad-argument', 'A slice would be over 2048 px: lower the scale.', { width, height });
  const trees = new Map(parts.map(p => [p.name, safeTree(p.svg, p.name)]));
  const cache = new Map();
  const slices = [];
  for (let i = 0; i < count; i++) {
    const z = (i + 0.5) / scale;
    const cut = [];
    for (const p of parts) {
      const b = bandOf(p);
      if (z < b.from || z >= b.to) continue;
      const t = (z - b.from) / (b.to - b.from);
      cut.push({ p, k: Math.round((b.taper[0] + (b.taper[1] - b.taper[0]) * t) * 100) / 100 });
    }
    const key = cut.map(c => `${c.p.name}*${c.k}`).join('|');
    if (!cache.has(key)) {
      const body = cut.filter(c => c.k > 0).map(({ p, k }) => {
        const tree = trees.get(p.name), [vx, vy, vw, vh] = tree.viewBox;
        const w = p.size[0] * k, h = p.size[1] * k;
        const cx = p.at[0] - x0, cy = y1 - p.at[1];
        return `<g transform="translate(${r2(cx - w / 2)} ${r2(cy - h / 2)}) scale(${w / vw} ${h / vh}) translate(${-vx} ${-vy})">${treeToSvg(tree.children)}</g>`;
      }).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(x1 - x0)} ${r2(y1 - y0)}" width="${width}" height="${height}">${body}</svg>`;
      cache.set(key, body ? rasterizeSvg(svg, { width, height }) : { width, height, data: new Uint8Array(width * height * 4) });
    }
    const image = cache.get(key);
    // Contact shade: darker near the ground, fading out over the first ten units.
    const dim = 1 - shade * Math.max(0, 1 - z / Math.min(10, top));
    if (dim < 0.999) {
      const data = new Uint8Array(image.data);
      for (let j = 0; j < data.length; j += 4) { data[j] = Math.round(data[j] * dim); data[j + 1] = Math.round(data[j + 1] * dim); data[j + 2] = Math.round(data[j + 2] * dim); }
      slices.push({ width, height, data });
    } else slices.push(image);
  }
  return { slices, size: [width, height], pivot: [r2(-x0 * scale), r2(y1 * scale)], height: top, scale };
}

/**
 * The stack drawn turned by `angle` (radians, clockwise on screen; 0 is as drawn), each slice
 * `spacing` pixels above the last. The frame is square in width, tall enough for the stack.
 * @param {ReturnType<typeof stackSlices>} stack
 * @param {{ angle?: number, spacing?: number, frame?: number[] }} [options]  frame: [w, h] to draw
 *   into (default: just big enough for any angle)
 * @returns {{ image: { width: number, height: number, data: Uint8Array }, origin: number[] }}
 *   origin: where the drawing's origin on the ground lands, in pixels, y down
 */
export function drawStack(stack, { angle = 0, spacing = 1, frame } = {}) {
  const [w, h] = stack.size, [px, py] = stack.pivot;
  const reach = Math.ceil(Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - px, y - py)))) + 2;
  const lift = Math.ceil(stack.slices.length * spacing);
  const [W, H] = frame ?? [reach * 2, reach * 2 + lift];
  const origin = [W / 2, H - reach];
  const ss = 2;
  const canvas = createCanvas(W * ss, H * ss);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const corner = (x, y, dy) => [(origin[0] + (x - px) * cos - (y - py) * sin) * ss, (origin[1] - dy + (x - px) * sin + (y - py) * cos) * ss];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1], indices = [0, 1, 2, 0, 2, 3];
  const textures = new Map();
  stack.slices.forEach((s, i) => {
    if (!textures.has(s)) textures.set(s, prepareTexture(s, false));
    const dy = i * spacing;
    const positions = [...corner(0, 0, dy), ...corner(w, 0, dy), ...corner(w, h, dy), ...corner(0, h, dy)];
    drawTriangles(canvas, { positions, uvs, indices, texture: textures.get(s), light: { r: 1, g: 1, b: 1, a: 1 } });
  });
  return { image: toImage(canvas, ss), origin };
}

/** `count` turns of the stack, all in frames of one size with the ground origin at the same pixel. */
export function turnFrames(stack, count = 16, spacing = 1) {
  const first = drawStack(stack, { angle: 0, spacing });
  const frame = [first.image.width, first.image.height];
  const frames = [first];
  for (let i = 1; i < count; i++) frames.push(drawStack(stack, { angle: (i / count) * Math.PI * 2, spacing, frame }));
  return { frames, frame, origin: first.origin, degrees: frames.map((_, i) => r2((i / count) * 360)) };
}
