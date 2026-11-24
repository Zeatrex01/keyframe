// Gate for src/understand/actions.js: the per-action minimums critique_animation holds a figure to.
// Each check fires on the weak version of the action and stays quiet on the senior version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionFindings, actionOf } from '../src/understand/actions.js';
import { critiqueAnimation } from '../src/understand/critique.js';

// A small standing figure: hips at 100 pointing up, a head above, one arm hanging, one leg.
const bones = [
  { name: 'root' },
  { name: 'hips', parent: 'root', y: 100, rotation: 90, length: 60 },
  { name: 'head', parent: 'hips', x: 80, length: 30 },
  { name: 'arm_r', parent: 'hips', x: 60, rotation: 180, length: 70 },
  { name: 'hand_r', parent: 'arm_r', x: 70, length: 15 },
  { name: 'leg_l', parent: 'root', y: 100, rotation: -90, length: 100 },
];
const rig = (name, animation) => ({ skeleton: { height: 220 }, bones, animations: { [name]: animation } });
const codes = (sk, name, options) => actionFindings(sk, name, options).map(f => f.code);
const keys = (times, values, field = 'value', curve) => times.map((time, i) => ({ time, [field]: values[i],
  ...(curve && i < times.length - 1 ? { curve: curve(time, times[i + 1], values[i], values[i + 1]) } : {}) }));
// For a translate key: the x channel stays linear, the y channel takes the curve.
const yCurve = shape => (t0, t1, v0, v1) => [t0 + (t1 - t0) / 3, 0, t0 + (t1 - t0) * 2 / 3, 0, ...shape(t0, t1, v0, v1)];
const easeInOut = (t0, t1, v0, v1) => [t0 + (t1 - t0) * 0.42, v0, t0 + (t1 - t0) * 0.58, v1];
const easeOut = (t0, t1, v0, v1) => [t0 + (t1 - t0) / 3, v0 + (v1 - v0) * 2 / 3, t0 + (t1 - t0) * 2 / 3, v1];
const easeIn = (t0, t1, v0, v1) => [t0 + (t1 - t0) / 3, v0, t0 + (t1 - t0) * 2 / 3, v0 + (v1 - v0) / 3];

test('the action comes from the clip name', () => {
  assert.equal(actionOf('punch_right'), 'strike');
  assert.equal(actionOf('hit_react'), null);
  assert.equal(actionOf('big-jump'), 'jump');
  assert.equal(actionOf('hop'), 'hop');
  assert.equal(actionOf('walk_wave'), 'wave');
  assert.equal(actionOf('idle'), 'idle');
  assert.equal(actionOf('spin'), null);
  assert.equal(actionOf('anything', 'jump'), 'jump');
});

test('a strike thrown by the arm alone has no weight behind it; one driven from the hips has', () => {
  const arm = { rotate: keys([0, 0.2, 0.26, 0.4, 0.6], [0, 20, -90, -90, 0]) };
  const weak = rig('punch', { bones: { arm_r: arm } });
  assert.ok(codes(weak, 'punch').includes('no-weight-shift'));
  assert.equal(critiqueAnimation(weak, 'punch').verdict, 'mechanical');
  const strong = rig('punch', { bones: { arm_r: arm,
    hips: { translate: keys([0, 0.2, 0.26, 0.4, 0.6], [0, 6, -20, -20, 0], 'x'), rotate: keys([0, 0.2, 0.26, 0.6], [0, -6, 18, 0]) } } });
  assert.deepEqual(codes(strong, 'punch'), [], 'weight shift, wind-up, a fast blow and a held reach');
  const noWindUp = rig('punch', { bones: { arm_r: { rotate: keys([0, 0.06, 0.4], [0, -90, 0]) } } });
  assert.ok(codes(noWindUp, 'punch').includes('no-wind-up'));
  assert.ok(codes(noWindUp, 'punch').includes('no-impact'));
});

test('a jump that rises less than a quarter of the height reads as a hop', () => {
  const low = rig('jump', { bones: { hips: { translate: keys([0, 0.15, 0.4, 0.65, 0.8], [0, -10, 20, 0, 0], 'y') } } });
  assert.ok(codes(low, 'jump').includes('low-jump'));
  const high = rig('jump', { bones: { hips: { translate: keys([0, 0.15, 0.45, 0.75, 0.9], [0, -15, 80, 0, 0], 'y') } } });
  assert.ok(!codes(high, 'jump').includes('low-jump'));
  assert.ok(!codes(high, 'jump').includes('no-crouch'));
  const noCrouch = rig('jump', { bones: { hips: { translate: keys([0, 0.3, 0.6, 0.8], [0, 80, 0, 0], 'y') } } });
  assert.ok(codes(noCrouch, 'jump').includes('no-crouch'));
});

test('a hop that slows into the ground floats; one that falls with an ease-in lands', () => {
  const times = [0, 0.25, 0.5, 0.7], ys = [0, 30, 0, 0];
  const floaty = rig('hop', { bones: { hips: { translate: keys(times, ys, 'y', yCurve(easeInOut)) } } });
  assert.ok(codes(floaty, 'hop').includes('floaty-landing'));
  const segments = [easeOut, easeIn, easeInOut];
  let n = 0;
  const landed = rig('hop', { bones: { hips: { translate: keys(times, ys, 'y', (...a) => yCurve(segments[n++])(...a)) } } });
  assert.ok(!codes(landed, 'hop').includes('floaty-landing'));
});

test('a wave below the head reads as a salute; a wave above it with swings does not', () => {
  const low = rig('wave', { bones: { arm_r: { rotate: keys([0, 0.2, 0.4, 0.6, 0.8], [90, 70, 90, 70, 90]) } } });
  assert.ok(codes(low, 'wave').includes('low-wave'));
  const high = rig('wave', { bones: { arm_r: { rotate: keys([0, 0.2, 0.4, 0.6, 0.8], [180, 160, 200, 160, 180]) } } });
  assert.deepEqual(codes(high, 'wave'), []);
  const still = rig('wave', { bones: { arm_r: { rotate: keys([0, 0.4], [180, 182]) } } });
  assert.ok(codes(still, 'wave').includes('no-wave-swing'));
});

test('an idle that does not breathe is flagged; a breathing chest is not', () => {
  const dead = rig('idle', { bones: { head: { rotate: keys([0, 1, 2], [0, 3, 0]) } } });
  assert.ok(codes(dead, 'idle').includes('no-breath'));
  const breathing = rig('idle', { bones: { hips: { scale: [{ time: 0 }, { time: 1, x: 1, y: 1.02 }, { time: 2 }] } } });
  assert.ok(!codes(breathing, 'idle').includes('no-breath'));
});

test('UI parts, effects and props are not judged as a body', () => {
  const low = rig('jump', { bones: { hips: { translate: keys([0, 0.15, 0.4, 0.65, 0.8], [0, -10, 20, 0, 0], 'y') } } });
  const codesOf = options => critiqueAnimation(low, 'jump', options).findings.map(f => f.code);
  assert.ok(codesOf({}).includes('low-jump'));
  for (const subject of ['ui', 'vfx', 'prop']) assert.ok(!codesOf({ subject }).includes('low-jump'), subject);
  assert.ok(codesOf({ subject: 'character' }).includes('low-jump'));
});

test('a walk whose body does not rise and fall is flagged; a bob on the hips is enough', () => {
  const legs = { leg_l: { rotate: keys([0, 0.5, 1], [-20, 20, -20]) } };
  assert.ok(codes(rig('walk', { bones: legs }), 'walk').includes('no-bob'));
  const bob = keys([0, 0.25, 0.5, 0.75, 1], [0, 6, 0, 6, 0], 'y');
  assert.ok(!codes(rig('walk', { bones: { ...legs, hips: { translate: bob } } }), 'walk').includes('no-bob'));
});
