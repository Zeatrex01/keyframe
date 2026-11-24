// Gate for src/spine/weight-repair.js: is the mechanical weight fix correct?
// Ported from legacy test_weight_edit.js.
//
// The question is not "did something change". The worst thing a weight editor can do is
// silently corrupt the file and say "fixed". So every guarantee is pinned: topology
// byte-identical, vertex count fixed, at least one influence per vertex, every sum 1, bones
// only from the current rig, deformed meshes refused, nothing produced on a violation, the
// input never mutated.
//
// Why numbers and not screenshots: weight only shows when a bone moves, and the legacy
// screen gate skipped on a machine without a browser. The proof here never skips: the
// official spine-ts runtime runs in-process, poses the rig, and computes the mesh's world
// vertices itself. Setup pose: the repairs that promise "nothing moves" must keep every
// vertex in place. Under the fixture's own animation: a transfer must visibly move them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  repairWeights, applyRepair, readRepairMarker, findTarget, deformAnimation, invariantProblem,
  OPERATIONS, TOPOLOGY_FIELDS, REPAIR_MARKER, LEGACY_REPAIR_MARKER, WEIGHT_EPSILON,
} from '../src/spine/weight-repair.js';
import { decodeVertices, weightReport, signature } from '../src/spine/weights.js';
import { parseSkeleton, poseSetup } from '../src/runtime/index.js';
import { compileSkeleton, attachmentWorldVertices } from '../src/engine/index.js';
import { isStudioError } from '../src/shared/errors.js';
import { LEGACY_MARKERS, LEGACY_MARKER_FIELDS } from '../src/shared/legacy-names.js';

const FIXTURE = new URL('./fixtures/weights/weighted_sample.json', import.meta.url);
const readFixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const J = v => JSON.stringify(v);
const clone = o => structuredClone(o);
const TOLERANCE = 1e-3; // world units; the runtime stores vertices as float32

const setupBonesOf = async json => (await poseSetup(await parseSkeleton(json))).bones;

// World vertices of one mesh from the studio's engine (held to the official runtime by
// test/engine.test.js), at the setup pose or at `time` of `animation`.
async function runtimeWorld(json, slotName, attachmentName, { animation, time = 0 } = {}) {
  const flat = attachmentWorldVertices(compileSkeleton(json), slotName, attachmentName, { animation, time });
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

const largestMove = (a, b) => Math.max(...a.map((p, i) => Math.hypot(b[i].x - p.x, b[i].y - p.y)));

// One influence's world point at the setup pose, from a poseSetup snapshot.
const pointOf = (bones, e) => {
  const B = bones[e.bone];
  return { x: B.matrix.a * e.x + B.matrix.b * e.y + B.worldX, y: B.matrix.c * e.x + B.matrix.d * e.y + B.worldY };
};

function refuses(fn, code, details = {}) {
  assert.throws(fn, err => {
    assert.ok(isStudioError(err, code), `expected ${code}, got ${err.code ?? err.message}`);
    for (const [k, v] of Object.entries(details)) assert.deepEqual(err.details[k], v, `details.${k}`);
    return true;
  });
}

// The legacy synthetic rig, for the refusal paths and states the real file lacks.
// vertex 0: a=0.5 b=0.5 · vertex 1: a=1 · vertex 2: a=0.995 b=0.005 (a crumb).
// Every vertex is consistent: its influences land on one world point at the setup pose.
function synthetic({ deform = false } = {}) {
  const sk = {
    skeleton: { spine: '4.2.43', hash: 'ag1', images: './' },
    bones: [{ name: 'root' }, { name: 'a', parent: 'root', x: 0, y: 0 },
      { name: 'b', parent: 'root', x: 100, y: 0 }, { name: 'c', parent: 'root', x: 0, y: 100 }],
    slots: [{ name: 's', bone: 'a', attachment: 'm' }],
    skins: [{ name: 'default', attachments: { s: { m: {
      type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], hull: 3, width: 10, height: 10,
      vertices: [2, 1, 0, 0, 0.5, 2, -100, 0, 0.5,
        1, 1, 10, 10, 1,
        2, 1, 0, 20, 0.995, 2, -100, 20, 0.005],
    } } } }],
    animations: {},
  };
  if (deform) sk.animations.flex = { attachments: { default: { s: { m: { deform: [{ time: 0, vertices: [0, 0] }] } } } } };
  return sk;
}
const TARGET = { slot: 's', attachment: 'm' };
const meshOf = sk => sk.skins[0].attachments.s.m;

// The real target: the fixture's weighted mesh, named by data, not by literal.
function realTarget(sk) {
  const row = weightReport(sk).meshes.find(m => m.weighted);
  return { row, slot: row.slot, attachment: row.attachment, mesh: findTarget(sk, row.slot, row.attachment).mesh };
}

// ══ 1) the real file: every operation keeps the guarantees ══

const realRequests = row => [
  ['clean', { op: 'clean', threshold: 0.01 }],
  ['normalize', { op: 'normalize' }],
  ['transfer', { op: 'transfer', from: row.bones[1].bone, to: row.bones[0].bone, ratio: 0.3 }],
  ['add_influence', { op: 'add_influence', bone: row.bones.at(-1).bone, weight: 0.15 }],
  ['remove_influence', { op: 'remove_influence', bone: row.bones.at(-1).bone }],
];

test('the operation list is the public contract', () => {
  assert.deepEqual(OPERATIONS, ['clean', 'normalize', 'transfer', 'add_influence', 'remove_influence']);
});

test('the real file: its influences agree at the setup pose (what makes "nothing moves" provable)', async () => {
  // Every Spine editor export stores each influence of a vertex from the same setup world
  // point. The setup-pose promises below rest on that; it is measured, not assumed.
  const sk = readFixture();
  const { mesh } = realTarget(sk);
  const bones = await setupBonesOf(sk);
  for (const v of decodeVertices(mesh).vertices) {
    const points = v.influences.map(e => pointOf(bones, e));
    for (const p of points) assert.ok(Math.hypot(p.x - points[0].x, p.y - points[0].y) < TOLERANCE);
  }
});

for (const [name, request] of realRequests(realTarget(readFixture()).row)) {
  test(`the real file, ${name}: topology byte-identical, count fixed, every sum 1, input untouched, setup pose unchanged`, async () => {
    const sk = readFixture();
    const original = clone(sk);
    const { row, slot, attachment, mesh } = realTarget(sk);
    const setupBones = await setupBonesOf(sk);
    const result = repairWeights(sk, { slot, attachment, ...request }, { setupBones });
    assert.deepEqual(sk, original, 'repairWeights does not mutate its input');
    assert.equal(result.op, name);
    assert.deepEqual(result.target, { skin: 'default', slot, attachment });

    const decoded = decodeVertices({ vertices: result.vertices, uvs: mesh.uvs });
    assert.ok(decoded?.weighted, 'the result decodes as a weighted mesh');
    assert.equal(decoded.vertices.length, row.vertexCount, 'vertex count unchanged');
    assert.equal(result.vertexCount, row.vertexCount);
    for (const [i, v] of decoded.vertices.entries()) {
      assert.ok(v.influences.length > 0, `vertex ${i} keeps an influence`);
      assert.ok(Math.abs(v.influences.reduce((a, e) => a + e.weight, 0) - 1) <= WEIGHT_EPSILON, `vertex ${i} sums to 1`);
      for (const e of v.influences) assert.ok(Number.isInteger(e.bone) && e.bone >= 0 && e.bone < sk.bones.length, 'bone from this rig');
    }

    const out = applyRepair(sk, result, { baseSkeleton: original, baseName: 'base.json', time: 'T' });
    assert.deepEqual(sk, original, 'applyRepair does not mutate its input');
    const after = findTarget(out, slot, attachment).mesh;
    for (const field of TOPOLOGY_FIELDS) assert.equal(J(after[field]), J(mesh[field]), `${field} byte-identical`);
    assert.equal(J(after.vertices), J(result.vertices));
    // Nothing else in the file changed: only the target's vertices and the marker.
    const rest = clone(out);
    delete rest[REPAIR_MARKER];
    findTarget(rest, slot, attachment).mesh.vertices = mesh.vertices;
    assert.deepEqual(rest, original);

    // The official runtime reads the result, and at the setup pose nothing moved.
    const before = await runtimeWorld(original, slot, attachment);
    const now = await runtimeWorld(out, slot, attachment);
    assert.ok(largestMove(before, now) < TOLERANCE, `setup pose moved by ${largestMove(before, now)}`);
  });
}

test('the real file, normalize of an already normalized mesh changes nothing at all', () => {
  const sk = readFixture();
  const { slot, attachment, mesh } = realTarget(sk);
  const result = repairWeights(sk, { op: 'normalize', slot, attachment });
  assert.equal(result.changed, false);
  assert.equal(J(result.vertices), J(mesh.vertices), 'byte-identical: the owner\'s numbers are not re-rounded');
  assert.deepEqual(result.measure, { fixedVertices: 0, maxDrift: 0 });
  assert.deepEqual(result.boneDelta, []);
  assert.equal(result.sideNormalized, undefined);
});

test('the real file, transfer touches only the vertices that carry the source bone', async () => {
  const sk = readFixture();
  const { row, slot, attachment, mesh } = realTarget(sk);
  const from = sk.bones.findIndex(b => b.name === row.bones[1].bone);
  const result = repairWeights(sk, { op: 'transfer', slot, attachment, from: row.bones[1].bone, to: row.bones[0].bone, ratio: 0.3 },
    { setupBones: await setupBonesOf(sk) });
  const was = decodeVertices(mesh).vertices;
  const now = decodeVertices({ vertices: result.vertices, uvs: mesh.uvs }).vertices;
  let carried = 0;
  was.forEach((v, i) => {
    if (v.influences.some(e => e.bone === from)) carried++;
    else assert.deepEqual(now[i], v, `vertex ${i} has no source influence and is untouched`);
  });
  assert.equal(result.measure.touchedVertices, carried);
  assert.ok(carried > 0 && carried < was.length, 'the check covers both kinds of vertex');
});

// ══ 2) numeric proof: under a pose the repair really moves vertices ══
// At the setup pose a consistent vertex sits in the same place whatever its weights; the
// difference appears only when bones move. The fixture's own animation moves them.

test('under the fixture\'s animation, moving all weight to one bone visibly moves the mesh; at setup it does not', async () => {
  const sk = readFixture();
  const { row, slot, attachment } = realTarget(sk);
  const data = await parseSkeleton(sk);
  const animation = data.animations[0];
  const time = animation.duration * 0.5;
  const result = repairWeights(sk, { op: 'transfer', slot, attachment, from: row.bones[1].bone, to: row.bones[0].bone, ratio: 1 },
    { setupBones: await setupBonesOf(sk) });
  const out = applyRepair(sk, result);
  const posedBefore = await runtimeWorld(sk, slot, attachment, { animation: animation.name, time });
  const posedAfter = await runtimeWorld(out, slot, attachment, { animation: animation.name, time });
  const moves = posedBefore.map((p, i) => Math.hypot(posedAfter[i].x - p.x, posedAfter[i].y - p.y));
  const posed = Math.max(...moves);
  assert.ok(moves.filter(d => d > 0.01).length > 0, 'vertices moved under the pose');
  assert.ok(posed > 0.5, `the move is measurable, not noise: ${posed}`);
  // The effect depends on the pose: at setup it is negligible next to the posed one.
  const setup = largestMove(await runtimeWorld(sk, slot, attachment), await runtimeWorld(out, slot, attachment));
  assert.ok(setup * 20 < posed, `setup ${setup} vs posed ${posed}`);
});

// ══ 3) clean, measured on the real target ══

test('the real file, clean: crumbs existed, none remain, and the count reported is the count removed', () => {
  const sk = readFixture();
  const { slot, attachment, mesh } = realTarget(sk);
  const crumbs = vertices => vertices.reduce((a, v) => a + v.influences.filter(e => e.weight < 0.01).length, 0);
  const before = crumbs(decodeVertices(mesh).vertices);
  const result = repairWeights(sk, { op: 'clean', slot, attachment, threshold: 0.01 });
  assert.ok(before > 0, 'the fixture has crumbs to clean');
  assert.equal(crumbs(decodeVertices({ vertices: result.vertices, uvs: mesh.uvs }).vertices), 0);
  assert.deepEqual(result.measure, { removedInfluences: before, threshold: 0.01 });
  assert.equal(result.influencesBefore - result.influencesAfter, before);
  assert.equal(result.changed, true);
});

test('normalize leaves settled weights byte-identical, even with more than 6 decimals', () => {
  // Legacy re-rounded every weight to 6 decimals, so a no-op repair rewrote the owner's numbers.
  const sk = synthetic();
  meshOf(sk).vertices = [2, 1, 0, 0, 1 / 3, 2, -100, 0, 2 / 3, 1, 1, 10, 10, 1, 1, 1, 0, 20, 1];
  const result = repairWeights(sk, { op: 'normalize', ...TARGET });
  assert.equal(result.changed, false);
  assert.equal(J(result.vertices), J(meshOf(sk).vertices));
});

test('rounding leaves no remainder: the largest share takes it, so the sum is 1', () => {
  const sk = synthetic();
  meshOf(sk).vertices = [3, 1, 0, 0, 0.2, 2, -100, 0, 0.2, 3, 0, -100, 0.2, 1, 1, 10, 10, 1, 1, 1, 0, 20, 1];
  const result = repairWeights(sk, { op: 'normalize', ...TARGET });
  const weights = decodeVertices({ vertices: result.vertices, uvs: meshOf(sk).uvs }).vertices[0].influences.map(e => e.weight);
  assert.deepEqual(weights, [0.333334, 0.333333, 0.333333]);
  assert.ok(Math.abs(weights.reduce((a, w) => a + w, 0) - 1) < 1e-12);
});

test('clean keeps the largest influence of a vertex made only of crumbs', () => {
  const sk = synthetic();
  meshOf(sk).vertices = [2, 1, 0, 0, 0.004, 2, -100, 0, 0.003, 1, 1, 10, 10, 1, 1, 1, 0, 20, 1];
  const result = repairWeights(sk, { op: 'clean', ...TARGET });
  const v0 = decodeVertices({ vertices: result.vertices, uvs: meshOf(sk).uvs }).vertices[0];
  assert.deepEqual(v0.influences, [{ bone: 1, x: 0, y: 0, weight: 1 }]);
  assert.equal(result.measure.removedInfluences, 1);
});

// ══ exact world maths against the runtime, on states the real file lacks ══

// A rig whose bones are rotated, scaled and sheared, and a vertex whose two influences
// disagree at the setup pose: a at world (0,0), b at world (100,0).
function skewed() {
  const sk = synthetic();
  sk.bones[3] = { name: 'c', parent: 'root', x: 30, y: 70, rotation: 37, scaleX: 1.7, scaleY: 0.6, shearX: 12, shearY: -5 };
  meshOf(sk).vertices = [2, 1, 0, 0, 0.5, 2, 0, 0, 0.5, 1, 1, 10, 10, 1, 1, 1, 0, 20, 1];
  return sk;
}

test('add_influence derives the new position exactly, through rotation, scale and shear (runtime-checked)', async () => {
  const sk = skewed();
  const result = repairWeights(sk, { op: 'add_influence', ...TARGET, bone: 'c', weight: 0.3 }, { setupBones: await setupBonesOf(sk) });
  assert.equal(result.measure.addedInfluences, 3);
  // The new influence takes exactly the requested share; the others give it up in proportion.
  const v0 = decodeVertices({ vertices: result.vertices, uvs: meshOf(sk).uvs }).vertices[0];
  assert.deepEqual(v0.influences.map(e => [e.bone, e.weight]), [[1, 0.35], [2, 0.35], [3, 0.3]]);
  const move = largestMove(await runtimeWorld(sk, 's', 'm'), await runtimeWorld(applyRepair(sk, result), 's', 'm'));
  assert.ok(move < TOLERANCE, `setup pose moved by ${move}`);
});

test('transfer moves exactly what it says: an opened influence nothing, an existing one share x the gap', async () => {
  const sk = skewed();
  const setupBones = await setupBonesOf(sk);
  const before = await runtimeWorld(sk, 's', 'm');
  // a -> c: c is on no vertex, so it opens at a's own world point; nothing moves.
  const opened = repairWeights(sk, { op: 'transfer', ...TARGET, from: 'a', to: 'c', ratio: 0.4 }, { setupBones });
  assert.equal(opened.measure.openedInfluences, 3);
  assert.ok(largestMove(before, await runtimeWorld(applyRepair(sk, opened), 's', 'm')) < TOLERANCE);
  // a -> b on vertex 0: b is already there, at another world point. The vertex moves by
  // share * (b's point - a's point) = 0.5 * (100, 0); the other vertices do not carry b
  // and are opened, so they stay.
  const existing = repairWeights(sk, { op: 'transfer', ...TARGET, from: 'a', to: 'b', ratio: 1 }, { setupBones });
  const after = await runtimeWorld(applyRepair(sk, existing), 's', 'm');
  const [ea, eb] = decodeVertices(meshOf(sk)).vertices[0].influences;
  const gap = { x: pointOf(setupBones, eb).x - pointOf(setupBones, ea).x, y: pointOf(setupBones, eb).y - pointOf(setupBones, ea).y };
  assert.ok(Math.hypot(after[0].x - before[0].x - 0.5 * gap.x, after[0].y - before[0].y - 0.5 * gap.y) < TOLERANCE,
    `vertex 0 moved to ${J(after[0])} from ${J(before[0])}`);
  assert.ok(Math.hypot(gap.x, gap.y) > 50, 'the case really is inconsistent');
  for (const i of [1, 2]) assert.ok(Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y) < TOLERANCE, `vertex ${i} stays`);
});

test('normalize settles a drifted vertex where the runtime would draw it at full weight', async () => {
  // a at (10,0) with 0.5 and b reaching the same point with 0.3: sum 0.8. The runtime draws
  // it at 0.8 of the way; after normalize it is drawn at the point itself.
  const sk = synthetic();
  meshOf(sk).vertices = [2, 1, 10, 0, 0.5, 2, -90, 0, 0.3, 1, 1, 10, 10, 1, 1, 1, 0, 20, 1];
  const before = await runtimeWorld(sk, 's', 'm');
  const result = repairWeights(sk, { op: 'normalize', ...TARGET });
  assert.deepEqual(result.measure, { fixedVertices: 1, maxDrift: 0.2 });
  const after = await runtimeWorld(applyRepair(sk, result), 's', 'm');
  assert.ok(Math.abs(before[0].x - 8) < TOLERANCE && Math.abs(after[0].x - 10) < TOLERANCE, `${before[0].x} -> ${after[0].x}`);
  assert.ok(largestMove(before.slice(1), after.slice(1)) < TOLERANCE, 'settled vertices stay');
  const v0 = decodeVertices({ vertices: result.vertices, uvs: meshOf(sk).uvs }).vertices[0];
  assert.deepEqual(v0.influences.map(e => e.weight), [0.625, 0.375]);
});

test('vertices the operation did not touch are settled too, and the count is reported', async () => {
  // Born from a legacy gate finding: add_influence skipped vertices that already carry the
  // bone and left their drift behind. Vertex 1 already has c, and sums to 0.9.
  const sk = synthetic();
  meshOf(sk).vertices = [1, 1, 0, 0, 1, 2, 1, 10, 10, 0.5, 3, -90, -90, 0.4, 1, 1, 0, 20, 1];
  const result = repairWeights(sk, { op: 'add_influence', ...TARGET, bone: 'c' }, { setupBones: await setupBonesOf(sk) });
  assert.equal(result.measure.addedInfluences, 2);
  assert.equal(result.sideNormalized, 1);
});

// ══ 4) refusals: each by its code, none silent, nothing mutated ══

test('every refusal throws its code and leaves the input untouched', async () => {
  const setupBones = await setupBonesOf(synthetic());
  const cases = [
    ['unknown operation', {}, { op: 'paint' }, 'unknown-operation'],
    ['bone not in the rig', {}, { op: 'remove_influence', bone: 'missing' }, 'unknown-bone', { bone: 'missing' }],
    ['threshold out of range', {}, { op: 'clean', threshold: 7 }, 'bad-argument', { field: 'threshold' }],
    ['ratio out of range', {}, { op: 'transfer', from: 'a', to: 'b', ratio: 3 }, 'bad-argument', { field: 'ratio' }],
    ['ratio zero', {}, { op: 'transfer', from: 'a', to: 'b', ratio: 0 }, 'bad-argument', { field: 'ratio' }],
    ['weight of 1', {}, { op: 'add_influence', bone: 'c', weight: 1 }, 'bad-argument', { field: 'weight' }],
    ['from = to', {}, { op: 'transfer', from: 'a', to: 'a' }, 'same-bone'],
    ['source on no vertex', {}, { op: 'transfer', from: 'c', to: 'a' }, 'bone-not-on-mesh', { bone: 'c' }],
    ['removing a bone on no vertex', {}, { op: 'remove_influence', bone: 'c' }, 'bone-not-on-mesh'],
    ['adding a bone already everywhere', {}, { op: 'add_influence', bone: 'a' }, 'bone-already-on-mesh'],
    ['the last influence of a vertex', {}, { op: 'remove_influence', bone: 'a' }, 'last-influence', { vertex: 1 }],
    ['deform veto', { deform: true }, { op: 'clean' }, 'mesh-has-deform', { animation: 'flex' }],
  ];
  for (const [label, build, request, code, details] of cases) {
    const sk = synthetic(build);
    const original = clone(sk);
    refuses(() => repairWeights(sk, { ...TARGET, ...request }, { setupBones }), code, details);
    assert.deepEqual(sk, original, `${label}: input untouched`);
  }
});

test('the target must be one weighted, readable mesh of this rig', () => {
  refuses(() => repairWeights(synthetic(), { op: 'normalize', slot: 's', attachment: 'nothing' }), 'mesh-not-found');
  const twice = synthetic();
  twice.skins.push({ name: 'alt', attachments: { s: { m: clone(meshOf(twice)) } } });
  refuses(() => repairWeights(twice, { op: 'normalize', ...TARGET }), 'mesh-ambiguous');
  const plain = synthetic();
  meshOf(plain).vertices = [0, 0, 10, 0, 10, 10];
  refuses(() => repairWeights(plain, { op: 'normalize', ...TARGET }), 'mesh-unweighted');
  const boneless = synthetic();
  boneless.bones = [];
  refuses(() => repairWeights(boneless, { op: 'normalize', ...TARGET }), 'no-bones');
  const dead = synthetic();
  meshOf(dead).vertices = [1, 1, 0, 0, 0, 1, 1, 10, 10, 1, 1, 1, 0, 20, 1];
  refuses(() => repairWeights(dead, { op: 'normalize', ...TARGET }), 'zero-weight-vertex', { vertex: 0 });
});

test('the operations that place an influence need this rig\'s setup matrices, and a usable one', async () => {
  const sk = synthetic();
  refuses(() => repairWeights(sk, { op: 'transfer', ...TARGET, from: 'b', to: 'a' }), 'missing-bone-world');
  const otherRig = await setupBonesOf(readFixture());
  refuses(() => repairWeights(sk, { op: 'add_influence', ...TARGET, bone: 'c' }, { setupBones: otherRig }), 'bone-world-mismatch');
  const reordered = (await setupBonesOf(sk)).reverse();
  refuses(() => repairWeights(sk, { op: 'add_influence', ...TARGET, bone: 'c' }, { setupBones: reordered }), 'bone-world-mismatch');
  const flat = synthetic();
  flat.bones[3].scaleX = 0;
  const flatBones = await setupBonesOf(flat);
  refuses(() => repairWeights(flat, { op: 'add_influence', ...TARGET, bone: 'c' }, { setupBones: flatBones }), 'degenerate-bone', { bone: 'c' });
  // The three operations that place nothing do not ask for matrices.
  for (const op of ['clean', 'normalize']) assert.ok(repairWeights(sk, { op, ...TARGET }));
  assert.ok(repairWeights(sk, { op: 'remove_influence', ...TARGET, bone: 'b' }));
});

test('normalize stays available on a deformed mesh: it never changes the influence count', async () => {
  const sk = synthetic({ deform: true });
  const data = await parseSkeleton(sk, { backend: 'keyframe' });
  assert.ok(data.model.animations.get('flex').timelines.some(t => t.kind === 'deform'), 'the fixture deform is a real deform timeline');
  assert.ok(repairWeights(sk, { op: 'normalize', ...TARGET }));
  const setupBones = await setupBonesOf(sk);
  for (const request of [{ op: 'transfer', from: 'b', to: 'a' }, { op: 'add_influence', bone: 'c' }, { op: 'remove_influence', bone: 'b' }]) {
    refuses(() => repairWeights(sk, { ...TARGET, ...request }, { setupBones }), 'mesh-has-deform');
  }
});

test('the deform veto reads every layout, and linked meshes sharing the vertices (legacy gap)', () => {
  const target = { skin: 'default', slot: 's', attachment: 'm' };
  const legacyShape = synthetic();
  legacyShape.animations.old = { attachments: { default: { s: { m: [{ time: 0, vertices: [0, 0] }] } } } };
  assert.equal(deformAnimation(legacyShape, target), 'old', 'a pre-4 key under the 4.x section');
  const pre4 = synthetic();
  pre4.animations.old = { deform: { default: { s: { m: [{ time: 0, vertices: [0, 0] }] } } } };
  assert.equal(deformAnimation(pre4, target), 'old', 'the pre-4 deform section');
  const sequence = synthetic();
  sequence.animations.seq = { attachments: { default: { s: { m: { sequence: [{ mode: 'loop' }] } } } } };
  assert.equal(deformAnimation(sequence, target), null, 'a sequence timeline is not a deform');
  assert.ok(repairWeights(sequence, { op: 'clean', ...TARGET }));
  const linked = synthetic();
  linked.skins[0].attachments.s.copy = { type: 'linkedmesh', parent: 'm', timelines: false, width: 10, height: 10 };
  linked.animations.wave = { attachments: { default: { s: { copy: { deform: [{ time: 0, vertices: [0, 0] }] } } } } };
  assert.equal(deformAnimation(linked, target), 'wave', 'a deformed linked mesh shares this vertex array');
  refuses(() => repairWeights(linked, { op: 'clean', ...TARGET }), 'mesh-has-deform');
  const otherParent = clone(linked);
  otherParent.skins[0].attachments.s.copy.parent = 'elsewhere';
  assert.equal(deformAnimation(otherParent, target), null);
  const otherSkin = clone(linked);
  otherSkin.skins[0].attachments.s.copy.skin = 'alt';
  assert.equal(deformAnimation(otherSkin, target), null, 'a linked mesh whose parent lives in another skin');
  const deformElsewhere = synthetic();
  deformElsewhere.animations.flex = { attachments: { default: { s: { other: { deform: [{ time: 0 }] } } } } };
  assert.equal(deformAnimation(deformElsewhere, target), null);
});

test('a rigidly bound target is refused (legacy _kfBind rule), an unreadable bind marker too', () => {
  const bound = synthetic();
  bound._kfBind = { v: 1, edits: [{ target: { skin: 'default', slot: 's', attachment: 'm' } }] };
  refuses(() => repairWeights(bound, { op: 'normalize', ...TARGET }), 'mesh-bound');
  const elsewhere = synthetic();
  elsewhere._kfBind = { v: 1, edits: [{ target: { skin: 'default', slot: 's', attachment: 'other' } }] };
  assert.ok(repairWeights(elsewhere, { op: 'normalize', ...TARGET }));
  const broken = synthetic();
  broken._kfBind = true;
  refuses(() => repairWeights(broken, { op: 'normalize', ...TARGET }), 'bind-marker-malformed');
});

// ══ 5) the invariant guard really runs ══

test('a bone index outside the rig is refused before any arithmetic', async () => {
  const sk = synthetic();
  meshOf(sk).vertices = [2, 1, 0, 0, 0.5, 99, -100, 0, 0.5, 1, 1, 10, 10, 1, 1, 1, 0, 20, 1];
  refuses(() => repairWeights(sk, { op: 'normalize', ...TARGET }), 'bone-index-range', { vertex: 0, boneCount: 4 });
  // Legacy threw a TypeError here when the operation needed world maths.
  const setupBones = await setupBonesOf(synthetic());
  refuses(() => repairWeights(sk, { op: 'add_influence', ...TARGET, bone: 'c' }, { setupBones }), 'bone-index-range');
});

test('a negative weight that still sums to 1 reaches the guard and nothing is produced', () => {
  // The one input the operations pass through untouched yet the guard rejects: it proves the
  // guard runs on the produced array.
  const sk = synthetic();
  meshOf(sk).vertices = [2, 1, 0, 0, 1.5, 2, -100, 0, -0.5, 1, 1, 10, 10, 1, 1, 1, 0, 20, 1];
  const original = clone(sk);
  refuses(() => repairWeights(sk, { op: 'normalize', ...TARGET }), 'invariant-violation', { reason: 'bad-weight' });
  assert.deepEqual(sk, original);
});

test('an inflated influence count is refused as malformed', () => {
  // The array stays long: shorter than uvs would make it "unweighted" and refuse for
  // another reason. Vertex 0 claims 9 influences instead of 2; the length is unchanged.
  const sk = synthetic();
  meshOf(sk).vertices[0] = 9;
  refuses(() => repairWeights(sk, { op: 'normalize', ...TARGET }), 'mesh-malformed');
});

test('the guard names each violation it checks on a produced array', () => {
  const uvs = [0, 0, 1, 1];
  assert.equal(invariantProblem([1, 0, 0, 0, 1, 1, 0, 1, 1, 1], uvs, 2, 1), null);
  assert.equal(invariantProblem([0, 0, 1, 1], uvs, 2, 1), 'unweighted-length');
  assert.equal(invariantProblem(null, uvs, 2, 1), 'unweighted-length');
  assert.equal(invariantProblem([3, 0, 0, 0, 1], uvs, 2, 1), 'undecodable');
  assert.equal(invariantProblem([1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 2, 2, 1], uvs, 2, 1), 'vertex-count');
  assert.equal(invariantProblem([0, 1, 0, 1, 1, 1], uvs, 2, 1), 'no-influence');
  assert.equal(invariantProblem([1, 1, 0, 0, 1, 1, 0, 1, 1, 1], uvs, 2, 1), 'bone-index-range');
  assert.equal(invariantProblem([2, 0, 0, 0, 1.5, 0, 0, 0, -0.5, 1, 0, 1, 1, 1], uvs, 2, 1), 'bad-weight');
  assert.equal(invariantProblem([1, 0, 0, 0, 0.9, 1, 0, 1, 1, 1], uvs, 2, 1), 'sum');
  assert.equal(invariantProblem([1, 0, 0, 0, 1 + WEIGHT_EPSILON / 2, 1, 0, 1, 1, 1], uvs, 2, 1), null, 'within epsilon');
});

// ══ 6) the report says the real bone difference ══

test('the bone delta tells which bone lost and which gained', async () => {
  const sk = synthetic();
  const result = repairWeights(sk, { op: 'transfer', ...TARGET, from: 'b', to: 'a', ratio: 1 }, { setupBones: await setupBonesOf(sk) });
  const b = result.boneDelta.find(x => x.bone === 'b');
  const a = result.boneDelta.find(x => x.bone === 'a');
  assert.deepEqual([b.verticesBefore, b.verticesAfter], [2, 0], 'b left every vertex');
  assert.ok(a.weightAfter > a.weightBefore, 'a gained weight');
  assert.equal(a.change, -b.change);
  assert.ok(result.influencesAfter < result.influencesBefore);
  assert.deepEqual([result.influencesBefore, result.influencesAfter], [5, 3]);
  assert.deepEqual(result.measure, { touchedVertices: 2, openedInfluences: 0, movedWeight: 0.505 });
  // Largest change first.
  const added = repairWeights(sk, { op: 'add_influence', ...TARGET, bone: 'c', weight: 0.1 }, { setupBones: await setupBonesOf(sk) });
  assert.deepEqual(added.boneDelta.map(x => x.bone), ['c', 'a', 'b']);
  assert.deepEqual(added.boneDelta.map(x => x.change), [0.3, -0.2495, -0.0505]);
});

// ══ the delivery marker: writes _kfWeights only, reads the legacy alias ══

// Legacy names come from src/shared/legacy-names.js, the one language-gate exemption. A
// legacy record also carried base, operation and time fields; only the signature is read.
const LEGACY_NAME = LEGACY_MARKERS._kfWeights;
const legacyRecord = sig => ({ [LEGACY_MARKER_FIELDS.baseSignature]: sig, extra: 'ignored' });

test('the marker names: _kfWeights is written, the legacy name is only an alias', () => {
  assert.equal(REPAIR_MARKER, '_kfWeights');
  assert.equal(LEGACY_REPAIR_MARKER, LEGACY_NAME);
  assert.notEqual(LEGACY_NAME, REPAIR_MARKER);
  assert.ok(LEGACY_NAME.startsWith('_kf'));
});

test('the reader accepts the legacy alias and translates its records; _kfWeights wins a shared key', () => {
  const sk = synthetic();
  sk[LEGACY_NAME] = { 's/m': legacyRecord('sig-old'), 'x/y': legacyRecord('sig-x'), 'no/sig': {} };
  assert.deepEqual(readRepairMarker(sk), {
    's/m': { baseSignature: 'sig-old', base: null, operation: null, time: null },
    'x/y': { baseSignature: 'sig-x', base: null, operation: null, time: null },
    'no/sig': { baseSignature: null, base: null, operation: null, time: null },
  });
  sk[REPAIR_MARKER] = { 's/m': { baseSignature: 'sig-new', base: 'base.json', operation: 'clean', time: 'T2' } };
  const both = readRepairMarker(sk);
  assert.equal(both['s/m'].baseSignature, 'sig-new');
  assert.equal(both['x/y'].baseSignature, 'sig-x');
  assert.deepEqual(readRepairMarker(synthetic()), {});
  assert.deepEqual(readRepairMarker({ [REPAIR_MARKER]: 'junk', [LEGACY_NAME]: [1] }), {}, 'a marker that is not an object is ignored');
});

test('the writer stamps _kfWeights only, folds a legacy alias into it and drops the alias', () => {
  const base = readFixture();
  const sk = clone(base);
  sk[LEGACY_NAME] = { 'x/y': legacyRecord('sig-x') };
  const { slot, attachment } = realTarget(sk);
  const result = repairWeights(sk, { op: 'clean', slot, attachment });
  const out = applyRepair(sk, result, { baseSkeleton: base, baseName: 'weighted_sample.json', time: '2026-10-28T00:00:00Z' });
  assert.equal(Object.prototype.hasOwnProperty.call(out, LEGACY_NAME), false, 'the alias is never written');
  assert.deepEqual(out[REPAIR_MARKER], {
    'x/y': { baseSignature: 'sig-x', base: null, operation: null, time: null },
    [`${slot}/${attachment}`]: { baseSignature: signature(findTarget(base, slot, attachment).mesh.vertices),
      base: 'weighted_sample.json', operation: 'clean', time: '2026-10-28T00:00:00Z' },
  });
  assert.equal(out[REPAIR_MARKER][`${slot}/${attachment}`].baseSignature, result.sourceSignature, 'base and source are the same file here');
  assert.ok(sk[LEGACY_NAME], 'the input keeps what it had');
  const unsigned = applyRepair(sk, result);
  assert.deepEqual(unsigned[REPAIR_MARKER][`${slot}/${attachment}`], { baseSignature: null, base: null, operation: 'clean', time: null });
});

test('applyRepair refuses a skeleton the repair was not computed from, and a result that breaks a check', () => {
  const sk = readFixture();
  const { slot, attachment } = realTarget(sk);
  const result = repairWeights(sk, { op: 'clean', slot, attachment });
  const repaired = applyRepair(sk, result);
  refuses(() => applyRepair(repaired, result), 'stale-repair');
  refuses(() => applyRepair(sk, { target: result.target }), 'bad-argument');
  // A tampered result (a bone index outside the rig) is caught by the spine check.
  const tampered = { ...result, vertices: result.vertices.slice() };
  tampered.vertices[1] = 99;
  refuses(() => applyRepair(sk, tampered), 'repair-new-fatal');
  // A fatal the input already had is the owner's: inherited, never a refusal (findings.js).
  const inherited = readFixture();
  delete inherited.skeleton.hash;
  const r = repairWeights(inherited, { op: 'clean', slot, attachment });
  assert.ok(applyRepair(inherited, r)[REPAIR_MARKER]);
});
