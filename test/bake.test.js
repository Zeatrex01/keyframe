// Gate for src/spine/bake.js (the conversion) and src/understand/bake.js (measure + prove).
// Ported from legacy test_bake.js and the bake cases of test_export_base.js. The legacy gate
// drove the player page in a headless browser and skipped the measurement when none was
// found; here the official runtime runs in-process and every case always runs.
//
// The proof the legacy gate was built around, kept: physics sits on a bone that NO
// animation keys (`pendulum`). Any key that bone owns after a bake can only have come from
// what the constraint computed. "Did the bake work" is asked of the file, not of the eye.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  removalList, canonicalAnimationName, bakeableBones, physicsBones, drivenBones, boneTracks,
  selectBones, applyBakedTracks, dropConstraints, WHAT_PRESETS,
} from '../src/spine/bake.js';
import {
  bakeAnimations, measureBake, verifyBake, snapFps, sampleTimes, WORLD_TOLERANCE, RECORDING_NOTE,
} from '../src/understand/bake.js';
import { parseSkeleton, sampleAnimation } from '../src/runtime/index.js';
import { isStudioError } from '../src/shared/errors.js';
import { needsSpine } from './helpers/spine-addon.js';

const J = v => JSON.stringify(v);
const keyCount = channels => Object.values(channels ?? {}).reduce((n, list) => n + list.length, 0);
const boneOf = (sample, name) => sample.bones.find(b => b.name === name);

// The arm moves across the pendulum (a motion along the pendulum would give no torque).
function physicsRig() {
  return {
    skeleton: { spine: '4.2.43', hash: 'bake' },
    bones: [
      { name: 'root' },
      { name: 'arm', parent: 'root', length: 50 },
      { name: 'pendulum', parent: 'arm', length: 30, y: 20 },
    ],
    slots: [
      { name: 'mask', bone: 'arm', attachment: 'clip' },
      { name: 'body', bone: 'arm', attachment: 'img' },
    ],
    skins: [{ name: 'default', attachments: {
      mask: { clip: { type: 'clipping', end: 'body', vertexCount: 4, vertices: [0, 0, 100, 0, 100, 100, 0, 100], color: 'ce3a3aff' } },
      body: { img: { width: 8, height: 8 } },
    } }],
    physics: [{ name: 'sway', bone: 'pendulum', rotate: 1, inertia: 0.6, strength: 60, damping: 0.8, mix: 1 }],
    animations: {
      intro: {
        bones: { arm: { translate: [{ y: 0 }, { time: 0.5, y: 100 }, { time: 1, y: 0 }] } },
        slots: { body: { rgba: [{ color: 'ffffffff' }, { time: 1, color: 'ff0000ff' }] } },
        drawOrder: [{ time: 0.5, offsets: [{ slot: 'body', offset: -1 }] }],
        physics: { sway: { mix: [{ value: 1 }, { time: 1, value: 1 }] } },
      },
      idle: { bones: { arm: { rotate: [{ value: 0 }, { time: 0.5, value: 25 }, { time: 1, value: 0 }] } } },
    },
  };
}

const isError = code => err => isStudioError(err, code);

// ── the physics bake ──────────────────────────────────────────────────────────

test('a physics bake gives the unkeyed physics bone dense keys and drops the constraint', needsSpine, async () => {
  const source = physicsRig();
  const before = J(source);
  const result = await bakeAnimations(source, { animation: 'intro', what: 'physics', fps: 30 });
  assert.equal(J(source), before, 'the source object is untouched (the one-way rule starts here)');
  assert.notEqual(result.skeleton, source, 'the bake is a new skeleton');

  const out = result.skeleton;
  assert.equal(source.animations.intro.bones.pendulum, undefined, 'the fixture is right: pendulum has no key in the source');
  const pendulum = out.animations.intro.bones.pendulum;
  assert.ok(pendulum, 'after the bake pendulum carries keys: they can only come from the constraint');
  assert.ok(keyCount(pendulum) >= 5, `dense sampling (${keyCount(pendulum)} keys)`);

  assert.equal(out.physics, undefined, 'the physics array is gone');
  assert.deepEqual(result.removed, { physics: ['sway'] }, 'the report names what it removed');
  assert.ok(!Object.values(out.animations).some(a => a.physics), 'no orphan physics timeline is left');

  assert.equal(result.verification.passed, true, J(result.verification));
  assert.equal(result.animations[0].verification.passed, true);
  assert.ok(result.animations[0].verification.maxWorldError <= WORLD_TOLERANCE);
  assert.equal(result.note, RECORDING_NOTE, 'the report says a physics bake is a recording, not silently');
  assert.equal(result.animations[0].physics, true);
});

test('the baked skeleton is a copy of the source: bones, slots, skins and version carried', needsSpine, async () => {
  const source = physicsRig();
  const { skeleton: out } = await bakeAnimations(source, { animation: 'intro' });
  assert.deepEqual(out.bones.map(b => b.name), source.bones.map(b => b.name));
  assert.deepEqual(out.slots.map(s => s.name), source.slots.map(s => s.name));
  assert.equal(J(out.skins), J(source.skins), 'skins and attachments carried byte for byte');
  assert.equal(out.skeleton.spine, source.skeleton.spine);
});

test('a bake writes bones only: slot colours, draw order and other clips come from the source', needsSpine, async () => {
  const source = physicsRig();
  const { skeleton: out } = await bakeAnimations(source, { animation: 'intro' });
  assert.equal(J(out.animations.intro.drawOrder), J(source.animations.intro.drawOrder), 'draw order unchanged');
  assert.equal(J(out.animations.intro.slots), J(source.animations.intro.slots), 'slot colour timeline unchanged');
  assert.equal(J(out.animations.idle), J(source.animations.idle), 'a clip that was not baked is unchanged');
});

test('baking is deterministic: twice gives the same numbers', needsSpine, async () => {
  const a = await bakeAnimations(physicsRig(), { animation: 'intro', fps: 30 });
  const b = await bakeAnimations(physicsRig(), { animation: 'intro', fps: 30 });
  assert.equal(J(a.skeleton.animations.intro.bones.pendulum), J(b.skeleton.animations.intro.bones.pendulum));
  assert.equal(J(a.skeleton), J(b.skeleton));
});

test('the self-check replays the delivered file on the runtime and agrees with an independent replay', needsSpine, async () => {
  const { skeleton } = await bakeAnimations(physicsRig(), { animation: 'intro' });
  const original = await parseSkeleton(physicsRig());
  const baked = await parseSkeleton(skeleton);
  const times = [0.1, 0.35, 0.5, 0.8, 1];
  const [want, got] = await Promise.all([sampleAnimation(original, 'intro', times), sampleAnimation(baked, 'intro', times)]);
  for (let i = 0; i < times.length; i++) {
    for (const name of ['arm', 'pendulum']) {
      const w = boneOf(want[i], name), g = boneOf(got[i], name);
      assert.ok(Math.abs(w.worldRotation - g.worldRotation) < 0.05, `${name} rotation at ${times[i]}: ${w.worldRotation} vs ${g.worldRotation}`);
      assert.ok(Math.abs(w.worldX - g.worldX) < WORLD_TOLERANCE && Math.abs(w.worldY - g.worldY) < WORLD_TOLERANCE);
    }
  }
});

test('the self-check fails when the keys do not reproduce the pose', needsSpine, async () => {
  const source = physicsRig();
  const data = await parseSkeleton(source);
  const measurement = await measureBake(data, 'intro');
  // Dropping the physics without baking it: the pendulum stops swinging.
  const { skeleton } = dropConstraints(source, ['physics']);
  const v = await verifyBake(skeleton, 'intro', measurement);
  assert.equal(v.passed, false, J(v));
  assert.equal(v.worst.bone, 'pendulum', 'the worst bone is named');
  assert.ok(v.maxWorldError > WORLD_TOLERANCE);
  const broken = await verifyBake({ skeleton: { spine: '3.8.99' } }, 'intro', measurement);
  assert.equal(broken.passed, false, 'a file the runtime refuses is a failed check, never a pass');
  assert.ok(broken.error);
});

// ── what is removed ───────────────────────────────────────────────────────────

test('what: curves removes nothing; the physics stays live and is not baked on top', needsSpine, async () => {
  const source = physicsRig();
  const before = J(source);
  const result = await bakeAnimations(source, { animation: 'intro', what: 'curves' });
  assert.equal(result.skeleton.physics.length, 1, 'the physics block is still there');
  assert.deepEqual(result.removed, {}, 'the report says nothing was removed');
  assert.equal(J(source), before);
  // Fixed: legacy baked the applied pose of the physics bone even while its constraint
  // stayed live, so the delivered file swung twice. A live constraint's bone is baked from
  // its keyed transform; pendulum has none, so it keeps no keys and the physics drives it.
  assert.equal(result.skeleton.animations.intro.bones.pendulum, undefined);
  assert.equal(result.verification.passed, true, J(result.verification));
  assert.equal(result.note, undefined, 'nothing was recorded, so no recording note');
});

test('remove is independent of what: [] removes nothing, [physics] removes only physics', needsSpine, async () => {
  const none = await bakeAnimations(physicsRig(), { animation: 'intro', what: 'all', remove: [] });
  assert.deepEqual(none.removed, {});
  assert.equal(none.skeleton.physics.length, 1, 'baked but not removed: the physics stays in the file');
  const only = await bakeAnimations(physicsRig(), { animation: 'intro', what: 'curves', remove: ['physics'] });
  assert.deepEqual(only.removed, { physics: ['sway'] });
  assert.equal(only.skeleton.physics, undefined);
});

test('removalList: presets, explicit list wins, unknown names refused', () => {
  assert.deepEqual(removalList(undefined), ['physics'], 'physics is the default');
  assert.deepEqual(removalList(undefined, 'curves'), []);
  assert.deepEqual(removalList(undefined, 'all'), ['physics', 'ik', 'transform', 'path']);
  assert.deepEqual(removalList(['path', 'ik'], 'all'), ['ik', 'path'], 'the list wins, in canonical order');
  assert.deepEqual(removalList([], 'all'), []);
  assert.deepEqual(Object.keys(WHAT_PRESETS), ['physics', 'curves', 'all']);
  assert.throws(() => removalList(undefined, 'everything'), isError('bad-argument'));
  assert.throws(() => removalList(['clipping']), isError('bad-argument'), 'a clipping mask is not a constraint');
  assert.throws(() => removalList('physics'), isError('bad-argument'));
});

test('dropConstraints never touches a clipping mask: it is a slot attachment, not a constraint', needsSpine, async () => {
  // A clipping mask is common in production rigs and a bake must never touch it. Break the drop into touching skins and this fails.
  const source = physicsRig();
  const clipOf = sk => sk?.skins?.[0]?.attachments?.mask?.clip ?? null;
  const clipBefore = J(clipOf(source));
  const { skeleton, removed } = dropConstraints(source, ['physics']);
  assert.equal(skeleton.physics, undefined, 'physics removed');
  assert.deepEqual(removed, { physics: ['sway'] }, 'only physics reported');
  assert.equal(J(clipOf(skeleton)), clipBefore, 'the clipping attachment is byte for byte the same');
  assert.equal(clipOf(skeleton).type, 'clipping');
  assert.ok(skeleton.slots.some(s => s.name === 'mask'), 'the clipping slot is kept');
  // The real bake path (write tracks, then drop) keeps it too.
  const result = await bakeAnimations(source, { animation: 'intro' });
  assert.equal(J(clipOf(result.skeleton)), clipBefore);
  assert.ok(result.skeleton.animations.intro.bones.arm, 'and a bone key was written');
});

test('dropConstraints removes skin references so the runtime can still read the file', needsSpine, async () => {
  // Fixed: legacy dropped the constraint arrays but left skins[].physics naming them, and
  // the official parser refuses a skin that names a missing constraint.
  const source = physicsRig();
  source.physics[0].skinRequired = true;
  source.skins.push({ name: 'swinging', physics: ['sway'] });
  const { skeleton } = dropConstraints(source, ['physics']);
  assert.equal(skeleton.skins[1].physics, undefined);
  assert.equal(skeleton.skins[1].name, 'swinging', 'the skin itself stays');
  await parseSkeleton(skeleton);
  const result = await bakeAnimations(source, { animation: 'intro', skin: 'swinging' });
  assert.ok(result.skeleton.animations.intro.bones.pendulum, 'the skin-scoped physics was measured');
  assert.equal(result.verification.passed, true, J(result.animations[0].verification));
});

// ── live constraints and authored keys ────────────────────────────────────────

function ikRig() {
  return {
    skeleton: { spine: '4.2.43', hash: 'ik' },
    bones: [
      { name: 'root' },
      { name: 'upper', parent: 'root', length: 50 },
      { name: 'lower', parent: 'upper', x: 50, length: 50 },
      { name: 'target', parent: 'root', x: 70, y: 40 },
    ],
    ik: [{ name: 'reach', bones: ['upper', 'lower'], target: 'target', mix: 0.5 }],
    animations: { reach: { bones: {
      target: { translate: [{ x: 0, y: 0 }, { time: 0.5, x: -30, y: 20 }, { time: 1, x: 0, y: 0 }] },
      upper: { rotate: [{ value: 0 }, { time: 1, value: 40 }] },
    } } },
  };
}

test('a constraint that stays live is not baked on top of itself (partial IK mix)', async () => {
  // Fixed: legacy baked every bone from its applied pose. With an IK at mix 0.5 kept live,
  // the delivered file mixed the IK result into keys that already contained it.
  const source = ikRig();
  const result = await bakeAnimations(source, { animation: 'reach', what: 'physics' });
  assert.deepEqual(result.removed, {});
  assert.equal(result.verification.passed, true, J(result.verification));

  // The legacy reading, rebuilt from the same measurement, is measurably wrong.
  const data = await parseSkeleton(source);
  const m = await measureBake(data, 'reach');
  const bones = selectBones(m.moving, bakeableBones(source, 'reach')).bones;
  const legacy = boneTracks(m.frames, m.setup, bones, { useApplied: bones });
  const legacySk = applyBakedTracks(source, 'reach', legacy.tracks, bones);
  const v = await verifyBake(legacySk, 'reach', m);
  assert.equal(v.passed, false, `baking applied poses under a live IK should fail: ${J(v)}`);
});

test('removing the IK bakes the IK result into plain keys', async () => {
  const result = await bakeAnimations(ikRig(), { animation: 'reach', remove: ['ik'] });
  assert.deepEqual(result.removed, { ik: ['reach'] });
  assert.ok(result.skeleton.animations.reach.bones.lower, 'the unkeyed IK child now carries keys');
  assert.equal(result.verification.passed, true, J(result.verification));
});

test('a baked bone loses every authored timeline the bake does not reproduce', needsSpine, async () => {
  // Fixed: legacy merged per channel, and a bone the bake found static was not written at
  // all, so authored keys hidden under a constraint came back to life once it was removed.
  // Here a transform constraint pins `held` to `anchor` while its own keys try to move it.
  const source = {
    skeleton: { spine: '4.2.43', hash: 'pin' },
    bones: [
      { name: 'root' },
      { name: 'anchor', parent: 'root', x: 30 },
      { name: 'held', parent: 'root', x: 30, length: 20 },
      { name: 'other', parent: 'root', length: 20 },
    ],
    transform: [{ name: 'pin', bones: ['held'], target: 'anchor',
      mixRotate: 0, mixX: 1, mixY: 1, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 }],
    animations: { move: { bones: {
      held: { translate: [{ x: 0 }, { time: 1, x: 50 }] },
      other: { rotate: [{ value: 0 }, { time: 1, value: 30 }] },
    } } },
  };
  const result = await bakeAnimations(source, { animation: 'move', remove: ['transform'] });
  assert.equal(result.skeleton.animations.move.bones.held, undefined, 'the hidden authored translate is gone');
  assert.equal(result.verification.passed, true, J(result.verification));

  // The legacy shape (write only bones that produced tracks, keep the rest) fails the check.
  const data = await parseSkeleton(source);
  const m = await measureBake(data, 'move');
  const bones = selectBones(m.moving, bakeableBones(source, 'move')).bones;
  const t = boneTracks(m.frames, m.setup, bones, { useApplied: drivenBones(source, ['transform']) });
  const legacy = dropConstraints(applyBakedTracks(source, 'move', t.tracks, Object.keys(t.tracks)), ['transform']).skeleton;
  assert.equal((await verifyBake(legacy, 'move', m)).passed, false);
});

test('applyBakedTracks replaces a baked bone whole and leaves every other timeline alone', () => {
  const source = physicsRig();
  source.animations.intro.bones.arm.scale = [{ x: 2, y: 2 }];
  const tracks = { arm: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 10 }] } };
  const out = applyBakedTracks(source, 'intro', tracks, ['arm', 'pendulum']);
  assert.deepEqual(out.animations.intro.bones, tracks, 'authored translate and scale do not survive beside the bake');
  assert.equal(J(out.animations.intro.slots), J(source.animations.intro.slots));
  assert.equal(J(out.animations.intro.physics), J(source.animations.intro.physics), 'constraint timelines are the drop step\'s business');
  assert.ok(source.animations.intro.bones.arm.scale, 'the input is not modified');
  const empty = applyBakedTracks(source, 'intro', {}, ['arm']);
  assert.equal(empty.animations.intro.bones, undefined, 'a clip left with no bone timelines has no bones block');
});

// ── curves ────────────────────────────────────────────────────────────────────

test('a curves bake turns a bezier into dense linear keys that match the runtime', async () => {
  const source = {
    skeleton: { spine: '4.2.43', hash: 'curve' },
    bones: [{ name: 'root' }, { name: 'lid', parent: 'root', length: 40 }],
    animations: { open: { bones: { lid: { rotate: [{ value: 0, curve: [0.25, 0, 0.75, 90] }, { time: 1, value: 90 }] } } } },
  };
  const result = await bakeAnimations(source, { what: 'curves', fps: 30 });
  assert.equal(result.animations[0].animation, 'open', 'the first animation is the default');
  const keys = result.skeleton.animations.open.bones.lid.rotate;
  assert.equal(keys.length, 31, 'one key per 1/30 s, both ends included');
  assert.ok(keys.every(k => !('curve' in k)), 'every key is linear');
  keys.forEach((k, i) => assert.ok(Math.abs(k.time - i / 30) < 1e-4, `key ${i} at ${k.time}`));
  const samples = await sampleAnimation(await parseSkeleton(source), 'open', keys.map((_, i) => i / 30));
  keys.forEach((k, i) => assert.ok(Math.abs(k.value - boneOf(samples[i], 'lid').rotation) < 1e-3,
    `value at ${k.time}: ${k.value} vs ${boneOf(samples[i], 'lid').rotation}`));
  assert.ok(Math.abs(keys[6].value - 18) > 1, `the ease survived: at 0.2 s the value is not the linear 18 (${keys[6].value})`);
  assert.equal(result.verification.passed, true);
});

// ── mirrors ───────────────────────────────────────────────────────────────────

function mirroredFlag(withPhysics) {
  const sk = {
    skeleton: { spine: '4.2.43', hash: 'mirror' },
    bones: [{ name: 'root' }, { name: 'flag', parent: 'root', length: 40 }],
    animations: { wave: { bones: { flag: { scale: [{ time: 0, x: -1, y: 1 }, { time: 1, x: -1, y: 1 }] } } } },
  };
  if (withPhysics) {
    sk.bones.push({ name: 'tip', parent: 'flag', length: 40, x: 40 });
    sk.physics = [{ name: 'ripple', bone: 'tip', rotate: 1, inertia: 0.6, strength: 60, damping: 0.8, mix: 1 }];
    sk.animations.wave.bones.flag.rotate = [{ time: 0, value: 0 }, { time: 0.5, value: 15 }, { time: 1, value: 0 }];
  }
  return sk;
}

test('a keyed mirror (negative scale) bakes faithfully', async () => {
  const result = await bakeAnimations(mirroredFlag(false), { remove: [] });
  assert.equal(result.verification.passed, true, J(result.verification));
});

test('a physics swing under a keyed mirror bakes faithfully, checked against the runtime', needsSpine, async () => {
  // Legacy pinned this case as a failed self-check and shipped it flagged. It baked every
  // bone from its applied pose, which re-expresses the mirrored parent as scaleY=-1 plus
  // rotate 180. Baked from keyed transforms (only the physics bone from its applied pose)
  // the bake is faithful; the independent replay below confirms the verdict, and the
  // legacy reading, rebuilt from the same measurement, still fails.
  for (const remove of [[], ['physics']]) {
    const source = mirroredFlag(true);
    const result = await bakeAnimations(source, { remove });
    assert.equal(result.verification.passed, true, `${J(remove)}: ${J(result.verification)}`);
    const times = [0.2, 0.5, 0.75, 1];
    const [want, got] = await Promise.all([
      sampleAnimation(await parseSkeleton(source), 'wave', times),
      sampleAnimation(await parseSkeleton(result.skeleton), 'wave', times),
    ]);
    times.forEach((t, i) => {
      const w = boneOf(want[i], 'tip'), g = boneOf(got[i], 'tip');
      assert.ok(Math.abs(w.worldRotation - g.worldRotation) < 0.1, `tip rotation at ${t}: ${w.worldRotation} vs ${g.worldRotation}`);
      assert.ok(Math.abs(w.matrix.d - g.matrix.d) < 1e-3, `tip reflection kept at ${t}`);
    });
  }
  const recorded = await bakeAnimations(mirroredFlag(true), { remove: ['physics'] });
  assert.ok(recorded.skeleton.animations.wave.bones.tip, 'with physics removed the swing is recorded as keys');

  const source = mirroredFlag(true);
  const m = await measureBake(await parseSkeleton(source), 'wave');
  const bones = selectBones(m.moving, bakeableBones(source, 'wave')).bones;
  const legacy = boneTracks(m.frames, m.setup, bones, { useApplied: bones });
  const legacySk = dropConstraints(applyBakedTracks(source, 'wave', legacy.tracks, bones), ['physics']).skeleton;
  assert.equal((await verifyBake(legacySk, 'wave', m)).passed, false, 'every bone from its applied pose misses');
});

function curtain() {
  return {
    skeleton: { spine: '4.2.43', hash: 'curtain' },
    bones: [
      { name: 'root' },
      { name: 'rightTop', parent: 'root', x: 100, scaleX: -1 },
      { name: 'right1', parent: 'rightTop', length: 40 },
      { name: 'right2', parent: 'right1', length: 40, x: 40 },
    ],
    animations: { sway: { bones: {
      right1: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 20 }, { time: 1, value: 0 }] },
      right2: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 20 }, { time: 1, value: 0 }] },
    } } },
  };
}

test('a mirrored chain (static flip parent) bakes with the flipped side in place', async () => {
  // Owner's bug: a curtain side copied and mirrored (parent scaleX=-1) baked with the
  // flipped side wrong ("one is right, one is wrong"). The real runtime must put the baked
  // tip where the original put it, and the static flip parent must stay at setup.
  const source = curtain();
  const result = await bakeAnimations(source, { remove: [] });
  const [want] = await sampleAnimation(await parseSkeleton(source), 'sway', [0.5]);
  const [got] = await sampleAnimation(await parseSkeleton(result.skeleton), 'sway', [0.5]);
  const w = boneOf(want, 'right2'), g = boneOf(got, 'right2');
  assert.ok(Math.max(Math.abs(w.worldX - g.worldX), Math.abs(w.worldY - g.worldY)) < 1,
    `flipped tip in the same place: ${J([w.worldX, w.worldY])} vs ${J([g.worldX, g.worldY])}`);
  assert.equal(result.skeleton.animations.sway.bones.rightTop, undefined, 'the static flip parent was not baked');
  assert.equal(result.verification.passed, true, J(result.verification));
});

test('a keyed negative-scale bone is densified by default; keepLive keeps its authored keys', async () => {
  const source = curtain();
  const authored = [{ time: 0, value: 0 }, { time: 0.4, value: 7 }];
  source.animations.sway.bones.rightTop = { rotate: authored };
  const auto = await bakeAnimations(source, { remove: [] });
  const autoKeys = auto.skeleton.animations.sway.bones.rightTop?.rotate ?? [];
  assert.ok(autoKeys.length > authored.length, `densified (${autoKeys.length} keys)`);
  assert.equal(auto.verification.passed, true, J(auto.verification));

  const kept = await bakeAnimations(source, { remove: [], keepLive: ['rightTop'] });
  assert.equal(J(kept.skeleton.animations.sway.bones.rightTop.rotate), J(authored), 'the owner\'s sparse keys are unchanged');
  assert.ok(kept.keptLive.includes('rightTop'), 'the report says the bone was left as authored');
});

// ── several animations ────────────────────────────────────────────────────────

test('baking every animation captures each with the physics live and drops it once at the end', needsSpine, async () => {
  // Physics may only be dropped once, at the end: strip it after the first clip and the
  // rest have nothing left to simulate. pendulum has no timeline, so keys in BOTH clips
  // prove both were measured while the physics was live.
  const source = physicsRig();
  const result = await bakeAnimations(source, { animations: Object.keys(source.animations), remove: ['physics'] });
  assert.deepEqual(result.animations.map(a => a.animation), ['intro', 'idle']);
  assert.deepEqual(result.removed, { physics: ['sway'] });
  assert.ok(result.skeleton.animations.intro.bones.pendulum);
  assert.ok(result.skeleton.animations.idle.bones.pendulum);
  assert.equal(result.skeleton.physics, undefined);
  assert.equal(result.verification.passed, true, J(result.animations.map(a => a.verification)));
});

// ── sampling rate and the physics step ────────────────────────────────────────

test('the sample rate snaps to 60/N so samples land on simulation steps', () => {
  assert.deepEqual(snapFps(30), { fps: 30, every: 2 });
  assert.deepEqual(snapFps(60), { fps: 60, every: 1 });
  assert.deepEqual(snapFps(25), { fps: 30, every: 2 });
  assert.deepEqual(snapFps(7), { fps: 60 / 9, every: 9 });
  assert.deepEqual(snapFps(500), { fps: 60, every: 1 }, 'capped at 60');
  assert.deepEqual(snapFps(undefined), { fps: 30, every: 2 }, '30 by default');
  assert.deepEqual(snapFps(0.1), { fps: 1, every: 60 }, 'at least 1');
  assert.deepEqual(sampleTimes(0.1, 2), [0, 1 / 30, 2 / 30, 0.1], 'an end on the grid is sampled once');
  assert.deepEqual(sampleTimes(0.11, 2), [0, 1 / 30, 2 / 30, 0.1, 0.11], 'an end between steps is sampled too');
  assert.deepEqual(sampleTimes(0, 2), [0]);
});

test('a baked clip keeps its duration when it ends between two samples', async () => {
  const sk = {
    skeleton: { spine: '4.2.43', hash: 'end' },
    bones: [{ name: 'root' }, { name: 'b', parent: 'root', length: 10 }],
    animations: { short: { bones: { b: { rotate: [{ value: 0 }, { time: 0.95, value: 40 }] } } } },
  };
  const result = await bakeAnimations(sk, { what: 'curves', fps: 30 });
  const keys = result.skeleton.animations.short.bones.b.rotate;
  assert.equal(keys[keys.length - 1].time, 0.95, 'the last key sits on the end of the clip');
  assert.equal(keys[keys.length - 1].value, 40);
  assert.equal(result.animations[0].duration, (await parseSkeleton(result.skeleton)).findAnimation('short').duration);
});

test('a higher sample rate gives more samples; the snapped rate is reported', needsSpine, async () => {
  const data = await parseSkeleton(physicsRig());
  const low = await measureBake(data, 'intro', { fps: 12 });
  const high = await measureBake(data, 'intro', { fps: 60 });
  assert.ok(high.frames.length > low.frames.length, `${low.frames.length} -> ${high.frames.length}`);
  assert.equal(low.requestedFps, undefined, '12 divides 60: no snap to report');
  const snapped = await measureBake(data, 'intro', { fps: 25 });
  assert.equal(snapped.fps, 30);
  assert.equal(snapped.requestedFps, 25);
  assert.equal(low.truncated, false);
});

test('bones that never leave setup are not listed; setup values are carried', needsSpine, async () => {
  const data = await parseSkeleton(physicsRig());
  const m = await measureBake(data, 'intro');
  assert.deepEqual(m.moving, ['arm', 'pendulum']);
  assert.deepEqual(m.setup.pendulum, { x: 0, y: 20, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 });
  assert.equal(m.frames[0].bones.root, undefined, 'a static bone carries no locals');
  assert.ok(m.frames[0].world.root, 'but its world position is kept for the self-check');
});

test('a clip longer than the runtime samples is baked up to there and reported as truncated', async () => {
  const sk = {
    skeleton: { spine: '4.2.43', hash: 'long' },
    bones: [{ name: 'root' }, { name: 'b', parent: 'root' }],
    animations: { long: { bones: { b: { translate: [{ x: 0 }, { time: 601, x: 601 }] } } } },
  };
  const m = await measureBake(await parseSkeleton(sk), 'long', { fps: 1 });
  assert.equal(m.truncated, true);
  assert.equal(m.frames[m.frames.length - 1].time, 600);
  assert.equal(m.duration, 601);
});

test('physicsStep thins only physics bones and always keeps the first and last key', needsSpine, async () => {
  // Bake physics at intervals, and keep the last frame when stepping.
  const full = await bakeAnimations(physicsRig(), { animation: 'intro', fps: 30 });
  const thin = await bakeAnimations(physicsRig(), { animation: 'intro', fps: 30, physicsStep: 4 });
  assert.equal(thin.physicsStep, 4, 'the report shows the step');
  assert.equal(full.physicsStep, undefined, 'and says nothing at the default');
  const fullP = full.skeleton.animations.intro.bones.pendulum, thinP = thin.skeleton.animations.intro.bones.pendulum;
  assert.ok(keyCount(fullP) > keyCount(thinP), `${keyCount(fullP)} -> ${keyCount(thinP)}`);
  for (const channel of Object.keys(thinP)) {
    const a = fullP[channel], b = thinP[channel];
    assert.equal(b[0].time, a[0].time, `${channel}: first key kept`);
    assert.equal(b[b.length - 1].time, a[a.length - 1].time, `${channel}: last key kept (the loop point)`);
  }
  assert.equal(keyCount(thin.skeleton.animations.intro.bones.arm), keyCount(full.skeleton.animations.intro.bones.arm),
    'the keyed bone is not thinned');
  assert.equal(typeof thin.verification.passed, 'boolean', 'the thinned bake is still checked');
  assert.ok(thin.animations[0].verification.maxWorldError > full.animations[0].verification.maxWorldError,
    'every measured sample is replayed, so the thinning shows in the error');
});

test('boneTracks: keyed vs applied source, rotation unwrapped, channels at setup dropped', () => {
  const frame = (time, rotation) => ({ time, bones: { b: {
    keyed: { x: 5, y: 0, rotation, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
    applied: { x: 5, y: 0, rotation, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  } } });
  const frames = [frame(0, 170), frame(0.1, 179), frame(0.2, -179), frame(0.3, -170)];
  const setup = { b: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } };
  const applied = boneTracks(frames, setup, ['b'], { useApplied: ['b'] }).tracks.b;
  // Fixed: an atan2 angle wraps at 180; Spine interpolates the raw value, so 179 -> -179
  // spun the bone a full turn in one frame.
  assert.deepEqual(applied.rotate.map(k => k.value), [170, 179, 181, 190]);
  assert.deepEqual(Object.keys(applied), ['rotate'], 'translate, scale and shear never left setup');
  const keyed = boneTracks(frames, setup, ['b']).tracks.b;
  assert.deepEqual(keyed.rotate.map(k => k.value), [170, 179, -179, -170], 'keyed values are authored: never rewritten');

  const scaled = boneTracks([{ time: 0, bones: { b: { keyed: { x: 0, y: 0, rotation: 0, scaleX: 3, scaleY: -2, shearX: 4, shearY: 0 } } } }],
    { b: { x: 0, y: 0, rotation: 0, scaleX: 1.5, scaleY: 1, shearX: 1, shearY: 0 } }, ['b']).tracks.b;
  assert.deepEqual(scaled.scale, [{ time: 0, x: 2, y: -2 }], 'scale keys multiply the setup');
  assert.deepEqual(scaled.shear, [{ time: 0, x: 3, y: 0 }], 'shear keys add to the setup');
});

// ── names ─────────────────────────────────────────────────────────────────────

// Built from a code point so the file holds one spelling only and no editor can fold it.
const ACCENTED = 'caf' + String.fromCharCode(0xe9);
const NFC = ACCENTED.normalize('NFC');
const NFD = ACCENTED.normalize('NFD');

test('a bone named in another Unicode form is written under the skeleton\'s own spelling', () => {
  assert.notEqual(NFC, NFD, 'the fixture really has two spellings');
  const sk = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }, { name: NFC, parent: 'root', length: 30 }],
    animations: { a: { bones: { [NFD]: { translate: [{ x: 1 }] } } } } };
  const out = applyBakedTracks(sk, 'a', { [NFD]: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 10 }] } }, [NFD]);
  assert.deepEqual(Object.keys(out.animations.a.bones), [NFC], 'one key, the base\'s spelling, the old NFD entry replaced');
  assert.deepEqual(selectBones([NFD], new Set([NFC]), []).bones, [NFD], 'allowed regardless of form');
  assert.deepEqual(selectBones([NFC], new Set([NFC]), [NFD]).keptLive, [NFC], 'keepLive regardless of form');
});

test('an animation named in another Unicode form keeps its keyed bones and is replaced, not duplicated', async () => {
  // Measured 2026-08-20 with a Turkish animation name: an exact-match miss lost every
  // hand-keyed bone, and writing under the other spelling created a second animation.
  const sk = { skeleton: { spine: '4.2.43', hash: 'nf' }, bones: [{ name: 'root' }, { name: 'arm', parent: 'root', length: 30 }],
    animations: { [NFD]: { bones: { arm: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 5 }] } } } } };
  assert.ok(bakeableBones(sk, NFC).has('arm'));
  assert.equal(canonicalAnimationName(sk, NFC), NFD);
  assert.equal(canonicalAnimationName(sk, 'missing'), 'missing');
  const result = await bakeAnimations(sk, { animation: NFC, what: 'curves' });
  assert.deepEqual(Object.keys(result.skeleton.animations), [NFD], 'one animation, the base\'s spelling');
  assert.ok(result.skeleton.animations[NFD].bones.arm.rotate.length > 2);
});

test('bakeable and physics bone sets', () => {
  const sk = physicsRig();
  sk.ik = [{ name: 'k', bones: ['arm'], target: 'root' }];
  assert.deepEqual([...bakeableBones(sk, 'intro')].sort(), ['arm', 'pendulum']);
  assert.deepEqual([...physicsBones(sk)], ['pendulum'], 'only what physics drives is thinned');
  assert.deepEqual([...drivenBones(sk, ['ik'])], ['arm']);
  assert.deepEqual([...bakeableBones(sk, 'no-such-clip')].sort(), ['arm', 'pendulum'], 'constraint bones even without the clip');
});

// ── refusals ──────────────────────────────────────────────────────────────────

test('nothing to bake, an unknown animation, a bad option: refused with stable codes', needsSpine, async () => {
  const still = { skeleton: { spine: '4.2.43', hash: 's' }, bones: [{ name: 'root' }, { name: 'b', parent: 'root' }],
    animations: { rest: { bones: { b: { rotate: [{ value: 0 }, { time: 1, value: 0 }] } } } } };
  await assert.rejects(bakeAnimations(still), isError('nothing-to-bake'));
  await assert.rejects(bakeAnimations(physicsRig(), { animation: 'nope' }), isError('unknown-animation'));
  await assert.rejects(bakeAnimations({ ...still, animations: {} }), isError('unknown-animation'));
  await assert.rejects(bakeAnimations(physicsRig(), { what: 'egg' }), isError('bad-argument'));
});
