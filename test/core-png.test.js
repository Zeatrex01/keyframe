// Gate for src/core/png.js. Ported from the PNG section of legacy test_rig.js: a real PNG
// is measured, and a non-PNG or a missing file is refused by CODE, never by thrown text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngSize } from '../src/core/png.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'core');

function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-png-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// The signature plus an IHDR header, as the first 24 bytes of a real PNG.
function header(width, height, chunk = 'IHDR') {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write(chunk, 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('a real PNG is measured', () => {
  // The legacy splash logo, copied byte for byte: 128 x 68.
  assert.deepEqual(pngSize(path.join(FIXTURES, 'logo.png')), { width: 128, height: 68 });
});

test('a file that is not a PNG is refused with a code, not thrown text', () => {
  assert.deepEqual(pngSize(path.join(FIXTURES, 'VERSION')), { error: 'not-png' });
});

test('a missing file is refused with a code', () => {
  assert.deepEqual(pngSize(path.join(FIXTURES, 'no-such-file.png')), { error: 'unreadable' });
});

test('width and height come from IHDR as unsigned big-endian', () => withTemp(dir => {
  const file = path.join(dir, 'big.png');
  fs.writeFileSync(file, header(0x80000001, 3));
  assert.deepEqual(pngSize(file), { width: 0x80000001, height: 3 });
}));

test('a PNG whose first chunk is not IHDR is refused', () => withTemp(dir => {
  const file = path.join(dir, 'odd.png');
  fs.writeFileSync(file, header(4, 4, 'IDAT'));
  assert.deepEqual(pngSize(file), { error: 'no-ihdr' });
}));

test('a truncated header (fewer than 24 bytes) is not a PNG', () => withTemp(dir => {
  const file = path.join(dir, 'short.png');
  fs.writeFileSync(file, header(4, 4).subarray(0, 23));
  assert.deepEqual(pngSize(file), { error: 'not-png' });
}));

test('one wrong signature byte is not a PNG', () => withTemp(dir => {
  const file = path.join(dir, 'sig.png');
  const buf = header(4, 4);
  buf[7] = 0x0b;
  fs.writeFileSync(file, buf);
  assert.deepEqual(pngSize(file), { error: 'not-png' });
}));

test('a directory is unreadable, not a crash', () => withTemp(dir => {
  const result = pngSize(dir);
  assert.ok(result.error === 'unreadable' || result.error === 'not-png', JSON.stringify(result));
}));
