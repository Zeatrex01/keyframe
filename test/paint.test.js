// Weight painting: a mesh bound to a chain of bones bends smoothly and keeps its setup pose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintWeights, applyPaint, gridFromRegion } from '../src/spine/paint.js';
import { composeDelivery } from '../src/deliver/compose.js';
import { decodeVertices } from '../src/spine/weights.js';
import { checkSkeleton } from '../src/spine/check.js';
import { parseSkeleton, poseSetup, sampleAnimation } from '../src/runtime/index.js';
import { isStudioError } from '../src/shared/errors.js';

// A ribbon 150 long and 30 high lying along a chain of three bones, each 50 long.
const rig = () => ({
  skeleton: { spine: '4.2.43', hash: 'paint-test' },
  bones: [{ name: 'root' }, { name: 'b1', parent: 'root', length: 50 }, { name: 'b2', parent: 'b1', x: 50, length: 50 }, { name: 'b3', parent: 'b2', x: 50, length: 50 }],
  slots: [{ name: 'ribbon', bone: 'b1', attachment: 'ribbon' }],
  skins: [{ name: 'default', attachments: { ribbon: { ribbon: { x: 75, y: 0, width: 150, height: 30 } } } }],
  animations: { bend: { bones: { b2: { rotate: [{ value: 30 }] }, b3: { rotate: [{ value: 30 }] } } } },
});
const setup = async sk => (await poseSetup(await parseSkeleton(sk))).bones;
const worldVertices = (mesh, bones) => decodeVertices(mesh).vertices.map(v => v.influences.reduce((p, e) => {
  const b = bones[e.bone], m = b.matrix;
  return { x: p.x + e.weight * (m.a * e.x + m.b * e.y + b.worldX), y: p.y + e.weight * (m.c * e.x + m.d * e.y + b.worldY) };
}, { x: 0, y: 0 }));

test('a region becomes a grid mesh with the same picture: hull first, corners where the region\'s corners are', () => {
  const g = gridFromRegion({ x: 75, y: 0, width: 150, height: 30 }, 12, 2);
  assert.equal(g.points.length, 13 * 3); assert.equal(g.hull, 2 * 12 + 2 * 2); assert.equal(g.triangles.length, 12 * 2 * 6);
  assert.deepEqual([g.points[0], g.points[12]].map(p => [p.x, p.y]), [[0, 15], [150, 15]]);
  assert.ok(g.uvs.every(u => u >= 0 && u <= 1));
});

test('painted along the chain: the root end follows the first bone, the tip the last, the middle blends', async () => {
  const sk = rig(), bones = await setup(sk);
  const result = paintWeights(sk, { slot: 'ribbon', attachment: 'ribbon', bones: ['b1', 'b2', 'b3'], grid: [12, 2] }, { setupBones: bones });
  assert.equal(result.attachment.type, 'mesh');
  assert.ok(result.report.setupDrift < 1e-3, 'the setup pose moved');
  const decoded = decodeVertices(result.attachment), g = gridFromRegion(sk.skins[0].attachments.ribbon.ribbon, 12, 2);
  const owner = i => decoded.vertices[i].influences.reduce((a, e) => (e.weight > a.weight ? e : a)).bone;
  const index = name => sk.bones.findIndex(b => b.name === name);
  const at = x => g.points.findIndex(p => Math.abs(p.x - x) < 1e-6 && p.y === 15);
  assert.equal(owner(at(0)), index('b1')); assert.equal(owner(at(75)), index('b2')); assert.equal(owner(at(150)), index('b3'));
  assert.ok(decoded.vertices[at(50)].influences.length >= 2, 'the vertex on the joint should blend two bones');
  for (const v of decoded.vertices) assert.ok(Math.abs(v.influences.reduce((a, e) => a + e.weight, 0) - 1) < 1e-4);
  assert.ok(result.report.blendedVertices > 6);
});

test('posed, the ribbon bends as one smooth piece: no edge tears, the tip follows the last bone', async () => {
  const sk = rig(), bones = await setup(sk);
  const painted = applyPaint(sk, paintWeights(sk, { slot: 'ribbon', attachment: 'ribbon', bones: ['b1', 'b2', 'b3'], grid: [12, 2] }, { setupBones: bones }));
  assert.deepEqual(checkSkeleton(painted).filter(f => f.level === 'fatal'), []);
  const data = await parseSkeleton(painted);
  const mesh = painted.skins[0].attachments.ribbon.ribbon;
  const rest = worldVertices(mesh, bones), [posed] = await sampleAnimation(data, 'bend', [0]);
  const bent = worldVertices(mesh, posed.bones), tri = mesh.triangles;
  for (let t = 0; t < tri.length; t += 3) for (const [a, b] of [[tri[t], tri[t + 1]], [tri[t + 1], tri[t + 2]]]) {
    const before = Math.hypot(rest[a].x - rest[b].x, rest[a].y - rest[b].y), after = Math.hypot(bent[a].x - bent[b].x, bent[a].y - bent[b].y);
    assert.ok(after / before < 1.35 && after / before > 0.65, `edge ${a}-${b} stretched ${(after / before).toFixed(2)}x`);
  }
  // the top edge turns gradually: no single step between neighbours turns more than 25 degrees
  const top = [...Array(13).keys()].map(i => bent[i]);
  for (let i = 1; i + 1 < top.length; i++) {
    const a1 = Math.atan2(top[i].y - top[i - 1].y, top[i].x - top[i - 1].x), a2 = Math.atan2(top[i + 1].y - top[i].y, top[i + 1].x - top[i].x);
    assert.ok(Math.abs(a2 - a1) * 180 / Math.PI < 25, `a kink of ${(Math.abs(a2 - a1) * 180 / Math.PI).toFixed(1)} degrees at column ${i}`);
  }
  assert.ok(top[12].y > top[0].y + 40, 'the tip should have lifted with the bend');
});

test('requests that cannot be painted are refused with what to do', async () => {
  const sk = rig(), bones = await setup(sk);
  const refuses = (request, pattern) => assert.throws(() => paintWeights(sk, { slot: 'ribbon', attachment: 'ribbon', ...request }, { setupBones: bones }), e => isStudioError(e) && pattern.test(e.message), JSON.stringify(request));
  refuses({ bones: ['b1'] }, /grid: \[columns, rows\]/);
  refuses({ bones: ['b1', 'nope'], grid: [4, 2] }, /No bone named "nope"/);
  refuses({ bones: ['b1'], grid: [4, 2], maxInfluences: 6 }, /maxInfluences/);
  const painted = applyPaint(sk, paintWeights(sk, { slot: 'ribbon', attachment: 'ribbon', bones: ['b1', 'b2'], grid: [4, 2] }, { setupBones: bones }));
  painted.animations.wobble = { attachments: { default: { ribbon: { ribbon: { deform: [{ time: 0 }] } } } } };
  assert.throws(() => paintWeights(painted, { slot: 'ribbon', attachment: 'ribbon', bones: ['b1'] }, { setupBones: bones }), e => isStudioError(e) && /deform keys/.test(e.message));
});

test('a later animation write keeps the painted mesh, and lets the base win when the owner changed it', async () => {
  const base = rig(), bones = await setup(base);
  const painted = applyPaint(base, paintWeights(base, { slot: 'ribbon', attachment: 'ribbon', bones: ['b1', 'b2', 'b3'], grid: [6, 2] }, { setupBones: bones }), { baseSkeleton: base, baseName: 'rig.json' });
  const clip = { bones: { b2: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 20 }] } } };
  const kept = await composeDelivery({ base, previous: painted, name: 'wave', animation: clip });
  assert.equal(kept.skeleton.skins[0].attachments.ribbon.ribbon.type, 'mesh');
  assert.deepEqual(kept.report.paintedMeshes.kept, ['default/ribbon/ribbon']);
  const changed = rig(); changed.skins[0].attachments.ribbon.ribbon.width = 160;
  const lost = await composeDelivery({ base: changed, previous: painted, name: 'wave', animation: clip });
  assert.equal(lost.skeleton.skins[0].attachments.ribbon.ribbon.type, undefined);
  assert.equal(lost.report.paintedMeshes.dropped[0].reason, 'base-changed');
});
