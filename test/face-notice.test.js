// The cat's `notice` clip in test/fixtures/face (kept from the retired cat example): written
// through the studio, with ears and whiskers baked from follow requests. Checked on the official runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSkeleton, sampleAnimation } from '../src/runtime/index.js';
import { checkSkeleton } from '../src/spine/check.js';

const file = fileURLToPath(new URL('./fixtures/face/cat_v2.json', import.meta.url));
const skeleton = JSON.parse(readFileSync(file, 'utf8'));

test('the cat delivery opens clean and keeps every emotion clip next to notice', () => {
  assert.deepEqual(checkSkeleton(skeleton).filter(f => f.level === 'fatal'), []);
  for (const name of ['neutral', 'happy', 'happy_in', 'to_neutral', 'notice']) assert.ok(skeleton.animations[name], name + ' is missing');
});

test('notice: the ears trail the head and settle, and no eye is ever stretched', async () => {
  const clip = skeleton.animations.notice;
  for (const bone of ['earL', 'earR', 'whiskerL', 'whiskerR']) assert.ok(clip.bones[bone]?.rotate?.length >= 4, bone + ' has no baked keys');
  const data = await parseSkeleton(skeleton);
  const times = Array.from({ length: 97 }, (_, i) => +(i / 30).toFixed(4));
  const samples = await sampleAnimation(data, 'notice', times);
  const bone = (s, name) => s.bones.find(b => b.name === name);
  const ear = samples.map(s => bone(s, 'earL').applied.rotation);
  assert.ok(Math.max(...ear.map(Math.abs)) > 5, 'the ears hardly move');
  assert.ok(Math.abs(ear[ear.length - 1]) < 1, `the ears have not settled at the end (${ear[ear.length - 1]})`);
  for (const s of samples) for (const name of ['eyeL', 'pupilL']) {
    const b = bone(s, name);
    assert.ok(Math.abs(b.worldScaleX / b.worldScaleY - 1) < 0.01, `${name} stretched at ${s.time}s (${b.worldScaleX.toFixed(3)} x ${b.worldScaleY.toFixed(3)})`);
  }
});
