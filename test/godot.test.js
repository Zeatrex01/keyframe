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
import { compileSkeleton, Pose, Playhead, collectDraws, parseAtlas, atlasRegions } from '../src/engine/index.js';

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
    } else if (track.target === 'attachment' && track.property === 'polygon') polygons.set(`${track.name}/${track.attachment}`, v);
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

test('a one-shot clip plays once in Godot even when it lands back in its first pose; a cycle loops', () => {
  const json = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }, { name: 'body', parent: 'root' }],
    slots: [{ name: 'body', bone: 'body', attachment: 'a' }], skins: [{ name: 'default', attachments: { body: { a: { width: 10, height: 10 } } } }],
    animations: Object.fromEntries(['jump', 'punch', 'run', 'idle'].map(n => [n, { bones: { body: { translate: [{ time: 0, x: 0, y: 0 }, { time: 0.3, x: 0, y: 20 }, { time: 0.6, x: 0, y: 0 }] } } }])) };
  const scene = godotScene(json, { atlasText: 'p.png\nsize: 16, 16\na\nbounds: 0, 0, 10, 10\n' });
  assert.deepEqual(Object.fromEntries(scene.animations.map(a => [a.name, a.loop])), { jump: false, punch: false, run: true, idle: true });
});

test('the dressable warrior reaches Godot with every look and weapon, each stance switching its weapon, and the rig can swap them at run time', () => {
  const dir = path.join(ROOT, 'examples', 'showcase', 'warrior');
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'warrior_v2.json'), 'utf8'));
  const scene = godotScene(json, { atlasText: fs.readFileSync(path.join(dir, 'warrior_v2.atlas'), 'utf8') });
  const slot = name => scene.slots.find(s => s.name === name);
  for (const piece of ['helmet', 'cuirass', 'pauldronFront', 'tassetBack', 'greaveFront']) {
    assert.deepEqual(slot(piece).attachments.map(a => a.name).sort(), [piece, `${piece}_leather`], piece);
    assert.equal(slot(piece).attachment, piece);
  }
  assert.deepEqual(slot('weapon').attachments.map(a => a.name).sort(), ['weapon', 'weapon_axe', 'weapon_bow', 'weapon_drawn', 'weapon_spear']);
  assert.deepEqual(slot('arrow').attachments.map(a => a.name), ['arrow'], 'the bow brings its arrow');
  const shown = (clip, slotName) => scene.animations.find(a => a.name === clip).tracks.find(t => t.target === 'slot' && t.name === slotName && t.property === 'attachment')?.keys[0]?.value;
  assert.equal(shown('idle_spear', 'weapon'), 'weapon_spear');
  assert.equal(shown('shoot_bow', 'weapon'), 'weapon_bow');
  assert.equal(shown('punch', 'weapon'), null);
  // The add-on's rig finds slots by name and swaps looks and weapons.
  const rig = fs.readFileSync(path.join(ROOT, 'integrations/godot/addons/keyframe/keyframe_rig.gd'), 'utf8');
  for (const api of ['func play_layer(clip: String) -> bool', 'func set_attachment(slot_name: String, attachment: String) -> bool', 'func set_look(new_look: String) -> void', 'func get_attachments(slot_name: String) -> PackedStringArray']) assert.ok(rig.includes(api), api);
  assert.match(rig, /layer\.callback_mode_process = base\.callback_mode_process/, 'the layer keeps the process mode of the base player');
  assert.doesNotMatch(rig, /layer\.speed_scale = base/, 'the layer keeps its own speed');
  const builder = fs.readFileSync(path.join(ROOT, 'integrations/godot/addons/keyframe/keyframe_builder.gd'), 'utf8');
  assert.match(builder, /set_meta\("keyframe_slot", String\(slot\.name\)\)/);
  // A slot drawn empty (the arrow) stores "", since Godot keeps no meta for null, and the rig asks before it reads.
  assert.match(builder, /set_meta\("keyframe_default", String\(slot\.attachment\) if slot\.attachment != null else ""\)/);
  assert.match(rig, /if not _slot_map\[slot_name\]\.has_meta\("keyframe_default"\):\n\t\t\tcontinue/);
  assert.ok(!/get_meta\("keyframe_default", null\)/.test(rig), 'no null default: Godot 4 logs an error for it');
  for (const prop of ['@export var look: String', '@export var weapon: String']) assert.ok(rig.includes(prop), `${prop}: set in the Inspector`);
  // Putting the weapon away through the property works, and set_look reaches pieces that were taken off.
  assert.match(rig, /weapon = value\n\t\tif is_node_ready\(\):\n\t\t\tset_attachment\(WEAPON_SLOT, value\)/);
  assert.ok(!/_shown\(/.test(rig), 'set_look does not skip a slot that shows nothing');
  assert.match(rig, /func _index_slots\(\)/);
  // Locomotion leaves the weapon to the game.
  for (const clip of ['run', 'jump']) assert.equal(shown(clip, 'weapon'), undefined, `${clip} keys the weapon`);
  // The example ships ready for Godot, and up to date with its delivery.
  const shipped = JSON.parse(fs.readFileSync(path.join(dir, 'godot', 'warrior.kfscene'), 'utf8'));
  assert.deepEqual(shipped, JSON.parse(JSON.stringify(godotScene(json, { atlasText: fs.readFileSync(path.join(dir, 'warrior_v2.atlas'), 'utf8'), name: 'warrior' }))));
  assert.ok(fs.existsSync(path.join(dir, 'godot', 'warrior.png')));
});

test('a clipping mask reaches Godot: the eye keeps its pupil inside (a Polygon2D that clips the slots after it)', () => {
  const dir = path.join(ROOT, 'examples/showcase/pip');
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'pip_v2.json'), 'utf8'));
  const scene = godotScene(json, { atlasText: fs.readFileSync(path.join(dir, 'pip_v2.atlas'), 'utf8') });
  const clip = scene.slots.find(s => s.name === 'eyeClipL').clip;
  assert.equal(clip.end, 'pupilL');
  const raw = Object.values(json.skins[0].attachments.eyeClipL)[0];
  assert.equal(clip.polygon.length, raw.vertexCount * 2);
  assert.deepEqual(clip.polygon.slice(0, 2), [Math.round(raw.vertices[0] * 1000) / 1000, Math.round(-raw.vertices[1] * 1000) / 1000], 'in bone space, y down');
  assert.ok(!scene.report.skipped.some(s => s.startsWith('clipping:eyeClip')), 'no longer skipped');
  const builder = fs.readFileSync(path.join(ROOT, 'integrations/godot/addons/keyframe/keyframe_builder.gd'), 'utf8');
  assert.match(builder, /mask\.clip_children = CanvasItem\.CLIP_CHILDREN_ONLY/);
  assert.match(builder, /var follow := RemoteTransform2D\.new\(\)/, 'a clipped slot still moves with its own bone');
  assert.match(builder, /_clip\(root, data\.get\("slots", \[\]\), slot_nodes\)\n\tfor slot_name in slot_nodes:\n\t\tslot_paths\[slot_name\]/, 'track paths are taken after the move');
});

test('physics and transform constraints are baked from the engine: Godot plays the swing the engine shows', () => {
  const json = { skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'body', parent: 'root' }, { name: 'cape', parent: 'body', length: 40 }, { name: 'hem', parent: 'cape', x: 40, length: 20 },
      { name: 'badge', parent: 'root' }],
    slots: [],
    physics: [{ name: 'cape', bone: 'cape', rotate: 1, inertia: 0.8, strength: 60, damping: 0.9 }],
    transform: [{ name: 'pin', bones: ['badge'], target: 'hem', mixScaleX: 0 }],
    animations: { dash: { bones: { body: { translate: [{ y: 0 }, { time: 0.3, y: 80 }, { time: 1, y: 80 }] } } } } };
  const scene = godotScene(json, { atlasText: '', fps: 30 });
  const clip = scene.animations[0];
  assert.ok(clip.tracks.some(t => t.name === 'cape' && t.property === 'rotation' && t.type === 'value'), 'the physics bone is baked');
  assert.ok(clip.tracks.some(t => t.name === 'badge' && t.property === 'position'), 'the constrained bone is baked');
  assert.ok(scene.report.baked.some(b => b.includes('physics cape')) && scene.report.baked.some(b => b.includes('transform pin')));
  const model = compileSkeleton(json);
  const head = new Playhead(model, 'dash');
  let swung = 0;
  for (const time of [0, 0.2, 0.4, 0.6, 1]) {
    const pose = head.at(time);
    const g = playGodot(scene, clip, time);
    for (const bone of pose.bones) {
      const want = toGodot(bone), got = g.globals.get(bone.data.name);
      assert.ok(Math.abs(want.o[0] - got.o[0]) < 1e-3 && Math.abs(want.o[1] - got.o[1]) < 1e-3, `${bone.data.name}@${time}`);
    }
    swung = Math.max(swung, Math.abs(Math.atan2(pose.bones[2].c, pose.bones[2].a)));
  }
  assert.ok(swung > 0.05, 'the cape swings');
});

test('a looping clip with physics is recorded on its second lap, so its seam closes', () => {
  const json = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }, { name: 'body', parent: 'root' }, { name: 'tail', parent: 'body', length: 40 }], slots: [],
    physics: [{ name: 'tail', bone: 'tail', rotate: 1, inertia: 0.8, strength: 60, damping: 0.9 }],
    animations: { bob: { bones: { body: { translate: [{ y: 0 }, { time: 0.5, y: 30 }, { time: 1, y: 0 }] } } } } };
  const clip = godotScene(json, { atlasText: '', fps: 30 }).animations[0];
  assert.equal(clip.loop, true);
  const rotation = clip.tracks.find(t => t.name === 'tail' && t.property === 'rotation');
  const first = rotation.keys[0].value, last = rotation.keys.at(-1).value;
  assert.ok(Math.abs(first) > 1e-3, 'it starts mid-swing, as the lap before left it');
  assert.ok(Math.abs(first - last) < Math.abs(first) * 0.5 + 0.02, `the seam is close (${first} vs ${last})`);
});

test('a sequence (flipbook) switches its texture coordinates frame by frame in Godot', () => {
  const json = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }],
    slots: [{ name: 'fire', bone: 'root', attachment: 'flame' }],
    skins: [{ name: 'default', attachments: { fire: { flame: { width: 10, height: 10, sequence: { count: 3, start: 1, digits: 1 } } } } }],
    animations: { burn: { attachments: { default: { fire: { flame: { sequence: [{ mode: 'loop', delay: 0.1 }] } } } }, slots: { fire: { rgba: [{ color: 'ffffffff' }, { time: 0.6, color: 'ffffffff' }] } } } } };
  const atlasText = 'p.png\nsize: 64, 16\nflame1\nbounds: 0, 0, 10, 10\nflame2\nbounds: 16, 0, 10, 10\nflame3\nbounds: 32, 0, 10, 10\n';
  const scene = godotScene(json, { atlasText, fps: 30 });
  const att = scene.slots[0].attachments[0];
  assert.equal(att.frames.length, 3, 'every frame\'s coordinates');
  const uv = scene.animations[0].tracks.find(t => t.property === 'uv');
  assert.ok(uv && uv.interpolation === 'nearest');
  const u = time => trackValue(uv, time)[0];
  assert.deepEqual([0, 0.1, 0.2, 0.3].map(t => u(t + 0.01)), [0, 16, 32, 0], 'frame 1, 2, 3, then round again');
  const builder = fs.readFileSync(path.join(ROOT, 'integrations/godot/addons/keyframe/keyframe_builder.gd'), 'utf8');
  assert.match(builder, /track\.get\("interpolation", "linear"\)/, 'the add-on keys polygon, uv and texture tracks by their interpolation');
});

test('clips blend in Godot as in the runtimes: rotations start near rest, and every clip holds the rest of what other clips move', () => {
  const skeleton = { skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root', rotation: 170, length: 20 }, { name: 'hand', parent: 'arm', x: 20, length: 6 }],
    slots: [{ name: 'fist', bone: 'hand', attachment: 'fist' }],
    skins: [{ name: 'default', attachments: { fist: { fist: { width: 4, height: 4 }, palm: { width: 4, height: 4 } } } }],
    animations: {
      // The same held pose written as +200 and -160 degrees from the setup angle.
      guard: { bones: { arm: { rotate: [{ time: 0, value: 200 }, { time: 1, value: 200 }] } } },
      block: { bones: { arm: { rotate: [{ time: 0, value: -160 }, { time: 1, value: -160 }] } } },
      // A palm strike bends the hand, flashes the slot and shows the open palm.
      palm: { bones: { hand: { rotate: [{ time: 0, value: 0 }, { time: 0.2, value: 60 }] } },
        slots: { fist: { rgba: [{ time: 0, color: 'ff0000ff' }], attachment: [{ time: 0, name: 'palm' }] } } },
    } };
  const scene = godotScene(skeleton, { atlasText: 'p.png\nsize:8,8\nfilter:Linear,Linear\npma:false\nfist\nbounds:0,0,4,4\npalm\nbounds:4,0,4,4\n' });
  const clip = name => scene.animations.find(a => a.name === name);
  const track = (name, target, who, property) => clip(name).tracks.find(t => t.target === target && t.name === who && t.property === property);
  const rest = scene.bones.find(b => b.name === 'arm').rest.rotation;
  const guard = track('guard', 'bone', 'arm', 'rotation').keys[0].value, block = track('block', 'bone', 'arm', 'rotation').keys[0].value;
  assert.ok(Math.abs(guard - rest) <= Math.PI + 1e-6 && Math.abs(block - rest) <= Math.PI + 1e-6, 'each clip starts within half a turn of rest');
  assert.ok(Math.abs(guard - block) < 1e-3, `one pose, one number: ${guard} and ${block}, so a crossfade between them does not spin the arm`);
  // The hand the palm strike bends is held at rest by the clips that do not move it; so is the flash.
  for (const name of ['guard', 'block']) {
    const hand = track(name, 'bone', 'hand', 'rotation');
    assert.ok(hand?.fill, `${name} holds the hand`);
    assert.equal(hand.keys.length, 1);
    assert.equal(hand.keys[0].value, scene.bones.find(b => b.name === 'hand').rest.rotation);
    assert.deepEqual(track(name, 'slot', 'fist', 'modulate')?.keys[0].value, scene.slots[0].color, `${name} holds the slot colour`);
    assert.equal(track(name, 'slot', 'fist', 'attachment'), undefined, 'which attachment shows is left to the game');
  }
  assert.ok(!track('palm', 'bone', 'hand', 'rotation').fill, 'a clip\'s own keys are not fills');
  assert.ok(track('palm', 'bone', 'arm', 'rotation').fill, 'the palm strike holds the arm the guard moves');
  // The add-on marks the fills, plays layers without them, and starts a playing clip again through a twin.
  const builder = fs.readFileSync(path.join(ROOT, 'integrations/godot/addons/keyframe/keyframe_builder.gd'), 'utf8');
  assert.match(builder, /if track\.get\("fill", false\):\n\t\t\t\tfor index in range\(before, animation\.get_track_count\(\)\):\n\t\t\t\t\tfills\.append\(index\)/);
  assert.match(builder, /animation\.set_meta\(RIG_SCRIPT\.FILL_META, fills\)/);
  const rig = fs.readFileSync(path.join(ROOT, 'integrations/godot/addons/keyframe/keyframe_rig.gd'), 'utf8');
  assert.match(rig, /for i in range\(fills\.size\(\) - 1, -1, -1\):\n\t\t\town\.remove_track\(fills\[i\]\)/, 'a layer plays only its own tracks');
  assert.doesNotMatch(rig, /layer\.add_animation_library\("", base\.get_animation_library\(""\)\)/, 'not the base clips, whose fills would hold the legs');
  assert.match(rig, /if base\.is_playing\(\) and base\.current_animation == clip:\n\t\ttarget = clip \+ AGAIN/);
  assert.match(rig, /const AGAIN := "__again"/);
});
