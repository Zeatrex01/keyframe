// Gate for effects as data (src/spine/effects.js, add_effect): what they write is ordinary
// skeleton JSON that passes the check, plays on the engine and does what its kind says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addEffect } from '../src/spine/effects.js';
import { checkSkeleton } from '../src/spine/check.js';
import { compileSkeleton, poseAt, setupPose } from '../src/engine/index.js';
import { createServer } from '../src/mcp/server.js';
import { SPINE } from './helpers/spine-addon.js';
import { officialRuntime } from './helpers/official-runtime.js';

const BASE = { skeleton: { spine: '4.2.43', hash: 'fx' }, bones: [{ name: 'root' }, { name: 'chest', parent: 'root' }, { name: 'coin', parent: 'chest', y: 40 }, { name: 'cam', parent: 'root' }],
  slots: [{ name: 'chest', bone: 'chest', attachment: 'chest' }, { name: 'coin', bone: 'coin', attachment: 'coin' }],
  skins: [{ name: 'default', attachments: { chest: { chest: { width: 100, height: 80 } }, coin: { coin: { width: 20, height: 20 } } } }],
  animations: { open: { bones: { coin: { translate: [{ time: 0, x: 0, y: 0, curve: [0.2, 0, 0.4, 0, 0.2, 0, 0.4, 60] }, { time: 0.6, x: 0, y: 60 }] } } } } };

const sound = (sk, label) => {
  const fatal = checkSkeleton(sk).filter(f => f.level === 'fatal');
  assert.deepEqual(fatal, [], `${label}: ${JSON.stringify(fatal)}`);
  return compileSkeleton(sk);
};
const slotOf = (pose, name) => pose.slots.find(s => s.data.name === name);
const boneOf = (pose, name) => pose.bones.find(b => b.data.name === name);

test('burst: copies fly outward, spin, shrink and fade, then hide; the base is not changed', () => {
  const before = JSON.stringify(BASE);
  const { skeleton, report } = addEffect(BASE, { kind: 'burst', animation: 'open', sprite: { slot: 'coin' }, at: 0.3, count: 6, direction: 90, spread: 60, distance: 100, seed: 3 });
  assert.equal(JSON.stringify(BASE), before);
  assert.match(report[0], /6 copies of coin\/coin/);
  const model = sound(skeleton, 'burst');
  assert.equal(skeleton.slots.findIndex(s => s.name === 'fx_burst_1'), 2, 'particles draw in front of the sprite');
  assert.equal(slotOf(setupPose(model), 'fx_burst_1').attachment, null, 'hidden at setup');
  const mid = poseAt(model, 'open', 0.6);
  const ys = [1, 2, 3, 4, 5, 6].map(i => boneOf(mid, `fx_burst_${i}`).worldY - boneOf(mid, 'fx_burst').worldY);
  assert.ok(ys.every(y => y > 20), `upward: ${ys}`);
  assert.equal(slotOf(mid, 'fx_burst_1').attachment?.name, 'coin');
  const end = poseAt(model, 'open', model.animations.get('open').duration);
  assert.ok([1, 2, 3, 4, 5, 6].every(i => slotOf(end, `fx_burst_${i}`).attachment === null), 'hidden after');
  assert.deepEqual(addEffect(BASE, { kind: 'burst', animation: 'open', sprite: { slot: 'coin' }, seed: 3 }).skeleton, addEffect(BASE, { kind: 'burst', animation: 'open', sprite: { slot: 'coin' }, seed: 3 }).skeleton, 'seeded');
});

test('flash and glow: an additive copy whose alpha peaks and comes back', () => {
  const { skeleton } = addEffect(BASE, { kind: 'flash', animation: 'hit', sprite: { slot: 'chest' }, at: 0.1, duration: 0.3 });
  const model = sound(skeleton, 'flash');
  const slot = skeleton.slots.find(s => s.name === 'chest_flash');
  assert.equal(slot.blend, 'additive');
  const alpha = t => slotOf(poseAt(model, 'hit', t), 'chest_flash').color.a;
  assert.ok(alpha(0.15) > 0.9 && alpha(0.4) < 0.01 && alpha(0.25) < alpha(0.15), `${alpha(0.15)} ${alpha(0.25)} ${alpha(0.4)}`);
  const glow = sound(addEffect(BASE, { kind: 'glow', animation: 'idle', sprite: { slot: 'coin' }, period: 1, cycles: 2, strength: 0.8 }).skeleton, 'glow');
  const g = t => slotOf(poseAt(glow, 'idle', t), 'coin_glow').color.a;
  assert.ok(g(0.5) > 0.75 && g(1) < 0.25 && g(1.5) > 0.75, 'pulses');
  assert.ok(Math.abs(slotOf(poseAt(glow, 'idle', 0.5), 'coin_glow').color.r - 1) < 1e-6, 'colour channels stay put');
});

test('trail: ghosts follow the moving bone, later and fainter, behind it', () => {
  const { skeleton } = addEffect(BASE, { kind: 'trail', animation: 'open', sprite: { slot: 'coin' }, count: 3, delay: 0.05 });
  const model = sound(skeleton, 'trail');
  assert.deepEqual(skeleton.slots.slice(1, 5).map(s => s.name), ['coin_ghost3', 'coin_ghost2', 'coin_ghost1', 'coin']);
  const pose = poseAt(model, 'open', 0.3);
  const y = name => boneOf(pose, name).worldY;
  assert.ok(y('coin') > y('coin_ghost1') && y('coin_ghost1') > y('coin_ghost2') && y('coin_ghost2') > y('coin_ghost3'), 'each lags the one before');
  assert.equal(slotOf(setupPose(model), 'coin_ghost1').attachment, null);
  assert.throws(() => addEffect(BASE, { kind: 'trail', animation: 'idle', sprite: { slot: 'coin' } }), /no keys/);
});

test('shake: decaying jitter that ends where it started; refuses a bone that already travels', () => {
  const { skeleton } = addEffect(BASE, { kind: 'shake', animation: 'hit', bone: 'cam', at: 0.2, duration: 0.4, amplitude: 10, seed: 7 });
  const model = sound(skeleton, 'shake');
  const x = t => Math.hypot(boneOf(poseAt(model, 'hit', t), 'cam').worldX, boneOf(poseAt(model, 'hit', t), 'cam').worldY);
  assert.equal(x(0.1), 0);
  assert.ok(Math.max(x(0.25), x(0.3)) > 2, 'it moves');
  assert.equal(x(0.6), 0, 'and settles');
  assert.throws(() => addEffect(BASE, { kind: 'shake', animation: 'open', bone: 'coin' }), /already travels/);
  assert.throws(() => addEffect(BASE, { kind: 'sparkle', animation: 'open' }), { code: 'bad-argument' });
});

test('the official runtime plays every effect as the engine does', { skip: !SPINE && 'needs the Spine add-on' }, async () => {
  const runtime = await officialRuntime();
  for (const spec of [{ kind: 'burst', animation: 'open', sprite: { slot: 'coin' } }, { kind: 'flash', animation: 'open', sprite: { slot: 'chest' } }, { kind: 'trail', animation: 'open', sprite: { slot: 'coin' } },
    { kind: 'emit', animation: 'open', sprite: { slot: 'coin' }, count: 8, duration: 0.3, gravity: 400, drag: 2, life: [0.3, 0.5], align: true }]) {
    const { skeleton } = addEffect(BASE, spec);
    const data = await runtime.parseSkeleton(skeleton);
    const official = await runtime.sampleAnimation(data, 'open', [0.2, 0.5]);
    const model = compileSkeleton(skeleton);
    for (const [i, t] of [0.2, 0.5].entries()) {
      const ours = poseAt(model, 'open', t).snapshot();
      ours.bones.forEach((b, j) => assert.ok(Math.abs(b.worldX - official[i].bones[j].worldX) < 0.01 && Math.abs(b.worldY - official[i].bones[j].worldY) < 0.01, `${spec.kind} ${b.name}@${t}`));
      ours.slots.forEach((s, j) => assert.ok(Math.abs(s.color.a - official[i].slots[j].color.a) < 0.01, `${spec.kind} ${s.name} alpha@${t}`));
    }
  }
});

test('add_effect writes a delivery and leaves the base alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-effect-'));
  fs.writeFileSync(path.join(dir, 'chest.json'), JSON.stringify(BASE));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
  try {
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_effect', arguments: { kind: 'burst', animation: 'open', sprite: { slot: 'coin' }, count: 4 } } });
    const out = sent[0].result.structuredContent;
    assert.equal(out.error, undefined, JSON.stringify(out.error));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'chest.json'), 'utf8')).slots.length, 2, 'the base is never written');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'chest_v2.json'), 'utf8')).slots.length, 6);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an effect added to a delivery stays when a later write rebuilds the delivery from the base', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-effect-carry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'star.json'), JSON.stringify({ skeleton: { hash: 'star', spine: '4.2.43' }, bones: [{ name: 'root' }, { name: 'star', parent: 'root' }],
    slots: [{ name: 'star', bone: 'star', attachment: 'star' }], skins: [{ name: 'default', attachments: { star: { star: { width: 40, height: 40 } } } }], animations: {} }));
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
  const spin = { bones: { star: { rotate: [{ value: 0 }, { time: 0.5, value: 90 }] } } };
  await call('write_animation', { from: 'star.json', animation: 'pop', clip: spin });
  await call('add_effect', { file: 'star_v2.json', kind: 'flash', animation: 'pop', sprite: { slot: 'star' }, at: 0.2, duration: 0.2 });
  const flashed = JSON.parse(fs.readFileSync(path.join(dir, 'star_v2.json'), 'utf8'));
  const flashSlot = flashed.slots.find((/** @type {any} */ s) => s.name !== 'star').name;
  assert.deepEqual(flashed._kfAdded, { bones: [], slots: [flashSlot] }, 'the effect records what it added');

  const second = await call('write_animation', { from: 'star.json', animation: 'wobble', replace: true, clip: spin });
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'star_v2.json'), 'utf8'));
  assert.deepEqual(out.slots.map((/** @type {any} */ s) => s.name), ['star', flashSlot], 'the flash slot is kept in its place');
  assert.ok(out.skins[0].attachments[flashSlot], 'with its attachment');
  assert.ok(out.animations.pop.slots[flashSlot], 'the clip that flashes still does');
  assert.deepEqual(second.effectParts, { kept: [flashSlot], dropped: [] });
});
