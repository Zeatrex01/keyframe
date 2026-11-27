// Aseprite import: the reader follows the published file format (every colour depth, linked and
// raw cels, groups, tags, both palette chunks), the drawing draws every pixel exactly, and the rig
// draw_rig builds from a file plays every tag's frames pixel for pixel as Aseprite composes them,
// magnified without smoothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAseprite, asepriteDrawing, pixelsToSvg, tagFrames } from '../src/render/aseprite.js';
import { rasterizeSvg } from '../src/engine/svg.js';
import { renderFrames } from '../src/render/frames.js';
import { decodePng } from '../src/render/png.js';
import { createServer } from '../src/mcp/server.js';
import { createCanvasRenderer } from '../src/engine/canvas.js';
import { godotScene } from '../src/engine/godot.js';
import { asepriteFile, sprite } from './helpers/aseprite-file.js';

const KEY = { '.': null, a: [200, 40, 50], b: [30, 90, 200], c: [250, 220, 60], d: [20, 20, 30], e: [90, 200, 120, 128] };
const img = rows => sprite(rows, KEY);
const BLOCK = img(['aaaa', 'abba', 'abba', 'aaaa']);
const DOT = img(['cd', 'dc']);
const BAR = img(['eeeeee']);

/** A 16x12 sprite, four frames: a still block, a dot that moves, a bar that blinks, a ghost at half opacity, and layers that are left out. */
function sample({ depth = 32, durations = [100, 150, 80, 120], tags } = {}) {
  const layers = [
    { name: 'block' },
    { name: 'grp', type: 'group' },
    { name: 'dot', level: 1 },
    { name: 'bar', level: 1 },
    { name: 'ghost', opacity: 128 },
    { name: 'hidden', visible: false },
    { name: 'ref', reference: true },
    { name: 'tiles', type: 'tilemap' },
  ];
  const frames = durations.map((duration, f) => ({ duration, cels: [
    f === 0 ? { layer: 0, x: 2, y: 6, ...BLOCK } : { layer: 0, link: 0 },
    { layer: 2, x: 4 + f, y: 2 + (f % 2), ...DOT },
    ...(f % 2 === 0 ? [{ layer: 3, x: 8, y: 9, ...BAR }] : []),
    { layer: 4, x: 10, y: 3, opacity: f === 3 ? 200 : 255, ...BLOCK },
    { layer: 5, x: 0, y: 0, ...DOT },
    { layer: 6, x: 0, y: 0, ...DOT },
  ] }));
  const spec = { width: 16, height: 12, layers, frames, tags: tags ?? [
    { name: 'fwd', from: 0, to: 3 }, { name: 'rev', from: 0, to: 3, direction: 'reverse' },
    { name: 'pp', from: 0, to: 3, direction: 'pingpong' }, { name: 'ppr', from: 1, to: 3, direction: 'pingpong-reverse' }] };
  if (depth === 8) return asepriteFile(indexed(spec));
  return asepriteFile(spec);
}

/** The same sprite as an indexed file: entry 0 is the clear one. */
function indexed(spec) {
  const palette = [[0, 0, 0, 0]], at = new Map();
  const frames = spec.frames.map(fr => ({ ...fr, cels: fr.cels.map(c => {
    if (!c.pixels) return c;
    const out = new Uint8Array(c.width * c.height);
    for (let i = 0; i < out.length; i++) {
      const px = c.pixels.slice(i * 4, i * 4 + 4);
      if (!px[3]) continue;
      const key = px.join(',');
      if (!at.has(key)) { at.set(key, palette.length); palette.push([...px]); }
      out[i] = at.get(key);
    }
    return { ...c, pixels: out };
  }) }));
  return { ...spec, depth: 8, transparent: 0, palette, frames };
}

/** What Aseprite shows for a frame: the visible image layers, bottom up, normal blend, layer x cel opacity. Straight RGBA 0..1. */
function composite(ase, f) {
  const { width: W, height: H } = ase, out = new Float64Array(W * H * 4);
  const shown = l => { for (let q = l; q; q = q.parent === null ? null : ase.layers[q.parent]) if (!q.visible) return false; return !l.reference && l.type === 'image'; };
  for (const l of ase.layers) {
    if (!shown(l)) continue;
    const c = ase.cels.find(q => q.layer === l.index && q.frame === f);
    if (!c) continue;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const X = c.x + x, Y = c.y + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const s = (y * c.width + x) * 4, a = c.data[s + 3] / 255 * c.opacity * l.opacity, o = (Y * W + X) * 4;
      const outA = a + out[o + 3] * (1 - a);
      for (let k = 0; k < 3; k++) out[o + k] = outA ? (c.data[s + k] / 255 * a + out[o + k] * out[o + 3] * (1 - a)) / outA : 0;
      out[o + 3] = outA;
    }
  }
  return out;
}

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kf-ase-'));
function tools(dir) {
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
  return async (/** @type {string} */ name, /** @type {object} */ args, { fails = false } = {}) => {
    sent.length = 0;
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const r = sent[0].result;
    if (fails) { assert.ok(r.isError, `${name} should refuse`); return r.content?.[0]?.text ?? ''; }
    assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
    return r.structuredContent;
  };
}

test('the reader reads layers, groups, linked cels, durations, tags and both colour models alike', () => {
  for (const depth of [32, 8]) {
    const ase = readAseprite(sample({ depth }));
    assert.deepEqual([ase.width, ase.height, ase.depth], [16, 12, depth]);
    assert.deepEqual(ase.frames.map(f => f.duration), [0.1, 0.15, 0.08, 0.12]);
    assert.deepEqual(ase.layers.map(l => [l.name, l.type, l.parent, l.visible]), [['block', 'image', null, true], ['grp', 'group', null, true], ['dot', 'image', 1, true],
      ['bar', 'image', 1, true], ['ghost', 'image', null, true], ['hidden', 'image', null, false], ['ref', 'image', null, true], ['tiles', 'tilemap', null, true]]);
    assert.ok(ase.layers[6].reference);
    assert.equal(ase.layers[4].opacity, 128 / 255);
    const block = ase.cels.filter(c => c.layer === 0);
    assert.equal(block.length, 4, 'linked cels are read in every frame');
    assert.deepEqual(block.map(c => c.linked), [false, true, true, true]);
    assert.deepEqual([...block[3].data.slice(0, 8)], [200, 40, 50, 255, 200, 40, 50, 255]);
    assert.deepEqual([...ase.cels.find(c => c.layer === 4 && c.frame === 0).data.slice(20, 24)], [30, 90, 200, 255]);
    assert.equal(ase.cels.find(c => c.layer === 4 && c.frame === 3).opacity, 200 / 255);
    assert.deepEqual(ase.tags.map(t => [t.name, t.from, t.to, t.direction]), [['fwd', 0, 3, 'forward'], ['rev', 0, 3, 'reverse'], ['pp', 0, 3, 'pingpong'], ['ppr', 1, 3, 'pingpong-reverse']]);
  }
  // Indexed: the clear entry is clear on a layer and drawn on the background; the old palette chunk; a raw cel.
  const file = asepriteFile({ width: 2, height: 1, depth: 8, transparent: 1, oldPalette: true, palette: [[10, 20, 30], [40, 50, 60], [70, 80, 90]],
    layers: [{ name: 'bg', background: true }, { name: 'top' }],
    frames: [{ cels: [{ layer: 0, width: 2, height: 1, pixels: [1, 2], raw: true }, { layer: 1, width: 2, height: 1, pixels: [1, 0] }] }] });
  const small = readAseprite(file);
  assert.deepEqual([...small.cels[0].data], [40, 50, 60, 255, 70, 80, 90, 255], 'the background draws its clear entry');
  assert.deepEqual([...small.cels[1].data], [0, 0, 0, 0, 10, 20, 30, 255], 'another layer leaves it clear');
  assert.deepEqual(small.palette, [[10, 20, 30, 255], [40, 50, 60, 255], [70, 80, 90, 255]]);
  // Grayscale: value and alpha.
  const gray = readAseprite(asepriteFile({ width: 1, height: 1, depth: 16, layers: [{ name: 'g' }], frames: [{ cels: [{ layer: 0, width: 1, height: 1, pixels: [77, 200] }] }] }));
  assert.deepEqual([...gray.cels[0].data], [77, 77, 77, 200]);
  // A group's opacity counts only when the header says so (flag 2).
  const groups = flags => readAseprite(asepriteFile({ width: 1, height: 1, flags, layers: [{ name: 'g', type: 'group', opacity: 100, blend: 1 }, { name: 'x', level: 1, opacity: 50 }], frames: [{}] }));
  assert.deepEqual(groups(1).layers.map(l => [l.opacity, l.blend]), [[1, 0], [50 / 255, 0]]);
  assert.deepEqual(groups(3).layers.map(l => [l.opacity, l.blend]), [[100 / 255, 1], [50 / 255, 0]]);
  assert.equal(groups(0).layers[1].opacity, 1, 'without flag 1 layer opacity is not valid');
});

test('the reader refuses what is not an Aseprite file, a cut file and a tag past the end', () => {
  assert.throws(() => readAseprite(Buffer.alloc(200)), { code: 'bad-aseprite' });
  const whole = sample();
  assert.throws(() => readAseprite(whole.subarray(0, 300)), { code: 'bad-aseprite' });
  assert.throws(() => readAseprite(asepriteFile({ width: 2, height: 2, layers: [{ name: 'a' }], frames: [{}], tags: [{ name: 't', from: 0, to: 3 }] })), { code: 'bad-aseprite' });
  assert.throws(() => readAseprite(asepriteFile({ width: 2, height: 2, layers: [], frames: [{}] })), { code: 'bad-aseprite' });
});

test('pixels become SVG that draws every pixel exactly, with merged runs', () => {
  const art = img(['aaab..', 'aaab..', '..cc.e', '..cc.e']);
  const svg = pixelsToSvg({ ...art, data: art.pixels }, 1, 2, 8, 7);
  assert.match(svg, /viewBox="0 0 8 7"/);
  assert.equal((svg.match(/M/g) ?? []).length, 4, 'one rectangle per colour run, merged down the rows');
  assert.match(svg, /fill-opacity="0.502"/, 'a pixel\'s own alpha is kept');
  for (const k of [1, 3]) {
    const out = rasterizeSvg(svg, { width: 8 * k, height: 7 * k });
    for (let y = 0; y < 7 * k; y++) for (let x = 0; x < 8 * k; x++) {
      const px = Math.floor(x / k) - 1, py = Math.floor(y / k) - 2;
      const inside = px >= 0 && py >= 0 && px < art.width && py < art.height;
      const want = inside ? art.pixels.slice((py * art.width + px) * 4, (py * art.width + px) * 4 + 4) : [0, 0, 0, 0];
      const o = (y * 8 * k + x) * 4;
      assert.ok(Math.abs(out.data[o + 3] - want[3]) <= 1, `alpha at ${x},${y} (x${k})`);
      if (want[3]) for (let c = 0; c < 3; c++) assert.ok(Math.abs(out.data[o + c] - want[c]) <= 1, `colour at ${x},${y} (x${k})`);
    }
  }
  // Layer and cel opacity multiply every pixel.
  const one = img(['a']);
  assert.match(pixelsToSvg({ ...one, data: one.pixels }, 0, 0, 1, 1, 0.5), /fill-opacity="0.502"/);
});

test('tags play in their direction; clips step at the file\'s durations and end on the last moment', () => {
  assert.deepEqual(tagFrames({ from: 2, to: 5, direction: 'forward' }), [2, 3, 4, 5]);
  assert.deepEqual(tagFrames({ from: 2, to: 5, direction: 'reverse' }), [5, 4, 3, 2]);
  assert.deepEqual(tagFrames({ from: 2, to: 5, direction: 'pingpong' }), [2, 3, 4, 5, 4, 3]);
  assert.deepEqual(tagFrames({ from: 2, to: 5, direction: 'pingpong-reverse' }), [5, 4, 3, 2, 3, 4]);
  const d = asepriteDrawing(readAseprite(sample()), { file: 'art/x.aseprite' });
  assert.deepEqual(d.parts.map(p => p.name), ['block', 'dot', 'bar', 'ghost']);
  assert.deepEqual(d.skipped, ['hidden: hidden', 'ref: a reference layer', 'tiles: a tilemap layer']);
  assert.deepEqual(d.parts.map(p => p.frames?.length ?? 1), [1, 4, 1, 2], 'a layer becomes a flipbook only when its cels differ');
  assert.deepEqual(d.parts[0].source, { aseprite: 'art/x.aseprite', layer: 'block' });
  assert.deepEqual(d.parts[0].at, [2 + 2 - 8, 12 - (6 + 2)], 'canvas bottom centre is the origin, y up');
  const fwd = d.clips.fwd;
  assert.deepEqual(fwd.attachments.default.dot.dot.sequence.map(k => [k.time, k.index, k.mode]), [[0, 0, 'hold'], [0.1, 1, 'hold'], [0.25, 2, 'hold'], [0.33, 3, 'hold'], [0.45, 3, 'hold']]);
  assert.deepEqual(fwd.slots.bar.attachment, [{ time: 0, name: 'bar' }, { time: 0.1, name: null }, { time: 0.25, name: 'bar' }, { time: 0.33, name: null }, { time: 0.45, name: null }]);
  assert.deepEqual(d.clips.rev.attachments.default.dot.dot.sequence.map(k => [k.time, k.index]), [[0, 3], [0.12, 2], [0.2, 1], [0.35, 0], [0.45, 0]]);
  assert.deepEqual(d.clips.ppr.attachments.default.dot.dot.sequence.map(k => k.index), [3, 2, 1, 2, 2]);
  assert.equal(d.clips.ppr.attachments.default.dot.dot.sequence.at(-1).time, 0.12 + 0.08 + 0.15 + 0.08);
  // No tags: one clip over the whole timeline; one frame: no clip.
  assert.deepEqual(Object.keys(asepriteDrawing(readAseprite(sample({ tags: [] }))).clips), ['all']);
  assert.deepEqual(asepriteDrawing(readAseprite(sample({ durations: [100], tags: [] }))).clips, {});
});

test('draw_rig builds a rig from an Aseprite file whose every tag plays the file\'s frames pixel for pixel, sharp when magnified', async () => {
  for (const depth of [32, 8]) {
    const dir = project();
    fs.mkdirSync(path.join(dir, 'art'));
    fs.writeFileSync(path.join(dir, 'art/hero.aseprite'), sample({ depth }));
    const call = tools(dir);
    const out = await call('draw_rig', { name: 'hero', folder: 'rigs', aseprite: { file: 'art/hero.aseprite' } });
    assert.deepEqual(out.aseprite.clips, ['fwd', 'rev', 'pp', 'ppr']);
    assert.deepEqual(out.aseprite.leftOut, ['hidden: hidden', 'ref: a reference layer', 'tiles: a tilemap layer']);
    assert.equal((await call('check_skeleton', { file: 'rigs/hero.json' })).fatal, 0);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'rigs/hero.json'), 'utf8'));
    const atlasText = fs.readFileSync(path.join(dir, 'rigs/hero.atlas'), 'utf8');
    assert.match(atlasText, /filter:Nearest,Nearest/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'rigs/hero.parts.json'), 'utf8')).filter, 'nearest');
    const pages = { 'hero.png': decodePng(fs.readFileSync(path.join(dir, 'rigs/hero.png'))) };
    const ase = readAseprite(fs.readFileSync(path.join(dir, 'art/hero.aseprite')));
    const k = 4, W = 16, H = 12;
    const render = async (animation, times, atlas = atlasText) => (await renderFrames({ json, atlasText: atlas, pages, animation, times, width: W * k, height: H * k,
      margin: 0, supersample: 1, viewport: { x: -W / 2, y: 0, width: W, height: H } })).frames;
    for (const tag of ase.tags) {
      const order = tagFrames(tag), times = [];
      let t = 0;
      for (const f of order) { times.push(t + ase.frames[f].duration / 2); t += ase.frames[f].duration; }
      const frames = await render(tag.name, times);
      frames.forEach((fr, i) => {
        const want = composite(ase, order[i]);
        for (let y = 0; y < H * k; y++) for (let x = 0; x < W * k; x++) {
          const o = (y * W * k + x) * 4, w = (Math.floor(y / k) * W + Math.floor(x / k)) * 4, a = fr.image.data[o + 3] / 255;
          assert.ok(Math.abs(a - want[w + 3]) < 2 / 255, `${tag.name} frame ${order[i]} alpha at ${x},${y} (depth ${depth})`);
          if (want[w + 3] > 0.1) for (let c = 0; c < 3; c++) assert.ok(Math.abs(fr.image.data[o + c] / 255 - want[w + c]) < 3 / 255, `${tag.name} frame ${order[i]} colour at ${x},${y}`);
        }
      });
    }
    // The same page smoothed (filter Linear) blurs the pixel edges: the Nearest filter is what keeps them.
    const [smooth] = await render('fwd', [0.05], atlasText.replace('filter:Nearest,Nearest', 'filter:Linear,Linear'));
    const want = composite(ase, 0);
    let off = 0;
    for (let i = 0; i < W * k * H * k; i++) {
      const x = i % (W * k), y = Math.floor(i / (W * k));
      if (Math.abs(smooth.image.data[i * 4 + 3] / 255 - want[(Math.floor(y / k) * W + Math.floor(x / k)) * 4 + 3]) > 0.05) off++;
    }
    assert.ok(off > 50, `smoothing would soften the edges (${off} pixels off)`);
  }
});

test('draw_rig aseprite: bones on layers, blends, a second import that keeps written clips, and plain refusals', async () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, 'art'));
  fs.writeFileSync(path.join(dir, 'art/hero.aseprite'), sample());
  fs.writeFileSync(path.join(dir, 'art/blend.aseprite'), asepriteFile({ width: 4, height: 4, layers: [{ name: 'base' }, { name: 'shade', blend: 1 }, { name: 'glow', blend: 16 }, { name: 'odd', blend: 3 }],
    frames: [{ cels: [0, 1, 2, 3].map(layer => ({ layer, ...DOT })) }] }));
  const call = tools(dir);
  const out = await call('draw_rig', { name: 'hero', aseprite: { file: 'art/hero.aseprite', layers: { dot: { pivot: [0, 6], parent: 'block' }, ghost: { physics: true } } } });
  assert.ok(out.aseprite.place.some(p => p.startsWith('dot at')));
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'hero.json'), 'utf8'));
  const dot = json.bones.find(b => b.name === 'dot'), block = json.bones.find(b => b.name === 'block');
  assert.equal(dot.parent, 'block');
  assert.deepEqual([block.x + dot.x, block.y + dot.y], [0, 6], 'the bone sits at the pivot given in rig units');
  assert.equal(json.physics?.[0]?.bone, 'ghost');
  // A clip written since is kept by a second import; the tags' clips are made again.
  json.animations.wave = { bones: { block: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 10 }] } } };
  json.animations.fwd = { bones: {} };
  fs.writeFileSync(path.join(dir, 'hero.json'), JSON.stringify(json));
  const again = await call('draw_rig', { name: 'hero', aseprite: { file: 'art/hero.aseprite' } });
  assert.ok(again.keptClips.includes('wave'));
  const rebuilt = JSON.parse(fs.readFileSync(path.join(dir, 'hero.json'), 'utf8'));
  assert.ok(rebuilt.animations.wave.bones.block);
  assert.ok(rebuilt.animations.fwd.attachments, 'a tag\'s clip comes from the file again');
  // Blends the runtime draws are kept; the others draw as normal and are named.
  const b = await call('draw_rig', { name: 'blend', aseprite: { file: 'art/blend.aseprite' } });
  const slots = JSON.parse(fs.readFileSync(path.join(dir, 'blend.json'), 'utf8')).slots;
  assert.deepEqual(slots.map(s => s.blend ?? 'normal'), ['normal', 'multiply', 'additive', 'normal']);
  assert.ok(b.aseprite.notes.some(n => n.includes('overlay')));
  // Refusals.
  for (const [args, pattern] of [
    [{ name: 'x', parts: [{ name: 'p', at: [0, 0], svg: '<svg viewBox="0 0 1 1"/>' }], aseprite: { file: 'art/hero.aseprite' } }, /leave out parts/],
    [{ name: 'x', merge: true, aseprite: { file: 'art/hero.aseprite' } }, /leave out parts/],
    [{ name: 'x', resolution: 1.5, aseprite: { file: 'art/hero.aseprite' } }, /whole number/],
    [{ name: 'x', aseprite: { file: 'art/nope.aseprite' } }, /not in the project/],
    [{ name: 'x', aseprite: { file: 'art/hero.png' } }, /\.aseprite or \.ase/],
    [{ name: 'x', aseprite: { file: 'art/hero.aseprite', layers: { nope: { pivot: [0, 0] } } } }, /not a visible layer/],
    [{ name: 'x', aseprite: { file: 'art/hero.aseprite', layers: { dot: { size: [1, 1] } } } }, /not one of pivot, parent, physics/],
  ]) assert.match(await call('draw_rig', args, { fails: true }), pattern);
  const many = asepriteFile({ width: 2, height: 2, layers: Array.from({ length: 129 }, (_, i) => ({ name: `l${i}` })), frames: [{ cels: Array.from({ length: 129 }, (_, layer) => ({ layer, ...DOT })) }] });
  fs.writeFileSync(path.join(dir, 'art/many.aseprite'), many);
  assert.match(await call('draw_rig', { name: 'many', aseprite: { file: 'art/many.aseprite' } }, { fails: true }), /at most 128 parts/);
});

test('a Nearest page is drawn without smoothing where it is magnified, on the canvas and in Godot', () => {
  const seen = [];
  const ctx = new Proxy({ canvas: { width: 100, height: 100 } }, {
    get: (t, k) => (k in t ? t[k] : k === 'drawImage' ? () => seen.push(t.imageSmoothingEnabled) : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const { render } = createCanvasRenderer({ makeCanvas: () => ({}) });
  const quad = (size, nearest) => ({ positions: [0, 0, size, 0, size, size, 0, size], uvs: [0, 1, 1, 1, 1, 0, 0, 0], indices: [0, 1, 2, 2, 3, 0],
    page: 'p', pma: false, nearest, blend: 0, light: { r: 1, g: 1, b: 1, a: 1 }, dark: null, clip: null });
  const image = { width: 8, height: 8 };
  render(ctx, [quad(40, true), quad(4, true), quad(40, false)], () => image, { scale: 1, x: 20, y: 20 });
  assert.deepEqual(seen, [false, true, true], 'magnified Nearest: no smoothing; shrunk or Linear: smoothed');
  const skeleton = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'root', attachment: 'a' }],
    skins: [{ name: 'default', attachments: { s: { a: { width: 2, height: 2 } } } }], animations: {} };
  const atlas = filter => `p.png\nsize:4,4\nfilter:${filter}\npma:false\na\nbounds:0,0,2,2\n`;
  assert.equal(godotScene(skeleton, { atlasText: atlas('Nearest,Nearest') }).pages[0].filter, 'nearest');
  assert.equal(godotScene(skeleton, { atlasText: atlas('Linear,Linear') }).pages[0].filter, undefined);
});
