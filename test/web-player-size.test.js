// Gate for the embeddable web player's canvas size (src/deliver/web-player-boot.js): a canvas with
// no CSS size keeps its size at any device pixel ratio instead of growing on every frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineKeyframePlayer } from '../src/deliver/web-player-boot.js';
import * as engine from '../src/engine/index.js';
import * as canvasMod from '../src/engine/canvas.js';
import * as format from '../src/engine/keyframe-format.js';

const DIR = fileURLToPath(new URL('../examples/showcase/play-button/', import.meta.url));

/** A canvas laid out the way a browser lays it out: at its CSS size, else at its attributes. */
function fakeCanvas(width, height, css = {}) {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
  return { width, height, style: { ...css }, getContext: () => ctx,
    get clientWidth() { return this.style.width ? parseFloat(this.style.width) : this.width; },
    get clientHeight() { return this.style.height ? parseFloat(this.style.height) : this.height; } };
}

test('a canvas with no CSS size keeps its size at a display scale above 1; a CSS-sized one is drawn sharp at its CSS size', () => {
  const frames = [];
  const saved = { window: globalThis.window, document: globalThis.document, raf: globalThis.requestAnimationFrame };
  globalThis.window = { devicePixelRatio: 1.25 };
  globalThis.document = { createElement: () => fakeCanvas(1, 1) };
  globalThis.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
  try {
    const mods = { 'engine/index.js': engine, 'engine/canvas.js': canvasMod, 'engine/keyframe-format.js': format };
    const KeyframePlayer = defineKeyframePlayer(id => mods[id]);
    const json = JSON.parse(fs.readFileSync(`${DIR}play-button.json`, 'utf8'));
    const atlas = engine.parseAtlas(fs.readFileSync(`${DIR}play-button.atlas`, 'utf8'));
    const pages = new Map(atlas.pages.map(p => [p.name, { width: 512, height: 512 }]));
    const bare = fakeCanvas(300, 150);
    const player = new KeyframePlayer(bare, json, atlas, pages, {});
    for (let i = 0; i < 20; i++) player.render();
    assert.deepEqual([bare.width, bare.height], [375, 188], 'drawn at the pixel ratio, once');
    assert.deepEqual([bare.style.width, bare.style.height], ['300px', '150px'], 'its laid-out size is kept');
    const sized = fakeCanvas(300, 150, { width: '640px', height: '360px' });
    const other = new KeyframePlayer(sized, json, atlas, pages, {});
    for (let i = 0; i < 5; i++) other.render();
    assert.deepEqual([sized.width, sized.height, sized.style.width], [800, 450, '640px']);
  } finally {
    globalThis.window = saved.window; globalThis.document = saved.document; globalThis.requestAnimationFrame = saved.raf;
  }
});

test('a first frame stamped before the player started does not stop the player (browsers stamp the frame start)', () => {
  const frames = [];
  const saved = { window: globalThis.window, document: globalThis.document, raf: globalThis.requestAnimationFrame };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.document = { createElement: () => fakeCanvas(1, 1) };
  globalThis.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
  try {
    const mods = { 'engine/index.js': engine, 'engine/canvas.js': canvasMod, 'engine/keyframe-format.js': format };
    const KeyframePlayer = defineKeyframePlayer(id => mods[id]);
    const json = JSON.parse(fs.readFileSync(`${DIR}play-button_v2.json`, 'utf8'));
    const atlas = engine.parseAtlas(fs.readFileSync(`${DIR}play-button_v2.atlas`, 'utf8'));
    const pages = new Map(atlas.pages.map(p => [p.name, { width: 512, height: 512 }]));
    const player = new KeyframePlayer(fakeCanvas(200, 200), json, atlas, pages, { animation: 'idle' });
    assert.ok(player.duration > 0.1, 'a clip plays');
    assert.doesNotThrow(() => player.frame(player.last - 8), 'an earlier stamp is a zero step');
    assert.equal(player.time, 0);
    player.frame(player.last + 100);
    assert.ok(Math.abs(player.time - 0.1) < 1e-9, 'and time moves on from there');
  } finally {
    globalThis.window = saved.window; globalThis.document = saved.document; globalThis.requestAnimationFrame = saved.raf;
  }
});
