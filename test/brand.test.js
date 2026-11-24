// The brand on the page: the installed app's icons are the sizes the manifest says, and the mark
// in the page is the keyframe with its two onion-skin ghosts, drawn in the theme's colours.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const WEB = new URL('../web/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, WEB), 'utf8');

/** Width and height from a PNG's header. */
function pngSize(bytes) {
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', 'a PNG file');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('every manifest icon exists and has the size it declares', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'), 'a maskable icon for Android');
  for (const icon of manifest.icons) {
    const file = new URL(`..${icon.src}`, WEB);
    assert.ok(fs.existsSync(file), icon.src);
    if (icon.type === 'image/svg+xml') { assert.equal(icon.sizes, 'any'); continue; }
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(fs.readFileSync(file)), { width: w, height: h }, icon.src);
  }
  assert.equal(manifest.theme_color, '#1B1826');
  assert.doesNotMatch(manifest.description, /Spine/, 'the studio is described by what it does, not by one file format');
});

test('the mark is three paths: two violet ghosts and the amber key, themed by tokens', () => {
  const html = read('index.html');
  const symbol = /<symbol id="logo" viewBox="0 0 64 64">([\s\S]*?)<\/symbol>/.exec(html)?.[1];
  assert.ok(symbol, 'the #logo symbol');
  const paths = [...symbol.matchAll(/<path [^>]*>/g)].map(m => m[0]);
  assert.equal(paths.length, 3);
  assert.match(paths[0], /stroke="var\(--agent\)"/);
  assert.match(paths[1], /stroke="var\(--agent\)"/);
  assert.match(paths[2], /fill="var\(--accent\)"/);
  assert.doesNotMatch(symbol, /#[0-9a-f]{3,6}\b/i, 'no fixed colour, so the mark follows the theme');
});

test('the favicon and the name in the bar are the brand\'s', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/web\/icons\/favicon\.svg">/);
  assert.ok(fs.existsSync(new URL('icons/favicon.svg', WEB)));
  assert.match(read('sw.js'), /'\/web\/icons\/favicon\.svg'/);
  assert.match(html, /class="brand[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*Keyframe <span>Studio<\/span>/);
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const file of ['docs/brand/intro.gif', 'docs/brand/intro.html']) assert.ok(readme.includes(file), `README shows ${file}`);
  for (const file of ['docs/brand/lockup.svg', 'docs/brand/lockup-on-light.svg', 'docs/brand/intro.gif', 'docs/brand/intro.html', 'docs/brand/social-preview.png']) {
    assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), file);
  }
});
