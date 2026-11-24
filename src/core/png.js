// How big is this image, without a browser and without a dependency. Ported from legacy
// core/png.js.
//
// An attachment without its real width and height is a box at the wrong size in Spine.
// This reads the 8-byte signature and the IHDR chunk (the first 24 bytes of every valid
// PNG) and REPORTS a stable reason instead of throwing text: wording belongs to the
// caller, never to a byte reader.
//
// Node-only (layer `core`). Size reader only; decoding pixels is not part of the port.

import fs from 'node:fs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @param {string} abs
 * @returns {{ width: number, height: number } | { error: 'unreadable' | 'not-png' | 'no-ihdr' }}
 */
export function pngSize(abs) {
  let fd;
  try { fd = fs.openSync(abs, 'r'); } catch { return { error: 'unreadable' }; }
  try {
    const buf = Buffer.alloc(24);
    const read = fs.readSync(fd, buf, 0, 24, 0);
    if (read < 24 || !buf.subarray(0, 8).equals(SIGNATURE)) return { error: 'not-png' };
    // The FIRST chunk of a PNG must be IHDR; bytes 12..15 carry the chunk type.
    if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return { error: 'no-ihdr' };
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch { return { error: 'unreadable' }; } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}
