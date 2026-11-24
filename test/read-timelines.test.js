// Gate for src/understand/read-timelines.js: the walker, the measurements, the compressed
// key form, draw-order changes and the guard that keeps broken offsets from the runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  walkSections, channelsOf, animationDuration, measureChannel, compressKeys, drawOrderChanges,
  drawOrderOffsetProblems, drawOrderHazards, runtimeRefusal, issueCollector, frameGridReport,
} from '../src/understand/read-timelines.js';
import { StudioError, isStudioError } from '../src/shared/errors.js';

test('the walker labels every section and hands each key array over once', () => {
  const anim = {
    bones: { b: { rotate: [{ time: 0.1 }] } },
    slots: { s: { rgba2: [{ time: 0.2 }] } },
    ik: { i: [{ time: 0.3 }] },
    path: { p: { position: [{ time: 0.4 }] } },
    attachments: { default: { s: { mesh: { deform: [{ time: 0.5 }], sequence: [{ time: 0.6 }] } } } },
    drawOrder: [{ time: 0.7 }],
    events: [{ time: 0.8, name: 'e' }],
  };
  const seen = [];
  walkSections(anim, (channel, keys, where) => seen.push([channel, where, keys.length]));
  assert.deepEqual(seen, [
    ['rotate', 'bones/b/rotate', 1], ['slot.rgba2', 'slots/s/rgba2', 1], ['ik', 'ik/i', 1],
    ['path.position', 'path/p/position', 1], ['deform', 'deform/default/s/mesh/deform', 1],
    ['deform.sequence', 'deform/default/s/mesh/sequence', 1], ['drawOrder', 'drawOrder', 1], ['events', 'events', 1],
  ]);
  assert.deepEqual(channelsOf(anim), seen.map(s => s[0]));
  assert.equal(animationDuration(anim), 0.8, 'events count for the duration');
  assert.equal(animationDuration({}), 0);
});

test('a visitor that throws skips that channel only, as a reported issue', () => {
  const issues = issueCollector();
  const visited = [];
  walkSections({ bones: { a: { rotate: [{}] }, b: { rotate: [{}] } } }, (channel, keys, where) => {
    if (where.startsWith('bones/a')) throw new Error('boom');
    visited.push(where);
  }, issues);
  assert.deepEqual(visited, ['bones/b/rotate']);
  assert.deepEqual(issues.list.map(f => [f.level, f.code, f.where, f.params.cause]), [['warn', 'channel-unreadable', 'bones/a/rotate', 'boom']]);
  issues.add('channel-unreadable', 'bones/a/rotate', 'again', {});
  assert.equal(issues.list.length, 1, 'one issue per code@where');
});

test('measurement: neutral values, unknown channels, empty input', () => {
  assert.equal(measureChannel('rotate', []), null);
  assert.equal(measureChannel('rotate', undefined), null);
  assert.deepEqual(measureChannel('scale', [{ time: 0 }, { time: 1, x: 3 }]).x, { min: 1, max: 3, amplitude: 2 });
  assert.deepEqual(measureChannel('translate', [{ time: 0 }, { time: 1, y: -4 }]).y, { min: -4, max: 0, amplitude: 4 });
  // A channel without numeric fields (the 4.2 bone `inherit` timeline) gets counts only,
  // never invented zero amplitudes.
  const inherit = measureChannel('inherit', [{ inherit: 'noScale' }, { time: 1, inherit: 'normal' }]);
  assert.deepEqual(inherit, { keys: 2, first: 0, last: 1 });
  assert.ok(!('averageSpacing' in measureChannel('rotate', [{ time: 0 }, { time: 1 }])), 'spacing needs more than two keys');
});

test('compressed keys for slot channels: names (null = hidden), two-colour tint, values', () => {
  assert.deepEqual(compressKeys('attachment', [{ name: 'open' }, { time: 1, name: null }, { time: 2 }]),
    { time: [0, 1, 2], name: ['open', null, null] });
  assert.deepEqual(compressKeys('rgba2', [{ light: 'ffffffff', dark: '000000' }, { time: 1, light: 'ff0000ff', dark: '00ff00', curve: 'stepped' }]),
    { time: [0, 1], light: ['ffffffff', 'ff0000ff'], dark: ['000000', '00ff00'], curve: ['linear', 'stepped'] });
  assert.deepEqual(compressKeys('sheary', [{ time: 0, value: 1.23456 }]), { time: [0], value: [1.235] });
  assert.deepEqual(compressKeys('inherit', [{ inherit: 'noScale' }]), { time: [0], inherit: ['noScale'] });
  const keys = [{ time: 1, value: 2 }];
  assert.equal(compressKeys('rotate', keys, true), keys, 'raw passes the array through');
});

test('frame grid: examples are capped and the fps falls back to 30', () => {
  const keys = Array.from({ length: 12 }, (_, i) => ({ time: (i + 0.5) / 30 }));
  const report = frameGridReport({ bones: { b: { rotate: keys } } }, 0);
  assert.equal(report.fps, 30);
  assert.equal(report.offGridKeys, 12);
  assert.equal(report.examples.length, 8);
});

test('draw-order changes: steps are signed, unknown slots in the order are ignored', () => {
  assert.deepEqual(drawOrderChanges(['a', 'b', 'c'], ['a', 'b', 'c']), []);
  assert.deepEqual(drawOrderChanges(['a', 'b', 'c'], ['c', 'a', 'b']), [
    { slot: 'a', setupIndex: 0, index: 1, steps: 1 }, { slot: 'b', setupIndex: 1, index: 2, steps: 1 },
    { slot: 'c', setupIndex: 2, index: 0, steps: -2 },
  ]);
  assert.deepEqual(drawOrderChanges(['a', 'b'], ['b']), [{ slot: 'b', setupIndex: 1, index: 0, steps: -1 }]);
});

test('the offset guard: valid keys pass, every broken shape is named', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(drawOrderOffsetProblems(order, [{ slot: 'a', offset: 2 }, { slot: 'b', offset: 2 }]), []);
  assert.deepEqual(drawOrderOffsetProblems(order, [{ slot: 'd', offset: -3 }]), [], 'to the very back is in range');
  assert.deepEqual(drawOrderOffsetProblems(order, undefined), []);
  assert.deepEqual(drawOrderOffsetProblems(order, [{ slot: 'b', offset: 0 }, { slot: 'b', offset: 1 }]).map(p => p.code),
    ['draw-order-unsorted'], 'the same slot twice is out of order');
  assert.deepEqual(drawOrderOffsetProblems(order, [{ slot: 'a', offset: -1 }]).map(p => p.code), ['draw-order-out-of-range']);
  assert.deepEqual(drawOrderOffsetProblems(order, [{ slot: 'a', offset: 1.5 }]).map(p => p.code), ['draw-order-out-of-range'],
    'a fractional offset is not an index');
  assert.deepEqual(drawOrderOffsetProblems(order, [{ slot: 'a', offset: 3 }, { slot: 'd' }]).map(p => p.code),
    ['draw-order-collision'], 'an offset-less entry stays in place and can collide');
  for (const p of drawOrderOffsetProblems(order, [{ slot: 'x' }, { slot: 'c', offset: 5 }])) {
    assert.ok(p.message.length > 10 && typeof p.slot === 'string', JSON.stringify(p));
  }
});

test('hazards across the skeleton carry where and params', () => {
  const sk = { slots: [{ name: 'a' }, { name: 'b' }], animations: {
    ok: { drawOrder: [{ offsets: [{ slot: 'a', offset: 1 }] }] },
    bad: { drawOrder: [{ offsets: [] }, { time: 1, offsets: [{ slot: 'b', offset: 1 }] }] },
    shapeless: { drawOrder: { not: 'an array' } },
    gone: null,
  } };
  assert.deepEqual(drawOrderHazards(sk).map(f => [f.level, f.code, f.where, f.params]),
    [['fatal', 'draw-order-out-of-range', 'animations/bad/drawOrder/1', { animation: 'bad', key: 1, slot: 'b' }]]);
  assert.deepEqual(drawOrderHazards({}), []);
});

test('the refusal wrapper: runtime refusals become a reason, anything else is thrown', async () => {
  const sk = { slots: [], animations: {} };
  assert.equal(await runtimeRefusal(sk, async () => {}), null);
  assert.deepEqual(await runtimeRefusal(sk, async () => { throw new StudioError('runtime-version', 'old file'); }),
    { code: 'runtime-version', message: 'old file' });
  assert.deepEqual((await runtimeRefusal(sk, async () => { throw new StudioError('runtime-parse', 'rejected'); })).code, 'runtime-parse');
  await assert.rejects(runtimeRefusal(sk, async () => { throw new StudioError('unknown-skin', 'no'); }), err => isStudioError(err, 'unknown-skin'));
  await assert.rejects(runtimeRefusal(sk, async () => { throw new TypeError('bug'); }), TypeError);
  let ran = false;
  const hazard = { slots: [{ name: 'a' }], animations: { d: { drawOrder: [{ offsets: [{ slot: 'a', offset: 4 }] }] } } };
  const refused = await runtimeRefusal(hazard, async () => { ran = true; });
  assert.equal(refused.code, 'draw-order-offsets');
  assert.equal(ran, false, 'the runtime work never starts on a hazardous file');
});
