// The gates every example in examples/showcase/<name> passes, read from its brief.json: the
// delivery loads on the studio's engine with nothing left out, every clip the brief lists is there
// with its length, critique_animation has no warning for any of them, check_skeleton finds nothing
// fatal, the events fire on the frames the brief names, and, with the Spine add-on, the official
// runtime poses every clip as the engine does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileSkeleton, sample } from '../../src/engine/index.js';
import { critiqueAnimation, clipDuration } from '../../src/understand/critique.js';
import { checkSkeleton } from '../../src/spine/check.js';
import { SPINE, needsSpine } from './spine-addon.js';

const TOLERANCE = 0.01;

/** The example's brief and its delivered skeleton. */
export function readShowcase(name) {
  const read = file => JSON.parse(readFileSync(fileURLToPath(new URL(`../../examples/showcase/${name}/${file}`, import.meta.url)), 'utf8'));
  return { brief: read('brief.json'), skeleton: read(`${name}_v2.json`) };
}

/** Every frame of a clip at 30 fps, as seconds. */
export const frames = seconds => Array.from({ length: Math.round(seconds * 30) + 1 }, (_, i) => +(i / 30).toFixed(4));

/** The largest distance between the same bone in two poses, and which bone it is. */
export function apart(a, b) {
  let worst = 0, where = '';
  a.bones.forEach((x, i) => { const d = Math.hypot(x.worldX - b.bones[i].worldX, x.worldY - b.bones[i].worldY); if (d > worst) { worst = d; where = x.name; } });
  return { worst, where };
}

/** Registers the shared gates for one showcase example; returns its brief and skeleton for more. */
export function showcaseGates(name) {
  const { brief, skeleton } = readShowcase(name);

  test(`${name}: the delivery loads on the engine and nothing in it is left out`, () => {
    const model = compileSkeleton(skeleton);
    assert.deepEqual(model.unsupported, [], 'the engine reports parts it does not play');
    assert.deepEqual(checkSkeleton(skeleton).filter(f => f.level === 'fatal'), []);
  });

  test(`${name}: every clip the brief lists is there, with its length, and no other`, () => {
    assert.deepEqual(Object.keys(skeleton.animations).sort(), brief.clips.map(c => c.name).sort());
    const model = compileSkeleton(skeleton);
    for (const clip of brief.clips) {
      assert.ok(Math.abs(clipDuration(skeleton.animations[clip.name]) - clip.seconds) < 1e-3, `${clip.name} lasts ${clipDuration(skeleton.animations[clip.name])} s, the brief says ${clip.seconds}`);
      assert.ok(Math.abs(model.animations.get(clip.name).duration - clip.seconds) < 1e-3, `${clip.name}: the engine plays it for ${model.animations.get(clip.name).duration} s`);
    }
  });

  test(`${name}: critique_animation has no warning for any clip`, () => {
    for (const clip of brief.clips) {
      const warnings = critiqueAnimation(skeleton, clip.name, { loop: clip.loop, pixelsPerUnit: brief.display.pixelsPerUnit, subject: brief.principles }).findings.filter(x => x.level === 'warn');
      assert.deepEqual(warnings.map(x => `${x.code}: ${x.message}`), [], clip.name);
    }
  });

  test(`${name}: the events fire on the frames the brief names`, () => {
    const fired = {};
    for (const clip of Object.values(skeleton.animations)) for (const e of clip.events ?? []) (fired[e.name] ??= []).push(e.time ?? 0);
    const listed = brief.events ?? {};
    assert.deepEqual(Object.keys(fired).sort(), Object.keys(listed).sort());
    for (const [event, times] of Object.entries(listed)) assert.deepEqual(fired[event].sort((a, b) => a - b), times, event);
    for (const event of Object.keys(listed)) assert.ok(skeleton.events?.[event], `${event} is not defined in the skeleton`);
  });

  test(`${name}: the official runtime poses every clip as the engine does`, needsSpine, async () => {
    const data = await SPINE.parseSkeleton(skeleton);
    const model = compileSkeleton(skeleton);
    for (const clip of brief.clips) {
      const times = frames(clip.seconds);
      const official = await SPINE.sampleAnimation(data, clip.name, times), ours = sample(model, clip.name, times);
      official.forEach((a, i) => {
        const b = ours[i], at = `${clip.name} @${a.time}`;
        a.bones.forEach((x, j) => {
          const y = b.bones[j];
          for (const k of ['worldX', 'worldY']) assert.ok(Math.abs(x[k] - y[k]) <= TOLERANCE, `${at}: ${x.name}.${k} ${x[k]} vs ${y[k]}`);
          for (const k of ['a', 'b', 'c', 'd']) assert.ok(Math.abs(x.matrix[k] - y.matrix[k]) <= TOLERANCE / 100, `${at}: ${x.name}.matrix.${k}`);
        });
        a.slots.forEach((x, j) => {
          const y = b.slots[j];
          assert.equal(x.attachment, y.attachment, `${at}: ${x.name} shows ${x.attachment} vs ${y.attachment}`);
          for (const k of ['r', 'g', 'b', 'a']) assert.ok(Math.abs(x.color[k] - y.color[k]) <= TOLERANCE / 100, `${at}: ${x.name}.color.${k}`);
        });
        assert.equal(a.drawOrder.join(), b.drawOrder.join(), `${at}: draw order`);
      });
    }
  });

  return { brief, skeleton };
}
