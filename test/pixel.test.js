// Gate for pixel-art export (src/render/pixel.js, export_art `pixel`): every pixel is one palette
// colour, fully opaque or clear; a pixel takes the colour most of it shows (a clearly darker line
// keeps its share); the palette is found from the drawing and shared by parts and frames; the
// outline and the blow-up are exact, and pivots stay true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pixelate, findPalette, outline, upscale, pixelOptions, hexOf, rgbOf } from '../src/render/pixel.js';
import { decodePng } from '../src/render/png.js';
import { createServer } from '../src/mcp/server.js';

/** An image from a function of the pixel: [r, g, b, a] or null for clear. */
const image = (width, height, at) => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const c = at(x, y); if (c) data.set(c, (y * width + x) * 4); }
  return { width, height, data };
};
const px = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const RED = [220, 40, 40], BLUE = [40, 60, 220], DARK = [20, 20, 30];

test('a pixel takes the colour most of it shows, never a blend, and is kept only when half covered', () => {
  // Four subpixels a side: red left, blue right, a blended column between them, a ragged bottom row.
  const hi = image(16, 8, (x, y) => {
    if (y >= 4 && x >= 8) return x < 10 ? [...RED, 255] : null;   // 2 of 4 columns: half covered, kept
    if (y >= 4 && x >= 4 && x < 8) return x < 5 ? [...BLUE, 255] : null;   // a quarter: clear
    return x === 7 ? [130, 50, 130, 255] : x < 7 ? [...RED, 255] : [...BLUE, 255];
  });
  const out = pixelate(hi, 4, [RED, BLUE, [130, 50, 130]].slice(0, 2));
  assert.deepEqual([out.width, out.height], [4, 2]);
  assert.deepEqual(px(out, 0, 0), [...RED, 255]);
  assert.deepEqual(px(out, 1, 0), [...RED, 255], 'the blended column votes, it does not paint');
  assert.deepEqual(px(out, 2, 0), [...BLUE, 255]);
  assert.deepEqual(px(out, 1, 1)[3], 0, 'a quarter covered is clear');
  assert.deepEqual(px(out, 2, 1), [...RED, 255], 'half covered is kept');
  for (let i = 3; i < out.data.length; i += 4) assert.ok(out.data[i] === 0 || out.data[i] === 255, 'no partial alpha');
});

test('a clearly darker line keeps the pixels it holds a good share of', () => {
  const block = darkCols => image(4, 4, x => (x < darkCols ? [...DARK, 255] : [...RED, 255]));
  assert.deepEqual(px(pixelate(block(1), 4, [RED, DARK]), 0, 0), [...RED, 255], 'a quarter of a pixel: the fill wins');
  assert.deepEqual(px(pixelate(block(2), 4, [RED, DARK]), 0, 0), [...DARK, 255], 'half: the dark line stays');
  const light = image(4, 4, x => (x < 2 ? [240, 220, 220, 255] : [...RED, 255]));
  assert.deepEqual(px(pixelate(light, 4, [RED, [240, 220, 220]]), 0, 0), [...RED, 255], 'a lighter share does not take over');
});

test('the palette is found from the drawing: its own colours when it has few, the given count at most', () => {
  const three = image(30, 10, x => (x < 10 ? [...RED, 255] : x < 20 ? [...BLUE, 255] : [...DARK, 255]));
  assert.deepEqual(findPalette([three], 3).map(hexOf).sort(), [RED, BLUE, DARK].map(hexOf).sort());
  assert.equal(findPalette([three], 2).length, 2);
  const ramp = image(64, 4, x => [x * 4, 128, 255 - x * 4, 255]);
  const sixteen = findPalette([ramp], 16);
  assert.ok(sixteen.length <= 16 && sixteen.length >= 12, `${sixteen.length}`);
  assert.deepEqual(findPalette([ramp], 16), sixteen, 'the same drawing gives the same palette');
});

test('outline and blow-up are exact; settings are checked', () => {
  const dot = image(3, 3, (x, y) => (x === 1 && y === 1 ? [...RED, 255] : null));
  const ring = outline(dot, DARK);
  const at = (x, y) => px(ring, x, y);
  assert.deepEqual([at(1, 0), at(0, 1), at(2, 1), at(1, 2)].map(c => c.join()), Array(4).fill([...DARK, 255].join()));
  assert.equal(at(0, 0)[3], 0, 'corners stay clear');
  assert.deepEqual(at(1, 1), [...RED, 255]);
  const big = upscale(ring, 3);
  assert.deepEqual([big.width, big.height], [9, 9]);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) assert.deepEqual(px(big, x, y), at(Math.floor(x / 3), Math.floor(y / 3)));
  assert.deepEqual(pixelOptions({}), { colors: 16, palette: null, outline: null, upscale: 1 });
  assert.deepEqual(pixelOptions({ palette: ['#ff0000', '00ff00'], outline: '101010', upscale: 4 }).palette, [[255, 0, 0], [0, 255, 0]]);
  for (const bad of [{ colors: 1 }, { colors: 65 }, { palette: ['red', 'blue'] }, { palette: ['ff0000'] }, { outline: 'black' }, { upscale: 9 }, { upscale: 1.5 }]) {
    assert.throws(() => pixelOptions(bad), { code: 'bad-argument' }, JSON.stringify(bad));
  }
});

test('export_art pixel: parts, sheet and clip as pixel art on one palette, beside the smooth export, with true pivots', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-pixel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const W = new URL('../examples/showcase/warrior/', import.meta.url);
  for (const f of ['warrior.json', 'warrior.atlas', 'warrior.png', 'warrior_v2.json', 'warrior_v2.atlas', 'warrior.parts.json']) fs.copyFileSync(new URL(f, W), path.join(dir, f));
  /** @type {any[]} */
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: (m) => sent.push(m), all: true });
  const call = async (/** @type {string} */ name, /** @type {object} */ args) => {
    sent.length = 0;
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    return sent[0].result;
  };
  const smooth = (await call('export_art', { file: 'warrior.parts.json', kinds: ['parts'], scales: [0.3] })).structuredContent;
  assert.equal(smooth.error, undefined);
  const r = await call('export_art', { file: 'warrior.parts.json', scales: [0.3], animation: 'run', size: 48, fps: 8, pixel: { colors: 8, upscale: 2, outline: '1d1a24' } });
  assert.ok(!r.isError, r.content?.[0]?.text);
  const out = r.structuredContent;
  assert.deepEqual(out.written, ['pixel/']);
  const root = path.join(dir, 'warrior-export', 'pixel');
  const palette = fs.readFileSync(path.join(root, 'palette.hex'), 'utf8').trim().split('\n');
  assert.ok(palette.length <= 8 && palette.length >= 4, `${palette.length} colours`);
  const allowed = new Set([...palette, '1d1a24']);
  const onPalette = (/** @type {string} */ file) => {
    const img = decodePng(new Uint8Array(fs.readFileSync(path.join(root, file))));
    for (let i = 0; i < img.data.length; i += 4) {
      const a = img.data[i + 3];
      assert.ok(a === 0 || a === 255, `${file}: no partial alpha`);
      if (a) assert.ok(allowed.has(hexOf([img.data[i], img.data[i + 1], img.data[i + 2]])), `${file}: ${hexOf([img.data[i], img.data[i + 1], img.data[i + 2]])} is not on the palette`);
    }
    return img;
  };
  onPalette('warrior@0_3x.png');
  const sheet = onPalette('clip-run@sheet.png');
  assert.ok(sheet.width > 48 * 2, 'clip frames are blown up');
  const map = JSON.parse(fs.readFileSync(path.join(root, 'clip-run@sheet.json'), 'utf8'));
  assert.equal(map.meta.filter, 'nearest');
  assert.equal(Object.values(map.frames)[0].frame.w, 96);
  // Pivots: where a part turns, in its source image, is the smooth export's times the blow-up,
  // shifted by the outline's pixel of room.
  const pixelParts = JSON.parse(fs.readFileSync(path.join(root, 'parts.json'), 'utf8')).parts;
  const smoothParts = JSON.parse(fs.readFileSync(path.join(dir, 'warrior-export', 'parts.json'), 'utf8')).parts;
  for (const name of ['head', 'body', 'forearmFront']) {
    const a = smoothParts[name].png['0_3x'][name], b = pixelParts[name].png['0_3x'][name];
    for (const axis of [0, 1]) assert.ok(Math.abs((b.pivot[axis] + b.trim[axis]) - ((a.pivot[axis] + a.trim[axis]) * 2 + 2)) < 0.05, `${name} pivot ${axis}: ${b.pivot[axis] + b.trim[axis]} vs ${(a.pivot[axis] + a.trim[axis]) * 2 + 2}`);
  }
  assert.ok(rgbOf(palette[0]).length === 3);
  const refused = await call('export_art', { file: 'warrior.parts.json', kinds: ['svg'], pixel: {} });
  assert.ok(refused.isError && /Pixel art/.test(refused.content[0].text));
});
