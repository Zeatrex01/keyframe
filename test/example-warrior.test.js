// The warrior in examples/showcase/warrior: one dressable skeleton, a stance per weapon, and feet
// that stay where they stand while the hips drive each blow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkeleton, sample } from '../src/engine/index.js';
import { showcaseGates, frames } from './helpers/showcase.js';

const { brief, skeleton } = showcaseGates('warrior');
const model = compileSkeleton(skeleton);

test('warrior: every stance shows its own weapon, and the punch none', () => {
  const want = { sword: 'weapon', spear: 'weapon_spear', bow: 'weapon_bow', axe: 'weapon_axe', unarmed: null, punch: null };
  for (const clip of brief.clips) {
    const key = Object.keys(want).find(k => clip.name.includes(k));
    if (!key) continue;
    const pose = sample(model, clip.name, [0.1])[0];
    assert.equal(pose.slots.find(s => s.name === 'weapon').attachment ?? null, want[key], clip.name);
  }
  for (const clip of ['run', 'jump']) assert.equal(skeleton.animations[clip].slots?.weapon, undefined, `${clip} leaves the weapon to the game`);
});

test('warrior: planted feet stay on their point through every stance and attack', () => {
  for (const clip of brief.clips.filter(c => !['run', 'jump'].includes(c.name))) {
    const poses = sample(model, clip.name, frames(clip.seconds));
    for (const foot of ['footFront', 'footBack']) {
      const at = poses.map(p => p.bones.find(b => b.name === foot));
      const moved = Math.max(...at.map(b => Math.hypot(b.worldX - at[0].worldX, b.worldY - at[0].worldY)));
      assert.ok(moved < 0.6, `${clip.name}: ${foot} moves ${moved.toFixed(2)} units`);
    }
  }
});
