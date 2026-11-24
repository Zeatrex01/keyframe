// The PLAY button in examples/showcase/play-button: its states on track 0 and its badge on track 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkeleton, sample } from '../src/engine/index.js';
import { showcaseGates } from './helpers/showcase.js';

const { brief, skeleton } = showcaseGates('play-button');
const model = compileSkeleton(skeleton);
const end = clip => sample(model, clip, [model.animations.get(clip).duration])[0];
const scale = (s, name) => s.bones.find(b => b.name === name).worldScaleX;
const BADGE = ['badge', 'badgeRing'];

test('play-button: the badge clips key only the badge, and the button states never touch it', () => {
  for (const clip of brief.clips) {
    const a = skeleton.animations[clip.name];
    const keyed = [...Object.keys(a.bones ?? {}), ...Object.keys(a.slots ?? {})];
    if (clip.track === 1) assert.deepEqual(keyed.filter(n => !BADGE.includes(n)), [], `${clip.name} keys more than the badge`);
    else assert.deepEqual(keyed.filter(n => BADGE.includes(n)), [], `${clip.name} keys the badge, so the two tracks fight`);
  }
});

test('play-button: hover lifts the button, press sinks it, release brings it back to rest', () => {
  assert.ok(scale(end('hover_in'), 'button') > 1.02, 'hover does not lift the button');
  assert.ok(scale(end('press'), 'button') < 0.98, 'press does not sink the button');
  assert.ok(Math.abs(scale(end('release'), 'button') - 1) < 0.005, 'release does not settle at rest');
});

test('play-button: disabled swaps to the grey rim and face and dims the icon and the label', () => {
  const s = end('disabled'), slot = name => s.slots.find(x => x.name === name);
  assert.equal(slot('rim').attachment, 'rim_off'); assert.equal(slot('faceArt').attachment, 'face_off');
  for (const name of ['icon', 'label']) assert.ok(slot(name).color.a < 0.8, `${name} is not dimmed`);
});
