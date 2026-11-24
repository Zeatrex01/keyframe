// A zip of a folder, for "package to send": the studio as it stands, so it can be tried on another
// machine or with another agent. Standard library only (zlib deflate), so no dependency.
//
// Left out: version control, installed packages, the machine's own config and the per-project
// working folders, which belong to this machine and would only confuse the copy.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const PACKAGE_SKIP = new Set(['.git', 'node_modules', '.keyframe', '.backup', 'studio.config.json', 'samples',
  // Machine-local files a public copy must never carry: agent client configs (absolute paths,
  // sometimes keys), runtime state, logs, editor and tool state, environment files.
  '.mcp.json', '.codex', '.claude', '.serena', '.playwright-mcp', '.vscode', '.idea', 'state', 'history', 'dist', 'logs', '.DS_Store', 'Thumbs.db']);
const SKIP_PATTERN = /(\.tmp|\.log|\.lock|\.bak)$|^\.env(\..*)?$/i;

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Every file under `root` worth packaging, as forward-slash paths, sorted. */
export function packageFiles(root, skip = PACKAGE_SKIP) {
  const out = [];
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (skip.has(entry.name) || SKIP_PATTERN.test(entry.name)) continue;
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) out.push(next);
    }
  };
  walk('');
  return out.sort();
}

/**
 * Zip the given files of `root` under the folder name `prefix`.
 * @returns {Buffer}
 */
export function zipFolder(root, { prefix = path.basename(root), files = packageFiles(root), date = new Date() } = {}) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [], central = [];
  let offset = 0;
  for (const rel of files) {
    const data = fs.readFileSync(path.join(root, ...rel.split('/')));
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const stored = packed.length >= data.length;
    const body = stored ? data : packed;
    const name = Buffer.from(`${prefix}/${rel}`, 'utf8');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    locals.push(head, name, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt16LE(dosTime, 12); entry.writeUInt16LE(dosDate, 14); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += head.length + name.length + body.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

/** Read a zip written by zipFolder back: name -> contents. For the gate, and to prove a package opens. */
export function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(at + 10), crc = buffer.readUInt32LE(at + 16), packedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32), local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const body = buffer.subarray(start, start + packedSize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    if (crc32(data) !== crc) throw new Error(`${name}: checksum mismatch`);
    out.set(name, data);
    at += 46 + nameLength + extra + comment;
  }
  return out;
}
