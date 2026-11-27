// Gate for whether an exported clip loops or plays once (src/engine/loops.js): the guess (a clip
// that ends in its first pose loops unless its name is an action), the answer a clip was written
// with (write_animation `loop`, kept in the delivery) and the answer given to the export, which
// wins. A one-shot that exports as a loop never fires animation_finished in Godot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clipLoops, isOneShot, declaredLoops, loopAnswer } from '../src/engine/loops.js';
import { writeDelivery } from '../src/deliver/write.js';
import { godotScene } from '../src/engine/godot.js';

test('fight moves are one-shots by name; cycles still loop', () => {
  for (const n of ['cross', 'uppercut', 'hook_left', 'block', 'parry', 'dodge', 'step_fwd', 'dash', 'roll', 'throw', 'stagger', 'attack_sword']) assert.ok(isOneShot(n), n);
  for (const n of ['idle', 'run', 'walk', 'breathe', 'float', 'guard_idle']) assert.ok(!isOneShot(n), n);
  assert.equal(clipLoops('idle', true), true);
  assert.equal(clipLoops('cross', true), false);
  assert.equal(clipLoops('idle', true, false), false, 'an explicit answer wins');
  assert.deepEqual(declaredLoops({ _kfDelivery: { loops: { a: false, b: 'x' } } }), { a: false });
  assert.equal(loopAnswer('a', { a: true }, { _kfDelivery: { loops: { a: false } } }), true, 'the export\'s answer wins over the written one');
});

test('a clip written with loop: false exports to Godot as a one-shot, and the export can override', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-loops-'));
  const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
  try {
    for (const ext of ['json', 'atlas']) fs.copyFileSync(new URL(`ident.${ext}`, FIXTURE), path.join(dir, `logo.${ext}`));
    fs.copyFileSync(new URL('ident.png', FIXTURE), path.join(dir, 'ident.png'));
    const bone = JSON.parse(fs.readFileSync(path.join(dir, 'logo.json'), 'utf8')).bones[1].name;
    // Ends where it starts and has a neutral name: the guess would loop it.
    const there = { bones: { [bone]: { rotate: [{ value: 0 }, { time: 0.2, value: 30 }, { time: 0.4, value: 0 }] } } };
    await writeDelivery({ projectDir: dir, name: 'move_a', animation: there, loop: false });
    await writeDelivery({ projectDir: dir, name: 'move_b', animation: there });
    const delivered = JSON.parse(fs.readFileSync(path.join(dir, 'logo_v2.json'), 'utf8'));
    assert.deepEqual(delivered._kfDelivery.loops, { move_a: false }, 'the answer is kept across writes');
    const atlasText = fs.readFileSync(path.join(dir, 'logo_v2.atlas'), 'utf8');
    const loopOf = (scene, n) => scene.animations.find(a => a.name === n).loop;
    const scene = godotScene(delivered, { atlasText });
    assert.equal(loopOf(scene, 'move_a'), false, 'written as a one-shot');
    assert.equal(loopOf(scene, 'move_b'), true, 'no answer: the guess loops a clip that closes');
    const told = godotScene(delivered, { atlasText, loops: { move_a: true, move_b: false } });
    assert.equal(loopOf(told, 'move_a'), true);
    assert.equal(loopOf(told, 'move_b'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
