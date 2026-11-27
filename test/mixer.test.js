// Gate for src/engine/mixer.js: tracks, layers, crossfades, additive layers, queued clips, events,
// and physics following the mixed pose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkeleton, Mixer, poseAt } from '../src/engine/index.js';

const near = (a, b, msg, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

function rig(extra = {}) {
  return compileSkeleton({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'hips', parent: 'root' }, { name: 'leg', parent: 'hips', length: 40 }, { name: 'arm', parent: 'hips', length: 30 },
      { name: 'hair', parent: 'hips', y: 50, length: 30 }],
    slots: [{ name: 'hand', bone: 'arm', attachment: 'open' }],
    skins: [{ name: 'default', attachments: { hand: { open: { width: 4, height: 4 }, fist: { width: 4, height: 4 } } } }],
    events: { step: {} , hit: { int: 3 } },
    animations: {
      idle: { bones: { leg: { rotate: [{ value: 0 }, { time: 1, value: 0 }] }, arm: { rotate: [{ value: 10 }, { time: 1, value: 10 }] } } },
      run: { bones: { leg: { rotate: [{ value: 40 }, { time: 0.5, value: -40 }, { time: 1, value: 40 }] }, arm: { rotate: [{ value: -30 }, { time: 1, value: -30 }] },
        hips: { translate: [{ y: 0 }, { time: 0.25, y: 10 }, { time: 0.5, y: 0 }, { time: 0.75, y: 10 }, { time: 1, y: 0 }] } },
        events: [{ time: 0.5, name: 'step' }] },
      punch: { bones: { arm: { rotate: [{ value: 90 }, { time: 0.4, value: 90 }] } }, slots: { hand: { attachment: [{ name: 'fist' }] } },
        events: [{ time: 0.1, name: 'hit' }] },
      breathe: { bones: { arm: { rotate: [{ value: 5 }, { time: 1, value: 5 }] } } },
    },
    ...extra,
  });
}

const rot = (mixer, name) => mixer.pose.bones[mixer.model.boneIndex.get(name)].rotation;

test('one track plays a clip as poseAt does', () => {
  const model = rig();
  const m = new Mixer(model);
  m.setAnimation(0, 'run');
  m.step(0); m.step(0.3);
  near(rot(m, 'leg'), poseAt(model, 'run', 0.3, { loop: true }).bones[2].rotation, 'same leg');
  m.step(1.0);
  near(rot(m, 'leg'), poseAt(model, 'run', 0.3, { loop: true }).bones[2].rotation, 'it loops');
});

test('a crossfade moves linearly from the old clip to the new one over mix seconds', () => {
  const m = new Mixer(rig());
  m.setAnimation(0, 'idle');
  m.step(0.2);
  m.setAnimation(0, 'run', { mix: 0.4 });
  m.step(0);
  near(rot(m, 'arm'), 10, 'starts on idle');
  m.step(0.2);
  near(rot(m, 'arm'), (10 + -30) / 2, 'half way at half the mix');
  near(m.pose.bones[1].y, (0 + 8) / 2, 'a key only the new clip has comes in from what is beneath');
  m.step(0.2);
  near(rot(m, 'arm'), -30, 'on run at the end of the mix');
  assert.equal(m.tracks[0].from, null, 'the old clip is let go');
  const cut = new Mixer(rig());
  cut.setAnimation(0, 'idle'); cut.step(0.1);
  cut.setAnimation(0, 'run', { mix: 0 }); cut.step(0);
  near(rot(cut, 'arm'), -30, 'mix 0 cuts');
});

test('a layer on track 1 keys the arm and leaves the running legs alone, by its alpha', () => {
  const model = rig();
  const m = new Mixer(model);
  m.setAnimation(0, 'run');
  m.setAnimation(1, 'punch', { loop: false, mix: 0 });
  m.step(0.3);
  near(rot(m, 'arm'), 90, 'the punch owns the arm');
  near(rot(m, 'leg'), poseAt(model, 'run', 0.3).bones[2].rotation, 'the run keeps the legs');
  assert.equal(m.pose.slots[0].attachment.name, 'fist', 'and the punch\'s attachment');
  const half = new Mixer(model);
  half.setAnimation(0, 'run');
  half.setAnimation(1, 'punch', { loop: false, mix: 0, alpha: 0.5 });
  half.step(0.3);
  near(rot(half, 'arm'), (90 + -30) / 2, 'alpha 0.5 is half way to the layer');
});

test('a layer fades in on an empty track and fades out when cleared', () => {
  const m = new Mixer(rig());
  m.setAnimation(0, 'run');
  m.setAnimation(1, 'punch', { mix: 0.2 });
  m.step(0.1);
  near(rot(m, 'arm'), (90 + -30) / 2, 'half faded in');
  m.step(0.2);
  near(rot(m, 'arm'), 90, 'fully in');
  m.clearTrack(1, { mix: 0.2 });
  m.step(0.1);
  near(rot(m, 'arm'), (90 + -30) / 2, 'half faded out');
  m.step(0.2);
  near(rot(m, 'arm'), -30, 'back to the run');
  assert.equal(m.tracks[1], undefined, 'the track is empty');
});

test('an additive layer adds its offset from the setup pose on top', () => {
  const m = new Mixer(rig());
  m.setAnimation(0, 'idle');
  m.setAnimation(1, 'breathe', { add: true, mix: 0 });
  m.step(0.5);
  near(rot(m, 'arm'), 10 + 5, 'idle 10 plus breathe 5');
  m.tracks[1].alpha = 0.5;
  m.step(0);
  near(rot(m, 'arm'), 10 + 2.5, 'scaled by alpha');
});

test('a queued clip starts when the one before completes, with events, completions and starts reported', () => {
  const m = new Mixer(rig());
  const seen = [];
  m.addListener({ start: e => seen.push(`start ${e.entry.name}`), complete: e => seen.push(`complete ${e.entry.name}`), event: e => seen.push(`event ${e.event.name}`), end: e => seen.push(`end ${e.entry.name}`) });
  m.setAnimation(0, 'punch', { loop: false });
  m.addAnimation(0, 'run', { mix: 0.1 });
  m.step(0.05); m.step(0.1); m.step(0.3);
  assert.deepEqual(seen, ['start punch', 'event hit', 'complete punch', 'start run']);
  assert.equal(m.current(0).name, 'run');
  m.step(0.2);
  assert.ok(seen.includes('end punch'), 'the punch ends when the crossfade does');
  m.step(0.3);
  assert.ok(seen.includes('event step'), 'the run\'s footstep event');
});

test('physics steps on the mixed pose: the hair swings when the crossfade moves the hips', () => {
  const model = rig({ physics: [{ name: 'hair', bone: 'hair', rotate: 1, inertia: 0.9, strength: 60, damping: 0.9 }] });
  const m = new Mixer(model);
  m.setAnimation(0, 'idle');
  m.step(0);
  for (let i = 0; i < 30; i++) m.step(1 / 60);
  const hair = () => { const b = m.pose.bones[model.boneIndex.get('hair')]; return Math.atan2(b.c, b.a) * 180 / Math.PI; };
  near(hair(), 0, 'still while idle', 1e-6);
  m.setAnimation(0, 'run', { mix: 0.2 });
  let most = 0;
  for (let i = 0; i < 20; i++) { m.step(1 / 60); most = Math.max(most, Math.abs(hair())); }
  assert.ok(most > 1, `the hips bob, the hair lags (${most})`);
});

test('bad tracks and unknown clips are refused by name', () => {
  const m = new Mixer(rig());
  assert.throws(() => m.setAnimation(99, 'run'), /track/);
  assert.throws(() => m.setAnimation(0, 'fly'), /No animation named "fly"/);
});

// ── a planned mix, rendered ───────────────────────────────────────────────────

import fs from 'node:fs';
import { MixPlayhead } from '../src/engine/index.js';
import { renderFrames } from '../src/render/frames.js';
import { decodePng } from '../src/render/png.js';

const WARRIOR = new URL('../examples/showcase/warrior/', import.meta.url);
const warrior = () => ({ json: JSON.parse(fs.readFileSync(new URL('warrior_v2.json', WARRIOR), 'utf8')), atlasText: fs.readFileSync(new URL('warrior_v2.atlas', WARRIOR), 'utf8'),
  pages: new Map([['warrior.png', decodePng(fs.readFileSync(new URL('warrior.png', WARRIOR)))]]) });

test('a planned mix replays from 0: the same instant gives the same pose however it is reached', () => {
  const model = compileSkeleton(warrior().json);
  const plan = { animation: 'run', layers: [{ animation: 'punch_upper', at: 0.2 }], then: { animation: 'idle_unarmed', at: 0.8, mix: 0.3 } };
  const world = pose => pose.bones.map(b => [b.worldX, b.worldY]).flat();
  const direct = world(new MixPlayhead(model, plan).at(0.5));
  const head = new MixPlayhead(model, plan);
  head.at(0.1); head.at(0.9);
  assert.deepEqual(world(head.at(0.5)), direct, 'back and forth');
  const plain = world(new MixPlayhead(model, { animation: 'run' }).at(0.5));
  assert.notDeepEqual(direct, plain, 'the layer changes the pose');
  assert.throws(() => new MixPlayhead(model, { animation: 'run', layers: [{ animation: 'fly' }] }), /fly/);
});

test('see a layer: the punch over the run moves the arms and keeps the legs where the run has them', async () => {
  const w = warrior();
  const model = compileSkeleton(w.json);
  const legs = model.bones.filter(b => /leg|thigh|shin|foot/i.test(b.name)).map(b => b.index);
  const arms = model.bones.filter(b => /arm|hand|fist/i.test(b.name)).map(b => b.index);
  assert.ok(legs.length && arms.length, 'the warrior has legs and arms');
  const mixed = new MixPlayhead(model, { animation: 'run', layers: [{ animation: 'punch_upper', at: 0 }] }).at(0.15);
  const run = new MixPlayhead(model, { animation: 'run' }).at(0.15);
  for (const i of legs) near(mixed.bones[i].worldX, run.bones[i].worldX, `${model.bones[i].name} runs on`, 1e-6);
  assert.ok(arms.some(i => Math.abs(mixed.bones[i].worldX - run.bones[i].worldX) > 1), 'an arm punches');
  const view = { x: -150, y: -20, width: 300, height: 260 };
  const frame = async mix => (await renderFrames({ ...w, animation: 'run', times: [0.15], width: 96, height: 96, viewport: view, mix })).frames[0].image.data;
  assert.notDeepEqual(await frame({ layers: [{ animation: 'punch_upper' }] }), await frame(null), 'the frames show it');
});
