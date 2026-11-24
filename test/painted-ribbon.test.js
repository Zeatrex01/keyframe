// The LEVEL UP ribbon in test/fixtures/banner (kept from the retired menu icons): one flat
// picture, painted onto a chain of five bones by paint_weights, waving. Checked on the official runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSkeleton, sampleAnimation, poseSetup } from '../src/runtime/index.js';
import { decodeVertices } from '../src/spine/weights.js';
import { checkSkeleton } from '../src/spine/check.js';

const read = name => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/banner/' + name, import.meta.url)), 'utf8'));
const base = read('banner.json'), delivery = read('banner_v2.json');
const mesh = delivery.skins[0].attachments.ribbon.ribbon;
const world = (bones) => decodeVertices(mesh).vertices.map(v => v.influences.reduce((p, e) => {
  const b = bones[e.bone], m = b.matrix;
  return { x: p.x + e.weight * (m.a * e.x + m.b * e.y + b.worldX), y: p.y + e.weight * (m.c * e.x + m.d * e.y + b.worldY) };
}, { x: 0, y: 0 }));

test('the base keeps its flat picture; the delivery carries it as a mesh painted on the five bands', () => {
  assert.equal(base.skins[0].attachments.ribbon.ribbon.type, undefined);
  assert.equal(mesh.type, 'mesh');
  const used = new Set(decodeVertices(mesh).vertices.flatMap(v => v.influences.map(e => delivery.bones[e.bone].name)));
  assert.deepEqual([...used].sort(), ['band1', 'band2', 'band3', 'band4', 'band5']);
  assert.deepEqual(checkSkeleton(delivery).filter(f => f.level === 'fatal'), []);
});

test('in the setup pose the painted ribbon sits exactly where the flat picture was', async () => {
  const bones = (await poseSetup(await parseSkeleton(delivery))).bones;
  const p = world(bones), r = base.skins[0].attachments.ribbon.ribbon;
  const xs = p.map(v => v.x), ys = p.map(v => v.y), body = bones.find(b => b.name === 'ribbon');
  assert.ok(Math.abs(Math.min(...xs) - (body.worldX + r.x - r.width / 2)) < 0.01 && Math.abs(Math.max(...xs) - (body.worldX + r.x + r.width / 2)) < 0.01);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - r.height) < 0.01);
});

test('wave: the ribbon bends into a curve and never tears', async () => {
  const data = await parseSkeleton(delivery), rest = world((await poseSetup(data)).bones);
  const samples = await sampleAnimation(data, 'wave', Array.from({ length: 31 }, (_, i) => +(i / 15).toFixed(4)));
  let deepest = 0;
  for (const s of samples) {
    const p = world(s.bones), tri = mesh.triangles;
    for (let t = 0; t < tri.length; t += 3) for (const [a, b] of [[tri[t], tri[t + 1]], [tri[t + 1], tri[t + 2]]]) {
      const ratio = Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y) / Math.hypot(rest[a].x - rest[b].x, rest[a].y - rest[b].y);
      assert.ok(ratio > 0.6 && ratio < 1.4, `edge ${a}-${b} stretched ${ratio.toFixed(2)}x at ${s.time}s`);
    }
    // how far the top edge leaves the straight line between its two ends
    const top = p.slice(0, 21), [a, b] = [top[0], top[20]], len = Math.hypot(b.x - a.x, b.y - a.y);
    deepest = Math.max(deepest, ...top.map(q => Math.abs((b.x - a.x) * (a.y - q.y) - (a.x - q.x) * (b.y - a.y)) / len));
  }
  assert.ok(deepest > 8, `the ribbon hardly bends (at most ${deepest.toFixed(1)} off straight)`);
});
