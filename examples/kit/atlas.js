// Atlas pages for the example kit: read a page into its regions, crop, resize, and pack pictures
// into one page with its .atlas text. PNG in and out through the studio's own codec.
import fs from 'node:fs';
import { decodePng, encodePng } from '../../src/render/png.js';

/** Regions of a one-page atlas (rotate: false only, as the kit writes them). */
export function parseRegions(text) {
  const lines = text.split(/\r?\n/), regions = [];
  let current = null;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { if (/:/.test(line)) continue; current = { name: line.trim() }; regions.push(current); continue; }
    const [key, value] = line.trim().split(/:\s*/);
    const nums = value.split(',').map(Number);
    if (key === 'xy') [current.x, current.y] = nums;
    if (key === 'size') [current.w, current.h] = nums;
    if (key === 'rotate' && value !== 'false') throw new Error('atlas: rotated regions are not supported here');
  }
  return regions;
}

/** Read `<file>.atlas` and its page: { regions: Map(name -> picture) }. */
export function readAtlas(atlasFile) {
  const text = fs.readFileSync(atlasFile, 'utf8');
  const page = decodePng(fs.readFileSync(atlasFile.replace(/[^/\\]+$/, text.split(/\r?\n/)[0].trim())));
  return new Map(parseRegions(text).map(r => [r.name, crop(page, r.x, r.y, r.w, r.h)]));
}

export function crop(image, x, y, w, h) {
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) data.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + w) * 4), row * w * 4);
  return { width: w, height: h, data };
}

/** Resize by area averaging in premultiplied space (good for shrinking art). */
export function resize(image, width, height) {
  const { width: W, height: H, data } = image, out = new Uint8Array(width * height * 4);
  const sx = W / width, sy = H / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const x0 = x * sx, x1 = (x + 1) * sx, y0 = y * sy, y1 = (y + 1) * sy;
    for (let py = Math.floor(y0); py < Math.ceil(y1); py++) for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
      const wgt = (Math.min(x1, px + 1) - Math.max(x0, px)) * (Math.min(y1, py + 1) - Math.max(y0, py));
      const i = (Math.min(H - 1, py) * W + Math.min(W - 1, px)) * 4, al = data[i + 3] / 255;
      r += data[i] * al * wgt; g += data[i + 1] * al * wgt; b += data[i + 2] * al * wgt; a += al * wgt; n += wgt;
    }
    const o = (y * width + x) * 4, k = a > 1e-6 ? 1 / a : 0;
    out[o] = Math.round(r * k); out[o + 1] = Math.round(g * k); out[o + 2] = Math.round(b * k); out[o + 3] = Math.round(a / n * 255);
  }
  return { width, height, data: out };
}

/**
 * Pack pictures (tallest first, shelf by shelf) into one page.
 * @param {Array<{ name: string, image: { width: number, height: number, data: Uint8Array } }>} items
 * @returns {{ png: Uint8Array, atlas: string, width: number, height: number }}
 */
export function pack(items, pageName, { width, pad = 4 } = {}) {
  const area = items.reduce((n, i) => n + (i.image.width + pad) * (i.image.height + pad), 0);
  const widest = Math.max(...items.map(i => i.image.width)) + 2 * pad;
  const SW = width ?? Math.min(2048, Math.max(widest, Math.ceil(Math.sqrt(area) * 1.15)));
  const order = [...items].sort((a, b) => b.image.height - a.image.height || a.name.localeCompare(b.name));
  let x = pad, y = pad, rowH = 0;
  const placed = [];
  for (const item of order) {
    const { width: w, height: h } = item.image;
    if (w + 2 * pad > SW) throw new Error(`atlas: ${item.name} is wider than the page`);
    if (x + w + pad > SW) { x = pad; y += rowH + pad; rowH = 0; }
    placed.push({ ...item, x, y });
    x += w + pad; rowH = Math.max(rowH, h);
  }
  const H = y + rowH + pad, page = new Uint8Array(SW * H * 4);
  for (const p of placed) for (let row = 0; row < p.image.height; row++) page.set(p.image.data.subarray(row * p.image.width * 4, (row + 1) * p.image.width * 4), ((p.y + row) * SW + p.x) * 4);
  let atlas = `${pageName}\nsize: ${SW},${H}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n`;
  // regions listed in the order given, so the file reads like the rig
  for (const item of items) {
    const p = placed.find(q => q.name === item.name);
    atlas += `${p.name}\n  rotate: false\n  xy: ${p.x}, ${p.y}\n  size: ${p.image.width}, ${p.image.height}\n  orig: ${p.image.width}, ${p.image.height}\n  offset: 0, 0\n  index: -1\n`;
  }
  return { png: encodePng({ width: SW, height: H, data: page }), atlas, width: SW, height: H };
}
