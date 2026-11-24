// Gate for src/render: PNG codec, rasterizer and headless frames (ADR-3).
// Pixel cases are built so the expected value is exact, not eyeballed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePng, encodePng } from '../src/render/png.js';
import { createCanvas, prepareTexture, drawTriangles, toImage, BLEND } from '../src/render/raster.js';
import { renderFrames, filmstrip } from '../src/render/frames.js';
import { createPoser, parseSkeleton } from '../src/runtime/index.js';
import { needsSpine } from './helpers/spine-addon.js';
import { isStudioError } from '../src/shared/errors.js';

const px = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const solid = (w, h, rgba) => ({ width: w, height: h, data: Uint8Array.from({ length: w * h * 4 }, (_, i) => rgba[i % 4]) });

// ── PNG ──

// Minimal PNG writer for colour types the encoder does not produce.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0); out.write(type, 4, 'ascii'); Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}
function png({ width, height, bitDepth, colorType, rows, plte, trns, interlace = 0 }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[12] = interlace;
  const raw = Buffer.concat(rows.map(r => Buffer.from([0, ...r])));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    ...(plte ? [chunk('PLTE', Buffer.from(plte))] : []), ...(trns ? [chunk('tRNS', Buffer.from(trns))] : []),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

test('PNG: encode then decode is lossless, and a real atlas page decodes to its header size', () => {
  const image = { width: 3, height: 2, data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]) };
  assert.deepEqual(decodePng(encodePng(image)), image);
  const bytes = new Uint8Array(fs.readFileSync(new URL('./fixtures/ident/ident.png', import.meta.url)));
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const decoded = decodePng(bytes);
  assert.equal(decoded.width, view.getUint32(16));
  assert.equal(decoded.height, view.getUint32(20));
  assert.equal(decoded.data.length, decoded.width * decoded.height * 4);
});

test('PNG: palette with tRNS, grey at 4 bits, RGB with a transparent key colour', () => {
  const pal = decodePng(png({ width: 2, height: 1, bitDepth: 8, colorType: 3, rows: [[0, 1]], plte: [255, 0, 0, 0, 0, 255], trns: [0] }));
  assert.deepEqual(px(pal, 0, 0), [255, 0, 0, 0]);
  assert.deepEqual(px(pal, 1, 0), [0, 0, 255, 255]);
  const grey = decodePng(png({ width: 2, height: 1, bitDepth: 4, colorType: 0, rows: [[0xf0]] }));
  assert.deepEqual(px(grey, 0, 0), [255, 255, 255, 255]);
  assert.deepEqual(px(grey, 1, 0), [0, 0, 0, 255]);
  const rgb = decodePng(png({ width: 2, height: 1, bitDepth: 8, colorType: 2, rows: [[1, 2, 3, 9, 9, 9]], trns: [0, 9, 0, 9, 0, 9] }));
  assert.deepEqual(px(rgb, 0, 0), [1, 2, 3, 255]);
  assert.deepEqual(px(rgb, 1, 0), [9, 9, 9, 0]);
});

test('PNG: refusals are coded, never a garbage image', () => {
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3])), err => isStudioError(err, 'png-signature'));
  assert.throws(() => decodePng(png({ width: 1, height: 1, bitDepth: 8, colorType: 6, rows: [[1, 2, 3, 4]], interlace: 1 })),
    err => isStudioError(err, 'png-interlaced'));
  assert.throws(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) }), err => isStudioError(err, 'bad-argument'));
});

// ── raster ──

const QUAD = [0, 1, 2, 2, 3, 0];
const square = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s];
const FULL_UV = [0, 0, 1, 0, 1, 1, 0, 1];
const WHITE = { r: 1, g: 1, b: 1, a: 1 };

test('a texture mapped 1:1 onto pixels reproduces every texel exactly', () => {
  const tex = { width: 2, height: 2, data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]) };
  const canvas = createCanvas(2, 2);
  drawTriangles(canvas, { positions: square(0, 0, 2), uvs: FULL_UV, indices: QUAD, texture: prepareTexture(tex, false), light: WHITE });
  const image = toImage(canvas);
  assert.deepEqual([px(image, 0, 0), px(image, 1, 0), px(image, 0, 1), px(image, 1, 1)],
    [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]]);
});

test('shared triangle edges are filled once: a quad over a half-transparent texture has no seam', () => {
  const canvas = createCanvas(8, 8);
  drawTriangles(canvas, { positions: square(0, 0, 8), uvs: FULL_UV, indices: QUAD,
    texture: prepareTexture(solid(1, 1, [255, 255, 255, 128]), false), light: WHITE });
  const alphas = new Set(Array.from({ length: 64 }, (_, i) => toImage(canvas).data[i * 4 + 3]));
  assert.deepEqual([...alphas], [128]);
});

test('light tint multiplies, straight and premultiplied textures give the same pixel', () => {
  const straight = solid(1, 1, [200, 100, 50, 128]);
  const pma = solid(1, 1, [Math.round(200 * 128 / 255), Math.round(100 * 128 / 255), Math.round(50 * 128 / 255), 128]);
  const draw = (tex, isPma, light) => {
    const canvas = createCanvas(1, 1);
    drawTriangles(canvas, { positions: square(0, 0, 1), uvs: FULL_UV, indices: QUAD, texture: prepareTexture(tex, isPma), light });
    return px(toImage(canvas), 0, 0);
  };
  const a = draw(straight, false, WHITE), b = draw(pma, true, WHITE);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 2, `channel ${i}: ${v} vs ${b[i]}`));
  assert.deepEqual(draw(solid(1, 1, [255, 255, 255, 255]), false, { r: 0.5, g: 1, b: 0, a: 1 }), [128, 255, 0, 255]);
  assert.deepEqual(draw(solid(1, 1, [255, 255, 255, 255]), false, { r: 1, g: 1, b: 1, a: 0.5 }), [255, 255, 255, 128]);
});

test('blend modes follow the spine-webgl equations', () => {
  const over = (blend, top, bottom = [0.5, 0.5, 0.5, 1]) => {
    const canvas = createCanvas(1, 1);
    canvas.data.set(bottom);
    drawTriangles(canvas, { positions: square(0, 0, 1), uvs: FULL_UV, indices: QUAD,
      texture: prepareTexture(solid(1, 1, top), false), light: WHITE, blend });
    return Array.from(canvas.data).map(v => Math.round(v * 1000) / 1000);
  };
  assert.deepEqual(over(BLEND.normal, [255, 0, 0, 255]), [1, 0, 0, 1]);
  assert.deepEqual(over(BLEND.additive, [102, 102, 102, 255]), [0.9, 0.9, 0.9, 1]);
  assert.deepEqual(over(BLEND.multiply, [128, 255, 0, 255]), [0.251, 0.5, 0, 1]);
  assert.deepEqual(over(BLEND.screen, [128, 0, 255, 255]), [0.751, 0.5, 1, 1]); // 128/255 + 0.5 * (1 - 128/255)
});

test('a two-colour tint maps black texels to the dark colour and white texels to the light colour', () => {
  const tex = { width: 2, height: 1, data: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]) };
  const canvas = createCanvas(2, 1);
  drawTriangles(canvas, { positions: [0, 0, 2, 0, 2, 1, 0, 1], uvs: FULL_UV, indices: QUAD, texture: prepareTexture(tex, false),
    light: { r: 1, g: 1, b: 0, a: 1 }, dark: { r: 0, g: 0, b: 1 } });
  const image = toImage(canvas);
  assert.deepEqual(px(image, 0, 0), [0, 0, 255, 255]);
  assert.deepEqual(px(image, 1, 0), [255, 255, 0, 255]);
});

// ── frames ──

function boxSkeleton(extra = {}) {
  return {
    skeleton: { spine: '4.2.43', hash: 'r' },
    bones: [{ name: 'root' }, { name: 'mover', parent: 'root' }],
    slots: [{ name: 'box', bone: 'mover', attachment: 'tile' }],
    skins: [{ name: 'default', attachments: { box: { tile: { width: 10, height: 10 } } } }],
    animations: { slide: { bones: { mover: { translate: [{ x: -20, y: 0 }, { time: 1, x: 20, y: 0 }] } } } },
    ...extra,
  };
}
const TILE_ATLAS = 'tile.png\nsize:4,4\nfilter:Nearest,Nearest\ntile\nbounds:0,0,4,4\n';
const TILE_PAGE = { 'tile.png': solid(4, 4, [255, 255, 255, 255]) };
const VIEW = { x: -40, y: -20, width: 80, height: 40 };

function opaqueCentroid(image) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] > 127) { sx += x; sy += y; n++; }
  }
  return n ? { x: sx / n, y: sy / n, n } : null;
}

test('a moving bone moves the pixels: the box is where the runtime says it is', async () => {
  const { frames } = await renderFrames({ json: boxSkeleton(), atlasText: TILE_ATLAS, pages: TILE_PAGE, animation: 'slide',
    times: [0, 0.5, 1], width: 80, height: 40, margin: 0, viewport: VIEW, supersample: 1 });
  const [a, b, c] = frames.map(f => opaqueCentroid(f.image));
  // 1 world unit = 1 pixel here; world x -20, 0, +20 map to pixel centres 19.5, 39.5, 59.5.
  assert.ok(Math.abs(a.x - 19.5) < 0.6 && Math.abs(b.x - 39.5) < 0.6 && Math.abs(c.x - 59.5) < 0.6, JSON.stringify([a, b, c]));
  assert.ok(Math.abs(a.y - 19.5) < 0.6, 'world y 0 is the middle row');
  assert.equal(a.n, 100, 'a 10 x 10 region covers exactly 100 pixels');
});

test('Spine is y-up: a box moved up lands in the upper half of the image', async () => {
  const json = boxSkeleton({ animations: { lift: { bones: { mover: { translate: [{ x: 0, y: 12 }] } } } } });
  const { frames } = await renderFrames({ json, atlasText: TILE_ATLAS, pages: TILE_PAGE, animation: 'lift',
    times: [0], width: 80, height: 40, margin: 0, viewport: VIEW, supersample: 1 });
  const c = opaqueCentroid(frames[0].image);
  assert.ok(Math.abs(c.y - 7.5) < 0.6, `world y +12 is 12 px above the middle row (got ${c.y})`);
});

test('slot colour reaches the pixels: half alpha and an rgba fade', async () => {
  const json = boxSkeleton({
    slots: [{ name: 'box', bone: 'mover', attachment: 'tile', color: 'ff000080' }],
    animations: { fade: { slots: { box: { rgba: [{ color: 'ffffff00' }, { time: 1, color: 'ffffffff' }] } } } },
  });
  const opts = { json, atlasText: TILE_ATLAS, pages: TILE_PAGE, width: 80, height: 40, margin: 0, viewport: VIEW, supersample: 1 };
  const setupTint = boxSkeleton({ slots: [{ name: 'box', bone: 'mover', attachment: 'tile', color: 'ff000080' }],
    animations: { still: { bones: { mover: { translate: [{ x: 0, y: 0 }] } } } } });
  const still = await renderFrames({ ...opts, json: setupTint, animation: 'still', times: [0] });
  assert.deepEqual(px(still.frames[0].image, 40, 20), [255, 0, 0, 128], 'setup slot colour ff000080');
  const fade = await renderFrames({ ...opts, animation: 'fade', times: [0, 0.5, 1] });
  const alphaAt = f => px(f.image, 40, 20)[3];
  assert.deepEqual(fade.frames.map(alphaAt), [0, 128, 255]);
});

test('a clipping attachment cuts what follows it in draw order', async () => {
  const json = boxSkeleton({
    slots: [{ name: 'clip', bone: 'root', attachment: 'mask' }, { name: 'box', bone: 'mover', attachment: 'tile' }],
    skins: [{ name: 'default', attachments: {
      clip: { mask: { type: 'clipping', end: 'box', vertexCount: 4, vertices: [-40, -20, 0, -20, 0, 20, -40, 20] } },
      box: { tile: { width: 10, height: 10 } },
    } }],
  });
  const { frames } = await renderFrames({ json, atlasText: TILE_ATLAS, pages: TILE_PAGE, animation: 'slide',
    times: [0.5], width: 80, height: 40, margin: 0, viewport: VIEW, supersample: 1 });
  const c = opaqueCentroid(frames[0].image);
  assert.equal(c.n, 50, 'only the left half of the box survives the mask at x <= 0');
  assert.ok(c.x < 40, JSON.stringify(c));
});

test('the same quad as a region and as a mesh renders identically', async () => {
  const mesh = boxSkeleton({ skins: [{ name: 'default', attachments: { box: { tile: {
    type: 'mesh', uvs: [1, 1, 0, 1, 0, 0, 1, 0], triangles: [1, 2, 3, 1, 3, 0], hull: 4,
    vertices: [5, -5, -5, -5, -5, 5, 5, 5], width: 10, height: 10 } } } }] });
  const opts = { atlasText: TILE_ATLAS, pages: TILE_PAGE, animation: 'slide', times: [0.25, 0.75], width: 80, height: 40, viewport: VIEW, supersample: 2 };
  const region = await renderFrames({ json: boxSkeleton(), ...opts });
  const meshed = await renderFrames({ json: mesh, ...opts });
  region.frames.forEach((f, i) => assert.deepEqual(f.image.data, meshed.frames[i].image.data, `frame ${i}`));
});

test('rendering is deterministic and a missing page is refused by name', async () => {
  const json = JSON.parse(fs.readFileSync(new URL('./fixtures/nova/nova.json', import.meta.url), 'utf8'));
  const atlasText = fs.readFileSync(new URL('./fixtures/nova/nova.atlas', import.meta.url), 'utf8');
  const page = atlasText.split(/\r?\n/).find(l => l.trim()).trim();
  const pages = { [page]: decodePng(new Uint8Array(fs.readFileSync(new URL(`./fixtures/nova/${page}`, import.meta.url)))) };
  const animation = Object.keys(json.animations)[0];
  const opts = { json, atlasText, pages, animation, times: [0, 1.5, 3], width: 96, height: 48 };
  const first = await renderFrames(opts);
  const second = await renderFrames(opts);
  first.frames.forEach((f, i) => assert.deepEqual(f.image.data, second.frames[i].image.data));
  const coverage = f => opaqueCentroid(f.image)?.n ?? 0;
  assert.ok(coverage(first.frames[2]) > coverage(first.frames[0]), 'the intro reveals the logo over time');
  await assert.rejects(renderFrames({ ...opts, pages: {} }), err => isStudioError(err, 'missing-page') && err.details.page === page);
});

test('a filmstrip lays frames out in a grid with gaps', () => {
  const a = solid(2, 2, [255, 0, 0, 255]), b = solid(2, 2, [0, 255, 0, 255]), c = solid(2, 2, [0, 0, 255, 255]);
  const strip = filmstrip([a, b, c], { columns: 2, gap: 1 });
  assert.equal(strip.width, 5); assert.equal(strip.height, 5);
  assert.deepEqual(px(strip, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(strip, 3, 0), [0, 255, 0, 255]);
  assert.deepEqual(px(strip, 0, 3), [0, 0, 255, 255]);
  assert.deepEqual(px(strip, 2, 0), [0, 0, 0, 0], 'the gap stays background');
  assert.throws(() => filmstrip([a, solid(3, 3, [0, 0, 0, 0])]), err => isStudioError(err, 'bad-argument'));
});

test('the official poser only moves forward (its physics is stateful)', needsSpine, async () => {
  const data = await parseSkeleton(boxSkeleton(), { backend: 'spine' });
  const poser = await createPoser(data, 'slide');
  poser.at(0.5);
  assert.throws(() => poser.at(0.2), err => isStudioError(err, 'bad-argument'));
  assert.doesNotThrow(() => poser.at(0.5));
});

test('the engine poser is stateless: any instant, in any order, gives the same pose', async () => {
  const data = await parseSkeleton(boxSkeleton(), { backend: 'keyframe' });
  const poser = await createPoser(data, 'slide');
  const late = poser.at(0.5).snapshot();
  poser.at(0.2);
  assert.deepEqual(poser.at(0.5).snapshot(), late);
  assert.throws(() => poser.at(-1), err => isStudioError(err, 'bad-argument'));
});
