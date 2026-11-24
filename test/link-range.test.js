// The page's link form takes an optional part of the video (from / to). The fields read time the way
// a video player shows it, an empty pair is the whole video, and a part the server would refuse is
// stopped on the page in the page language. The server still checks every range (checkRange).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readTime, linkRange } from '../web/link-text.js';
import { checkRange } from '../src/core/ytdlp.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a time field reads seconds, m:ss and h:mm:ss; empty is not given; anything else is NaN', () => {
  assert.equal(readTime(''), undefined);
  assert.equal(readTime('   '), undefined);
  assert.equal(readTime(undefined), undefined);
  assert.equal(readTime('90'), 90);
  assert.equal(readTime(' 12.5 '), 12.5);
  assert.equal(readTime('0'), 0);
  assert.equal(readTime('1:30'), 90);
  assert.equal(readTime('0:05.25'), 5.25);
  assert.equal(readTime('1:02:03'), 3723);
  assert.equal(readTime('1:02:03.5'), 3723.5);
  for (const bad of ['-1', 'abc', '1:60', '1:2:60', '1::2', ':30', '1:30:', '1e3', '0x10', '1,5', '1:2:3:4', 'Infinity', '.5', '5.'])
    assert.ok(Number.isNaN(readTime(bad)), bad);
});

test('the range is {} for the whole video, keeps only the fields given, and is null when it cannot be cut', () => {
  assert.deepEqual(linkRange('', ''), {});
  assert.deepEqual(linkRange('1:00', ''), { from: 60 });
  assert.deepEqual(linkRange('', '45'), { to: 45 });
  assert.deepEqual(linkRange('0:30', '1:15.5'), { from: 30, to: 75.5 });
  assert.equal(linkRange('20', '10'), null, 'start after end');
  assert.equal(linkRange('10', '10'), null, 'empty part');
  assert.equal(linkRange('', '0'), null, 'an end at zero leaves nothing');
  assert.equal(linkRange('x', ''), null);
  assert.equal(linkRange('', '1:75'), null);
});

test('every range the page sends is one the server accepts unchanged', () => {
  for (const [a, b] of [['', ''], ['0', ''], ['1:00', ''], ['', '45'], ['0:30', '1:15.5'], ['1:02:03', '1:02:04.25']]) {
    const range = linkRange(a, b);
    const checked = checkRange(range.from, range.to);
    if (range.from === undefined && range.to === undefined) assert.equal(checked, null);
    else assert.deepEqual(checked, { from: range.from ?? 0, to: range.to });
  }
});

test('the page has the two fields with labels in both languages and sends the range with the link', () => {
  const html = read('../web/index.html');
  const app = fs.readdirSync(new URL('../web/', import.meta.url)).filter(n => n.endsWith('.js')).map(n => read(`../web/${n}`)).join('\n'); // the page's modules
  for (const id of ['refFrom', 'refTo']) {
    assert.match(html, new RegExp(`<input [^>]*id="${id}"`));
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
  }
  for (const lang of ['en', 'tr']) {
    const dict = JSON.parse(read(`../locale/${lang}.json`));
    for (const key of ['ref.linkFrom', 'ref.linkTo', 'ref.linkToPlaceholder', 'ref.linkRangeBad'])
      assert.ok(typeof dict[key] === 'string' && dict[key].length > 0, `${lang}.json lacks ${key}`);
  }
  assert.match(app, /linkRange\(el\.refFrom\.value, el\.refTo\.value\)/);
  assert.match(app, /if \(!range\) \{[^}]*t\('ref\.linkRangeBad'\)[^}]*return;/);
  assert.match(app, /JSON\.stringify\(\{ url, \.\.\.range \}\)/);
});
