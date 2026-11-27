// The whole-skeleton write tools through the wire, each on a temporary project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp/server.js';
import { REPAIR_MARKER } from '../src/spine/weight-repair.js';

const fixture = rel => new URL(`./fixtures/${rel}`, import.meta.url);

function setup(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-tools-write-'));
  for (const [to, from] of Object.entries(files)) {
    if (typeof from === 'string' || from instanceof URL) fs.copyFileSync(from, path.join(dir, to));
    else fs.writeFileSync(path.join(dir, to), JSON.stringify(from));
  }
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', all: true, write: m => sent.push(m) });
  let id = 0;
  const call = async (name, args = {}) => {
    await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const result = sent.find(m => m.id === id).result;
    return result.structuredContent;
  };
  const read = rel => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
  return { dir, call, read, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('set_curves re-eases keys without moving values, first into a new delivery, then in place', async () => {
  const p = setup({ 'logo.json': fixture('ident/ident.json') });
  try {
    const base = p.read('logo.json');
    const [name, clip] = Object.entries(base.animations).find(([, c]) => Object.values(c.bones ?? {}).some(t => (t.rotate ?? t.translate ?? []).length > 1));
    const result = await p.call('set_curves', { animation: name, preset: 'easeInOut' });
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(result.file, 'logo_v2.json');
    assert.ok(result.changed.length > 0);
    const out = p.read('logo_v2.json').animations[name];
    for (const [bone, timelines] of Object.entries(clip.bones ?? {})) {
      for (const [channel, keys] of Object.entries(timelines)) {
        keys.forEach((key, i) => {
          const { curve, ...value } = key;
          const { curve: _, ...after } = out.bones[bone][channel][i];
          assert.deepEqual(after, value, `${bone}.${channel}[${i}] value and time unchanged`);
        });
      }
    }
    const again = await p.call('set_curves', { file: 'logo_v2.json', animation: name, preset: 'linear' });
    assert.equal(again.inPlace, true);
    assert.ok(again.backup);
  } finally { p.cleanup(); }
});

test('bake_animation removes physics and verifies the replay', async () => {
  const rig = {
    skeleton: { spine: '4.2.43', hash: 'p' },
    bones: [{ name: 'root' }, { name: 'body', parent: 'root' }, { name: 'tail', parent: 'body', length: 40 }],
    physics: [{ name: 'sway', bone: 'tail', rotate: 1, inertia: 1, strength: 100, damping: 0.85, mass: 1 }],
    // The body moves across the tail (along y): motion along the bone's own axis would not swing it.
    animations: { dash: { bones: { body: { translate: [{ x: 0, y: 0 }, { time: 0.5, x: 0, y: 120 }, { time: 1, x: 0, y: 0 }] } } } },
  };
  const p = setup({ 'rig.json': rig });
  try {
    const result = await p.call('bake_animation', {});
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(result.verification.passed, true);
    const baked = p.read('rig_v2.json');
    assert.equal(baked.physics, undefined, 'the physics block is gone');
    assert.ok(baked.animations.dash.bones.tail.rotate.length > 2, 'the tail swing is now keys');
    assert.ok(result.note);
  } finally { p.cleanup(); }
});

test('migrate_swap_to_skin suggests without writing, then folds the family into skins', async () => {
  const rig = {
    skeleton: { spine: '4.2.43', hash: 'm' },
    bones: [{ name: 'root' }, { name: 'lid', parent: 'root' }],
    slots: [{ name: 'chest', bone: 'lid', attachment: 'chest' }],
    skins: [{ name: 'default', attachments: { chest: { chest: { width: 10, height: 10 }, gold_chest: { width: 10, height: 10 } } } }],
    animations: {
      open: { bones: { lid: { rotate: [{ value: 0 }, { time: 1, value: 30 }] } } },
      gold_open: { slots: { chest: { attachment: [{ name: 'gold_chest' }] } }, bones: { lid: { rotate: [{ value: 0 }, { time: 1, value: 30 }] } } },
    },
  };
  const p = setup({ 'chest.json': rig });
  try {
    const suggestion = await p.call('migrate_swap_to_skin', {});
    assert.equal(suggestion.written, false);
    assert.equal(suggestion.groups[0].base, 'open');
    assert.ok(!fs.existsSync(path.join(p.dir, 'chest_v2.json')));
    const result = await p.call('migrate_swap_to_skin', { groups: [{ base: 'open', variants: [{ animation: 'gold_open', skinName: 'gold' }] }] });
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    const out = p.read('chest_v2.json');
    assert.ok(out.skins.some(s => s.name === 'gold'));
    assert.equal(out.animations.gold_open, undefined, 'the copy folded into the skin');
  } finally { p.cleanup(); }
});

test('merge_animation lists, then brings a clip and its parts from another skeleton', async () => {
  const p = setup({ 'logo.json': fixture('ident/ident.json'), 'nova.json': fixture('nova/nova.json') });
  try {
    const listing = await p.call('merge_animation', { source: 'nova.json' });
    assert.equal(listing.written, false);
    const nova = p.read('nova.json');
    const clip = Object.keys(nova.animations)[0];
    const result = await p.call('merge_animation', { source: 'nova.json', animation: clip, file: 'logo.json', as: 'nova_intro' });
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    const out = p.read('logo_v2.json');
    assert.ok(out.animations.nova_intro);
    for (const name of Object.keys(p.read('logo.json').animations)) assert.ok(out.animations[name], `owner clip ${name} kept`);
  } finally { p.cleanup(); }
});

test('edit_weights cleans crumbs into a stamped delivery; read_weights reports', async () => {
  const p = setup({ 'mesh.json': fixture('weights/weighted_sample.json') });
  try {
    const report = await p.call('read_weights', {});
    assert.equal(report.error, undefined, JSON.stringify(report.error));
    const weighted = report.meshes.find(m => m.weighted);
    const result = await p.call('edit_weights', { op: 'clean', slot: weighted.slot, attachment: weighted.attachment });
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    const out = p.read('mesh_v2.json');
    const [key] = Object.keys(out[REPAIR_MARKER]);
    assert.ok(out[REPAIR_MARKER][key].baseSignature, 'stamped with the base mesh signature');
    const refused = await p.call('edit_weights', { file: 'mesh_v2.json', op: 'transfer', slot: weighted.slot, attachment: weighted.attachment, from: 'nope', to: 'nope2' });
    assert.ok(refused.error, 'an unknown bone is refused');
  } finally { p.cleanup(); }
});
