// Gate for animation events (src/deliver/events.js): a clip that fires a named moment (a hit's
// contact frame) is written without refusal, its definition lands in the delivery with the given
// defaults, the base's own definitions win, and the event reaches every export: the studio's
// engine and web player, the Godot method track and the Spine JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeDelivery } from '../src/deliver/write.js';
import { validateEventDefs, defineEvents } from '../src/deliver/events.js';
import { compileSkeleton, Pose } from '../src/engine/index.js';
import { godotScene } from '../src/engine/godot.js';
import { fromSkeletonJson, toSkeletonJson } from '../src/engine/keyframe-format.js';
import { checkSkeleton } from '../src/spine/check.js';
import { isStudioError } from '../src/shared/errors.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
function project(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-events-'));
  for (const ext of ['json', 'atlas']) fs.copyFileSync(new URL(`ident.${ext}`, FIXTURE), path.join(dir, `logo.${ext}`));
  fs.copyFileSync(new URL('ident.png', FIXTURE), path.join(dir, 'ident.png'));
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'logo.json'), 'utf8'));
  if (mutate) { mutate(base); fs.writeFileSync(path.join(dir, 'logo.json'), JSON.stringify(base)); }
  return { dir, bone: base.bones[1].name, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const strike = (bone, events) => ({ bones: { [bone]: { rotate: [{ value: 0 }, { time: 0.2, value: 40 }, { time: 0.5, value: 0 }] } }, events });

test('a clip that fires an event is written, defined, and keeps its defaults', async () => {
  const p = project();
  try {
    const result = await writeDelivery({ projectDir: p.dir, name: 'jab', animation: strike(p.bone, [{ time: 0.2, name: 'hit' }, { time: 0.45, name: 'recover' }]),
      events: { hit: { int: 1, string: 'jab' } } });
    const delivered = JSON.parse(fs.readFileSync(path.join(p.dir, result.file), 'utf8'));
    assert.deepEqual(delivered.events.hit, { int: 1, string: 'jab' });
    assert.deepEqual(delivered.events.recover, {}, 'an event fired but not given is defined with no defaults');
    assert.deepEqual(result.events.definedWithoutDefaults, ['recover']);
    assert.ok(!checkSkeleton(delivered).some(f => f.level === 'fatal'), 'the delivery passes the checks');
    // A second write keeps the first one's definitions.
    await writeDelivery({ projectDir: p.dir, name: 'idle', animation: { bones: { [p.bone]: { rotate: [{ value: 0 }, { time: 1, value: 5 }] } } } });
    const again = JSON.parse(fs.readFileSync(path.join(p.dir, result.file), 'utf8'));
    assert.deepEqual(again.events.hit, { int: 1, string: 'jab' });

    // The engine (and so the web player and see_animation) passes the hit at its frame, with the defaults.
    const model = compileSkeleton(again);
    const fired = Pose.eventsBetween(model.animations.get('jab'), 0.1, 0.25);
    assert.deepEqual(fired.map(e => [e.name, e.int, e.string]), [['hit', 1, 'jab']]);
    // Godot: a method track on the rig root, keyed at the contact frame.
    const scene = godotScene(again, { atlasText: fs.readFileSync(path.join(p.dir, 'logo_v2.atlas'), 'utf8') });
    const track = scene.animations.find(a => a.name === 'jab').tracks.find(t => t.type === 'method');
    assert.deepEqual(track.keys.map(k => [k.time, k.name, k.int, k.string]), [[0.2, 'hit', 1, 'jab'], [0.45, 'recover', 0, '']]);
    // Spine JSON and the studio's own format keep both the keys and the definitions.
    const round = toSkeletonJson(fromSkeletonJson(again));
    assert.deepEqual(round.events.hit, again.events.hit);
    assert.equal(round.animations.jab.events.length, 2);
  } finally { p.cleanup(); }
});

test('the base\'s own event definitions win, and bad definitions are refused', async () => {
  const p = project(base => { base.events = { hit: { int: 7 } }; });
  try {
    const result = await writeDelivery({ projectDir: p.dir, name: 'jab', animation: strike(p.bone, [{ time: 0.2, name: 'hit' }]), events: { hit: { int: 1 } } });
    const delivered = JSON.parse(fs.readFileSync(path.join(p.dir, result.file), 'utf8'));
    assert.deepEqual(delivered.events.hit, { int: 7 });
    assert.deepEqual(result.events.baseDefinitionKept, ['hit']);
  } finally { p.cleanup(); }
  for (const bad of [[], { hit: 3 }, { hit: { colour: 'red' } }, { hit: { int: 1.5 } }, { hit: { volume: 2 } }]) {
    assert.throws(() => validateEventDefs(bad), e => isStudioError(e) && e.code === 'bad-argument', JSON.stringify(bad));
  }
  const out = { animations: {} };
  defineEvents(out, {}, null, {});
  assert.equal(out.events, undefined, 'no events, no events block');
});

test('the web player hands a listener the event\'s defaults under the key\'s own values', () => {
  const boot = fs.readFileSync(new URL('../src/deliver/web-player-boot.js', import.meta.url), 'utf8');
  assert.match(boot, /this\.emit\('event', e\.name, \{ \.\.\.\(this\.json\.events\?\.\[e\.name\] \?\? \{\}\), \.\.\.e \}\)/);
});
