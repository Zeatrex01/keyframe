// The coin burst in examples/showcase/coin-burst: eight coins pop from the burst and fly into the
// counter; each landing fires coin_land with the coin's number, on the frame the coin arrives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkeleton, sample } from '../src/engine/index.js';
import { showcaseGates } from './helpers/showcase.js';

const { skeleton } = showcaseGates('coin-burst');
const model = compileSkeleton(skeleton);
const pose = time => sample(model, 'burst', [time])[0];
const bone = (s, name) => s.bones.find(b => b.name === name);
const alpha = (s, slot) => s.slots.find(x => x.name === slot).color.a;

test('coin-burst: each coin lands in the counter on its own coin_land event, then is gone', () => {
  const events = skeleton.animations.burst.events;
  assert.deepEqual(events.map(e => e.int), [1, 2, 3, 4, 5, 6, 7, 8], 'one event per coin, in order');
  for (const { time, int } of events) {
    const coin = 'coin' + int, near = t => { const s = pose(t), a = bone(s, coin), c = bone(s, 'counterCoin'); return Math.hypot(a.worldX - c.worldX, a.worldY - c.worldY); };
    assert.ok(near(time) < 8, `${coin} is ${near(time).toFixed(1)} from the counter on its event`);
    assert.ok(near(time - 0.1333) > 40, `${coin} is already at the counter before its event`);
    assert.ok(alpha(pose(time), coin) > 0.99, `${coin} is not visible as it lands`);
    assert.ok(alpha(pose(time + 0.1), coin) < 0.01, `${coin} stays on screen after it lands`);
  }
});

test('coin-burst: the sparkle loop keys only the sparkles, so it plays on track 1 over anything', () => {
  const a = skeleton.animations.sparkle;
  for (const name of [...Object.keys(a.bones ?? {}), ...Object.keys(a.slots ?? {})]) assert.match(name, /^sparkle\d$/);
});
