// Gate for low-poly models from drawn views (src/render/model.js): the views are read and the
// missing ones mirrored, every shape is closed and faces outward, each face shows the view it
// faces, the .glb reads back with valid accessors and its texture inside, and export_art writes
// the model and shows its preview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateParts } from '../src/render/svg-rig.js';
import { buildModel, encodeGlb, readGlb, readViews, viewOf, viewUV, modelOptions, renderModel } from '../src/render/model.js';
import { encodePng, decodePng } from '../src/render/png.js';
import { exportDrawing } from '../src/render/export-art.js';
import { createServer } from '../src/mcp/server.js';

const S = (w, h, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${b}</svg>`;
// A small car: red side with a blue window, green top, yellow front. Units are centimetres.
const SIDE = S(400, 140, '<path d="M10 100 L20 70 L110 60 L150 20 L280 20 L320 60 L390 70 L395 110 L10 110 Z" fill="#dd2222"/><rect x="160" y="28" width="110" height="30" fill="#2244dd"/><circle cx="90" cy="112" r="26" fill="#222"/><circle cx="320" cy="112" r="26" fill="#222"/>');
const FRONT = S(170, 140, '<path d="M10 110 L10 70 L35 20 L135 20 L160 70 L160 110 Z" fill="#eecc22"/><rect x="5" y="100" width="30" height="40" fill="#222"/><rect x="135" y="100" width="30" height="40" fill="#222"/>');
const TOP = S(170, 400, '<rect x="5" y="5" width="160" height="390" rx="20" fill="#22aa44"/>');
const car = (extra = []) => ({ name: 'car', parts: validateParts([{ name: 'front', at: [0, 0], svg: FRONT }, { name: 'left', at: [300, 0], svg: SIDE }, { name: 'top', at: [600, 0], svg: TOP }, ...extra]) });

/** Signed volume of the closed mesh (positive when every face points outward). */
function volume(m) {
  let v = 0;
  const P = i => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [P(m.indices[t]), P(m.indices[t + 1]), P(m.indices[t + 2])];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

test('views: front, a side and top are enough; the rest are mirrored; the box comes from them', () => {
  const v = readViews(car());
  assert.deepEqual(v.box, [170, 140, 400]);
  assert.equal(v.source.front, 'drawn');
  assert.equal(v.source.right, 'mirrored left');
  assert.equal(v.source.bottom, 'mirrored top');
  assert.throws(() => readViews({ name: 'x', parts: validateParts([{ name: 'front', at: [0, 0], svg: FRONT }]) }), /needs a part named left/);
  assert.throws(() => modelOptions({ shape: 'sphere' }), /shape is box, round, hull/);
  assert.throws(() => modelOptions({ colour: 1 }), /not a model setting/);
});

test('conventions: +Z is the front, +X the left; each normal picks its view', () => {
  assert.equal(viewOf([0, 0, 1]), 'front');
  assert.equal(viewOf([1, 0.2, 0]), 'left');
  assert.equal(viewOf([-1, 0, 0.3]), 'right');
  assert.equal(viewOf([0.1, 0.9, 0.2]), 'top');
  const box = [2, 2, 4];
  assert.deepEqual(viewUV('left', [1, 2, 2], box), [0, 0], 'the left view has the nose on the left');
  assert.deepEqual(viewUV('right', [-1, 2, 2], box), [1, 0], 'the right view has the nose on the right');
  assert.deepEqual(viewUV('top', [-1, 0, 2], box), [1, 0], 'from above, nose up, the right side on the right');
});

test('every shape is closed, faces outward and stays low-poly', () => {
  for (const shape of ['box', 'round', 'hull']) {
    const m = buildModel(car(), { shape });
    assert.ok(volume(m) > 0, `${shape} faces outward`);
    assert.ok(m.triangles >= 12 && m.triangles <= 400, `${shape} has ${m.triangles} triangles`);
    assert.deepEqual(m.size, [1.7, 1.4, 4], `${shape} is sized in metres (1 unit = 1 cm)`);
  }
  const box = buildModel(car(), { shape: 'box' });
  assert.ok(Math.abs(volume(box) - 1.7 * 1.4 * 4) < 1e-3, 'the box fills the model box');
  const hull = buildModel(car(), { shape: 'hull' });
  assert.ok(volume(hull) < volume(box) * 0.85, 'the hull follows the outlines, smaller than the box');
  // The hull follows the side outline: lower over the bonnet (front) than over the roof.
  let nose = 0, roof = 0;
  for (let i = 0; i < hull.positions.length; i += 3) {
    const y = hull.positions[i + 1], z = hull.positions[i + 2];
    if (z > 1.4) nose = Math.max(nose, y);
    roof = Math.max(roof, y);
  }
  assert.ok(nose < roof - 0.3, `the bonnet (${nose}) sits below the roof (${roof})`);
  const round = buildModel(car(), { shape: 'round', sides: 6 });
  assert.ok(round.triangles < buildModel(car(), { shape: 'round', sides: 12 }).triangles, 'fewer sides, fewer triangles');
});

test('each face is painted with the view it faces', () => {
  const m = buildModel(car(), { shape: 'box', smooth: 0, lit: false });
  const tex = m.texture;
  const colourAt = (u, v) => { const x = Math.min(tex.width - 1, Math.floor(u * tex.width)), y = Math.min(tex.height - 1, Math.floor(v * tex.height)); return [...tex.data.subarray((y * tex.width + x) * 4, (y * tex.width + x) * 4 + 4)]; };
  const seen = {};
  for (let t = 0; t < m.indices.length; t += 3) {
    const ids = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const n = [m.normals[ids[0] * 3], m.normals[ids[0] * 3 + 1], m.normals[ids[0] * 3 + 2]];
    const u = ids.reduce((s, i) => s + m.uvs[i * 2], 0) / 3, v = ids.reduce((s, i) => s + m.uvs[i * 2 + 1], 0) / 3;
    (seen[viewOf(n)] ??= []).push(colourAt(u, v));
  }
  assert.ok(seen.top.every(c => c[1] > 120 && c[0] < 100), 'the roof shows the green top');
  assert.ok(seen.front.some(c => c[0] > 180 && c[1] > 150 && c[2] < 100), 'the nose shows the yellow front');
  assert.ok(seen.left.some(c => c[0] > 150 && c[1] < 80) && seen.right.some(c => c[0] > 150 && c[1] < 80), 'both sides show the red side');
  assert.ok(seen.bottom.every(c => c[1] < 100), 'the mirrored bottom is darkened');
  // Clear pixels are filled: every face samples an opaque texel, never the background.
  assert.ok(Object.values(seen).flat().every(c => c[3] === 255));
  // The studio's own preview sees the car from the side it is turned to.
  const side = renderModel(m, { yaw: 0, pitch: 0, size: 64 });
  const mid = [...side.data.subarray((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 3)];
  assert.ok(mid[0] > 150 && mid[1] < 80, 'turned nose-right, the side is red');
});

test('the .glb reads back: accessors, bounds, texture and sampler', () => {
  const m = buildModel(car(), { shape: 'hull', filter: 'nearest', lit: false });
  const png = encodePng(m.texture);
  const glb = encodeGlb(m, png);
  assert.equal(glb.length % 4, 0);
  const { json, bin } = readGlb(glb);
  assert.equal(json.asset.version, '2.0');
  const prim = json.meshes[0].primitives[0];
  const pos = json.accessors[prim.attributes.POSITION];
  assert.equal(pos.count, m.vertices);
  assert.ok(pos.max[2] > 1.8 && pos.max[2] <= 2 && pos.min[2] < -1.8 && pos.min[1] < 0.05, 'nose towards +Z, tail at -Z, wheels on the ground');
  assert.equal(json.accessors[prim.indices].count, m.triangles * 3);
  for (const bv of json.bufferViews) assert.ok(bv.byteOffset + bv.byteLength <= bin.length && bv.byteOffset % 4 === 0);
  const img = json.bufferViews[json.images[0].bufferView];
  const inside = decodePng(bin.subarray(img.byteOffset, img.byteOffset + img.byteLength));
  assert.equal(inside.width, m.texture.width);
  assert.equal(json.samplers[0].magFilter, 9728, 'nearest');
  assert.deepEqual(json.extensionsUsed, ['KHR_materials_unlit']);
  const idx = new Uint16Array(bin.buffer.slice(bin.byteOffset + json.bufferViews[3].byteOffset, bin.byteOffset + json.bufferViews[3].byteOffset + json.bufferViews[3].byteLength));
  assert.ok(Math.max(...idx) < m.vertices, 'every index points at a vertex');
});

test('export_art kind model writes the model beside the drawing and shows its preview', async () => {
  const files = exportDrawing(car(), { kinds: ['model'], model: { shape: 'round' } }).files;
  assert.ok(files['model/car.glb'] && files['model/car_texture.png'] && files['model/car_preview.png']);
  assert.equal(JSON.parse(files['model/model.json']).shape, 'round');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-model-'));
  try {
    fs.writeFileSync(path.join(dir, 'car.parts.json'), JSON.stringify({ format: 'keyframe-parts/1', ...car() }));
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'car.parts.json'), 'utf8'));
    const { PARTS_FORMAT } = await import('../src/render/svg-rig.js');
    doc.format = PARTS_FORMAT;
    fs.writeFileSync(path.join(dir, 'car.parts.json'), JSON.stringify(doc));
    const sent = [];
    const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: msg => sent.push(msg) });
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'export_art', arguments: { file: 'car.parts.json', kinds: ['model'], model: { shape: 'hull', texture: 64 } } } });
    const res = sent.at(-1).result;
    assert.ok(!res.isError, JSON.stringify(res.content?.[0]));
    assert.ok(res.content.some(c => c.type === 'image'), 'the preview comes back to look at');
    assert.ok(fs.existsSync(path.join(dir, 'car-export', 'model', 'car.glb')));
    await wire.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'export_art', arguments: { file: 'car.parts.json', kinds: ['model'], model: { shape: 'cone' } } } });
    assert.ok(sent.at(-1).result.isError, 'a bad shape is refused');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
