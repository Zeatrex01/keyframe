// Gate for src/understand/principle-checks.js and src/understand/principles.js: the animation
// principles critique_animation measures (roadmap Phase 1). Each check fires on the textbook
// fault and stays quiet on the textbook fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { principleFindings } from '../src/understand/principle-checks.js';
import { critiqueAnimation } from '../src/understand/critique.js';
import { WRITING_RULES, CLIP_TIMING } from '../src/understand/principles.js';

const bones = [{ name: 'root' }, { name: 'body', parent: 'root', length: 80 }, { name: 'arm_l', parent: 'body', length: 40 },
  { name: 'arm_r', parent: 'body', length: 40 }, { name: 'hand_l', parent: 'arm_l', length: 20 }, { name: 'hand_r', parent: 'arm_r', length: 20 },
  { name: 'head', parent: 'body', length: 30 }];
const rig = (name, animation) => ({ bones, animations: { [name]: animation } });
const codes = (sk, name, options) => principleFindings(sk, name, options).map(f => f.code);
const rot = (times, values, curve) => times.map((time, i) => ({ time, value: values[i], ...(curve && i < times.length - 1 ? { curve: curve(time, times[i + 1], values[i], values[i + 1]) } : {}) }));

test('bones keyed on the same frames are reported; offset children are not', () => {
  const block = Object.fromEntries(['body', 'arm_l', 'arm_r', 'head'].map((b, i) => [b, { rotate: rot([0, 0.3, 0.6], [0, 10 + i, 0]) }]));
  assert.ok(codes(rig('wave', { bones: block }), 'wave').includes('no-overlap'));
  const offset = Object.fromEntries(['body', 'arm_l', 'arm_r', 'head'].map((b, i) => [b, { rotate: rot([0, 0.3 + i / 30, 0.6 + i / 30], [0, 10 + i, 0]) }]));
  assert.ok(!codes(rig('wave', { bones: offset }), 'wave').includes('no-overlap'));
});

test('one ease shape on most segments is reported', () => {
  const same = (t0, t1, v0, v1) => [t0 + (t1 - t0) * 0.37, v0, t0 + (t1 - t0) * 0.63, v1];
  const varied = [(t0, t1, v0, v1) => [t0 + (t1 - t0) * 0.33, v1, t0 + (t1 - t0) * 0.68, v1], (t0, t1, v0, v1) => [t0 + (t1 - t0) * 0.32, v0, t0 + (t1 - t0) * 0.67, v0]];
  const times = [0, 0.2, 0.5, 0.7, 1, 1.3];
  const values = [0, 20, -5, 15, 0, 8];
  assert.ok(codes(rig('a', { bones: { body: { rotate: rot(times, values, same) } } }), 'a').includes('same-ease'));
  let n = 0;
  assert.ok(!codes(rig('a', { bones: { body: { rotate: rot(times, values, () => null).map((k, i) => i < times.length - 1
    ? { ...k, curve: varied[n++ % 2](times[i], times[i + 1], values[i], values[i + 1]) } : k) } } }), 'a').includes('same-ease'));
});

test('a squash that inflates the volume, and squash on a parent bone, are reported', () => {
  const inflate = rig('land', { bones: { hand_l: { scale: [{ time: 0 }, { time: 0.1, x: 1.3, y: 0.95 }, { time: 0.3 }] } } });
  assert.ok(codes(inflate, 'land').includes('squash-volume'));
  const kept = rig('land', { bones: { hand_l: { scale: [{ time: 0 }, { time: 0.1, x: 1.25, y: 0.8 }, { time: 0.3 }] } } });
  assert.deepEqual(codes(kept, 'land'), []);
  const parent = rig('land', { bones: { body: { scale: [{ time: 0 }, { time: 0.1, x: 1.25, y: 0.8 }, { time: 0.3 }] } } });
  assert.ok(codes(parent, 'land').includes('squash-on-parent'));
});

test('a loop that ends away from its start pops at the seam; a closed loop does not', () => {
  const open = rig('idle', { bones: { head: { rotate: rot([0, 1, 2], [0, 4, 1]) } } });
  assert.ok(codes(open, 'idle').includes('loop-seam'));
  assert.ok(!codes(open, 'idle', { loop: false }).includes('loop-seam'), 'loop: false turns the check off');
  const closed = rig('idle', { bones: { head: { rotate: rot([0, 1, 2], [0, 4, 0]) } } });
  assert.ok(!codes(closed, 'idle').includes('loop-seam'));
});

test('left and right keyed identically are twins; an offset side is not', () => {
  const twin = rig('cheer', { bones: { arm_l: { rotate: rot([0, 0.4], [0, 30]) }, arm_r: { rotate: rot([0, 0.4], [0, 30]) } } });
  assert.ok(codes(twin, 'cheer').includes('twinning'));
  const apart = rig('cheer', { bones: { arm_l: { rotate: rot([0, 0.4], [0, 30]) }, arm_r: { rotate: rot([1 / 30, 0.4 + 1 / 30], [0, 26]) } } });
  assert.ok(!codes(apart, 'cheer').includes('twinning'));
});

test('a move too small to see at the display size is reported', () => {
  const tiny = rig('nudge', { bones: { body: { translate: [{ time: 0 }, { time: 0.3, x: 0.5 }] } } });
  assert.ok(codes(tiny, 'nudge').includes('below-readable'));
  assert.ok(!codes(tiny, 'nudge', { pixelsPerUnit: 8 }).includes('below-readable'), '0.5 units at 8 px per unit is 4 px');
});

test('principle findings ride on critique_animation as warnings that never change the verdict', () => {
  const sk = rig('idle', { bones: { head: { rotate: rot([0, 0.5, 1.1, 2], [0, 4, 3, 1], (t0, t1, v0, v1) => [t0 + (t1 - t0) * 0.3, v0, t0 + (t1 - t0) * 0.7, v1]) } } });
  const result = critiqueAnimation(sk, 'idle');
  const seam = result.findings.find(f => f.code === 'loop-seam');
  assert.equal(seam.level, 'warn');
  assert.equal(seam.params.principle, 'loops');
  assert.equal(seam.params.severity, 'look');
  assert.equal(result.verdict, 'good');
});

test('the writing rules and clip timing are complete data', () => {
  assert.ok(WRITING_RULES.length >= 12);
  for (const r of WRITING_RULES) assert.ok(r.principle && r.rule.length > 40, r.principle);
  for (const c of CLIP_TIMING) assert.ok(c.seconds[0] > 0 && c.seconds[1] >= c.seconds[0], c.clip);
});
