// Gate for src/spine/diff.js. Legacy skeldiff.js had no gate of its own; its behaviour
// was asserted inside test_inherit.js, test_loop.js, test_rig_edit.js and
// test_rigid_bind.js. The assertions about the diff itself are collected here, on
// synthetic before/after pairs that reproduce what those gates produced (rig edit and
// rigid bind are not carried, so their outputs are built by hand).
//
// The diff exists to prove the studio did not touch the rig. A verdict that misses a
// change is worse than no verdict, so every "untouched" claim is tested against a real
// change of each kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { diffSkeletons, SETUP_FIELDS } from '../src/spine/diff.js';

const fixture = rel => JSON.parse(fs.readFileSync(new URL(`./fixtures/${rel}`, import.meta.url), 'utf8'));
const clone = o => structuredClone(o);

const BASE = {
  skeleton: { hash: 'h', spine: '4.2.43', x: 0, y: 0, width: 100, height: 100, images: './', audio: '' },
  bones: [{ name: 'root' }, { name: 'carrier', parent: 'root', x: 14, y: -8 }, { name: 'child', parent: 'carrier', length: 20 }],
  slots: [{ name: 'art_slot', bone: 'carrier', attachment: 'art' }, { name: 'mesh_slot', bone: 'child', attachment: 'panel' }],
  skins: [
    { name: 'default', attachments: {
      art_slot: { art: { x: 3, y: 4, width: 10, height: 10 } },
      mesh_slot: {
        panel: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], hull: 3, vertices: [0, 0, 10, 0, 10, 10], width: 10, height: 10 },
        sibling: { width: 5, height: 5 },
      },
    } },
    { name: 'alt', attachments: {
      art_slot: { art: { x: 1, y: 1, width: 10, height: 10 } },
      mesh_slot: { panel: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], hull: 3, vertices: [0, 0, 10, 0, 10, 10], width: 10, height: 10 } },
    } },
  ],
  ik: [{ name: 'reach', bones: ['child'], target: 'carrier' }],
  events: { step: {} },
  animations: { idle: { bones: { child: { rotate: [{ value: 0 }, { time: 1, value: 10 }] } } } },
};

const emptyRig = d => {
  const { bones, slots, skins, attachments, constraints } = d.rig;
  return !bones.added.length && !bones.removed.length && !bones.parentChanged.length && !bones.setupChanged.length
    && !bones.otherChanged.length && !bones.orderChanged
    && !slots.added.length && !slots.removed.length && !slots.changed.length && !slots.drawOrderChanged
    && !skins.added.length && !skins.removed.length && !skins.changed.length
    && !attachments.added.length && !attachments.removed.length && !attachments.changed.length && !attachments.geometryChanged.length
    && !constraints.added.length && !constraints.removed.length && !constraints.changed.length && !d.skeleton.changed;
};

test('identical skeletons: rig untouched, every animation untouched, no false alarm', () => {
  const d = diffSkeletons(BASE, clone(BASE));
  assert.equal(d.rigTouched, false);
  assert.ok(emptyRig(d), JSON.stringify(d.rig));
  assert.deepEqual(d.animations, { added: [], removed: [], changed: [], untouched: ['idle'] });
  assert.match(d.summary, /^RIG UNTOUCHED/);
  assert.match(d.summary, /1 untouched \(idle\)/);
});

// Legacy test_inherit.js #6: the inherit mode changes the bone's world transform, and the
// old field list missed it, so a mode change could hide behind "rig untouched".
test('an inherit mode change shows as a setup pose change', () => {
  const bones = mode => [{ name: 'root' }, { name: 'p', parent: 'root', rotation: 90, scaleX: 2, scaleY: 2 },
    { name: 'c', parent: 'p', x: 10, y: 0, rotation: 15, ...(mode ? { inherit: mode } : {}) }];
  const a = { skeleton: {}, bones: bones(null), slots: [], skins: [], animations: {} };
  const b = { skeleton: {}, bones: bones('noScale'), slots: [], skins: [], animations: {} };
  const d = diffSkeletons(a, b);
  const row = d.rig.bones.setupChanged.find(x => x.bone === 'c');
  assert.ok(row && row.fields.includes('inherit'), JSON.stringify(d.rig.bones.setupChanged));
  assert.equal(d.rigTouched, true);
  assert.deepEqual(diffSkeletons(a, a).rig.bones.setupChanged, [], 'an unchanged rig raises no false alarm');
  // The 3.x field name counts too.
  const legacy = clone(a);
  legacy.bones[2].transform = 'noScale';
  assert.deepEqual(diffSkeletons(a, legacy).rig.bones.setupChanged, [{ bone: 'c', fields: ['transform'] }]);
  assert.ok(SETUP_FIELDS.includes('inherit') && SETUP_FIELDS.includes('transform'));
});

// Legacy test_loop.js 6b: a delivery adds one animation to the owner's export. The one
// line read before Spine must say the rig is untouched and only our clip is new.
test('a delivery that only adds an animation: rig untouched, the owner animation untouched', () => {
  const base = fixture('merge/sample_intro.json');
  const delivery = clone(base);
  delivery.animations.intro = { bones: { [base.bones[1].name]: { rotate: [{ value: 0 }, { time: 1.6, value: 5 }] } } };
  const ownerAnimation = Object.keys(base.animations)[0];
  const d = diffSkeletons(base, delivery);
  assert.equal(d.rigTouched, false, d.summary);
  assert.deepEqual(d.rig.attachments.geometryChanged, [], 'mesh and weight geometry unchanged (the owner\'s ground)');
  assert.deepEqual(d.rig.constraints.added, []);
  assert.deepEqual(d.rig.constraints.changed, []);
  assert.deepEqual(d.animations.added, ['intro']);
  assert.deepEqual(d.animations.untouched, [ownerAnimation]);
  assert.ok(d.summary.includes('1 added (intro)'), d.summary);

  // With the rig really touched, the diff must catch it (the gate itself is tested).
  const broken = clone(delivery);
  broken.bones.push({ name: 'hidden_bone', parent: base.bones[0].name });
  broken.ik = [{ name: 'new_ik', bones: ['hidden_bone'], target: base.bones[0].name }];
  const d2 = diffSkeletons(base, broken);
  assert.equal(d2.rigTouched, true);
  assert.deepEqual(d2.rig.bones.added, ['hidden_bone']);
  assert.deepEqual(d2.rig.constraints.added, ['ik/new_ik']);
  assert.match(d2.summary, /^RIG CHANGED: 1 bone\(s\) added, .*1 constraint\(s\) added/);
});

// Legacy test_rig_edit.js (add bone): one bone added, one slot re-hung onto it, and the
// slot's region attachments shifted by the inverse translation in every skin.
test('add bone + re-hang slot: exactly one bone row, one slot field, region transforms only', () => {
  const after = clone(BASE);
  after.bones.push({ name: 'pivot', parent: 'carrier', x: 3, y: 4 });
  after.slots[0].bone = 'pivot';
  for (const skin of after.skins) { skin.attachments.art_slot.art.x -= 3; skin.attachments.art_slot.art.y -= 4; }
  const d = diffSkeletons(BASE, after);
  assert.deepEqual(d.rig.bones.added, ['pivot']);
  assert.deepEqual(d.rig.bones.removed, []);
  assert.deepEqual(d.rig.bones.parentChanged, []);
  assert.deepEqual(d.rig.bones.setupChanged, []);
  assert.deepEqual(d.rig.slots.changed, [{ slot: 'art_slot', fields: ['bone'] }]);
  assert.equal(d.rig.slots.drawOrderChanged, false);
  assert.deepEqual(d.rig.attachments.changed.map(x => x.attachment).sort(), ['alt/art_slot/art', 'default/art_slot/art']);
  assert.deepEqual(d.rig.attachments.geometryChanged, [], 'no mesh or weight geometry changed');
  assert.deepEqual(d.rig.constraints, { added: [], removed: [], changed: [] });
  assert.equal(d.skeleton.changed, false);
  assert.deepEqual([d.animations.added, d.animations.removed, d.animations.changed], [[], [], []]);
});

// Legacy test_rig_edit.js (duplicate bone): a Unicode name, nothing else touched.
test('a duplicated bone with a Unicode name is the only change', () => {
  const after = clone(BASE);
  const name = 'copy_骨';
  after.bones.push({ ...after.bones[1], name });
  const d = diffSkeletons(BASE, after);
  assert.deepEqual(d.rig.bones.added, [name]);
  assert.deepEqual(d.rig.bones.removed, []);
  assert.deepEqual(d.rig.slots.changed, []);
  assert.deepEqual(d.rig.attachments.changed, []);
  assert.deepEqual(d.rig.constraints.changed, []);
  assert.deepEqual(d.animations.changed, []);
  assert.ok(d.summary.includes('1 bone(s) added'));
});

// Legacy test_rigid_bind.js: binding one mesh to a bone rewrites its vertices only.
test('one mesh rebound: one geometry change keyed by skin, nothing collateral', () => {
  const after = clone(BASE);
  after.skins[0].attachments.mesh_slot.panel.vertices = [1, 2, 0, 0, 1, 1, 2, 10, 0, 1, 1, 2, 10, 10, 1];
  const d = diffSkeletons(BASE, after);
  assert.deepEqual(d.rig.attachments.geometryChanged, [{ attachment: 'default/mesh_slot/panel', type: 'mesh' }]);
  assert.deepEqual(d.rig.attachments.changed, [], 'a geometry change is not double-reported');
  assert.deepEqual(d.rig.bones.added, []);
  assert.deepEqual(d.rig.bones.removed, []);
  assert.deepEqual(d.rig.slots.changed, []);
  assert.equal(d.rigTouched, true);
  assert.match(d.summary, /GEOMETRY/);
  // The same-named attachment in the other skin is a separate entry and stays untouched.
  assert.ok(!d.rig.attachments.geometryChanged.some(x => x.attachment.startsWith('alt/')));
});

test('removals, parent changes, order and draw order are each reported', () => {
  const after = clone(BASE);
  after.bones = [after.bones[0], { ...after.bones[2], parent: 'root' }]; // carrier removed, child re-parented
  after.slots = [after.slots[1]];
  const d = diffSkeletons(BASE, after);
  assert.deepEqual(d.rig.bones.removed, ['carrier']);
  assert.deepEqual(d.rig.bones.parentChanged, [{ bone: 'child', before: 'carrier', after: 'root' }]);
  assert.equal(d.rig.bones.orderChanged, true);
  assert.deepEqual(d.rig.slots.removed, ['art_slot']);
  assert.equal(d.rig.slots.drawOrderChanged, true);
  const reordered = clone(BASE);
  reordered.slots.reverse();
  const d2 = diffSkeletons(BASE, reordered);
  assert.equal(d2.rig.slots.drawOrderChanged, true);
  assert.deepEqual(d2.rig.slots.changed, []);
  assert.equal(d2.rigTouched, true);
  assert.match(d2.summary, /draw order changed/);
});

test('constraints: added, removed and changed per kind', () => {
  const after = clone(BASE);
  after.ik[0].mix = 0.5;
  after.transform = [{ name: 'follow', bones: ['child'], target: 'root' }];
  const d = diffSkeletons(BASE, after);
  assert.deepEqual(d.rig.constraints, { added: ['transform/follow'], removed: [], changed: ['ik/reach'] });
  delete after.ik;
  assert.deepEqual(diffSkeletons(BASE, after).rig.constraints.removed, ['ik/reach']);
});

test('header changes are listed with before and after', () => {
  const after = clone(BASE);
  after.skeleton.spine = '4.2.40';
  const d = diffSkeletons(BASE, after);
  assert.deepEqual(d.skeleton, { changed: true, fields: [{ field: 'spine', before: '4.2.43', after: '4.2.40' }] });
  assert.equal(diffSkeletons(BASE, BASE).skeleton.fields, undefined);
});

test('animations: added, removed, changed, untouched', () => {
  const after = clone(BASE);
  after.animations.idle.bones.child.rotate[1].value = 11;
  after.animations.walk = {};
  const d = diffSkeletons(BASE, after);
  assert.deepEqual(d.animations, { added: ['walk'], removed: [], changed: ['idle'], untouched: [] });
  assert.equal(d.rigTouched, false);
  delete after.animations.idle;
  assert.deepEqual(diffSkeletons(BASE, after).animations.removed, ['idle']);
});

// ── legacy bugs, fixed and pinned ──

test('a slot-only change is named in the summary (legacy printed "RIG CHANGED" with an empty list)', () => {
  const after = clone(BASE);
  after.slots[0].color = 'ff0000ff';
  const d = diffSkeletons(BASE, after);
  assert.equal(d.rigTouched, true);
  assert.match(d.summary, /^RIG CHANGED: 1 slot\(s\) changed\./);
});

test('every changed field of a claimed section breaks the verdict (legacy compared a fixed list)', () => {
  const cases = [
    ['header field outside the legacy list', sk => { sk.skeleton.referenceScale = 50; }, d => d.skeleton.fields[0].field === 'referenceScale'],
    ['bone skin-required flag', sk => { sk.bones[1].skin = true; }, d => d.rig.bones.otherChanged[0].fields[0] === 'skin'],
    ['bone colour', sk => { sk.bones[1].color = 'ff0000ff'; }, d => d.rig.bones.otherChanged[0].bone === 'carrier'],
    ['slot field outside the legacy list', sk => { sk.slots[0].visible = false; }, d => d.rig.slots.changed[0].fields[0] === 'visible'],
    ['skin membership list', sk => { sk.skins[1].bones = ['carrier']; }, d => d.rig.skins.changed[0].skin === 'alt'],
    ['skin added', sk => { sk.skins.push({ name: 'third', attachments: {} }); }, d => d.rig.skins.added[0] === 'third'],
    ['attachment added', sk => { sk.skins[0].attachments.art_slot.art2 = { width: 1, height: 1 }; }, d => d.rig.attachments.added[0] === 'default/art_slot/art2'],
  ];
  for (const [label, change, check] of cases) {
    const after = clone(BASE);
    change(after);
    const d = diffSkeletons(BASE, after);
    assert.equal(d.rigTouched, true, label);
    assert.ok(check(d), `${label}: ${JSON.stringify(d.rig)} ${JSON.stringify(d.skeleton)}`);
    assert.match(d.summary, /^RIG CHANGED: \S/, label);
  }
});

test('bones named like Object.prototype members are found (legacy used plain objects)', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const after = clone(BASE);
    after.bones.push({ name, parent: 'root' });
    after.slots.push({ name, bone: name });
    const d = diffSkeletons(BASE, after);
    assert.deepEqual(d.rig.bones.added, [name], name);
    assert.deepEqual(d.rig.slots.added, [name], name);
    assert.deepEqual(diffSkeletons(after, BASE).rig.bones.removed, [name], name);
  }
});

test('event definitions are reported, outside the rig verdict', () => {
  const after = clone(BASE);
  after.events.step = { int: 2 };
  after.events.land = {};
  const d = diffSkeletons(BASE, after);
  assert.deepEqual(d.events, { added: ['land'], removed: [], changed: ['step'] });
  assert.equal(d.rigTouched, false);
  assert.match(d.summary, /Event definitions: 1 added, 1 changed\./);
});

test('object-format skins (3.x) and missing sections are read', () => {
  const a = { bones: [{ name: 'root' }], skins: { default: { s: { img: { width: 1 } } } } };
  const b = { bones: [{ name: 'root' }], skins: { default: { s: { img: { width: 2 } } } } };
  const d = diffSkeletons(a, b);
  assert.deepEqual(d.rig.attachments.changed, [{ attachment: 'default/s/img', type: 'region' }]);
  assert.equal(diffSkeletons({}, {}).rigTouched, false);
});
