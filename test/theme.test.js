// The theme: System (the default), Dark or Light, chosen in Settings and remembered in this browser.
// web/theme.js holds the rule; web/boot.js applies the same rule before the first paint, so these
// gates run both and require the same answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { THEMES, DEFAULT_THEME, THEME_KEY, startTheme, themeAttribute } from '../web/theme.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a stored choice resolves to the attribute on <html>; anything else follows the system', () => {
  assert.deepEqual(THEMES, ['system', 'dark', 'light']);
  assert.equal(DEFAULT_THEME, 'system');
  assert.equal(themeAttribute('dark'), 'dark');
  assert.equal(themeAttribute('light'), 'light');
  assert.equal(themeAttribute('system'), null);
  for (const odd of [null, undefined, '', 'sepia', 'DARK']) {
    assert.equal(themeAttribute(odd), null, String(odd));
    assert.equal(startTheme(odd), 'system', String(odd));
  }
});

/** Run web/boot.js against a stand-in page and return the data-theme it set (or null). */
function bootWith(stored, { throws = false } = {}) {
  const attributes = {};
  const sandbox = {
    localStorage: { getItem: key => { if (throws) throw new Error('blocked'); return key === THEME_KEY ? stored : null; } },
    document: { documentElement: { setAttribute: (k, v) => { attributes[k] = v; } }, getElementById: () => null, body: { dataset: {} } },
    window: { addEventListener() {} },
    setTimeout() {},
  };
  vm.runInNewContext(read('../web/boot.js'), sandbox);
  return attributes['data-theme'] ?? null;
}

test('the start guard applies the same rule before the first paint', () => {
  for (const stored of [...THEMES, null, 'sepia']) assert.equal(bootWith(stored), themeAttribute(stored), String(stored));
  assert.equal(bootWith('dark', { throws: true }), null, 'blocked storage leaves it to the system');
  const html = read('../web/index.html');
  assert.ok(html.indexOf('src="/web/boot.js"') < html.indexOf('</head>'), 'the guard runs in <head>, before the body paints');
  assert.match(read('../web/sw.js'), /'\/web\/theme\.js'/);
});

test('Settings offers the three themes beside the language, in every catalog', () => {
  const html = read('../web/index.html');
  const group = html.slice(html.indexOf('id="settingsTheme"'));
  assert.deepEqual([...group.matchAll(/data-theme-choice="(\w+)"/g)].slice(0, 3).map(m => m[1]), THEMES);
  for (const lang of ['en', 'tr']) {
    const dict = JSON.parse(read(`../locale/${lang}.json`));
    for (const key of ['settings.appearanceTitle', 'settings.theme', 'settings.themeLead', 'settings.themeSystem', 'settings.themeDark', 'settings.themeLight'])
      assert.ok(dict[key], `${lang}: ${key}`);
  }
});
