// Follow-through as a request: a bone trails another through a damped spring, baked to keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnimation } from '../src/deliver/normalize.js';
import { valueAt } from '../src/deliver/follow.js';
import { isStudioError } from '../src/shared/errors.js';

const turn = { rotate: [{ time: 0, value: 0, curve: 'outCubic' }, { time: 0.3, value: 30 }, { time: 1.8, value: 30 }] };
const play = (keys, fps, seconds) => Array.from({ length: Math.round(seconds * fps) + 1 }, (_, i) => valueAt(keys, 'value', 0, i / fps));

test('a follower lags while its leader turns, swings past when it stops, and settles', () => {
  const { animation, followed } = normalizeAnimation({ bones: { head: turn, tail: { rotate: { follow: 'head', frequency: 2, damping: 0.3 } } } });
  const keys = animation.bones.tail.rotate;
  assert.ok(Array.isArray(keys) && keys.length >= 4 && keys.length <= 24, `baked to ${keys.length} keys`);
  const values = play(keys.map(k => ({ ...k, curve: undefined })), 30, 1.8);
  const low = Math.min(...values), high = Math.max(...values);
  assert.ok(low < -4, `it should trail behind the turn (lowest ${low})`);
  assert.ok(high > 1, `it should swing past when the leader stops (highest ${high})`);
  assert.ok(values.indexOf(low) < values.indexOf(high), 'the lag comes before the overshoot');
  assert.ok(Math.abs(values[values.length - 1]) < 0.6, `it should have settled (ends at ${values[values.length - 1]})`);
  assert.equal(followed.length, 1); assert.equal(followed[0].follows, 'head'); assert.equal(followed[0].note, undefined);
  // every baked key is a plain Spine key by the time it leaves the normalizer
  for (const key of keys) assert.ok(key.curve === undefined || Array.isArray(key.curve), JSON.stringify(key));
});

test('more damping swings less, and amount scales the swing', () => {
  const peak = request => normalizeAnimation({ bones: { head: turn, tail: { rotate: { follow: 'head', ...request } } } }).followed[0].peak;
  assert.ok(peak({ damping: 0.2 }) > 0);
  const over = request => Math.max(...play(normalizeAnimation({ bones: { head: turn, tail: { rotate: { follow: 'head', ...request } } } }).animation.bones.tail.rotate.map(k => ({ ...k, curve: undefined })), 30, 1.8));
  assert.ok(over({ damping: 0.2 }) > over({ damping: 1.2 }) + 1, 'a critically damped follower should not swing past like a loose one');
  assert.ok(Math.abs(peak({ amount: 2 }) - 2 * peak({ amount: 1 })) < 0.1);
});

test('in a loop the follower repeats: it ends exactly where it starts', () => {
  const sway = { rotate: [{ time: 0, value: 0, curve: 'inOutSine' }, { time: 0.5, value: 10, curve: 'inOutSine' }, { time: 1, value: 0, curve: 'inOutSine' }, { time: 1.5, value: -10, curve: 'inOutSine' }, { time: 2, value: 0 }] };
  const { animation, followed } = normalizeAnimation({ bones: { body: sway, hair: { rotate: { follow: 'body' } } } });
  const keys = animation.bones.hair.rotate;
  assert.equal(followed[0].loop, true);
  assert.equal(keys[0].value, keys[keys.length - 1].value);
  assert.ok(Math.abs(keys[0].value) > 0.3, 'mid-swing at the loop point, not parked at zero: ' + keys[0].value);
});

test('a chain follows link by link, and a travel can be followed too', () => {
  const hop = { translate: [{ time: 0, x: 0, y: 0, curve: 'outQuad' }, { time: 0.2, x: 0, y: 40 }, { time: 1.5, x: 0, y: 40 }] };
  const { animation, followed } = normalizeAnimation({ bones: { body: hop, a: { rotate: { follow: 'body', of: 'translate.y', amount: 0.3 } }, b: { rotate: { follow: 'a' } } } });
  assert.deepEqual(followed.map(f => f.where), ['bones/a/rotate', 'bones/b/rotate']);
  assert.ok(followed.every(f => f.peak > 0.5), JSON.stringify(followed));
  assert.ok(followed.every(f => f.loop === false), 'a one-shot stays a one-shot down the chain: ' + JSON.stringify(followed));
  assert.ok(Array.isArray(animation.bones.b.rotate));
});

test('requests that cannot be honoured are refused with the reason', () => {
  const refuses = (bones, pattern) => assert.throws(() => normalizeAnimation({ bones }), e => isStudioError(e) && pattern.test(e.message), JSON.stringify(bones));
  refuses({ tail: { rotate: { follow: 'head' } }, x: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 5 }] } }, /"head" has no rotate keys/);
  refuses({ a: { rotate: { follow: 'b' } }, b: { rotate: { follow: 'a' } }, x: { rotate: [{ time: 1, value: 5 }] } }, /circle/);
  refuses({ head: turn, tail: { translate: { follow: 'head' } } }, /only rotate can follow/);
  refuses({ head: turn, tail: { rotate: { follow: 'head', frequency: 40 } } }, /frequency/);
  refuses({ head: turn, tail: { rotate: { follow: 'head', stiffness: 3 } } }, /not part of a follow request/);
});

test('a follower that has not settled when the clip ends says so', () => {
  const short = { rotate: [{ time: 0, value: 0 }, { time: 0.3, value: 30 }] };
  const { followed } = normalizeAnimation({ bones: { head: short, tail: { rotate: { follow: 'head', frequency: 1.5, damping: 0.2 } } } });
  assert.match(followed[0].note, /hold the leader's last key longer/);
});

test('keys on a bone the rig moves by physics are reported, and only on the channel physics drives', async () => {
  const { composeDelivery } = await import('../src/deliver/compose.js');
  const base = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }, { name: 'head', parent: 'root', length: 40 }, { name: 'hair', parent: 'head', length: 60 }],
    physics: [{ name: 'sway', bone: 'hair', rotate: 1 }] };
  const keys = [{ time: 0, value: 0 }, { time: 0.5, value: 10 }];
  const fights = await composeDelivery({ base, name: 'nod', animation: { bones: { head: { rotate: keys }, hair: { rotate: keys } } } });
  assert.deepEqual(fights.report.onPhysicsBones.map(f => [f.bone, f.constraint, f.channels]), [['hair', 'sway', ['rotate']]]);
  // a follow request lands on the same channel, so it is reported too
  const follows = await composeDelivery({ base, name: 'nod', animation: { bones: { head: { rotate: keys }, hair: { rotate: { follow: 'head' } } } } });
  assert.equal(follows.report.onPhysicsBones.length, 1);
  // moving only the parent, or keying a channel physics does not drive, is quiet
  const parent = await composeDelivery({ base, name: 'nod', animation: { bones: { head: { rotate: keys } } } });
  assert.equal(parent.report.onPhysicsBones, undefined);
  const other = await composeDelivery({ base, name: 'nod', animation: { bones: { hair: { scale: [{ time: 0, x: 1, y: 1 }, { time: 0.5, x: 1.1, y: 1.1 }] } } } });
  assert.equal(other.report.onPhysicsBones, undefined);
});
