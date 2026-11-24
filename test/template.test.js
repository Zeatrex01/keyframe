// The character template: the empty skeletons in examples/template carry every bone, slot and IK
// the example clips key, and docs/character-template.md names every slot and attachment in them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSkeleton } from '../src/runtime/index.js';
import { checkSkeleton } from '../src/spine/check.js';

const read = rel => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
const json = rel => JSON.parse(read(rel));
const doc = read('docs/character-template.md');
const pairs = [['examples/template/head.json', 'test/fixtures/face/cat_v2.json'], ['examples/template/body.json', 'test/fixtures/body/human_v2.json']];

for (const [template, example] of pairs) {
  test(`${template} opens clean and has no art and no clips`, async () => {
    const sk = json(template);
    await parseSkeleton(sk);
    assert.deepEqual(checkSkeleton(sk).filter(f => f.level === 'fatal'), []);
    assert.deepEqual(sk.animations, {}); assert.deepEqual(sk.skins[0].attachments, {});
  });

  test(`${template} carries every bone, slot and IK the example's clips use, with the same parents`, () => {
    const sk = json(template), ex = json(example);
    const parent = new Map(sk.bones.map(b => [b.name, b.parent ?? null])), slotBone = new Map(sk.slots.map(s => [s.name, s.bone]));
    const exParent = new Map(ex.bones.map(b => [b.name, b.parent ?? null])), exSlot = new Map(ex.slots.map(s => [s.name, s.bone]));
    for (const clip of Object.values(ex.animations)) {
      for (const bone of Object.keys(clip.bones ?? {})) assert.equal(parent.get(bone), exParent.get(bone), `bone ${bone}`);
      for (const slot of Object.keys(clip.slots ?? {})) assert.equal(slotBone.get(slot), exSlot.get(slot), `slot ${slot}`);
      for (const ik of Object.keys(clip.ik ?? {})) assert.ok((sk.ik ?? []).some(c => c.name === ik), `ik ${ik}`);
    }
    for (const c of ex.ik ?? []) assert.deepEqual(sk.ik.find(t => t.name === c.name), c, `ik ${c.name} differs`);
  });

  test(`the guide names every slot of ${template}`, () => {
    for (const slot of json(template).slots) assert.ok(doc.includes('`' + slot.name + '`') || doc.includes(slot.name.replace(/[LR]$/, '')), `${slot.name} is not in docs/character-template.md`);
  });
}

test('the guide lists every lid and mouth shape the face clips switch to', () => {
  const used = new Set();
  for (const clip of Object.values(json('test/fixtures/face/cat_v2.json').animations)) {
    for (const slot of ['lidL', 'lidR', 'mouth']) for (const key of clip.slots?.[slot]?.attachment ?? []) if (key.name) used.add(key.name);
  }
  assert.ok(used.size >= 8, 'the clips switch fewer shapes than expected: ' + [...used]);
  for (const name of used) assert.ok(doc.includes('`' + name + '`'), `${name} is not in docs/character-template.md`);
});
