// Gate for the particle emitter (add_effect kind "emit"): particles fly the exact path under
// gravity and drag, fall down the screen however the source bone is turned, stay where they
// were let go, share slots when their lives do not overlap, loop without a seam, and the
// library art they draw lands on the delivery's own atlas page, which later writes keep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addEffect, carryAdded, EMIT_PRESETS } from '../src/spine/effects.js';
import { checkSkeleton } from '../src/spine/check.js';
import { compileSkeleton, poseAt, parseAtlas } from '../src/engine/index.js';
import { createServer } from '../src/mcp/server.js';
import { decodePng, encodePng } from '../src/render/png.js';
import { renderFrames } from '../src/render/frames.js';
import { emitterArt, releaseAt } from '../src/mcp/tools/add-effect.js';
import { withFxSection } from '../src/deliver/fx-atlas.js';

const BASE = { skeleton: { spine: '4.2.43', hash: 'emit' }, bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 50, y: 100, rotation: 90 }, { name: 'hand', parent: 'arm', x: 40 }],
  slots: [{ name: 'body', bone: 'root', attachment: 'body' }, { name: 'fist', bone: 'hand', attachment: 'fist' }],
  skins: [{ name: 'default', attachments: { body: { body: { width: 40, height: 40 } }, fist: { fist: { x: 6, width: 12, height: 12 } } } }],
  animations: { punch: { bones: { arm: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: -90 }] } } } } };
const ART = { region: 'fx/keyframe-vfx/dot', ref: 'asset:keyframe-vfx/dot', width: 10, height: 10 };
const ONE = { kind: 'emit', animation: 'fx', artSprite: ART, count: 1, life: [1, 1], speed: [200, 200], direction: 90, spread: 0, fade: [0, 0], name: 'p' };

const sound = (sk, label) => {
  const fatal = checkSkeleton(sk).filter(f => f.level === 'fatal');
  assert.deepEqual(fatal, [], `${label}: ${JSON.stringify(fatal)}`);
  return compileSkeleton(sk);
};
const boneOf = (pose, name) => pose.bones.find(b => b.data.name === name);
const slotOf = (pose, name) => pose.slots.find(s => s.data.name === name);
const local = (pose, child, parent) => [boneOf(pose, child).worldX - boneOf(pose, parent).worldX, boneOf(pose, child).worldY - boneOf(pose, parent).worldY];

test('a particle flies the exact path under gravity, and under gravity with drag', () => {
  const plain = sound(addEffect(BASE, { ...ONE, gravity: 300 }).skeleton, 'gravity');
  for (const t of [0.05, 0.3, 0.5, 0.85]) {
    const [x, y] = local(poseAt(plain, 'fx', t), 'fx_p_1', 'fx_p');
    assert.ok(Math.abs(x) < 1e-6 && Math.abs(y - (200 * t - 150 * t * t)) < 0.4, `gravity @${t}: ${y} vs ${200 * t - 150 * t * t}`);
  }
  const k = 2, g = 300, drag = sound(addEffect(BASE, { ...ONE, gravity: g, drag: k }).skeleton, 'drag');
  const exact = t => -(g / k) * t + (200 + g / k) * (1 - Math.exp(-k * t)) / k;
  for (const t of [0.1, 0.33, 0.62, 0.9]) {
    const [, y] = local(poseAt(drag, 'fx', t), 'fx_p_1', 'fx_p');
    assert.ok(Math.abs(y - exact(t)) < 0.5, `drag @${t}: ${y} vs ${exact(t)}`);
  }
  const pose = poseAt(plain, 'fx', 0.5);
  assert.equal(slotOf(pose, 'fx_p_1').attachment?.name, ART.region, 'shown while it lives');
  assert.equal(slotOf(poseAt(plain, 'fx', 1), 'fx_p_1').attachment, null, 'hidden when its life is over');
});

test('particles stay where they were let go, fall down the screen however the bone is turned, or ride it with follow', () => {
  const release = releaseAt(BASE, { animation: 'punch', bone: 'hand', at: 0.25 });
  const { skeleton } = addEffect(BASE, { ...ONE, animation: 'punch', bone: 'hand', at: 0.25, gravity: 0, speed: [0, 0], release });
  const model = sound(skeleton, 'release');
  assert.equal(skeleton.bones.find(b => b.name === 'fx_p').parent, 'root', 'the emitter sits under the root');
  const atRelease = poseAt(model, 'punch', 0.25), later = poseAt(model, 'punch', 0.5);
  const hand = pose => [boneOf(pose, 'hand').worldX, boneOf(pose, 'hand').worldY];
  const p = pose => [boneOf(pose, 'fx_p_1').worldX, boneOf(pose, 'fx_p_1').worldY];
  assert.ok(Math.hypot(p(atRelease)[0] - hand(atRelease)[0], p(atRelease)[1] - hand(atRelease)[1]) < 0.01, 'let go at the hand');
  assert.ok(Math.hypot(p(later)[0] - hand(atRelease)[0], p(later)[1] - hand(atRelease)[1]) < 0.01, 'and stays there while the hand moves on');
  assert.ok(Math.hypot(hand(later)[0] - hand(atRelease)[0], hand(later)[1] - hand(atRelease)[1]) > 10, 'the hand did move');

  const setup = addEffect(BASE, { ...ONE, animation: 'new', bone: 'hand' }).skeleton.bones.find(b => b.name === 'fx_p');
  assert.deepEqual([setup.parent, setup.x, setup.y], ['root', 50, 140], 'without a pose, where the bone is in the setup pose');

  const riding = sound(addEffect(BASE, { ...ONE, animation: 'punch', bone: 'hand', follow: true, gravity: 0 }).skeleton, 'follow');
  for (const t of [0.1, 0.4]) {
    const pose = poseAt(riding, 'punch', t);
    const [dx, dy] = local(pose, 'fx_p_1', 'hand');
    assert.ok(Math.abs(dx) < 1e-3 && Math.abs(dy - 200 * t) < 0.01, `rides the hand and flies up the screen though the hand is turned: ${dx}, ${dy}`);
  }
});

test('the same call writes the same effect; particles share slots when their lives do not overlap', () => {
  const spec = { kind: 'emit', animation: 'fx', artSprite: ART, count: 40, duration: 2, life: [0.2, 0.3], seed: 5 };
  const a = addEffect(BASE, spec).skeleton, b = addEffect(BASE, spec).skeleton;
  assert.deepEqual(a, b, 'seeded');
  assert.notDeepEqual(addEffect(BASE, { ...spec, seed: 6 }).skeleton.animations, a.animations);
  const slots = a.slots.filter(s => s.name.startsWith('fx_emit_'));
  assert.ok(slots.length <= 10, `40 short lives over 2 s share slots: ${slots.length}`);
  sound(a, 'pooled');
  for (const [name, channels] of [...Object.entries(a.animations.fx.bones), ...Object.entries(a.animations.fx.slots)]) {
    for (const [channel, keys] of Object.entries(channels)) {
      keys.forEach((k, i) => assert.ok(i === 0 || k.time > keys[i - 1].time, `${name}.${channel}: key times rise (${keys[i - 1]?.time} then ${k.time})`));
    }
  }
  // Every particle shows: each slot's show keys count its lives.
  const shows = Object.values(a.animations.fx.slots).reduce((n, s) => n + s.attachment.filter(k => k.name).length, 0);
  assert.equal(shows, 40);
});

test('a looping emitter has no seam: the clip ends exactly as it starts', () => {
  const sparse = sound(addEffect(BASE, { kind: 'emit', animation: 'loop', artSprite: ART, count: 1, duration: 1, life: [0.2, 0.2], loop: true }).skeleton, 'sparse');
  assert.ok(Math.abs(sparse.animations.get('loop').duration - 1) < 1e-6, 'the clip runs to the emitter\'s end though no life reaches it');
  for (const preset of ['fire', 'embers']) {
    const { skeleton } = addEffect(BASE, { kind: 'emit', animation: 'loop', preset, artSprite: ART });
    const model = sound(skeleton, preset);
    const T = EMIT_PRESETS[preset].duration;
    assert.ok(Math.abs(model.animations.get('loop').duration - T) < 1e-6, `${preset}: the clip is the emitter's length`);
    const start = poseAt(model, 'loop', 0), end = poseAt(model, 'loop', T);
    const shown = pose => skeleton.slots.filter(s => s.name.startsWith('fx_')).filter(s => slotOf(pose, s.name).attachment).map(s => s.name);
    assert.deepEqual(shown(end), shown(start), `${preset}: the same particles show at both ends`);
    assert.ok(shown(start).length > 3, `${preset}: lives carried over the loop show at the start`);
    for (const name of shown(start)) {
      const bone = skeleton.slots.find(s => s.name === name).bone, a = boneOf(start, bone), b = boneOf(end, bone);
      assert.ok(Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY) < 0.05, `${preset} ${name}: same place at both ends`);
      assert.ok(Math.abs(slotOf(start, name).color.a - slotOf(end, name).color.a) < 0.01, `${preset} ${name}: same fade at both ends`);
    }
  }
});

test('every preset writes a sound effect, and refuses what it cannot write', () => {
  for (const preset of Object.keys(EMIT_PRESETS)) sound(addEffect(BASE, { kind: 'emit', animation: 'fx', preset, artSprite: ART }).skeleton, preset);
  const fire = addEffect(BASE, { kind: 'emit', animation: 'fx', preset: 'fire', artSprite: ART }).skeleton;
  assert.ok(Object.values(fire.animations.fx.bones).every(b => !b.rotate || b.rotate.every(k => k.value === 0)), 'a particle that does not spin stands as drawn');
  const reused = addEffect(BASE, { kind: 'emit', animation: 'fx', sprite: { slot: 'fist' }, count: 3 }).skeleton;
  assert.equal(reused.skins[0].attachments.fx_emit_1.fist.x, 0, 'a reused sprite is centred on its particle');
  assert.equal(reused._kfAdded.art, undefined, 'reused art needs no page');
  assert.throws(() => addEffect(BASE, { kind: 'emit', animation: 'fx', artSprite: ART, count: 97 }), { code: 'bad-argument' });
  assert.throws(() => addEffect(BASE, { kind: 'emit', animation: 'fx', artSprite: ART, preset: 'lava' }), { code: 'bad-argument' });
  assert.throws(() => addEffect(BASE, { kind: 'emit', animation: 'fx', artSprite: ART, loop: true, duration: 0 }), { code: 'bad-argument' });
  assert.throws(() => addEffect(BASE, { kind: 'flash', animation: 'fx', sprite: { slot: 'body' }, duration: 0 }), { code: 'bad-argument' });
});

test('the library art is recorded once at its largest size, and a rebuilt delivery keeps it', () => {
  const first = addEffect(BASE, { kind: 'emit', animation: 'a', preset: 'smoke', artSprite: emitterArt({ preset: 'smoke' }) }).skeleton;
  const both = addEffect(first, { kind: 'emit', animation: 'b', preset: 'dust', artSprite: emitterArt({ preset: 'dust' }) }).skeleton;
  assert.deepEqual(both._kfAdded.art.map(a => [a.region, a.width]), [['fx/keyframe-vfx/puff', EMIT_PRESETS.smoke.size]]);
  const rebuilt = structuredClone(BASE);
  carryAdded(rebuilt, both);
  assert.deepEqual(rebuilt._kfAdded.art, both._kfAdded.art);
  assert.throws(() => emitterArt({ art: 'no-such-item' }), { code: 'unknown-asset' });
  assert.match(withFxSection('base.png\nsize:4,4\nbody\nbounds:0,0,4,4\n\nold_fx.png\nsize:2,2\nx\nbounds:0,0,1,1\n', 'old_fx.png', 'old_fx.png\nsize:8,8\n'),
    /^base\.png[\s\S]*bounds:0,0,4,4\n\nold_fx\.png\nsize:8,8\n$/, 'an earlier section of the page is replaced');
});

test('add_effect emit: the delivery gets its own page of effect art, the base and its atlas stay as they were', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-emit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'boxer.json'), JSON.stringify(BASE));
  const baseAtlas = 'boxer.png\nsize:64,64\nfilter:Linear,Linear\npma:false\nbody\nbounds:0,0,40,40\nfist\nbounds:42,0,12,12\n';
  fs.writeFileSync(path.join(dir, 'boxer.atlas'), baseAtlas);
  const page = new Uint8Array(64 * 64 * 4).fill(255);
  fs.writeFileSync(path.join(dir, 'boxer.png'), encodePng({ width: 64, height: 64, data: page }));
  /** @type {any[]} */
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: (m) => sent.push(m), all: true });
  const call = async (/** @type {string} */ name, /** @type {object} */ args) => {
    sent.length = 0;
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const r = sent[0].result;
    assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
    return r.structuredContent;
  };
  const out = await call('add_effect', { kind: 'emit', preset: 'sparks', animation: 'punch', bone: 'hand', at: 0.25 });
  assert.equal(out.atlas.effects.file, 'boxer_v2_fx.png');
  assert.equal(fs.readFileSync(path.join(dir, 'boxer.atlas'), 'utf8'), baseAtlas, 'the base atlas is not changed');
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, 'boxer.json'), 'utf8'))), JSON.stringify(BASE), 'the base is not changed');
  const atlasText = fs.readFileSync(path.join(dir, 'boxer_v2.atlas'), 'utf8');
  const atlas = parseAtlas(atlasText);
  assert.deepEqual(atlas.pages.map(p => p.name), ['boxer.png', 'boxer_v2_fx.png']);
  const region = atlas.regions.find(r => r.name === 'fx/keyframe-vfx/streak');
  assert.ok(region && region.page === 'boxer_v2_fx.png', 'the spark streak is on the effect page');
  const fxImage = decodePng(new Uint8Array(fs.readFileSync(path.join(dir, 'boxer_v2_fx.png'))));
  let ink = 0;
  for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) ink += fxImage.data[(y * fxImage.width + x) * 4 + 3] > 128 ? 1 : 0;
  assert.ok(ink > region.width, `the streak is drawn: ${ink} solid pixels`);

  // The engine draws it: sparks light up a dark frame around the hand.
  const delivered = JSON.parse(fs.readFileSync(path.join(dir, 'boxer_v2.json'), 'utf8'));
  const black = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).map((v, i) => (i % 4 === 3 ? 255 : 0)) };
  const { frames } = await renderFrames({ json: delivered, atlasText, pages: { 'boxer.png': black, 'boxer_v2_fx.png': fxImage }, animation: 'punch', times: [0.32],
    width: 96, height: 96, viewport: { x: 0, y: 60, width: 160, height: 160 }, background: { r: 0, g: 0, b: 0, a: 1 } });
  let lit = 0;
  const image = frames[0].image;
  for (let i = 0; i < image.data.length; i += 4) lit += image.data[i] > 120 ? 1 : 0;
  assert.ok(lit > 20, `sparks show in the frame: ${lit} lit pixels`);

  // A later write rebuilds the delivery from the base and keeps the effect and its page.
  await call('write_animation', { from: 'boxer.json', animation: 'idle', clip: { bones: { arm: { rotate: [{ value: 0 }, { time: 0.5, value: 5 }] } } } });
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'boxer_v2.json'), 'utf8'));
  assert.deepEqual(after._kfAdded.art, delivered._kfAdded.art);
  assert.ok(after.animations.punch.slots.fx_sparks_1, 'the sparks still play');
  assert.match(fs.readFileSync(path.join(dir, 'boxer_v2.atlas'), 'utf8'), /boxer_v2_fx\.png[\s\S]*fx\/keyframe-vfx\/streak/);
  assert.equal((fs.readFileSync(path.join(dir, 'boxer_v2.atlas'), 'utf8').match(/boxer_v2_fx\.png/g) ?? []).length, 1, 'one section for the page');
});
