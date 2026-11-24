// Gate for planted feet (src/deliver/plant.js) and the foot-slide finding (src/understand/actions.js):
// a punch that carries the hips forward slides the feet unless they are planted; planted, each foot
// joint stays on its point, the critique judges the rhythm the author wrote, and a leg that cannot
// reach says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp/server.js';
import { compileSkeleton, Pose } from '../src/engine/index.js';

function studio() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-plant-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
  const call = async (name, args) => {
    sent.length = 0;
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const r = sent[0].result;
    if (r.structuredContent) return r.structuredContent;
    return JSON.parse(r.content.find(c => c.type === 'text').text);
  };
  return { dir, call, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const K = pairs => pairs.map(([time, value], i) => ({ time, value, ...(i < pairs.length - 1 ? { curve: 'inOutSine' } : {}) }));
const T = triples => triples.map(([time, x, y], i) => ({ time, x, y, ...(i < triples.length - 1 ? { curve: 'inOutSine' } : {}) }));
// A fighting stance (knees bent, feet apart) and a punch that drives the hips forward and back.
const punch = (hipsForward = 8) => ({ bones: {
  body: { rotate: K([[0, 0], [0.18, 8], [0.26, -12], [0.42, -10], [0.7, 0]]),
    translate: T([[0, 0, -18], [0.18, -6, -22], [0.26, hipsForward, -22], [0.42, hipsForward - 2, -22], [0.7, 0, -18]]) },
  upperArmFront: { rotate: K([[0, 0], [0.18, -70], [0.26, 92], [0.42, 88], [0.7, 0]]) },
  thighFront: { rotate: K([[0, 24], [0.7, 24]]) }, shinFront: { rotate: K([[0, -34], [0.7, -34]]) },
  thighBack: { rotate: K([[0, -24], [0.7, -24]]) }, shinBack: { rotate: K([[0, -26], [0.7, -26]]) },
} });

function feetOver(file, name, feet) {
  const sk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const model = compileSkeleton(sk), anim = model.animations.get(name), pose = new Pose(model);
  const track = Object.fromEntries(feet.map(f => [f, []]));
  for (let i = 0; i <= 42; i++) {
    pose.apply(anim, i / 60).updateWorld();
    for (const f of feet) { const b = pose.bones[model.boneIndex.get(f)]; track[f].push([b.worldX, b.worldY]); }
  }
  return Object.fromEntries(feet.map(f => {
    const xs = track[f].map(p => p[0]), ys = track[f].map(p => p[1]);
    return [f, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))];
  }));
}

test('a punch that carries the hips slides the feet, and critique says so; planted, the feet stay put', async () => {
  const s = studio();
  try {
    const r = await s.call('draw_rig', { name: 'hero', parts: [{ name: 'hero', component: { component: 'figure', build: 'side', h: 300 }, at: [0, 0] }] });
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    const feet = ['footFront', 'footBack'];

    const loose = await s.call('write_animation', { from: 'hero.json', animation: 'punch', clip: punch() });
    assert.equal(loose.error, undefined, JSON.stringify(loose.error));
    const looseFile = path.join(s.dir, loose.file);
    assert.ok(Math.max(...Object.values(feetOver(looseFile, 'punch', feet))) > 8, 'written as FK, the feet travel with the hips');
    const looseCritique = await s.call('critique_animation', { file: loose.file, animation: 'punch' });
    assert.ok(looseCritique.findings.some(f => f.code === 'foot-slide'), JSON.stringify(looseCritique.findings.map(f => f.code)));

    const planted = await s.call('write_animation', { from: 'hero.json', animation: 'punch', clip: punch(), plant: feet, replace: true });
    assert.equal(planted.error, undefined, JSON.stringify(planted.error));
    assert.deepEqual(planted.planted.map(p => p.bone), feet);
    for (const p of planted.planted) assert.ok(p.reach > 0.5 && p.reach <= 1, `${p.bone} reach ${p.reach}`);
    assert.equal(planted.plantWarning, undefined);
    const moved = feetOver(path.join(s.dir, planted.file), 'punch', feet);
    for (const f of feet) assert.ok(moved[f] < 0.5, `${f} moved ${moved[f]} units while planted`);
    const critique = await s.call('critique_animation', { file: planted.file, animation: 'punch' });
    const codes = critique.findings.map(f => f.code);
    assert.ok(!codes.includes('foot-slide'), JSON.stringify(codes));
    for (const bake of ['even-spacing', 'constant-speed', 'no-overlap']) assert.ok(!codes.includes(bake), `the solver's keys are not judged as the author's rhythm: ${bake}`);
    assert.equal((await s.call('check_skeleton', { file: planted.file })).verdict ?? 'ok', 'ok');

    // Hips driven farther than the back leg reaches: the answer says the foot lifts.
    const far = await s.call('write_animation', { from: 'hero.json', animation: 'punch', clip: punch(60), plant: feet, replace: true });
    assert.ok(far.planted.some(p => p.reach > 1));
    assert.match(far.plantWarning, /footBack/);

    const bad = await s.call('write_animation', { from: 'hero.json', animation: 'punch', clip: punch(), plant: ['body'], replace: true });
    assert.match(JSON.stringify(bad.error), /two bones above it/);
  } finally { s.done(); }
});

test('a hand planted `on` another bone rides it: the back hand stays on the point of a moving fist, the short way round', async () => {
  const s = studio();
  try {
    await s.call('draw_rig', { name: 'hero', parts: [{ name: 'hero', component: { component: 'figure', build: 'side', h: 300 }, at: [0, 0] }] });
    // The near arm swings up through a big arc; the far hand holds on to the near fist.
    const clip = { bones: {
      upperArmFront: { rotate: K([[0, 20], [0.35, 95], [0.7, 20]]) }, forearmFront: { rotate: K([[0, 60], [0.35, 10], [0.7, 60]]) },
      upperArmBack: { rotate: K([[0, 30], [0.7, 30]]) }, forearmBack: { rotate: K([[0, 70], [0.7, 70]]) },
    } };
    const r = await s.call('write_animation', { from: 'hero.json', animation: 'hold', clip, plant: [{ bone: 'handBack', on: 'handFront', at: [-4, 0] }] });
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    assert.equal(r.planted[0].on, 'handFront');
    assert.ok(r.planted[0].reach <= 1, `reach ${r.planted[0].reach}`);
    const sk = JSON.parse(fs.readFileSync(path.join(s.dir, r.file), 'utf8'));
    const model = compileSkeleton(sk), anim = model.animations.get('hold'), pose = new Pose(model);
    const B = n => pose.bones[model.boneIndex.get(n)];
    for (let i = 0; i <= 42; i++) {
      pose.apply(anim, i / 60).updateWorld();
      const f = B('handFront'), x = f.a * -4 + f.worldX, y = f.c * -4 + f.worldY, h = B('handBack');
      assert.ok(Math.hypot(h.worldX - x, h.worldY - y) < 0.6, `off the fist by ${Math.hypot(h.worldX - x, h.worldY - y).toFixed(2)} at ${(i / 60).toFixed(3)}`);
    }
    // Baked keys turn the short way: a fist that swings right round carries the held hand's angle
    // past ±180, and no limb may spin a full turn between two keys for it.
    const round = await s.call('write_animation', { from: 'hero.json', animation: 'hold', replace: true, plant: [{ bone: 'handBack', on: 'handFront' }],
      clip: { bones: { upperArmFront: { rotate: [{ time: 0, value: 0 }, { time: 0.7, value: 340 }] } } } });
    const spun = JSON.parse(fs.readFileSync(path.join(s.dir, round.file), 'utf8'));
    for (const bone of ['upperArmBack', 'forearmBack', 'handBack']) {
      const keys = spun.animations.hold.bones[bone].rotate;
      for (let i = 1; i < keys.length; i++) assert.ok(Math.abs(keys[i].value - keys[i - 1].value) < 90, `${bone} jumps ${keys[i - 1].value} -> ${keys[i].value}`);
    }
    const self = await s.call('write_animation', { from: 'hero.json', animation: 'hold', clip, plant: [{ bone: 'handBack', on: 'forearmBack' }], replace: true });
    assert.match(JSON.stringify(self.error), /cannot hold on to itself/);
  } finally { s.done(); }
});
