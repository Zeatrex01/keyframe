// Every rig on the shared face keeps its eyes intact (Pip in examples/showcase, and the face and
// body fixtures): the pupil of each eye is masked to the white (a clipping attachment ending at
// the pupil), and wherever a lid is fully closed the white and the pupil are hidden, so no patch
// of skin is painted over the face. (Mika's anime eyes are drawn whole and carry no mask.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FULL = new Set(['lid_closed', 'lid_happy']);
// file, and how many times at least its clips close a lid
const FILES = { cat: ['./fixtures/face/cat_v2.json', 10], human: ['./fixtures/body/human_v2.json', 10], pip: ['../examples/showcase/pip/pip_v2.json', 6] };
const read = name => JSON.parse(readFileSync(fileURLToPath(new URL(FILES[name][0], import.meta.url)), 'utf8'));
const shownAt = (keys, t) => { let name; for (const k of keys ?? []) if ((k.time ?? 0) <= t + 1e-6) name = k.name; return name; };

for (const name of Object.keys(FILES)) {
  test(`${name}: each eye masks its pupil to the white`, () => {
    const sk = read(name);
    for (const side of ['L', 'R']) {
      const order = ['eye', 'eyeClip', 'pupil', 'lid'].map(n => sk.slots.findIndex(s => s.name === n + side));
      assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `${side}: drawing order is not eye, eyeClip, pupil, lid (${order})`);
      const clip = sk.skins[0].attachments['eyeClip' + side]?.['eyeClip' + side];
      assert.equal(clip?.type, 'clipping'); assert.equal(clip.end, 'pupil' + side, 'the mask ends at the pupil: a hard-edged mask over the lid shows the white through as a dotted ring');
      assert.equal(sk.slots[order[1]].attachment, 'eyeClip' + side, 'the mask is on in the setup pose');
    }
  });

  test(`${name}: wherever a lid is closed, the white and the pupil are hidden`, () => {
    const sk = read(name);
    let closed = 0;
    for (const [animation, clip] of Object.entries(sk.animations)) for (const side of ['L', 'R']) {
      for (const key of clip.slots?.['lid' + side]?.attachment ?? []) {
        if (!FULL.has(key.name)) continue;
        closed++;
        for (const slot of ['eye' + side, 'pupil' + side]) assert.equal(shownAt(clip.slots?.[slot]?.attachment, key.time ?? 0), null, `${animation} @${key.time ?? 0}s: ${slot} shows under a closed lid`);
      }
    }
    assert.ok(closed >= FILES[name][1], 'the clips close the lids fewer times than expected');
  });
}

// A pupil never reaches its eye's rim: its keys stay inside the room the rig leaves it (the white's
// inside, less the pupil's half size), so the eye's mask never cuts the iris into a crooked shape.
// (Pip's clips never move a pupil.)
for (const name of ['cat', 'human']) {
  test(`${name}: pupil keys stay clear of the eye's rim`, () => {
    const sk = read(name), at = sk.skins[0].attachments, eye = at.eyeL.eyeL, pupil = at.pupilL.pupilL;
    const room = { x: (eye.width - 10) / 2 - 2.5 - pupil.width / 2 - 1, y: (eye.height - 10) / 2 - 2.5 - pupil.height / 2 - 1 };
    assert.ok(room.x > 1 && room.y > 1, 'the pupil leaves itself no room to glance');
    let moved = 0;
    for (const [animation, clip] of Object.entries(sk.animations)) for (const bone of ['pupilL', 'pupilR']) for (const key of clip.bones?.[bone]?.translate ?? []) {
      const k = Math.hypot((key.x ?? 0) / room.x, (key.y ?? 0) / room.y);
      if (k > 0) moved++;
      assert.ok(k <= 0.75, `${animation} ${bone} @${key.time ?? 0}s is keyed ${key.x ?? 0}, ${key.y ?? 0}; the room is ${room.x} x ${room.y}`);
    }
    assert.ok(moved > 4, 'the pupils never glance');
  });
}
