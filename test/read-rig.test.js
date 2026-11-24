// Gate for src/understand/read-rig.js: the bone tree, slots, weights, constraints and the
// animation summary, read from the JSON; world transforms from the official runtime.
// Ported from the rig assertions of legacy test_inspect.js, test_inherit.js,
// test_shear.js, test_read_cost.js and test_frame_grid.js. Where legacy pinned its own
// world-transform maths, the same expectation is now asked of the runtime through
// readRigOnRuntime, and the reader must report what the runtime posed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  readRig, readRigOnRuntime, attachmentsIndex, meshWeights, CONSTRAINT_DEFAULTS,
} from '../src/understand/read.js';
import { IK_SILENT_NOTE } from '../src/understand/read-rig.js';
import { parseSkeleton, poseSetup } from '../src/runtime/index.js';
import { needsSpine } from './helpers/spine-addon.js';
import { isStudioError } from '../src/shared/errors.js';

const readFixture = path => JSON.parse(fs.readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8'));
const near = (actual, expected, label, eps = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
// Rough but consistent token measure used by legacy: ~3.5 characters per token.
const tokens = o => Math.round(JSON.stringify(o).length / 3.5);

// Two bones, one under a rotated and scaled parent; a control bone with no slot; a region
// slot and an unweighted mesh slot; an IK aiming the child at the control bone.
const BASE = () => ({
  skeleton: { hash: 'h', spine: '4.2.43', x: 0, y: 0, width: 100, height: 100, images: '', audio: '' },
  bones: [
    { name: 'root' },
    { name: 'p', parent: 'root', x: 10, y: 0, rotation: 90, scaleX: 2, scaleY: 2 },
    { name: 'b', parent: 'p', x: 5, y: 0 },
    { name: 'control', parent: 'root', x: -40, y: 60 },
  ],
  slots: [{ name: 's', bone: 'b', attachment: 's' }, { name: 'mouth', bone: 'b', attachment: 'mouth' }],
  skins: [{ name: 'default', attachments: {
    s: { s: { width: 10, height: 20 } },
    mouth: { mouth: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [0, 0, 10, 0, 10, 10], hull: 3 } },
  } }],
  ik: [{ name: 'arm_ik', bones: ['b'], target: 'control' }],
  animations: {},
});

test('the bone tree: counts, children, a control bone without slots, setup values', () => {
  const rig = readRig(BASE());
  assert.deepEqual(rig.counts, { bones: 4, slots: 2, constraints: 1, animations: 0 });
  const root = rig.bones.find(b => b.name === 'root');
  assert.ok(root.children.includes('p') && root.children.includes('control'), JSON.stringify(root.children));
  // A bone with no slot is still part of the rig (legacy: invisible in the scene document).
  const control = rig.bones.find(b => b.name === 'control');
  assert.deepEqual(control.slots, []);
  assert.equal(control.parent, 'root');
  assert.deepEqual(rig.bones.find(b => b.name === 'p').setup, { x: 10, y: 0, rotation: 90, scaleX: 2, scaleY: 2 });
  assert.deepEqual(rig.bones.find(b => b.name === 'b').slots, ['s', 'mouth']);
  assert.ok(rig.bones.every(b => !('world' in b)), 'no world transform without a runtime snapshot');
  assert.deepEqual(rig.setupDrawOrder, ['s', 'mouth']);
  assert.deepEqual(rig.skins, ['default']);
});

test('slots carry their attachment type; an unweighted mesh follows its slot bone', () => {
  const rig = readRig(BASE());
  const mouth = rig.slots.find(s => s.name === 'mouth');
  assert.equal(mouth.type, 'mesh');
  assert.deepEqual(mouth.weights, { weighted: false, vertexCount: 3, followsBone: 'b' });
  const region = rig.slots.find(s => s.name === 's');
  assert.deepEqual([region.type, region.width, region.height, region.setupAttachment], ['region', 10, 20, 's']);
  assert.equal(rig.constraints.length, 1);
  assert.equal(rig.constraints[0].type, 'ik');
});

test('world transforms come from the runtime: parent rotation and scale, and constraints', async () => {
  const noIk = BASE();
  delete noIk.ik;
  const plain = (await readRigOnRuntime(noIk)).bones.find(b => b.name === 'b');
  // p sits at (10,0), turned 90 and scaled 2; b's local (5,0) lands at (10,10).
  near(plain.world.x, 10, 'b.world.x');
  near(plain.world.y, 10, 'b.world.y');
  near(plain.world.rotation, 90, 'b inherits the parent rotation');
  // With the IK, the runtime aims b at control (-40,60): atan2(50,-50) = 135 degrees.
  // Legacy's own walker skipped constraints and reported 90 here.
  const aimed = (await readRigOnRuntime(BASE())).bones.find(b => b.name === 'b');
  near(aimed.world.x, 10, 'IK leaves the position');
  near(aimed.world.y, 10, 'IK leaves the position');
  near(aimed.world.rotation, 135, 'IK rotation applied at setup');
});

test('an injected setup snapshot is the same as the runtime path, and must match the skeleton', async () => {
  const sk = BASE();
  const setup = await poseSetup(await parseSkeleton(sk));
  assert.deepEqual(readRig(sk, { setup }), await readRigOnRuntime(sk));
  const other = { ...BASE(), bones: [{ name: 'root' }] };
  const otherSetup = await poseSetup(await parseSkeleton({ ...other, slots: [], skins: [], ik: [] }));
  assert.throws(() => readRig(sk, { setup: otherSetup }),
    err => isStudioError(err, 'setup-mismatch') && err.details.missing.includes('p'));
  assert.throws(() => readRig(sk, { setup: {} }), err => isStudioError(err, 'bad-argument'));
});

// Legacy review 2026-08-07: `inherit` was ignored, so a noScale bone grew with its parent
// and an onlyTranslation bone turned with it. Spine's rule: position always passes through
// the parent; a mode removes rotation and/or scale inheritance.
const inheritRig = mode => ({
  skeleton: { spine: '4.2.43', hash: 'h' },
  bones: [
    { name: 'root' },
    { name: 'p', parent: 'root', rotation: 90, scaleX: 2, scaleY: 2 },
    { name: 'c', parent: 'p', x: 10, y: 0, rotation: 15, ...(mode ? { inherit: mode } : {}) },
  ],
  slots: [], skins: [], animations: {},
});

for (const [mode, rotation, scale] of [
  [null, 105, 2], ['onlyTranslation', 15, 1], ['noScale', 105, 1], ['noRotationOrReflection', 15, 2],
]) {
  test(`inherit ${mode ?? 'normal'}: the runtime poses it and the reader reports it`, async () => {
    const c = (await readRigOnRuntime(inheritRig(mode))).bones.find(b => b.name === 'c');
    near(c.world.x, 0, 'position passes through the parent');
    near(c.world.y, 20, 'position passes through the parent');
    near(c.world.rotation, rotation, 'world rotation');
    near(c.world.scaleX, scale, 'world scale');
    assert.equal(c.inherit, mode ?? undefined, 'a non-normal mode is stated');
  });
}

test('the 3.x `transform` name is read as the inherit mode; the 4.2 runtime refuses the file by name', async () => {
  const sk = inheritRig(null);
  sk.skeleton.spine = '3.8.99';
  sk.bones[2].transform = 'noScale';
  const rig = await readRigOnRuntime(sk);
  assert.equal(rig.bones[2].inherit, 'noScale');
  assert.equal(rig.worldUnavailable.code, 'runtime-version');
  assert.equal(rig.counts.bones, 3, 'the tree is read anyway');
});

const lidRig = () => ({
  skeleton: { spine: '4.2.43', hash: 'h', images: './', width: 100, height: 100 },
  bones: [{ name: 'root' }, { name: 'lid', parent: 'root', y: 50 }, { name: 'gift', parent: 'lid', y: 20 }],
  slots: [{ name: 'lidSlot', bone: 'lid', attachment: 'lid_closed' }],
  skins: [{ name: 'default', attachments: { lidSlot: {
    lid_closed: { width: 40, height: 20 }, lid_open: { width: 40, height: 24 } } } }],
  animations: {},
});

test('shear: a sheared parent moves the child in the world; an unsheared rig carries no shear fields', async () => {
  const sheared = lidRig();
  sheared.bones[1].shearY = 30;
  const tilted = (await readRigOnRuntime(sheared)).bones.find(b => b.name === 'gift');
  const straight = (await readRigOnRuntime(lidRig())).bones.find(b => b.name === 'gift');
  assert.ok(Math.abs(tilted.world.x - straight.world.x) > 1, `${straight.world.x} vs ${tilted.world.x}`);
  near(tilted.world.x, 20 * Math.cos(120 * Math.PI / 180), 'the Y axis points at 90 + shearY');
  assert.deepEqual((await readRigOnRuntime(sheared)).bones[1].setup.shearY, 30, 'setup shear is stated');
  const fixture = readRig(readFixture('read/sample_intro.json'));
  assert.ok(fixture.bones.length > 0);
  assert.ok(!/"shear[XY]"/.test(JSON.stringify(fixture)), 'no shear keys on a rig without shear');
});

test('a mirrored bone is flagged: the runtime reports world scale as a magnitude', async () => {
  const sk = lidRig();
  sk.bones[1].scaleX = -1;
  const rig = await readRigOnRuntime(sk);
  assert.equal(rig.bones.find(b => b.name === 'lid').world.mirrored, true);
  assert.equal(rig.bones.find(b => b.name === 'gift').world.mirrored, true, 'a child of a mirrored bone is mirrored too');
  assert.ok(!('mirrored' in rig.bones.find(b => b.name === 'root').world));
});

test('a slot with several attachments lists them; the attachments index covers every skin', () => {
  const rig = readRig(lidRig());
  assert.deepEqual(rig.slots[0].attachments, ['lid_closed', 'lid_open']);
  const index = attachmentsIndex(lidRig());
  assert.deepEqual(index.lidSlot.map(a => [a.name, a.skin, a.type, a.width, a.height]),
    [['lid_closed', 'default', 'region', 40, 20], ['lid_open', 'default', 'region', 40, 24]]);
});

test('weighted mesh: which bones the art follows, decoded the same way as the official parser', needsSpine, async () => {
  const sk = readFixture('read/weighted_sample.json');
  const rig = readRig(sk);
  const weighted = rig.slots.find(s => s.weights?.weighted);
  assert.ok(weighted, 'the fixture has a weighted mesh');
  const counts = weighted.weights.bones.map(b => b.vertices);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'most influential bone first');

  const data = await parseSkeleton(sk, { backend: 'spine' });
  const attachment = data.defaultSkin.getAttachment(data.findSlot(weighted.name).index, weighted.setupAttachment);
  const expected = new Map();
  for (let i = 0; i < attachment.bones.length;) {
    const n = attachment.bones[i++];
    for (let j = 0; j < n; j++, i++) {
      const name = data.bones[attachment.bones[i]].name;
      expected.set(name, (expected.get(name) ?? 0) + 1);
    }
  }
  assert.deepEqual(Object.fromEntries(weighted.weights.bones.map(b => [b.bone, b.vertices])), Object.fromEntries(expected));
  assert.equal(weighted.weights.vertexCount, attachment.worldVerticesLength / 2);
});

test('no attachment shown at setup but exactly one exists: that one is measured and named', () => {
  const sk = readFixture('read/weighted_sample.json');
  const slot = sk.slots.find(s => {
    const a = sk.skins[0].attachments[s.name]?.[s.attachment];
    return a?.type === 'mesh' && a.vertices.length !== a.uvs.length;
  });
  const attachmentName = slot.attachment;
  delete slot.attachment;
  const read = readRig(sk).slots.find(s => s.name === slot.name);
  assert.equal(read.setupAttachment, null);
  assert.equal(read.weights.attachment, attachmentName);
  assert.equal(read.weights.weighted, true);
});

test('path weights are read (legacy only knew the mesh uvs rule and never reported them)', () => {
  const boneNames = ['root', 'a', 'b'];
  const weightedPath = { type: 'path', vertexCount: 3, lengths: [10],
    vertices: [1, 0, 0, 0, 1, 2, 1, 0, 0, 0.5, 2, 0, 0, 0.5, 1, 2, 0, 0, 1] };
  assert.deepEqual(meshWeights(weightedPath, boneNames),
    { weighted: true, vertexCount: 3, bones: [{ bone: 'b', vertices: 2 }, { bone: 'root', vertices: 1 }, { bone: 'a', vertices: 1 }] });
  assert.deepEqual(meshWeights({ type: 'path', vertexCount: 3, vertices: [0, 0, 1, 1, 2, 2] }, boneNames),
    { weighted: false, vertexCount: 3 });
  assert.equal(meshWeights({ type: 'mesh', vertices: [3, 0, 0, 0, 1] , uvs: [0, 0, 1, 1, 0, 1] }, boneNames), null,
    'a layout we do not know is not guessed');
  assert.equal(meshWeights({ type: 'linkedmesh', parent: 'x' }, boneNames), null, 'a linked mesh borrows its parent');
});

test('constraint settings are read, defaults are named, silent constraints are flagged', () => {
  const sk = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'k1', parent: 'root' }, { name: 'target', parent: 'root' }, { name: 'flag', parent: 'root' }],
    slots: [], skins: [],
    ik: [{ name: 'arm_ik', bones: ['k1'], target: 'target', mix: 0, softness: 12 }],
    physics: [{ name: 'wind', bone: 'flag', strength: 180, damping: 0.6, wind: 20, gravity: -9, mix: 1, fps: 30 }],
    transform: [{ name: 'tr1', bones: ['k1'], target: 'target', mixRotate: 0.5, order: 2, skinRequired: true }],
    animations: {},
  };
  const c = readRig(sk).constraints;
  const ik = c.find(x => x.type === 'ik');
  const physics = c.find(x => x.type === 'physics');
  const transform = c.find(x => x.type === 'transform');
  assert.equal(ik.settings.mix, 0);
  assert.equal(ik.settings.softness, 12);
  assert.equal(ik.note, IK_SILENT_NOTE, 'mix 0 is flagged: the agent mistake legacy saw most');
  assert.ok(ik.defaulted.includes('bendPositive'), 'an absent field is a default, not unreadable');
  assert.ok(!ik.defaulted.includes('mix'));
  assert.deepEqual([physics.settings.strength, physics.settings.damping, physics.settings.wind, physics.settings.gravity], [180, 0.6, 20, -9]);
  assert.equal(physics.settings.fps, 30, 'the simulation rate is written as fps');
  assert.match(physics.note, /runtime/, 'physics points at measuring on the runtime');
  assert.deepEqual(physics.bones, ['flag'], 'a single `bone` field is a bone list of one');
  assert.equal(transform.settings.mixRotate, 0.5);
  assert.deepEqual([transform.target, transform.order, transform.skinRequired], ['target', 2, true]);
  assert.ok(!('note' in transform));
  for (const [type, defaults] of Object.entries(CONSTRAINT_DEFAULTS)) {
    assert.ok(Object.keys(defaults).length > 0, type);
  }
  // With every field written, nothing is reported as defaulted.
  const full = readRig({ ...sk, physics: [], transform: [],
    ik: [{ name: 'i', bones: ['k1'], target: 'target', ...CONSTRAINT_DEFAULTS.ik }] }).constraints[0];
  assert.ok(!('defaulted' in full));
  assert.ok(!('note' in full), 'an IK at mix 1 is not flagged');
});

test('reading a 30-constraint rig stays cheap', () => {
  const bones = [{ name: 'root' }];
  const ik = [];
  for (let i = 0; i < 30; i++) {
    bones.push({ name: `b${i}`, parent: 'root' });
    ik.push({ name: `ik${i}`, bones: [`b${i}`], target: 'root', mix: 1 });
  }
  const cost = tokens(readRig({ skeleton: { spine: '4.2' }, bones, slots: [], skins: [], ik, animations: {} }));
  assert.ok(cost < 6000, `${cost} tokens`);
});

test('skeleton-level constraints are arrays: a physics constraint is in the inventory', () => {
  const sk = BASE();
  sk.physics = [{ name: 'car2', bone: 'b', rotate: 1, inertia: 0.5 }];
  sk.animations.run = {
    bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 8 }] } },
    physics: { car2: { inertia: [{ value: 0.1 }] } },
    attachments: { default: { mouth: { mouth: { deform: [{ vertices: [-85.27, -44.63] }] } } } },
  };
  const rig = readRig(sk);
  assert.ok(rig.constraints.some(c => c.type === 'physics' && c.name === 'car2'));
  const run = rig.animations.find(a => a.name === 'run');
  assert.equal(run.duration, 1);
  assert.ok(run.channels.includes('physics.inertia') && run.channels.includes('deform'), JSON.stringify(run.channels));
  assert.ok(!('issues' in rig));
});

test('broken animation blocks do not hold the bone tree hostage', () => {
  const sk = BASE();
  sk.animations.a = {
    bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 2, value: 10 }], odd: { not: 'an array' } } },
    ik: { k: 'string' }, physics: { p: { inertia: 42 } },
    attachments: { default: { mouth: { mouth: { deform: { again: 'not an array' } } } } },
    drawOrder: { broken: true },
  };
  sk.animations.empty = null;
  const rig = readRig(sk);
  assert.equal(rig.counts.bones, BASE().bones.length);
  const codes = rig.issues.map(f => `${f.code}@${f.where}`);
  for (const where of ['bones/b/odd', 'ik/k', 'physics/p/inertia', 'deform/default/mouth/mouth/deform', 'drawOrder']) {
    assert.ok(codes.includes(`channel-shape@${where}`), `${where} in ${codes.join(', ')}`);
  }
  assert.ok(rig.issues.every(f => f.level === 'warn' && f.message.length > 10 && typeof f.params === 'object'));
  assert.equal(new Set(codes).size, codes.length, 'each skipped channel is reported once');
  assert.match(rig.issuesNote, /unaffected/);
  const a = rig.animations.find(x => x.name === 'a');
  assert.equal(a.duration, 2, 'the sound rotate channel is still read');
  assert.ok(a.channels.includes('rotate'));
  const empty = rig.animations.find(x => x.name === 'empty');
  assert.equal(typeof empty.error, 'string', 'an unreadable animation is marked, not thrown');
  assert.ok(codes.includes('animation-unreadable@animations/empty'));
});

test('the animation summary counts keys between frames', () => {
  const sk = { skeleton: { spine: '4.2' }, bones: [{ name: 'root' }, { name: 'k', parent: 'root' }], slots: [], skins: [],
    animations: { a: { bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 0.7833, value: 10 }, { time: 1, value: 0 }] } } } } };
  const summary = readRig(sk).animations[0];
  assert.equal(summary.offGridKeys, 1);
  assert.deepEqual([summary.boneCount, summary.slotCount], [1, 0]);
  assert.equal(readRig(sk, { fps: 60 }).animations[0].offGridKeys, 0, 'the same key is frame 46.998 at 60 fps: on the grid');
});

test('a file the runtime refuses still reads as a tree, without world transforms', async () => {
  const sk = readFixture('read/sample_intro.json');
  const rig = await readRigOnRuntime(sk);
  assert.equal(rig.worldUnavailable.code, 'runtime-parse');
  assert.equal(rig.counts.bones, sk.bones.length);
  assert.ok(rig.bones.every(b => !('world' in b)));
  assert.deepEqual({ ...rig, worldUnavailable: undefined }, { ...readRig(sk), worldUnavailable: undefined });
});

test('a draw-order key that would crash the runtime is caught before the runtime sees it', async () => {
  const sk = BASE();
  // Offsets out of slot order: measured to run spine-ts out of memory, uncatchable.
  sk.animations.d = { drawOrder: [{ time: 0, offsets: [{ slot: 'mouth', offset: -1 }, { slot: 's', offset: 1 }] }] };
  const rig = await readRigOnRuntime(sk);
  assert.equal(rig.worldUnavailable.code, 'draw-order-offsets');
  assert.deepEqual(rig.worldUnavailable.findings.map(f => [f.level, f.code, f.where]),
    [['fatal', 'draw-order-unsorted', 'animations/d/drawOrder/0']]);
  assert.equal(rig.counts.bones, 4);
});

test('bad input is refused with a code; an unknown skin is the caller mistake and throws', async () => {
  assert.throws(() => readRig(null), err => isStudioError(err, 'bad-skeleton'));
  assert.throws(() => readRig({ slots: [] }), err => isStudioError(err, 'bad-skeleton'));
  await assert.rejects(readRigOnRuntime({}), err => isStudioError(err, 'bad-skeleton'));
  await assert.rejects(readRigOnRuntime(BASE(), { skin: 'missing' }), err => isStudioError(err, 'unknown-skin'));
});

test('reading never changes the input', async () => {
  const sk = readFixture('read/weighted_sample.json');
  const before = structuredClone(sk);
  readRig(sk);
  await readRigOnRuntime(sk);
  assert.deepEqual(sk, before);
});

test('bone length is reported unless asked not to', () => {
  const sk = readFixture('read/weighted_sample.json');
  const withLength = readRig(sk).bones.filter(b => 'length' in b);
  assert.ok(withLength.length > 0);
  assert.ok(readRig(sk, { includeLength: false }).bones.every(b => !('length' in b)));
});
