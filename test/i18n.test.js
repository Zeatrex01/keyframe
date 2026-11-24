// The page starts in English for everyone; Turkish is a choice the viewer makes and the browser
// remembers. Every offered language has a catalog with the same keys as English.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_LANG, LANGS, startLang, translate } from '../web/i18n.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('English is the default, and a remembered language wins only when it is still offered', () => {
  assert.equal(DEFAULT_LANG, 'en');
  assert.equal(LANGS[0], 'en', 'English is listed first');
  assert.equal(startLang(null), 'en');
  assert.equal(startLang(undefined), 'en');
  assert.equal(startLang('de'), 'en');
  assert.equal(startLang(''), 'en');
  assert.equal(startLang('tr'), 'tr');
  assert.equal(startLang('en'), 'en');
});

test('a lookup fills placeholders and shows the key when the catalog lacks it', () => {
  assert.equal(translate({ a: 'Hi {name}, {n} new' }, 'a', { name: 'Ada', n: 0 }), 'Hi Ada, 0 new');
  assert.equal(translate({}, 'missing.key'), 'missing.key');
  assert.equal(translate(null, 'k'), 'k');
  assert.equal(translate({ a: '{x}' }, 'a'), '');
});

test('the page is marked English before any script runs, and English is the first choice', () => {
  const html = read('../web/index.html');
  assert.match(html, /<html lang="en">/);
  for (const group of ['settingsLang']) {
    const at = html.indexOf(`id="${group}"`);
    const first = /data-lang="(\w+)"/.exec(html.slice(at))[1];
    assert.equal(first, 'en', group);
  }
  for (const name of fs.readdirSync(new URL('../web/', import.meta.url)).filter(n => n.endsWith('.js') && n !== 'i18n.js'))
    assert.doesNotMatch(read(`../web/${name}`), /'tr'/, `${name} names no default language of its own`);
});

test('every offered language has a catalog with exactly the English keys', () => {
  const en = Object.keys(JSON.parse(read('../locale/en.json'))).sort();
  for (const lang of LANGS) {
    const keys = Object.keys(JSON.parse(read(`../locale/${lang}.json`))).sort();
    assert.deepEqual(keys, en, lang);
  }
});
