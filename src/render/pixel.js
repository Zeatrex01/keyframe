// Pixel art from a vector drawing: every pixel one colour of a small palette, fully opaque or fully
// clear, no anti-aliasing, optionally outlined and blown up by a whole number for crisp display.
//
// The drawing is rendered at OVERSAMPLE times the target size; each target pixel then takes the
// palette colour most of its covered subpixels map to (not their average, which would invent the
// in-between colours pixel art does without), and is kept only when at least half of it is covered.
// The palette is the given one, or found from the drawing itself (median cut, refined by a few
// rounds of k-means), shared by every part and frame of one export so nothing flickers.
//
// Pure: images are { width, height, data } RGBA, straight alpha.

import { StudioError } from '../shared/errors.js';

/** Subpixels per target pixel along each side. */
export const OVERSAMPLE = 4;
const HEX = /^#?[0-9a-f]{6}$/i;

/**
 * The pixel-art settings of an export, checked.
 * @param {any} pixel  { colors?: 2-64 (default 16), palette?: ['rrggbb', ...], outline?: 'rrggbb', upscale?: 1-8 }
 * @returns {{ colors: number, palette: number[][] | null, outline: number[] | null, upscale: number }}
 */
export function pixelOptions(pixel) {
  if (!pixel || typeof pixel !== 'object' || Array.isArray(pixel)) throw new StudioError('bad-argument', '`pixel` is an object: { colors?, palette?, outline?, upscale? }.');
  const colors = pixel.colors === undefined ? 16 : pixel.colors;
  if (!(Number.isInteger(colors) && colors >= 2 && colors <= 64)) throw new StudioError('bad-argument', 'pixel.colors is a whole number from 2 to 64.', { colors });
  let palette = null;
  if (pixel.palette !== undefined) {
    if (!Array.isArray(pixel.palette) || pixel.palette.length < 2 || pixel.palette.length > 256 || !pixel.palette.every(c => typeof c === 'string' && HEX.test(c))) {
      throw new StudioError('bad-argument', 'pixel.palette is 2 to 256 colours as rrggbb.', { palette: pixel.palette });
    }
    palette = pixel.palette.map(rgbOf);
  }
  if (pixel.outline !== undefined && !(typeof pixel.outline === 'string' && HEX.test(pixel.outline))) throw new StudioError('bad-argument', 'pixel.outline is a colour as rrggbb.', { outline: pixel.outline });
  const upscale = pixel.upscale === undefined ? 1 : pixel.upscale;
  if (!(Number.isInteger(upscale) && upscale >= 1 && upscale <= 8)) throw new StudioError('bad-argument', 'pixel.upscale is a whole number from 1 to 8.', { upscale });
  return { colors, palette, outline: pixel.outline ? rgbOf(pixel.outline) : null, upscale };
}

export const rgbOf = (/** @type {string} */ hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
export const hexOf = (/** @type {number[]} */ c) => c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

// Green weighs most and blue least, as the eye sees differences.
const dist = (a, b) => { const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return 2 * dr * dr + 4 * dg * dg + 3 * db * db; };
const nearest = (palette, c) => { let best = 0, d = Infinity; palette.forEach((p, i) => { const e = dist(p, c); if (e < d) { d = e; best = i; } }); return best; };

/**
 * A palette of at most `count` colours for the covered pixels of the images.
 * @param {Array<{ width: number, height: number, data: Uint8Array }>} images
 * @returns {number[][]}
 */
export function findPalette(images, count) {
  const total = images.reduce((n, img) => n + img.width * img.height, 0);
  const step = Math.max(1, Math.floor(total / 60000));
  const samples = [];
  let k = 0;
  for (const img of images) for (let i = 0; i < img.width * img.height; i++) {
    if (k++ % step || img.data[i * 4 + 3] < 128) continue;
    samples.push([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]]);
  }
  if (!samples.length) return [[0, 0, 0], [255, 255, 255]];
  // Median cut: split the box with the widest channel at its median until there are enough.
  const boxes = [samples];
  while (boxes.length < count) {
    let pick = -1, widest = 0, channel = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const s of box) { if (s[c] < lo) lo = s[c]; if (s[c] > hi) hi = s[c]; }
        if (hi - lo > widest) { widest = hi - lo; pick = i; channel = c; }
      }
    });
    if (pick < 0 || widest === 0) break;
    const box = boxes[pick].slice().sort((a, b) => a[channel] - b[channel]);
    const mid = box.length >> 1;
    boxes.splice(pick, 1, box.slice(0, mid), box.slice(mid));
  }
  const mean = box => [0, 1, 2].map(c => box.reduce((s, v) => s + v[c], 0) / box.length);
  let palette = boxes.filter(b => b.length).map(mean);
  // A few rounds of k-means settle each colour on the middle of what it stands for.
  for (let round = 0; round < 4; round++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const s of samples) { const i = nearest(palette, s); sums[i][0] += s[0]; sums[i][1] += s[1]; sums[i][2] += s[2]; sums[i][3]++; }
    palette = palette.map((p, i) => (sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : p));
  }
  const seen = new Set();
  return palette.map(p => p.map(v => Math.round(v))).filter(p => { const key = hexOf(p); return !seen.has(key) && seen.add(key); });
}

/**
 * Pixel art from an image rendered `factor` times larger: one palette colour or clear per pixel.
 * @param {{ width: number, height: number, data: Uint8Array }} img
 * @param {number} factor @param {number[][]} palette
 */
export function pixelate(img, factor, palette) {
  const width = Math.max(1, Math.floor(img.width / factor)), height = Math.max(1, Math.floor(img.height / factor));
  const data = new Uint8Array(width * height * 4);
  const cache = new Map();
  const indexOf = (r, g, b) => { const key = (r << 16) | (g << 8) | b; let i = cache.get(key); if (i === undefined) { i = nearest(palette, [r, g, b]); cache.set(key, i); } return i; };
  const votes = new Float64Array(palette.length);
  const luma = palette.map(c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    votes.fill(0);
    let cover = 0;
    for (let sy = 0; sy < factor; sy++) for (let sx = 0; sx < factor; sx++) {
      const o = ((y * factor + sy) * img.width + x * factor + sx) * 4, a = img.data[o + 3];
      cover += a;
      if (a >= 128) votes[indexOf(img.data[o], img.data[o + 1], img.data[o + 2])] += 1;
    }
    if (cover < factor * factor * 255 * 0.5) continue;
    let best = 0, total = 0;
    for (let i = 0; i < votes.length; i++) { total += votes[i]; if (votes[i] > votes[best]) best = i; }
    // A dark line or an eye thinner than a pixel would lose the vote to the fill around it; a
    // clearly darker colour holding a good share of the pixel keeps it.
    let pick = best;
    for (let i = 0; i < votes.length; i++) if (votes[i] >= total * 0.3 && luma[best] - luma[i] > 48 && luma[i] < luma[pick]) pick = i;
    best = pick;
    const o = (y * width + x) * 4, c = palette[best];
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  return { width, height, data };
}

/** Clear pixels around the image (room for an outline). */
export function pad(img, n) {
  const width = img.width + 2 * n, height = img.height + 2 * n, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + n) * width + n) * 4);
  return { width, height, data };
}

/** A one-pixel outline: every clear pixel beside a covered one (up, down, left, right) takes `color`. */
export function outline(img, color) {
  const { width, height } = img, src = img.data, data = Uint8Array.from(src);
  const covered = (x, y) => x >= 0 && y >= 0 && x < width && y < height && src[(y * width + x) * 4 + 3] > 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (covered(x, y) || !(covered(x - 1, y) || covered(x + 1, y) || covered(x, y - 1) || covered(x, y + 1))) continue;
    const o = (y * width + x) * 4;
    data[o] = color[0]; data[o + 1] = color[1]; data[o + 2] = color[2]; data[o + 3] = 255;
  }
  return { width, height, data };
}

/** Each pixel blown up to an n by n block. */
export function upscale(img, n) {
  if (n === 1) return img;
  const width = img.width * n, height = img.height * n, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = ((Math.floor(y / n)) * img.width + Math.floor(x / n)) * 4, o = (y * width + x) * 4;
    data[o] = img.data[s]; data[o + 1] = img.data[s + 1]; data[o + 2] = img.data[s + 2]; data[o + 3] = img.data[s + 3];
  }
  return { width, height, data };
}

/**
 * The whole step for one oversampled image: pixelate, outline (with a clear pixel of room on each
 * side, so `margin` is 1 then), blow up.
 * @returns {{ image: { width: number, height: number, data: Uint8Array }, margin: number }}
 */
export function toPixelArt(hi, options, palette, { room = true } = {}) {
  let img = pixelate(hi, OVERSAMPLE, palette);
  let margin = 0;
  if (options.outline) {
    if (room) { img = pad(img, 1); margin = 1; }
    img = outline(img, options.outline);
  }
  return { image: upscale(img, options.upscale), margin };
}

/** The palette as files: one colour per line (the common .hex palette format) and a swatch strip. */
export function paletteFiles(palette, encodePng) {
  const cell = 8, width = palette.length * cell, data = new Uint8Array(width * cell * 4);
  palette.forEach((c, i) => { for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) data.set([c[0], c[1], c[2], 255], (y * width + i * cell + x) * 4); });
  return { 'palette.hex': `${palette.map(hexOf).join('\n')}\n`, 'palette.png': encodePng({ width, height: cell, data }) };
}
