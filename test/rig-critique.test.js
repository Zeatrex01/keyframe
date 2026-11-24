// Gate for src/understand/rig-critique.js: the rig doctor must actually diagnose.
// Ported from legacy test_rig_critique.js.
//
// The defect that motivated it was found by hand on the owner's chest: both lid bones sit
// at the centre of the lid art, so rotating them spins the lid in place instead of
// hinging it. A diagnostic tool has two ways to be useless, and this gate closes both:
//   1. missing the real fault (silence reads as "your rig is fine")
//   2. crying wolf on a correct rig (advice nobody can trust is advice nobody reads)
// So every check is tested in BOTH directions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { critiqueRig, PIVOT_THRESHOLD } from '../src/understand/rig-critique.js';
import { parseSkeleton, poseSetup } from '../src/runtime/index.js';
import { fatalsOf } from '../src/spine/findings.js';
import { isStudioError } from '../src/shared/errors.js';

const readJson = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}/${name}.json`, import.meta.url), 'utf8'));
const clone = o => structuredClone(o);
const byCode = (r, code) => r.findings.filter(f => f.code === code);

// A lid 100 wide, 40 tall, its art centred at (0, 100). `pivotY` moves the BONE, so the
// same art can be tested hinged (80, the bottom edge) or centred (100).
const chest = (pivotY, rotate) => ({
  skeleton: { spine: '4.2' },
  bones: [{ name: 'root' }, { name: 'lid', parent: 'root', x: 0, y: pivotY }],
  slots: [{ name: 'lid', bone: 'lid', attachment: 'art' }],
  skins: [{ name: 'default', attachments: { lid: { art: {
    type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    // vertices are in BONE space, so they shift as the bone moves
    vertices: [-50, 100 - pivotY - 20, 50, 100 - pivotY - 20, 50, 100 - pivotY + 20, -50, 100 - pivotY + 20],
    triangles: [0, 1, 2, 0, 2, 3], hull: 4 } } } }],
  animations: rotate ? { open: { bones: { lid: { rotate: [{ value: 0 }, { time: 1, value: -60 }] } } } } : {},
});

test('pivot at the centre: the real defect is found', async () => {
  const r = await critiqueRig(chest(100, true));
  const [f] = byCode(r, 'pivot-centered');
  assert.ok(f, 'the centred pivot is found');
  assert.equal(f.params.severity, 'high', 'on a rotated bone it is high');
  assert.equal(f.where, 'bones/lid');
  assert.match(f.params.why, /ALREADY rotated/, 'the defect is said to be visible on screen');
  assert.match(f.params.why, /does not swing the part from a hinge/i, 'the reason explains the hinge');
  assert.match(f.params.fix, /EDGE/, 'a concrete fix: move the origin to the edge');
  assert.deepEqual(f.params.measure.suggestedEdges.bottom, { x: 0, y: 80 }, 'the suggested hinge COORDINATE is given');
  assert.deepEqual(f.params.measure.boneWorld, { x: 0, y: 100 });
  assert.deepEqual(f.params.measure.artCentre, { x: 0, y: 100 });
  assert.deepEqual(f.params.measure.artBox, { w: 100, h: 40 });
  assert.match(f.params.fix, /wheel/i, 'the intent ambiguity is said openly (a wheel is correct)');
  assert.equal(r.verdict, 'attention');
});

test('pivot at the edge: silent on a correct rig', async () => {
  const r = await critiqueRig(chest(80, true));
  assert.deepEqual(byCode(r, 'pivot-centered'), []);
});

test('pivot at the centre of a bone nothing rotates: silent', async () => {
  // Measured on a real 26-bone scene: without this guard the doctor emitted 12 findings
  // for background, shadow and screen planes, all correct by design (Spine centres a bone
  // on its art when it builds a rig from a PSD).
  const r = await critiqueRig(chest(100, false));
  assert.deepEqual(byCode(r, 'pivot-centered'), []);
});

test('the centre test uses the threshold on both axes', async () => {
  // Bone 8 units off the art centre on a 40-tall lid: 8 / 20 = 40% off vertically.
  assert.equal(PIVOT_THRESHOLD, 0.22);
  assert.deepEqual(byCode(await critiqueRig(chest(92, true)), 'pivot-centered'), []);
  // 4 units off: 20%, inside the threshold.
  assert.equal(byCode(await critiqueRig(chest(96, true)), 'pivot-centered').length, 1);
  assert.deepEqual(byCode(await critiqueRig(chest(96, true), { pivotThreshold: 0.1 }), 'pivot-centered'), []);
});

test('a bone that moves nothing', async () => {
  const base = chest(80, false);
  const idle = clone(base);
  idle.bones.push({ name: 'ghost', parent: 'root', x: 200, y: 0 });
  const [f1] = byCode(await critiqueRig(idle), 'bone-unused');
  assert.equal(f1?.where, 'bones/ghost', 'the unbound bone is found');
  assert.equal(f1.params.severity, 'medium', 'medium when nothing keys it');
  assert.equal(f1.params.measure.keyed, false);

  // The same bone keyed by an animation: now it is wasted work.
  const keyed = clone(idle);
  keyed.animations = { slide: { bones: { ghost: { translate: [{ x: 0, y: 0 }, { time: 1, x: 50, y: 0 }] } } } };
  const r2 = await critiqueRig(keyed);
  const [f2] = byCode(r2, 'bone-unused');
  assert.equal(f2.params.severity, 'high', 'high when keyed');
  assert.match(f2.params.fix, /keys are wasted/);
  assert.equal(r2.verdict, 'attention');

  // Bones that DO something are never flagged.
  assert.deepEqual(byCode(await critiqueRig(base), 'bone-unused'), []);
});

test('a parent bone with children is in use; so is a constraint bone', async () => {
  const sk = chest(80, false);
  sk.bones.push({ name: 'arm', parent: 'root' }, { name: 'hand', parent: 'arm' }, { name: 'aim', parent: 'root' });
  sk.slots.push({ name: 'glove', bone: 'hand' });
  sk.ik = [{ name: 'reach', bones: ['hand'], target: 'aim' }];
  assert.deepEqual(byCode(await critiqueRig(sk), 'bone-unused'), []);
});

test('a bone that works only through weights is not unused (the mesh carries it)', async () => {
  const sk = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'a', parent: 'root' }, { name: 'b', parent: 'root', x: 50 }],
    slots: [{ name: 's', bone: 'a', attachment: 'm' }],
    skins: [{ name: 'default', attachments: { s: { m: {
      type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      // 4 vertices, each bound to bone index 2 ("b")
      vertices: [1, 2, 0, 0, 1, 1, 2, 10, 0, 1, 1, 2, 10, 10, 1, 1, 2, 0, 10, 1],
      triangles: [0, 1, 2, 0, 2, 3], hull: 4 } } } }],
    animations: {},
  };
  const r = await critiqueRig(sk);
  assert.ok(byCode(r, 'bone-unused').every(f => f.where !== 'bones/b'));
  assert.equal(r.counts.attachments, 1, 'the weighted mesh has world geometry');
});

test('a bone that only shapes a weighted path is in use (legacy flagged it)', async () => {
  const sk = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'track', parent: 'root' }, { name: 'bend', parent: 'root', x: 40 }, { name: 'rider', parent: 'root' }],
    slots: [{ name: 'rail', bone: 'track', attachment: 'p' }, { name: 'car', bone: 'rider', attachment: 'c' }],
    skins: [{ name: 'default', attachments: {
      rail: { p: { type: 'path', closed: false, constantSpeed: true, vertexCount: 3, lengths: [10],
        vertices: [1, 1, 0, 0, 1, 1, 2, 5, 0, 1, 1, 2, 10, 0, 1] } },
      car: { c: { width: 4, height: 4 } } } }],
    path: [{ name: 'follow', bones: ['rider'], target: 'rail' }],
  };
  const r = await critiqueRig(sk);
  assert.deepEqual(byCode(r, 'bone-unused'), [], JSON.stringify(r.findings.map(f => f.where)));
});

test('a path constraint targets a slot: an idle bone with that name is still reported (legacy missed it)', async () => {
  const sk = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'track', parent: 'root' }, { name: 'rider', parent: 'root' }, { name: 'rail', parent: 'root' }],
    slots: [{ name: 'rail', bone: 'track', attachment: 'p' }, { name: 'car', bone: 'rider', attachment: 'c' }],
    skins: [{ name: 'default', attachments: {
      rail: { p: { type: 'path', closed: false, constantSpeed: true, vertexCount: 3, lengths: [10], vertices: [0, 0, 5, 0, 10, 0] } },
      car: { c: { width: 4, height: 4 } } } }],
    path: [{ name: 'follow', bones: ['rider'], target: 'rail' }],
  };
  const r = await critiqueRig(sk);
  assert.deepEqual(byCode(r, 'bone-unused').map(f => f.where), ['bones/rail']);
});

test('a constraint with no effect', async () => {
  const sk = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'k', parent: 'root' }, { name: 'h', parent: 'root' }],
    slots: [], skins: [],
    ik: [{ name: 'chain', bones: ['k'], target: 'h', mix: 0 }],
    animations: {},
  };
  const [f] = byCode(await critiqueRig(sk), 'constraint-no-effect');
  assert.ok(f, 'a mix 0 constraint is reported');
  assert.equal(f.where, 'ik/chain');
  assert.match(f.params.why, /does not move/, 'the consequence is explained');
  assert.deepEqual(f.params.measure.mix, { mix: 0 });
  assert.equal(f.params.severity, 'medium');

  // An animation that opens the mix makes it intentional: silent.
  const opened = clone(sk);
  opened.animations = { open: { ik: { chain: [{ mix: 0 }, { time: 1, mix: 1 }] } } };
  assert.deepEqual(byCode(await critiqueRig(opened), 'constraint-no-effect'), []);
});

test('constraint mixes are read with the parser defaults (legacy called a partly zeroed one inert)', async () => {
  const base = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'k', parent: 'root' }, { name: 'h', parent: 'root' }],
    slots: [], skins: [], animations: {},
  };
  // Only mixRotate is written; mixX, mixY, mixScale and mixShearY default to 1.
  const partial = { ...clone(base), transform: [{ name: 'follow', bones: ['k'], target: 'h', mixRotate: 0 }] };
  assert.deepEqual(byCode(await critiqueRig(partial), 'constraint-no-effect'), []);
  const zeroed = { ...clone(base), transform: [{ name: 'follow', bones: ['k'], target: 'h',
    mixRotate: 0, mixX: 0, mixScaleX: 0, mixShearY: 0 }] };
  const [f] = byCode(await critiqueRig(zeroed), 'constraint-no-effect');
  assert.equal(f?.where, 'transform/follow', 'mixY and mixScaleY follow their x partners down to 0');
  assert.deepEqual(f.params.measure.mix, { mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 });
  const physics = { ...clone(base), physics: [{ name: 'wobble', bone: 'k', mix: 0 }] };
  assert.equal(byCode(await critiqueRig(physics), 'constraint-no-effect')[0]?.where, 'physics/wobble');
});

test('world geometry comes from the runtime: a non-uniform parent scale under a rotated child', async () => {
  // Parent scaled (2, 1), child rotated 90 degrees, a 100 x 40 region on the child.
  // World matrix = S(2,1) * R(90) = [0 -2; 1 0]: the box is 80 wide and 100 tall. Legacy
  // composed scale per bone and got 40 x 200.
  const sk = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'body', parent: 'root', scaleX: 2 }, { name: 'flap', parent: 'body', rotation: 90 }],
    slots: [{ name: 'flap', bone: 'flap', attachment: 'f' }],
    skins: [{ name: 'default', attachments: { flap: { f: { width: 100, height: 40 } } } }],
    animations: { turn: { bones: { flap: { rotate: [{ value: 0 }, { time: 1, value: 30 }] } } } },
  };
  const [f] = byCode(await critiqueRig(sk), 'pivot-centered');
  assert.deepEqual(f.params.measure.artBox, { w: 80, h: 100 });
  assert.deepEqual(f.params.measure.suggestedEdges.right, { x: 40, y: 0 });
});

test('a region with an offset is placed by its attachment transform', async () => {
  // The art hangs 30 units below its bone: the pivot is on the edge, a correct hinge.
  const sk = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'door', parent: 'root', y: 50 }],
    slots: [{ name: 'door', bone: 'door', attachment: 'd' }],
    skins: [{ name: 'default', attachments: { door: { d: { width: 20, height: 60, y: -30 } } } }],
    animations: { swing: { bones: { door: { rotate: [{ value: 0 }, { time: 1, value: 40 }] } } } },
  };
  assert.deepEqual(byCode(await critiqueRig(sk), 'pivot-centered'), []);
  sk.skins[0].attachments.door.d.y = 0;
  assert.equal(byCode(await critiqueRig(sk), 'pivot-centered').length, 1);
});

test('a clean rig says clean, and the doctor never touches the rig', async () => {
  const sk = chest(80, true);
  const before = JSON.stringify(sk);
  const r = await critiqueRig(sk);
  assert.equal(r.verdict, 'clean');
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary, 'No visible gap in how the rig is built.');
  assert.deepEqual(r.counts, { bones: 2, slots: 1, attachments: 1 });
  assert.equal(JSON.stringify(sk), before, 'the skeleton is unchanged (diagnosis is not editing)');
  assert.match(r.note, /never touches the rig/, 'the output states its own boundary');
});

test('findings are advice: never fatal, high first, with a summary that counts them', async () => {
  const sk = chest(100, true);
  sk.bones.push({ name: 'ghost', parent: 'root' });
  sk.ik = [{ name: 'chain', bones: ['ghost'], target: 'root', mix: 0 }];
  sk.bones.push({ name: 'spare', parent: 'root' });
  const r = await critiqueRig(sk);
  assert.deepEqual(r.findings.map(f => [f.code, f.params.severity]),
    [['pivot-centered', 'high'], ['bone-unused', 'medium'], ['constraint-no-effect', 'medium']]);
  assert.equal(r.summary, '1 high, 2 medium, 0 low findings.');
  assert.deepEqual(fatalsOf(r.findings), []);
  for (const f of r.findings) assert.deepEqual(Object.keys(f), ['level', 'code', 'where', 'message', 'params']);
  const minor = chest(80, false);
  minor.bones.push({ name: 'spare', parent: 'root' });
  assert.equal((await critiqueRig(minor)).verdict, 'minor-notes');
});

test('a caller can hand in the parsed data and the setup pose', async () => {
  const sk = chest(100, true);
  const data = await parseSkeleton(sk);
  const setup = await poseSetup(data);
  const injected = await critiqueRig(sk, { data, setup });
  assert.deepEqual(injected, await critiqueRig(sk));
  const other = await poseSetup(await parseSkeleton(readJson('nova')));
  await assert.rejects(critiqueRig(sk, { setup: other }), err => isStudioError(err, 'bad-argument'));
});

test('refusals carry codes: no bones, or a skeleton for another runtime line', async () => {
  await assert.rejects(critiqueRig({}), err => isStudioError(err, 'bad-argument'));
  await assert.rejects(critiqueRig({ bones: [] }), err => isStudioError(err, 'bad-argument'));
  const old = chest(80, true);
  old.skeleton.spine = '3.8.99';
  await assert.rejects(critiqueRig(old), err => isStudioError(err, 'runtime-version'));
});

test('end to end on the real fixtures', async () => {
  // Both fixtures are built correctly: every bone carries art, nothing rotates.
  const ident = readJson('ident');
  const clean = await critiqueRig(ident);
  assert.equal(clean.verdict, 'clean', JSON.stringify(clean.findings));
  assert.deepEqual(clean.counts, { bones: 6, slots: 5, attachments: 5 });
  // Rotate the wordmark: its bone sits at the centre of the art, which a spin allows but
  // a hinge does not, so the doctor names it with the runtime's world numbers.
  const spun = clone(ident);
  const [first] = Object.keys(spun.animations);
  spun.animations[first].bones.b_word = { rotate: [{ value: 0 }, { time: 1, value: 10 }] };
  const [f] = byCode(await critiqueRig(spun), 'pivot-centered');
  assert.equal(f.where, 'bones/b_word');
  assert.deepEqual(f.params.measure.boneWorld, { x: 0, y: 16 });
  assert.deepEqual(f.params.measure.artCentre, { x: 0, y: 16 });
  assert.deepEqual(f.params.measure.artBox, { w: 289, h: 74 });

  const nova = readJson('nova');
  assert.equal((await critiqueRig(nova)).verdict, 'clean');
  const extra = clone(nova);
  extra.bones.push({ name: 'b_spare', parent: 'root' });
  const [novaName] = Object.keys(extra.animations);
  extra.animations[novaName].bones.b_spare = { translate: [{ x: 0, y: 0 }, { time: 1, x: 5, y: 0 }] };
  const [unused] = byCode(await critiqueRig(extra), 'bone-unused');
  assert.equal(unused.where, 'bones/b_spare');
  assert.equal(unused.params.severity, 'high');
});
