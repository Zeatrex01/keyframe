// Gate for src/understand/read-animation.js: measurements by default, compressed keys on
// request, constraint and deform sections, the frame grid, draw-order changes resolved by
// the official runtime.
// Ported from the animation assertions of legacy test_inspect.js, test_read_cost.js,
// test_frame_grid.js, test_alpha.js, test_shear.js and test_loop.js. Legacy checked its
// own sampler's numbers; here the runtime poses the same files and the reader's report
// must agree with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAnimation, readAnimationOnRuntime, readRig, drawOrderKeyTimes } from '../src/understand/read.js';
import { parseSkeleton, sampleAnimation } from '../src/runtime/index.js';
import { needsSpine } from './helpers/spine-addon.js';
import { isStudioError } from '../src/shared/errors.js';

const readFixture = path => JSON.parse(fs.readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8'));
const near = (actual, expected, label, eps = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
const tokens = o => Math.round(JSON.stringify(o).length / 3.5);

const BASE = () => ({
  skeleton: { hash: 'h', spine: '4.2.43', x: 0, y: 0, width: 100, height: 100, images: '', audio: '' },
  bones: [
    { name: 'root' },
    { name: 'p', parent: 'root', x: 10, y: 0, rotation: 90, scaleX: 2, scaleY: 2 },
    { name: 'b', parent: 'p', x: 5, y: 0 },
  ],
  slots: [{ name: 's', bone: 'b', attachment: 's' }, { name: 'mouth', bone: 'b', attachment: 'mouth' }],
  skins: [{ name: 'default', attachments: {
    s: { s: { width: 10, height: 20 } },
    mouth: { mouth: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [0, 0, 10, 0, 10, 10], hull: 3 } },
  } }],
  animations: {},
});
const withAnimation = (name, anim, base = BASE()) => ({ ...base, animations: { ...base.animations, [name]: anim } });

const ROTATE = withAnimation('a', { bones: { b: { rotate: [
  { time: 0, value: 0, curve: [0.3333, 30, 0.6667, 60] }, { time: 1, value: 90 },
] } } });

test('the default is the measurement: duration, channels, amplitude, no raw keys', () => {
  const r = readAnimation(ROTATE, 'a');
  assert.equal(r.duration, 1);
  assert.ok(r.channels.includes('rotate'));
  const m = r.bones.b.rotate;
  assert.deepEqual([m.keys, m.first, m.last], [2, 0, 1]);
  assert.deepEqual(m.value, { min: 0, max: 90, amplitude: 90 });
  assert.ok(!('keys' in m && Array.isArray(m.keys)), 'raw keys are not in the default answer (cost)');
  assert.ok(!('measure' in m));
});

test('detail adds compressed column arrays next to the measurement; raw is Spine form', () => {
  const d = readAnimation(ROTATE, 'a', { detail: true }).bones.b.rotate;
  assert.deepEqual(d.keys.time, [0, 1]);
  assert.deepEqual(d.keys.value, [0, 90]);
  assert.deepEqual(d.keys.curve, ['bezier', 'linear']);
  assert.ok(d.measure && d.measure.keys === 2, 'detail carries the measurement too');
  assert.deepEqual(readAnimation(ROTATE, 'a', { detail: 'keys' }).bones.b.rotate, d, "'keys' is accepted as detail");
  const raw = readAnimation(ROTATE, 'a', { detail: true, raw: true }).bones.b.rotate.keys;
  assert.deepEqual(raw, ROTATE.animations.a.bones.b.rotate, 'raw returns the keys exactly as written');
  assert.deepEqual(Object.keys(readAnimation(ROTATE, 'a', { detail: true, bones: ['not_here'] }).bones), [],
    'the bones filter brings no other bone');
});

test('an unknown animation is refused with the available names', () => {
  assert.throws(() => readAnimation(ROTATE, 'nope'),
    err => isStudioError(err, 'unknown-animation') && err.details.available.includes('a') && /Available: a/.test(err.message));
  assert.throws(() => readAnimation(null, 'a'), err => isStudioError(err, 'bad-skeleton'));
});

// An animation carrying only physics or deform measured as duration 0 with no channels,
// and the agent thought it was empty. These channels are not written but must be read.
test('constraint and deform channels count for duration, channels and their sections', () => {
  const sk = withAnimation('a', {
    physics: { tail: { inertia: [{ time: 0, value: 1 }, { time: 2.5, value: 0.4 }] } },
    ik: { arm_ik: [{ time: 0, mix: 1 }, { time: 1.2, mix: 0 }] },
    attachments: { default: { mouth: { mouth: [
      { time: 0, offset: 0, vertices: [0, 0] }, { time: 0.8, offset: 0, vertices: [3, 1] },
    ] } } },
  });
  const r = readAnimation(sk, 'a');
  assert.equal(r.duration, 2.5, 'the latest key of any section, physics included');
  for (const c of ['physics.inertia', 'ik', 'deform']) assert.ok(r.channels.includes(c), `${c} in ${r.channels}`);
  assert.deepEqual(r.constraints.physics.tail.inertia, { keys: 2, first: 0, last: 2.5 });
  assert.deepEqual(r.constraints.ik.arm_ik, { keys: 2, first: 0, last: 1.2 });
  assert.deepEqual(r.deform, [{ skin: 'default', slot: 'mouth', attachment: 'mouth', timeline: 'deform', keys: 2, first: 0, last: 0.8 }]);
  assert.deepEqual(readAnimation(sk, 'a', { detail: true }).constraints.ik, sk.animations.a.ik, 'detail returns the raw section');
  // The 3.8 name of the deform section reads too.
  const old = withAnimation('a', { deform: { default: { mouth: { mouth: [{ time: 0 }, { time: 1.5 }] } } } });
  assert.equal(readAnimation(old, 'a').duration, 1.5);
});

// Legacy FINDING-001: three tools crashed at once on the owner's real file. Skeleton-level
// constraints are arrays, animation-level ones objects; 4.2 deform is four levels deep; a
// physics key has no time.
test('4.2 shapes read without a crash, and the runtime agrees on the duration', async () => {
  const sk = withAnimation('run', {
    bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 8 }] } },
    physics: { car2: { inertia: [{ value: 0.1 }] } },
    attachments: { default: { mouth: { mouth: { deform: [{ vertices: [-85.27, -44.63] }] } } } },
  });
  sk.physics = [{ name: 'car2', bone: 'b', rotate: 1, inertia: 0.5 }];
  const r = readAnimation(sk, 'run');
  assert.ok(r.channels.includes('physics.inertia'));
  assert.ok(r.channels.includes('deform'));
  assert.equal(r.deform.length, 1);
  assert.equal(r.duration, 1, 'a key without time is at t=0');
  assert.ok(!('issues' in r));
  const data = await parseSkeleton(sk);
  near(data.findAnimation('run').duration, r.duration, 'runtime duration');
});

test('keys without time: the reader measures them at t=0, the runtime poses them there', async () => {
  const sk = withAnimation('z', { bones: {
    b: { rotate: [{ value: 8 }], translate: [{ x: 5, y: 3 }] },
    p: { scale: [{ x: 1, y: 1 }, { time: 1, x: 2, y: 2 }] },
  } });
  const r = readAnimation(sk, 'z');
  assert.equal(r.duration, 1);
  assert.deepEqual([r.bones.b.rotate.first, r.bones.b.rotate.last, r.bones.b.rotate.value.min], [0, 0, 8]);
  assert.deepEqual(r.bones.p.scale.x, { min: 1, max: 2, amplitude: 1 });
  const [t0, mid, t1] = await sampleAnimation(await parseSkeleton(sk), 'z', [0, 0.5, 1]);
  const bone = (s, name) => s.bones.find(b => b.name === name);
  near(bone(t0, 'b').rotation, 8, 'a single time-less key applies at t=0');
  near(bone(t1, 'b').rotation, 8, 'and holds');
  // Setup scaleX is 2 and the timeline multiplies (1 -> 2): 2 x 1.5 = 3 at t=0.5.
  near(bone(mid, 'p').scaleX, 3, 'interpolated from a time-less first key', 0.02);
});

test('broken blocks are skipped and reported; the sound channels are still read', () => {
  const sk = withAnimation('a', {
    bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 2, value: 10 }], odd: { not: 'an array' } } },
    ik: { k: 'string' },
  });
  const r = readAnimation(sk, 'a');
  assert.equal(r.duration, 2);
  assert.deepEqual(Object.keys(r.bones.b), ['rotate']);
  assert.deepEqual(r.issues.map(f => `${f.code}@${f.where}`).sort(), ['channel-shape@bones/b/odd', 'channel-shape@ik/k']);
});

// The studio once dropped many half keyframes (23.5, 21.5).
test('the frame grid: a key between frames is counted and located; Spine rounding is not', () => {
  const inherited = { skeleton: { spine: '4.2' }, bones: [{ name: 'root' }, { name: 'k', parent: 'root' }], slots: [], skins: [],
    animations: { a: { bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 0.7833, value: 10 }, { time: 1, value: 0 }] } } } } };
  const grid = readAnimation(inherited, 'a').frameGrid;
  assert.equal(grid.offGridKeys, 1);
  assert.equal(grid.keys, 3);
  near(grid.examples[0].frame, 23.5, 'the frame number is stated', 0.01);
  assert.deepEqual([grid.examples[0].channel, grid.examples[0].where, grid.examples[0].time], ['rotate', 'bones/k/rotate', 0.7833]);
  assert.match(grid.note, /between two frames/, 'why it matters is explained');

  const onFrames = structuredClone(inherited);
  onFrames.animations.a.bones.k.rotate[1].time = 23 / 30;
  assert.equal(readAnimation(onFrames, 'a').frameGrid.offGridKeys, 0, 'whole-frame keys are clean');
  assert.ok(!('roundedKeys' in readAnimation(onFrames, 'a').frameGrid));

  // Spine writes frame 4 as 0.1333 (frame 3.999): its own rounding, not a defect.
  const rounded = structuredClone(inherited);
  rounded.animations.a.bones.k.rotate[1].time = 0.1333;
  const r = readAnimation(rounded, 'a').frameGrid;
  assert.deepEqual([r.offGridKeys, r.roundedKeys], [0, 1]);
  assert.match(r.roundedNote, /not a defect/);
  assert.equal(readAnimation(inherited, 'a', { fps: 24 }).frameGrid.fps, 24);
});

test('times keep six digits: frame 23 at 30 fps reads back as 0.766667, not 0.767', () => {
  const sk = withAnimation('a', { bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 23 / 30, value: 5 }] } } });
  const r = readAnimation(sk, 'a');
  assert.equal(r.duration, 0.766667);
  assert.equal(r.bones.b.rotate.last, 0.766667);
  assert.equal(readAnimation(sk, 'a', { detail: true }).bones.b.rotate.keys.time[1], 0.766667);
});

// Legacy measured every non-rotate channel on x/y, so a single-axis timeline read as
// amplitude 0: a door sliding 400 units "stood still".
test('single-axis channels are measured on their value', async () => {
  const sk = withAnimation('door', { bones: { b: {
    translatex: [{ time: 0, value: 0 }, { time: 1, value: 400 }],
    scaley: [{ time: 0 }, { time: 1, value: 0.5 }],
  } } });
  const r = readAnimation(sk, 'door');
  assert.deepEqual(r.bones.b.translatex.value, { min: 0, max: 400, amplitude: 400 });
  assert.deepEqual(r.bones.b.scaley.value, { min: 0.5, max: 1, amplitude: 0.5 }, 'a missing scale value is 1');
  assert.ok(!('x' in r.bones.b.translatex));
  assert.deepEqual(readAnimation(sk, 'door', { detail: true }).bones.b.translatex.keys.value, [0, 400]);
  const [end] = await sampleAnimation(await parseSkeleton(sk), 'door', [1]);
  near(end.bones.find(b => b.name === 'b').x, 5 + 400, 'the runtime moves the door the measured 400');
});

test('slot alpha and rgba: compressed values agree with the runtime, which interpolates', async () => {
  const sk = withAnimation('fade', { slots: {
    s: { alpha: [{ value: 1 }, { time: 1, value: 0 }] },
    mouth: { rgba: [{ color: 'ff8800ff' }, { time: 0.5, color: 'ffffffff' }, { time: 1, color: 'ff880040' }] },
  } });
  sk.slots[0].color = 'ff8800ff';
  const summary = readAnimation(sk, 'fade');
  assert.deepEqual(summary.slots.s.alpha, { keys: 2, first: 0, last: 1 });
  assert.ok(summary.channels.includes('slot.alpha') && summary.channels.includes('slot.rgba'));
  const detail = readAnimation(sk, 'fade', { detail: true }).slots;
  assert.deepEqual(detail.s.alpha, { time: [0, 1], value: [1, 0] });
  assert.deepEqual(detail.mouth.rgba.color, ['ff8800ff', 'ffffffff', 'ff880040']);
  const samples = await sampleAnimation(await parseSkeleton(sk), 'fade', [0, 0.5, 0.75, 1]);
  const alpha = (s, slot) => s.slots.find(x => x.name === slot).color.a;
  near(alpha(samples[0], 's'), detail.s.alpha.value[0], 'alpha at the first key');
  near(alpha(samples[3], 's'), detail.s.alpha.value[1], 'alpha at the last key');
  near(alpha(samples[1], 's'), 0.5, 'mid-fade is interpolated, not stepped', 0.01);
  near(alpha(samples[3], 'mouth'), 0x40 / 255, 'rgba alpha is the last two hex digits');
  const between = alpha(samples[2], 'mouth');
  assert.ok(between > 0x40 / 255 && between < 1, `rgba alpha between keys: ${between}`);
});

test('shear: measured on x and y, and the runtime tilts the bone by the measured amount', async () => {
  const sk = withAnimation('tilt', { bones: { b: { shear: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 30 }] } } });
  const r = readAnimation(sk, 'tilt');
  assert.deepEqual(r.bones.b.shear.x, { min: 0, max: 30, amplitude: 30 });
  assert.deepEqual(r.bones.b.shear.y, { min: 0, max: 0, amplitude: 0 }, 'a missing shear y is 0, not mirrored from x');
  assert.deepEqual(readAnimation(sk, 'tilt', { detail: true }).bones.b.shear.keys, { time: [0, 1], x: [0, 30], y: [0, null] });
  const [t0, mid, t1] = await sampleAnimation(await parseSkeleton(sk), 'tilt', [0, 0.5, 1]);
  const shearX = s => s.bones.find(b => b.name === 'b').shearX;
  near(shearX(t0), 0, 'shear at t=0');
  near(shearX(t1), 30, 'shear at t=1 equals the measured max');
  assert.ok(shearX(mid) > 0 && shearX(mid) < 30, `between: ${shearX(mid)}`);
});

// Raw keys used to cost far too many tokens. A realistic scene: 20 bones,
// 3 channels, 30 bezier keys each.
function costScene() {
  const bones = [{ name: 'root' }];
  const anim = { bones: {} };
  for (let i = 0; i < 20; i++) {
    const name = `b${i}`;
    bones.push({ name, parent: 'root' });
    const keys = f => Array.from({ length: 30 }, (_, j) => ({ time: +(j / 30).toFixed(6), ...f(j), curve: [0.1, 2, 0.3, 4] }));
    anim.bones[name] = { translate: keys(j => ({ x: j * 2, y: j })), rotate: keys(j => ({ value: j })), scale: keys(() => ({ x: 1, y: 1 })) };
  }
  return { skeleton: { spine: '4.2' }, bones, slots: [], skins: [], animations: { a: anim } };
}

test('reading cost: the measurement is cheap, raw keys are opt-in and narrowed', () => {
  const sk = costScene();
  const plain = tokens(readAnimation(sk, 'a'));
  const detail = tokens(readAnimation(sk, 'a', { detail: true }));
  const one = tokens(readAnimation(sk, 'a', { detail: true, bones: ['b3'] }));
  const raw = tokens(readAnimation(sk, 'a', { detail: true, raw: true }));
  assert.ok(plain < 4000, `default ${plain} tokens`);
  assert.ok(raw > 20000, `raw ${raw} tokens: the old behaviour really was expensive`);
  assert.ok(plain < raw / 8, `${plain} vs ${raw}`);
  assert.ok(one < 1200, `one bone with keys ${one} tokens`);
  assert.ok(detail < raw / 2, `detail ${detail} vs raw ${raw}`);
});

test('cheaper does not lose information; compression is lossless on time', () => {
  const sk = costScene();
  const r = readAnimation(sk, 'a');
  const m = r.bones.b7.rotate;
  assert.equal(m.keys, 30);
  assert.equal(m.first, 0);
  near(m.last, 29 / 30, 'last key');
  assert.equal(m.value.amplitude, 29);
  near(m.averageSpacing, 1 / 30, 'average spacing', 1e-6);
  assert.ok(r.duration > 0 && r.channels.includes('rotate'));
  assert.equal(r.frameGrid.offGridKeys, 0);
  const compressed = readAnimation(sk, 'a', { detail: true, bones: ['b7'] }).bones.b7.rotate.keys;
  const raw = readAnimation(sk, 'a', { detail: true, raw: true, bones: ['b7'] }).bones.b7.rotate.keys;
  assert.equal(compressed.time.length, raw.length);
  compressed.time.forEach((t, i) => near(t, raw[i].time ?? 0, `time ${i}`, 1e-6));
  assert.equal(compressed.curve[0], 'bezier', 'the curve kind is kept by name');
});

test('stepped keys are counted', () => {
  const sk = withAnimation('s', { bones: { b: { rotate: [{ time: 0, value: 0, curve: 'stepped' }, { time: 1, value: 90 }] } } });
  assert.equal(readAnimation(sk, 's').bones.b.rotate.stepped, 1);
  assert.deepEqual(readAnimation(sk, 's', { detail: true }).bones.b.rotate.keys.curve, ['stepped', 'linear']);
});

test('a new clip beside the owner\'s: measured, and the owner\'s animation untouched by reading', () => {
  const sk = readFixture('read/sample_intro.json');
  const owner = Object.keys(sk.animations)[0];
  const bone = Object.keys(sk.animations[owner].bones)[0];
  sk.animations.intro = { bones: { [bone]: { rotate: [
    { time: 0, value: 0 }, { time: 0.8, value: -12, curve: [0.95, -4, 1.2, -12] }, { time: 1.6, value: 0 },
  ] } } };
  const before = structuredClone(sk);
  const r = readAnimation(sk, 'intro');
  assert.equal(r.duration, 1.6);
  assert.equal(r.bones[bone].rotate.value.amplitude, 12, 'the card number comes from here');
  assert.equal(r.bones[bone].rotate.keys, 3);
  readAnimation(sk, owner, { detail: true });
  assert.deepEqual(sk, before, 'reading never changes the input');
});

// Draw order: who is in front. Raw keys are offsets against setup; the runtime resolves.
const ORDER = ['floor', 'box', 'car', 'front'];
const drawOrderRig = keys => ({
  skeleton: { spine: '4.2.43', hash: 'h' },
  bones: [{ name: 'root' }],
  slots: ORDER.map(name => ({ name, bone: 'root' })),
  skins: [{ name: 'default', attachments: {} }],
  animations: { d: { drawOrder: keys }, still: { bones: { root: { rotate: [{ time: 0, value: 0 }] } } } },
});
const BOX_FORWARD = [
  { time: 0, offsets: [{ slot: 'box', offset: 1 }] }, // the box goes in front of the car
  { time: 1, offsets: [] }, // back to setup
];

test('draw order resolved by the runtime: who moved how many steps, and the return to setup', async () => {
  const sk = drawOrderRig(BOX_FORWARD);
  assert.deepEqual(drawOrderKeyTimes(sk, 'd'), [0, 1]);
  const r = await readAnimationOnRuntime(sk, 'd');
  const section = r.drawOrderChanges;
  assert.deepEqual(section.setupOrder, ORDER);
  assert.equal(section.resolved, true);
  assert.equal(section.keys[0].returnsToSetup, false);
  assert.deepEqual(section.keys[0].changes, [
    { slot: 'box', setupIndex: 1, index: 2, steps: 1 }, { slot: 'car', setupIndex: 2, index: 1, steps: -1 },
  ]);
  assert.ok(!('order' in section.keys[0]), 'the full order only on request');
  assert.equal(section.keys[1].returnsToSetup, true);
  assert.deepEqual(section.keys[1].changes, []);
  assert.deepEqual(r.drawOrder, BOX_FORWARD, 'the raw keys stay beside the resolved form');
  const full = await readAnimationOnRuntime(sk, 'd', { fullDrawOrder: true });
  assert.deepEqual(full.drawOrderChanges.keys[0].order, ['floor', 'car', 'box', 'front']);
  assert.deepEqual(full.drawOrderChanges.keys[1].order, ORDER);
});

test('draw order: a negative offset and two offsets in one key, as the runtime orders them', async () => {
  const back = await readAnimationOnRuntime(drawOrderRig([{ time: 0, offsets: [{ slot: 'car', offset: -1 }] }]), 'd', { fullDrawOrder: true });
  assert.deepEqual(back.drawOrderChanges.keys[0].order, ['floor', 'car', 'box', 'front'], 'the car one step back');
  // Spine back-fills untouched slots from the end; a guessed "shift by offset" gets this wrong.
  const two = await readAnimationOnRuntime(drawOrderRig([{ time: 0, offsets: [{ slot: 'floor', offset: 2 }, { slot: 'box', offset: 2 }] }]),
    'd', { fullDrawOrder: true });
  assert.deepEqual(two.drawOrderChanges.keys[0].order, ['car', 'front', 'floor', 'box']);
});

test('without the runtime the keys are listed but not resolved; resolved orders can be injected', () => {
  const sk = drawOrderRig(BOX_FORWARD);
  const plain = readAnimation(sk, 'd').drawOrderChanges;
  assert.equal(plain.resolved, false);
  assert.ok(plain.keys.every(k => !('changes' in k)));
  const injected = readAnimation(sk, 'd', { drawOrders: [['floor', 'car', 'box', 'front'], ORDER] }).drawOrderChanges;
  assert.deepEqual(injected.keys[0].changes.map(c => [c.slot, c.steps]), [['box', 1], ['car', -1]]);
  assert.throws(() => readAnimation(sk, 'd', { drawOrders: [ORDER] }), err => isStudioError(err, 'bad-argument'));
  assert.ok(!('drawOrderChanges' in readAnimation(sk, 'still')), 'no draw-order section without draw-order keys');
});

for (const [label, offsets, code] of [
  // Measured: spine-ts runs out of memory on this and takes the process with it.
  ['offsets out of slot order', [{ slot: 'car', offset: -1 }, { slot: 'box', offset: 1 }], 'draw-order-unsorted'],
  ['an offset past the last slot', [{ slot: 'front', offset: 2 }], 'draw-order-out-of-range'],
  // Legacy's own resolver lost "floor" here and its test passed on an undefined entry.
  ['two offsets landing on one index', [{ slot: 'floor', offset: 2 }, { slot: 'box', offset: 1 }], 'draw-order-collision'],
  ['a slot that does not exist', [{ slot: 'ghost', offset: 1 }], 'draw-order-unknown-slot'],
]) {
  test(`draw order with ${label}: reported, and the runtime is never handed the file`, async () => {
    const sk = drawOrderRig([{ time: 0, offsets }]);
    const r = await readAnimationOnRuntime(sk, 'd');
    const section = r.drawOrderChanges;
    assert.equal(section.resolved, false);
    assert.equal(section.unresolved.code, 'draw-order-offsets');
    assert.ok(section.keys[0].problems.some(p => p.code === code), JSON.stringify(section.keys[0].problems));
    assert.ok(section.unresolved.findings.some(f => f.code === code && f.level === 'fatal'));
    // An animation without draw-order keys still reads: the runtime is not needed there.
    assert.deepEqual(Object.keys((await readAnimationOnRuntime(sk, 'still')).bones), ['root']);
  });
}

test('a file the runtime refuses: draw order listed, unresolved, and why', async () => {
  const sk = readFixture('read/sample_intro.json');
  const name = Object.keys(sk.animations).find(n => sk.animations[n].drawOrder?.length);
  const r = await readAnimationOnRuntime(sk, name);
  assert.equal(r.drawOrderChanges.unresolved.code, 'runtime-parse');
  assert.equal(r.drawOrderChanges.keys.length, sk.animations[name].drawOrder.length);
});

// Every real fixture: the reader and the runtime must tell the same story.
for (const path of ['ident/ident.json', 'nova/nova.json', 'read/weighted_sample.json']) {
  test(`${path}: duration, key count and bone ranges agree with the official runtime`, needsSpine, async () => {
    const sk = readFixture(path);
    const data = await parseSkeleton(sk, { backend: 'spine' });
    const rig = readRig(sk);
    for (const animation of data.animations) {
      const r = readAnimation(sk, animation.name);
      near(r.duration, animation.duration, `${animation.name} duration`, 1e-5);
      const frames = animation.timelines.reduce((n, t) => n + t.getFrameCount(), 0);
      assert.equal(r.frameGrid.keys, frames, `${animation.name}: every key the reader counts, the runtime parsed`);
      assert.equal(rig.animations.find(a => a.name === animation.name).duration, r.duration);
      // At its own key times a channel's local value is setup plus (or times) the key.
      for (const [boneName, channels] of Object.entries(sk.animations[animation.name].bones ?? {})) {
        const setup = sk.bones.find(b => b.name === boneName);
        for (const [channel, keys] of Object.entries(channels)) {
          const times = keys.map(k => k.time ?? 0);
          const samples = await sampleAnimation(data, animation.name, times);
          const local = samples.map(s => s.bones.find(b => b.name === boneName));
          const measured = r.bones[boneName][channel];
          const range = (values, label) => {
            near(Math.min(...values), (measured.x ?? measured.value).min, `${label} min`);
            near(Math.max(...values), (measured.x ?? measured.value).max, `${label} max`);
          };
          const label = `${animation.name}/${boneName}/${channel}`;
          if (channel === 'rotate') range(local.map(b => b.rotation - (setup.rotation ?? 0)), label);
          else if (channel === 'translate') range(local.map(b => b.x - (setup.x ?? 0)), label);
          else if (channel === 'scale') range(local.map(b => b.scaleX / (setup.scaleX ?? 1)), label);
        }
      }
    }
  });
}
