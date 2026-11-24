// Gate for src/deliver/policy.js — which version of a clip wins in a delivery.
// Ported from legacy delivery.js behaviour and test_silme.js (deletion), plus the two
// silent-loss reports the rules came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAnimations, mergeClip, deleteAnimations, changesBetween } from '../src/deliver/policy.js';

test('between clips: written wins, target beats base, base-only survives', () => {
  const fromBase = { walk: { v: 'base-new-write' }, idle: { v: 'base' }, jump: { v: 'base' } };
  const inTarget = { walk: { v: 'old-target' }, idle: { v: 'target' }, extra: { v: 'target-only' } };
  const r = mergeAnimations(fromBase, inTarget, 'walk');
  assert.deepEqual(r.animations, {
    walk: { v: 'base-new-write' }, idle: { v: 'target' }, jump: { v: 'base' }, extra: { v: 'target-only' } });
  assert.deepEqual(r.carried, ['extra']);
  assert.deepEqual(r.kept, ['idle']);
});

test('the twelve-clip loss: writing clips in sequence accumulates instead of reverting', () => {
  // Legacy finding K: the base held clipA at 5 degrees; clipA was written at 90 into the
  // target, then clipB was written, and clipA silently reverted to 5.
  const base = { clipA: { deg: 5 }, clipB: { deg: 0 } };
  let target = {};
  for (const [name, deg] of [['clipA', 90], ['clipB', 45]]) {
    const fromBase = { ...base, [name]: { deg } };
    target = mergeAnimations(fromBase, target, name).animations;
  }
  assert.deepEqual(target, { clipA: { deg: 90 }, clipB: { deg: 45 } });
});

test('inside a clip: a second call keying another bone keeps the first bone', () => {
  const first = { bones: { arm: { rotate: [{ value: 10 }] } } };
  const second = { bones: { leg: { rotate: [{ value: 20 }] } } };
  const { clip, carried } = mergeClip(first, second);
  assert.deepEqual(clip.bones, { arm: { rotate: [{ value: 10 }] }, leg: { rotate: [{ value: 20 }] } });
  assert.deepEqual(carried, ['bones:arm']);
});

test('inside a clip: per channel, untouched channels of a re-keyed bone survive', () => {
  const lower = { bones: { arm: { rotate: [{ value: 1 }], translate: [{ x: 1, y: 1 }] } }, slots: { s: { rgba: [{ color: 'ffffffff' }] } } };
  const upper = { bones: { arm: { rotate: [{ value: 9 }] } } };
  const { clip, carried } = mergeClip(lower, upper);
  assert.deepEqual(clip.bones.arm, { rotate: [{ value: 9 }], translate: [{ x: 1, y: 1 }] });
  assert.deepEqual(clip.slots, lower.slots);
  assert.deepEqual(carried.sort(), ['bones:arm.translate', 'slots:s']);
});

test('inside a clip: constraint key arrays and draw order are replaced, not merged', () => {
  const lower = { ik: { reach: [{ mix: 1 }, { time: 1, mix: 0 }] }, drawOrder: [{ offsets: [{ slot: 'a', offset: 1 }] }] };
  const upper = { ik: { reach: [{ mix: 0.5 }] }, drawOrder: [] };
  const { clip } = mergeClip(lower, upper);
  assert.deepEqual(clip.ik.reach, [{ mix: 0.5 }]);
  assert.deepEqual(clip.drawOrder, []);
  assert.deepEqual(mergeClip(null, null).clip, {});
});

test('deletion keeps order and identity, reports missing names, never mutates its input', () => {
  const a = { one: { k: 1 }, two: { k: 2 }, three: { k: 3 } };
  const r = deleteAnimations(a, ['two']);
  assert.deepEqual(Object.keys(r.animations), ['one', 'three']);
  assert.equal(r.animations.one, a.one, 'survivors are the same objects');
  assert.deepEqual(Object.keys(a), ['one', 'two', 'three']);
  const partial = deleteAnimations(a, ['missing', 'two']);
  assert.deepEqual(partial.missing, ['missing'], 'the caller must refuse the whole request');
  assert.deepEqual(deleteAnimations(a, ['one', 'two', 'three']).remainingNames, [], 'an empty animations map is valid Spine');
});

test('deletion treats names as identity: duplicates collapse, spaces are real characters', () => {
  // Legacy trimmed here, while its own delivery service forbade renaming by trimming.
  // Identity wins: " two " is a different animation name.
  const a = { two: {}, ' two ': {} };
  const r = deleteAnimations(a, ['two', 'two']);
  assert.deepEqual(r.deleted, ['two']);
  assert.deepEqual(r.remainingNames, [' two ']);
  assert.deepEqual(deleteAnimations({ two: {} }, [' two ']).missing, [' two ']);
});

test('changesBetween names what was added, changed and removed', () => {
  assert.deepEqual(changesBetween({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 }), { added: ['d'], changed: ['b'], removed: ['c'] });
  assert.deepEqual(changesBetween(null, null), { added: [], changed: [], removed: [] });
});
