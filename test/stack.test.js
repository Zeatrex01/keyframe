// Gate for sprite stacking (src/render/stack.js): parts with a height band are cut into one slice
// per pixel of height, tapered along the band, shaded near the ground, piled and turned; export_art
// writes the strip an engine stacks, the pre-turned sheet, and the Godot node, and shows the turns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateParts } from '../src/render/svg-rig.js';
import { stackSlices, drawStack, turnFrames, bandOf } from '../src/render/stack.js';
import { exportDrawing, stackGrid, MAX_STRIP_SIDE } from '../src/render/export-art.js';
import { decodePng } from '../src/render/png.js';
import { createServer } from '../src/mcp/server.js';

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const CAR = [
  { name: 'wheels', at: [0, 0], stack: [0, 3], svg: svg(40, 20, '<rect x="5" y="0" width="8" height="20" fill="#202020"/><rect x="27" y="0" width="8" height="20" fill="#202020"/>') },
  { name: 'body', at: [0, 0], stack: [2, 9], svg: svg(40, 20, '<rect x="1" y="2" width="38" height="16" rx="4" fill="#e05050"/>') },
  { name: 'roof', at: [0, 0], stack: [9, 12], svg: svg(40, 20, '<rect x="10" y="4" width="20" height="12" fill="#3050a0"/>') },
  { name: 'crown', at: [40, 0], stack: [0, 10], taper: [1, 0.2], svg: svg(20, 20, '<circle cx="10" cy="10" r="10" fill="#40a060"/>') },
];
const doc = () => ({ name: 'car', parts: validateParts(CAR) });
const opaque = img => { let n = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 127) n++; return n; };
const pixel = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test('a part keeps its height band; a bad band or a taper without one is refused', () => {
  const parts = validateParts(CAR);
  assert.deepEqual(parts[0].stack, [0, 3]);
  assert.deepEqual(parts[3].taper, [1, 0.2]);
  assert.deepEqual(bandOf(parts[3]), { from: 0, to: 10, taper: [1, 0.2] });
  assert.equal(bandOf({ name: 'flat' }), null, 'a part without a band stays flat');
  assert.throws(() => validateParts([{ ...CAR[0], stack: [3, 1] }]), /stack is \[from, to\]/);
  assert.throws(() => validateParts([{ ...CAR[0], stack: undefined, taper: [1, 0.5] }]), /taper needs stack/);
});

test('one slice per pixel of height; each slice shows only the bands it cuts, tapered and shaded', () => {
  const s = stackSlices(doc(), { scale: 2 });
  assert.equal(s.slices.length, 24, '12 units high at 2 px per unit');
  const [w, h] = s.size;
  assert.ok(w >= 120 && h >= 40);
  const [px, py] = s.pivot;
  // Wheels only near the ground: the car's centre column at the wheel x is dark on slice 0, empty on the roof.
  const wheelX = Math.round(px + (-11) * 2), midY = Math.round(py);
  assert.ok(pixel(s.slices[0], wheelX, midY)[3] > 200, 'a wheel in the ground slice');
  assert.equal(pixel(s.slices[22], wheelX, midY)[3], 0, 'no wheel at the roof');
  const roofX = Math.round(px);
  assert.ok(pixel(s.slices[22], roofX, midY)[2] > pixel(s.slices[22], roofX, midY)[0], 'the roof is blue');
  assert.ok(pixel(s.slices[10], roofX, midY)[0] > 150, 'the body is red half way up');
  // The crown tapers: fewer pixels near its top than at its bottom.
  const crown = img => { let n = 0; for (let y = 0; y < img.height; y++) for (let x = Math.round(px + 31 * 2); x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3] > 127) n++; return n; };
  assert.ok(crown(s.slices[18]) < crown(s.slices[1]) * 0.25, 'tapered to a fifth');
  // Contact shade: the same body cut is darker near the ground.
  const flat = stackSlices(doc(), { scale: 2, shade: 0 });
  assert.ok(pixel(flat.slices[5], roofX, midY)[0] > pixel(s.slices[5], roofX, midY)[0], 'shade darkens the low slices');
});

test('the pile rises up the screen and turns with its angle', () => {
  const s = stackSlices(doc(), { scale: 2 });
  const top = img => { for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3] > 127) return y; return -1; };
  const all = drawStack(s, { frame: [260, 300] }), tall = drawStack(s, { frame: [260, 300], spacing: 2 });
  assert.ok(top(all.image) - top(tall.image) >= 20, 'every slice `spacing` pixels above the last');
  const turned = drawStack(s, { angle: Math.PI / 2, frame: [260, 300] });
  assert.notDeepEqual(turned.image.data, all.image.data, 'it turns');
  const t = turnFrames(s, 8);
  assert.equal(t.frames.length, 8);
  assert.ok(t.frames.every(f => f.image.width === t.frame[0] && f.image.height === t.frame[1]), 'every turn in a frame of one size');
  assert.deepEqual(t.degrees.slice(0, 3), [0, 45, 90]);
});

test('export: a strip of slices bottom first with its pivot, a turn sheet with angles', () => {
  const { files } = exportDrawing(doc(), { scales: [2], kinds: ['stack'], turns: 8 });
  const map = JSON.parse(String(files['stack@2x.json']));
  const strip = decodePng(files['stack@2x.png']);
  assert.equal(map.meta.slices, 24);
  assert.equal(strip.width, map.meta.slices * map.meta.slice.w, 'one row of slices');
  assert.equal(strip.height, map.meta.slice.h);
  assert.ok(opaque(strip) > 0);
  const turns = JSON.parse(String(files['turn@2x.json']));
  assert.equal(Object.keys(turns.frames).length, 8);
  assert.equal(turns.frames.car_02.angle, 90);
  assert.ok(decodePng(files['turn@2x.png']).width > 0);
  assert.equal(files['car@2x.png'], undefined, 'only what was asked');
});

test('a long strip wraps into rows under the texture side limit; the Godot node reads the rows', () => {
  assert.deepEqual(stackGrid(24, 100, 80), { columns: 24, rows: 1 }, 'a short stack stays one row');
  const ferry = stackGrid(64, 530, 300);
  assert.ok(ferry.rows > 1 && ferry.columns * 530 <= MAX_STRIP_SIDE, 'a ferry wraps');
  assert.ok(ferry.columns * ferry.rows >= 64, 'every slice has a cell');
  assert.throws(() => stackGrid(4000, 4000, 4000), /too big/);
  // A real export with the side limit set low enough to wrap: cells in rows, read left to right.
  const { files } = exportDrawing(doc(), { scales: [2], kinds: ['stack'], turns: 4, maxSide: 500 });
  const map = JSON.parse(String(files['stack@2x.json']));
  assert.ok(map.meta.rows > 1, 'it wrapped');
  assert.ok(map.meta.columns * map.meta.rows >= map.meta.slices);
  const one = JSON.parse(String(exportDrawing(doc(), { scales: [2], kinds: ['stack'], turns: 4 }).files['stack@2x.json']));
  const flat = decodePng(exportDrawing(doc(), { scales: [2], kinds: ['stack'], turns: 4 }).files['stack@2x.png']);
  const cell = (img, i, cols) => { const ox = (i % cols) * one.meta.slice.w, oy = Math.floor(i / cols) * one.meta.slice.h; let n = 0;
    for (let y = 0; y < one.meta.slice.h; y++) for (let x = 0; x < one.meta.slice.w; x++) n += img.data[((oy + y) * img.width + ox + x) * 4 + 3]; return n; };
  const strip = decodePng(files['stack@2x.png']);
  assert.equal(strip.width, map.meta.columns * map.meta.slice.w);
  assert.equal(strip.height, map.meta.rows * map.meta.slice.h);
  for (const i of [0, 5, map.meta.slices - 1]) assert.equal(cell(strip, i, map.meta.columns), cell(flat, i, one.meta.columns), `slice ${i} is the same in rows`);
  const node = fs.readFileSync(new URL('../integrations/godot/addons/keyframe/keyframe_stack.gd', import.meta.url), 'utf8');
  assert.match(node, /i % _columns/, 'the node finds a slice by column and row');
  assert.match(node, /meta\.get\("columns"/);
});

test('export_art exports a stacked drawing by default with the Godot node and shows the turns', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-stack-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
  const call = async (name, args) => { sent.length = 0; await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); const r = sent[0].result;
    if (r.structuredContent) return r.structuredContent;
    const image = r.content?.find(c => c.type === 'image'), text = r.content?.find(c => c.type === 'text');
    return image ? { image, meta: JSON.parse(text.text) } : JSON.parse(text?.text ?? 'null'); };
  try {
    const drawn = await call('draw_rig', { name: 'car', as: 'artboard', parts: CAR });
    assert.equal(drawn.error, undefined, JSON.stringify(drawn));
    const e = await call('export_art', { file: 'car.parts.json', scales: [2], turns: 8 });
    assert.equal(e.image?.mimeType, 'image/png', 'the turns come back to look at');
    const out = path.join(dir, 'car-export');
    for (const f of ['stack@2x.png', 'stack@2x.json', 'turn@2x.png', 'turn@2x.json', 'godot/keyframe_stack.gd', 'car@2x.png']) assert.ok(fs.existsSync(path.join(out, f)), f);
    const node = fs.readFileSync(path.join(out, 'godot/keyframe_stack.gd'), 'utf8');
    assert.match(node, /class_name KeyframeStack/);
    assert.match(node, /draw_texture_rect_region/);
    const flat = await call('draw_rig', { name: 'flat', as: 'artboard', parts: [{ name: 'a', at: [0, 0], svg: svg(10, 10, '<rect width="10" height="10"/>') }] });
    assert.equal(flat.error, undefined);
    const refused = await call('export_art', { file: 'flat.parts.json', kinds: ['stack'] });
    assert.match(JSON.stringify(refused), /height band/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
