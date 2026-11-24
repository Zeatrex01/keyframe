// The page's look comes from one token file (web/tokens.css, the design system's tokens as they
// are). These gates keep the stylesheets on it: no colour or size from an old private name, every
// bundled font file present, licensed and kept by the installed app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const WEB = new URL('../web/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, WEB), 'utf8');
const sheets = fs.readdirSync(WEB).filter(n => n.endsWith('.css'));
const scripts = fs.readdirSync(WEB).filter(n => n.endsWith('.js'));

/** Custom properties a stylesheet defines (`--name:`). */
const definedIn = css => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));

test('every custom property the page uses is a token, or a local one the page sets itself', () => {
  const tokens = definedIn(read('tokens.css'));
  // A few properties carry a live value, not a design decision: a stylesheet or a page module sets them.
  const local = new Set(sheets.filter(n => n !== 'tokens.css').flatMap(n => [...definedIn(read(n))]));
  for (const js of scripts) for (const m of read(js).matchAll(/setProperty\('(--[\w-]+)'/g)) local.add(m[1]);
  const unknown = [];
  for (const name of sheets) {
    for (const m of read(name).matchAll(/var\((--[\w-]+)/g)) if (!tokens.has(m[1]) && !local.has(m[1])) unknown.push(`${name}: ${m[1]}`);
  }
  assert.deepEqual(unknown, []);
  // A local property never shadows a token: a token's name means the token everywhere.
  const shadowed = [...local].filter(n => tokens.has(n));
  assert.deepEqual(shadowed, []);
});

test('the old private palette is gone', () => {
  for (const name of sheets.filter(n => n !== 'tokens.css')) {
    assert.doesNotMatch(read(name), /var\(--(ground|panel2?|raised|sunk|ink2?|muted|faint|gold(q|-ink)?|cur|r[123]|nav-h|sans|mono)\)/, name);
    assert.doesNotMatch(read(name), /^:root\s*\{/m, `${name} defines its own :root palette`);
  }
});

test('every font file the tokens name exists, is licensed and is cached by the installed app', () => {
  const tokens = read('tokens.css');
  const sw = read('sw.js');
  const files = [...tokens.matchAll(/url\("fonts\/([\w.-]+\.woff2)"\)/g)].map(m => m[1]);
  assert.ok(files.length >= 6, 'three faces, Latin and Latin Extended');
  for (const file of files) {
    assert.ok(fs.existsSync(new URL(`fonts/${file}`, WEB)), file);
    assert.match(sw, new RegExp(`'/web/fonts/${file.replace(/\./g, '\\.')}'`), `${file} is in the service worker's shell`);
  }
  assert.match(sw, /'\/web\/tokens\.css'/);
  const notice = fs.readFileSync(new URL('../NOTICE', import.meta.url), 'utf8');
  for (const face of new Set(files.map(f => f.split('-')[0]))) {
    const license = new URL(`fonts/OFL-${face}.txt`, WEB);
    assert.ok(fs.existsSync(license), `${face} has its license beside it`);
    assert.match(fs.readFileSync(license, 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.match(notice, new RegExp(`OFL-${face}\\.txt`), `NOTICE lists ${face}`);
  }
});

test('the page loads the tokens before its own stylesheet and declares both colour schemes', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('href="/web/tokens.css"') > 0 && html.indexOf('href="/web/tokens.css"') < html.indexOf('href="/web/app.css"'));
  assert.match(html, /<meta name="color-scheme" content="dark light">/);
  assert.match(html, /<meta name="theme-color" content="#1B1826">/);
});
