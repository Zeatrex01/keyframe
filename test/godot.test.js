// Gate for the Godot scene description (src/engine/godot.js), the data the Godot add-on builds
// its Skeleton2D, Polygon2D and AnimationPlayer from. A small evaluator here plays the scene the
// way Godot 4 does (Node2D transforms from rotation, scale and skew; bezier tracks solved on
// time; linear and nearest value tracks; Polygon2D skinning against bone rests) and every
// shipped skeleton must land where the engine poses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { godotScene, compose, decompose, multiply, inverse, toGodot, GODOT_FORMAT } from '../src/engine/godot.js';
import { compileSkeleton, Pose, collectDraws, parseAtlas, atlasRegions } from '../src/engine/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rigs() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!['node_modules', 'history', '.studio', '.backup'].includes(entry.name)) walk(full); continue; }
      if (!entry.name.endsWith('.json')) continue;
      const atlas = full.replace(/(\.keyframe)?\.json$/, '.atlas');
      if (!fs.existsSync(atlas)) continue;
      let json;
      try { json = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
      if (!Array.isArray(json?.bones)) continue;
      try { compileSkeleton(json); } catch { continue; }
      out.push({ file: path.relative(ROOT, full), json, atlasText: fs.readFileSync(atlas, 'utf8') });
    }
  };
  walk(path.join(ROOT, 'examples'));
  walk(path.join(ROOT, 'test', 'fixtures'));
  return out;
}

// ---- Godot's side --------------------------------------------------------------------------

function bezierAt(a, b, time) {
  const p0 = [a.time, a.value], p1 = [a.time + a.out[0], a.value + a.out[1]], p2 = [b.time + b.in[0], b.value + b.in[1]], p3 = [b.time, b.value];
  const at = (s, i) => { const m = 1 - s; return m * m * m * p0[i] + 3 * m * m * s * p1[i] + 3 * m * s * s * p2[i] + s * s * s * p3[i]; };
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (at(mid, 0) < time) lo = mid; else hi = mid; }
  return at((lo + hi) / 2, 1);
}
const lerp = (a, b, t) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * t) : a + (b - a) * t);

/** A track's value at a time, as Godot's AnimationPlayer computes it. */
export function trackValue(track, time) {
  const keys = track.keys;
  let i = keys.length - 1;
  while (i > 0 && keys[i].time > time + 1e-9) i--;
  if (time <= keys[0].time) return keys[0].value;
  if (i === keys.length - 1) return keys[i].value;
  const a = keys[i], b = keys[i + 1];
  if (track.type === 'bezier') return bezierAt(a, b, time);
  if (track.interpolation === 'nearest') return a.value;
  return lerp(a.value, b.value, (time - a.time) / (b.time - a.time));
}

/** Bone globals, slot state and attachment world vertices of the scene at one time. */
function playGodot(scene, clip, time) {
  const props = new Map(scene.bones.map(b => [b.name, { position: [...b.rest.position], rotation: b.rest.rotation, scale: [...b.rest.scale], skew: b.rest.skew }]));
  const slotState = new Map(scene.slots.map(s => [s.name, { attachment: s.attachment, modulate: s.color, z: s.z }]));
  const polygons = new Map();
  for (const track of clip?.tracks ?? []) {
    const v = trackValue(track, time);
    if (track.target === 'bone') {
      const p = props.get(track.name);
      const [prop, axis] = track.property.split(':');
      if (axis) p[prop][axis === 'x' ? 0 : 1] = v; else p[prop] = v;
    } else if (track.target === 'slot') {
      const s = slotState.get(track.name);
      if (track.property === 'attachment') s.attachment = v; else if (track.property === 'modulate') s.modulate = v; else if (track.property === 'z_index') s.z = v;
    } else if (track.target === 'attachment') polygons.set(`${track.name}/${track.attachment}`, v);
  }
  const globals = new Map(), rests = new Map();
  for (const b of scene.bones) {
    const local = compose(props.get(b.name)), rest = compose(b.rest);
    globals.set(b.name, b.parent ? multiply(globals.get(b.parent), local) : local);
    rests.set(b.name, b.parent ? multiply(rests.get(b.parent), rest) : rest);
  }
  const apply = (t, x, y) => [t.x[0] * x + t.y[0] * y + t.o[0], t.x[1] * x + t.y[1] * y + t.o[1]];
  const drawn = new Map();
  for (const slot of scene.slots) {
    const state = slotState.get(slot.name);
    const att = slot.attachments.find(a => a.name === state.attachment);
    if (!att) continue;
    const polygon = polygons.get(`${slot.name}/${att.name}`) ?? att.polygon;
    const out = [];
    for (let i = 0; i < polygon.length; i += 2) {
      if (att.type !== 'skinned') { out.push(...apply(globals.get(slot.bone), polygon[i], polygon[i + 1])); continue; }
      let x = 0, y = 0, total = 0;
      for (const [bone, weights] of Object.entries(att.weights)) {
        const w = weights[i / 2];
        if (!w) continue;
        const [px, py] = apply(multiply(globals.get(bone), inverse(rests.get(bone))), polygon[i], polygon[i + 1]);
        x += px * w; y += py * w; total += w;
      }
      out.push(x / total, y / total);
    }
    drawn.set(slot.name, out);
  }
  return { globals, slotState, drawn };
}

// ---- the gate -------------------------------------------------------------------------------

const RIGS = rigs();

test('the repository ships rigs with atlases for the Godot mapping to prove itself on', () => {
  assert.ok(RIGS.length >= 5, `found ${RIGS.length}`);
});

test('Node2D transforms: decompose and compose are inverses, reflections and skew included', () => {
  for (const t of [{ x: [2, 1], y: [-0.5, 1.5], o: [3, 4] }, { x: [1, 0], y: [0, -1], o: [0, 0] }, { x: [-1.2, 0.3], y: [0.4, 0.9], o: [-5, 2] }]) {
    const back = compose(decompose(t));
    for (const k of ['x', 'y', 'o']) for (const i of [0, 1]) assert.ok(Math.abs(back[k][i] - t[k][i]) < 1e-9, `${k}[${i}]`);
  }
});

test('every shipped rig plays in Godot where the engine poses it: bones, attachments, colours, draw order', () => {
  let clips = 0;
  for (const { file, json, atlasText } of RIGS) {
    const scene = JSON.parse(JSON.stringify(godotScene(json, { atlasText, fps: 30 })));
    assert.equal(scene.format, GODOT_FORMAT);
    const model = compileSkeleton(json);
    const regionOf = atlasRegions(parseAtlas(atlasText));
    for (const clip of scene.animations) {
      const animation = model.animations.get(clip.name);
      const keyedOnly = clip.tracks.every(t => t.target !== 'bone' || t.type === 'bezier');
      const times = [0, clip.length / 3, clip.length / 2, clip.length].map(t => Math.round(t * 30) / 30);
      if (keyedOnly) times.push(clip.length * 0.37, clip.length * 0.81);
      for (const time of times) {
        const t = Math.min(time, clip.length);
        const pose = new Pose(model).apply(animation, Math.fround(t)).updateWorld();
        const godot = playGodot(scene, clip, t);
        for (const bone of pose.bones) {
          const want = toGodot(bone), got = godot.globals.get(bone.data.name);
          // Godot solves a bezier exactly; Spine runtimes (and the engine) walk it in ten straight
          // steps, so a steep overshoot can differ by a percent between keys. Baked keys are exact.
          for (const k of ['x', 'y']) for (const i of [0, 1]) assert.ok(Math.abs(want[k][i] - got[k][i]) < 0.03 * Math.max(1, Math.hypot(...want[k])), `${file} ${clip.name}@${t} ${bone.data.name}.${k}[${i}]: ${got[k][i]} vs ${want[k][i]}`);
          for (const i of [0, 1]) assert.ok(Math.abs(want.o[i] - got.o[i]) < 3, `${file} ${clip.name}@${t} ${bone.data.name} origin: ${got.o} vs ${want.o}`);
        }
        // Colour, draw order and deform are sampled on the frame grid; between frames Godot interpolates.
        if (Math.abs(t * 30 - Math.round(t * 30)) > 1e-6 && t !== clip.length) continue;
        const draws = new Map(collectDraws(pose, regionOf).draws.map(d => [d.slot, d]));
        for (const slot of pose.slots) {
          const state = godot.slotState.get(slot.data.name);
          assert.equal(state.attachment, slot.attachment?.name ?? null, `${file} ${clip.name}@${t} ${slot.data.name} shows`);
          for (const [i, c] of ['r', 'g', 'b', 'a'].entries()) assert.ok(Math.abs(state.modulate[i] - slot.color[c]) < 0.02, `${file} ${clip.name}@${t} ${slot.data.name}.${c}`);
          assert.equal(state.z, pose.drawOrder.indexOf(slot), `${file} ${clip.name}@${t} ${slot.data.name} z`);
          const d = draws.get(slot.data.name), got = godot.drawn.get(slot.data.name);
          if (!d || !got || d.clip) continue;
          const origin = toGodot(pose.bones[slot.data.bone]).o;
          for (let i = 0; i < got.length; i++) {
            const want = i % 2 ? -d.positions[i] : d.positions[i];
            // The bone's matrix tolerance above, carried out to the vertex's distance from the bone.
            const reach = Math.hypot(got[i - (i % 2)] - origin[0], got[i - (i % 2) + 1] - origin[1]);
            assert.ok(Math.abs(got[i] - want) < 3 + 0.03 * reach, `${file} ${clip.name}@${t} ${slot.data.name} vertex ${i}: ${got[i]} vs ${want}`);
          }
        }
      }
      clips++;
    }
  }
  assert.ok(clips >= 20, `played ${clips} clips`);
});

test('authored curves stay editable: a plain rig keys bezier tracks with the authored handles', () => {
  const json = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 10, rotation: 20 }], slots: [],
    animations: { wave: { bones: { arm: { rotate: [{ time: 0, value: 0, curve: [0.25, 0, 0.75, 40] }, { time: 1, value: 40 }] } } } } };
  const scene = godotScene(json, { atlasText: '' });
  const [track] = scene.animations[0].tracks;
  assert.deepEqual([track.type, track.property, track.name], ['bezier', 'rotation', 'arm']);
  assert.ok(Math.abs(track.keys[0].value + 20 * Math.PI / 180) < 1e-6, 'setup plus key, mirrored, in radians');
  assert.deepEqual(track.keys[0].out, [0.25, 0]);
  assert.ok(Math.abs(track.keys[1].in[0] + 0.25) < 1e-6);
  assert.deepEqual(scene.report.baked, []);
});

test('what Godot has no counterpart for is baked and named', () => {
  const json = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }, { name: 'upper', parent: 'root', length: 10 }, { name: 'lower', parent: 'upper', x: 10, length: 10 },
    { name: 'target', parent: 'root', x: 15, y: 5 }, { name: 'badge', parent: 'upper', inherit: 'noScale', x: 4 }], slots: [],
  ik: [{ name: 'reach', bones: ['upper', 'lower'], target: 'target' }],
  animations: { reach: { bones: { target: { translate: [{ time: 0 }, { time: 1, x: -5, y: 8 }] }, upper: { scale: [{ time: 0 }, { time: 1, x: 1.4 }] } } } } };
  const scene = godotScene(json, { atlasText: '' });
  const tracks = scene.animations[0].tracks;
  assert.ok(tracks.some(t => t.name === 'lower' && t.type === 'value' && t.property === 'rotation'), 'the IK chain is baked');
  assert.ok(tracks.some(t => t.name === 'badge' && t.type === 'value'), 'a noScale child of a scaling bone is baked');
  assert.ok(tracks.some(t => t.name === 'target' && t.type === 'bezier'), 'the target keeps its keys');
  assert.ok(scene.report.baked.some(b => b.includes('ik reach')) && scene.report.baked.some(b => b.includes('inherit mode')));
  for (const time of [0, 0.5, 1]) {
    const model = compileSkeleton(json);
    const pose = new Pose(model).apply(model.animations.get('reach'), time).updateWorld();
    const g = playGodot(scene, scene.animations[0], time);
    for (const bone of pose.bones) {
      const want = toGodot(bone), got = g.globals.get(bone.data.name);
      assert.ok(Math.abs(want.o[0] - got.o[0]) < 1e-3 && Math.abs(want.o[1] - got.o[1]) < 1e-3, `${bone.data.name}@${time}`);
    }
  }
});

test('the scene refuses without an atlas or with a silly fps', () => {
  const json = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }], slots: [] };
  assert.throws(() => godotScene(json, /** @type {any} */ ({})), { code: 'bad-argument' });
  assert.throws(() => godotScene(json, { atlasText: '', fps: 0 }), { code: 'bad-argument' });
});

test('slots: attachment swaps, colour, draw order and events reach Godot', () => {
  const json = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }], events: { hit: { int: 2 } },
    slots: [{ name: 'back', bone: 'root', attachment: 'a' }, { name: 'front', bone: 'root', attachment: 'a', color: 'ffffff80' }],
    skins: [{ name: 'default', attachments: { back: { a: { width: 10, height: 10 }, b: { width: 10, height: 10 } }, front: { a: { width: 10, height: 10 } } } }],
    animations: { swap: {
      slots: { back: { attachment: [{ time: 0.5, name: 'b' }, { time: 0.8, name: null }], rgba: [{ time: 0, color: 'ffffffff' }, { time: 1, color: 'ff000000' }] } },
      drawOrder: [{ time: 0.4, offsets: [{ slot: 'back', offset: 1 }] }],
      events: [{ time: 0.6, name: 'hit', string: 'boom' }],
    } } };
  const atlasText = 'p.png\nsize: 32, 32\na\nbounds: 0, 0, 10, 10\nb\nbounds: 10, 0, 10, 10\n';
  const scene = godotScene(json, { atlasText });
  const clip = scene.animations[0];
  const model = compileSkeleton(json);
  for (const t of [0, 0.4, 0.5, 0.6, 0.8, 1]) {
    const pose = new Pose(model).apply(model.animations.get('swap'), Math.fround(t)).updateWorld();
    const g = playGodot(scene, clip, t);
    for (const slot of pose.slots) {
      const s = g.slotState.get(slot.data.name);
      assert.equal(s.attachment, slot.attachment?.name ?? null, `${slot.data.name}@${t}`);
      assert.equal(s.z, pose.drawOrder.indexOf(slot), `${slot.data.name} z@${t}`);
      assert.ok(Math.abs(s.modulate[3] - slot.color.a) < 0.02, `${slot.data.name} alpha@${t}`);
    }
  }
  assert.deepEqual(clip.tracks.find(t => t.type === 'method').keys, [{ time: 0.6, name: 'hit', int: 2, float: 0, string: 'boom' }]);
  assert.equal(scene.slots[1].color[3], 0.501961);
  assert.deepEqual(scene.slots[0].attachments.map(a => a.name), ['a', 'b']);
  assert.deepEqual(scene.slots[0].attachments[1].uv, [10, 10, 10, 0, 20, 0, 20, 10], 'uv in page pixels');
});
