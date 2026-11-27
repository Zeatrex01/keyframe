// Gate for 0.2.1: path constraints, inherit timelines and skin-only bones and constraints on the
// studio's own engine (src/engine/constraints.js, src/engine/model.js, src/engine/pose.js), with
// no Spine code at all, so no Spine 4.2 file needs the add-on to pose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkeleton, poseAt, setupPose, collectDraws } from '../src/engine/index.js';
import { parseSkeleton } from '../src/runtime/index.js';

const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const deg = b => Math.atan2(b.c, b.a) * 180 / Math.PI;
const boneOf = (pose, name) => pose.bones[pose.model.boneIndex.get(name)];

// A path is triples of (in handle, point, out handle). A straight line from (0, 0) to (300, 0)
// with handles at thirds moves at even speed, so its parameter is its distance.
const LINE = [-100, 0, 0, 0, 100, 0, 200, 0, 300, 0, 400, 0];
// A quarter turn from (0, 0) to (100, 100), handles bent so it curves.
const BEND = [0, -50, 0, 0, 55, 0, 100, 45, 100, 100, 100, 155];

function pathRig({ vertices = LINE, constantSpeed = false, lengths = [300], closed = false, constraint = {}, animations = {}, chain = 3 } = {}) {
  const bones = [{ name: 'root' }, { name: 'track', parent: 'root' }];
  for (let i = 0; i < chain; i++) bones.push({ name: `b${i}`, parent: i ? `b${i - 1}` : 'root', x: i ? 50 : -500, length: 50 });
  return compileSkeleton({
    skeleton: { spine: '4.2.43' },
    bones,
    slots: [{ name: 'rail', bone: 'track', attachment: 'rail' }],
    skins: [{ name: 'default', attachments: { rail: { rail: { type: 'path', closed, constantSpeed, lengths, vertexCount: vertices.length / 2, vertices } } } }],
    path: [{ name: 'ride', bones: Array.from({ length: chain }, (_, i) => `b${i}`), target: 'rail', rotateMode: 'chain', ...constraint }],
    animations,
  });
}

test('a chain rides a straight path: each bone on it, spaced by its length, pointing along it', () => {
  const pose = setupPose(pathRig());
  ['b0', 'b1', 'b2'].forEach((name, i) => {
    const b = boneOf(pose, name);
    near(b.worldX, i * 50, `${name} x`, 1e-4); near(b.worldY, 0, `${name} y`, 1e-4);
    near(deg(b), 0, `${name} along the path`, 1e-4);
  });
  assert.deepEqual(pose.model.unsupported, [], 'nothing is left out');
});

test('position is a share of the path in percent mode and a distance in fixed mode; spacing adds to the bone length', () => {
  near(boneOf(setupPose(pathRig({ constraint: { position: 0.5 } })), 'b0').worldX, 150, 'half way');
  near(boneOf(setupPose(pathRig({ constraint: { positionMode: 'fixed', position: 40 } })), 'b0').worldX, 40, '40 units in');
  // Tangent mode places every bone on its own point, so the spacing shows as it is.
  const spread = constraint => setupPose(pathRig({ constraint: { rotateMode: 'tangent', ...constraint } }));
  near(boneOf(spread({ spacing: 10 }), 'b2').worldX, 120, 'length 50 + spacing 10, twice');
  near(boneOf(spread({ spacingMode: 'fixed', spacing: 30 }), 'b2').worldX, 60, 'a fixed step of 30');
  near(boneOf(spread({ spacingMode: 'percent', spacing: 0.1 }), 'b2').worldX, 60, 'a tenth of the path each');
  // Proportional: the gaps share `spacing` of the path per bone, weighed by the bones' lengths (equal bones: each gap is 0.9 x 300 x 50 / 100 = 135).
  near(boneOf(spread({ spacingMode: 'proportional', spacing: 0.9 }), 'b2').worldX, 270, 'two gaps of 135');
  // Chain mode keeps the chain joined: each bone starts at the tip of the one before.
  const chain = setupPose(pathRig({ constraint: { spacing: 10 } }));
  near(boneOf(chain, 'b2').worldX, 100, 'joined at the tips');
});

test('an open path goes on straight past its end; a closed path wraps round', () => {
  const past = setupPose(pathRig({ constraint: { positionMode: 'fixed', position: 280 } }));
  near(boneOf(past, 'b2').worldX, 380, 'past the end, on the end tangent', 1e-4);
  near(boneOf(past, 'b2').worldY, 0, 'still on the line', 1e-4);
  const before = setupPose(pathRig({ constraint: { positionMode: 'fixed', position: -20 } }));
  near(boneOf(before, 'b0').worldX, -20, 'before the start, on the start tangent', 1e-4);
  // A closed square loop of four straight sides (100 each): 1.25 of the way round is a quarter.
  const square = [-33, 0, 0, 0, 33, 0, 100, -33, 100, 0, 100, 33, 133, 100, 100, 100, 67, 100, 0, 133, 0, 100, 0, 67];
  const lap = c => setupPose(pathRig({ vertices: square, closed: true, constantSpeed: true, lengths: [], chain: 1, constraint: { rotateMode: 'tangent', ...c } }));
  const quarter = boneOf(lap({ position: 0.25 }), 'b0'), again = boneOf(lap({ position: 1.25 }), 'b0');
  near(again.worldX, quarter.worldX, 'wraps x', 1e-3); near(again.worldY, quarter.worldY, 'wraps y', 1e-3);
});

test('tangent mode turns each bone along the curve; constant speed spaces bones evenly along a bent path', () => {
  const pose = setupPose(pathRig({ vertices: BEND, constantSpeed: true, lengths: [], chain: 1, constraint: { rotateMode: 'tangent', position: 0 } }));
  near(deg(boneOf(pose, 'b0')), 0, 'leaves toward its first handle', 1e-4);
  const end = setupPose(pathRig({ vertices: BEND, constantSpeed: true, lengths: [], chain: 1, constraint: { rotateMode: 'tangent', position: 1 } }));
  near(boneOf(end, 'b0').worldX, 100, 'ends at the end x', 1e-3); near(boneOf(end, 'b0').worldY, 100, 'ends at the end y', 1e-3);
  near(deg(boneOf(end, 'b0')), 90, 'arrives along its last handle', 1e-3);
  // Five short bones (length 20) along the bend: consecutive origins about 20 apart along the path.
  const many = setupPose(pathRig({ vertices: BEND, constantSpeed: true, lengths: [], chain: 5,
    constraint: { rotateMode: 'tangent', spacingMode: 'fixed', spacing: 30 } }));
  const gaps = [1, 2, 3, 4].map(i => Math.hypot(boneOf(many, `b${i}`).worldX - boneOf(many, `b${i - 1}`).worldX, boneOf(many, `b${i}`).worldY - boneOf(many, `b${i - 1}`).worldY));
  for (const g of gaps) near(g, 30, 'an even step along the bend (chord a little shorter than arc)', 1.5);
});

test('mixes blend toward the path, an offset rotation turns the bones, chainScale stretches them to the next point', () => {
  const half = setupPose(pathRig({ constraint: { mixX: 0.5, mixY: 0.5, mixRotate: 0 } }));
  near(boneOf(half, 'b0').worldX, -250, 'half way from -500 to 0');
  const turned = setupPose(pathRig({ constraint: { rotation: 30 } }));
  near(deg(boneOf(turned, 'b0')), 30, 'offset rotation');
  const stretched = setupPose(pathRig({ constraint: { rotateMode: 'chainScale', spacingMode: 'fixed', spacing: 100, rotation: 0.0001 } }));
  near(Math.hypot(boneOf(stretched, 'b0').a, boneOf(stretched, 'b0').c), 2, 'a 50-long bone reaches a point 100 away');
});

test('path timelines key position, spacing and mixes; a mix of 0 leaves the bones where they were', () => {
  const model = pathRig({ animations: { slide: { path: { ride: {
    position: [{ time: 0, value: 0 }, { time: 1, value: 0.5 }],
    spacing: [{ time: 0, value: 0 }, { time: 1, value: 20 }],
    mix: [{ time: 0 }, { time: 2, mixRotate: 0, mixX: 0, mixY: 0 }],
  } } } } });
  const mid = poseAt(model, 'slide', 0.5);
  near(boneOf(mid, 'b0').worldX, 75 * 0.75 + (-500) * 0.25, 'a quarter of the path at mix 0.75', 1e-3);
  const off = poseAt(model, 'slide', 2);
  near(boneOf(off, 'b0').worldX, -500, 'mix 0: the bone keeps its own place');
});

test('a path attachment can be weighted and deformed; the bones follow its world shape', () => {
  // Every path point on the track bone with weight 1, then the track moves up by 30.
  const weighted = [];
  for (let i = 0; i < LINE.length; i += 2) weighted.push(1, 1, LINE[i], LINE[i + 1], 1);
  const model = compileSkeleton({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'track', parent: 'root', y: 30 }, { name: 'b0', parent: 'root', length: 50 }],
    slots: [{ name: 'rail', bone: 'track', attachment: 'rail' }],
    skins: [{ name: 'default', attachments: { rail: { rail: { type: 'path', constantSpeed: false, lengths: [300], vertexCount: 6, vertices: weighted } } } }],
    path: [{ name: 'ride', bones: ['b0'], target: 'rail', position: 0.5 }],
    animations: { lift: { attachments: { default: { rail: { rail: { deform: [{ time: 0, offset: 0, vertices: [0, 0, 0, 10, 0, 10, 0, 10, 0, 10, 0, 0] }] } } } } } },
  });
  near(boneOf(setupPose(model), 'b0').worldY, 30, 'on the moved track');
  near(boneOf(poseAt(model, 'lift', 0), 'b0').worldY, 40, 'on the deformed track');
  assert.deepEqual(model.unsupported, []);
});

test('an inherit timeline switches how a bone follows its parent', () => {
  const model = compileSkeleton({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root', rotation: 90 }, { name: 'hand', parent: 'arm', x: 10 }],
    animations: { let_go: { bones: { hand: { inherit: [{ time: 0 }, { time: 0.5, inherit: 'noRotationOrReflection' }] } } } },
  });
  near(deg(boneOf(poseAt(model, 'let_go', 0.25), 'hand')), 90, 'follows the turned arm');
  near(deg(boneOf(poseAt(model, 'let_go', 0.75), 'hand')), 0, 'keeps its own direction');
  near(deg(boneOf(setupPose(model), 'hand')), 90, 'setup is the bone\'s own inherit again');
  assert.deepEqual(model.unsupported, []);
});

test('a skin-only bone and constraint act only under a skin that lists them', () => {
  const json = {
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'cape', parent: 'root', skin: true }, { name: 'aim', parent: 'root', x: 50, y: 50 }, { name: 'gun', parent: 'root' }],
    slots: [{ name: 'cape', bone: 'cape', attachment: 'cape' }, { name: 'body', bone: 'root', attachment: 'body' }],
    ik: [{ name: 'point', bones: ['gun'], target: 'aim', skin: true }],
    skins: [
      { name: 'default', attachments: { cape: { cape: { width: 10, height: 10 } }, body: { body: { width: 10, height: 10 } } } },
      { name: 'hero', bones: ['cape'], ik: ['point'], attachments: {} },
    ],
  };
  const model = compileSkeleton(json);
  const regionOf = () => ({ page: 'p', u: 0, v: 0, u2: 1, v2: 1, width: 10, height: 10, originalWidth: 10, originalHeight: 10, offsetX: 0, offsetY: 0, degrees: 0 });
  const drawn = pose => collectDraws(pose, regionOf).draws.map(d => d.slot).sort();
  const plain = setupPose(model), hero = setupPose(model, { skin: 'hero' });
  assert.deepEqual(drawn(plain), ['body'], 'the cape bone is off, so its slot is not drawn');
  assert.deepEqual(drawn(hero), ['body', 'cape'], 'the hero skin switches it on');
  near(deg(boneOf(plain, 'gun')), 0, 'the IK is off without the skin');
  near(deg(boneOf(hero, 'gun')), 45, 'the IK aims under the hero skin');
  assert.deepEqual(model.unsupported, []);
});

test('no Spine 4.2 constraint or skin sends a file to the add-on any more', async () => {
  const data = await parseSkeleton({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'b0', parent: 'root', length: 50, skin: true }],
    slots: [{ name: 'rail', bone: 'root', attachment: 'rail' }],
    skins: [{ name: 'default', bones: ['b0'], path: ['ride'], attachments: { rail: { rail: { type: 'path', lengths: [300], vertexCount: 6, vertices: LINE } } } }],
    path: [{ name: 'ride', bones: ['b0'], target: 'rail', skin: true }],
  });
  assert.equal(data.backend, 'keyframe');
  assert.deepEqual(data.limits, []);
});

test('Godot bakes the bones a path or an inherit key moves, since its own 2D stack has neither', async () => {
  const { godotScene } = await import('../src/engine/godot.js');
  const scene = godotScene({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'b0', parent: 'root', length: 50 }, { name: 'hand', parent: 'root' }],
    slots: [{ name: 'rail', bone: 'root', attachment: 'rail' }],
    skins: [{ name: 'default', attachments: { rail: { rail: { type: 'path', lengths: [300], vertexCount: 6, vertices: LINE } } } }],
    path: [{ name: 'ride', bones: ['b0'], target: 'rail' }],
    animations: { go: { path: { ride: { position: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } }, bones: { hand: { inherit: [{ time: 0, inherit: 'noScale' }] } } } },
  }, { atlasText: '' });
  assert.ok(scene.report.baked.includes('bone b0: path ride'), JSON.stringify(scene.report.baked));
  assert.ok(scene.report.baked.includes('bone hand: inherit keys'), JSON.stringify(scene.report.baked));
});
