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
    if (!key || clip.name.endsWith('_upper')) continue;
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

const bone = (pose, name) => pose.bones.find(b => b.name === name);
const toWorld = ({ matrix: m, worldX, worldY }, [x, y]) => [m.a * x + m.b * y + worldX, m.c * x + m.d * y + worldY];

test('warrior: two hands on the spear, the back one riding the shaft behind the front fist', () => {
  for (const name of ['idle_spear', 'attack_spear']) {
    const clip = brief.clips.find(c => c.name === name);
    for (const pose of sample(model, name, frames(clip.seconds))) {
      const [x, y] = toWorld(bone(pose, 'weapon'), [-60, 0]), hand = bone(pose, 'handBack');
      assert.ok(Math.hypot(hand.worldX - x, hand.worldY - y) < 0.6, `${name}: the back hand leaves the shaft`);
    }
  }
});

test('warrior: the shot nocks an arrow, draws the string to it, and lets it go', () => {
  const at = t => sample(model, 'shoot_bow', [t])[0];
  const look = t => { const p = at(t); return [p.slots.find(s => s.name === 'weapon').attachment ?? null, p.slots.find(s => s.name === 'arrow').attachment ?? null]; };
  assert.deepEqual(look(0.1), ['weapon_bow', null]);
  assert.deepEqual(look(0.45), ['weapon_drawn', 'arrow']);
  assert.deepEqual(look(0.8), ['weapon_bow', null], 'released: the game sends its own arrow');
  for (const t of [0.3, 0.4, 0.5, 0.6]) {
    const p = at(t), [x, y] = toWorld(bone(p, 'weapon'), [-76, -2]), hand = bone(p, 'handBack');
    assert.ok(Math.hypot(hand.worldX - x, hand.worldY - y) < 0.6, `the drawing hand holds the nock at ${t}`);
  }
  // Every other clip puts the arrow away, so none inherits one from an interrupted shot.
  for (const name of Object.keys(skeleton.animations).filter(n => n !== 'shoot_bow')) {
    assert.deepEqual(skeleton.animations[name].slots?.arrow?.attachment?.map(k => k.name ?? null), [null], name);
  }
});

test('warrior: a one-two from the guard, and the same punches as an upper-body layer for the run and the jump', () => {
  const guard = sample(model, 'idle_unarmed', [0])[0];
  const pose = (clip, t) => sample(model, clip, [t])[0];
  const arms = ['upperArmFront', 'forearmFront', 'upperArmBack', 'forearmBack'];
  // Each punch starts and ends in the guard, so the game chains them in any order.
  for (const clip of ['punch', 'punch_cross']) {
    const end = brief.clips.find(c => c.name === clip).seconds;
    for (const t of [0, end]) for (const b of arms) assert.ok(Math.abs(bone(pose(clip, t), b).rotation - bone(guard, b).rotation) < 0.5, `${clip} at ${t}: ${b} out of the guard`);
  }
  // The jab throws the near fist, the cross the far one.
  const reach = (clip, hand) => Math.max(...frames(0.5).map(t => bone(pose(clip, Math.min(t, 0.45)), hand).worldX)) - bone(guard, hand).worldX;
  assert.ok(reach('punch', 'handFront') > 25 && reach('punch', 'handBack') < 10, 'the jab is the near fist');
  assert.ok(reach('punch_cross', 'handBack') > 25, 'the cross is the far fist');
  // The layers key nothing below the shoulders (no body, legs or slots), so they play over a run.
  for (const clip of ['punch_upper', 'punch_cross_upper']) {
    const a = skeleton.animations[clip];
    assert.deepEqual(Object.keys(a.bones).filter(b => !/^(head|upperArm|forearm|hand)/.test(b)), [], clip);
    assert.equal(a.slots?.weapon, undefined, `${clip} leaves the weapon to the game`);
  }
});
