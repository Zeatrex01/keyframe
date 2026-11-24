// The stage flips between a delivery and the base it was written onto (decided
// 2026-11-24: a source/result toggle). The server still proposes what to show; the owner's
// flip holds until the server proposes something new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { counterpart, stageFile } from '../web/stage-pick.js';

const SKELETONS = [
  { file: 'cat.json', role: 'base' },
  { file: 'cat_v2.json', role: 'delivery', deliveryOf: 'cat.json', modified: 2 },
  { file: 'cat_old.json', role: 'delivery', deliveryOf: 'cat.json', modified: 1 },
  { file: 'dog/dog.json', role: 'base' },
  { file: 'dog/dog_v2.json', role: 'delivery', deliveryOf: 'dog.json', modified: 5 },
  { file: 'lone.json', role: 'base' },
  { file: 'orphan_v2.json', role: 'delivery', deliveryOf: 'gone.json', modified: 9 },
  { file: 'hero_v2.json', role: 'base' },
];

test('a delivery flips to its base, a base to its newest delivery, in the same folder', () => {
  assert.equal(counterpart(SKELETONS, 'cat_v2.json').file, 'cat.json');
  assert.equal(counterpart(SKELETONS, 'cat.json').file, 'cat_v2.json', 'the newest delivery');
  assert.equal(counterpart(SKELETONS, 'dog/dog_v2.json').file, 'dog/dog.json');
  assert.equal(counterpart(SKELETONS, 'dog/dog.json').file, 'dog/dog_v2.json');
});

test('nothing to flip to: a base with no delivery, a delivery whose base is gone, an unknown file', () => {
  assert.equal(counterpart(SKELETONS, 'lone.json'), null);
  assert.equal(counterpart(SKELETONS, 'hero_v2.json'), null, 'an owner file named _v2 is a base');
  assert.equal(counterpart(SKELETONS, 'orphan_v2.json'), null);
  assert.equal(counterpart(SKELETONS, 'nope.json'), null);
  assert.equal(counterpart([{ file: 'x_v2.json', role: 'delivery' }], 'x_v2.json'), null, 'a delivery that does not name its base');
});

test('the stage shows the owner\'s flip only while it is the other side of the proposal', () => {
  assert.equal(stageFile(SKELETONS, 'cat_v2.json', null), 'cat_v2.json');
  assert.equal(stageFile(SKELETONS, 'cat_v2.json', 'cat.json'), 'cat.json', 'flipped to the base');
  assert.equal(stageFile(SKELETONS, 'cat.json', 'cat_v2.json'), 'cat_v2.json', 'flipped to the result');
  assert.equal(stageFile(SKELETONS, 'cat_v2.json', 'dog/dog.json'), 'dog/dog.json', 'any skeleton of the project can be picked in the file menu');
  assert.equal(stageFile(SKELETONS, 'cat_v2.json', 'gone.json'), 'cat_v2.json');
  assert.equal(stageFile(SKELETONS, null, 'cat.json'), null, 'nothing proposed, nothing shown');
});

test('the page wires the Original / Result switch, a new proposal clears the flip, and both languages name it', () => {
  const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const html = read('../web/index.html'), app = fs.readdirSync(new URL('../web/', import.meta.url)).filter(n => n.endsWith('.js')).map(n => read(`../web/${n}`)).join('\n'); // the page's modules
  assert.match(html, /<div class="flip" role="group" id="stageFlip"/);
  for (const id of ['flipSource', 'flipResult', 'deliveryFlip']) {
    assert.match(html, new RegExp(`<button type="button" [^>]*id="${id}"`), id);
    assert.match(app, new RegExp(`el\\.${id}\\.addEventListener\\('click', flipStage\\)`), id);
  }
  assert.match(app, /if \(askedAnew\) S\.picked = null;/);
  assert.match(app, /stageFile\(state\.skeletons, show\?\.file \?\? null, S\.picked\)/);
  assert.match(read('../web/sw.js'), /'\/web\/stage-pick\.js'/, 'the installed app caches the module');
  for (const lang of ['en', 'tr']) {
    const dict = JSON.parse(read(`../locale/${lang}.json`));
    for (const key of ['stage.original', 'stage.result', 'stage.showSource', 'stage.showResult', 'delivery.sourceHasResult']) assert.ok(dict[key], `${lang}.json lacks ${key}`);
  }
});
