// Gate for src/spine/weights.js: weights must be read exactly, or not reported at all.
// Ported from legacy test_weight.js.
//
// A measuring tool cannot corrupt a file; it can only lie. So the gate asks three things:
//   1. Does the decoder round-trip? decode -> encode must return the original array, byte
//      for byte, on a real file. A decoder that cannot rebuild what it read is a rewrite,
//      and every number it prints is a guess.
//   2. Does it stay silent when it does not understand? Malformed input must be named,
//      never interpolated into plausible numbers.
//   3. Does it catch the faults a viewer does not see at a glance? Drifted sums, dead zero
//      links, bone indices out of range.
// Where a finding's level rests on what the official runtime does, the runtime is asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isWeighted, decodeVertices, encodeVertices, listMeshes, weightReport, signature, MAX_GPU_INFLUENCES } from '../src/spine/weights.js';
import { loadRuntime, parseSkeleton } from '../src/runtime/index.js';
import { needsSpine } from './helpers/spine-addon.js';
import { compileSkeleton, attachmentWorldVertices } from '../src/engine/index.js';

const FIXTURE = new URL('./fixtures/weights/weighted_sample.json', import.meta.url);
const readFixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const J = v => JSON.stringify(v);

// Synthetic rig: a weighted and an unweighted mesh side by side, with deliberate defects.
const synthetic = () => ({
  skeleton: { spine: '4.2.43', hash: 'w', images: './' },
  bones: [{ name: 'root' }, { name: 'a', parent: 'root' }, { name: 'b', parent: 'a' }],
  slots: [{ name: 'sa', bone: 'a', attachment: 'm1' }, { name: 'sb', bone: 'b', attachment: 'm2' }],
  skins: [{ name: 'default', attachments: {
    sa: { m1: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 2, 3, 0], hull: 4,
      // 4 vertices: one bone; two bones summing to 1; two bones summing to 0.8 (defect);
      // two bones, one with weight 0 (defect).
      vertices: [
        1, 1, -5, -5, 1,
        2, 1, 5, -5, 0.6, 2, 5, -5, 0.4,
        2, 1, 5, 5, 0.5, 2, 5, 5, 0.3,
        2, 1, -5, 5, 1, 2, -5, 5, 0,
      ] } },
    sb: { m2: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 2, 3, 0], hull: 4,
      vertices: [-4, -4, 4, -4, 4, 4, -4, 4] } }, // unweighted
  } }],
  animations: {},
});

// A one-mesh skeleton around a raw vertices array, for the malformed and edge cases.
const oneMesh = (vertices, uvs = [0, 0, 1, 1], bones = [{ name: 'root' }]) => ({
  skeleton: { spine: '4.2.43', hash: 'm' }, bones,
  slots: [{ name: 's', bone: 'root', attachment: 'm' }],
  skins: [{ name: 'default', attachments: { s: { m: { type: 'mesh', uvs, triangles: [0, 1, 0], hull: uvs.length / 2, vertices } } } }],
});

// World vertices of slot "s" at the setup pose, from the studio's engine (held to the official
// runtime by test/engine.test.js).
async function runtimeWorld(json, slotName = 's') {
  return attachmentWorldVertices(compileSkeleton(json), slotName);
}

// ── 1) telling the shapes apart ──

test('a weighted mesh is told apart from an unweighted one, and only uvs decide', () => {
  const { sa, sb } = synthetic().skins[0].attachments;
  assert.equal(isWeighted(sa.m1), true);
  assert.equal(isWeighted(sb.m2), false, 'same length as uvs: unweighted');
  assert.equal(isWeighted({ vertices: [1, 2] }), false, 'without uvs it is never weighted');
  assert.equal(isWeighted(null), false);
});

// ── 2) round trip ──

test('decode then encode returns the original array, weighted and unweighted', () => {
  const { sa, sb } = synthetic().skins[0].attachments;
  for (const mesh of [sa.m1, sb.m2]) assert.equal(J(encodeVertices(decodeVertices(mesh))), J(mesh.vertices));
  const decoded = decodeVertices(sa.m1);
  assert.equal(decoded.weighted, true);
  assert.equal(decoded.vertices.length, 4);
  assert.equal(decoded.vertices[1].influences.length, 2, 'the second vertex has two bones');
  assert.deepEqual(decoded.vertices[0].influences, [{ bone: 1, x: -5, y: -5, weight: 1 }]);
  assert.deepEqual(decodeVertices(sb.m2).vertices[2], { x: 4, y: 4 });
  assert.equal(encodeVertices(null), null);
});

// ── 3) malformed input: no invented numbers ──

test('a malformed array decodes to null instead of a guess', () => {
  assert.equal(decodeVertices({ uvs: [0, 0, 1, 1], vertices: [3, 1, 0, 0, 1] }), null, 'count runs past the end');
  // The array must be longer than uvs, or it is unweighted and the count is never read.
  assert.equal(decodeVertices({ uvs: [0, 0, 1, 1], vertices: [-1, 5, 5, 0, 1, 1] }), null, 'negative count');
  assert.equal(decodeVertices({ uvs: [0, 0, 1, 1], vertices: [1.5, 1, 0, 0, 1] }), null, 'fractional count');
  assert.equal(decodeVertices({ uvs: [0, 0, 1, 1], vertices: [0.5, 0, 0, 0, 1, 1, 0, 1, 1, 1] }), null, 'fractional count that does not overrun');
  assert.equal(decodeVertices(null), null);
  assert.equal(decodeVertices({}), null);
});

test('the report names a malformed mesh as fatal instead of skipping it, and the runtime agrees', async () => {
  const sk = oneMesh([9, 0, 0, 0, 1, 1, 0, 1, 1, 1]);
  const report = weightReport(sk);
  assert.equal(report.meshCount, 1);
  const [row] = report.meshes;
  assert.equal(row.malformed, true);
  assert.equal(row.findings[0].code, 'weight-malformed');
  assert.equal(row.findings[0].level, 'fatal');
  assert.equal(row.findings[0].where, 'skins/default/s/m');
  // Why fatal: spine-ts parses it, then reads past the array and throws when posing.
  await assert.rejects(runtimeWorld(sk));
});

// ── 4) faults a glance does not show ──

test('drifted sums and dead links are reported as warnings, with the reason', () => {
  const m1 = weightReport(synthetic()).meshes.find(m => m.attachment === 'm1');
  const byCode = Object.fromEntries(m1.findings.map(f => [f.code, f]));
  assert.equal(byCode['weight-sum'].level, 'warn');
  assert.equal(byCode['weight-sum'].params.vertices, 1);
  assert.equal(byCode['weight-sum'].params.worstDrift, 0.2);
  assert.match(byCode['weight-sum'].message, /normalize/, 'says why it misleads');
  assert.equal(byCode['weight-zero'].level, 'warn');
  assert.equal(byCode['weight-zero'].params.influences, 1);
  assert.equal(m1.findings.length, 2, J(m1.findings));
});

test('a drifted sum is drawn off its place by the official runtime (it does not normalize)', async () => {
  // Legacy claimed Spine normalizes on load, so drift never shows. Measured: it does not.
  const sk = oneMesh([1, 0, 10, 0, 0.5, 1, 0, 1, 1, 1]);
  const world = await runtimeWorld(sk);
  assert.ok(Math.abs(world[0] - 5) < 1e-6, `a lone 0.5 influence at x=10 is drawn at x=${world[0]}`);
});

test('a bone index outside the rig is fatal, and the runtime throws on it', async () => {
  const sk = oneMesh([1, 7, 0, 0, 1, 1, 0, 1, 1, 1]);
  const [row] = weightReport(sk).meshes;
  const f = row.findings.find(x => x.code === 'weight-bone-range');
  assert.equal(f.level, 'fatal');
  assert.deepEqual(f.params, { influences: 1, boneCount: 1 });
  assert.deepEqual(row.bones, [{ bone: 'root', vertices: 1, meanWeight: 1, maxWeight: 1, sharePercent: 50 }]);
  await assert.rejects(runtimeWorld(sk));
  const justPast = weightReport(oneMesh([1, 1, 0, 0, 1, 1, 0, 1, 1, 1])).meshes[0];
  assert.equal(justPast.findings?.[0]?.code, 'weight-bone-range', 'index === bone count is already outside');
  const fractional = weightReport(oneMesh([1, 0.5, 0, 0, 1, 1, 0, 1, 1, 1])).meshes[0];
  assert.ok(fractional.findings.some(x => x.code === 'weight-bone-range'), 'a fractional index is out of range too');
});

test('more influences than the GPU limit is a warning', () => {
  const bones = [{ name: 'root' }, ...[1, 2, 3, 4, 5].map(i => ({ name: `b${i}`, parent: 'root' }))];
  const crowded = [5, ...[1, 2, 3, 4, 5].flatMap(i => [i, 0, 0, 0.2]), 1, 0, 1, 1, 1];
  const [row] = weightReport(oneMesh(crowded, [0, 0, 1, 1], bones)).meshes;
  assert.deepEqual(row.findings.map(f => [f.code, f.level, f.params.vertices]), [['weight-many-bones', 'warn', 1]]);
  assert.equal(row.findings[0].params.limit, MAX_GPU_INFLUENCES);
  assert.deepEqual(row.influencesPerVertex, { 1: 1, 5: 1 });
  const atLimit = [4, ...[1, 2, 3, 4].flatMap(i => [i, 0, 0, 0.25]), 1, 0, 1, 1, 1];
  assert.equal(weightReport(oneMesh(atLimit, [0, 0, 1, 1], bones)).meshes[0].findings, undefined, 'exactly 4 is fine');
});

test('a clean mesh has no findings (no false positives)', () => {
  const sk = oneMesh([1, 1, 0, 0, 1, 1, 0, 1, 1, 1], [0, 0, 1, 1], [{ name: 'root' }, { name: 'a' }]);
  const [row] = weightReport(sk).meshes;
  assert.equal(row.findings, undefined, J(row.findings));
  assert.deepEqual(row.influencesPerVertex, { 1: 2 });
});

test('an unweighted mesh is reported as such, and a skeleton without meshes says so', () => {
  const m2 = weightReport(synthetic()).meshes.find(m => m.attachment === 'm2');
  assert.deepEqual({ weighted: m2.weighted, vertexCount: m2.vertexCount }, { weighted: false, vertexCount: 4 });
  assert.equal(typeof m2.note, 'string');
  const none = weightReport({ bones: [{ name: 'root' }] });
  assert.deepEqual([none.meshCount, none.weightedCount, none.boneCount], [0, 0, 1]);
  assert.equal(typeof none.note, 'string');
});

test('a linked mesh is not a mesh of its own and is not reported as malformed (legacy bug)', () => {
  const sk = synthetic();
  sk.skins[0].attachments.sa.linked = { type: 'linkedmesh', parent: 'm1', width: 10, height: 10 };
  assert.deepEqual(listMeshes(sk).map(m => m.attachment), ['m1', 'm2']);
  const report = weightReport(sk);
  assert.equal(report.meshCount, 2);
  assert.ok(report.meshes.every(m => !m.malformed));
});

test('rows name a non-default skin; pre-4 object skins are read too', () => {
  const sk = synthetic();
  sk.skins.push({ name: 'alt', attachments: { sb: { m3: structuredClone(sk.skins[0].attachments.sa.m1) } } });
  const row = weightReport(sk, { attachment: 'm3' }).meshes[0];
  assert.equal(row.skin, 'alt');
  assert.equal(weightReport(sk, { attachment: 'm1' }).meshes[0].skin, undefined, 'default skin is not named');
  const old = { bones: sk.bones, skins: { default: sk.skins[0].attachments } };
  assert.deepEqual(listMeshes(old).map(m => `${m.skin}/${m.attachment}`), ['default/m1', 'default/m2']);
});

// ── 5) the real file (legacy weighted_sample.json, byte for byte) ──
// Claims are derived from the file, not memorized: every round trip, the share order, the
// filters. The legacy gate searched the owner's projects first; this tree has one fixture.

test('the real file: weighted meshes found, every mesh round-trips byte for byte', () => {
  const sk = readFixture();
  const report = weightReport(sk);
  assert.ok(report.meshCount > 0 && report.weightedCount > 0, J({ meshCount: report.meshCount, weightedCount: report.weightedCount }));
  const meshes = listMeshes(sk);
  assert.ok(meshes.length > 0);
  for (const m of meshes) {
    const decoded = decodeVertices(m.mesh);
    assert.ok(decoded, `${m.slot}/${m.attachment} decodes`);
    assert.equal(J(encodeVertices(decoded)), J(m.mesh.vertices), `${m.slot}/${m.attachment} round-trips`);
  }
  assert.equal(report.boneCount, sk.bones.length);
});

test('the real file: shares are measured correctly and sorted descending', () => {
  const sk = readFixture();
  const report = weightReport(sk);
  const row = report.meshes.find(m => m.weighted);
  assert.ok(row.vertexCount > 0);
  const shares = row.bones.map(b => b.sharePercent);
  assert.ok(shares.length > 1 && shares.every((v, i) => i === 0 || shares[i - 1] >= v), J(shares));
  // Recomputed independently from the decoded data.
  const mesh = listMeshes(sk).find(m => m.slot === row.slot && m.attachment === row.attachment).mesh;
  const decoded = decodeVertices(mesh);
  for (const b of row.bones) {
    const index = sk.bones.findIndex(x => x.name === b.bone);
    const hits = decoded.vertices.flatMap(v => v.influences.filter(e => e.bone === index));
    const total = hits.reduce((a, e) => a + e.weight, 0);
    assert.equal(b.vertices, hits.length, `${b.bone} vertices`);
    assert.equal(b.sharePercent, Math.round(1000 * total / decoded.vertices.length) / 10, `${b.bone} share`);
    assert.equal(b.meanWeight, Math.round(1e4 * total / hits.length) / 1e4, `${b.bone} mean`);
    assert.equal(b.maxWeight, Math.max(...hits.map(e => e.weight)), `${b.bone} max`);
  }
  const counts = {};
  for (const v of decoded.vertices) counts[v.influences.length] = (counts[v.influences.length] ?? 0) + 1;
  assert.deepEqual(row.influencesPerVertex, counts);
  // An out-of-range index here would be a decoder bug; the file's own drift is reported, not failed.
  assert.ok(!report.meshes.some(m => (m.findings ?? []).some(f => f.code === 'weight-bone-range')));
});

test('the real file: detail is opt-in and far more expensive; raw lists every influence', () => {
  const sk = readFixture();
  const cheap = J(weightReport(sk)).length;
  const full = weightReport(sk, { detail: true });
  assert.ok(J(full).length > cheap * 2, `${cheap} vs ${J(full).length} characters`);
  const row = full.meshes.find(m => m.weighted);
  assert.equal(row.raw.vertices.length, row.vertexCount);
  const mesh = listMeshes(sk).find(m => m.slot === row.slot && m.attachment === row.attachment).mesh;
  const first = decodeVertices(mesh).vertices[0].influences[0];
  assert.deepEqual(row.raw.vertices[0][0], [first.bone, Math.round(first.x * 100) / 100, Math.round(first.y * 100) / 100, first.weight]);
  assert.equal(typeof row.rawNote, 'string');
  assert.equal(weightReport(sk).meshes.find(m => m.weighted).raw, undefined);
});

test('the real file: slot and attachment filters narrow to what was named', () => {
  const sk = readFixture();
  const report = weightReport(sk);
  const slot = report.meshes[0].slot;
  const narrow = weightReport(sk, { slot });
  assert.ok(narrow.meshes.length > 0 && narrow.meshes.every(m => m.slot === slot));
  assert.ok(report.meshCount === 1 || narrow.meshes.length < report.meshCount, `${narrow.meshes.length}/${report.meshCount}`);
  const attachment = report.meshes[0].attachment;
  const one = weightReport(sk, { attachment });
  assert.ok(one.meshes.length >= 1 && one.meshes.every(m => m.attachment === attachment));
});

test('the reader matches the official runtime: closed-form setup world equals computeWorldVertices', needsSpine, async () => {
  // world(v) = sum of w * B(x, y) over the influences, with B the bone's setup world matrix.
  const sk = readFixture();
  const spine = await loadRuntime();
  const skeleton = new spine.Skeleton(await parseSkeleton(sk, { backend: 'spine' }));
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform(spine.Physics.reset);
  const row = weightReport(sk).meshes.find(m => m.weighted);
  const mesh = listMeshes(sk).find(m => m.slot === row.slot && m.attachment === row.attachment).mesh;
  const world = await runtimeWorld(sk, row.slot);
  decodeVertices(mesh).vertices.forEach((v, i) => {
    let x = 0, y = 0;
    for (const e of v.influences) {
      const b = skeleton.bones[e.bone];
      x += e.weight * (b.a * e.x + b.b * e.y + b.worldX);
      y += e.weight * (b.c * e.x + b.d * e.y + b.worldY);
    }
    assert.ok(Math.hypot(x - world[2 * i], y - world[2 * i + 1]) < 1e-3, `vertex ${i}`);
  });
});

// ── signature: change detection, byte-compatible with legacy stamps ──

test('signature is the legacy FNV-1a stamp, value for value', () => {
  // Goldens computed with legacy weights.js `imza` at legacy-final: a repair stamped by the
  // legacy studio must still match after the port.
  assert.equal(signature(undefined), '77074ba4-4');
  assert.equal(signature(null), '77074ba4-4');
  assert.equal(signature([1, 2, 3]), 'e0f965d9-7');
  assert.equal(signature('ab'), 'fa58b218-4');
  assert.equal(signature(listMeshes(readFixture()).find(m => isWeighted(m.mesh)).mesh.vertices), '999d1a4d-jt');
  assert.notEqual(signature([1, 2, 3]), signature([1, 2, 4]));
});
