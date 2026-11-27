// Gate for the wardrobe of the bare side-view figure: a bald body in a base layer, every garment and
// armour piece a part of its own over the bone it covers, wider than that part all round, shown when
// worn, and armour hiding the cloth on its own part.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetStyle } from '../src/art/style.js';
import { sideParts } from '../src/art/figure-side.js';
import { CLOTH, ARMOUR, HAIR_STYLES } from '../src/art/figure-wardrobe.js';

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

test('hair comes in several shapes, all on the head\'s box and under the helmet', () => {
  const paths = HAIR_STYLES.map(hairStyle => figure(['hair'], { hairStyle }).hair.shapes[0].path);
  assert.equal(new Set(paths).size, HAIR_STYLES.length, 'each style draws its own shape');
  assert.equal(figure(['hair'], { hairStyle: 'nope' }).hair.shapes[0].path, paths[0], 'an unknown style falls back to short');
  assert.ok(figure(['hair', 'helmet'], { hairStyle: 'long' }).hair.hidden, 'the helmet hides even long hair');
  assert.ok(figure(['hair', 'trousers', 'boots']).bootShaftFront && !figure(['boots']).bootShaftFront.hidden, 'boots come up the shin');
});

test('the bare body is shaped, shaded from one light, and armour has plates', async () => {
  const { PROFILES, taper } = await import('../src/art/figure-form.js');
  for (const n of ['thigh', 'shin', 'upperArm', 'forearm']) assert.ok(taper(n) >= 1.3, `${n} tapers (${taper(n).toFixed(2)})`);
  const calf = PROFILES.shin.reduce((a, s) => (s[2] > a[2] ? s : a));
  assert.ok(calf[0] > 0 && calf[0] < 0.5 && calf[2] > calf[1], 'the calf bulges at the back of the upper shin');
  const t = PROFILES.torso, waist = t.find(s => s[0] > 0.5 && s[0] < 0.8), chest = t.find(s => s[0] > 0.3 && s[0] < 0.5);
  assert.ok(chest[1] > waist[1] * 1.15, 'the chest stands in front of the waist');
  const f = figure(all), fills = p => new Set(p.shapes.map(s => s.fill).filter(c => c && c !== 'none'));
  for (const n of ['thighFront', 'shinFront', 'upperArmFront', 'body']) assert.ok(fills(f[n]).size >= 3, `${n} has light, base and shadow`);
  for (const n of ['cuirass', 'rerebraceFront', 'vambraceFront', 'cuisseFront', 'greaveFront', 'pauldronFront', 'helmet', 'sabatonFront']) {
    assert.ok(fills(f[n]).size >= 4, `${n} has base, shadow, light and a specular`);
  }
  assert.ok(f.body.box[1] === figure([]).body.box[1], 'the torso keeps its height');
});

test('head-wear and the extra hair styles are wear items of their own on the head', async () => {
  const { HEADWEAR } = await import('../src/art/figure-wardrobe.js');
  const f = figure([]);
  for (const n of HEADWEAR) {
    assert.ok(f[n], `${n} is drawn`);
    assert.equal(f[n].parent, 'head', `${n} rides the head`);
    assert.equal(f[n].hidden, true, `${n} is hidden unless worn`);
    assert.deepEqual(f[n].offset, f.head.offset, `${n} is centred on the head`);
    assert.ok(f[n].box[0] > f.head.box[0], `${n} has room past the head (a brim, tails)`);
  }
  const worn = figure(['hair', 'cap', 'glasses', 'moustache']);
  for (const n of ['cap', 'glasses', 'moustache', 'hair']) assert.ok(!worn[n].hidden, `${n} is worn`);
  assert.ok(worn.hat.hidden && worn.beard.hidden, 'what is not worn stays hidden');
  assert.ok(figure(['cap', 'helmet']).cap.hidden, 'a helmet hides a cap');
  assert.ok(figure(['cap', 'hat']).cap.hidden && !figure(['cap', 'hat']).hat.hidden, 'a hat hides a cap');
  const masked = figure(['mask', 'beard', 'moustache']);
  assert.ok(masked.beard.hidden && masked.moustache.hidden && !masked.mask.hidden, 'a mask hides facial hair');
  for (const style of ['bun', 'afro', 'horseshoe']) assert.ok(HAIR_STYLES.includes(style), style);
  const order = sideParts({ h: 300, bare: true, wear: [] }, style).map(p => p.name);
  const after = (a, b) => order.indexOf(a) > order.indexOf(b);
  for (const [a, b] of [['moustache', 'eye'], ['glasses', 'eye'], ['cap', 'hair'], ['helmet', 'hat'], ['mask', 'beard']]) assert.ok(after(a, b), `${a} is drawn over ${b}`);
});
