// A drawing made usable outside the studio, for game engines, web pages and design tools:
//
//   png@<s>x/<part>.png        each part (and each state) at scale s, transparent, trimmed to its
//                              pixels; parts.json keeps where each sits and where it turns
//   <name>@<s>x.png + .json    one sprite sheet per scale with a frame map (the common "JSON hash"
//                              sprite-sheet layout game engines and web libraries read)
//   svg/<part>.svg, <name>.svg clean SVG: each part, and the whole drawing with a <g id> per part
//   stack@<s>x.png + .json     a sprite stack: the slices of the parts with a height band, bottom
//                              first, and turn@<s>x.png + .json, the stack pre-turned to N angles
//   clip-<anim>/               an animation as a PNG sequence and a sheet with its frame times,
//                              for engines without a skeletal runtime
//
// Pure: returns the files as { path: bytes | text }; the tool writes them. Rasterised with the
// studio's own renderer, no browser and no dependency.

import { rasterizeSvg } from '../engine/svg.js';
import { encodePng } from './png.js';
import { partSvg, drawingSvg } from './compose-svg.js';
import { renderFrames } from './frames.js';
import { StudioError } from '../shared/errors.js';
import { clipLoops, loopAnswer } from '../engine/loops.js';
import { stackSlices, turnFrames } from './stack.js';

const r2 = v => Math.round(v * 100) / 100;
export const EXPORT_KINDS = Object.freeze(['parts', 'sheet', 'svg', 'stack', 'clip']);

/** The box of the pixels that are not fully transparent, or null for an empty image. */
export function alphaBounds(img) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[(y * img.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** A part of an image. */
export function crop(img, box) {
  const data = new Uint8Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) data.set(img.data.subarray(((box.y + y) * img.width + box.x) * 4, ((box.y + y) * img.width + box.x + box.width) * 4), y * box.width * 4);
  return { width: box.width, height: box.height, data };
}

/** Shelf-pack images into one sheet (no rotation, `pad` px apart and from the edges); returns positions and size. */
function packSheet(images, pad = 2) {
  const order = images.map((_, i) => i).sort((a, b) => images[b].height - images[a].height);
  const area = images.reduce((s, i) => s + (i.width + pad) * (i.height + pad), 0);
  let width = 64;
  while (width < 8192 && (width * width < area || images.some(i => i.width + pad * 2 > width))) width *= 2;
  const at = [];
  let x = pad, y = pad, row = 0;
  for (const i of order) {
    if (x + images[i].width + pad > width) { x = pad; y += row + pad; row = 0; }
    at[i] = [x, y]; x += images[i].width + pad; row = Math.max(row, images[i].height);
  }
  const height = y + row + pad;
  if (height > 8192) throw new StudioError('bad-argument', 'The sprite sheet would be over 8192 px: export at a smaller scale.', { width, height });
  const data = new Uint8Array(width * height * 4);
  images.forEach((img, i) => { for (let r = 0; r < img.height; r++) data.set(img.data.subarray(r * img.width * 4, (r + 1) * img.width * 4), ((at[i][1] + r) * width + at[i][0]) * 4); });
  return { at, image: { width, height, data } };
}

/**
 * Export a drawing.
 * @param {{ name: string, kind?: string, parts: any[] }} doc  the parts document (svg-rig.js)
 * @param {{ scales?: number[], kinds?: string[], pixels?: number, padding?: number, turns?: number }} options  padding: clear pixels around each sprite in a sheet (default 2); turns: angles of the pre-turned stack (default 16); maxSide: the widest stack strip row in pixels (default MAX_STRIP_SIDE)
 *   scales: pixels per rig unit (1x, 2x, 3x); pixels: instead, the longest side of the whole drawing in pixels
 * @returns {{ files: Record<string, Uint8Array | string>, manifest: object }}
 */
export function exportDrawing(doc, { scales = [1, 2], kinds = ['parts', 'sheet', 'svg'], pixels, padding = 2, turns = 16, maxSide = MAX_STRIP_SIDE } = {}) {
  /** @type {Record<string, Uint8Array | string>} */
  const files = {};
  const manifest = { name: doc.name, kind: doc.kind ?? 'rig', units: 'rig units, y up; pixel boxes y down from the top left', scales: [], parts: {} };
  const whole = drawingSvg(doc, { hidden: true });
  const list = pixels ? [r2(pixels / Math.max(...whole.size))] : scales;
  for (const s of list) if (!(s > 0 && s <= 8)) throw new StudioError('bad-argument', 'A scale is more than 0 and at most 8 pixels per unit.', { scale: s });
  const looks = doc.parts.flatMap(p => [{ part: p, name: p.name, svg: p.svg }, ...Object.entries(p.states ?? {}).map(([k, svg]) => ({ part: p, name: `${p.name}_${k}`, svg, state: k }))]);
  for (const p of doc.parts) {
    manifest.parts[p.name] = { at: p.at, pivot: p.pivot, size: p.size, ...(p.parent ? { parent: p.parent } : {}), ...(p.hidden ? { hidden: true } : {}), ...(p.blend ? { blend: p.blend } : {}), ...(p.states ? { states: Object.keys(p.states).map(k => `${p.name}_${k}`) } : {}) };
  }
  for (const s of list) {
    const tag = `${String(s).replace('.', '_')}x`;
    manifest.scales.push(s);
    if (kinds.includes('stack')) Object.assign(files, stackFiles(doc, s, tag, turns, padding, maxSide));
    if (!kinds.includes('parts') && !kinds.includes('sheet')) continue;
    const images = looks.map(l => {
      const full = rasterizeSvg(l.svg, { width: Math.max(1, Math.round(l.part.size[0] * s)), height: Math.max(1, Math.round(l.part.size[1] * s)) });
      const box = alphaBounds(full) ?? { x: 0, y: 0, width: 1, height: 1 };
      // The pivot in the trimmed image's pixels (y down), so an engine can place and turn it.
      const px = (l.part.pivot[0] - (l.part.at[0] - l.part.size[0] / 2)) * s - box.x;
      const py = ((l.part.at[1] + l.part.size[1] / 2) - l.part.pivot[1]) * s - box.y;
      return { ...l, image: crop(full, box), trim: box, source: [full.width, full.height], pivot: [r2(px), r2(py)] };
    });
    if (kinds.includes('parts')) {
      for (const l of images) {
        files[`png@${tag}/${l.name}.png`] = encodePng(l.image);
        const entry = manifest.parts[l.part.name];
        (entry.png ??= {})[tag] ??= {};
        entry.png[tag][l.name] = { file: `png@${tag}/${l.name}.png`, size: [l.image.width, l.image.height], trim: [l.trim.x, l.trim.y], source: l.source, pivot: l.pivot };
      }
    }
    if (kinds.includes('sheet')) {
      const { at, image } = packSheet(images.map(l => l.image), padding);
      files[`${doc.name}@${tag}.png`] = encodePng(image);
      const frames = Object.fromEntries(images.map((l, i) => [l.name, {
        frame: { x: at[i][0], y: at[i][1], w: l.image.width, h: l.image.height }, rotated: false, trimmed: true,
        spriteSourceSize: { x: l.trim.x, y: l.trim.y, w: l.image.width, h: l.image.height }, sourceSize: { w: l.source[0], h: l.source[1] },
        pivot: { x: r2(l.pivot[0] / Math.max(1, l.image.width)), y: r2(l.pivot[1] / Math.max(1, l.image.height)) },
      }]));
      files[`${doc.name}@${tag}.json`] = `${JSON.stringify({ frames, meta: { app: 'Keyframe Studio', image: `${doc.name}@${tag}.png`, format: 'RGBA8888', size: { w: image.width, h: image.height }, scale: String(s) } }, null, 1)}\n`;
    }
  }
  if (kinds.includes('svg')) {
    for (const l of looks) files[`svg/${l.name}.svg`] = partSvg({ ...l.part, name: l.name, svg: l.svg });
    files[`${doc.name}.svg`] = drawingSvg(doc).svg;
  }
  files['parts.json'] = `${JSON.stringify(manifest, null, 1)}\n`;
  return { files, manifest };
}

/** The widest strip a stack writes on one row, in pixels: safe in every engine's texture import. */
export const MAX_STRIP_SIDE = 16384;

/**
 * Columns and rows of a stack strip: one row while it fits in MAX_STRIP_SIDE, else rows of as many
 * slices as fit, as square a block as the side allows.
 */
export function stackGrid(count, w, h, side = MAX_STRIP_SIDE) {
  if (count * w <= side) return { columns: Math.max(1, count), rows: 1 };
  const columns = Math.max(1, Math.floor(side / Math.max(1, w)));
  const rows = Math.ceil(count / columns);
  if (rows * h > side) throw new StudioError('bad-argument', `This stack is too big to export at this scale (${count} slices of ${w}x${h} px); export it at a smaller scale.`, { slices: count, w, h });
  return { columns, rows };
}

/**
 * A sprite stack at one scale. The strip is what an engine stacks itself (the Godot add-on's
 * KeyframeStack node draws it turned at any angle, each slice one pixel above the last); the turn
 * sheet is the same stack pre-turned, for engines that only play frames.
 */
function stackFiles(doc, s, tag, turns, padding, maxSide = MAX_STRIP_SIDE) {
  const stack = stackSlices(doc, { scale: s });
  const [w, h] = stack.size, n = stack.slices.length;
  // Engines cap a texture's side (Godot imports up to 16384 px safely, 32768 at most, and shrinks a
  // wider one, which breaks every slice rectangle): a long strip wraps into rows, read left to
  // right, bottom slice first.
  const { columns, rows } = stackGrid(n, w, h, maxSide);
  const strip = { width: columns * w, height: rows * h, data: new Uint8Array(columns * w * rows * h * 4) };
  stack.slices.forEach((img, i) => {
    const ox = (i % columns) * w, oy = Math.floor(i / columns) * h;
    for (let y = 0; y < h; y++) strip.data.set(img.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * strip.width + ox) * 4);
  });
  const turned = turnFrames(stack, turns);
  const cols = Math.ceil(Math.sqrt(turns));
  const { at, image } = packSheetGrid(turned.frames.map(f => f.image), cols, padding);
  const [fw, fh] = turned.frame;
  const pivot = { x: r2(turned.origin[0] / fw), y: r2(turned.origin[1] / fh) };
  return {
    [`stack@${tag}.png`]: encodePng(strip),
    [`stack@${tag}.json`]: `${JSON.stringify({
      meta: { app: 'Keyframe Studio', kind: 'sprite-stack', image: `stack@${tag}.png`, slices: n, slice: { w, h }, columns, rows, layout: rows > 1 ? 'rows left to right, top row first, bottom slice first' : 'one row, bottom slice first', spacing: 1, pivot: { x: stack.pivot[0], y: stack.pivot[1] }, height: r2(stack.height), scale: s },
    }, null, 1)}\n`,
    [`turn@${tag}.png`]: encodePng(image),
    [`turn@${tag}.json`]: `${JSON.stringify({
      frames: Object.fromEntries(turned.frames.map((_, i) => [`${doc.name}_${String(i).padStart(2, '0')}`, { frame: { x: at[i][0], y: at[i][1], w: fw, h: fh }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: fw, h: fh }, sourceSize: { w: fw, h: fh }, pivot, angle: turned.degrees[i] }])),
      meta: { app: 'Keyframe Studio', kind: 'sprite-stack-turns', image: `turn@${tag}.png`, size: { w: image.width, h: image.height }, turns, angle: 'degrees, clockwise on screen, 0 = as drawn', origin: { x: turned.origin[0], y: turned.origin[1] }, scale: s },
    }, null, 1)}\n`,
  };
}

/**
 * An animation as a PNG sequence and one sheet, for engines without a skeletal runtime.
 *
 * Every clip of a skeleton is framed the same way: one view that holds all of its clips, so the
 * character keeps its size and its feet stay on the same pixel row when a game switches from idle to
 * run to jump. The sheet's map gives that anchor (the skeleton's origin, the ground under a
 * character) as `meta.origin` in pixels and as each frame's `pivot` (0-1). A clip that ends where it
 * starts is a loop (unless its name says it plays once, src/engine/loops.js): it is cut into whole
 * frames that cycle exactly, without a closing copy of the first.
 * @param {{ json: object, atlasText: string, pages: object, animation: string, fps?: number, size?: number, padding?: number, loop?: boolean }} input
 */
export async function exportClip({ json, atlasText, pages, animation, fps = 24, size = 256, padding = 2, loop: asked }) {
  const clip = json.animations?.[animation];
  if (!clip) throw new StudioError('bad-argument', `There is no animation "${animation}". Clips: ${Object.keys(json.animations ?? {}).join(', ') || 'none'}.`, { animation });
  const endOf = c => { let end = 0; const scan = v => { if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v === 'object') { if (Number.isFinite(v.time)) end = Math.max(end, v.time); Object.values(v).forEach(scan); } }; scan(c); return end; };
  const end = endOf(clip);
  // One view for every clip of the skeleton.
  let view = null;
  for (const [name, c] of Object.entries(json.animations ?? {})) {
    const e = endOf(c), times = Array.from({ length: 13 }, (_, i) => r2(e * i / 12));
    const { viewport: b } = await renderFrames({ json, atlasText, pages, animation: name, times, width: size, height: size, boundsOnly: true });
    if (b) view = view ? { x: Math.min(view.x, b.x), y: Math.min(view.y, b.y), width: Math.max(view.x + view.width, b.x + b.width) - Math.min(view.x, b.x), height: Math.max(view.y + view.height, b.y + b.height) - Math.min(view.y, b.y) } : b;
  }
  // Does the clip end where it starts? Compared on its exact first and last instants, not on the
  // last frame of the fps grid (a 0.6 s run at 12 fps never samples 0.6 s).
  const ends = await renderFrames({ json, atlasText, pages, animation, times: [0, end], width: 64, height: 64, ...(view ? { viewport: view } : {}) });
  const same = (a, b) => { for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i] - b.data[i]) > 2) return false; return true; };
  const loop = clipLoops(animation, end > 0 && same(ends.frames[0].image, ends.frames[1].image), typeof asked === 'boolean' ? asked : loopAnswer(animation, undefined, json));
  // A loop is cut into whole frames that cycle exactly (its closing copy of the first left out); a
  // one-shot keeps its last instant.
  const steps = Math.max(1, Math.min(240, Math.round(end * fps)));
  const times = loop ? Array.from({ length: steps }, (_, i) => r2(end * i / steps)) : Array.from({ length: steps + 1 }, (_, i) => r2(Math.min(end, i / fps)));
  const margin = 0.06;
  const rendered = await renderFrames({ json, atlasText, pages, animation, times, width: size, height: size, margin, ...(view ? { viewport: view } : {}) });
  const frames = rendered.frames;
  const frameMs = Math.round(1000 * (loop && end > 0 ? end / steps : 1 / fps));
  const box = rendered.viewport, k = rendered.scale;
  const origin = box && k ? [r2(size / 2 - (box.x + box.width / 2) * k), r2(size / 2 + (box.y + box.height / 2) * k)] : [size / 2, size / 2];
  /** @type {Record<string, Uint8Array | string>} */
  const files = {};
  frames.forEach((f, i) => { files[`clip-${animation}/frame_${String(i).padStart(4, '0')}.png`] = encodePng(f.image); });
  const cols = Math.ceil(Math.sqrt(frames.length));
  const { at, image } = packSheetGrid(frames.map(f => f.image), cols, padding);
  const pivot = { x: r2(origin[0] / size), y: r2(origin[1] / size) };
  files[`clip-${animation}@sheet.png`] = encodePng(image);
  files[`clip-${animation}@sheet.json`] = `${JSON.stringify({
    frames: Object.fromEntries(frames.map((f, i) => [`${animation}_${String(i).padStart(4, '0')}`, { frame: { x: at[i][0], y: at[i][1], w: size, h: size }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: size, h: size }, sourceSize: { w: size, h: size }, pivot, duration: frameMs }])),
    meta: { app: 'Keyframe Studio', image: `clip-${animation}@sheet.png`, size: { w: image.width, h: image.height }, fps, frames: frames.length, loop, origin: { x: origin[0], y: origin[1] }, scale: r2(k) },
  }, null, 1)}\n`;
  return { files, frames: frames.length, fps, loop, origin };
}

/** Frames on a grid, `pad` px of clear space around each, so a sampler never bleeds one into the next. */
function packSheetGrid(images, cols, pad = 2) {
  const { width: w, height: h } = images[0];
  const rows = Math.ceil(images.length / cols);
  const W = cols * (w + pad) + pad, H = rows * (h + pad) + pad;
  const data = new Uint8Array(W * H * 4);
  const at = images.map((img, n) => {
    const ox = pad + (n % cols) * (w + pad), oy = pad + Math.floor(n / cols) * (h + pad);
    for (let y = 0; y < h; y++) data.set(img.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * W + ox) * 4);
    return [ox, oy];
  });
  return { at, image: { width: W, height: H, data } };
}
