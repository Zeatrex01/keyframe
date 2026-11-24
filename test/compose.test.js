// Gate for src/deliver/compose.js — the one-way rule in code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { composeDelivery, DELIVERY_MARKER } from '../src/deliver/compose.js';
import { parseSkeleton, sampleAnimation } from '../src/runtime/index.js';
import { signature } from '../src/spine/weights.js';
import { REPAIR_MARKER, LEGACY_REPAIR_MARKER } from '../src/spine/weight-repair.js';
import { LEGACY_MARKER_FIELDS } from '../src/shared/legacy-names.js';
import { isStudioError } from '../src/shared/errors.js';

const readFixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}/${name}.json`, import.meta.url), 'utf8'));
const rig = () => ({
  skeleton: { spine: '4.2.43', hash: 'base-1' },
  bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }, { name: 'leg', parent: 'root' }],
  slots: [{ name: 's', bone: 'arm', attachment: 'img' }],
  skins: [{ name: 'default', attachments: { s: { img: { width: 10, height: 10 } } } }],
  animations: { idle: { bones: { arm: { rotate: [{ value: 5 }] } } } },
});
const wave = { bones: { arm: { rotate: [{ value: 0 }, { time: 1, value: 45 }] } } };

test('the base is never mutated and the delivery carries the base plus the written clip', async () => {
  const base = rig();
  const before = JSON.stringify(base);
  const { skeleton, report } = await composeDelivery({ base, name: 'wave', animation: wave, deliveryInfo: { base: 'hero.json' } });
  assert.equal(JSON.stringify(base), before);
  assert.deepEqual(Object.keys(skeleton.animations), ['idle', 'wave']);
  assert.deepEqual(skeleton.bones, base.bones);
  assert.deepEqual(skeleton[DELIVERY_MARKER], { base: 'hero.json', baseHash: 'base-1' });
  assert.deepEqual(report.changes, { added: ['wave'], changed: [], removed: [] });
});

test('accumulation: a second clip keeps the first, a second bone keeps the first bone', async () => {
  const base = rig();
  const first = await composeDelivery({ base, name: 'wave', animation: wave });
  const second = await composeDelivery({ base, previous: first.skeleton, name: 'kick', animation: { bones: { leg: { rotate: [{ value: 10 }] } } } });
  assert.deepEqual(second.skeleton.animations.wave, first.skeleton.animations.wave);
  assert.deepEqual(second.report.carriedClips, ['wave']);
  const third = await composeDelivery({ base, previous: second.skeleton, name: 'wave', animation: { bones: { leg: { translate: [{ x: 1, y: 0 }] } } } });
  assert.ok(third.skeleton.animations.wave.bones.arm, 'arm keys from the first call survive');
  assert.ok(third.skeleton.animations.wave.bones.leg);
  assert.deepEqual(third.report.carriedInClip, ['bones:arm']);
  const reset = await composeDelivery({ base, previous: third.skeleton, name: 'wave', animation: { bones: { leg: { translate: [{ x: 2, y: 0 }] } } }, replace: true });
  assert.equal(reset.skeleton.animations.wave.bones.arm, undefined, 'replace rebuilds the clip from the base');
  assert.equal(reset.report.replacedFromBase, true);
});

test('the base clip of the same name is the floor: unwritten channels of the owner clip survive', async () => {
  const base = rig();
  const { skeleton } = await composeDelivery({ base, name: 'idle', animation: { bones: { leg: { rotate: [{ value: 3 }] } } } });
  assert.deepEqual(skeleton.animations.idle.bones.arm, base.animations.idle.bones.arm);
  assert.ok(skeleton.animations.idle.bones.leg);
});

test('a clip keying a bone the base does not have is refused and nothing is produced', async () => {
  await assert.rejects(
    composeDelivery({ base: rig(), name: 'bad', animation: { bones: { ghost: { rotate: [{ value: 1 }] } } } }),
    err => isStudioError(err, 'delivery-refused') && err.details.findings.some(f => f.code === 'anim-bone'));
  await assert.rejects(composeDelivery({ base: rig(), name: '', animation: wave }), err => isStudioError(err, 'bad-argument'));
  await assert.rejects(composeDelivery({ base: rig(), name: 'x', animation: { bones: { arm: { spin: [] } } } }), err => isStudioError(err, 'bad-animation'));
});

test('an inherited defect is reported, not refused: the studio does not own the rig', async () => {
  const base = rig();
  delete base.skeleton.hash; // fatal for Unity, already in the base
  const { report } = await composeDelivery({ base, name: 'wave', animation: wave });
  assert.ok(report.inheritedFatals.some(f => f.code === 'no-hash'));
});

test('the delivery plays the written clip engine-exactly, held from t=0', async () => {
  const reveal = { slots: { s: { alpha: [{ time: 0.5, value: 0 }, { time: 1, value: 1 }] } } };
  const { skeleton, report } = await composeDelivery({ base: rig(), name: 'reveal', animation: reveal });
  assert.deepEqual(report.held, ['slots/s/alpha']);
  const [early] = await sampleAnimation(await parseSkeleton(skeleton), 'reveal', [0.2]);
  assert.equal(early.slots[0].color.a, 0);
});

function weightedRig(vertices) {
  const base = rig();
  base.skins[0].attachments.s.m = { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], hull: 3, width: 10, height: 10, vertices };
  base.slots.push({ name: 'm', bone: 'arm' });
  base.skins[0].attachments.m = { m: base.skins[0].attachments.s.m };
  delete base.skins[0].attachments.s.m;
  return base;
}
const ORIGINAL = [1, 1, 0, 0, 1, 1, 1, 10, 0, 1, 1, 1, 0, 10, 1];
const REPAIRED = [2, 1, 0, 0, 0.5, 2, 0, 0, 0.5, 1, 1, 10, 0, 1, 1, 1, 0, 10, 1];

test('a weight repair travels while the base mesh is unchanged; the base wins once the owner edits it', async () => {
  const base = weightedRig(ORIGINAL);
  const previous = structuredClone(base);
  previous.skins[0].attachments.m.m.vertices = REPAIRED;
  previous[REPAIR_MARKER] = { 'm/m': { baseSignature: signature(ORIGINAL), operation: 'transfer' } };
  const kept = await composeDelivery({ base, previous, name: 'wave', animation: wave });
  assert.deepEqual(kept.skeleton.skins[0].attachments.m.m.vertices, REPAIRED);
  assert.deepEqual(kept.report.weightRepairs.kept, ['m/m']);
  assert.ok(kept.skeleton[REPAIR_MARKER]['m/m']);

  const edited = weightedRig([1, 1, 0, 0, 1, 1, 1, 12, 0, 1, 1, 1, 0, 12, 1]);
  const won = await composeDelivery({ base: edited, previous, name: 'wave', animation: wave });
  assert.deepEqual(won.skeleton.skins[0].attachments.m.m.vertices, edited.skins[0].attachments.m.m.vertices);
  assert.deepEqual(won.report.weightRepairs.dropped, [{ mesh: 'm/m', reason: 'base-changed' }]);
  assert.equal(won.skeleton[REPAIR_MARKER], undefined);
});

test('a legacy weight marker is read and rewritten under the English name', async () => {
  const base = weightedRig(ORIGINAL);
  const previous = structuredClone(base);
  previous.skins[0].attachments.m.m.vertices = REPAIRED;
  previous[LEGACY_REPAIR_MARKER] = { 'm/m': { [LEGACY_MARKER_FIELDS.baseSignature]: signature(ORIGINAL) } };
  const { skeleton } = await composeDelivery({ base, previous, name: 'wave', animation: wave });
  assert.ok(skeleton[REPAIR_MARKER]['m/m']);
  assert.equal(skeleton[LEGACY_REPAIR_MARKER], undefined);
});

test('markers of features this tree does not carry are named when dropped', async () => {
  const base = rig();
  const previous = { ...structuredClone(base), _kfRig: { bones: [] }, _kfLiked: ['idle'] };
  const { skeleton, report } = await composeDelivery({ base, previous, name: 'wave', animation: wave });
  assert.deepEqual(report.droppedMarkers, ['_kfRig', '_kfLiked']);
  assert.equal(skeleton._kfRig, undefined);
});

test('a real fixture composes, parses and keeps every owner clip byte for byte', async () => {
  const base = readFixture('ident');
  const { skeleton } = await composeDelivery({ base, name: 'extra', animation: { bones: { [base.bones[1].name]: { rotate: [{ value: 0 }, { time: 1, value: 10, curve: 'easeOut' }] } } } });
  for (const [name, clip] of Object.entries(base.animations)) assert.deepEqual(skeleton.animations[name], clip, name);
  await parseSkeleton(skeleton);
});

test('a base that carries weight markers of its own keeps them untouched', async () => {
  const base = weightedRig(ORIGINAL);
  base[LEGACY_REPAIR_MARKER] = { 'm/m': { [LEGACY_MARKER_FIELDS.baseSignature]: 'owner-stamp' } };
  base[REPAIR_MARKER] = { 'x/y': { baseSignature: 'other' } };
  const plain = await composeDelivery({ base, previous: structuredClone(base), name: 'wave', animation: wave });
  assert.deepEqual(plain.skeleton[LEGACY_REPAIR_MARKER], base[LEGACY_REPAIR_MARKER]);
  assert.deepEqual(plain.skeleton[REPAIR_MARKER], base[REPAIR_MARKER]);
});
