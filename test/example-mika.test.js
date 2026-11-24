// Mika in examples/showcase/mika: an anime girl, a painted rig, an emotion set and a wave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkeleton, sample } from '../src/engine/index.js';
import { showcaseGates, apart } from './helpers/showcase.js';

const { skeleton } = showcaseGates('mika');
const model = compileSkeleton(skeleton);
const pose = (clip, time) => sample(model, clip, [time])[0];
const end = clip => model.animations.get(clip).duration;

test('mika: each way in ends on the pose its loop starts from, and to_idle ends on idle', () => {
  for (const [into, loop] of [['happy_in', 'happy'], ['surprised_in', 'surprised'], ['to_idle', 'idle']]) {
    const { worst, where } = apart(pose(into, end(into)), pose(loop, 0));
    assert.ok(worst < 0.5, `${into} ends ${worst.toFixed(2)} away from ${loop} (${where})`);
  }
});

test('mika: the waving hand shows only while the arm is up, and the arm comes back down', () => {
  const shown = t => pose('wave', t).slots.find(s => s.name === 'handR').attachment;
  assert.equal(shown(0), null); assert.equal(shown(end('wave')), null);
  assert.equal(shown(0.5), 'handR');
  const elbow = t => pose('wave', t).bones.find(b => b.name === 'forearmR');
  assert.ok(elbow(0.5).worldY - elbow(0).worldY > 60, 'the forearm is not raised for the wave');
  assert.ok(apart(pose('wave', end('wave')), pose('idle', 0)).worst < 0.5, 'the wave does not return to idle');
});
