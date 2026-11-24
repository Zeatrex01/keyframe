// PNG decode and encode for headless rendering (ADR-3). Node standard library only:
// node:zlib for the deflate stream, everything else here.
//
// Decode covers what texture packers write: colour types 0 (grey), 2 (RGB), 3 (palette,
// with tRNS transparency), 4 (grey + alpha), 6 (RGBA); bit depths 1, 2, 4, 8, 16; all five
// row filters. Output is always 8-bit straight-alpha RGBA. Adam7 interlacing is refused by
// code: no Spine export writes it, and silently mis-decoding it would be worse.

import { inflateSync, deflateSync } from 'node:zlib';
import { StudioError } from '../shared/errors.js';

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, data: Uint8Array }} RGBA, 4 bytes per pixel, straight alpha
 */
export function decodePng(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || !SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new StudioError('png-signature', 'Not a PNG file (bad signature).');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) throw new StudioError('png-truncated', `PNG chunk ${type} is truncated.`);
    if (type === 'IHDR') {
      header = {
        width: view.getUint32(offset + 8), height: view.getUint32(offset + 12),
        bitDepth: body[8], colorType: body[9], interlace: body[12],
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new StudioError('png-header', 'PNG has no IHDR chunk.');
  const { width, height, bitDepth, colorType, interlace } = header;
  if (!(colorType in CHANNELS)) throw new StudioError('png-unsupported', `PNG colour type ${colorType} is not supported.`, { colorType });
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new StudioError('png-unsupported', `PNG bit depth ${bitDepth} is not supported.`, { bitDepth });
  if (interlace) throw new StudioError('png-interlaced', 'Interlaced (Adam7) PNGs are not supported; re-export without interlacing.');
  if (colorType === 3 && !palette) throw new StudioError('png-header', 'Palette PNG without a PLTE chunk.');
  if (!width || !height) throw new StudioError('png-header', 'PNG has zero width or height.');

  const raw = inflateSync(concat(idat));
  const channels = CHANNELS[colorType];
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw new StudioError('png-truncated', 'PNG image data is shorter than its size.');
  const rows = unfilter(raw, stride, height, bpp);

  const out = new Uint8Array(width * height * 4);
  const max = (1 << bitDepth) - 1;
  const sampleAt = (row, index) => {
    if (bitDepth === 8) return row[index];
    if (bitDepth === 16) return row[index * 2]; // high byte
    const bit = index * bitDepth;
    return (row[bit >> 3] >> (8 - bitDepth - (bit & 7))) & max;
  };
  const scale = bitDepth < 8 ? 255 / max : 1;
  const trnsGrey = colorType === 0 && transparency?.length >= 2 ? ((transparency[0] << 8) | transparency[1]) : null;
  const trnsRgb = colorType === 2 && transparency?.length >= 6
    ? [0, 2, 4].map(i => (transparency[i] << 8) | transparency[i + 1]) : null;
  const full = (row, index) => bitDepth === 16 ? ((row[index * 2] << 8) | row[index * 2 + 1]) : sampleAt(row, index);

  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6 || colorType === 2) {
        const base = x * channels;
        out[o] = sampleAt(row, base); out[o + 1] = sampleAt(row, base + 1); out[o + 2] = sampleAt(row, base + 2);
        if (colorType === 6) out[o + 3] = sampleAt(row, base + 3);
        else out[o + 3] = trnsRgb && [0, 1, 2].every(c => full(row, base + c) === trnsRgb[c]) ? 0 : 255;
      } else if (colorType === 0 || colorType === 4) {
        const base = x * channels;
        const grey = Math.round(sampleAt(row, base) * scale);
        out[o] = out[o + 1] = out[o + 2] = grey;
        if (colorType === 4) out[o + 3] = sampleAt(row, base + 1);
        else out[o + 3] = trnsGrey !== null && full(row, base) === trnsGrey ? 0 : 255;
      } else {
        const index = sampleAt(row, x);
        if (index * 3 + 2 >= palette.length) throw new StudioError('png-palette', `Palette index ${index} is out of range.`, { index });
        out[o] = palette[index * 3]; out[o + 1] = palette[index * 3 + 1]; out[o + 2] = palette[index * 3 + 2];
        out[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      }
    }
  }
  return { width, height, data: out };
}

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// Reverses the per-row filters. Returns the rows without their filter-type bytes.
function unfilter(raw, stride, height, bpp) {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = prev ? prev[i] : 0;
      const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
      let value;
      switch (type) {
        case 0: value = src[i]; break;
        case 1: value = src[i] + left; break;
        case 2: value = src[i] + up; break;
        case 3: value = src[i] + ((left + up) >> 1); break;
        case 4: value = src[i] + paeth(left, up, upLeft); break;
        default: throw new StudioError('png-filter', `Unknown PNG row filter ${type}.`, { filter: type, row: y });
      }
      row[i] = value & 255;
    }
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {{ width: number, height: number, data: Uint8Array }} image RGBA, straight alpha
 * @returns {Uint8Array} PNG bytes (colour type 6, 8 bits, Sub filter on every row)
 */
export function encodePng({ width, height, data }) {
  if (!(width > 0 && height > 0) || data.length !== width * height * 4) {
    throw new StudioError('bad-argument', 'encodePng needs width * height * 4 RGBA bytes.', { width, height, length: data.length });
  }
  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    filtered[o] = 1; // Sub: cheap and effective on sprite art
    for (let i = 0; i < stride; i++) {
      const value = data[y * stride + i];
      const left = i >= 4 ? data[y * stride + i - 4] : 0;
      filtered[o + 1 + i] = (value - left) & 255;
    }
  }
  const chunk = (type, body) => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(filtered)), chunk('IEND', new Uint8Array(0))]);
}
