// File tools through the wire: diff, atlas, assets, history and restore, binary, Spine CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp/server.js';
import { needsSpine } from './helpers/spine-addon.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-tools-files-'));
  for (const ext of ['json', 'atlas']) fs.copyFileSync(new URL(`ident.${ext}`, FIXTURE), path.join(dir, `logo.${ext}`));
  fs.copyFileSync(new URL('ident.png', FIXTURE), path.join(dir, 'ident.png'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', all: true, write: m => sent.push(m) });
  let id = 0;
  const call = async (name, args = {}) => {
    await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    return sent.find(m => m.id === id).result.structuredContent;
  };
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'logo.json'), 'utf8'));
  return { dir, call, base, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const wave = (bone, deg) => ({ bones: { [bone]: { rotate: [{ value: 0 }, { time: 1, value: deg }] } } });

test('read_atlas and check_assets read the art behind the skeleton', async () => {
  const p = setup();
  try {
    const atlas = await p.call('read_atlas', {});
    assert.equal(atlas.atlas, 'logo.atlas');
    assert.ok(atlas.regions.length > 0);
    const ok = await p.call('check_assets', {});
    assert.equal(ok.ok, true, JSON.stringify(ok));
    fs.unlinkSync(path.join(p.dir, 'ident.png'));
    const broken = await p.call('check_assets', {});
    assert.deepEqual(broken.missingPages, ['ident.png']);
  } finally { p.cleanup(); }
});

test('history: two writes, list, restore the first, and the restore is itself backed up', async () => {
  const p = setup();
  try {
    const bone = p.base.bones[1].name;
    await p.call('write_animation', { animation: 'wave', clip: wave(bone, 10) });
    const firstText = fs.readFileSync(path.join(p.dir, 'logo_v2.json'), 'utf8');
    await p.call('write_animation', { animation: 'wave', clip: wave(bone, 80), replace: true });
    const history = await p.call('list_history', { file: 'logo_v2.json' });
    assert.equal(history.backups.length, 1);
    const restored = await p.call('restore_file', { file: 'logo_v2.json', backup: history.backups[0].backup });
    assert.ok(restored.previousState);
    assert.equal(fs.readFileSync(path.join(p.dir, 'logo_v2.json'), 'utf8'), firstText);
    assert.equal((await p.call('list_history', { file: 'logo_v2.json' })).backups.length, 2);
    const never = await p.call('restore_file', { file: 'logo.json', backup: 'x' });
    assert.equal(never.error.code, 'no-history');
    const diff = await p.call('diff_skeletons', { before: 'logo.json', after: 'logo_v2.json' });
    assert.equal(diff.error, undefined, JSON.stringify(diff.error));
    assert.ok(JSON.stringify(diff).includes('wave'), 'the added animation shows in the diff');
  } finally { p.cleanup(); }
});

test('export_binary verifies with the official reader and never overwrites an owner export', needsSpine, async () => {
  const p = setup();
  try {
    const out = await p.call('export_binary', {});
    assert.equal(out.error, undefined, JSON.stringify(out.error));
    assert.equal(out.written, 'logo.skel');
    assert.ok(out.bytes > 0);
    const again = await p.call('export_binary', {});
    assert.equal(again.error.code, 'target-exists', 'logo.json is an owner file; its .skel is not overwritten');
    await p.call('write_animation', { animation: 'wave', clip: wave(p.base.bones[1].name, 10) });
    const delivery = await p.call('export_binary', { file: 'logo_v2.json' });
    assert.equal(delivery.written, 'logo_v2.skel');
    const redo = await p.call('export_binary', { file: 'logo_v2.json' });
    assert.ok(redo.backup, 'a delivery binary is overwritten with a backup');
  } finally { p.cleanup(); }
});

test('without the Spine add-on, export_binary refuses and writes nothing', async () => {
  const { configureSpineRuntime } = await import('../src/runtime/index.js');
  const { locateSpineRuntime } = await import('../src/core/spine-addon.js');
  const p = setup(); // the server finds the add-on as the studio does; then it is taken away
  configureSpineRuntime({ locate: () => null });
  try {
    const out = await p.call('export_binary', {});
    assert.equal(out.error.code, 'spine-addon-off');
    assert.match(out.error.message, /own Spine license/);
    assert.equal(fs.existsSync(path.join(p.dir, 'logo.skel')), false);
  } finally {
    p.cleanup();
    configureSpineRuntime({ locate: () => locateSpineRuntime(process.env) });
  }
});

test('export_player writes one self-contained HTML player and never overwrites another file', async () => {
  const p = setup();
  try {
    const out = await p.call('export_player', {});
    assert.equal(out.error, undefined, JSON.stringify(out.error));
    assert.equal(out.written, 'logo.player.html');
    const html = fs.readFileSync(path.join(p.dir, 'logo.player.html'), 'utf8');
    assert.match(html, /data:image\/png;base64,/);
    const again = await p.call('export_player', {});
    assert.ok(again.backup, 'a player the studio wrote is replaced with a backup');
    fs.writeFileSync(path.join(p.dir, 'page.html'), '<p>the owner\'s</p>');
    assert.equal((await p.call('export_player', { into: 'page.html' })).error.code, 'target-exists');
    assert.equal(fs.readFileSync(path.join(p.dir, 'page.html'), 'utf8'), '<p>the owner\'s</p>');
  } finally { p.cleanup(); }
});

test('export_godot writes the Godot scene beside the skeleton and backs up the last one', async () => {
  const p = setup();
  try {
    const out = await p.call('export_godot', {});
    assert.equal(out.error, undefined, JSON.stringify(out.error));
    assert.equal(out.written, 'logo.kfscene');
    const scene = JSON.parse(fs.readFileSync(path.join(p.dir, 'logo.kfscene'), 'utf8'));
    assert.equal(scene.format, 'keyframe-godot');
    assert.deepEqual(out.clips.map(c => c.name), Object.keys(p.base.animations));
    assert.ok((await p.call('export_godot', {})).backup);
    // Live physics: the springs travel in the scene instead of keys.
    const sk = JSON.parse(fs.readFileSync(path.join(p.dir, 'logo.json'), 'utf8'));
    const bone = sk.bones.find(b => b.parent).name;
    sk.physics = [{ name: 'sway', bone, rotate: 1, inertia: 0.5, strength: 80, damping: 0.9 }];
    fs.writeFileSync(path.join(p.dir, 'logo.json'), JSON.stringify(sk));
    const live = await p.call('export_godot', { physics: 'live' });
    assert.deepEqual(live.live, ['physics sway']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.dir, 'logo.kfscene'), 'utf8')).physics.map(c => c.bone), [bone]);
    assert.equal((await p.call('export_godot', {})).live, undefined, 'baked by default');
    assert.match((await p.call('export_godot', { physics: 'springs' })).error?.message ?? '', /baked \| live/);
  } finally { p.cleanup(); }
});

test('spine_info refuses clearly without a Spine CLI and runs a stand-in when one is set', async () => {
  const p = setup();
  const saved = process.env.SPINE_CLI;
  try {
    process.env.SPINE_CLI = path.join(p.dir, 'missing-spine.exe');
    assert.equal((await p.call('spine_info', { file: 'logo.json' })).error.code, 'no-spine-cli');
    const standIn = path.join(p.dir, 'fake-spine.mjs');
    const lines = ['Spine 4.2.43', 'Licensed to: Someone <a@b.c>', 'Animations: 3'];
    fs.writeFileSync(standIn, lines.map(line => `console.log(${JSON.stringify(line)});`).join(String.fromCharCode(10)));
    process.env.SPINE_CLI = standIn;
    const info = await p.call('spine_info', { file: 'logo.json' });
    assert.equal(info.ok, true, JSON.stringify(info));
    assert.match(info.output, /Licensed to: \(hidden\)/);
    assert.ok(!info.output.includes('a@b.c'));
    assert.equal((await p.call('spine_info', { file: 'logo.atlas' })).error.code, 'bad-argument');
  } finally {
    if (saved === undefined) delete process.env.SPINE_CLI; else process.env.SPINE_CLI = saved;
    p.cleanup();
  }
});
