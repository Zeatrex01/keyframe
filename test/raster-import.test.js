// Gate for the raster trial: a flat key colour comes out, a parts sheet is cut into its pieces in
// reading order, named pieces stand up as a side-view figure, and one fused picture gets bones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectKey, keyOut, findPieces, assembleSideBiped, puppetRig, SIDE_BIPED, SIDE_BIPED_DRAW } from '../src/render/raster-import.js';

const KEY = [255, 0, 255];

/** A w x h picture on the key colour with solid rectangles [x, y, w, h, rgb]. */
function sheet(w, h, rects, bg = KEY) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...bg, 255], i * 4);
  for (const [rx, ry, rw, rh, rgb = [40, 120, 80]] of rects) {
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) data.set([...rgb, 255], (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}
const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

test('the flat border colour is found and keyed out, the drawing stays opaque', () => {
  const img = sheet(64, 64, [[20, 20, 20, 20]]);
  assert.deepEqual(detectKey(img), KEY);
  const keyed = keyOut(img);
  assert.deepEqual(keyed.key, KEY);
  assert.equal(alphaAt(keyed, 2, 2), 0, 'background is clear');
  assert.equal(alphaAt(keyed, 30, 30), 255, 'drawing is kept');
});

test('a picture with no flat border is refused, a transparent one needs no key', () => {
  const noisy = sheet(32, 32, []);
  for (let i = 0; i < 32 * 32; i++) noisy.data.set([(i * 37) % 256, (i * 91) % 256, (i * 13) % 256, 255], i * 4);
  assert.throws(() => detectKey(noisy));
  const clear = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) };
  assert.equal(detectKey(clear), null);
});

test('a parts sheet is cut into its separate pieces in reading order', () => {
  const img = keyOut(sheet(200, 200, [[120, 10, 30, 30], [10, 10, 40, 30], [60, 120, 20, 60], [2, 2, 1, 1]]));
  const pieces = findPieces(img);
  assert.equal(pieces.length, 3, 'the one-pixel speck is dropped');
  assert.deepEqual(pieces.map(p => p.index), [1, 2, 3]);
  assert.ok(pieces[0].box[0] < pieces[1].box[0], 'left before right on the top row');
  assert.ok(pieces[2].box[1] > 100, 'the lower piece comes last');
  const [p] = pieces;
  assert.equal(p.image.width, p.box[2]);
  assert.equal(alphaAt(p.image, Math.floor(p.image.width / 2), Math.floor(p.image.height / 2)), 255);
});

test('a piece crop leaves out a neighbour that falls inside its box', () => {
  // An L-shaped piece wraps a square; the square must not show up in the L's crop.
  const img = keyOut(sheet(100, 100, [[10, 10, 10, 60], [10, 60, 60, 10], [40, 20, 15, 15]]));
  const pieces = findPieces(img, { pad: 0 });
  assert.equal(pieces.length, 2);
  const ell = pieces.find(p => p.box[3] > 50);
  assert.equal(alphaAt(ell.image, 40 - ell.box[0] + 5, 20 - ell.box[1] + 5), 0);
});

test('named pieces stand up as a side-view figure: feet near the ground, head on top', () => {
  const box = (w, h) => {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
    return { image: { width: w, height: h, data } };
  };
  const sizes = { head: [80, 90], torso: [90, 160], upperArmFront: [30, 90], forearmFront: [28, 90], upperArmBack: [30, 90],
    forearmBack: [28, 90], thighFront: [40, 110], shinFront: [36, 110], thighBack: [40, 110], shinBack: [36, 110] };
  const named = Object.fromEntries(Object.entries(sizes).map(([k, [w, h]]) => [k, box(w, h)]));
  const parts = assembleSideBiped(named, { scale: 0.5 });
  assert.deepEqual([...parts.map(p => p.name)].sort(), SIDE_BIPED.map(p => p.name).sort());
  const drawn = parts.map(p => p.name), before = (a, b) => drawn.indexOf(a) < drawn.indexOf(b);
  assert.deepEqual(drawn, SIDE_BIPED_DRAW);
  for (const [a, b] of [['shinFront', 'thighFront'], ['thighFront', 'torso'], ['forearmFront', 'upperArmFront'], ['forearmBack', 'upperArmBack'], ['upperArmBack', 'torso']]) {
    assert.ok(before(a, b), `${a} is drawn under ${b}`);
  }
  const by = Object.fromEntries(parts.map(p => [p.name, p]));
  const bottom = p => p.at[1] - p.size[1] / 2, top = p => p.at[1] + p.size[1] / 2;
  for (const shin of ['shinFront', 'shinBack']) assert.ok(Math.abs(bottom(by[shin])) < 20, `${shin} ends near the ground (${bottom(by[shin])})`);
  assert.ok(bottom(by.head) > by.torso.at[1], 'head sits above the torso centre');
  assert.ok(top(by.thighFront) < top(by.torso), 'thigh starts inside the torso');
  assert.equal(by.shinFront.parent, 'thighFront');
  assert.equal(by.forearmBack.parent, 'upperArmBack');
  assert.throws(() => assembleSideBiped({ torso: named.torso }), /missing/);
});

test('one fused picture becomes one image on the root with bones placed from picture points', () => {
  const img = keyOut(sheet(100, 200, [[40, 20, 20, 160]]));
  const rig = puppetRig({ name: 'fig', image: img, scale: 1, bones: [
    { name: 'hip', from: [50, 120], to: [50, 60] },
    { name: 'leg', parent: 'hip', from: [50, 120], to: [50, 180] },
  ] });
  const bones = Object.fromEntries(rig.skeleton.bones.map(b => [b.name, b]));
  assert.equal(bones.hip.rotation, 90, 'pointing up the picture is +90');
  assert.equal(bones.hip.length, 60);
  assert.equal(Math.abs(bones.leg.rotation), 180, 'the leg points back down from the hip');
  assert.equal(bones.body.parent, 'root');
  assert.match(rig.atlasText, /body/);
  assert.throws(() => puppetRig({ name: 'fig', image: img, bones: [{ name: 'x', parent: 'nope', from: [0, 0], to: [1, 1] }] }), /parent/);
});

test('the head goes on the collar: its neck lines up with the top of the torso and tucks under it', () => {
  // A torso whose top edge (a collar) is only at the front, and a head whose neck is at the back.
  const shape = (w, h, inside) => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x / w, y / h)) data[(y * w + x) * 4 + 3] = 255;
    return { image: { width: w, height: h, data } };
  };
  const solid = (w, h) => shape(w, h, () => true);
  const named = { torso: shape(100, 200, (fx, fy) => fy > 0.1 || fx > 0.6), head: shape(100, 100, (fx, fy) => fy < 0.8 || fx < 0.3),
    upperArmFront: solid(30, 90), forearmFront: solid(28, 90), upperArmBack: solid(30, 90), forearmBack: solid(28, 90),
    thighFront: solid(40, 110), shinFront: solid(36, 110), thighBack: solid(40, 110), shinBack: solid(36, 110) };
  const parts = Object.fromEntries(assembleSideBiped(named, { scale: 1 }).map(p => [p.name, p]));
  const { torso, head } = parts;
  const collarX = torso.at[0] - 50 + 80, neckX = head.at[0] - 50 + 15;
  assert.ok(Math.abs(collarX - neckX) < 2, `neck ${neckX} on collar ${collarX}`);
  assert.ok(head.at[1] - 50 < torso.at[1] + 100, 'the bottom of the neck sits inside the torso');
  const drawn = SIDE_BIPED_DRAW;
  assert.ok(drawn.indexOf('head') < drawn.indexOf('torso'), 'the collar is drawn over the neck');
});
