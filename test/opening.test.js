// The opening in examples/opening: the brand mark's intro, drawn with draw_rig and written with
// write_animation and add_effect. The brand asks for the ghosts sliding in and the key landing with
// a ~10% overshoot that settles by 0.9 s, the name after it, and the finished lockup at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileSkeleton, sample } from '../src/engine/index.js';
import { checkSkeleton } from '../src/spine/check.js';
import { critiqueAnimation } from '../src/understand/critique.js';

const read = name => fs.readFileSync(new URL(`../examples/opening/${name}`, import.meta.url), 'utf8');
const skeleton = JSON.parse(read('mark_v2.json'));
const model = compileSkeleton(skeleton);
const at = t => sample(model, 'intro', [t])[0];
const bone = (s, name) => s.bones.find(b => b.name === name);
const alpha = (s, name) => s.slots.find(x => x.name === name).color.a;
const PARTS = ['ghost1', 'ghost2', 'key', 'word_keyframe', 'word_studio'];

test('opening: the rig is the brand lockup, drawn by the studio, and its atlas is the one shipped', () => {
  assert.deepEqual(JSON.parse(read('mark.parts.json')).parts.map(p => p.name), PARTS, 'the drawing board source lists the five parts back to front');
  assert.match(read('mark_v2.atlas'), /^mark\.png\n/, 'the delivery reads the shipped page');
  assert.deepEqual(checkSkeleton(skeleton), [], 'the opening has check findings');
  assert.notEqual(critiqueAnimation(skeleton, 'intro').verdict, 'poor');
});

test('opening: everything starts hidden, the key lands with a ~10% overshoot and settles by 0.9 s', () => {
  const duration = model.animations.get('intro').duration;
  assert.ok(duration >= 0.9 && duration <= 1.4, `the intro lasts ${duration} s; the brand asks for a short one`);
  const first = at(0);
  for (const name of PARTS) assert.equal(alpha(first, name), 0, `${name} shows before the intro starts`);
  const peak = Math.max(...[0.3, 0.35, 0.4, 0.45, 0.5, 0.55].map(t => bone(at(t), 'key').worldScaleX));
  assert.ok(peak > 1.06 && peak < 1.14, `the key lands at ${peak.toFixed(3)} of its size, not ~1.10`);
  const settled = at(0.9), setup = skeleton.bones.find(b => b.name === 'key');
  assert.ok(Math.abs(bone(settled, 'key').worldScaleX - 1) < 0.005, 'the key has not settled by 0.9 s');
  assert.ok(Math.abs(bone(settled, 'key').worldX - setup.x) < 0.5, 'the key is not home by 0.9 s');
});

test('opening: the name follows the mark, and the last frame is the finished lockup', () => {
  assert.equal(alpha(at(0.45), 'word_keyframe'), 0, 'the name shows before the key lands');
  assert.ok(alpha(at(0.7), 'word_keyframe') > alpha(at(0.7), 'word_studio'), '"Studio" does not follow "Keyframe"');
  const last = at(model.animations.get('intro').duration);
  for (const name of PARTS) {
    assert.equal(alpha(last, name), 1, `${name} is not fully shown at the end`);
    const b = bone(last, name), setup = skeleton.bones.find(x => x.name === name);
    assert.ok(Math.abs(b.worldX - setup.x) < 0.01 && Math.abs(b.worldY - setup.y) < 0.01, `${name} ends off its place`);
  }
  assert.equal(alpha(last, 'key_flash'), 0, 'the landing flash is still lit at the end');
});

test('opening: the splash is always on the dark ground, so the light wordmark reads in either theme', () => {
  const web = name => fs.readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8');
  assert.match(web('index.html'), /<div class="splash" id="splash" data-ground="dark">/);
  const dark = /\n([^\n{]*)\{\s*color-scheme: dark;([^}]*)\}/.exec(web('tokens.css'));
  assert.ok(dark && dark[1].includes('[data-ground="dark"]'), 'the dark tokens do not reach [data-ground="dark"]');
  assert.match(dark[2], /--bg: #14121C/);
  assert.match(/\n\.splash \{([^}]*)\}/.exec(web('views.css'))?.[1] ?? '', /background: var\(--bg\)/);
});

test('opening: the class that shows the playing intro is the splash\'s own, so no other rule lays it out', () => {
  // It was `live`, which the chat's live row styles with margins: the splash shrank while it played.
  const web = name => fs.readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8');
  const state = /el\.splash\.classList\.add\('([\w-]+)'\)/.exec(web('views.js'))?.[1];
  assert.ok(state, 'the opening marks the splash while it plays');
  const css = fs.readdirSync(new URL('../web/', import.meta.url)).filter(n => n.endsWith('.css')).map(web).join('\n');
  assert.doesNotMatch(css, new RegExp(`(^|[\\s,}>+~])\\.${state}\\b`, 'm'), `.${state} is styled on its own somewhere`);
  assert.match(css, new RegExp(`\\.splash\\.${state} `));
});

test('opening: a click on the fading splash does not fall through, and the worker waits for the studio', () => {
  const web = name => fs.readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8');
  // A double click to skip it opened an example under it on the first run.
  assert.doesNotMatch(/\n\.splash\.out \{([^}]*)\}/.exec(web('views.css'))?.[1] ?? 'missing', /pointer-events:\s*none/);
  // Registered while the studio was still starting, the worker failed on every start.
  const app = web('app.js');
  const online = app.indexOf('while (!S.online)'), register = app.indexOf("serviceWorker.register('/sw.js')");
  assert.ok(online > 0 && register > online, 'the service worker is registered before the studio answers');
});
