// The reward chest in examples/showcase/chest: it drops in, shakes, opens, and three cards fly out
// and turn face up, each on its own event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkeleton, sample } from '../src/engine/index.js';
import { showcaseGates } from './helpers/showcase.js';

const { brief, skeleton } = showcaseGates('chest');
const model = compileSkeleton(skeleton);
const pose = time => sample(model, 'appear', [time])[0];
const bone = (s, name) => s.bones.find(b => b.name === name);
const shows = (s, slot) => s.slots.find(x => x.name === slot).attachment;
const END = model.animations.get('appear').duration;

test('chest: the lid is shut until the open event and stays open after it', () => {
  const open = brief.events.open[0];
  assert.equal(shows(pose(open - 0.05), 'lid'), 'lid_closed');
  assert.equal(shows(pose(open - 0.05), 'lidBack'), null);
  for (const t of [open + 0.15, END]) { assert.equal(shows(pose(t), 'lid'), null); assert.equal(shows(pose(t), 'lidBack'), 'lid_open'); }
  for (const n of [1, 2, 3]) assert.equal(shows(pose(open), 'cardArt' + n), null, `card ${n} shows before the chest opens`);
});

test('chest: each card arrives on its event, in order, face up and at full size in a fan', () => {
  const times = [1, 2, 3].map(n => brief.events['card_' + n][0]);
  assert.ok(times[0] < times[1] && times[1] < times[2], 'the cards do not arrive one after the other');
  const end = pose(END), xs = [];
  [1, 2, 3].forEach((n, i) => {
    const rest = bone(end, 'card' + n), d = t => { const b = bone(pose(t), 'card' + n); return Math.hypot(b.worldX - rest.worldX, b.worldY - rest.worldY); };
    assert.ok(d(times[i]) < 12, `card ${n} is ${d(times[i]).toFixed(1)} from its place on its event`);
    assert.ok(d(times[i] - 0.2) > 30, `card ${n} is already there before its event`);
    assert.ok(Math.abs(rest.worldScaleX - 1) < 0.01 && Math.abs(rest.worldScaleY - 1) < 0.01, `card ${n} ends at ${rest.worldScaleX} x ${rest.worldScaleY}`);
    assert.equal(shows(end, 'cardArt' + n), 'card_front' + n);
    xs.push(rest.worldX);
  });
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], 'the cards do not end in a fan from left to right');
});
