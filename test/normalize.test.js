// Gate for src/deliver/normalize.js: native Spine animation in, validated and normalized out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnimation } from '../src/deliver/normalize.js';
import { parseSkeleton, sampleAnimation } from '../src/runtime/index.js';
import { isStudioError } from '../src/shared/errors.js';

const refused = (animation, where, options) => assert.throws(() => normalizeAnimation(animation, options),
  err => isStudioError(err, 'bad-animation') && err.details.where.startsWith(where), where);

test('a reveal keyed from 0.5 s is held hidden from t=0, and the runtime agrees', async () => {
  const reveal = { slots: { logo: { alpha: [{ time: 0.5, value: 0 }, { time: 1, value: 1 }] } },
    bones: { logo: { scale: [{ time: 0.5, x: 0.2, y: 0.2, curve: [0.6, 0.2, 0.9, 1, 0.6, 0.2, 0.9, 1] }, { time: 1, x: 1, y: 1 }] } } };
  const { animation, held } = normalizeAnimation(reveal);
  assert.deepEqual(held.sort(), ['bones/logo/scale', 'slots/logo/alpha']);
  assert.deepEqual(animation.slots.logo.alpha[0], { value: 0 }, 'the held key carries the first value, no time, no curve');
  assert.deepEqual(animation.bones.logo.scale[0], { x: 0.2, y: 0.2 });
  assert.equal(reveal.slots.logo.alpha.length, 2, 'the input is not mutated');

  const skeleton = {
    skeleton: { spine: '4.2.43', hash: 'n' }, bones: [{ name: 'root' }, { name: 'logo', parent: 'root' }],
    slots: [{ name: 'logo', bone: 'logo' }], animations: {},
  };
  const data = await parseSkeleton({ ...skeleton, animations: { raw: reveal, fixed: animation } });
  const alphaAt = async name => (await sampleAnimation(data, name, [0.25]))[0].slots[0].color.a;
  assert.equal(await alphaAt('raw'), 1, 'without the hold the setup pose leaks: visible before the reveal');
  assert.equal(await alphaAt('fixed'), 0, 'with the hold it is hidden from the start');
});

test('discrete channels keep showing the setup until their first key', () => {
  const clip = { slots: { s: { attachment: [{ time: 0.5, name: 'b' }] } }, bones: { b: { inherit: [{ time: 0.2, inherit: 'noScale' }] } },
    drawOrder: [{ time: 0.3, offsets: [] }], events: [{ time: 0.4, name: 'hit' }] };
  const { animation, held } = normalizeAnimation(clip);
  assert.deepEqual(held, []);
  assert.deepEqual(animation, clip);
  assert.deepEqual(normalizeAnimation(clip, { holdFromStart: false }).held, []);
});

test('holding can be turned off, and channels already keyed at 0 are untouched', () => {
  const clip = { bones: { b: { rotate: [{ time: 0.5, value: 10 }], translate: [{ x: 1, y: 2 }, { time: 1, x: 0, y: 0 }] } } };
  assert.deepEqual(normalizeAnimation(clip, { holdFromStart: false }).animation, clip);
  const { held } = normalizeAnimation(clip);
  assert.deepEqual(held, ['bones/b/rotate']);
});

test('deform and constraint mixes are value channels and get held too', () => {
  const clip = {
    attachments: { default: { s: { mesh: { deform: [{ time: 0.2, vertices: [1, 1] }] } } } },
    ik: { reach: [{ time: 0.3, mix: 0 }] },
    physics: { sway: { mix: [{ time: 0.1, value: 0 }], reset: [{ time: 0.4 }] } },
  };
  const { held } = normalizeAnimation(clip);
  assert.deepEqual(held.sort(), ['attachments/default/s/mesh/deform', 'ik/reach', 'physics/sway/mix']);
});

test('snapping to a frame grid reports every moved key', () => {
  const clip = { bones: { b: { rotate: [{ value: 0 }, { time: 0.41, value: 5 }, { time: 1, value: 0 }] } } };
  const { animation, snapped } = normalizeAnimation(clip, { fps: 30 });
  assert.deepEqual(snapped, [{ where: 'bones/b/rotate[1]', from: 0.41, to: 0.4 }]);
  assert.equal(animation.bones.b.rotate[1].time, 0.4);
  assert.deepEqual(normalizeAnimation(clip).snapped, [], 'no fps, no snapping');
  assert.throws(() => normalizeAnimation(clip, { fps: 0 }), err => isStudioError(err, 'bad-argument'));
});

test('two keys snapped onto the same frame stay ordered; snapping can never reorder', () => {
  const clip = { bones: { b: { rotate: [{ time: 0.49, value: 0 }, { time: 0.51, value: 5 }] } } };
  // Snapping may not reorder keys, and two keys landing on one frame are refused by path:
  // the runtime would play only one of them.
  assert.throws(() => normalizeAnimation(clip, { fps: 2 }), e => e.code === 'bad-animation' && /share the time 0\.5/.test(e.message) && /after snapping/.test(e.message));
});

test('two keys at the same time are refused, except events', () => {
  assert.throws(() => normalizeAnimation({ bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 10 }, { time: 0.5, value: -10 }] } } }),
    e => e.code === 'bad-animation' && e.details.where === 'bones/b/rotate[2]');
  const { animation } = normalizeAnimation({ events: [{ time: 0.5, name: 'a' }, { time: 0.5, name: 'b' }] });
  assert.equal(animation.events.length, 2, 'two events may fire on the same frame');
});

test('fps snapping reports real moves, not rounding of a time already on the grid', () => {
  const { snapped } = normalizeAnimation({ bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 0.3333, value: 1 }, { time: 0.52, value: 2 }] } } }, { fps: 30 });
  assert.deepEqual(snapped.map(s => s.where), ['bones/b/rotate[2]']);
});

test('malformed input is refused with the exact path', () => {
  refused(null, 'animation');
  refused({ deform: {} }, 'deform');
  refused({ bones: { b: { spin: [] } } }, 'bones/b/spin');
  refused({ bones: { b: { rotate: {} } } }, 'bones/b/rotate');
  refused({ bones: { b: { rotate: [{ time: 1 }, { time: 0.5 }] } } }, 'bones/b/rotate[1]');
  refused({ bones: { b: { rotate: [{ time: -1 }] } } }, 'bones/b/rotate[0]');
  refused({ bones: { b: { rotate: [{ time: '1' }] } } }, 'bones/b/rotate[0]');
  refused({ slots: { s: { color: [] } } }, 'slots/s/color');
  refused({ bones: { b: { rotate: [{ value: 1, curve: 'bouncy' }, { time: 1, value: 2 }] } } }, 'bones/b/rotate[0]');
  refused({ ik: { reach: [{ mix: 0, curve: 'easeOut' }, { time: 1, mix: 1 }] } }, 'ik/reach[0]');
  refused({ bones: { b: { rotate: [{ value: 1, curve: 7 }] } } }, 'bones/b/rotate[0]');
  refused({ bones: { b: [] } }, 'bones/b');
});

test('a preset name becomes the absolute bezier of its key pair, and plays like the preset', async () => {
  const { handlesFor, sampleCurve } = await import('../src/spine/curves/presets.js');
  const clip = { bones: { b: {
    rotate: [{ value: 0, curve: 'easeOut' }, { time: 2, value: 90, curve: 'linear' }, { time: 3, value: 0 }],
    scale: [{ x: 1, y: 1, curve: 'easeInOut' }, { time: 1, x: 2, y: 0.5 }],
  } }, slots: { s: { alpha: [{ value: 0, curve: 'easeIn' }, { time: 1, value: 1 }] } } };
  const { animation, presets } = normalizeAnimation(clip);
  assert.deepEqual(presets.map(p => p.where).sort(), ['bones/b/rotate[0]', 'bones/b/scale[0]', 'slots/s/alpha[0]']);
  const curve = animation.bones.b.rotate[0].curve;
  assert.equal(curve.length, 4);
  assert.ok(curve[0] > 0 && curve[0] < 2 && curve[2] > 0 && curve[2] <= 2, 'cx is in seconds inside the key pair');
  assert.equal(animation.bones.b.rotate[1].curve, undefined, 'linear is the Spine default: no curve written');
  assert.equal(animation.bones.b.scale[0].curve.length, 8, 'two properties, two beziers');

  const data = await parseSkeleton({ skeleton: { spine: '4.2.43', hash: 'p' }, bones: [{ name: 'root' }, { name: 'b', parent: 'root' }],
    slots: [{ name: 's', bone: 'b' }], animations: { eased: animation } });
  const points = sampleCurve(handlesFor('easeOut'), 8);
  const samples = await sampleAnimation(data, 'eased', points.map(([x]) => x * 2));
  samples.forEach((sample, i) => {
    const rotation = sample.bones.find(x => x.name === 'b').rotation;
    assert.ok(Math.abs(rotation / 90 - points[i][1]) < 0.02, `t=${points[i][0] * 2}: ${rotation / 90} vs ${points[i][1]}`);
  });
});

test('a curve given as its shape becomes the same bezier a preset with those handles would', async () => {
  const { handlesFor } = await import('../src/spine/curves/presets.js');
  const keys = curve => ({ bones: { b: { translate: [{ time: 0, x: 0, y: 0, curve }, { time: 0.5, x: 40, y: -10 }] } } });
  const named = normalizeAnimation(keys('outBack')).animation.bones.b.translate[0].curve;
  const shaped = normalizeAnimation(keys({ handles: handlesFor('outBack') })).animation.bones.b.translate[0].curve;
  assert.equal(named.length, 8); assert.deepEqual(shaped, named);
  // time running backwards is refused, and so is a shape that is not four numbers
  for (const bad of [{ handles: [1.2, 0, 0.5, 1] }, { handles: [0.2, 0, 0.5] }, { shape: [0, 0, 1, 1] }]) {
    assert.throws(() => normalizeAnimation(keys(bad)), e => isStudioError(e) && /handles/.test(e.message), JSON.stringify(bad));
  }
});
