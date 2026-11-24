// Pip in examples/showcase/pip: the human rig with its arms and legs on two-bone IK. Every frame
// of every clip: an IK target never leaves its limb's reach and the knees point away from the
// body's middle; in idle the feet stay planted; the jump lands on its land event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkeleton, sample } from '../src/engine/index.js';
import { showcaseGates, frames } from './helpers/showcase.js';

const { brief, skeleton } = showcaseGates('pip');
const model = compileSkeleton(skeleton);
const length = Object.fromEntries(skeleton.bones.filter(b => b.length).map(b => [b.name, b.length]));
const LIMBS = [['thighL', 'shinL', 'footTargetL'], ['thighR', 'shinR', 'footTargetR'], ['armL', 'forearmL', 'handTargetL'], ['armR', 'forearmR', 'handTargetR']];
const at = (s, name) => { const b = s.bones.find(x => x.name === name); return { x: b.worldX, y: b.worldY }; };
const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const play = clip => sample(model, clip, frames(model.animations.get(clip).duration));

test('pip: one look, four IK limbs', () => {
  assert.deepEqual(skeleton.skins.map(s => s.name), ['default']);
  assert.deepEqual(skeleton.ik.map(c => c.name).sort(), ['armL', 'armR', 'legL', 'legR']);
});

for (const { name } of brief.clips) {
  test(`pip ${name}: every IK target stays within reach and the knees point outward`, () => {
    for (const s of play(name)) {
      for (const [upper, lower, target] of LIMBS) {
        const limb = (length[upper] + length[lower]) * distance(at(s, upper), at(s, lower)) / length[upper];
        assert.ok(distance(at(s, upper), at(s, target)) <= limb + 0.6, `${name} @${s.time}: ${target} is out of reach`);
      }
      for (const [thigh, shin, target] of LIMBS.slice(0, 2)) {
        const hip = at(s, thigh), knee = at(s, shin), foot = at(s, target);
        const onLine = hip.x + (foot.x - hip.x) * (knee.y - hip.y) / (foot.y - hip.y);
        assert.ok((knee.x - onLine) * Math.sign(hip.x - at(s, 'hips').x) > 0, `${name} @${s.time}: ${shin} knee points inward`);
      }
    }
  });
}

test('pip idle: the feet stay planted while the hips shift', () => {
  const samples = play('idle');
  for (const foot of ['footL', 'footR']) {
    const xs = samples.map(s => at(s, foot).x), ys = samples.map(s => at(s, foot).y);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 0.2 && Math.max(...ys) - Math.min(...ys) < 0.2, foot + ' slides');
  }
  const hips = samples.map(s => at(s, 'hips').x);
  assert.ok(Math.max(...hips) - Math.min(...hips) > 5, 'the hips do not move, so planted feet prove nothing');
});

test('pip jump: the feet leave the ground and come back down on the land event', () => {
  const samples = play('jump'), land = brief.events.land[0];
  const feet = s => Math.min(at(s, 'footL').y, at(s, 'footR').y);
  const ground = feet(samples[0]);
  assert.ok(Math.max(...samples.map(feet)) - ground > 40, 'the jump never leaves the ground');
  const touch = samples.find(s => s.time > 0.2 && feet(s) - ground < 0.5 && feet(samples[samples.indexOf(s) - 1]) - ground >= 0.5);
  assert.ok(touch, 'the feet never come back down');
  assert.ok(Math.abs(touch.time - land) < 1e-3, `the feet touch down at ${touch.time} s, the land event fires at ${land} s`);
});
