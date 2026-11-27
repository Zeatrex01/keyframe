// Gate for the 0.2 engine: transform and physics constraints, IK softness and sequences in
// src/engine/constraints.js and src/engine/model.js, evaluated with no Spine code at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkeleton, poseAt, setupPose, sample, sequenceFrame, collectDraws, Playhead } from '../src/engine/index.js';
import { softReach } from '../src/engine/constraints.js';
import { parseSkeleton } from '../src/runtime/index.js';

const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const deg = b => Math.atan2(b.c, b.a) * 180 / Math.PI;
const boneOf = (pose, name) => pose.bones[pose.model.boneIndex.get(name)];

// ── transform constraints ────────────────────────────────────────────────────

function transformRig(constraint, animations = {}) {
  return compileSkeleton({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'target', parent: 'root', x: 100, y: 50, rotation: 30, scaleX: 2 }, { name: 'follower', parent: 'root', x: -40 },
      { name: 'child', parent: 'follower', x: 10 }],
    transform: [{ name: 'follow', bones: ['follower'], target: 'target', ...constraint }],
    animations,
  });
}

test('a world transform constraint puts the bone on the target, its rotation and scale, each part by its mix', () => {
  const full = setupPose(transformRig({}));
  const f = boneOf(full, 'follower'), t = boneOf(full, 'target');
  near(f.worldX, 100, 'on the target x'); near(f.worldY, 50, 'on the target y');
  near(deg(f), 30, 'turned as the target');
  near(Math.hypot(f.a, f.c), 2, 'scaled as the target');
  near(boneOf(full, 'child').worldX, t.worldX + Math.cos(30 * Math.PI / 180) * 10 * 2, 'children follow the moved bone');
  const half = setupPose(transformRig({ mixRotate: 0.5, mixX: 0.5, mixScaleX: 0, mixShearY: 0 }));
  const h = boneOf(half, 'follower');
  near(h.worldX, 30, 'half way in x'); near(h.worldY, 25, 'mixY follows mixX');
  near(deg(h), 15, 'half the turn');
  near(Math.hypot(h.a, h.c), 1, 'no scale with mixScaleX 0');
  const offset = setupPose(transformRig({ rotation: 10, x: 5, mixScaleX: 0 }));
  near(deg(boneOf(offset, 'follower')), 40, 'offset rotation added');
  near(boneOf(offset, 'follower').worldX, 100 + Math.cos(30 * Math.PI / 180) * 5 * 2, 'offset position in the target\'s space');
});

test('local and relative transform constraints, and a timeline that keys their mixes', () => {
  const local = setupPose(transformRig({ local: true, mixScaleX: 0 }));
  const l = boneOf(local, 'follower');
  near(l.worldX, 100, 'local absolute x'); near(deg(l), 30, 'local absolute rotation');
  const rel = setupPose(transformRig({ local: true, relative: true, mixX: 0, mixScaleX: 0 }));
  near(deg(boneOf(rel, 'follower')), 30, 'local relative rotation is added to its own');
  near(boneOf(rel, 'follower').worldX, -40, 'no move with mixX 0');
  const keyed = transformRig({}, { off: { transform: { follow: [{ mixRotate: 1, mixX: 1, mixScaleX: 1 }, { time: 1, mixRotate: 0, mixX: 0, mixScaleX: 0, mixShearY: 0 }] } } });
  near(boneOf(poseAt(keyed, 'off', 0), 'follower').worldX, 100, 'fully on at 0');
  near(boneOf(poseAt(keyed, 'off', 1), 'follower').worldX, -40, 'off at 1');
  near(boneOf(poseAt(keyed, 'off', 0.5), 'follower').worldX, 30, 'half at 0.5');
  assert.deepEqual(keyed.unsupported, [], 'nothing left out');
});

// ── physics ──────────────────────────────────────────────────────────────────

function tailRig(physics, animations) {
  return compileSkeleton({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'body', parent: 'root' }, { name: 'tail', parent: 'body', length: 60 }, { name: 'tip', parent: 'tail', x: 60, length: 20 }],
    physics: [{ name: 'sway', bone: 'tail', rotate: 1, inertia: 0.8, strength: 80, damping: 0.9, ...physics }],
    animations: animations ?? { dash: { bones: { body: { translate: [{ x: 0, y: 0 }, { time: 0.3, x: 0, y: 120 }, { time: 2, x: 0, y: 120 }] } } } },
  });
}

test('physics: a tail lags behind a move across it, springs back and settles', () => {
  const model = tailRig({});
  assert.deepEqual(model.approximations, ['physics:sway'], 'the studio\'s own simulation is said so');
  const rot = t => deg(boneOf(poseAt(model, 'dash', t), 'tail'));
  near(rot(0), 0, 'at rest at the start');
  const moving = rot(0.2);
  assert.ok(moving < -5, `the body rises, the tail hangs back (${moving})`);
  const later = [0.5, 0.7, 0.9, 1.1, 1.3].map(rot);
  assert.ok(later.some(r => r > 0.5), `it springs past rest (${later.map(r => r.toFixed(1))})`);
  assert.ok(Math.abs(rot(2)) < Math.abs(moving) * 0.15, `and settles (${rot(2)})`);
  const tip = boneOf(poseAt(model, 'dash', 0.2), 'tip');
  const tail = boneOf(poseAt(model, 'dash', 0.2), 'tail');
  near(deg(tip), deg(tail), 'the child turns with the swung bone', 1e-6);
});

test('physics is replayed from 0 on a fixed grid: the same instant gives the same pose however it is reached', () => {
  const model = tailRig({});
  const direct = deg(boneOf(poseAt(model, 'dash', 0.6), 'tail'));
  const walked = sample(model, 'dash', [0.1, 0.25, 0.37, 0.6]).at(-1).bones.find(b => b.name === 'tail');
  near(walked.worldRotation, direct, 'walked forward');
  const head = new Playhead(model, 'dash');
  head.at(1.5);
  near(deg(boneOf(head.at(0.6), 'tail')), direct, 'stepped back');
  near(deg(boneOf(head.at(0.6), 'tail')), direct, 'asked twice');
});

test('physics: mix, a mix timeline, gravity and a reset key', () => {
  assert.equal(deg(boneOf(poseAt(tailRig({ mix: 0 }), 'dash', 0.2), 'tail')), 0, 'mix 0 shows nothing');
  const keyedOff = tailRig({}, { dash: {
    bones: { body: { translate: [{ x: 0, y: 0 }, { time: 0.3, x: 0, y: 120 }] } },
    physics: { sway: { mix: [{ value: 0 }, { time: 0.3, value: 0 }] } } } });
  near(deg(boneOf(poseAt(keyedOff, 'dash', 0.2), 'tail')), 0, 'a mix timeline turns it off');
  const all = tailRig({}, { dash: { bones: { body: { translate: [{ x: 0, y: 0 }, { time: 0.3, x: 0, y: 120 }] } }, physics: { '': { mix: [{ value: 0 }] } } } });
  near(deg(boneOf(poseAt(all, 'dash', 0.2), 'tail')), 0, 'the "" timeline keys every physics constraint');
  const hang = tailRig({ strength: 0, inertia: 1, damping: 0.5, gravity: 30 }, { still: { bones: { body: { translate: [{ x: 0 }, { time: 3, x: 0 }] } } } });
  const r = deg(boneOf(poseAt(hang, 'still', 3), 'tail'));
  assert.ok(r < -60, `with no spring and gravity, a level tail hangs down (${r})`);
  const reset = tailRig({}, { dash: {
    bones: { body: { translate: [{ x: 0, y: 0 }, { time: 0.3, x: 0, y: 120 }, { time: 1, x: 0, y: 120 }] } },
    physics: { sway: { reset: [{ time: 0.35 }] } } } });
  near(deg(boneOf(poseAt(reset, 'dash', 0.36), 'tail')), 0, 'a reset key puts it at rest', 1e-3);
});

test('a rig with physics or transform constraints poses on the engine with no limits and no Spine add-on', async () => {
  const data = await parseSkeleton({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'a', parent: 'root', length: 10 }, { name: 'b', parent: 'root' }],
    transform: [{ name: 't', bones: ['b'], target: 'a' }],
    physics: [{ name: 'p', bone: 'a', rotate: 1 }],
    animations: { idle: { bones: { a: { rotate: [{ value: 0 }, { time: 1, value: 20 }] } } } },
  }, { backend: 'keyframe' });
  assert.equal(data.backend, 'keyframe');
  assert.deepEqual(data.limits, [], 'nothing the engine leaves out');
  assert.deepEqual(data.physicsConstraints.map(c => c.name), ['p']);
});

// ── IK softness ──────────────────────────────────────────────────────────────

test('IK softness: the chain eases into full reach instead of snapping straight', () => {
  near(softReach(50, 100, 10), 50, 'far inside: untouched');
  near(softReach(90, 100, 10), 90, 'at the start of the soft zone');
  near(softReach(110, 100, 10), 100, 'full reach at reach + softness');
  near(softReach(200, 100, 10), 100, 'and no further');
  assert.ok(softReach(100, 100, 10) < 100 && softReach(100, 100, 10) > 95, 'in between: pulled in a little');
  const e = 1e-4;
  near((softReach(90 + e, 100, 10) - softReach(90 - e, 100, 10)) / (2 * e), 1, 'smooth where it starts', 1e-3);
  near((softReach(110 + e, 100, 10) - softReach(110 - e, 100, 10)) / (2 * e), 0, 'smooth where it ends', 1e-3);
  const rig = softness => compileSkeleton({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'thigh', parent: 'root', length: 50 }, { name: 'shin', parent: 'thigh', x: 50, length: 50 }, { name: 'foot', parent: 'root', x: 99 }],
    ik: [{ name: 'leg', bones: ['thigh', 'shin'], target: 'foot', softness }],
  });
  const bend = softness => Math.abs(setupPose(rig(softness)).bones[2].arotation);
  assert.ok(bend(0) < 17, `hard IK is nearly straight at 99 of 100 (${bend(0)})`);
  assert.ok(bend(10) > bend(0) + 5, `soft IK keeps the knee bent (${bend(10)})`);
  assert.equal(rig(10).unsupported.length, 0);
});

// ── sequences ────────────────────────────────────────────────────────────────

test('sequence modes give the frame Spine names them for', () => {
  const run = mode => Array.from({ length: 8 }, (_, i) => sequenceFrame(mode, 0, 0.1, i * 0.1, 4));
  assert.deepEqual(run('loop'), [0, 1, 2, 3, 0, 1, 2, 3]);
  assert.deepEqual(run('once'), [0, 1, 2, 3, 3, 3, 3, 3]);
  assert.deepEqual(run('pingpong'), [0, 1, 2, 3, 2, 1, 0, 1]);
  assert.deepEqual(run('onceReverse'), [3, 2, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(run('loopReverse'), [3, 2, 1, 0, 3, 2, 1, 0]);
  assert.deepEqual(run('hold'), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sequenceFrame('loop', 2, 0.1, 0, 4), 2, 'from the key\'s own index');
});

test('a sequence attachment draws the region of the frame its timeline shows', () => {
  const model = compileSkeleton({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }],
    slots: [{ name: 'fire', bone: 'root', attachment: 'fire' }],
    skins: [{ name: 'default', attachments: { fire: { fire: { width: 10, height: 10, sequence: { count: 3, start: 1, digits: 2, setup: 1 } } } } }],
    animations: { burn: { attachments: { default: { fire: { fire: { sequence: [{ mode: 'loop', delay: 0.1 }] } } } } } },
  });
  assert.deepEqual(model.unsupported, []);
  const regions = new Map(['fire01', 'fire02', 'fire03'].map(n => [n, { page: n, u: 0, v: 0, u2: 1, v2: 1, offsetX: 0, offsetY: 0, width: 10, height: 10, originalWidth: 10, originalHeight: 10 }]));
  const pageAt = pose => collectDraws(pose, n => regions.get(n) ?? null).draws[0]?.page;
  assert.equal(pageAt(setupPose(model)), 'fire02', 'the setup frame with no timeline');
  assert.deepEqual([0, 0.1, 0.2, 0.3].map(t => pageAt(poseAt(model, 'burn', t))), ['fire01', 'fire02', 'fire03', 'fire01']);
  const missing = collectDraws(poseAt(model, 'burn', 0.1), () => null).missing;
  assert.deepEqual(missing, ['fire02'], 'a missing frame is named by its own region');
});
