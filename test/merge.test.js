// Gate for src/spine/merge.js and tools/merge-skeletons.js. Ported from legacy
// test_merge.js: the "it merged but Spine will not open it" class. The editor rejects a
// file whose animation references anything undefined: a mesh deform on a missing
// attachment, an event with no definition, an attachment timeline naming art the target
// skin does not carry. Each gap is pinned with a synthetic mesh + deform + event source
// merged into a plain target, plus real-file passes.
//
// Legacy linted the result with a hand-written editor check; here src/spine/check.js
// does it. And every merge is cross-checked against the official spine-ts 4.2 runtime:
// the merged skeleton must parse, and the merged animation must pose its bones exactly
// as the source skeleton does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeAnimation, animationDependencies, describeAnimations, extractAnimations, DEFAULT_PREFIX } from '../src/spine/merge.js';
import { checkSkeleton } from '../src/spine/check.js';
import { fatalsOf, splitFatals } from '../src/spine/findings.js';
import { parseSkeleton, sampleAnimation, loadRuntime } from '../src/runtime/index.js';
import { SPINE } from './helpers/spine-addon.js';
import { compileSkeleton, attachmentWorldVertices } from '../src/engine/index.js';
import { isStudioError } from '../src/shared/errors.js';
import { main as cli, defaultOutput } from '../tools/merge-skeletons.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = rel => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', rel), 'utf8'));
const clone = o => structuredClone(o);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fatalCodes = sk => fatalsOf(checkSkeleton(sk)).map(f => `${f.code}@${f.where}`);
const throwsCode = (fn, code, rule) => assert.throws(fn, err => {
  assert.ok(isStudioError(err, code), `expected StudioError ${code}, got ${err.code ?? err.name}: ${err.message}`);
  if (rule) assert.equal(err.details.rule, rule);
  return true;
});

// ── synthetic: an animation carrying mesh + deform + event ──
const SOURCE = {
  skeleton: { hash: 's', spine: '4.2.43', x: 0, width: 100, height: 100, images: '', audio: '' },
  bones: [{ name: 'root' }, { name: 'b_flag', parent: 'root', x: 10 }],
  slots: [{ name: 'flag', bone: 'b_flag', attachment: 'flag', color: 'ff8040c0' }],
  skins: [{ name: 'default', attachments: { flag: {
    flag: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 2, 3, 0],
      vertices: [0, 0, 50, 0, 50, 50, 0, 50], hull: 4, width: 50, height: 50 },
    flag2: { width: 50, height: 50 },
  } } }],
  events: { wave: { int: 1 } },
  animations: { flutter: {
    slots: { flag: { attachment: [{ name: 'flag' }, { time: 0.5, name: 'flag2' }] } },
    bones: { b_flag: { rotate: [{ value: 0 }, { time: 1, value: 8 }] } },
    attachments: { default: { flag: { flag: { deform: [{ offset: 2, vertices: [3, 3] }, { time: 1 }] } } } },
    events: [{ time: 0.25, name: 'wave' }],
  } },
};
const TARGET = {
  skeleton: { hash: 't', spine: '4.2.00', x: 0, width: 200, height: 200, images: '', audio: '' },
  bones: [{ name: 'root' }, { name: 'camera', parent: 'root' }],
  slots: [{ name: 'ground', bone: 'root', attachment: 'ground' }],
  skins: [{ name: 'default', attachments: { ground: { ground: { width: 200, height: 50 } } } }],
  animations: { intro: { bones: { camera: { translate: [{ x: 0 }, { time: 2, x: 50 }] } } } },
};

// ── runtime cross-check helpers ──

// Every `time` in an animation's JSON, plus an even grid over its duration.
function sampleTimes(animation, duration) {
  const times = new Set([0, duration]);
  const walk = node => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      if (typeof node.time === 'number') times.add(node.time);
      Object.values(node).forEach(walk);
    }
  };
  walk(animation);
  for (let i = 1; i < 8; i++) times.add((duration * i) / 8);
  return [...times].filter(t => t >= 0 && t <= duration).sort((a, b) => a - b);
}

const LOCAL = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'];
const WORLD = ['worldX', 'worldY'];
const near = (a, b, label) => assert.ok(Math.abs(a - b) <= 1e-9, `${label}: source ${a}, merged ${b}`);

/**
 * The merged animation must pose every bone and slot it shares with the source exactly
 * as the source does. Bone locals always; world transforms when the whole parent chain
 * kept its setup (a retargeted ancestor legitimately moves the world). Slots (attachment
 * and colour) always, except a slot reused by retarget whose target definition differs:
 * there the target's setup wins by design. `sourceSkin` samples the source with that skin
 * active (the merge carries the source's first skin into the target's first skin).
 * @returns {Promise<number>} how many bone comparisons were made
 */
async function assertSamePoses(sourceJson, sourceAnim, mergedJson, report, { sourceSkin } = {}) {
  const boneMap = report.renamed.bones;
  const slotMap = report.renamed.slots;
  const mergedAnim = report.animation;
  const sourceData = await parseSkeleton(sourceJson);
  const mergedData = await parseSkeleton(mergedJson);
  const times = sampleTimes(sourceJson.animations[sourceAnim], sourceData.findAnimation(sourceAnim).duration);
  const [a, b] = await Promise.all([
    sampleAnimation(sourceData, sourceAnim, times, { skin: sourceSkin }), sampleAnimation(mergedData, mergedAnim, times)]);
  const sourceBone = new Map(sourceJson.bones.map(x => [x.name, x]));
  const mergedBone = new Map(mergedJson.bones.map(x => [x.name, x]));
  const nameIn = name => boneMap[name] ?? name;
  const withoutNames = bone => { const { name, parent, ...rest } = bone; return rest; };
  const chainKept = name => {
    for (let s = name; s; s = sourceBone.get(s).parent) {
      const m = mergedBone.get(nameIn(s));
      if (!m || !same(withoutNames(sourceBone.get(s)), withoutNames(m))) return false;
      if ((m.parent ?? null) !== (sourceBone.get(s).parent ? nameIn(sourceBone.get(s).parent) : null)) return false;
    }
    return true;
  };
  const sourceSlot = new Map((sourceJson.slots ?? []).map(x => [x.name, x]));
  const mergedSlot = new Map((mergedJson.slots ?? []).map(x => [x.name, x]));
  const slotIn = name => slotMap[name] ?? name;
  const slotDef = slot => { const { name, bone, ...rest } = slot; return rest; };
  const slotCompared = name => mergedSlot.has(slotIn(name))
    && !(report.slotsReused.includes(name) && !same(slotDef(sourceSlot.get(name)), slotDef(mergedSlot.get(name))));
  let compared = 0;
  times.forEach((t, i) => {
    for (const bone of a[i].bones) {
      const other = b[i].bones.find(x => x.name === nameIn(bone.name));
      if (!other) continue;
      for (const k of LOCAL) near(bone[k], other[k], `${sourceAnim} ${bone.name}.${k} at ${t}`);
      if (chainKept(bone.name)) {
        for (const k of WORLD) near(bone[k], other[k], `${sourceAnim} ${bone.name}.${k} at ${t}`);
        for (const k of ['a', 'b', 'c', 'd']) near(bone.matrix[k], other.matrix[k], `${sourceAnim} ${bone.name}.matrix.${k} at ${t}`);
      }
      compared++;
    }
    for (const slot of a[i].slots) {
      if (!slotCompared(slot.name)) continue;
      const other = b[i].slots.find(x => x.name === slotIn(slot.name));
      assert.equal(other.attachment, slot.attachment, `${sourceAnim} slot ${slot.name} attachment at ${t}`);
      for (const k of ['r', 'g', 'b', 'a']) near(slot.color[k], other.color[k], `${sourceAnim} slot ${slot.name} colour.${k} at ${t}`);
    }
  });
  assert.ok(compared > 0, 'the cross-check compared at least one bone');
  return compared;
}

// ── 1. synthetic ──

test('mesh + deform + event: the merged file passes the editor check and carries everything', async () => {
  const before = { target: clone(TARGET), source: clone(SOURCE) };
  const { skeleton: out, report } = mergeAnimation(TARGET, SOURCE, 'flutter');
  assert.deepEqual(fatalCodes(out), [], 'the merged file passes the editor check');
  assert.ok(out.animations.flutter, 'the animation arrived');
  assert.ok(out.events?.wave, 'the event definition was carried');
  const skin = out.skins[0].attachments;
  assert.ok(skin.flag?.flag && skin.flag?.flag2, 'the mesh and the attachment timeline art reached the skin');
  assert.ok(out.animations.flutter.attachments?.default?.flag?.flag, 'the deform timeline was kept and remapped');
  assert.equal(out.skeleton.spine, '4.2.43', 'the output version is the newer of the two');
  assert.deepEqual(report.warnings, [], 'no warnings');
  assert.deepEqual(report.bonesAdded, ['b_flag']);
  assert.deepEqual(report.bonesReused, ['root']);
  assert.deepEqual(report.slotsAdded, ['flag']);
  assert.equal(report.animation, 'flutter');
  assert.deepEqual({ target: TARGET, source: SOURCE }, before, 'neither input was modified');
  assert.deepEqual(out.animations.intro, TARGET.animations.intro, "the target's own animation is untouched");
  await assertSamePoses(SOURCE, 'flutter', out, report);
});

test('retarget clash: the target keeps its art and gains what the animation shows', async () => {
  const target = clone(TARGET);
  target.bones.push({ name: 'b_flag', parent: 'root' });
  target.slots.push({ name: 'flag', bone: 'b_flag', attachment: 'other' });
  target.skins[0].attachments.flag = { other: { width: 10, height: 10 } };
  const { skeleton: out, report } = mergeAnimation(target, SOURCE, 'flutter', { onConflict: 'retarget' });
  assert.deepEqual(fatalCodes(out), [], 'the retarget output passes the editor check');
  const art = out.skins[0].attachments.flag ?? {};
  assert.ok(art.other && art.flag && art.flag2, `target art kept, animation art completed: ${Object.keys(art)}`);
  assert.deepEqual(report.bonesReused.sort(), ['b_flag', 'root']);
  assert.deepEqual(report.slotsReused, ['flag']);
  assert.equal(out.slots.find(s => s.name === 'flag').attachment, 'other', "the target's setup attachment stays");

  // Target setup wins: the bone sits at the target's x, and the rotation keys (relative
  // to a setup rotation both files share) play unchanged.
  const merged = await parseSkeleton(out);
  const source = await parseSkeleton(SOURCE);
  const times = [0, 0.25, 0.5, 1];
  const [a, b] = await Promise.all([sampleAnimation(source, 'flutter', times), sampleAnimation(merged, 'flutter', times)]);
  times.forEach((t, i) => {
    const s = a[i].bones.find(x => x.name === 'b_flag');
    const m = b[i].bones.find(x => x.name === 'b_flag');
    near(s.rotation, m.rotation, `rotation at ${t}`);
    assert.equal(m.x, 0, "the target's setup x, not the source's");
    assert.equal(s.x, 10);
  });
});

test('rename: conflicting bones and slots arrive under the prefix; identical ones are shared', async () => {
  const target = clone(TARGET);
  target.bones.push({ name: 'b_flag', parent: 'root', x: -40 });
  target.slots.push({ name: 'flag', bone: 'b_flag', attachment: 'other' });
  target.skins[0].attachments.flag = { other: { width: 10, height: 10 } };
  const { skeleton: out, report } = mergeAnimation(target, SOURCE, 'flutter', { onConflict: 'rename' });
  assert.deepEqual(fatalCodes(out), []);
  const bone = `${DEFAULT_PREFIX}b_flag`;
  const slot = `${DEFAULT_PREFIX}flag`;
  assert.deepEqual(report.renamed.bones, { b_flag: bone });
  assert.deepEqual(report.renamed.slots, { flag: slot });
  assert.deepEqual(report.bonesReused, ['root'], 'the identical root is shared');
  assert.equal(out.slots.find(s => s.name === slot).bone, bone, 'the new slot hangs on the new bone');
  assert.ok(out.animations.flutter.bones[bone] && !out.animations.flutter.bones.b_flag, 'the timeline drives the new bone only');
  assert.ok(out.animations.flutter.slots[slot] && out.animations.flutter.attachments.default[slot]);
  assert.deepEqual(out.bones.find(b => b.name === 'b_flag'), target.bones.find(b => b.name === 'b_flag'), "the target's bone is untouched");
  assert.deepEqual(out.skins[0].attachments.flag, target.skins[0].attachments.flag, "the target's art is untouched");
  assert.ok(out.skins[0].attachments[slot]?.flag, 'the incoming art arrived under the new slot');
  await assertSamePoses(SOURCE, 'flutter', out, report);

  // A custom prefix, and a collision with an already prefixed name.
  target.bones.push({ name: 'x_b_flag', parent: 'root' });
  const custom = mergeAnimation(target, SOURCE, 'flutter', { onConflict: 'rename', prefix: 'x_', as: 'flutter_copy' });
  assert.equal(custom.report.renamed.bones.b_flag, 'x_b_flag_2');
  assert.equal(custom.report.animation, 'flutter_copy');
});

test('a deform under a skin name the target lacks is bound to the target first skin', async () => {
  // The editor (and the official parser) reject a deform timeline naming an unknown skin.
  const source = clone(SOURCE);
  source.skins[0].name = 'costume';
  source.animations.flutter.attachments = { costume: source.animations.flutter.attachments.default };
  const { skeleton: out, report } = mergeAnimation(TARGET, source, 'flutter');
  assert.deepEqual(Object.keys(out.animations.flutter.attachments), ['default']);
  await parseSkeleton(out);
  await assertSamePoses(source, 'flutter', out, report, { sourceSkin: 'costume' });
});

test('a slot keyed only by a deform timeline is a dependency', () => {
  const source = clone(SOURCE);
  delete source.animations.flutter.slots;
  assert.ok(animationDependencies(source, 'flutter').slots.has('flag'));
  const { skeleton: out, report } = mergeAnimation(TARGET, source, 'flutter');
  assert.deepEqual(report.slotsAdded, ['flag']);
  assert.deepEqual(fatalCodes(out), []);
});

test('rename: draw order keys follow the renamed slot, and different art is never shared', async () => {
  // Same slot definition, different art: in rename mode the slot is NOT shared, or the
  // incoming animation would show the target's art.
  const target = clone(TARGET);
  target.bones.push(clone(SOURCE.bones[1]));
  target.slots.push(clone(SOURCE.slots[0]));
  target.skins[0].attachments.flag = { flag: { width: 99, height: 99 } };
  const source = clone(SOURCE);
  source.animations.flutter.drawOrder = [{ time: 0.5, offsets: [{ slot: 'flag', offset: -1 }] }];
  const { skeleton: out, report } = mergeAnimation(target, source, 'flutter', { onConflict: 'rename' });
  const slot = `${DEFAULT_PREFIX}flag`;
  assert.deepEqual(report.renamed.slots, { flag: slot });
  assert.deepEqual(report.bonesReused.sort(), ['b_flag', 'root'], 'the identical bone is still shared');
  assert.deepEqual(out.skins[0].attachments.flag, target.skins[0].attachments.flag, "the target's art is untouched");
  assert.deepEqual(out.animations.flutter.drawOrder[0].offsets, [{ slot, offset: -1 }], "the key moves the incoming slot, not the target's");
  assert.deepEqual(fatalCodes(out), []);
  const data = await parseSkeleton(out);
  const [pose] = await sampleAnimation(data, 'flutter', [0.75]);
  assert.deepEqual(out.slots.map(s => s.name), ['ground', 'flag', slot]);
  assert.deepEqual(pose.drawOrder, ['ground', slot, 'flag'], 'the official runtime moves the incoming slot one place back');
});

test('an existing animation name gets a numbered suffix', () => {
  const target = clone(TARGET);
  target.animations.flutter = {};
  target.animations.flutter_2 = {};
  assert.equal(mergeAnimation(target, SOURCE, 'flutter').report.animation, 'flutter_3');
});

// ── 2. real files ──

test('real file: sample_intro merged onto a copy of itself under another name', async () => {
  const real = readJson('merge/sample_intro.json');
  const animation = Object.keys(real.animations)[0];
  const target = clone(real);
  delete target.animations[animation];
  const { skeleton: out, report } = mergeAnimation(target, real, animation, { as: `${animation}_copy` });
  assert.ok(out.animations[`${animation}_copy`], 'the animation arrived under the new name');
  assert.equal(report.animation, `${animation}_copy`);
  const { fresh, inherited } = splitFatals(checkSkeleton(target), checkSkeleton(out));
  assert.deepEqual(fresh, [], 'the merge introduced no fatal');
  // The fixture carries a known owner defect (a path vertexCount that is not a multiple of
  // 3). It is inherited from the base, and the official parser refuses base and merge
  // alike for that reason: the merge neither added nor hid it.
  assert.ok(inherited.some(f => f.code === 'path-vc3'));
  const refusal = async sk => { try { await parseSkeleton(sk); return null; } catch (err) { return err.code; } };
  assert.equal(await refusal(target), 'runtime-parse');
  assert.equal(await refusal(out), 'runtime-parse');
  assert.deepEqual(out.path, real.path, 'the path constraint was shared, not duplicated');
});

test('real file: every ident animation merged back into ident poses identically', async () => {
  const real = readJson('ident/ident.json');
  for (const animation of Object.keys(real.animations)) {
    const target = clone(real);
    delete target.animations[animation];
    const { skeleton: out, report } = mergeAnimation(target, real, animation, { as: `${animation}_copy` });
    assert.deepEqual(fatalCodes(out), [], animation);
    assert.deepEqual(report.bonesAdded, [], 'every bone is shared');
    const compared = await assertSamePoses(real, animation, out, report);
    assert.ok(compared >= real.bones.length);
  }
});

test('real file: every ident animation merged into another rig (nova) poses identically', async () => {
  const source = readJson('ident/ident.json');
  const target = readJson('nova/nova.json');
  for (const animation of Object.keys(source.animations)) {
    const { skeleton: out, report } = mergeAnimation(target, source, animation);
    assert.deepEqual(fatalCodes(out), [], animation);
    assert.ok(report.bonesAdded.length > 0, 'the source bones arrived');
    assert.ok(target.animations && Object.keys(target.animations).every(n => same(out.animations[n], target.animations[n])),
      "the target's own animations are untouched");
    await assertSamePoses(source, animation, out, report);
  }
});

// ── 3. extract (legacy extractAnimations) ──
// What matters is as much what it does NOT do as what it does: the rig is not touched.
// Pruning an unused bone is tempting, but the owner would open the file in Spine and
// find the rig pruned.
const EXTRACT_BASE = {
  skeleton: { spine: '4.2', hash: 'abc' },
  bones: [{ name: 'root' }, { name: 'a', parent: 'root' }, { name: 'unused', parent: 'root' }],
  slots: [{ name: 's', bone: 'a' }],
  skins: [{ name: 'default', attachments: { s: { img: { width: 4, height: 4 } } } }],
  ik: [{ name: 'ik1', bones: ['a'], target: 'root' }],
  animations: {
    one: { bones: { a: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 30 }] } } },
    two: { bones: { a: { translate: [{ time: 0, x: 0, y: 0 }] } } },
    three: { drawOrder: [{ time: 0, offsets: [] }] },
  },
};

test('extract keeps only the named animation and leaves the rig identical', () => {
  const base = clone(EXTRACT_BASE);
  const { skeleton, report } = extractAnimations(base, ['two']);
  assert.deepEqual(Object.keys(skeleton.animations), ['two'], 'only the requested animation stays');
  assert.deepEqual([...report.removed].sort(), ['one', 'three'], 'the removed ones are reported');
  assert.deepEqual(report.kept, ['two']);
  assert.equal(report.rigUntouched, true);
  // The rig stays as is: this is the tool's contract.
  for (const key of ['bones', 'slots', 'skins', 'ik', 'skeleton']) {
    assert.ok(same(skeleton[key], EXTRACT_BASE[key]), `${key} identical (the unused bone was not pruned)`);
  }
  assert.equal(Object.keys(base.animations).length, 3, 'the input skeleton is not modified');
  skeleton.animations.two.bones.a.translate[0].x = 999;
  assert.equal(base.animations.two.bones.a.translate[0].x, 0, 'deep copy: the output does not alias the input');
});

test('extract takes several names, and refuses an unknown name or an empty list', () => {
  assert.equal(Object.keys(extractAnimations(EXTRACT_BASE, ['one', 'three']).skeleton.animations).length, 2);
  throwsCode(() => extractAnimations(EXTRACT_BASE, ['no_such_animation']), 'unknown-animation');
  try { extractAnimations(EXTRACT_BASE, ['no_such_animation', 'one']); } catch (err) {
    assert.deepEqual(err.details.missing, ['no_such_animation']);
    assert.deepEqual(err.details.available, ['one', 'two', 'three']);
  }
  throwsCode(() => extractAnimations(EXTRACT_BASE, []), 'bad-argument');
  throwsCode(() => extractAnimations(EXTRACT_BASE), 'bad-argument');
});

// ── 4. constraint timelines follow a rename (legacy Y3) ──
// Renaming happens only on a collision, so the target already owns a constraint of that
// name. A timeline left under the old name drives the TARGET's constraint. No check
// catches that: anim-constraint fires only when the name is missing, and here it exists.
const chainBones = () => [{ name: 'root' }, { name: 'k1', parent: 'root', length: 50 },
  { name: 'k2', parent: 'k1', length: 50, x: 50 }, { name: 'goal', parent: 'root', x: 90, y: 40 }];
const chainSlots = () => [{ name: 's', bone: 'k2', attachment: 'g' }];
const chainSkins = () => [{ name: 'default', attachments: { s: { g: { width: 4, height: 4 } } } }];

// Which constraint does the parsed animation's ik timeline drive?
async function ikTimelineTargets(sk, animation) {
  const data = await parseSkeleton(sk, { backend: 'spine' });
  const spine = await loadRuntime();
  return data.findAnimation(animation).timelines
    .filter(t => t instanceof spine.IkConstraintTimeline)
    .map(t => data.ikConstraints[t.constraintIndex].name);
}

for (const kind of ['ik', 'transform', 'physics']) {
  test(`a renamed ${kind} constraint takes its timeline along`, async () => {
    const defs = {
      ik: [{ name: 'c1', bones: ['k1'], target: 'goal', mix: 0.25 }, { name: 'c1', bones: ['k1', 'k2'], target: 'goal', mix: 1, softness: 7 }],
      transform: [{ name: 'c1', bones: ['k2'], target: 'goal', mixRotate: 0.5 }, { name: 'c1', bones: ['k2'], target: 'goal', mixRotate: 1, mixX: 1 }],
      physics: [{ name: 'c1', bone: 'k2', x: 1 }, { name: 'c1', bone: 'k2', rotate: 1, inertia: 0.5 }],
    }[kind];
    const keys = { ik: [{ time: 0, mix: 0 }, { time: 1, mix: 1 }], transform: [{ time: 0, mixRotate: 0 }, { time: 1, mixRotate: 1 }],
      physics: [{ time: 0, mix: 0 }, { time: 1, mix: 1 }] }[kind];
    const target = { skeleton: { spine: '4.2', hash: 'h', images: './' }, bones: chainBones(), slots: chainSlots(), skins: chainSkins(),
      [kind]: [defs[0]], animations: {} };
    const source = { skeleton: { spine: '4.2', hash: 'k', images: './' }, bones: chainBones(), slots: chainSlots(), skins: chainSkins(),
      [kind]: [defs[1]], animations: { bend: { [kind]: { c1: keys } } } };
    const { skeleton: out, report } = mergeAnimation(target, source, 'bend');
    const renamed = report.renamed[kind].c1;
    assert.equal(renamed, `${DEFAULT_PREFIX}c1`, 'the colliding constraint was renamed');
    const timelines = out.animations[report.animation][kind] ?? {};
    assert.ok(timelines[renamed], 'the timeline moved to the new name');
    assert.ok(!timelines.c1, "and did not stay under the old one (it does not drive the target's constraint)");
    assert.deepEqual(fatalCodes(out), [], 'the result satisfies the Spine contract');
    assert.equal(out[kind].length, 2);
    await parseSkeleton(out);
    if (kind === 'ik' && SPINE) assert.deepEqual(await ikTimelineTargets(out, 'bend'), [renamed], 'the official runtime agrees');
  });
}

// ── 5. legacy bugs, fixed and pinned ──

test('an unknown conflict policy is refused, not treated as rename (legacy bug)', () => {
  throwsCode(() => mergeAnimation(TARGET, SOURCE, 'flutter', { onConflict: 'retaget' }), 'bad-argument');
});

test('a bone renamed in rename mode does not redirect a same-named constraint timeline (legacy bug)', async () => {
  // Bone "aim" collides and is renamed; ik "aim" is new to the target and keeps its name.
  // Legacy shared one rename map, so the ik timeline went to the bone's new name.
  const source = { skeleton: { spine: '4.2.43', hash: 's' },
    bones: [...chainBones(), { name: 'aim', parent: 'root', x: 5 }], slots: chainSlots(), skins: chainSkins(),
    ik: [{ name: 'aim', bones: ['k1', 'k2'], target: 'aim' }],
    animations: { point: { ik: { aim: [{ mix: 0 }, { time: 1, mix: 1 }] }, bones: { aim: { translate: [{ x: 0 }, { time: 1, x: 30 }] } } } } };
  const target = { skeleton: { spine: '4.2.43', hash: 't' },
    bones: [...chainBones(), { name: 'aim', parent: 'root', x: -5 }], slots: chainSlots(), skins: chainSkins(), animations: {} };
  const { skeleton: out, report } = mergeAnimation(target, source, 'point', { onConflict: 'rename' });
  assert.deepEqual(report.renamed.bones, { aim: `${DEFAULT_PREFIX}aim` });
  assert.deepEqual(report.renamed.ik, {});
  assert.ok(out.animations.point.ik.aim, 'the ik timeline still names the ik constraint');
  assert.equal(out.ik[0].target, `${DEFAULT_PREFIX}aim`, 'the constraint targets the renamed bone');
  assert.deepEqual(fatalCodes(out), []);
  if (SPINE) assert.deepEqual(await ikTimelineTargets(out, 'point'), ['aim']);
});

test('a constraint target is looked up as a bone, not as a same-named slot (legacy bug)', () => {
  // Slot "hand" collides and is renamed; the ik target is BONE "hand", shared.
  const bones = () => [{ name: 'root' }, { name: 'arm', parent: 'root', length: 20 }, { name: 'hand', parent: 'root', x: 30 }];
  const source = { skeleton: { spine: '4.2.43', hash: 's' }, bones: bones(),
    slots: [{ name: 'hand', bone: 'hand', attachment: 'h' }],
    skins: [{ name: 'default', attachments: { hand: { h: { width: 4, height: 4 } } } }],
    ik: [{ name: 'reach', bones: ['arm'], target: 'hand' }],
    animations: { grab: { ik: { reach: [{ mix: 0 }, { time: 1, mix: 1 }] }, slots: { hand: { rgba: [{ color: 'ffffffff' }] } } } } };
  const target = { skeleton: { spine: '4.2.43', hash: 't' }, bones: bones(),
    slots: [{ name: 'hand', bone: 'root', attachment: 'h' }],
    skins: [{ name: 'default', attachments: { hand: { h: { width: 9, height: 9 } } } }], animations: {} };
  const { skeleton: out, report } = mergeAnimation(target, source, 'grab', { onConflict: 'rename' });
  assert.deepEqual(report.renamed.slots, { hand: `${DEFAULT_PREFIX}hand` });
  assert.equal(out.ik[0].target, 'hand');
  assert.deepEqual(fatalCodes(out), []);
});

test('a renamed constraint never collides with an already prefixed one (legacy bug)', () => {
  const target = { skeleton: { spine: '4.2', hash: 'h' }, bones: chainBones(), slots: chainSlots(), skins: chainSkins(),
    ik: [{ name: 'c1', bones: ['k1'], target: 'goal' }, { name: `${DEFAULT_PREFIX}c1`, bones: ['k2'], target: 'goal', order: 1 }], animations: {} };
  const source = { skeleton: { spine: '4.2', hash: 'k' }, bones: chainBones(), slots: chainSlots(), skins: chainSkins(),
    ik: [{ name: 'c1', bones: ['k1', 'k2'], target: 'goal' }], animations: { bend: { ik: { c1: [{ mix: 1 }] } } } };
  const { skeleton: out, report } = mergeAnimation(target, source, 'bend');
  const names = out.ik.map(c => c.name);
  assert.equal(new Set(names).size, names.length, `constraint names are unique: ${names}`);
  assert.equal(report.renamed.ik.c1, `${DEFAULT_PREFIX}c1_2`);
  assert.equal(out.ik.at(-1).order, 2, 'appended after the target constraints');
  assert.ok(out.animations.bend.ik[`${DEFAULT_PREFIX}c1_2`]);
});

test('a parent chain deeper than 64 bones is carried whole (legacy bug)', async () => {
  const bones = [{ name: 'root' }];
  for (let i = 1; i <= 80; i++) bones.push({ name: `link${i}`, parent: i === 1 ? 'root' : `link${i - 1}`, x: 2, rotation: 1 });
  const source = { skeleton: { spine: '4.2.43', hash: 's' }, bones, animations: { sway: { bones: { link80: { rotate: [{ value: 0 }, { time: 1, value: 20 }] } } } } };
  const target = { skeleton: { spine: '4.2.43', hash: 't' }, bones: [{ name: 'root' }], animations: {} };
  assert.equal(animationDependencies(source, 'sway').bones.size, 81);
  const { skeleton: out, report } = mergeAnimation(target, source, 'sway');
  assert.equal(out.bones.length, 81);
  assert.deepEqual(fatalCodes(out), []);
  await assertSamePoses(source, 'sway', out, report);
});

// Source and target order their bones differently, so a weighted vertex index that is
// not remapped lands on the wrong bone. World vertices come from the official runtime.
const WEIGHTED_SOURCE = () => ({
  skeleton: { spine: '4.2.43', hash: 's' },
  bones: [{ name: 'root' }, { name: 'w1', parent: 'root', x: 40, rotation: 30 }, { name: 'w2', parent: 'root', y: -25, scaleX: 2 },
    { name: 'holder', parent: 'root' }],
  slots: [{ name: 'cloth', bone: 'holder', attachment: 'sheet' }],
  skins: [{ name: 'default', attachments: { cloth: {
    sheet: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], hull: 3, width: 10, height: 10,
      vertices: [1, 1, 0, 0, 1, 2, 1, 5, 0, 0.5, 2, 5, 0, 0.5, 1, 2, 0, 10, 1] },
    sheet2: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], hull: 3, width: 10, height: 10,
      vertices: [1, 2, 3, 3, 1, 1, 1, -4, 0, 1, 1, 1, 2, 2, 1] },
  } } }],
  animations: { swap: {
    slots: { cloth: { attachment: [{ name: 'sheet' }, { time: 0.5, name: 'sheet2' }] } },
    bones: { holder: { rotate: [{ value: 0 }, { time: 1, value: 15 }] } },
  } },
});

async function worldVertices(sk, slotName, attachmentName) {
  return attachmentWorldVertices(compileSkeleton(sk), slotName, attachmentName);
}

test('weighted mesh bones are dependencies and their indices are remapped (legacy bug)', async () => {
  const source = WEIGHTED_SOURCE();
  const target = { skeleton: { spine: '4.2.43', hash: 't' },
    bones: [{ name: 'root' }, { name: 'camera', parent: 'root', x: 999 }, { name: 'extra', parent: 'root', y: 777 }], animations: {} };
  assert.deepEqual(fatalCodes(source), []);
  const deps = animationDependencies(source, 'swap');
  assert.ok(deps.bones.has('w1') && deps.bones.has('w2'), 'the bones the mesh is weighted to are dependencies');
  const { skeleton: out, report } = mergeAnimation(target, source, 'swap');
  assert.deepEqual(fatalCodes(out), []);
  for (const name of ['sheet', 'sheet2']) {
    assert.deepEqual(await worldVertices(out, 'cloth', name), await worldVertices(source, 'cloth', name),
      `${name}: the merged mesh sits exactly where the source mesh does`);
  }
  await assertSamePoses(source, 'swap', out, report);
});

test('art filled into a retargeted slot is remapped too (legacy bug)', async () => {
  const source = WEIGHTED_SOURCE();
  // The target already has the slot and bones (retarget reuses them) but not sheet2.
  const target = { skeleton: { spine: '4.2.43', hash: 't' },
    bones: [{ name: 'root' }, { name: 'camera', parent: 'root', x: 999 }, ...source.bones.slice(1)],
    slots: clone(source.slots),
    skins: [{ name: 'default', attachments: { cloth: { sheet: clone(source.skins[0].attachments.cloth.sheet) } } }],
    animations: {} };
  // Target's sheet must use target indices: shift w1 (1 -> 2), w2 (2 -> 3).
  target.skins[0].attachments.cloth.sheet.vertices = [1, 2, 0, 0, 1, 2, 2, 5, 0, 0.5, 3, 5, 0, 0.5, 1, 3, 0, 10, 1];
  assert.deepEqual(fatalCodes(source), []);
  assert.deepEqual(fatalCodes(target), []);
  assert.deepEqual(await worldVertices(target, 'cloth', 'sheet'), await worldVertices(source, 'cloth', 'sheet'), 'the target art is equivalent');
  const { skeleton: out, report } = mergeAnimation(target, source, 'swap');
  assert.deepEqual(fatalCodes(out), []);
  assert.deepEqual(report.slotsReused, ['cloth']);
  assert.equal(report.attachmentsCopied, 1, 'sheet2 was filled in from the source');
  assert.deepEqual(await worldVertices(out, 'cloth', 'sheet2'), await worldVertices(source, 'cloth', 'sheet2'));
});

// ── 6. refusals ──

test('different Spine major.minor versions are refused', () => {
  const source = clone(SOURCE);
  source.skeleton.spine = '4.1.24';
  throwsCode(() => mergeAnimation(TARGET, source, 'flutter'), 'merge-version');
});

test('an unknown animation is refused with the available names', () => {
  try {
    mergeAnimation(TARGET, SOURCE, 'missing');
    assert.fail('expected a refusal');
  } catch (err) {
    assert.ok(isStudioError(err, 'unknown-animation'));
    assert.deepEqual(err.details.available, ['flutter']);
  }
});

test('the structural gate refuses what the editor would reject', () => {
  // The source fires an event it never defines: a warning, then the gate refuses.
  const noEvent = clone(SOURCE);
  delete noEvent.events;
  throwsCode(() => mergeAnimation(TARGET, noEvent, 'flutter'), 'merge-gate', 'anim-event');
  // The source animation keys a bone the source does not have.
  const ghostBone = clone(SOURCE);
  ghostBone.animations.flutter.bones.ghost = { rotate: [{ value: 1 }] };
  throwsCode(() => mergeAnimation(TARGET, ghostBone, 'flutter'), 'merge-gate', 'anim-bone');
  // A source slot hangs on a bone the source does not have.
  const orphanSlot = clone(SOURCE);
  orphanSlot.slots[0].bone = 'nowhere';
  throwsCode(() => mergeAnimation(TARGET, orphanSlot, 'flutter'), 'merge-gate', 'slot-bone');
  // A source bone names a parent the source does not have.
  const orphanBone = clone(SOURCE);
  orphanBone.bones[1].parent = 'lost';
  throwsCode(() => mergeAnimation(TARGET, orphanBone, 'flutter'), 'merge-gate', 'bone-order');
  // The animation keys a slot the source does not have.
  const ghostSlot = clone(SOURCE);
  ghostSlot.animations.flutter.slots.ghost = { rgba: [{ color: 'ffffffff' }] };
  throwsCode(() => mergeAnimation(TARGET, ghostSlot, 'flutter'), 'merge-gate', 'anim-slot');
  // A deform timeline names a slot the source does not have.
  const ghostDeform = clone(SOURCE);
  ghostDeform.animations.flutter.attachments.default.ghost = { g: { deform: [{}] } };
  throwsCode(() => mergeAnimation(TARGET, ghostDeform, 'flutter'), 'merge-gate', 'anim-deform-slot');
});

test('missing art is a warning with a stable code, not a refusal', () => {
  const source = clone(SOURCE);
  delete source.skins[0].attachments.flag;
  source.slots[0].attachment = null;
  delete source.animations.flutter.attachments;
  const { report } = mergeAnimation(TARGET, source, 'flutter');
  const codes = report.warnings.map(w => w.code).sort();
  assert.deepEqual(codes, ['attachment-missing', 'attachment-missing', 'slot-no-skin-entry']);
  for (const w of report.warnings) assert.equal(w.level, 'warn');
});

// ── 7. dependencies and the listing ──

test('dependencies cover deform slots, draw order, constraints, events and parent chains', () => {
  const sk = readJson('merge/sample_intro.json');
  const [name] = Object.keys(sk.animations);
  const deps = animationDependencies(sk, name);
  const animation = sk.animations[name];
  for (const slot of Object.keys(animation.slots ?? {})) assert.ok(deps.slots.has(slot));
  for (const key of animation.drawOrder ?? []) for (const o of key.offsets ?? []) assert.ok(deps.slots.has(o.slot));
  for (const c of Object.keys(animation.path ?? {})) {
    const def = sk.path.find(p => p.name === c);
    assert.ok(deps.constraints.some(x => x.def === def));
    assert.ok(deps.slots.has(def.target), 'a path constraint brings its target slot');
  }
  const boneBy = new Map(sk.bones.map(b => [b.name, b]));
  for (const bone of deps.bones) if (boneBy.get(bone).parent) assert.ok(deps.bones.has(boneBy.get(bone).parent), 'parents included');
  const flutter = animationDependencies(SOURCE, 'flutter');
  assert.deepEqual([...flutter.events], ['wave']);
  assert.deepEqual([...flutter.slots], ['flag']);
  assert.deepEqual(describeAnimations(SOURCE), [{ name: 'flutter', bones: 2, slots: 1, constraints: 0 }]);
});

test('object-format (3.x style) target skins are converted, not overwritten', () => {
  const target = clone(TARGET);
  target.skins = { default: { ground: { ground: { width: 200, height: 50 } } } };
  const { skeleton: out } = mergeAnimation(target, SOURCE, 'flutter');
  assert.ok(Array.isArray(out.skins));
  assert.ok(out.skins[0].attachments.ground.ground && out.skins[0].attachments.flag.flag);
});

// ── 8. the CLI ──

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-merge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const capture = () => { const lines = []; return { lines, io: { log: l => lines.push(l), error: l => lines.push(l) } }; };

test('CLI writes a new file beside the target and never writes the inputs', t => {
  const dir = tempDir(t);
  const targetPath = path.join(dir, 'target.json');
  const sourcePath = path.join(dir, 'source.json');
  fs.writeFileSync(targetPath, JSON.stringify(TARGET));
  fs.writeFileSync(sourcePath, JSON.stringify(SOURCE));
  const inputs = [fs.readFileSync(targetPath), fs.readFileSync(sourcePath)];
  const { lines, io } = capture();
  assert.equal(cli([targetPath, sourcePath, 'flutter'], io), 0, lines.join('\n'));
  const output = defaultOutput(targetPath);
  assert.equal(output, path.join(dir, 'target_merged.json'));
  const merged = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.ok(merged.animations.flutter);
  assert.deepEqual(merged, mergeAnimation(TARGET, SOURCE, 'flutter').skeleton);
  assert.ok(fs.readFileSync(targetPath).equals(inputs[0]) && fs.readFileSync(sourcePath).equals(inputs[1]), 'inputs untouched');
  assert.ok(lines.some(l => l.includes('bones +1')));

  // A second run keeps the previous output as .bak.
  const first = fs.readFileSync(output);
  assert.equal(cli([targetPath, sourcePath, 'flutter'], capture().io), 0);
  assert.ok(fs.readFileSync(output + '.bak').equals(first));
});

test('CLI refuses an output that is an input, missing arguments and a failed merge', t => {
  const dir = tempDir(t);
  const targetPath = path.join(dir, 'target.json');
  const sourcePath = path.join(dir, 'source.json');
  fs.writeFileSync(targetPath, JSON.stringify(TARGET));
  fs.writeFileSync(sourcePath, JSON.stringify(SOURCE));
  const before = fs.readFileSync(targetPath);
  let c = capture();
  assert.equal(cli([targetPath, sourcePath, 'flutter', targetPath], c.io), 1);
  assert.match(c.lines.join('\n'), /inputs are never written/);
  assert.equal(cli([targetPath, sourcePath, 'flutter', sourcePath], capture().io), 1);
  assert.ok(fs.readFileSync(targetPath).equals(before), 'the target was not written');
  assert.ok(!fs.existsSync(targetPath + '.bak'), 'not even backed up for an overwrite');
  c = capture();
  assert.equal(cli([targetPath, sourcePath], c.io), 1);
  assert.match(c.lines[0], /^usage:/);
  c = capture();
  assert.equal(cli([targetPath, sourcePath, 'missing'], c.io), 1);
  assert.match(c.lines[0], /unknown-animation/);
  assert.ok(!fs.existsSync(defaultOutput(targetPath)), 'nothing written on a refusal');
});

test('CLI runs as a script', t => {
  const dir = tempDir(t);
  const targetPath = path.join(dir, 'target.json');
  const sourcePath = path.join(dir, 'source.json');
  const outputPath = path.join(dir, 'out.json');
  fs.writeFileSync(targetPath, JSON.stringify(TARGET));
  fs.writeFileSync(sourcePath, JSON.stringify(SOURCE));
  const script = path.join(HERE, '..', 'tools', 'merge-skeletons.js');
  const ok = spawnSync(process.execPath, [script, targetPath, sourcePath, 'flutter', outputPath], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /written:/);
  assert.ok(JSON.parse(fs.readFileSync(outputPath, 'utf8')).animations.flutter);
  const bad = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /usage:/);
});
