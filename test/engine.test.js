// Gate for src/engine: the studio's own player.
//
// 1. Parity: every skeleton the repository ships (examples and fixtures) is posed by the engine
//    and by the official Spine runtime at seven instants of every clip; world positions, bone
//    matrices, attachments, colours and draw order must agree. Runs when the official runtime is
//    available (the Spine add-on); the engine never needs it.
// 2. The Keyframe format: Spine JSON -> Keyframe -> Spine JSON poses identically.
// 3. Inherit modes, the atlas reader, triangulation and clipping on small synthetic cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSkeleton, sample, setupPose, parseAtlas, triangulate, applyClip, collectDraws, atlasRegions, poseAt } from '../src/engine/index.js';
import { fromSkeletonJson, toSkeletonJson, isKeyframeDocument, FORMAT } from '../src/engine/keyframe-format.js';
import { officialRuntime } from './helpers/official-runtime.js';
import { checkSkeleton } from '../src/spine/check.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOLERANCE = 0.01; // units, and 0.01 of a matrix entry (scaled x100 below)

function skeletonFiles() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!['node_modules', 'history', '.studio'].includes(entry.name)) walk(full); continue; }
      if (!entry.name.endsWith('.json')) continue;
      let json;
      try { json = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
      if (Array.isArray(json?.bones) && /^4\.2/.test(json?.skeleton?.spine ?? '')) out.push({ file: path.relative(ROOT, full), json });
    }
  };
  walk(path.join(ROOT, 'examples'));
  walk(path.join(ROOT, 'test', 'fixtures'));
  return out;
}
// Inherit modes under moving, reflected, sheared parents: no shipped rig covers them all.
const INHERIT_RIG = { skeleton: { spine: '4.2.43' }, bones: [
  { name: 'root' },
  { name: 'p', parent: 'root', x: 10, rotation: 30, scaleX: 1.5, scaleY: -0.8, shearX: 10 },
  ...['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'].map(inherit =>
    ({ name: `c_${inherit}`, parent: 'p', x: 20, y: 5, rotation: -15, scaleX: 1.2, inherit, length: 10 })),
], slots: [], animations: { turn: { bones: { p: {
  rotate: [{ time: 0, curve: 'stepped' }, { time: 0.5, value: 120 }, { time: 1, value: -200 }],
  scale: [{ time: 0, x: 1, y: 1 }, { time: 1, x: -1.3, y: 0.6 }],
  shear: [{ time: 0 }, { time: 1, x: 25, y: -10 }],
} } } } };
const ALL = [...skeletonFiles(), { file: '(inherit modes)', json: INHERIT_RIG }];
// A file the engine refuses must be one the static check calls fatal (the official runtime refuses
// it too); everything else is posed.
const refusedByEngine = ({ json }) => { try { compileSkeleton(json); return false; } catch { return true; } };
const SKELETONS = ALL.filter(s => !refusedByEngine(s));
const instants = d => [0, d * 0.13, d * 0.37, d * 0.5, d * 0.71, d * 0.93, d].map(t => Math.round(t * 1e4) / 1e4);

/** The worst disagreement between two lists of snapshots, with where it is. */
function compare(a, b) {
  let worst = 0, where = '';
  const see = (e, w) => { if (e > worst) { worst = e; where = w; } };
  a.forEach((sa, i) => {
    const sb = b[i];
    sa.bones.forEach((x, j) => {
      const y = sb.bones[j];
      for (const k of ['worldX', 'worldY']) see(Math.abs(x[k] - y[k]), `${x.name}.${k} @${sa.time}`);
      for (const k of ['a', 'b', 'c', 'd']) see(Math.abs(x.matrix[k] - y.matrix[k]) * 100, `${x.name}.matrix.${k} @${sa.time}`);
    });
    sa.slots.forEach((x, j) => {
      const y = sb.slots[j];
      if (x.attachment !== y.attachment) see(Infinity, `${x.name} shows ${x.attachment} vs ${y.attachment} @${sa.time}`);
      for (const k of ['r', 'g', 'b', 'a']) see(Math.abs(x.color[k] - y.color[k]) * 100, `${x.name}.color.${k} @${sa.time}`);
    });
    if (sa.drawOrder.join() !== sb.drawOrder.join()) see(Infinity, `draw order @${sa.time}`);
  });
  return { worst, where };
}

test('the repository ships skeletons for the engine to prove itself on; it refuses only what the check calls fatal', () => {
  assert.ok(SKELETONS.length >= 10, `found ${SKELETONS.length}`);
  for (const refused of ALL.filter(refusedByEngine)) {
    assert.ok(checkSkeleton(refused.json).some(f => f.level === 'fatal'), `${refused.file}: the engine refuses a file the check passes`);
  }
});

test('parity: the engine poses every shipped skeleton as the official runtime does', async t => {
  const runtime = await officialRuntime();
  if (!runtime) { t.skip('the Spine add-on is not installed; the engine needs no runtime, only this comparison does'); return; }
  let compared = 0;
  for (const { file, json } of SKELETONS) {
    const model = compileSkeleton(json);
    // Constraints the engine does not evaluate yet (transform, path, physics) are reported, not
    // silently approximated; those files are compared by the bake instead.
    if (model.unsupported.some(u => /^(transform|path|physics|skin-required-bone|sequence):/.test(u))) continue;
    let data;
    try { data = await runtime.parseSkeleton(json); } catch { continue; } // the official runtime refuses it: nothing to compare
    for (const animation of data.animations) {
      const times = instants(animation.duration);
      const official = await runtime.sampleAnimation(data, animation.name, times);
      const ours = sample(model, animation.name, times);
      const { worst, where } = compare(official, ours);
      assert.ok(worst <= TOLERANCE, `${file} ${animation.name}: ${where} differs by ${worst}`);
      compared++;
    }
  }
  assert.ok(compared >= 30, `compared ${compared} clips`);
});

test('the Keyframe format carries every shipped skeleton there and back without changing a pose', () => {
  for (const { file, json } of SKELETONS) {
    const doc = JSON.parse(JSON.stringify(fromSkeletonJson(json)));
    assert.equal(doc.format, FORMAT);
    assert.ok(isKeyframeDocument(doc) && !isKeyframeDocument(json), file);
    const a = compileSkeleton(json), b = compileSkeleton(toSkeletonJson(doc));
    for (const [name, animation] of a.animations) {
      const times = instants(animation.duration);
      const { worst, where } = compare(sample(a, name, times), sample(b, name, times));
      assert.ok(worst <= TOLERANCE, `${file} ${name}: ${where} differs by ${worst}`);
    }
  }
});

test('inherit modes: a child under a rotated, scaled parent follows each mode', () => {
  const sk = mode => ({ skeleton: { spine: '4.2.43' }, bones: [
    { name: 'root' },
    { name: 'parent', parent: 'root', rotation: 90, scaleX: 2, scaleY: 0.5, x: 10 },
    { name: 'child', parent: 'parent', x: 5, inherit: mode },
  ], slots: [], animations: {} });
  const world = mode => setupPose(compileSkeleton(sk(mode))).snapshot().bones[2];
  const normal = world('normal');
  assert.ok(Math.abs(normal.worldX - 10) < 1e-9 && Math.abs(normal.worldY - 10) < 1e-9, 'translated along the rotated, scaled x axis');
  assert.ok(Math.abs(normal.worldRotation - 90) < 1e-9);
  const noRotation = world('noRotationOrReflection');
  assert.ok(Math.abs(noRotation.worldRotation) < 1e-6, 'keeps its own rotation');
  const noScale = world('noScale');
  assert.ok(Math.abs(noScale.worldScaleX - 1) < 1e-6 && Math.abs(noScale.worldScaleY - 1) < 1e-6, 'keeps scale 1');
  const onlyTranslation = world('onlyTranslation');
  assert.deepEqual([onlyTranslation.matrix.a, onlyTranslation.matrix.d].map(v => Math.round(v * 1e6) / 1e6), [1, 1]);
  assert.ok(Math.abs(onlyTranslation.worldX - normal.worldX) < 1e-9, 'position still follows the parent');
});

test('the atlas reader keeps pages, regions, rotation and trim', () => {
  const atlas = parseAtlas('page.png\nsize: 64, 32\nfilter: Linear, Nearest\npma: true\na\nbounds: 2, 4, 10, 20\noffsets: 1, 2, 12, 24\nrotate: 90\nb\nbounds: 20, 0, 8, 8\n');
  assert.deepEqual(atlas.pages, [{ name: 'page.png', width: 64, height: 32, pma: true, format: null, minFilter: 'Linear', magFilter: 'Nearest' }]);
  const [a, b] = atlas.regions;
  assert.deepEqual([a.x, a.y, a.width, a.height, a.degrees, a.offsetX, a.offsetY, a.originalWidth, a.originalHeight], [2, 4, 10, 20, 90, 1, 2, 12, 24]);
  assert.deepEqual([a.u2, a.v2], [(2 + 20) / 64, (4 + 10) / 32], 'a rotated region spans height x width on its page');
  assert.deepEqual([b.originalWidth, b.originalHeight], [8, 8], 'untrimmed regions are their own original size');
  assert.equal(atlasRegions(atlas)('a').pageWidth, 64);
});

test('triangulation and clipping', () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.equal(triangulate(square).length, 6);
  const concave = [0, 0, 10, 0, 10, 10, 5, 3, 0, 10];
  assert.equal(triangulate(concave).length, 9);
  const draw = { positions: Float64Array.from([-5, -5, 15, -5, 15, 15, -5, 15]), uvs: Float64Array.from([0, 1, 1, 1, 1, 0, 0, 0]), indices: [0, 1, 2, 2, 3, 0],
    clip: square };
  const clipped = applyClip(draw);
  for (let i = 0; i < clipped.positions.length; i += 2) {
    assert.ok(clipped.positions[i] >= -1e-9 && clipped.positions[i] <= 10 + 1e-9 && clipped.positions[i + 1] >= -1e-9 && clipped.positions[i + 1] <= 10 + 1e-9);
  }
  assert.ok(clipped.indices.length >= 6 && clipped.indices.length % 3 === 0);
});

test('a region draws as two triangles at its bone, tinted by slot and attachment colour', () => {
  const model = compileSkeleton({ skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }, { name: 'b', parent: 'root', x: 100 }],
    slots: [{ name: 's', bone: 'b', attachment: 'r', color: 'ff000080' }],
    skins: [{ name: 'default', attachments: { s: { r: { width: 20, height: 10, color: '00ff00ff' } } } }],
    animations: { move: { bones: { b: { translate: [{ time: 0 }, { time: 1, x: 50 }] } } } } });
  const regionOf = atlasRegions(parseAtlas('p.png\nsize: 32, 32\nr\nbounds: 0, 0, 20, 10\n'));
  const { draws, missing } = collectDraws(poseAt(model, 'move', 1), regionOf);
  assert.deepEqual(missing, []);
  assert.equal(draws.length, 1);
  const xs = Array.from(draws[0].positions).filter((_, i) => i % 2 === 0);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [140, 160]);
  assert.deepEqual(draws[0].light, { r: 0, g: 0, b: 0, a: 128 / 255 });
  assert.equal(draws[0].page, 'p.png');
});
