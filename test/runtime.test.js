// Gate for src/runtime: the official spine-ts 4.2 runtime, hosted in Node (ADR-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadRuntime, parseSkeleton, parseSkeletonBinary, poseSetup, sampleAnimation, assertRuntimeVersion, majorMinor } from '../src/runtime/index.js';
import { needsSpine } from './helpers/spine-addon.js';
import { isStudioError } from '../src/shared/errors.js';

const fixture = (name, ext) => new URL(`./fixtures/${name}/${name}.${ext}`, import.meta.url);
const readJson = name => JSON.parse(fs.readFileSync(fixture(name, 'json'), 'utf8'));
const near = (actual, expected, label, eps = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);

test('the bundle loads without a browser and exposes the parser, state and constraints', needsSpine, async () => {
  const spine = await loadRuntime();
  for (const name of ['SkeletonJson', 'Skeleton', 'AnimationState', 'AnimationStateData', 'TextureAtlas',
    'AtlasAttachmentLoader', 'SkeletonClipping', 'IkConstraint', 'TransformConstraint', 'PathConstraint',
    'PhysicsConstraintTimeline']) {
    assert.equal(typeof spine[name], 'function', name);
  }
  assert.equal(typeof spine.Physics.update, 'number', 'the Physics mode enum is present');
  assert.equal(await loadRuntime(), spine, 'the runtime is loaded once and cached');
});

test('a real skeleton parses with and without its atlas', async () => {
  const json = readJson('ident');
  const plain = await parseSkeleton(json);
  assert.equal(plain.bones.length, json.bones.length);
  assert.equal(plain.slots.length, json.slots.length);
  assert.deepEqual(plain.animations.map(a => a.name), Object.keys(json.animations));
  const atlased = await parseSkeleton(json, { atlasText: fs.readFileSync(fixture('ident', 'atlas'), 'utf8') });
  assert.equal(atlased.slots.length, json.slots.length);
});

test('sampling matches the authored keys exactly at key times', async () => {
  const json = readJson('ident');
  const data = await parseSkeleton(json);
  // Find a bone whose translate timeline is keyed at t=0 and at a later time, and check both.
  const [animName, anim] = Object.entries(json.animations).find(([, a]) =>
    Object.values(a.bones ?? {}).some(t => (t.translate ?? []).length >= 2));
  const [boneName, timelines] = Object.entries(anim.bones).find(([, t]) => (t.translate ?? []).length >= 2);
  const setup = json.bones.find(b => b.name === boneName);
  const keys = timelines.translate;
  const times = keys.map(k => k.time ?? 0);
  const samples = await sampleAnimation(data, animName, times);
  samples.forEach((s, i) => {
    const bone = s.bones.find(b => b.name === boneName);
    near(bone.x, (setup.x ?? 0) + (keys[i].x ?? 0), `${boneName}.x at ${times[i]}`);
    near(bone.y, (setup.y ?? 0) + (keys[i].y ?? 0), `${boneName}.y at ${times[i]}`);
  });
});

test('a key between physics grid points is still hit exactly', async () => {
  // 0.31 s is 18.6 frames at 60 fps: off the physics grid, on the animation clock.
  const json = {
    skeleton: { spine: '4.2.43', hash: 'grid' },
    bones: [{ name: 'root' }, { name: 'b', parent: 'root', x: 5 }],
    animations: { move: { bones: { b: {
      translate: [{ x: 0, y: 0 }, { time: 0.31, x: 37, y: -11 }, { time: 1, x: 0, y: 0 }],
      rotate: [{ value: 0 }, { time: 0.31, value: 23 }, { time: 1, value: 0 }],
    } } } },
  };
  const data = await parseSkeleton(json);
  const [at] = await sampleAnimation(data, 'move', [0.31]);
  const b = at.bones.find(x => x.name === 'b');
  // Key times are float32 in spine-ts; sampling at the float32 time hits the key exactly.
  near(b.x, 42, 'x at the off-grid key', 1e-9);
  near(b.y, -11, 'y at the off-grid key', 1e-9);
  near(b.rotation, 23, 'rotation at the off-grid key', 1e-9);
});

test('results come back in the order the times were asked, duplicates included', async () => {
  const json = readJson('ident');
  const data = await parseSkeleton(json);
  const name = data.animations[0].name;
  const shuffled = await sampleAnimation(data, name, [1.5, 0, 1.5, 0.75]);
  const sorted = await sampleAnimation(data, name, [0, 0.75, 1.5]);
  assert.deepEqual(shuffled.map(s => s.time), [1.5, 0, 1.5, 0.75]);
  assert.deepEqual(shuffled[1].bones, sorted[0].bones);
  assert.deepEqual(shuffled[3].bones, sorted[1].bones);
  assert.deepEqual(shuffled[0].bones, shuffled[2].bones);
});

test('an IK constraint is applied: the runtime, not keyframe math, decides the pose', async () => {
  // Two 50-unit bones reaching a target the animation moves to (60, 60). A keyframe-only
  // sampler leaves the arm at its setup rotation; the runtime solves the two-bone IK.
  const json = {
    skeleton: { spine: '4.2.43', hash: 'ik' },
    bones: [
      { name: 'root' },
      { name: 'upper', parent: 'root', length: 50 },
      { name: 'lower', parent: 'upper', length: 50, x: 50 },
      { name: 'target', parent: 'root', x: 100, y: 0 },
    ],
    ik: [{ name: 'reach', bones: ['upper', 'lower'], target: 'target' }],
    animations: { lift: { bones: { target: { translate: [{ x: 0, y: 0 }, { time: 1, x: -40, y: 60 }] } } } },
  };
  const data = await parseSkeleton(json);
  const [start, end] = await sampleAnimation(data, 'lift', [0, 1]);
  const bone = (s, name) => s.bones.find(b => b.name === name);
  near(bone(start, 'upper').worldRotation, 0, 'arm points straight at the target at t=0', 0.01);
  // Law of cosines: distance d = 60*sqrt(2); the upper bone sits acos(d / 100) below the
  // target direction (45 degrees), the lower bone the same amount above it.
  const bend = Math.acos((60 * Math.SQRT2) / 100) * 180 / Math.PI;
  near(bone(end, 'upper').worldRotation, 45 - bend, 'upper bone solved by IK', 0.01);
  near(bone(end, 'lower').worldRotation, 45 + bend, 'lower bone solved by IK', 0.01);
  assert.equal(bone(end, 'upper').rotation, 0, 'the keyframed local rotation stays at setup: only IK moved it');
  near(bone(end, 'upper').applied.rotation, 45 - bend, 'the applied local rotation carries the IK result', 0.01);
});

test('a physics constraint lags behind a sudden move, independent of the sampling times', async () => {
  const json = {
    skeleton: { spine: '4.2.43', hash: 'phys' },
    bones: [
      { name: 'root' },
      { name: 'body', parent: 'root' },
      { name: 'tail', parent: 'body', length: 40, x: 0, y: 0 },
    ],
    physics: [{ name: 'sway', bone: 'tail', rotate: 1, inertia: 1, strength: 100, damping: 0.85, mass: 1 }],
    animations: { dash: { bones: { body: { translate: [
      { x: 0, y: 0, curve: 'stepped' }, { time: 0.1, x: 200, y: 0 },
    ] } } } },
  };
  const data = await parseSkeleton(json);
  const tailAt = async times => (await sampleAnimation(data, 'dash', times)).map(s => s.bones.find(b => b.name === 'tail').worldRotation);
  const [rest] = await tailAt([0]);
  const [afterDash] = await tailAt([0.25]);
  near(rest, 0, 'tail at rest before the dash', 1e-6);
  assert.ok(Math.abs(afterDash) > 1, `tail swings after the body jumps (got ${afterDash})`);
  const [direct] = await tailAt([0.6]);
  const viaOthers = (await tailAt([0.13, 0.33, 0.47, 0.6]))[3];
  near(viaOthers, direct, 'the same instant gives the same pose whatever else was sampled', 1e-6);
});

test('a skeleton from another runtime line is refused by name', async () => {
  for (const version of ['3.8.99', '4.1.24', '4.3.0', undefined]) {
    const json = { skeleton: { spine: version }, bones: [{ name: 'root' }] };
    await assert.rejects(parseSkeleton(json), err => isStudioError(err, 'runtime-version'), String(version));
    assert.throws(() => assertRuntimeVersion(json), err => isStudioError(err, 'runtime-version'));
  }
  assert.equal(majorMinor('4.2.43'), '4.2');
  assert.equal(majorMinor('garbage'), null);
});

test('unknown animation, unknown skin and bad times are refused with codes', async () => {
  const data = await parseSkeleton(readJson('ident'));
  const name = data.animations[0].name;
  await assert.rejects(sampleAnimation(data, 'missing', [0]), err => isStudioError(err, 'unknown-animation'));
  await assert.rejects(sampleAnimation(data, name, [0], { skin: 'missing' }), err => isStudioError(err, 'unknown-skin'));
  await assert.rejects(sampleAnimation(data, name, [-1]), err => isStudioError(err, 'bad-argument'));
  await assert.rejects(sampleAnimation(data, name, [0], { fps: 0 }), err => isStudioError(err, 'bad-argument'));
  await assert.rejects(sampleAnimation(data, name, [601]), err => isStudioError(err, 'bad-argument'));
});

test('a malformed skeleton surfaces the official parser message under one code', async () => {
  const json = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'nope' }] };
  await assert.rejects(parseSkeleton(json), err => isStudioError(err, 'runtime-parse') && /nope|bone/i.test(err.message));
});

test('the setup pose carries world matrices that map local points to world', async () => {
  const json = {
    skeleton: { spine: '4.2.43', hash: 'm' },
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 10, y: 5, rotation: 90, scaleX: 2 }],
    animations: { idle: { bones: { arm: { rotate: [{ value: 45 }] } } } },
  };
  const setup = await poseSetup(await parseSkeleton(json));
  const arm = setup.bones.find(b => b.name === 'arm');
  near(arm.worldX, 10, 'world x'); near(arm.worldY, 5, 'world y');
  near(arm.worldRotation, 90, 'setup rotation, the 45-degree key is not applied');
  // Local point (1, 0) on a 90-degree, x-scaled-by-2 bone lands 2 units straight up.
  const { a, b, c, d } = arm.matrix;
  near(a * 1 + b * 0 + arm.worldX, 10, 'mapped x');
  near(c * 1 + d * 0 + arm.worldY, 7, 'mapped y');
});

test('a binary that is not a skeleton is refused under the parse code', needsSpine, async () => {
  await assert.rejects(parseSkeletonBinary(new Uint8Array([1, 2, 3, 4])), err => isStudioError(err, 'runtime-parse'));
  await assert.rejects(parseSkeletonBinary('not bytes'), err => isStudioError(err, 'bad-argument'));
});

test('texture-free regions sit where an untrimmed atlas region would put them', needsSpine, async () => {
  const json = {
    skeleton: { spine: '4.2.43', hash: 'w' },
    bones: [{ name: 'root' }, { name: 'b', parent: 'root', x: 100, y: 50 }],
    slots: [{ name: 's', bone: 'b', attachment: 'img' }],
    skins: [{ name: 'default', attachments: { s: { img: { x: 3, width: 10, height: 20, rotation: 90 } } } }],
  };
  const spine = await loadRuntime();
  const expected = [];
  const atlas = ['p.png', 'size:16,32', 'img', 'bounds:0,0,10,20', ''].join(String.fromCharCode(10));
  for (const atlasText of [undefined, atlas]) {
    const data = await parseSkeleton(json, { atlasText, backend: 'spine' });
    const skeleton = new spine.Skeleton(data);
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform(spine.Physics.none);
    const slot = skeleton.slots[0];
    const v = new Float32Array(8);
    slot.getAttachment().computeWorldVertices(slot, v, 0, 2);
    expected.push(Array.from(v, x => Math.round(x * 1000) / 1000));
  }
  // A 10 x 20 region rotated 90 degrees about (103, 50): it spans x 93..113, y 45..55.
  const xs = expected[0].filter((_, i) => i % 2 === 0), ys = expected[0].filter((_, i) => i % 2 === 1);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [93, 113, 45, 55]);
  assert.deepEqual(expected[0], expected[1], 'texture-free equals an untrimmed atlas region');
});
