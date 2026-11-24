// A drawing made usable outside the studio, for game engines, web pages and design tools:
//
//   png@<s>x/<part>.png        each part (and each state) at scale s, transparent, trimmed to its
//                              pixels; parts.json keeps where each sits and where it turns
//   <name>@<s>x.png + .json    one sprite sheet per scale with a frame map (the common "JSON hash"
//                              sprite-sheet layout game engines and web libraries read)
//   svg/<part>.svg, <name>.svg clean SVG: each part, and the whole drawing with a <g id> per part
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

const r2 = v => Math.round(v * 100) / 100;
export const EXPORT_KINDS = Object.freeze(['parts', 'sheet', 'svg', 'clip']);

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

/** Shelf-pack images into one sheet (no rotation, 2 px apart); returns positions and size. */
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
 * @param {{ scales?: number[], kinds?: string[], pixels?: number }} options
 *   scales: pixels per rig unit (1x, 2x, 3x); pixels: instead, the longest side of the whole drawing in pixels
 * @returns {{ files: Record<string, Uint8Array | string>, manifest: object }}
 */
export function exportDrawing(doc, { scales = [1, 2], kinds = ['parts', 'sheet', 'svg'], pixels } = {}) {
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
      const { at, image } = packSheet(images.map(l => l.image));
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

/**
 * An animation as a PNG sequence and one sheet, for engines without a skeletal runtime.
 * @param {{ json: object, atlasText: string, pages: object, animation: string, fps?: number, size?: number }} input
 */
export async function exportClip({ json, atlasText, pages, animation, fps = 24, size = 256 }) {
  const clip = json.animations?.[animation];
  if (!clip) throw new StudioError('bad-argument', `There is no animation "${animation}". Clips: ${Object.keys(json.animations ?? {}).join(', ') || 'none'}.`, { animation });
  let end = 0;
  const scan = v => { if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v === 'object') { if (Number.isFinite(v.time)) end = Math.max(end, v.time); Object.values(v).forEach(scan); } };
  scan(clip);
  const count = Math.max(1, Math.min(240, Math.round(end * fps) + 1));
  const times = Array.from({ length: count }, (_, i) => r2(i / fps));
  const { frames } = await renderFrames({ json, atlasText, pages, animation, times, width: size, height: size, margin: 0.06 });
  /** @type {Record<string, Uint8Array | string>} */
  const files = {};
  frames.forEach((f, i) => { files[`clip-${animation}/frame_${String(i).padStart(4, '0')}.png`] = encodePng(f.image); });
  const cols = Math.ceil(Math.sqrt(count));
  const { at, image } = packSheetGrid(frames.map(f => f.image), cols);
  files[`clip-${animation}@sheet.png`] = encodePng(image);
  files[`clip-${animation}@sheet.json`] = `${JSON.stringify({
    frames: Object.fromEntries(frames.map((f, i) => [`${animation}_${String(i).padStart(4, '0')}`, { frame: { x: at[i][0], y: at[i][1], w: size, h: size }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: size, h: size }, sourceSize: { w: size, h: size }, duration: Math.round(1000 / fps) }])),
    meta: { app: 'Keyframe Studio', image: `clip-${animation}@sheet.png`, size: { w: image.width, h: image.height }, fps, frames: count, loop: true },
  }, null, 1)}\n`;
  return { files, frames: count, fps };
}

function packSheetGrid(images, cols) {
  const { width: w, height: h } = images[0];
  const rows = Math.ceil(images.length / cols);
  const data = new Uint8Array(cols * w * rows * h * 4);
  const at = images.map((img, n) => {
    const ox = (n % cols) * w, oy = Math.floor(n / cols) * h;
    for (let y = 0; y < h; y++) data.set(img.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * cols * w + ox) * 4);
    return [ox, oy];
  });
  return { at, image: { width: cols * w, height: rows * h, data } };
}
