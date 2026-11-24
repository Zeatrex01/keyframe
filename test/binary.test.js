// Gate for src/spine/binary.js: our .skel must mean the same thing as our .json, and the
// official runtime is the judge. Ported from legacy test_skel_binary.js.
//
// The writer claims to be the exact inverse of the official reader. That claim is worth
// nothing unless the official reader agrees, so this gate never uses our own code to check
// our own code:
//   1. the source JSON is parsed by spine-ts's SkeletonJson        -> SkeletonData A
//   2. writeSkeletonBinary writes the same JSON as bytes
//   3. the bytes are parsed by spine-ts's SkeletonBinary           -> SkeletonData B
//   4. A and B are compared: setup data, every timeline's frames and curves, and the
//      poses the runtime produces at several times per animation.
// Both parsers are the vendored official spine-ts 4.2 runtime, in-process. Legacy needed a
// headless browser for steps 1, 3 and 4 and reported a partial skip without one; here
// they always run.
//
// Both sides go through the runtime's own entry points: parseSkeleton for the JSON and
// parseSkeletonBinary for the bytes (which also enforces the 4.2 version guard). Their
// texture-free loaders give every region and mesh the same neutral region, so the two
// readers resolve attachments identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { writeSkeletonBinary, BINARY_VERSION } from '../src/spine/binary.js';
import { fixPaths } from '../src/spine/path-fix.js';
import { loadRuntime, parseSkeleton, parseSkeletonBinary, sampleAnimation, poseSetup, majorMinor } from '../src/runtime/index.js';
import { needsSpine } from './helpers/spine-addon.js';
import { isStudioError } from '../src/shared/errors.js';

const clone = o => structuredClone(o);
const readJson = url => JSON.parse(fs.readFileSync(url, 'utf8'));

// ── readers ──────────────────────────────────────────────────────────────────

async function readBoth(json, bytes) {
  const spine = await loadRuntime();
  const fromJson = await parseSkeleton(json, { backend: 'spine' });
  const fromBinary = await parseSkeletonBinary(bytes);
  assert.equal(majorMinor(fromBinary.version), BINARY_VERSION, 'the binary carries a 4.2 version');
  return { spine, fromJson, fromBinary };
}

// ── what is compared ─────────────────────────────────────────────────────────

// The binary stores every number as float32 and cannot say "absent" for header scalars:
// 2275.94 comes back as 2275.93994140625 and a missing `y` as 0. Both are properties of
// the format (a real .skel from the Spine editor behaves the same), not writer bugs, so
// both sides are compared at float32 instead of loosening the comparison.
const q = v => Math.fround(v ?? 0);
const color = c => c ? [q(c.r), q(c.g), q(c.b), q(c.a)] : null;
// A dark colour is stored as rgb888: the binary has no alpha for it, and the two-colour
// tint never reads one.
const rgb = c => c ? [q(c.r), q(c.g), q(c.b)] : null;

// A compact, comparable shape: only what both formats are supposed to carry. `hash` is
// excluded on purpose: the binary hash is editor-computed.
function setupSummary(d) {
  return {
    version: majorMinor(d.version), x: q(d.x), y: q(d.y), width: q(d.width), height: q(d.height),
    referenceScale: q(d.referenceScale),
    bones: d.bones.map(b => [b.name, b.parent?.name ?? null, q(b.rotation), q(b.x), q(b.y), q(b.scaleX), q(b.scaleY),
      q(b.shearX), q(b.shearY), q(b.length), b.inherit, b.skinRequired]),
    slots: d.slots.map(s => [s.name, s.boneData.name, color(s.color), rgb(s.darkColor), s.attachmentName || null, s.blendMode]),
    ik: d.ikConstraints.map(c => [c.name, c.order, c.bones.map(b => b.name), c.target.name,
      q(c.mix), q(c.softness), c.bendDirection, c.compress, c.stretch, c.uniform, c.skinRequired]),
    transform: d.transformConstraints.map(c => [c.name, c.order, c.bones.map(b => b.name), c.target.name,
      c.local, c.relative, c.skinRequired, q(c.offsetRotation), q(c.offsetX), q(c.offsetY), q(c.offsetScaleX),
      q(c.offsetScaleY), q(c.offsetShearY), q(c.mixRotate), q(c.mixX), q(c.mixY), q(c.mixScaleX), q(c.mixScaleY), q(c.mixShearY)]),
    path: d.pathConstraints.map(c => [c.name, c.order, c.skinRequired, c.bones.map(b => b.name), c.target.name,
      c.positionMode, c.spacingMode, c.rotateMode, q(c.offsetRotation), q(c.position), q(c.spacing),
      q(c.mixRotate), q(c.mixX), q(c.mixY)]),
    physics: d.physicsConstraints.map(c => [c.name, c.order, c.skinRequired, c.bone.name,
      q(c.x), q(c.y), q(c.rotate), q(c.scaleX), q(c.shearX), q(c.limit), q(c.step), q(c.inertia), q(c.strength),
      q(c.damping), q(c.massInverse), q(c.wind), q(c.gravity), q(c.mix),
      [c.inertiaGlobal, c.strengthGlobal, c.dampingGlobal, c.massGlobal, c.windGlobal, c.gravityGlobal, c.mixGlobal]]),
    skins: d.skins.map(s => [s.name, s.bones.map(b => b.name), s.constraints.map(c => c.name),
      s.getAttachments().map(e => [e.slotIndex, e.name, attachmentSummary(e.attachment)])
        .sort((a, b) => (a[0] - b[0]) || String(a[1]).localeCompare(String(b[1])))]),
    events: d.events.map(e => [e.name, e.intValue, q(e.floatValue), e.stringValue, e.audioPath, q(e.volume), q(e.balance)]),
    animations: d.animations.map(a => [a.name, q(a.duration)]),
  };
}

function attachmentSummary(a) {
  if (!a) return null;
  const out = { type: a.constructor.name, name: a.name };
  for (const k of ['path', 'x', 'y', 'scaleX', 'scaleY', 'rotation', 'width', 'height', 'closed', 'constantSpeed',
    'worldVerticesLength', 'hullLength']) {
    // A mesh's width and height are nonessential (compared in nonessentialSummary).
    if (a.regionUVs && (k === 'width' || k === 'height')) continue;
    if (a[k] !== undefined) out[k] = typeof a[k] === 'number' ? q(a[k]) : a[k];
  }
  for (const k of ['vertices', 'bones', 'lengths', 'triangles', 'regionUVs']) {
    if (a[k]) out[k] = Array.from(a[k], v => q(v));
  }
  // Region and mesh colours are essential (a tint). Bounding box, path, point and clipping
  // colours are editor-only nonessential data, compared in nonessentialSummary.
  if (a.color && (a.region !== undefined || a.regionUVs)) out.color = color(a.color);
  if (a.endSlot) out.endSlot = a.endSlot.name;
  if (a.getParentMesh?.()) out.parent = a.getParentMesh().name;
  if (a.timelineAttachment) out.timelineAttachment = a.timelineAttachment.name;
  return out;
}

// Nonessential data: carried only when the writer is asked to (the default). Colours are
// compared where the JSON sets them: for an unset one the writer stores the Spine editor's
// default (bone 9b9b9bff, path ff7f00ff, ...), while spine-ts falls back to its own class
// default, so an unset colour has no single right answer to compare against.
function nonessentialSummary(d, json) {
  const hasColor = new Set();
  for (const b of json.bones) if (b.color) hasColor.add(`bone/${b.name}`);
  for (const s of json.skins) {
    for (const set of Object.values(s.attachments)) for (const [k, a] of Object.entries(set)) if (a.color) hasColor.add(`att/${k}`);
  }
  const attachments = d.skins.flatMap(s => s.getAttachments());
  return {
    fps: q(d.fps), imagesPath: d.imagesPath, audioPath: d.audioPath,
    bones: d.bones.map(b => [b.name, hasColor.has(`bone/${b.name}`) ? color(b.color) : '-']),
    slots: d.slots.map(s => [s.name, s.visible]),
    meshes: attachments.filter(e => e.attachment?.regionUVs && !e.attachment.getParentMesh?.())
      .map(e => [e.name, Array.from(e.attachment.edges ?? []), q(e.attachment.width), q(e.attachment.height)]),
    colors: attachments.filter(e => hasColor.has(`att/${e.name}`)).map(e => [e.name, color(e.attachment.color)]),
  };
}

// Every timeline of every animation: frames exactly (both readers store float32), curves
// within float32 rounding of the control points, and the per-type payloads.
function timelineTable(spine, d) {
  return d.animations.map(a => ({
    name: a.name,
    timelines: a.timelines.map(t => describeTimeline(spine, t, d.slots.length)).sort((x, y) => x.key.localeCompare(y.key)),
  }));
}

function describeTimeline(spine, t, slotCount) {
  const out = {
    key: `${t.constructor.name}|${t.propertyIds.join(',')}`,
    frameCount: t.getFrameCount(),
    frames: Array.from(t.frames),
    curves: t.curves ? Array.from(t.curves) : null,
    alpha: t instanceof spine.AlphaTimeline,
  };
  // A deform's property id carries the attachment's runtime id, which differs per parse.
  if (t instanceof spine.DeformTimeline) {
    out.key = `deform|${t.slotIndex}|${t.attachment.name}`;
    out.vertices = t.vertices.map(v => Array.from(v));
  }
  if (t instanceof spine.AttachmentTimeline) out.names = [...t.attachmentNames];
  if (t instanceof spine.DrawOrderTimeline) {
    // JSON stores "setup order" as null; the binary as the identity permutation.
    const identity = Array.from({ length: slotCount }, (_, i) => i);
    out.drawOrders = t.drawOrders.map(o => (o ? Array.from(o) : identity));
  }
  if (t instanceof spine.EventTimeline) {
    out.events = t.events.map(e => [e.data.name, q(e.time), e.intValue, q(e.floatValue), e.stringValue, q(e.volume), q(e.balance)]);
  }
  return out;
}

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const ALPHA_STEP = 0.5 / 255 + 1e-7;   // alpha keys are stored as one byte

function assertTimelinesEqual(spine, fromJson, fromBinary, label) {
  const a = timelineTable(spine, fromJson), b = timelineTable(spine, fromBinary);
  assert.deepEqual(b.map(x => x.name), a.map(x => x.name), `${label}: animation names`);
  a.forEach((animA, i) => {
    const animB = b[i];
    assert.deepEqual(animB.timelines.map(t => [t.key, t.frameCount]), animA.timelines.map(t => [t.key, t.frameCount]),
      `${label} / ${animA.name}: timeline types and frame counts`);
    animA.timelines.forEach((ta, j) => {
      const tb = animB.timelines[j];
      const where = `${label} / ${animA.name} / ${ta.key}`;
      if (ta.alpha) {
        ta.frames.forEach((v, k) => assert.ok(near(v, tb.frames[k], ALPHA_STEP), `${where}: frame value ${k}: ${v} vs ${tb.frames[k]}`));
      } else {
        assert.deepEqual(tb.frames, ta.frames, `${where}: frames`);
      }
      if (ta.curves) {
        assert.equal(tb.curves.length, ta.curves.length, `${where}: curve size`);
        const tolerance = ta.alpha ? ALPHA_STEP : 0;
        ta.curves.forEach((v, k) => assert.ok(near(v, tb.curves[k], tolerance + 1e-4 * Math.max(1, Math.abs(v))),
          `${where}: curve entry ${k}: ${v} vs ${tb.curves[k]}`));
      }
      for (const k of ['vertices', 'names', 'drawOrders', 'events']) {
        if (ta[k] !== undefined) assert.deepEqual(tb[k], ta[k], `${where}: ${k}`);
      }
    });
  });
}

// The poses the runtime produces, at several times per animation, in every skin.
function samplingTimes(duration) {
  return duration > 0 ? [0, duration * 0.25, duration * 0.5, duration * 0.75, duration] : [0];
}
const BONE_FIELDS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY', 'worldX', 'worldY'];

function assertPosesEqual(poseA, poseB, where) {
  const tol = v => 1e-3 + 1e-4 * Math.abs(v);
  poseA.bones.forEach((ba, i) => {
    const bb = poseB.bones[i];
    assert.equal(bb.name, ba.name);
    assert.equal(bb.active, ba.active, `${where} ${ba.name}.active`);
    for (const k of BONE_FIELDS) assert.ok(near(ba[k], bb[k], tol(ba[k])), `${where} ${ba.name}.${k}: ${ba[k]} vs ${bb[k]}`);
    for (const k of Object.keys(ba.applied)) {
      assert.ok(near(ba.applied[k], bb.applied[k], tol(ba.applied[k])), `${where} ${ba.name}.applied.${k}: ${ba.applied[k]} vs ${bb.applied[k]}`);
    }
    for (const k of ['a', 'b', 'c', 'd']) assert.ok(near(ba.matrix[k], bb.matrix[k], 1e-4), `${where} ${ba.name}.matrix.${k}`);
  });
  poseA.slots.forEach((sa, i) => {
    const sb = poseB.slots[i];
    assert.equal(sb.attachment, sa.attachment, `${where} ${sa.name}.attachment`);
    for (const k of ['r', 'g', 'b', 'a']) assert.ok(near(sa.color[k], sb.color[k], ALPHA_STEP), `${where} ${sa.name}.color.${k}`);
  });
  assert.deepEqual(poseB.drawOrder, poseA.drawOrder, `${where} draw order`);
}

async function assertPlaysTheSame(fromJson, fromBinary, label) {
  const skins = [undefined, ...fromJson.skins.map(s => s.name).filter(n => n !== 'default')];
  for (const skin of skins) {
    const setupA = await poseSetup(fromJson, { skin }), setupB = await poseSetup(fromBinary, { skin });
    assertPosesEqual(setupA, setupB, `${label} setup${skin ? ` [${skin}]` : ''}`);
    for (const anim of fromJson.animations) {
      const times = samplingTimes(anim.duration);
      const a = await sampleAnimation(fromJson, anim.name, times, { skin });
      const b = await sampleAnimation(fromBinary, anim.name, times, { skin });
      a.forEach((pose, i) => assertPosesEqual(pose, b[i], `${label} / ${anim.name}${skin ? ` [${skin}]` : ''} @${times[i].toFixed(3)}`));
    }
  }
}

async function assertRoundTrip(json, label, options) {
  const bytes = writeSkeletonBinary(json, options);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 64, `${label}: bytes produced`);
  const { spine, fromJson, fromBinary } = await readBoth(json, bytes);
  const a = setupSummary(fromJson), b = setupSummary(fromBinary);
  // Section by section, so a failure names which part diverged.
  for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], `${label} / ${k}: the binary reads like the JSON`);
  assertTimelinesEqual(spine, fromJson, fromBinary, label);
  await assertPlaysTheSame(fromJson, fromBinary, label);
  return { bytes, fromJson, fromBinary };
}

// ── samples ──────────────────────────────────────────────────────────────────

// The real project file carries the known-broken 3n+1 path (vertexCount 61) that path-fix
// exists to repair; the official parser refuses it outright with "Invalid array length",
// which test/path-fix.test.js pins. Repairing it first is what the studio itself does
// before delivering, and it keeps this gate measuring the binary writer instead of
// re-failing a defect another gate owns.
const SAMPLE_INTRO = () => fixPaths(readJson(new URL('./fixtures/binary/sample_intro.json', import.meta.url))).skeleton;

// The legacy gate's second skeleton: what the fixture does not exercise. Two-value
// timelines with real bezier curves, stepped keys, slot colour and alpha, draw order,
// events, a bone whose channels are keyed separately, and a weighted mesh with a deform.
function richSkeleton() {
  return {
    skeleton: { spine: '4.2', x: -10, y: -20, width: 100, height: 200, referenceScale: 100, fps: 30, images: './img/' },
    bones: [
      { name: 'root' },
      { name: 'body', parent: 'root', x: 5, y: 10, rotation: 12, scaleX: 1.2, shearX: 3, length: 40 },
      { name: 'arm', parent: 'body', x: 20, inherit: 'noScale' },
    ],
    slots: [
      { name: 'back', bone: 'root', attachment: 'square', color: 'ff8800ff' },
      { name: 'front', bone: 'arm', attachment: 'square', blend: 'additive', dark: '203040' },
    ],
    skins: [{ name: 'default', attachments: {
      back: { square: { width: 32, height: 32, x: 1, y: 2, rotation: 45, scaleX: 2 } },
      front: {
        square: { width: 16, height: 16, color: '00ff00ff' },
        // A weighted mesh: 4 vertices, each bound to one bone, hull 4, so 2 triangles. The
        // heaviest thing the format asks a writer to get right (vertexCount derived from
        // uvs, the weighted vertex layout, and a triangle count the reader derives).
        weightedMesh: { type: 'mesh', width: 20, height: 20, hull: 4,
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
          triangles: [0, 1, 2, 2, 3, 0],
          vertices: [1, 2, -10, -10, 1,
            1, 2, 10, -10, 1,
            1, 2, 10, 10, 1,
            1, 2, -10, 10, 1],
          edges: [0, 2, 2, 4, 4, 6, 6, 0] },
      },
    } }],
    events: { burst: { int: 7, float: 1.5, string: 'boom' } },
    animations: {
      test: {
        bones: {
          body: {
            rotate: [{ time: 0, value: 0, curve: [0.25, 0, 0.75, 30] },
              { time: 1, value: 30, curve: 'stepped' },
              { time: 2, value: 60 }],
            translate: [{ time: 0, x: 0, y: 0, curve: [0.25, 0, 0.75, 10, 0.25, 0, 0.75, 20] },
              { time: 1, x: 10, y: 20 }],
          },
          arm: { scale: [{ time: 0, x: 1, y: 1 }, { time: 1, x: 1.5, y: 0.5 }],
            shearx: [{ time: 0, value: 0 }, { time: 1, value: 15 }] },
        },
        slots: {
          front: {
            rgba: [{ time: 0, color: 'ffffffff', curve: 'stepped' }, { time: 1, color: 'ff0000aa' }],
            attachment: [{ time: 0, name: 'square' }, { time: 0.5, name: null }],
          },
          back: { alpha: [{ time: 0, value: 1 }, { time: 1, value: 0.25 }] },
        },
        // Deform on the weighted mesh, with its own interleave (time, verts, time, curve, verts).
        attachments: { default: { front: { weightedMesh: { deform: [
          { time: 0, offset: 2, vertices: [1.5, -2.5] },
          { time: 1, curve: 'stepped' },
          { time: 2, offset: 0, vertices: [0.5, 0.5, 0.25, 0.25] },
        ] } } } },
        drawOrder: [{ time: 0.5, offsets: [{ slot: 'back', offset: 1 }] }],
        events: [{ time: 0.75, name: 'burst', int: 9, float: 2.5, string: 'new' }],
      },
    },
  };
}

// Everything the writer supports, at least once: every attachment type, every constraint
// with non-default settings, a second skin with bones and constraints, every bone, slot,
// IK, transform, path, physics, deform, draw order and event timeline, bezier and stepped
// curves on each curve shape, and events with and without audio.
function fullCoverageSkeleton() {
  const bez = n => Array.from({ length: n }, (_, i) => [0.2, 0.1 * (i + 1), 0.6, 0.3 * (i + 1)]).flat();
  return {
    skeleton: { hash: 'cover', spine: '4.2.43', x: -50, y: -60, width: 300, height: 400, referenceScale: 80, fps: 24,
      images: './images/', audio: './audio/' },
    bones: [
      { name: 'root' },
      { name: 'hip', parent: 'root', y: 40, color: 'ff0000ff', icon: 'star', visible: false },
      { name: 'thigh', parent: 'hip', rotation: -90, length: 50 },
      { name: 'shin', parent: 'thigh', x: 50, length: 50, inherit: 'noRotationOrReflection' },
      { name: 'target', parent: 'root', x: 30, y: -20, shearY: 4 },
      { name: 'follower', parent: 'root', x: -30, inherit: 'onlyTranslation' },
      { name: 'rider', parent: 'root', scaleY: 0.8 },
      { name: 'tail', parent: 'hip', x: -10, length: 30, inherit: 'noScaleOrReflection' },
      { name: 'cape', parent: 'root', skin: true, x: 5 },
      { name: 'hand', parent: 'shin', x: 50 },
    ],
    slots: [
      { name: 'body', bone: 'hip', attachment: 'body' },
      { name: 'leg', bone: 'shin', attachment: 'leg', color: 'ffeeddcc', dark: '112233', blend: 'multiply' },
      { name: 'shadow', bone: 'root', attachment: 'shadow', blend: 'screen', visible: false },
      { name: 'rail', bone: 'root', attachment: 'rail' },
      { name: 'hitbox', bone: 'hip', attachment: 'box' },
      { name: 'muzzle', bone: 'shin', attachment: 'tip' },
      { name: 'mask', bone: 'root', attachment: 'mask', dark: '000000' },   // rgb2 needs a dark colour
      { name: 'capeSlot', bone: 'cape' },
    ],
    ik: [
      { name: 'legIk', order: 1, bones: ['thigh', 'shin'], target: 'target', mix: 0.8, softness: 4,
        bendPositive: false, compress: true, stretch: true, uniform: true },
      { name: 'idleIk', order: 5, bones: ['tail'], target: 'target', mix: 0, skin: true },
      { name: 'reachIk', order: 7, bones: ['hand'], target: 'target' },   // every default, mix 1 included
    ],
    transform: [
      { name: 'follow', order: 2, bones: ['follower'], target: 'hip', rotation: 10, x: 5, y: -5, scaleX: 0.1,
        scaleY: 0.2, shearY: 3, mixRotate: 0.5, mixX: 0.6, mixY: 0.7, mixScaleX: 0.8, mixScaleY: 0.9, mixShearY: 0.4,
        local: true, relative: true },
      { name: 'plain', order: 6, bones: ['rider'], target: 'target', mixRotate: 0, mixScaleX: 0 },
    ],
    path: [
      { name: 'ride', order: 0, bones: ['rider'], target: 'rail', positionMode: 'fixed', spacingMode: 'percent',
        rotateMode: 'chainScale', rotation: 15, position: 20, spacing: 5, mixRotate: 0.5, mixX: 0.75, mixY: 0.25 },
    ],
    physics: [
      { name: 'sway', order: 3, bone: 'tail', x: 1, y: 1, rotate: 1, scaleX: 0.5, shearX: 0.5, limit: 3000, fps: 30,
        inertia: 0.5, strength: 80, damping: 0.9, mass: 2, wind: 1, gravity: -2, mix: 0.7,
        inertiaGlobal: true, windGlobal: true, gravityGlobal: true },
      { name: 'flap', order: 4, bone: 'cape', rotate: 1, skin: true },
    ],
    skins: [
      { name: 'default', attachments: {
        body: { body: { type: 'mesh', width: 40, height: 40, hull: 4, uvs: [0, 0, 1, 0, 1, 1, 0, 1],
          triangles: [0, 1, 2, 2, 3, 0],
          vertices: [2, 1, -20, -20, 0.5, 2, -20, -20, 0.5, 1, 1, 20, -20, 1, 1, 1, 20, 20, 1,
            2, 1, -20, 20, 0.25, 7, -20, 20, 0.75],
          edges: [0, 2, 2, 4], color: 'ffffff80' } },
        leg: { leg: { type: 'mesh', path: 'images/leg', width: 10, height: 50, hull: 4,
          uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5], triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
          vertices: [-5, 0, 5, 0, 5, 50, -5, 50, 0, 25] } },
        shadow: { shadow: { name: 'shadowRegion', path: 'images/shadow', x: 3, y: -4, rotation: 7, scaleX: 1.5,
          scaleY: 0.5, width: 60, height: 12, color: '00000080' } },
        rail: { rail: { type: 'path', closed: true, constantSpeed: false, vertexCount: 6,
          lengths: [150, 320], vertices: [-100, 0, -50, 50, 0, 50, 50, 50, 100, 0, 50, -50], color: '00ff00ff' } },
        hitbox: { box: { type: 'boundingbox', vertexCount: 3,
          vertices: [1, 1, 0, 0, 1, 1, 1, 10, 0, 1, 2, 1, 0, 10, 0.5, 7, 0, 10, 0.5], color: 'ff00ffff' } },
        muzzle: { tip: { type: 'point', x: 5, y: 6, rotation: 30, color: 'ffff00ff' } },
        mask: { mask: { type: 'clipping', end: 'rail', vertexCount: 3, vertices: [0, 0, 100, 0, 50, 80], color: 'ce3a3aff' } },
      } },
      { name: 'alt', color: 'ff00ffff', bones: ['cape'], ik: ['idleIk'], physics: ['flap'], attachments: {
        leg: { legLinked: { type: 'linkedmesh', parent: 'leg', skin: 'default', timelines: false, width: 10, height: 50,
          path: 'images/leg' } },
        capeSlot: { cape: { width: 30, height: 60 } },
      } },
    ],
    events: {
      step: {},
      shout: { int: 1, float: 2.5, string: 'hi', audio: 'shout.ogg', volume: 0.5, balance: 0.2 },
      silent: { audio: '' },
    },
    animations: {
      everything: {
        bones: {
          hip: {
            rotate: [{ value: 0, curve: bez(1) }, { time: 0.5, value: 45, curve: 'stepped' }, { time: 1, value: -10 }],
            translate: [{ x: 0, y: 0, curve: bez(2) }, { time: 1, x: 10, y: -5 }],
            translatex: [{ value: 1 }, { time: 0.4, value: 3 }],
            translatey: [{ value: -1, curve: bez(1) }, { time: 0.6, value: 2 }],
            scale: [{ x: 1, y: 1, curve: 'stepped' }, { time: 0.3, x: 1.2, y: 0.9 }],
            scalex: [{ value: 1 }, { time: 1, value: 0.5 }],
            scaley: [{ value: 0.8, curve: bez(1) }, { time: 1, value: 1.1 }],
            shear: [{ x: 0, y: 0, curve: bez(2) }, { time: 1, x: 5, y: -5 }],
            shearx: [{ value: 0 }, { time: 0.7, value: 4 }],
            sheary: [{ value: 0 }, { time: 0.8, value: -3 }],
          },
          tail: { inherit: [{ inherit: 'noScale' }, { time: 0.5, inherit: 'normal' }, { time: 0.9, inherit: 'onlyTranslation' }] },
        },
        slots: {
          body: {
            rgba: [{ color: 'ffffffff', curve: bez(4) }, { time: 1, color: '80402010' }],
            attachment: [{ name: 'body' }, { time: 0.5, name: null }, { time: 0.75, name: 'body' }],
          },
          leg: { rgba2: [{ light: 'ff8040c0', dark: '102030', curve: bez(7) }, { time: 1, light: '20406080', dark: 'a0b0c0' }] },
          shadow: { rgb: [{ color: 'ff0000', curve: bez(3) }, { time: 1, color: '00ff00' }] },
          mask: { rgb2: [{ light: 'ffffff', dark: '000000', curve: 'stepped' }, { time: 1, light: '808080', dark: '404040' }] },
          hitbox: { alpha: [{ value: 1, curve: bez(1) }, { time: 1, value: 0.3 }] },
        },
        ik: {
          legIk: [{ mix: 1, curve: bez(2) }, { time: 0.5, mix: 0.3, softness: 5, bendPositive: false, compress: true,
            stretch: true, curve: 'stepped' }, { time: 1, mix: 0 }],
        },
        transform: {
          // mixShearY stays constant: see the official JSON reader quirk pinned below.
          follow: [{ mixRotate: 1, mixX: 0.5, mixShearY: 0.4, curve: bez(6) }, { time: 1, mixRotate: 0, mixX: 1, mixY: 0,
            mixScaleX: 0.3, mixScaleY: 0.2, mixShearY: 0.4 }],
        },
        path: {
          ride: {
            position: [{ value: 0, curve: bez(1) }, { time: 1, value: 100 }],
            spacing: [{ value: 5 }, { time: 1, value: 10 }],
            mix: [{ mixRotate: 1, curve: bez(3) }, { time: 1, mixRotate: 0.5, mixX: 0.2, mixY: 0.1 }],
          },
        },
        physics: {
          sway: {
            inertia: [{ value: 0.5, curve: bez(1) }, { time: 1, value: 1 }],
            strength: [{ value: 80 }, { time: 1, value: 120 }],
            damping: [{ value: 0.9 }, { time: 1, value: 0.5 }],
            mass: [{ value: 0.5 }, { time: 1, value: 1 }],
            wind: [{ value: 0 }, { time: 1, value: 2 }],
            gravity: [{ value: 0 }, { time: 1, value: -3 }],
            mix: [{ value: 1 }, { time: 1, value: 0.2 }],
            reset: [{ time: 0.5 }],
          },
          '': { reset: [{ time: 0.75 }], wind: [{ value: 0 }, { time: 1, value: 1 }] },
        },
        attachments: {
          default: {
            body: { body: { deform: [{ offset: 1, vertices: [1, 2, 3], curve: bez(1) }, { time: 1, vertices: [0, 0, 0, 0, 0, 0, 0, 0] }] } },
            leg: { leg: { deform: [{ vertices: [1, 1], curve: 'stepped' }, { time: 0.5 }, { time: 1, offset: 4, vertices: [2, -2, 3] }] } },
          },
          alt: { leg: { legLinked: { deform: [{ offset: 8, vertices: [1, 1] }, { time: 1, offset: 0, vertices: [-1] }] } } },
        },
        drawOrder: [
          { time: 0.25, offsets: [{ slot: 'body', offset: 2 }, { slot: 'shadow', offset: -2 }] },
          { time: 0.75 },
        ],
        events: [
          { time: 0.1, name: 'step' },
          { time: 0.2, name: 'shout', int: 3, float: 0.5, string: 'hey', volume: 0.25, balance: -0.5 },
          { time: 0.3, name: 'shout' },
          { time: 0.4, name: 'silent', int: -42 },
        ],
      },
      idle: { bones: { thigh: { rotate: [{ value: 0 }, { time: 2, value: 20 }] } } },
    },
  };
}

// ── 1) the writer produces bytes, with no runtime involved ───────────────────

test('the writer produces bytes for every sample', () => {
  for (const [label, json] of [['sample_intro (path-fixed)', SAMPLE_INTRO()], ['rich', richSkeleton()], ['full coverage', fullCoverageSkeleton()]]) {
    const bytes = writeSkeletonBinary(json);
    assert.ok(bytes instanceof Uint8Array, label);
    assert.ok(bytes.length > 64, `${label}: ${bytes.length} bytes`);
  }
});

test('nonessential: false produces a smaller file (the flag really does something)', () => {
  const json = SAMPLE_INTRO();
  assert.ok(writeSkeletonBinary(json, { nonessential: false }).length < writeSkeletonBinary(json).length);
});

test('the writer does not mutate its input and is deterministic', () => {
  const json = fullCoverageSkeleton();
  const before = clone(json);
  const a = writeSkeletonBinary(json);
  assert.deepEqual(json, before);
  assert.deepEqual(writeSkeletonBinary(json), a);
});

// ── 2) the official reader: the binary reads like the JSON ───────────────────

test('real project fixture (sample_intro, path-fixed): binary and JSON give the same skeleton and the same poses', needsSpine, async () => {
  await assertRoundTrip(SAMPLE_INTRO(), 'sample_intro');
});

test('rich skeleton (curves, colour, events, weighted deform): binary reads like the JSON', needsSpine, async () => {
  await assertRoundTrip(richSkeleton(), 'rich');
});

test('full coverage: every attachment, constraint and timeline type round-trips', needsSpine, async () => {
  const { fromBinary } = await assertRoundTrip(fullCoverageSkeleton(), 'full coverage');
  // The coverage claim, checked on what the official reader produced.
  const spine = await loadRuntime();
  const types = new Set(fromBinary.skins.flatMap(s => s.getAttachments()).map(e => e.attachment.constructor));
  for (const kind of ['RegionAttachment', 'MeshAttachment', 'BoundingBoxAttachment', 'PathAttachment', 'PointAttachment', 'ClippingAttachment']) {
    assert.ok(types.has(spine[kind]), `covers ${kind}`);
  }
  assert.ok(fromBinary.skins.flatMap(s => s.getAttachments()).some(e => e.attachment.getParentMesh?.()), 'covers a linked mesh');
  const timelines = new Set(fromBinary.findAnimation('everything').timelines.map(t => t.constructor));
  for (const kind of ['RotateTimeline', 'TranslateTimeline', 'TranslateXTimeline', 'TranslateYTimeline', 'ScaleTimeline',
    'ScaleXTimeline', 'ScaleYTimeline', 'ShearTimeline', 'ShearXTimeline', 'ShearYTimeline', 'InheritTimeline',
    'AttachmentTimeline', 'RGBATimeline', 'RGBTimeline', 'RGBA2Timeline', 'RGB2Timeline', 'AlphaTimeline',
    'IkConstraintTimeline', 'TransformConstraintTimeline', 'PathConstraintPositionTimeline',
    'PathConstraintSpacingTimeline', 'PathConstraintMixTimeline', 'PhysicsConstraintInertiaTimeline',
    'PhysicsConstraintStrengthTimeline', 'PhysicsConstraintDampingTimeline', 'PhysicsConstraintMassTimeline',
    'PhysicsConstraintWindTimeline', 'PhysicsConstraintGravityTimeline', 'PhysicsConstraintMixTimeline',
    'PhysicsConstraintResetTimeline', 'DeformTimeline', 'DrawOrderTimeline', 'EventTimeline']) {
    assert.ok(timelines.has(spine[kind]), `covers ${kind}`);
  }
});

test('nonessential data round-trips when kept, and the essential skeleton still reads without it', needsSpine, async () => {
  const json = fullCoverageSkeleton();
  const { fromJson, fromBinary } = await readBoth(json, writeSkeletonBinary(json));
  const kept = nonessentialSummary(fromBinary, json);
  assert.deepEqual(kept, nonessentialSummary(fromJson, json));
  assert.ok(kept.colors.length >= 6 && kept.meshes.length >= 2, 'the comparison is not empty');
  // spine-ts SkeletonJson never reads a bone's icon or visible flag (BoneData keeps
  // undefined and false); the binary reader does. So those are checked against the source.
  // Nor a skin's colour (Skin keeps its class default).
  assert.deepEqual(fromBinary.bones.map(b => [b.icon ?? null, b.visible]), json.bones.map(b => [b.icon ?? null, b.visible ?? true]));
  assert.deepEqual(color(fromBinary.findSkin('alt').color), [1, 0, 1, 1]);
  const lean = await assertRoundTrip(json, 'full coverage, no nonessential', { nonessential: false });
  assert.equal(lean.fromBinary.imagesPath, null);
  assert.ok(lean.fromBinary.skins.flatMap(s => s.getAttachments()).every(e => !e.attachment.edges?.length), 'no mesh edges');
});

test('shared example rigs (ident, nova) round-trip', needsSpine, async () => {
  for (const name of ['ident', 'nova']) {
    await assertRoundTrip(readJson(new URL(`./fixtures/${name}/${name}.json`, import.meta.url)), name);
  }
});

// ── legacy bugs, fixed and pinned ────────────────────────────────────────────

test('fixed: two-colour keys read `light` and `dark` (legacy read `color` and wrote white)', needsSpine, async () => {
  const json = fullCoverageSkeleton();
  const { fromBinary } = await readBoth(json, writeSkeletonBinary(json));
  const spine = await loadRuntime();
  const rgba2 = fromBinary.findAnimation('everything').timelines.find(t => t instanceof spine.RGBA2Timeline);
  // frame 0: time, r, g, b, a, r2, g2, b2 from light ff8040c0 and dark 102030
  assert.deepEqual(Array.from(rgba2.frames.slice(1, 8)), [0xff, 0x80, 0x40, 0xc0, 0x10, 0x20, 0x30].map(v => Math.fround(v / 255)));
});

test('fixed: an event with audio "" does not shift the bytes after it', needsSpine, async () => {
  const json = richSkeleton();
  json.events.quiet = { audio: '', int: 3 };
  json.events.after = { string: 'still here' };
  json.animations.test.events.push({ time: 1, name: 'quiet' }, { time: 1.5, name: 'after' });
  await assertRoundTrip(json, 'audio ""');
});

test('fixed: an animation event without volume reads 1, as in JSON, not the definition\'s volume', needsSpine, async () => {
  const json = fullCoverageSkeleton();
  const { fromBinary } = await readBoth(json, writeSkeletonBinary(json));
  const spine = await loadRuntime();
  const events = fromBinary.findAnimation('everything').timelines.find(t => t instanceof spine.EventTimeline).events;
  const shouts = events.filter(e => e.data.name === 'shout');
  assert.deepEqual(shouts.map(e => [q(e.volume), q(e.balance)]), [[q(0.25), q(-0.5)], [1, 0]]);
  assert.equal(fromBinary.findEvent('step').stringValue, '', 'an event definition without a string reads "", as in JSON');
});

test('fixed: an empty default skin keeps skin indices aligned (deform and linked mesh in another skin)', needsSpine, async () => {
  const json = fullCoverageSkeleton();
  // Move every default attachment into a skin "base"; leave "default" present but empty.
  const base = { name: 'base', attachments: json.skins[0].attachments };
  json.skins = [{ name: 'default', attachments: {} }, base, json.skins[1]];
  json.skins[2].attachments.leg.legLinked.skin = 'base';
  const anim = json.animations.everything;
  anim.attachments = { base: anim.attachments.default, alt: anim.attachments.alt };
  for (const s of json.slots) delete s.attachment;
  await assertRoundTrip(json, 'empty default skin');
});

test('fixed: only `drawOrder` is written; another spelling is ignored, as the JSON reader ignores it', needsSpine, async () => {
  const json = richSkeleton();
  json.animations.test.draworder = json.animations.test.drawOrder;
  delete json.animations.test.drawOrder;
  const { fromBinary } = await assertRoundTrip(json, 'draworder spelling');
  const spine = await loadRuntime();
  assert.ok(!fromBinary.findAnimation('test').timelines.some(t => t instanceof spine.DrawOrderTimeline), 'no draw order timeline');
});

test('draw order offsets are written sorted by slot, whatever order the JSON lists them in', () => {
  const sorted = fullCoverageSkeleton();
  const shuffled = fullCoverageSkeleton();
  shuffled.animations.everything.drawOrder[0].offsets.reverse();
  assert.deepEqual(writeSkeletonBinary(shuffled), writeSkeletonBinary(sorted));
});

// Measured 2026-10-28 on the vendored spine-ts 4.2.119: SkeletonJson's transform timeline
// loop assigns mixScaleX twice and never mixShearY, so every key after the first keeps the
// first key's mixShearY. SkeletonBinary reads each key's own value. The binary is the
// faithful one here; this pins the divergence so a runtime update that fixes it is noticed.
test('official JSON reader quirk: transform mixShearY after the first key is lost in JSON, kept in binary', needsSpine, async () => {
  const json = fullCoverageSkeleton();
  json.animations.everything.transform.follow[1].mixShearY = 0.1;
  const { spine, fromJson, fromBinary } = await readBoth(json, writeSkeletonBinary(json));
  const lastShear = d => {
    const t = d.findAnimation('everything').timelines.find(x => x instanceof spine.TransformConstraintTimeline);
    return t.frames[t.frames.length - 1];
  };
  assert.equal(lastShear(fromBinary), Math.fround(0.1), 'the binary carries the authored value');
  assert.equal(lastShear(fromJson), Math.fround(0.4), 'spine-ts SkeletonJson repeats the first key (runtime bug)');
});

// ── refusals: never a file that decodes into something else ──────────────────

const refuses = (code, mutate, label = code) => test(`refuses (${code}): ${label}`, () => {
  const json = fullCoverageSkeleton();
  mutate(json);
  assert.throws(() => writeSkeletonBinary(json), err => {
    assert.ok(isStudioError(err, code), `expected ${code}, got ${err.code}: ${err.message}`);
    assert.ok(err.message.length > 10);
    return true;
  });
});

// The official reader cannot decode astral-plane UTF-8: refused, not silently corrupted.
refuses('binary-astral-character', j => { j.bones[1].name = 'hip\u{1F600}'; j.slots[0].bone = 'hip\u{1F600}'; }, 'a character outside the BMP');
refuses('binary-not-skeleton', j => { delete j.bones; }, 'no bones array');
refuses('binary-version', j => { j.skeleton.spine = '4.1.24'; }, 'a 4.1 skeleton');
refuses('binary-sequence-unsupported', j => { j.skins[0].attachments.shadow.shadow.sequence = { count: 3 }; }, 'a sequence attachment');
refuses('binary-sequence-unsupported', j => {
  j.animations.everything.attachments.default.body.body = { sequence: [{ mode: 'loop' }] };
}, 'a sequence timeline');
refuses('binary-mesh-triangles', j => { j.skins[0].attachments.leg.leg.triangles.push(0, 1, 2); }, 'a triangle count the reader would not derive');
refuses('binary-path-lengths', j => { j.skins[0].attachments.rail.rail.lengths.push(500); }, 'path lengths count off');
refuses('binary-path-lengths', j => {
  const rail = j.skins[0].attachments.rail.rail;
  rail.vertexCount = 7; rail.vertices.push(120, 10);
}, 'a 3n+1 path (path-fix first)');
refuses('binary-vertices-layout', j => { j.skins[0].attachments.hitbox.box.vertices.pop(); }, 'weighted vertices that do not add up');
refuses('binary-empty-name', j => { j.skins[0].attachments.shadow.shadow.path = ''; }, 'an empty string-table entry');
refuses('binary-physics-fps', j => { j.physics[0].fps = 59.94; }, 'a fractional physics fps');
refuses('binary-physics-fps', j => { j.physics[0].fps = 300; }, 'a physics fps above 255');
refuses('binary-unknown-attachment-type', j => { j.skins[0].attachments.shadow.shadow.type = 'sprite'; }, 'an unknown attachment type');
refuses('binary-unknown-timeline', j => { j.animations.idle.bones.thigh.wiggle = [{ value: 1 }]; }, 'an unknown bone timeline');
refuses('binary-unknown-timeline', j => { j.animations.idle.slots = { body: { glow: [{ value: 1 }] } }; }, 'an unknown slot timeline');
refuses('binary-unknown-timeline', j => { j.animations.everything.path.ride.wobble = [{ value: 1 }]; }, 'an unknown path timeline');
refuses('binary-unknown-timeline', j => { j.animations.everything.physics.sway.spin = [{ value: 1 }]; }, 'an unknown physics timeline');
refuses('binary-attachment-timeline-count', j => {
  j.animations.everything.attachments.default.leg.leg.extra = [{ time: 0 }];
}, 'two timelines on one attachment');
refuses('binary-bezier-short', j => { j.animations.everything.bones.hip.translate[0].curve = [0.1, 0, 0.2, 5]; }, 'a two-value curve with 4 numbers');
refuses('binary-bezier-short', j => { j.animations.everything.ik.legIk[0].curve = [0.1, 0, 0.2, 5]; }, 'an IK curve with 4 numbers');
refuses('binary-bad-color', j => { j.slots[1].color = 'red'; }, 'a colour that is not hex');
refuses('binary-unknown-enum', j => { j.slots[1].blend = 'overlay'; }, 'an unknown blend mode');
refuses('binary-unknown-enum', j => { j.path[0].rotateMode = 'spin'; }, 'an unknown rotate mode');
refuses('binary-unknown-bone', j => { j.slots[0].bone = 'ghost'; }, 'a slot on a missing bone');
refuses('binary-unknown-slot', j => { j.animations.idle.slots = { ghost: { alpha: [{ value: 1 }] } }; }, 'a timeline on a missing slot');
refuses('binary-unknown-constraint', j => { j.skins[1].ik = ['ghostIk']; }, 'a skin naming a missing constraint');
refuses('binary-unknown-constraint', j => { j.animations.idle.physics = { ghost: { wind: [{ value: 1 }] } }; }, 'a timeline on a missing physics constraint');
refuses('binary-unknown-skin', j => { j.skins[1].attachments.leg.legLinked.skin = 'ghost'; }, 'a linked mesh in a missing skin');
refuses('binary-unknown-skin', j => { j.animations.idle.attachments = { ghost: {} }; }, 'a deform in a missing skin');
refuses('binary-unknown-event', j => { j.animations.idle.events = [{ time: 0, name: 'ghost' }]; }, 'a key firing a missing event');
