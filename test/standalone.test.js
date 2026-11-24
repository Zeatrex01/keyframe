// Gate for the standalone player (src/deliver/standalone.js): one HTML file that plays with no
// studio, no server and no network, on the same engine that the studio uses.
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { bundleEngine, moduleFactory, standalonePlayer, standalonePlayerFor } from '../src/deliver/standalone.js';
import { compileSkeleton, sample } from '../src/engine/index.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
const SKELETON = JSON.parse(fs.readFileSync(new URL('ident.json', FIXTURE), 'utf8'));

function loadBundle() {
  const context = vm.createContext({});
  vm.runInContext(`${bundleEngine()}\n;globalThis.__require = __require;`, context);
  return context.__require;
}

test('the bundled engine poses exactly as the engine modules do', () => {
  const require = loadBundle();
  const engine = require('engine/index.js');
  assert.equal(typeof require('engine/canvas.js').createCanvasRenderer, 'function');
  assert.equal(typeof require('engine/keyframe-format.js').toSkeletonJson, 'function');
  const ours = compileSkeleton(SKELETON), bundled = engine.compileSkeleton(SKELETON);
  for (const [name, animation] of ours.animations) {
    const times = [0, animation.duration / 3, animation.duration];
    assert.deepEqual(JSON.parse(JSON.stringify(engine.sample(bundled, name, times))), JSON.parse(JSON.stringify(sample(ours, name, times))), name);
  }
});

test('the page needs nothing from outside: no script, style, image or fetch from another URL', () => {
  const html = standalonePlayerFor(fileURLPath('ident.json'));
  assert.doesNotMatch(html, /\b(src|href)\s*=\s*["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /\bfetch\(|(?<![{<(])\bimport\(/, 'no network or module loads (JSDoc type imports aside)');
  assert.match(html, /data:image\/png;base64,/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.ok(html.includes('"dongu"'), 'the skeleton is inside');
});

test('data cannot close the script element; the background is a colour', () => {
  const skeleton = { ...SKELETON, animations: { '</script><script>alert(1)</script>': SKELETON.animations[Object.keys(SKELETON.animations)[0]] } };
  const html = standalonePlayer({ skeleton, atlasText: fs.readFileSync(new URL('ident.atlas', FIXTURE), 'utf8'), pages: { 'ident.png': fs.readFileSync(new URL('ident.png', FIXTURE)) } });
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.throws(() => standalonePlayer({ skeleton, atlasText: '', pages: {}, background: 'red;} body{display:none' }), { code: 'bad-argument' });
});

test('a missing atlas or page is refused by name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-standalone-'));
  fs.copyFileSync(fileURLPath('ident.json'), path.join(dir, 'ident.json'));
  assert.throws(() => standalonePlayerFor(path.join(dir, 'ident.json')), { code: 'file-not-found' });
  fs.copyFileSync(fileURLPath('ident.atlas'), path.join(dir, 'ident.atlas'));
  assert.throws(() => standalonePlayerFor(path.join(dir, 'ident.json')), /ident\.png is missing/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the bundler turns module syntax into a registry factory and refuses forms it does not handle', () => {
  const { body, deps } = moduleFactory("import { a, b as c } from './x.js';\nexport { d } from '../y/z.js';\nexport function f() { return a + c; }\nconst g = 1;\nexport { g as h };\n", 'engine/m.js');
  assert.deepEqual(deps, ['y/z.js', 'engine/x.js']);
  assert.match(body, /const \{ a, b: c \} = __require\("engine\/x.js"\)/);
  assert.match(body, /return \{ .*"d": __re0\.d.*"f": f.*\}/s);
  assert.match(body, /"h": g/);
  assert.throws(() => moduleFactory("import x from './x.js';\n", 'engine/m.js'), { code: 'bad-argument' });
  assert.throws(() => moduleFactory("import { x } from 'node:fs';\n", 'engine/m.js'), { code: 'bad-argument' });
});

function fileURLPath(name) { return fileURLToPath(new URL(name, FIXTURE)); }
