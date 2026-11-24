// Gate for src/spine/curves: named easing presets, key math, and retro-fitting curves onto
// a clip. Ported from legacy test_curves.js, which proved two different risks:
//   1) the ratio-based ease1/ease2 must still produce exactly the numbers they always did:
//      a preset system that quietly shifts an existing animation's curves is a worse
//      regression than having no presets at all;
//   2) recurve must never move a key's time or value, only the curve between two keys.
// Added here: the official spine-ts 4.2 runtime plays what recurve writes as the preview
// draws it, keys stay put through the runtime, and the legacy bugs found in the port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PRESETS, PRESET_ALIASES, presetNames, handlesFor, isValidHandles, sampleCurve } from '../src/spine/curves/presets.js';
import { isNumber, round4, frameGrid, FPS_DEFAULT, MAX_FPS, ease1, ease2, EASE_RATIOS, easeOf } from '../src/spine/curves/key-math.js';
import { recurve, segmentCurve, BONE_CHANNELS, SLOT_CHANNELS } from '../src/spine/curves/recurve.js';
import { checkSkeleton } from '../src/spine/check.js';
import { splitFatals } from '../src/spine/findings.js';
import { parseSkeleton, sampleAnimation } from '../src/runtime/index.js';
import { isStudioError } from '../src/shared/errors.js';

const near = (actual, expected, label, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
const throwsCode = (fn, code) => assert.throws(fn, err => isStudioError(err, code), `expected StudioError ${code}`);
const stripCurves = value => JSON.parse(JSON.stringify(value), (key, v) => (key === 'curve' ? undefined : v));

/** A minimal 4.2 skeleton around one animation, ready for the runtime and the checker. */
const skeletonWith = animation => ({
  skeleton: { spine: '4.2.43', hash: 'curves', x: 0, y: 0, width: 10, height: 10, images: '', audio: '' },
  bones: [{ name: 'root' }, { name: 'b', parent: 'root' }],
  slots: [{ name: 's', bone: 'b' }],
  animations: { a: animation },
});
const boneOf = (sample, name = 'b') => sample.bones.find(x => x.name === name);

// The runtime evaluates a bezier as a 10-segment polyline (spine-ts setBezier); measured
// against the exact curve over every preset at 24 steps the worst gap is 0.0158 of the
// value change (inOutBack). 0.02 holds that with margin; a wrong preset misses by ~0.3.
const RUNTIME_POLYLINE_TOLERANCE = 0.02;

// --- key-math --------------------------------------------------------------------------

test('the ratio form of ease1/ease2 keeps the exact numbers of the historical formula', () => {
  const oldEase1 = (t0, t1, v0, v1, k) => { const d = (t1 - t0) * k; return [t0 + d, v0, t1 - d, v1].map(round4); };
  const oldEase2 = (t0, t1, a0, a1, b0, b1, k) => {
    const d = (t1 - t0) * k;
    return [t0 + d, a0, t1 - d, a1, t0 + d, b0, t1 - d, b1].map(round4);
  };
  for (const k of [0, 0.08, 0.15, 1 / 3, 0.45, 0.5]) {
    for (const [t0, t1, v0, v1] of [[0, 1, 0, 90], [0.5, 2.5, -10, 30], [0, 6.1, 100, 0]]) {
      assert.deepEqual(ease1(t0, t1, v0, v1, k), oldEase1(t0, t1, v0, v1, k), `ease1 k=${k} [${t0},${t1}]`);
      assert.deepEqual(ease2(t0, t1, v0, v1, v0 + 1, v1 + 1, k), oldEase2(t0, t1, v0, v1, v0 + 1, v1 + 1, k),
        `ease2 k=${k} [${t0},${t1}]`);
    }
  }
});

test('ease2 writes one bezier per property, sharing the handle times', () => {
  const c = ease2(0, 2, 0, 10, 100, 50, PRESETS.outCubic);
  assert.equal(c.length, 8);
  assert.deepEqual([c[0], c[2]], [c[4], c[6]], 'both properties share the handle times');
  assert.deepEqual(c, [0.66, 10, 1.36, 10, 0.66, 50, 1.36, 50]);
  assert.equal(ease1(0, 2, 0, 10, PRESETS.outCubic).length, 4, 'a single property is 4 numbers, never 8');
});

test('rounding never pushes a handle outside its key pair (6-decimal key times)', () => {
  // Legacy wrote 0.3333 for a key at 0.333333: the checker flagged cx outside [t0, t1].
  const grid = frameGrid(30);
  const t0 = grid.snap(10 / 30), t1 = grid.snap(20 / 30);
  const c = ease1(t0, t1, 0, 1, [0, 0.2, 1, 0.8]);
  assert.ok(c[0] >= t0 && c[2] <= t1, `handles ${c[0]}, ${c[2]} inside [${t0}, ${t1}]`);
  const sk = skeletonWith({ bones: { b: { rotate: [{ time: t0, value: 0 }, { time: t1, value: 90 }] } } });
  recurve(sk, { animation: 'a', preset: [0, 0.2, 1, 0.8] });
  assert.deepEqual(checkSkeleton(sk).filter(f => f.code === 'curve-time'), []);
});

test('the frame grid snaps to whole frames, at 6 decimals, from a resolved fps', () => {
  const grid = frameGrid(30);
  assert.equal(grid.fps, 30);
  // 0.7833 s is frame 23.499 at 30 fps: a key between two frames, snapped to frame 23.
  assert.equal(grid.snap(0.7833), 0.766667);
  assert.equal(grid.snap(0.79), 0.8, 'frame 23.7 goes to frame 24');
  // 4 decimals would give 0.7667 = frame 23.001; 6 decimals keeps the key on its frame.
  near(grid.snap(23 / 30) * 30, 23, 'frame 23 survives rounding', 1.5e-5);
  assert.ok(grid.shift(0.7833) <= 0.5 / 30 + 1e-12, 'a snap moves a key at most half a frame');
  near(grid.shift(0.7833), 0.016633, 'the shift is reported', 1e-9);
  assert.equal(grid.shift(0.8), 0, 'a key on the grid does not move');
  assert.equal(grid.snap(undefined), 0);
  assert.equal(grid.snap('0.5'), 0.5);
  assert.equal(frameGrid(24.4).fps, 24, 'fps rounds to an integer');
  assert.equal(frameGrid(MAX_FPS).fps, MAX_FPS);
  for (const bad of [undefined, 0, -5, MAX_FPS + 1, NaN, Infinity, '24']) {
    assert.equal(frameGrid(bad).fps, FPS_DEFAULT, `fps ${String(bad)} falls back`);
  }
  const at24 = frameGrid(24), at60 = frameGrid(60);
  assert.equal(at24.snap(0.51), 0.5, 'each grid is its own value, never shared state');
  assert.equal(at60.snap(0.51), 0.516667, 'a second grid does not disturb the first');
  assert.equal(at24.fps, 24);
});

test('an fps that rounds to zero falls back instead of turning every time into NaN', () => {
  // Legacy grid(0.3) gave fps 0, and every snapped time was 0/0.
  const grid = frameGrid(0.3);
  assert.equal(grid.fps, FPS_DEFAULT);
  assert.equal(grid.snap(1), 1);
  assert.equal(frameGrid(0.6).fps, 1, '0.6 rounds to 1 fps, a real rate');
});

test('easeOf reads ratio names, numbers, stepped and presets; unknown is normal', () => {
  assert.equal(easeOf(undefined), 1 / 3);
  assert.equal(easeOf({}), 1 / 3);
  assert.equal(easeOf({ ease: null }), 1 / 3);
  assert.equal(easeOf({ ease: 0.2 }), 0.2);
  assert.equal(easeOf({ ease: 0.9 }), 0.5, 'clamped to 0.5');
  assert.equal(easeOf({ ease: -1 }), 0, 'clamped to 0');
  assert.equal(easeOf({ ease: 'STEPPED' }), 'stepped');
  assert.equal(easeOf({ ease: 'soft' }), 0.45, 'a ratio name still returns a number (no regression)');
  assert.equal(easeOf({ ease: 'Sharp' }), 0.08);
  const h = easeOf({ ease: 'outCubic' });
  assert.ok(Array.isArray(h) && h.length === 4, 'a preset returns four handles');
  assert.deepEqual(h, [...PRESETS.outCubic], 'exactly the preset table entry');
  assert.deepEqual(easeOf({ ease: [0.1, 0, 0.2, 1] }), [0.1, 0, 0.2, 1], 'raw handles pass through');
  assert.equal(easeOf({ ease: 'no-such-curve' }), 1 / 3, 'the lenient reading falls back to normal');
  assert.equal(easeOf({ ease: NaN }), 1 / 3);
});

test('the ratio table keeps its order: the strict writer builds its refusal message from it', () => {
  assert.deepEqual(Object.keys(EASE_RATIOS),
    ['linear', 'sharp', 'fast', 'normal', 'soft', 'softest', 'smooth', 'ease', 'softer']);
  assert.deepEqual(Object.values(EASE_RATIOS), [0, 0.08, 0.15, 1 / 3, 0.45, 0.5, 1 / 3, 1 / 3, 0.45]);
  assert.ok(Object.isFrozen(EASE_RATIOS));
});

test('names on Object.prototype are not curves', () => {
  // Legacy: easeK({ ease: 'constructor' }) returned a function (NaN handles), and
  // handlesFor('toString') threw.
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assert.equal(handlesFor(name), null, `handlesFor ${name}`);
    assert.equal(easeOf({ ease: name }), 1 / 3, `easeOf ${name}`);
    const sk = skeletonWith({ bones: { b: { rotate: [{ value: 0 }, { time: 1, value: 1 }] } } });
    throwsCode(() => recurve(sk, { animation: 'a', preset: name }), 'unknown-curve');
    throwsCode(() => recurve(sk, { animation: name, preset: 'linear' }), 'unknown-animation');
  }
  const sk = skeletonWith({ bones: { b: { constructor: [{ value: 0 }, { time: 1, value: 1 }] } } });
  assert.deepEqual(recurve(sk, { animation: 'a', preset: 'outCubic' }).skipped,
    [{ owner: 'b', channel: 'constructor', reason: 'channel-carries-no-curve' }]);
  assert.equal(isNumber('1'), false);
});

// --- presets ---------------------------------------------------------------------------

test('a preset name resolves to its normalized handles, in any spelling or alias', () => {
  assert.deepEqual(handlesFor('outCubic'), [...PRESETS.outCubic]);
  for (const spelling of ['OUTCUBIC', 'out-cubic', 'out_cubic', ' Out Cubic ']) {
    assert.deepEqual(handlesFor(spelling), [...PRESETS.outCubic], spelling);
  }
  assert.deepEqual(handlesFor('DECELERATE'), [...PRESETS.outCubic], 'an alias, case-insensitive');
  assert.deepEqual(handlesFor('Ease-Out'), [...PRESETS.outCubic]);
  assert.deepEqual(PRESET_ALIASES, {
    easein: 'inCubic', easeout: 'outCubic', easeinout: 'inOutCubic',
    accelerate: 'inCubic', decelerate: 'outCubic', overshoot: 'outBack',
  });
  for (const [alias, target] of Object.entries(PRESET_ALIASES)) {
    assert.deepEqual(handlesFor(alias), [...PRESETS[target]], alias);
  }
  assert.equal(handlesFor(undefined), null);
  assert.equal(handlesFor(null), null);
  assert.equal(handlesFor('nope'), null);
  assert.equal(presetNames().length, 19);
  assert.equal(presetNames()[0], 'linear');
});

test('the table cannot be corrupted through a returned value', () => {
  const h = handlesFor('inCubic');
  h[0] = 99;
  assert.equal(PRESETS.inCubic[0], 0.32);
  assert.ok(Object.isFrozen(PRESETS) && Object.isFrozen(PRESETS.inCubic));
  const raw = [0.1, 0, 0.2, 1];
  assert.notEqual(handlesFor(raw), raw, 'raw handles are copied too');
});

test('raw handles need four finite numbers with x in 0..1; y may overshoot', () => {
  assert.deepEqual(handlesFor([0.2, -0.5, 0.8, 1.5]), [0.2, -0.5, 0.8, 1.5]);
  assert.deepEqual(handlesFor([0, 0, 1, 1]), [0, 0, 1, 1], 'the x bounds are inclusive');
  for (const bad of [[0.1, 0, 0.2], [0.1, 0, 0.2, 1, 0], [0.1, NaN, 0.2, 1], [0.1, '0', 0.2, 1],
    [-0.4, 0.5, 0.6, 0.5], [0.4, 0.5, 1.4, 0.5]]) {
    assert.equal(handlesFor(bad), null, JSON.stringify(bad));
    assert.equal(isValidHandles(bad), false, JSON.stringify(bad));
  }
});

test('x outside 0..1 is refused, because the runtime does not clamp what the preview would', async () => {
  // Measured on legacy: [-0.4, 0.5, 1.4, 0.5] previewed (clamped) up to 0.256 away from what
  // spine-ts plays; at t=0 the runtime already shows a quarter of the change.
  const sk = skeletonWith({ bones: { b: { rotate: [{ value: 0 }, { time: 1, value: 100 }] } } });
  throwsCode(() => recurve(sk, { animation: 'a', preset: [-0.4, 0.5, 1.4, 0.5] }), 'bad-curve-handles');
  sk.animations.a.bones.b.rotate[0].curve = [-0.4, 50, 1.4, 50];
  const [start] = await sampleAnimation(await parseSkeleton(sk), 'a', [0]);
  assert.ok(boneOf(start).rotation > 20, `the runtime plays it unclamped (${boneOf(start).rotation} at t=0)`);
});

test('ease-in and ease-out are really different shapes (the ratio could never do this)', () => {
  const inCubic = ease1(0, 1, 0, 100, PRESETS.inCubic);
  const outCubic = ease1(0, 1, 0, 100, PRESETS.outCubic);
  assert.ok(inCubic[1] < 15, `inCubic leaves slowly: first handle value is low (${inCubic})`);
  assert.ok(outCubic[1] > 85, `outCubic leaves fast, arrives slowly: first handle value is high (${outCubic})`);
  assert.notDeepEqual(inCubic, outCubic);
});

test('the back family overshoots past the target and settles', () => {
  const c = ease1(0, 1, 0, 60, PRESETS.outBack);
  assert.ok(c[1] > 60, `outBack's first handle passes the target (${c})`);
  const pts = sampleCurve('outBack', 48);
  assert.ok(Math.max(...pts.map(p => p[1])) > 1.05, 'and the preview shows it: overshoot is not clamped');
});

test('sampleCurve gives steps+1 points from (0,0) to (1,1); anything else previews linear', () => {
  const pts = sampleCurve('inOutCubic', 10);
  assert.equal(pts.length, 11);
  near(pts[0][1], 0, 'starts at 0', 1e-6);
  near(pts[10][1], 1, 'ends at 1', 1e-6);
  near(pts[5][1], 0.5, 'a symmetric curve passes the middle', 1e-6);
  assert.ok(pts.every(([x], i) => x === i / 10), 'x is evenly spaced');
  assert.equal(sampleCurve('linear').length, 25, '24 steps by default');
  assert.equal(sampleCurve('linear', 1).length, 3, 'at least 2 steps');
  for (const [x, y] of sampleCurve('nonsense', 8)) near(y, x, 'junk previews as linear', 1e-6);
  assert.ok(sampleCurve('inCubic', 10)[5][1] < 0.3 && sampleCurve('outCubic', 10)[5][1] > 0.7);
});

// --- recurve ---------------------------------------------------------------------------

test('recurve changes only the curves: every time and value stays bit-identical', () => {
  const sk = { animations: { a: {
    bones: { k: {
      rotate: [{ time: 0, value: 0 }, { time: 1, value: 90 }, { time: 2, value: 0 }],
      translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 10, y: 20 }],
    } },
    slots: { s: {
      alpha: [{ time: 0, value: 1 }, { time: 1, value: 0 }],
      attachment: [{ time: 0, name: 'g' }],
    } },
  } } };
  const before = structuredClone(sk);
  const r = recurve(sk, { animation: 'a', preset: 'outCubic' });
  assert.equal(r.segments, 4);
  assert.deepEqual(r.changed, [
    { owner: 'k', channel: 'rotate', segments: 2 },
    { owner: 'k', channel: 'translate', segments: 1 },
    { owner: 's', channel: 'alpha', segments: 1 },
  ]);
  assert.deepEqual(r.skipped, [{ owner: 's', channel: 'attachment', reason: 'channel-carries-no-curve' }],
    'a channel that carries no curve is named, never silently counted');
  assert.deepEqual(r.handles, [...PRESETS.outCubic]);
  assert.equal(r.animation, 'a');
  assert.equal(r.preset, 'outCubic');
  assert.deepEqual(stripCurves(sk), before, 'nothing but `curve` changed');
  assert.ok(sk.animations.a.bones.k.rotate[0].curve[1] > 85, 'outCubic was really written');
  assert.equal(sk.animations.a.bones.k.rotate[0].curve.length, 4);
  assert.equal(sk.animations.a.bones.k.translate[0].curve.length, 8);
  assert.equal(sk.animations.a.bones.k.rotate[2].curve, undefined, 'the last key has no segment');

  const back = recurve(sk, { animation: 'a', preset: 'linear' });
  assert.equal(back.handles, 'linear');
  assert.equal(sk.animations.a.bones.k.rotate[0].curve, undefined, 'linear removes the curve (Spine default)');
  assert.deepEqual(sk, before, 'and going back to linear is lossless');
});

test('stepped writes "stepped" and the runtime holds the value until the next key', async () => {
  const sk = skeletonWith({ bones: { b: { rotate: [{ value: 0 }, { time: 1, value: 90 }] } } });
  const r = recurve(sk, { animation: 'a', preset: 'Stepped' });
  assert.equal(r.handles, 'stepped');
  assert.equal(sk.animations.a.bones.b.rotate[0].curve, 'stepped');
  const samples = await sampleAnimation(await parseSkeleton(sk), 'a', [0.5, 0.99, 1]);
  assert.deepEqual(samples.map(s => boneOf(s).rotation), [0, 0, 90]);
});

test('filters: bones, slots, channels and the from/to window on the first key', () => {
  const make = () => ({ animations: { a: {
    bones: {
      k1: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 10 }, { time: 2, value: 0 }, { time: 3, value: 5 }],
        translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 1, y: 1 }] },
      k2: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 20 }] },
    },
    slots: { s1: { alpha: [{ time: 0, value: 1 }, { time: 1, value: 0 }] },
      s2: { alpha: [{ time: 0, value: 1 }, { time: 1, value: 0 }] } },
  } } });
  let sk = make();
  recurve(sk, { animation: 'a', preset: 'outCubic', bones: ['K1'] });
  const bones = sk.animations.a.bones;
  assert.ok(bones.k1.rotate[0].curve, 'the named bone changed (name case-insensitive)');
  assert.equal(bones.k2.rotate[0].curve, undefined, 'the other bone did not');
  assert.ok(sk.animations.a.slots.s1.alpha[0].curve, 'a bone filter leaves slots open');

  sk = make();
  recurve(sk, { animation: 'a', preset: 'outCubic', slots: ['s2'] });
  assert.equal(sk.animations.a.slots.s1.alpha[0].curve, undefined);
  assert.ok(sk.animations.a.slots.s2.alpha[0].curve);

  sk = make();
  const r = recurve(sk, { animation: 'a', preset: 'outCubic', channels: ['ROTATE'] });
  assert.equal(sk.animations.a.bones.k1.translate[0].curve, undefined, 'translate filtered out');
  assert.equal(sk.animations.a.slots.s1.alpha[0].curve, undefined, 'alpha filtered out');
  assert.equal(r.segments, 4);

  sk = make();
  const windowed = recurve(sk, { animation: 'a', preset: 'outCubic', bones: ['k1'], channels: ['rotate'], from: 1, to: 2 });
  assert.deepEqual(sk.animations.a.bones.k1.rotate.map(k => Boolean(k.curve)), [false, true, true, false]);
  assert.equal(windowed.segments, 2);

  sk = make();
  recurve(sk, { animation: 'a', preset: 'outCubic', bones: ['k1'], channels: ['rotate'], from: 1 + 5e-7, to: 2 - 5e-7 });
  assert.deepEqual(sk.animations.a.bones.k1.rotate.map(k => Boolean(k.curve)), [false, true, true, false],
    'the window tolerates float noise of 1e-6');
  sk = make();
  recurve(sk, { animation: 'a', preset: 'outCubic', bones: ['k1'], channels: ['rotate'], from: 1.01 });
  assert.deepEqual(sk.animations.a.bones.k1.rotate.map(k => Boolean(k.curve)), [false, false, true, false]);
});

test('mistakes are refused with a stable code, never passed silently', () => {
  const sk = { animations: { a: { bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } } } } };
  assert.throws(() => recurve(sk, { animation: 'missing', preset: 'linear' }), err => {
    assert.ok(isStudioError(err, 'unknown-animation'));
    assert.deepEqual(err.details.available, ['a']);
    return true;
  });
  assert.throws(() => recurve(sk, { animation: 'a', preset: 'no-such-thing' }), err => {
    assert.ok(isStudioError(err, 'unknown-curve'));
    assert.ok(err.details.valid.includes('outCubic') && err.details.valid.includes('stepped'));
    return true;
  });
  throwsCode(() => recurve(sk, { animation: 'a' }), 'unknown-curve');
  throwsCode(() => recurve(null, { animation: 'a', preset: 'linear' }), 'unknown-animation');
  assert.equal(sk.animations.a.bones.k.rotate[0].curve, undefined, 'a refusal changes nothing');
});

test('a segment with no length, or a key list too short, gets no curve', () => {
  assert.equal(segmentCurve(BONE_CHANNELS.rotate, { time: 1, value: 0 }, { time: 1, value: 5 }, [...PRESETS.outCubic]), null);
  assert.equal(segmentCurve(BONE_CHANNELS.rotate, { time: 1 }, { time: 0.5 }, 'stepped'), null);
  assert.equal(segmentCurve(BONE_CHANNELS.rotate, { value: 0 }, { time: 1, value: 5 }, null), null, 'linear');
  const sk = { animations: { a: { bones: { k: { rotate: [{ time: 0, value: 0 }] } } } } };
  assert.equal(recurve(sk, { animation: 'a', preset: 'outCubic' }).segments, 0);
});

test('a missing field takes the runtime default: 1 for scale, 0 elsewhere', async () => {
  // Spine exports drop default values. Legacy filled every missing field with 0, so a scale
  // key without `x` got a curve built from 0: an ease-in dipped the bone towards zero size.
  assert.equal(BONE_CHANNELS.scale.fallback, 1);
  assert.equal(BONE_CHANNELS.scalex.fallback, 1);
  assert.equal(BONE_CHANNELS.scaley.fallback, 1);
  for (const channel of ['rotate', 'translate', 'translatex', 'translatey', 'shear', 'shearx', 'sheary']) {
    assert.equal(BONE_CHANNELS[channel].fallback, 0, channel);
  }
  assert.equal(SLOT_CHANNELS.alpha.fallback, 0);
  assert.deepEqual(segmentCurve(BONE_CHANNELS.scale, { time: 0, y: 2 }, { time: 1, x: 2, y: 2 }, [...PRESETS.inCubic]),
    [0.32, 1, 0.67, 1, 0.32, 2, 0.67, 2]);

  const preview = sampleCurve('inCubic', 10);
  // [timelines, property, expected value at preview fraction y, value range]
  const cases = [
    [{ scale: [{ y: 2 }, { time: 1, x: 3, y: 2 }] }, 'scaleX', y => 1 + 2 * y, 2],
    [{ scalex: [{ time: 0 }, { time: 1, value: 3 }] }, 'scaleX', y => 1 + 2 * y, 2],
    [{ scaley: [{ time: 0, value: 3 }, { time: 1 }] }, 'scaleY', y => 3 - 2 * y, 2],
    [{ translate: [{ y: 4 }, { time: 1, x: 10 }] }, 'y', y => 4 - 4 * y, 4],
    [{ rotate: [{ time: 0 }, { time: 1, value: 50 }] }, 'rotation', y => 50 * y, 50],
  ];
  for (const [timelines, property, expected, range] of cases) {
    const sk = skeletonWith({ bones: { b: timelines } });
    const before = structuredClone(sk);
    recurve(sk, { animation: 'a', preset: 'inCubic' });
    assert.deepEqual(stripCurves(sk), before, 'defaults are read, never written back into the keys');
    const samples = await sampleAnimation(await parseSkeleton(sk), 'a', preview.map(p => p[0]));
    samples.forEach((s, i) => {
      near(boneOf(s)[property], expected(preview[i][1]), `${Object.keys(timelines)[0]} ${property} at t=${s.time}`,
        range * RUNTIME_POLYLINE_TOLERANCE);
    });
  }
});

test('colour channels shape each hex component: 4 beziers for rgba, 3 for rgb', async () => {
  const handles = [...PRESETS.outCubic];
  const rgba = segmentCurve(SLOT_CHANNELS.rgba, { color: '#ff000080' }, { time: 1, color: '00ff00ff' }, handles);
  assert.equal(rgba.length, 16);
  assert.deepEqual(rgba.slice(0, 4), [0.33, 0, 0.68, 0], 'red 1 -> 0 eases out to 0');
  assert.deepEqual(rgba.slice(12), ease1(0, 1, 128 / 255, 1, handles), 'alpha 0x80 -> 0xff');
  const rgb = segmentCurve(SLOT_CHANNELS.rgb, { color: '000000' }, { time: 1, color: 'ffffff' }, handles);
  assert.equal(rgb.length, 12);
  assert.deepEqual(rgb.slice(8), [0.33, 1, 0.68, 1]);
  assert.deepEqual(segmentCurve(SLOT_CHANNELS.rgba, {}, { time: 1 }, handles).slice(0, 4), [0.33, 1, 0.68, 1],
    'a key without colour reads as white');

  const sk = skeletonWith({ slots: { s: {
    rgba: [{ color: 'ffffffff' }, { time: 1, color: '00000000' }],
  } } });
  recurve(sk, { animation: 'a', preset: 'outCubic' });
  const preview = sampleCurve('outCubic', 10);
  const samples = await sampleAnimation(await parseSkeleton(sk), 'a', preview.map(p => p[0]));
  samples.forEach((s, i) => {
    const color = s.slots.find(x => x.name === 's').color;
    for (const c of ['r', 'g', 'b', 'a']) {
      near(color[c], 1 - preview[i][1], `${c} at t=${s.time}`, RUNTIME_POLYLINE_TOLERANCE);
    }
  });
});

test('the runtime plays every preset as the preview draws it', async () => {
  for (const name of presetNames().filter(n => n !== 'linear')) {
    const sk = skeletonWith({ bones: { b: {
      rotate: [{ value: 0 }, { time: 1, value: 100 }],
      translate: [{ time: 1, x: -20, y: 10 }, { time: 3, x: 20, y: 50 }],
    } } });
    recurve(sk, { animation: 'a', preset: name });
    const preview = sampleCurve(name, 24);
    const data = await parseSkeleton(sk);
    const rotation = await sampleAnimation(data, 'a', preview.map(p => p[0]));
    const translation = await sampleAnimation(data, 'a', preview.map(p => 1 + 2 * p[0]));
    preview.forEach(([x, y], i) => {
      near(boneOf(rotation[i]).rotation / 100, y, `${name} rotate at x=${x}`, RUNTIME_POLYLINE_TOLERANCE);
      near((boneOf(translation[i]).x + 20) / 40, y, `${name} translate x at x=${x}`, RUNTIME_POLYLINE_TOLERANCE);
      near((boneOf(translation[i]).y - 10) / 40, y, `${name} translate y at x=${x}`, RUNTIME_POLYLINE_TOLERANCE);
    });
  }
});

const KEYED_PROPERTIES = {
  rotate: b => [b.rotation], translate: b => [b.x, b.y], scale: b => [b.scaleX, b.scaleY],
  shear: b => [b.shearX, b.shearY], rgba: s => [s.color.r, s.color.g, s.color.b, s.color.a],
  rgb: s => [s.color.r, s.color.g, s.color.b], alpha: s => [s.color.a],
};

test('on a real skeleton: keys stay put through the runtime and no fatal is introduced', async () => {
  const json = JSON.parse(fs.readFileSync(new URL('./fixtures/ident/ident.json', import.meta.url), 'utf8'));
  const original = await parseSkeleton(json);
  for (const [animation, clip] of Object.entries(json.animations)) {
    for (const preset of ['outBack', 'stepped', 'linear']) {
      const reshaped = structuredClone(json);
      const r = recurve(reshaped, { animation, preset });
      assert.ok(r.segments > 0, `${animation}: something was reshaped`);
      assert.deepEqual(stripCurves(reshaped), stripCurves(json), `${animation} ${preset}: only curves changed`);
      assert.deepEqual(splitFatals(checkSkeleton(json), checkSkeleton(reshaped)).fresh, [],
        `${animation} ${preset}: the write path's exit check passes`);

      // Each timeline is compared at its own key times only: elsewhere a reshaped segment
      // of another timeline legitimately moves.
      const data = await parseSkeleton(reshaped);
      for (const [kind, group] of [['bones', clip.bones], ['slots', clip.slots]]) {
        for (const [owner, timelines] of Object.entries(group ?? {})) {
          for (const [channel, keys] of Object.entries(timelines)) {
            const read = KEYED_PROPERTIES[channel];
            assert.ok(read, `the fixture's ${channel} channel is covered by this test`);
            const at = keys.map(k => k.time ?? 0);
            const before = await sampleAnimation(original, animation, at);
            const after = await sampleAnimation(data, animation, at);
            before.forEach((pose, i) => {
              const was = read(pose[kind].find(x => x.name === owner));
              const now = read(after[i][kind].find(x => x.name === owner));
              was.forEach((v, p) => near(now[p], v, `${animation} ${preset} ${owner}.${channel}[${p}] at key t=${at[i]}`));
            });
          }
        }
      }
    }
  }
});
