// Gate for the wardrobe of the bare side-view figure: a bald body in a base layer, every garment and
// armour piece a part of its own over the bone it covers, wider than that part all round, shown when
// worn, and armour hiding the cloth on its own part.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetStyle } from '../src/art/style.js';
import { sideParts } from '../src/art/figure-side.js';
import { CLOTH, ARMOUR } from '../src/art/figure-wardrobe.js';

const style = presetStyle();
const all = [...CLOTH, ...ARMOUR];
const figure = (wear, more = {}) => Object.fromEntries(sideParts({ h: 300, bare: true, wear, ...more }, style).map(p => [p.name, p]));

test('the bare figure is bald and draws every piece, hidden unless worn', () => {
  const plain = Object.fromEntries(sideParts({ h: 300 }, style).map(p => [p.name, p]));
  const bare = figure([]);
  assert.equal(bare.head.shapes.length, plain.head.shapes.length - 1, 'the hair is not drawn on the head');
  for (const n of ['hair', 'shirt', 'waist', 'cuirass', 'helmet', 'sleeveFront', 'cuffBack', 'rerebraceFront', 'vambraceBack', 'pauldronFront',
    'trouserFront', 'leggingBack', 'cuisseFront', 'greaveBack', 'bootFront', 'sabatonBack']) {
    assert.ok(bare[n], `${n} is drawn`);
    assert.equal(bare[n].hidden, true, `${n} is hidden when not worn`);
  }
  const dressed = figure(['hair', 'shirt', 'trousers', 'boots']);
  for (const n of ['hair', 'shirt', 'waist', 'sleeveFront', 'cuffFront', 'trouserBack', 'leggingFront', 'bootBack']) assert.ok(!dressed[n].hidden, `${n} is worn`);
  assert.ok(dressed.helmet.hidden && dressed.cuirass.hidden);
  assert.ok(!sideParts({ h: 300 }, style).some(p => p.name === 'helmet' || p.name === 'shirt'), 'a figure that is not bare has no wardrobe');
});

test('each piece rides its part and covers all of it', () => {
  const f = figure(all);
  for (const [piece, part] of [['sleeveFront', 'upperArmFront'], ['rerebraceFront', 'upperArmFront'], ['cuffBack', 'forearmBack'], ['vambraceBack', 'forearmBack'],
    ['trouserFront', 'thighFront'], ['cuisseFront', 'thighFront'], ['leggingBack', 'shinBack'], ['greaveBack', 'shinBack'], ['sabatonFront', 'footFront']]) {
    assert.equal(f[piece].parent, part, `${piece} rides ${part}`);
    assert.ok(f[piece].box[0] > f[part].box[0] && f[piece].box[1] > f[part].box[1], `${piece} is wider and taller than ${part}`);
    assert.deepEqual(f[piece].offset.map(Math.round), f[part].offset.map(v => Math.round(v)), `${piece} is centred on ${part}`);
  }
  assert.ok(f.cuirass.box[0] > f.body.box[0] && f.cuirass.box[1] > f.body.box[1], 'the cuirass covers the whole torso');
  assert.ok(f.helmet.box[0] > f.head.box[0], 'the helmet covers the whole skull');
  const order = sideParts({ h: 300, bare: true, wear: all }, style).map(p => p.name);
  const after = (a, b) => order.indexOf(a) > order.indexOf(b);
  for (const [a, b] of [['sleeveFront', 'upperArmFront'], ['rerebraceFront', 'sleeveFront'], ['vambraceFront', 'cuffFront'], ['cuisseFront', 'trouserFront'],
    ['greaveFront', 'leggingFront'], ['sabatonFront', 'bootFront'], ['cuirass', 'shirt'], ['helmet', 'hair'], ['helmet', 'eye'], ['pauldronFront', 'handFront']]) {
    assert.ok(after(a, b), `${a} is drawn over ${b}`);
  }
});

test('armour hides the cloth on its own part, and a broader build widens what is worn', () => {
  const f = figure(all);
  for (const n of ['hair', 'shirt', 'waist', 'sleeveFront', 'cuffBack', 'trouserFront', 'leggingBack', 'bootFront']) assert.equal(f[n].hidden, true, `${n} is hidden under armour`);
  for (const n of ['helmet', 'cuirass', 'pauldronFront', 'rerebraceBack', 'vambraceFront', 'cuisseBack', 'greaveFront', 'sabatonBack']) assert.ok(!f[n].hidden, `${n} is worn`);
  const partly = figure(['shirt', 'trousers', 'vambraces']);
  assert.ok(!partly.sleeveFront.hidden && partly.cuffFront.hidden, 'a vambrace hides only the forearm sleeve');
  const slim = figure(['cuirass'], { bulk: 0.8 }), broad = figure(['cuirass'], { bulk: 1.3 });
  assert.ok(broad.body.box[0] > slim.body.box[0] * 1.5 && broad.cuirass.box[0] > broad.body.box[0], 'the cuirass follows the build');
  assert.ok(broad.upperArmFront.box[0] > slim.upperArmFront.box[0] * 1.5, 'the arms widen too');
});
