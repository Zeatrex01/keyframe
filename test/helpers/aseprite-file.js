// Writes .aseprite files from a plain description, by the published file format
// (docs/ase-file-specs.md in the Aseprite repository), so the import gates can make every case
// they need: colour depths, linked and raw cels, groups, hidden and reference layers, blend
// modes, opacities, tags, the old and the new palette chunk, tilemap layers.

import { deflateSync } from 'node:zlib';

const word = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return b; };
const short = v => { const b = Buffer.alloc(2); b.writeInt16LE(v); return b; };
const dword = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const byte = v => Buffer.from([v & 255]);
const zeros = n => Buffer.alloc(n);
const string = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([word(b.length), b]); };
const chunk = (type, body) => Buffer.concat([dword(body.length + 6), word(type), body]);

const LAYER_TYPES = { image: 0, group: 1, tilemap: 2 };
const DIRECTIONS = { forward: 0, reverse: 1, pingpong: 2, 'pingpong-reverse': 3 };

/**
 * @param {object} spec
 * @param {number} spec.width @param {number} spec.height
 * @param {8|16|32} [spec.depth]  32 RGBA (default), 16 grayscale, 8 indexed
 * @param {number} [spec.flags]   header flags (default 1: layer opacity is valid)
 * @param {number} [spec.transparent]  indexed: the palette entry that is clear
 * @param {number[][]} [spec.palette]  [r, g, b, a] entries
 * @param {boolean} [spec.oldPalette]  write the palette as the old 0x0004 chunk
 * @param {Array<{ name: string, type?: string, level?: number, visible?: boolean, background?: boolean, reference?: boolean, blend?: number, opacity?: number }>} spec.layers
 * @param {Array<{ duration?: number, cels?: Array<{ layer: number, x?: number, y?: number, opacity?: number, z?: number,
 *   width?: number, height?: number, pixels?: ArrayLike<number>, link?: number, raw?: boolean }> }>} spec.frames
 * @param {Array<{ name: string, from: number, to: number, direction?: string, repeat?: number }>} [spec.tags]
 * @returns {Buffer}
 */
export function asepriteFile({ width, height, depth = 32, flags = 1, transparent = 0, palette = [], oldPalette = false, layers, frames, tags = [] }) {
  const framesOut = frames.map((frame, f) => {
    const chunks = [];
    if (f === 0) {
      if (palette.length && oldPalette) {
        chunks.push(chunk(0x0004, Buffer.concat([word(1), byte(0), byte(palette.length === 256 ? 0 : palette.length), ...palette.map(c => Buffer.from([c[0], c[1], c[2]]))])));
      } else if (palette.length) {
        chunks.push(chunk(0x2019, Buffer.concat([dword(palette.length), dword(0), dword(palette.length - 1), zeros(8),
          ...palette.map(c => Buffer.concat([word(0), Buffer.from([c[0], c[1], c[2], c[3] ?? 255])]))])));
      }
      for (const l of layers) {
        const lflags = (l.visible === false ? 0 : 1) | 2 | (l.background ? 8 : 0) | (l.reference ? 64 : 0);
        const type = LAYER_TYPES[l.type ?? 'image'];
        chunks.push(chunk(0x2004, Buffer.concat([word(lflags), word(type), word(l.level ?? 0), word(0), word(0), word(l.blend ?? 0),
          byte(l.opacity ?? 255), zeros(3), string(l.name), ...(type === 2 ? [dword(0)] : [])])));
      }
      if (tags.length) {
        chunks.push(chunk(0x2018, Buffer.concat([word(tags.length), zeros(8), ...tags.map(t => Buffer.concat([word(t.from), word(t.to),
          byte(DIRECTIONS[t.direction ?? 'forward']), word(t.repeat ?? 0), zeros(6), Buffer.from([0, 0, 0]), byte(0), string(t.name)]))])));
      }
    }
    for (const c of frame.cels ?? []) {
      const head = Buffer.concat([word(c.layer), short(c.x ?? 0), short(c.y ?? 0), byte(c.opacity ?? 255)]);
      const tail = Buffer.concat([short(c.z ?? 0), zeros(5)]);
      if (c.link !== undefined) chunks.push(chunk(0x2005, Buffer.concat([head, word(1), tail, word(c.link)])));
      else {
        const pixels = Buffer.from(Uint8Array.from(c.pixels ?? []));
        chunks.push(chunk(0x2005, Buffer.concat([head, word(c.raw ? 0 : 2), tail, word(c.width ?? 0), word(c.height ?? 0), c.raw ? pixels : deflateSync(pixels)])));
      }
    }
    const body = Buffer.concat(chunks);
    return Buffer.concat([dword(body.length + 16), word(0xF1FA), word(chunks.length), word(frame.duration ?? 100), zeros(2), dword(chunks.length), body]);
  });
  const all = Buffer.concat(framesOut);
  const header = Buffer.concat([dword(128 + all.length), word(0xA5E0), word(frames.length), word(width), word(height), word(depth), dword(flags), word(100),
    dword(0), dword(0), byte(transparent), zeros(3), word(palette.length), byte(1), byte(1), short(0), short(0), word(16), word(16), zeros(84)]);
  return Buffer.concat([header, all]);
}

/**
 * RGBA pixels from rows of characters and a key: { '.': null, O: [43, 34, 56], ... } ([r, g, b] or [r, g, b, a]).
 * Rows may differ in length; the image is as wide as the longest.
 * @param {string[]} rows @param {Record<string, number[]|null>} key
 */
export function sprite(rows, key) {
  const width = Math.max(...rows.map(r => r.length)), height = rows.length;
  const pixels = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = key[ch];
    if (c === undefined) throw new Error(`sprite: no colour for "${ch}"`);
    if (c) pixels.set([c[0], c[1], c[2], c[3] ?? 255], (y * width + x) * 4);
  }));
  return { width, height, pixels };
}
