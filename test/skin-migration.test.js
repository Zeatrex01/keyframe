// Gate for src/spine/skin-migration.js: folding duplicated look-variant clips (same
// motion, only the attachment differs) into named skins plus one shared clip.
// Ported from legacy test_migrate_swap_to_skin.js. Pins the straight case, the refusals
// (missing art, in-clip swap), that a drifted motion still gets its skin but keeps its
// clip, that a resulting skin stays partial, the split mode for shipped rigs, and a pass
// over a reproduction of the owner's Chest_Export rig, whose Gold clip carries a physics
// curve drifted a few thousandths of a second from Bronze's.
//
// The legacy module "verified itself" by re-deriving the JSON it had just written. Here
// every migrated output is proved against the official spine-ts 4.2 runtime instead: each
// original clip, sampled at every key time (and between keys), must show the same slot
// attachments (same region, same data), slot colours, draw order and bone poses as the
// surviving clip sampled with that variant's skin active. Every output also runs through
// checkSkeleton and may add no fatal the input did not already have (the legacy checker
// once missed a duplicate skin this module produced).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scan, migrate, splitLooks, verify } from '../src/spine/skin-migration.js';
import { checkSkeleton } from '../src/spine/check.js';
import { splitFatals, describe } from '../src/spine/findings.js';
import { parseSkeleton, sampleAnimation } from '../src/runtime/index.js';
import { isStudioError } from '../src/shared/errors.js';

const clone = o => structuredClone(o);
const sortedKeys = o => Object.keys(o).sort().join(',');
const codes = list => list.map(x => x.code);

// ── the proofs every migrated output must pass ─────────────────────────────────────

function assertNoFreshFatals(before, after) {
  const { fresh } = splitFatals(checkSkeleton(before), checkSkeleton(after));
  assert.deepEqual(fresh, [], `fresh fatals: ${describe(fresh).join(' | ')}`);
}

// Every key time of a clip (a key without `time` is at 0), the midpoints between them,
// and a moment after the last key.
function sampleTimes(...clips) {
  const times = new Set([0]);
  const walk = node => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object' && !Array.isArray(item)) times.add(item.time ?? 0);
        walk(item);
      }
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value);
    }
  };
  clips.forEach(walk);
  const keys = [...times].sort((a, b) => a - b);
  const mids = keys.slice(1).map((t, i) => (keys[i] + t) / 2);
  return [...keys, ...mids, keys[keys.length - 1] + 0.25];
}

// What an attachment looks like, independent of the key it sits under: its type, its region
// and its geometry, as the studio's engine compiled it. The snapshot names the attachment; it is
// resolved the way every runtime resolves it, active skin first, then the default skin.
function lookOf(data, skinName, slotName, attachmentName) {
  if (attachmentName === null) return null;
  const { model } = data;
  const slotIndex = model.slotIndex.get(slotName);
  const tables = [skinName ? model.skins.get(skinName) : null, model.defaultSkin].filter(Boolean);
  for (const table of tables) {
    const att = table.get(slotIndex)?.get(attachmentName);
    if (!att) continue;
    const look = {};
    for (const [field, value] of Object.entries(att)) {
      if (field === 'name' || value === undefined || value === null) continue;
      look[field] = ArrayBuffer.isView(value) ? Array.from(value) : value;
    }
    return JSON.parse(JSON.stringify(look));
  }
  assert.fail(`attachment "${attachmentName}" on slot ${slotName} resolves in no skin`);
}

/**
 * For each case: the original clip in `before` (no skin) against the migrated clip in
 * `after` with `skin` active. `motionFrom` names the clip whose bone poses the migrated
 * clip must reproduce (default: the original; a clip collapsed under allowMotionDrift
 * plays the base's motion by design).
 */
async function provePicture(before, after, cases) {
  const beforeData = await parseSkeleton(before, { backend: 'keyframe' });
  const afterData = await parseSkeleton(after, { backend: 'keyframe' });
  for (const { original, migrated, skin, motionFrom = original } of cases) {
    const label = `${original} -> ${migrated}${skin ? ` [${skin}]` : ''}`;
    const times = sampleTimes(before.animations[original], after.animations[migrated]);
    const was = await sampleAnimation(beforeData, original, times);
    const now = await sampleAnimation(afterData, migrated, times, { skin });
    const motion = motionFrom === original ? was : await sampleAnimation(beforeData, motionFrom, times);
    times.forEach((time, i) => {
      const at = `${label} at ${time}`;
      assert.deepEqual(now[i].drawOrder, was[i].drawOrder, `${at}: draw order`);
      assert.equal(now[i].slots.length, was[i].slots.length, `${at}: slot count`);
      was[i].slots.forEach((slot, s) => {
        const other = now[i].slots[s];
        assert.deepEqual(lookOf(afterData, skin, other.name, other.attachment), lookOf(beforeData, null, slot.name, slot.attachment),
          `${at}: slot ${slot.name} shows a different attachment (${slot.attachment} before, ${other.attachment} after)`);
        assert.deepEqual(other.color, slot.color, `${at}: slot ${slot.name} colour`);
      });
      assert.deepEqual(now[i].bones, motion[i].bones, `${at}: bone poses`);
    });
  }
}

// ── synthetic base skeleton: one motion, three colour variants (legacy shape) ──────

function baseSkeleton() {
  return {
    skeleton: { spine: '4.2.43', hash: 'h', images: './' },
    bones: [{ name: 'root' }, { name: 'lid', parent: 'root' }],
    slots: [{ name: 'body', bone: 'lid', attachment: 'Bronze_body' }],
    skins: [{ name: 'default', attachments: { body: {
      Bronze_body: { type: 'mesh', width: 10, height: 10, uvs: [0, 0], vertices: [0, 0], triangles: [] },
      Gold_body: { type: 'mesh', width: 10, height: 10, uvs: [0, 0], vertices: [0, 0], triangles: [] },
      Silver_body: { type: 'mesh', width: 10, height: 10, uvs: [0, 0], vertices: [0, 0], triangles: [] },
    } } }],
    animations: {
      Bronze_Chest: { bones: { lid: { rotate: [{ value: 0 }, { time: 1, value: -8 }] } } },
      Gold_Chest: {
        bones: { lid: { rotate: [{ value: 0 }, { time: 1, value: -8 }] } },
        slots: { body: { attachment: [{ name: 'Gold_body' }] } },
      },
      Silver_Chest: {
        bones: { lid: { rotate: [{ value: 0 }, { time: 1, value: -8 }] } },
        slots: { body: { attachment: [{ name: 'Silver_body' }] } },
      },
    },
  };
}
const GOLD_SILVER = [{ base: 'Bronze_Chest', variants: [
  { animation: 'Gold_Chest', skinName: 'Gold' },
  { animation: 'Silver_Chest', skinName: 'Silver' },
] }];
const GOLD_ONLY = [{ base: 'Bronze_Chest', variants: [{ animation: 'Gold_Chest', skinName: 'Gold' }] }];

// ── 1. the straight case ───────────────────────────────────────────────────────────

test('straight case: three clips become one clip and two partial skins', async () => {
  const sk = baseSkeleton();
  const r = migrate(sk, GOLD_SILVER);
  assert.ok(r.changed, 'reports a change');
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(Object.keys(r.skeleton.animations), ['Bronze_Chest'], 'one surviving clip, under the base name');
  assert.equal(r.skeleton.animations.Bronze_Chest.slots?.body?.attachment, undefined, 'the survivor has no attachment timeline');
  assert.deepEqual(r.skeleton.skins.map(s => s.name), ['default', 'Gold', 'Silver']);
  const gold = r.skeleton.skins.find(s => s.name === 'Gold');
  assert.deepEqual(Object.keys(gold.attachments), ['body'], 'the skin carries only the slot it overrides, not a copy of default');
  // Under the setup key, not "Gold_body": that is what the runtime asks for once no
  // attachment timeline names anything else.
  assert.deepEqual(Object.keys(gold.attachments.body), ['Bronze_body']);
  assert.equal(gold.attachments.body.Bronze_body.path, 'Gold_body', 'the relocated attachment keeps pointing at its own region');
  assert.deepEqual(r.report.find(x => x.clip), { clip: 'Bronze_Chest', collapsedFrom: ['Bronze_Chest', 'Gold_Chest', 'Silver_Chest'] });
  assert.deepEqual(r.report.find(x => x.skin === 'Gold'), { skin: 'Gold', from: 'Gold_Chest', slots: ['body'] });

  assertNoFreshFatals(sk, r.skeleton);
  assert.deepEqual(verify(sk, r.skeleton, GOLD_SILVER), { ok: true, problems: [] });
  await provePicture(sk, r.skeleton, [
    { original: 'Bronze_Chest', migrated: 'Bronze_Chest' },
    { original: 'Gold_Chest', migrated: 'Bronze_Chest', skin: 'Gold' },
    { original: 'Silver_Chest', migrated: 'Bronze_Chest', skin: 'Silver' },
  ]);
  assert.deepEqual(sk, baseSkeleton(), 'migrate() does not mutate its input');
});

test('the surviving clip can take a new name', async () => {
  const sk = baseSkeleton();
  const r = migrate(sk, [{ ...GOLD_SILVER[0], animation: 'Chest' }]);
  assert.deepEqual(Object.keys(r.skeleton.animations), ['Chest']);
  await provePicture(sk, r.skeleton, [{ original: 'Gold_Chest', migrated: 'Chest', skin: 'Gold' }]);
});

// ── 1b. two variants in one group claiming the same skin name ──────────────────────
// Real shape: one look spans several clips ("Gold_Open" and "Gold_Idle" both wanting a
// "Gold" skin). The legacy module recorded the name only after the whole group had
// validated, so both passed and the file got two skins named "Gold": accepted silently by
// spine-ts, refused by the Spine editor.

test('two variants in one group claiming one skin name are refused, not duplicated', () => {
  const sk = baseSkeleton();
  sk.animations.Gold_Chest_2 = clone(sk.animations.Gold_Chest);
  const r = migrate(sk, [{ base: 'Bronze_Chest', variants: [
    { animation: 'Gold_Chest', skinName: 'Gold' },
    { animation: 'Gold_Chest_2', skinName: 'Gold' },
  ] }]);
  assert.equal(r.changed, false);
  assert.deepEqual(codes(r.skipped), ['skin-claimed-in-group']);
  assert.equal(r.skipped[0].params.skin, 'Gold');
  assert.equal(Object.keys(sk.animations).length, 4, 'nothing removed on refusal');
  assert.deepEqual(r.skeleton.skins.map(s => s.name), ['default']);
});

test('a later group may not reuse a skin name an earlier group built', () => {
  const sk = baseSkeleton();
  const r = migrate(sk, [
    { base: 'Bronze_Chest', variants: [{ animation: 'Gold_Chest', skinName: 'Gold' }] },
    { base: 'Bronze_Chest', variants: [{ animation: 'Silver_Chest', skinName: 'Gold' }] },
  ]);
  assert.equal(r.skeleton.skins.filter(s => s.name === 'Gold').length, 1, 'cross-group reuse refuses');
  assert.deepEqual(codes(r.skipped), ['skin-exists'], 'and is reported');
  assert.equal(r.skipped[0].params.skin, 'Gold');
  assert.ok(r.skeleton.animations.Silver_Chest, 'the refused group keeps its clip');
});

// ── 2. refusal: the picked attachment is not in the default skin ───────────────────

test('a pick that would need new art refuses the group and changes nothing', () => {
  const sk = baseSkeleton();
  sk.animations.Gold_Chest.slots.body.attachment = [{ name: 'Platinum_body' }];
  const r = migrate(sk, GOLD_ONLY);
  assert.equal(r.changed, false);
  assert.deepEqual(codes(r.skipped), ['art-missing']);
  assert.deepEqual(r.skipped[0].params, { animation: 'Gold_Chest', slot: 'body', attachment: 'Platinum_body' });
  assert.equal(Object.keys(r.skeleton.animations).length, 3, 'no clip removed on refusal');
});

// ── 3. drifted motion: the skin is still built, only the clip survives ─────────────
// The first legacy version refused both and left the file half-migrated: a leftover clip
// whose attachment timeline overrides the active skin. A skin never needed the motions to
// match; only discarding a clip does.

test('a drifted motion still gets its skin, keeps its clip, and says why', async () => {
  const sk = baseSkeleton();
  sk.animations.Gold_Chest.bones.lid.rotate[1].value = -9; // one degree off from Bronze
  const r = migrate(sk, GOLD_ONLY);
  assert.ok(r.changed);
  assert.ok(r.skeleton.skins.some(s => s.name === 'Gold'), 'Gold skin built despite the drift');
  assert.ok(r.skeleton.animations.Gold_Chest, 'the drifted clip is kept');
  assert.deepEqual(r.skeleton.animations.Gold_Chest, sk.animations.Gold_Chest, 'and kept unchanged');
  const kept = r.report.find(x => x.clipKept === 'Gold_Chest');
  assert.equal(kept?.code, 'motion-drift', 'the kept clip is reported with the skin-override consequence');
  assertNoFreshFatals(sk, r.skeleton);
  await provePicture(sk, r.skeleton, [
    { original: 'Gold_Chest', migrated: 'Gold_Chest', skin: 'Gold' },
    { original: 'Bronze_Chest', migrated: 'Bronze_Chest' },
  ]);
});

test('allowMotionDrift collapses the drifted clip and names the lost motion', async () => {
  const sk = baseSkeleton();
  sk.animations.Gold_Chest.bones.lid.rotate[1].value = -9;
  const r = migrate(sk, GOLD_ONLY, { allowMotionDrift: true });
  // Silver_Chest is not in this group, so it stays; Gold_Chest must go.
  assert.deepEqual(sortedKeys(r.skeleton.animations), 'Bronze_Chest,Silver_Chest');
  assert.deepEqual(r.report.filter(x => x.code === 'motion-discarded').map(x => x.motionDiscarded), ['Gold_Chest']);
  assert.equal(r.report.some(x => x.clipKept), false);
  await provePicture(sk, r.skeleton, [{ original: 'Gold_Chest', migrated: 'Bronze_Chest', skin: 'Gold', motionFrom: 'Bronze_Chest' }]);
});

test('key order inside a clip is not drift', async () => {
  const sk = baseSkeleton();
  sk.animations.Silver_Chest.bones.lid.rotate = [{ value: 0 }, { value: -8, time: 1 }];
  const r = migrate(sk, GOLD_SILVER);
  assert.deepEqual(Object.keys(r.skeleton.animations), ['Bronze_Chest']);
  assert.equal(r.report.some(x => x.clipKept), false);
  await provePicture(sk, r.skeleton, [{ original: 'Silver_Chest', migrated: 'Bronze_Chest', skin: 'Silver' }]);
});

// ── 4. refusal: one slot shows more than one attachment in a single clip ───────────

test('an in-clip swap (blink, icon change) is flagged by scan and refused by migrate', () => {
  const sk = baseSkeleton();
  sk.animations.Gold_Chest.slots.body.attachment = [{ name: 'Gold_body' }, { time: 0.5, name: 'Bronze_body' }];
  const scanned = scan(sk);
  assert.deepEqual(scanned.report.map(x => [x.animation, x.code]), [['Gold_Chest', 'in-clip-swap']]);
  assert.ok(scanned.groups.every(g => g.base !== 'Gold_Chest' && g.variants.every(v => v.animation !== 'Gold_Chest')),
    'scan does not group it');
  const r = migrate(sk, GOLD_ONLY);
  assert.equal(r.changed, false);
  assert.deepEqual(codes(r.skipped), ['in-clip-swap']);
});

// ── 5. a drifted variant does not cost its clean sibling anything ──────────────────

test('mixed group: the clean variant collapses, the drifted one keeps its clip', async () => {
  const sk = baseSkeleton();
  sk.animations.Gold_Chest.bones.lid.rotate[1].value = -9;
  const r = migrate(sk, GOLD_SILVER);
  assert.deepEqual(r.skeleton.skins.map(s => s.name), ['default', 'Gold', 'Silver'], 'both skins built');
  assert.equal(sortedKeys(r.skeleton.animations), 'Bronze_Chest,Gold_Chest', 'Silver folded away, the drifted Gold clip remains');
  assert.equal(Object.keys(sk.animations).length, 3, 'input untouched');
  await provePicture(sk, r.skeleton, [
    { original: 'Silver_Chest', migrated: 'Bronze_Chest', skin: 'Silver' },
    { original: 'Gold_Chest', migrated: 'Gold_Chest', skin: 'Gold' },
  ]);
});

// ── legacy bugs: each of these changed the picture or the file silently ────────────

test('a base with an in-clip swap is refused: stripping it would delete the swap', () => {
  const sk = baseSkeleton();
  sk.animations.Bronze_Chest.slots = { body: { attachment: [{ name: 'Bronze_body' }, { time: 0.5, name: 'Gold_body' }] } };
  const r = migrate(sk, GOLD_ONLY);
  assert.equal(r.changed, false);
  assert.deepEqual(codes(r.skipped), ['in-clip-swap']);
  assert.equal(r.skipped[0].params.animation, 'Bronze_Chest');
});

test('a base that does not show the setup look is refused: the shared clip would lose it', () => {
  const sk = baseSkeleton();
  sk.animations.Bronze_Chest.slots = { body: { attachment: [{ name: 'Silver_body' }] } };
  const r = migrate(sk, GOLD_ONLY);
  assert.deepEqual(codes(r.skipped), ['base-not-setup']);
  assert.deepEqual(r.skipped[0].params, { animation: 'Bronze_Chest', slot: 'body', attachment: 'Silver_body' });
  // A base whose picks equal the setup attachment is fine.
  const ok = baseSkeleton();
  ok.animations.Bronze_Chest.slots = { body: { attachment: [{ name: 'Bronze_body' }] } };
  const r2 = migrate(ok, GOLD_ONLY);
  assert.deepEqual(r2.skipped, []);
  assert.equal(r2.skeleton.animations.Bronze_Chest.slots, undefined, 'its setup-look timeline is stripped');
});

test('a pick that starts after t=0 is refused: before it the clip shows the setup look', async () => {
  const sk = baseSkeleton();
  sk.animations.Gold_Chest.slots.body.attachment = [{ time: 0.5, name: 'Gold_body' }];
  const [atZero] = await sampleAnimation(await parseSkeleton(sk), 'Gold_Chest', [0]);
  assert.equal(atZero.slots[0].attachment, 'Bronze_body', 'the runtime shows the setup look before the first key');
  const r = migrate(sk, GOLD_ONLY);
  assert.deepEqual(codes(r.skipped), ['late-pick']);
  assert.deepEqual(r.skipped[0].params, { animation: 'Gold_Chest', slot: 'body', name: 'Gold_body', time: 0.5 });
  // Late keys of the setup attachment itself change nothing and stay allowed.
  const ok = baseSkeleton();
  ok.animations.Bronze_Chest.slots = { body: { attachment: [{ time: 0.5, name: 'Bronze_body' }] } };
  assert.deepEqual(migrate(ok, GOLD_ONLY).skipped, []);
});

test('a slot hidden for the whole clip is refused: removing the timeline would show it', async () => {
  const sk = baseSkeleton();
  sk.animations.Gold_Chest.slots.body.attachment = [{}];
  const [atZero] = await sampleAnimation(await parseSkeleton(sk), 'Gold_Chest', [0]);
  assert.equal(atZero.slots[0].attachment, null, 'the runtime hides the slot');
  assert.deepEqual(codes(migrate(sk, GOLD_ONLY).skipped), ['hide-key']);
  assert.deepEqual(scan(sk).report.map(x => x.code), ['hide-key']);
  // A hide on a slot with no setup attachment changes nothing once removed.
  const ok = baseSkeleton();
  ok.slots.push({ name: 'empty', bone: 'lid' });
  for (const name of ['Bronze_Chest', 'Gold_Chest']) {
    ok.animations[name].slots = { ...ok.animations[name].slots, empty: { attachment: [{}] } };
  }
  const r = migrate(ok, GOLD_ONLY);
  assert.deepEqual(r.skipped, []);
  await provePicture(ok, r.skeleton, [{ original: 'Gold_Chest', migrated: 'Bronze_Chest', skin: 'Gold' }]);
});

test('the surviving clip never overwrites a clip the group keeps', () => {
  const sk = baseSkeleton();
  const r = migrate(sk, [{ ...GOLD_ONLY[0], animation: 'Silver_Chest' }]);
  assert.equal(r.changed, false);
  assert.deepEqual(codes(r.skipped), ['name-taken']);
  // The drifted clip the group keeps is protected too.
  const drift = baseSkeleton();
  drift.animations.Gold_Chest.bones.lid.rotate[1].value = -9;
  const r2 = migrate(drift, [{ ...GOLD_ONLY[0], animation: 'Gold_Chest' }]);
  assert.deepEqual(codes(r2.skipped), ['name-taken']);
  assert.deepEqual(r2.skeleton.animations, drift.animations);
  // Taking over a clip the group removes is fine.
  const r3 = migrate(baseSkeleton(), [{ ...GOLD_ONLY[0], animation: 'Gold_Chest' }]);
  assert.equal(sortedKeys(r3.skeleton.animations), 'Gold_Chest,Silver_Chest');
});

test('the default skin is found by name, not by position', async () => {
  const sk = baseSkeleton();
  sk.skins.unshift({ name: 'Extra', attachments: {} });
  const r = migrate(sk, GOLD_ONLY);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.skeleton.skins.map(s => s.name), ['Extra', 'default', 'Gold']);
  assertNoFreshFatals(sk, r.skeleton);
  assert.ok(verify(sk, r.skeleton, GOLD_ONLY).ok);
  await provePicture(sk, r.skeleton, [{ original: 'Gold_Chest', migrated: 'Bronze_Chest', skin: 'Gold' }]);
});

test('pre-4 object-form skins are read and written back as an array', async () => {
  const sk = baseSkeleton();
  sk.skins = { default: sk.skins[0].attachments };
  const r = migrate(sk, GOLD_ONLY);
  assert.deepEqual(r.skeleton.skins.map(s => s.name), ['default', 'Gold']);
  assert.ok(verify(sk, r.skeleton, GOLD_ONLY).ok);
});

test('overwriteSkins replaces the skin in place instead of adding a second one', async () => {
  const sk = baseSkeleton();
  sk.skins.push({ name: 'Gold', attachments: {} });
  assert.deepEqual(codes(migrate(sk, GOLD_ONLY).skipped), ['skin-exists']);
  const r = migrate(sk, GOLD_ONLY, { overwriteSkins: true });
  assert.equal(r.skeleton.skins.filter(s => s.name === 'Gold').length, 1);
  assert.deepEqual(Object.keys(r.skeleton.skins.find(s => s.name === 'Gold').attachments), ['body']);
  assertNoFreshFatals(sk, r.skeleton);
  await provePicture(sk, r.skeleton, [{ original: 'Gold_Chest', migrated: 'Bronze_Chest', skin: 'Gold' }]);
  const split = splitLooks(chestLike({ extraSkin: 'Gold' }), [{ animation: 'Gold_Chest', skinName: 'Gold' }], { overwriteSkins: true });
  assert.equal(split.skeleton.skins.filter(s => s.name === 'Gold').length, 1, 'split mode too');
});

test('the default skin is never a look variant, even with overwriteSkins', () => {
  const sk = baseSkeleton();
  const r = migrate(sk, [{ base: 'Bronze_Chest', variants: [{ animation: 'Gold_Chest', skinName: 'default' }] }], { overwriteSkins: true });
  assert.deepEqual(codes(r.skipped), ['skin-is-default']);
  assert.deepEqual(r.skeleton.skins, sk.skins);
  const split = splitLooks(chestLike(), [{ animation: 'Gold_Chest', skinName: 'default' }], { overwriteSkins: true });
  assert.deepEqual(codes(split.skipped), ['skin-is-default']);
});

test('an attachment with its own name field keeps its region when relocated', async () => {
  const sk = baseSkeleton();
  const body = sk.skins[0].attachments.body;
  body.Gold_body = { name: 'gold_art', width: 12, height: 8 };
  const r = migrate(sk, GOLD_ONLY);
  const moved = r.skeleton.skins.find(s => s.name === 'Gold').attachments.body.Bronze_body;
  assert.equal(moved.path, 'gold_art', 'the region the parser resolves, not the old key');
  assert.ok(verify(sk, r.skeleton, GOLD_ONLY).ok);
  await provePicture(sk, r.skeleton, [{ original: 'Gold_Chest', migrated: 'Bronze_Chest', skin: 'Gold' }]);
  // An explicit path wins over both.
  body.Gold_body = { name: 'gold_art', path: 'gold_page', width: 12, height: 8 };
  const r2 = migrate(sk, GOLD_ONLY);
  assert.equal(r2.skeleton.skins.find(s => s.name === 'Gold').attachments.body.Bronze_body.path, 'gold_page');
});

// ── verify catches what a broken migration would produce ───────────────────────────

test('verify reports a lost, moved or altered attachment', () => {
  const sk = baseSkeleton();
  const good = migrate(sk, GOLD_SILVER).skeleton;
  const lost = clone(good);
  lost.skins.find(s => s.name === 'Gold').attachments.body = { Gold_body: lost.skins[0].attachments.body.Gold_body };
  assert.deepEqual(verify(sk, lost, GOLD_SILVER).problems.map(p => [p.skin, p.code]), [['Gold', 'region-changed']]);
  const moved = clone(good);
  moved.skins.find(s => s.name === 'Gold').attachments.body.Bronze_body.path = 'Silver_body';
  assert.deepEqual(verify(sk, moved, GOLD_SILVER).problems.map(p => p.code), ['region-changed']);
  const altered = clone(good);
  altered.skins.find(s => s.name === 'Silver').attachments.body.Bronze_body.width = 11;
  assert.deepEqual(verify(sk, altered, GOLD_SILVER).problems.map(p => [p.skin, p.code]), [['Silver', 'data-changed']]);
  const gone = clone(good);
  gone.slots[0].attachment = 'Missing';
  assert.deepEqual(verify(sk, gone, GOLD_SILVER).problems.map(p => p.code), ['attachment-lost', 'attachment-lost']);
});

// ── scan: suggestions only ─────────────────────────────────────────────────────────

test('scan suggests the family, the setup-matching base and the skin names', () => {
  const sk = baseSkeleton();
  const { groups, report } = scan(sk);
  assert.deepEqual(report, []);
  assert.deepEqual(groups, [{ base: 'Bronze_Chest', variants: [
    { animation: 'Gold_Chest', skinName: 'Gold', picks: { body: 'Gold_body' } },
    { animation: 'Silver_Chest', skinName: 'Silver', picks: { body: 'Silver_body' } },
  ] }]);
  assert.equal(scan(sk, { skinNames: { Gold_Chest: 'Golden' } }).groups[0].variants[0].skinName, 'Golden');
  assert.deepEqual(sk, baseSkeleton(), 'scan does not mutate');
  // The base is the member that already shows the setup look, wherever it sits.
  const reordered = baseSkeleton();
  const { Bronze_Chest, ...rest } = reordered.animations;
  reordered.animations = { ...rest, Bronze_Chest };
  assert.equal(scan(reordered).groups[0].base, 'Bronze_Chest');
  // A drifted clip is not suggested as part of the family.
  const drift = baseSkeleton();
  drift.animations.Gold_Chest.bones.lid.rotate[1].value = -9;
  assert.deepEqual(scan(drift).groups.map(g => [g.base, g.variants.map(v => v.animation)]), [['Bronze_Chest', ['Silver_Chest']]]);
  // Picks that disagree on the tag give no name suggestion.
  const mixed = baseSkeleton();
  mixed.slots.push({ name: 'lock', bone: 'lid', attachment: 'Bronze_lock' });
  mixed.skins[0].attachments.lock = { Bronze_lock: {}, Iron_lock: {} };
  mixed.animations.Gold_Chest.slots.lock = { attachment: [{ name: 'Iron_lock' }] };
  mixed.animations.Silver_Chest.slots.lock = { attachment: [{ name: 'Bronze_lock' }] };
  const variants = scan(mixed).groups[0].variants;
  assert.equal(variants.find(v => v.animation === 'Gold_Chest').skinName, null);
  assert.equal(variants.find(v => v.animation === 'Silver_Chest').skinName, 'Silver');
});

test('a real skeleton without look variants yields no family and no change', () => {
  const sk = JSON.parse(fs.readFileSync(new URL('./fixtures/ident/ident.json', import.meta.url), 'utf8'));
  assert.deepEqual(scan(sk), { groups: [], report: [] });
  const r = migrate(sk, []);
  assert.equal(r.changed, false);
  assert.deepEqual(r.skeleton, sk);
});

test('bad arguments stop with a StudioError', () => {
  assert.throws(() => migrate(null, []), err => isStudioError(err, 'bad-argument'));
  assert.throws(() => migrate(baseSkeleton(), undefined), err => isStudioError(err, 'bad-argument'));
  assert.throws(() => splitLooks(baseSkeleton(), 'Gold_Chest'), err => isStudioError(err, 'bad-argument'));
  assert.throws(() => scan([]), err => isStudioError(err, 'bad-argument'));
  assert.throws(() => verify(baseSkeleton(), 'x', []), err => isStudioError(err, 'bad-argument'));
  const r = migrate(baseSkeleton(), [{ base: 'Missing', variants: [] }, { base: 'Bronze_Chest', variants: [] },
    { base: 'Bronze_Chest', variants: [{ animation: 'Nope', skinName: 'X' }] },
    { base: 'Bronze_Chest', variants: [{ animation: 'Gold_Chest' }] },
    { base: 'Bronze_Chest', variants: [{ animation: 'Bronze_Chest', skinName: 'Same' }] }]);
  assert.deepEqual(codes(r.skipped), ['base-missing', 'no-variants', 'animation-missing', 'no-skin-name', 'no-picks']);
});

// ── split mode ─────────────────────────────────────────────────────────────────────
// The shape a shipped rig has (a typical game chest): each look owns a
// clip, the attachment channel carries the look and real show/hide keys, and the timings
// differ per look. Collapsing would destroy hand-made timing, so only the look moves.

function chestLike({ extraSkin } = {}) {
  const sk = {
    skeleton: { spine: '4.2.43', hash: 'h', images: './' },
    bones: [{ name: 'root' }],
    slots: [{ name: 'lid', bone: 'root', attachment: 'Bronze_lid' }],
    skins: [{ name: 'default', attachments: { lid: {
      Bronze_lid: { width: 10, height: 10 },
      Gold_lid: { width: 10, height: 10 },
    } } }],
    animations: {
      // hide at 0, show at 0.63, hide again at 0.71: real timing, not a duplicate
      Bronze_Chest: { slots: { lid: { attachment: [{}, { time: 0.63, name: 'Bronze_lid' }, { time: 0.71 }] } } },
      Gold_Chest: { slots: { lid: { attachment: [{}, { time: 0.65, name: 'Gold_lid' }, { time: 0.73 }] } } },
    },
  };
  if (extraSkin) sk.skins.push({ name: extraSkin, attachments: {} });
  return sk;
}

test('split: the look becomes a skin and the timing is untouched', async () => {
  const sk = chestLike();
  const r = splitLooks(sk, [
    { animation: 'Bronze_Chest', skinName: 'Bronze' },
    { animation: 'Gold_Chest', skinName: 'Gold' },
  ]);
  assert.ok(r.changed);
  assert.deepEqual(r.skipped, []);
  assert.equal(sortedKeys(r.skeleton.animations), 'Bronze_Chest,Gold_Chest', 'every clip is kept');
  const gold = r.skeleton.animations.Gold_Chest.slots.lid.attachment;
  assert.deepEqual(gold.map(k => k.time ?? 0), [0, 0.65, 0.73], 'the times are identical');
  assert.equal(gold[0].name, undefined, 'hide keys stay hide keys');
  assert.equal(gold[2].name, undefined);
  assert.equal(gold[1].name, 'Bronze_lid', 'the shown key names the setup attachment, so the skin decides the colour');
  const goldSkin = r.skeleton.skins.find(s => s.name === 'Gold');
  assert.deepEqual(Object.keys(goldSkin.attachments.lid), ['Bronze_lid'], 'the skin holds its art under the setup key');
  assert.equal(goldSkin.attachments.lid.Bronze_lid.path, 'Gold_lid', 'pointing at the real region');
  assert.equal(r.skeleton.skins.some(s => s.name === 'Bronze'), false, 'the setup look gets no redundant skin');
  assert.deepEqual(r.report.find(x => x.from === 'Bronze_Chest'),
    { skin: null, from: 'Bronze_Chest', clipKept: 'Bronze_Chest', code: 'look-is-default',
      note: 'this look is the default skin itself; no new skin was needed' }, 'and that is said, not skipped');
  assert.deepEqual(r.report.find(x => x.from === 'Gold_Chest'), { skin: 'Gold', from: 'Gold_Chest', slots: ['lid'], clipKept: 'Gold_Chest' });
  assertNoFreshFatals(sk, r.skeleton);
  await provePicture(sk, r.skeleton, [
    { original: 'Bronze_Chest', migrated: 'Bronze_Chest' },
    { original: 'Gold_Chest', migrated: 'Gold_Chest', skin: 'Gold' },
  ]);
  assert.deepEqual(sk, chestLike(), 'splitLooks() does not mutate its input');
});

test('split refuses what is not a look', () => {
  const sk = chestLike();
  // Two looks inside one clip is an in-clip swap, not a colour identity.
  sk.animations.Gold_Chest.slots.lid.attachment = [{ name: 'Gold_lid' }, { time: 0.4, name: 'Bronze_lid' }];
  const r = splitLooks(sk, [{ animation: 'Gold_Chest', skinName: 'Gold' }]);
  assert.equal(r.changed, false);
  assert.deepEqual(codes(r.skipped), ['in-clip-swap']);
  assert.deepEqual(r.skipped[0].params.names, ['Gold_lid', 'Bronze_lid']);

  const missing = chestLike();
  missing.animations.Gold_Chest.slots.lid.attachment = [{ name: 'Platinum_lid' }];
  const r2 = splitLooks(missing, [{ animation: 'Gold_Chest', skinName: 'Gold' }]);
  assert.equal(r2.changed, false);
  assert.deepEqual(codes(r2.skipped), ['art-missing'], 'art that does not exist is rig work');

  // Before a late first key the clip shows the setup look; with the skin it would not.
  const late = chestLike();
  late.animations.Gold_Chest.slots.lid.attachment = [{ time: 0.2, name: 'Gold_lid' }, { time: 0.73 }];
  assert.deepEqual(codes(splitLooks(late, [{ animation: 'Gold_Chest', skinName: 'Gold' }]).skipped), ['late-pick']);

  const r3 = splitLooks(chestLike(), [{ animation: 'Nope', skinName: 'X' }, { animation: 'Gold_Chest' },
    { animation: 'Gold_Chest', skinName: 'default' }]);
  assert.deepEqual(codes(r3.skipped), ['animation-missing', 'no-skin-name', 'skin-is-default']);
  const hidden = chestLike();
  hidden.animations.Gold_Chest.slots.lid.attachment = [{}];
  assert.deepEqual(codes(splitLooks(hidden, [{ animation: 'Gold_Chest', skinName: 'Gold' }]).skipped), ['no-picks']);
  const twice = splitLooks(chestLike(), [{ animation: 'Gold_Chest', skinName: 'Gold' }, { animation: 'Bronze_Chest', skinName: 'Gold' }]);
  assert.deepEqual(codes(twice.skipped), ['skin-exists']);
});

// ── the owner's Chest_Export rig ───────────────────────────────────────────────────
// The legacy gate read the owner's own export (tests/fixtures/chest_variants.json), which
// never entered git and is not on this machine, and skipped this pass without it. It is
// not generated by any tool. This reproduces what the legacy gate and module documented
// about it, so the pass always runs: three clips Bronze_Chest / Gold_Chest / Silver_Chest
// with the same lid-pop motion and a physics wobble, looks keyed per slot as
// "<Look>01"/"<Look>02", Bronze on the setup look, and Gold's physics curve drifted a
// few thousandths of a second from Bronze's.

function chestVariants() {
  const looks = ['Bronze', 'Gold', 'Silver'];
  const quad = shift => ({ type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 2, 3, 0],
    vertices: [-20 - shift, -10, 20 + shift, -10, 20, 10, -20, 10], hull: 4, width: 40, height: 20 });
  const attachments = { lid01: {}, base02: {}, shine: { shine: { width: 8, height: 8 } } };
  looks.forEach((look, i) => {
    attachments.lid01[`${look}01`] = { x: 1, y: 12 + i, width: 40, height: 14 };
    attachments.base02[`${look}02`] = quad(i);
  });
  const motion = physicsCurve => ({
    bones: { lid: {
      rotate: [{ value: 0, curve: [0.1, 0, 0.15, -25] }, { time: 0.2667, value: -25, curve: [0.35, -25, 0.45, 0] }, { time: 0.5333, value: 0 }],
      translate: [{ x: 0, y: 0, curve: [0.08, 0, 0.16, 0, 0.08, 0, 0.16, 6] }, { time: 0.2667, x: 0, y: 6 }, { time: 0.5333, x: 0, y: 0 }],
    } },
    slots: { shine: { rgba: [{ color: 'ffffff00' }, { time: 0.3, color: 'ffffffff' }, { time: 0.5333, color: 'ffffff00' }] } },
    physics: { lid_wobble: { mix: [{ value: 1, curve: physicsCurve }, { time: 0.5333, value: 0 }] } },
  });
  const clip = (look, physicsCurve) => {
    const anim = motion(physicsCurve);
    anim.slots.lid01 = { attachment: [{ name: `${look}01` }] };
    anim.slots.base02 = { attachment: [{ name: `${look}02` }] };
    return anim;
  };
  return {
    skeleton: { hash: 'chest', spine: '4.2.43', x: -30, y: -20, width: 60, height: 50, images: './images/', audio: '' },
    bones: [{ name: 'root' }, { name: 'base', parent: 'root' }, { name: 'lid', parent: 'base', y: 10 }],
    slots: [
      { name: 'base02', bone: 'base', attachment: 'Bronze02' },
      { name: 'lid01', bone: 'lid', attachment: 'Bronze01' },
      { name: 'shine', bone: 'lid', attachment: 'shine', blend: 'additive' },
    ],
    physics: [{ name: 'lid_wobble', bone: 'lid', rotate: 1, inertia: 0.6, strength: 120, damping: 0.8, mass: 1.5 }],
    skins: [{ name: 'default', attachments }],
    animations: {
      Bronze_Chest: clip('Bronze', [0.18, 1, 0.36, 0]),
      Gold_Chest: clip('Gold', [0.183, 1, 0.362, 0]),
      Silver_Chest: clip('Silver', [0.18, 1, 0.36, 0]),
    },
  };
}
const CHEST_ALL = [{ base: 'Bronze_Chest', variants: [
  { animation: 'Gold_Chest', skinName: 'Gold' },
  { animation: 'Silver_Chest', skinName: 'Silver' },
] }];

test('chest rig: the reproduction is a clean, runtime-readable 4.2 skeleton', async () => {
  const sk = chestVariants();
  assert.deepEqual(checkSkeleton(sk).filter(f => f.level === 'fatal'), []);
  const data = await parseSkeleton(sk);
  assert.ok(data.physicsConstraints.length === 1 || data.limits.includes('physics:lid_wobble'), 'the physics wobble is live (or named as not evaluated)');
});

test('chest rig: scan finds Bronze + Silver only; Gold has drifted', () => {
  const { groups } = scan(chestVariants());
  assert.deepEqual(groups.map(g => [g.base, g.variants.map(v => [v.animation, v.skinName])]),
    [['Bronze_Chest', [['Silver_Chest', 'Silver']]]]);
});

test('chest rig: Bronze + Silver fold cleanly, Gold is left standing', async () => {
  const real = chestVariants();
  const groups = [{ base: 'Bronze_Chest', variants: [{ animation: 'Silver_Chest', skinName: 'Silver' }] }];
  const r = migrate(real, groups);
  assert.ok(r.changed);
  assert.equal(sortedKeys(r.skeleton.animations), 'Bronze_Chest,Gold_Chest');
  assert.deepEqual(r.skeleton.animations.Gold_Chest, real.animations.Gold_Chest, 'Gold untouched');
  assert.deepEqual(r.skeleton.skins.map(s => s.name), ['default', 'Silver']);
  assert.deepEqual(r.report.find(x => x.skin).slots.sort(), ['base02', 'lid01'], 'the shine slot is not part of the look');
  assert.ok(verify(real, r.skeleton, groups).ok);
  assertNoFreshFatals(real, r.skeleton);
  await provePicture(real, r.skeleton, [
    { original: 'Bronze_Chest', migrated: 'Bronze_Chest' },
    { original: 'Silver_Chest', migrated: 'Bronze_Chest', skin: 'Silver' },
    { original: 'Gold_Chest', migrated: 'Gold_Chest' },
  ]);
});

test('chest rig: without allowMotionDrift Gold keeps its clip but gains its skin', async () => {
  const real = chestVariants();
  const r = migrate(real, CHEST_ALL);
  assert.equal(sortedKeys(r.skeleton.animations), 'Bronze_Chest,Gold_Chest');
  assert.deepEqual(r.report.filter(x => x.clipKept).map(x => x.clipKept), ['Gold_Chest']);
  await provePicture(real, r.skeleton, [{ original: 'Gold_Chest', migrated: 'Gold_Chest', skin: 'Gold' }]);
});

test('chest rig, the owner\'s target: one clip and three looks selectable as skins', async () => {
  const real = chestVariants();
  const r = migrate(real, CHEST_ALL, { allowMotionDrift: true });
  assert.deepEqual(Object.keys(r.skeleton.animations), ['Bronze_Chest']);
  assert.deepEqual(r.skeleton.skins.map(s => s.name), ['default', 'Gold', 'Silver']);
  assert.deepEqual(r.report.filter(x => x.motionDiscarded).map(x => x.motionDiscarded), ['Gold_Chest']);
  assert.deepEqual(verify(real, r.skeleton, CHEST_ALL), { ok: true, problems: [] });
  assertNoFreshFatals(real, r.skeleton);
  await provePicture(real, r.skeleton, [
    { original: 'Bronze_Chest', migrated: 'Bronze_Chest' },
    { original: 'Silver_Chest', migrated: 'Bronze_Chest', skin: 'Silver' },
    // Gold's own drifted motion is discarded by request; its look must still match.
    { original: 'Gold_Chest', migrated: 'Bronze_Chest', skin: 'Gold', motionFrom: 'Bronze_Chest' },
  ]);
});
