// Gate for placeholder art (src/engine/svg.js, src/render/svg-rig.js, draw_rig): the SVG subset
// is drawn where and how the SVG says, and parts become a rig whose setup pose is the picture,
// in the engine and (when installed) the official runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rasterizeSvg, parseColor, pathPoints, parseTransform } from '../src/engine/svg.js';
import { buildSvgRig, MAX_PARTS } from '../src/render/svg-rig.js';
import { MAX_PARTS as BOARD_MAX_PARTS } from '../web/draw-model.js';
import { decodePng } from '../src/render/png.js';
import { renderFrames } from '../src/render/frames.js';
import { checkSkeleton } from '../src/spine/check.js';
import { compileSkeleton, setupPose, parseAtlas, poseAt, regionVertices as regionCorners } from '../src/engine/index.js';
import { createServer } from '../src/mcp/server.js';
import { SPINE } from './helpers/spine-addon.js';
import { officialRuntime } from './helpers/official-runtime.js';

const px = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const alphaSum = img => { let s = 0; for (let i = 3; i < img.data.length; i += 4) s += img.data[i] / 255; return s; };

test('colours, transforms and path commands parse as SVG defines them', () => {
  assert.deepEqual(parseColor('#f00'), [1, 0, 0, 1]);
  assert.deepEqual(parseColor('#00ff0080').map(v => Math.round(v * 100) / 100), [0, 1, 0, 0.5]);
  assert.deepEqual(parseColor('rgba(255, 0, 0, 0.25)'), [1, 0, 0, 0.25]);
  assert.equal(parseColor('none'), null);
  assert.deepEqual(parseTransform('translate(10 5) scale(2)'), [2, 0, 0, 2, 10, 5]);
  const r = parseTransform('rotate(90 10 10)').map(v => Math.round(v * 1e6) / 1e6);
  assert.deepEqual(r, [0, 1, -1, 0, 20, 0]);
  const [sub] = pathPoints('m10 10 h20 v20 H10 z');
  assert.deepEqual(sub.points, [[10, 10], [30, 10], [30, 30], [10, 30]]);
  assert.equal(sub.closed, true);
  const arc = pathPoints('M0 0 A10 10 0 0 1 20 0', 8)[0].points;
  const mid = arc.reduce((best, p) => (p[1] < best[1] ? p : best));
  assert.ok(Math.abs(mid[0] - 10) < 0.5 && Math.abs(mid[1] + 10) < 0.5, `sweep 1 bulges to -y: ${mid}`);
});

test('shapes land where the SVG puts them, with anti-aliased edges and exact areas', () => {
  const rect = rasterizeSvg('<svg viewBox="0 0 20 10"><rect x="2" y="2" width="10" height="4" fill="#ff0000"/></svg>');
  assert.deepEqual([rect.width, rect.height], [20, 10]);
  assert.deepEqual(px(rect, 5, 3), [255, 0, 0, 255]);
  assert.deepEqual(px(rect, 15, 3), [0, 0, 0, 0]);
  assert.ok(Math.abs(alphaSum(rect) - 40) < 0.01, `area ${alphaSum(rect)}`);
  const half = rasterizeSvg('<svg viewBox="0 0 4 4"><rect x="0.5" y="0" width="3" height="4" fill="#00f"/></svg>');
  assert.ok(Math.abs(px(half, 0, 1)[3] - 128) <= 1, 'a pixel half covered is half opaque');
  const disc = rasterizeSvg('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="black"/></svg>');
  assert.ok(Math.abs(alphaSum(disc) / (Math.PI * 1600) - 1) < 0.01, 'circle area');
  const scaled = rasterizeSvg('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>', { scale: 2 });
  assert.equal(scaled.width, 200);
  assert.ok(Math.abs(alphaSum(scaled) / (Math.PI * 6400) - 1) < 0.01, 'scale applies to the area');
  const hole = rasterizeSvg('<svg viewBox="0 0 30 30"><path fill-rule="evenodd" d="M0 0H30V30H0Z M10 10H20V20H10Z"/></svg>');
  assert.equal(px(hole, 15, 15)[3], 0, 'evenodd leaves the hole');
  assert.equal(px(hole, 5, 5)[3], 255);
  const moved = rasterizeSvg('<svg viewBox="0 0 40 40"><g transform="translate(20 0)"><rect width="10" height="10" fill="#0f0"/></g></svg>');
  assert.equal(px(moved, 5, 5)[3], 0);
  assert.deepEqual(px(moved, 25, 5), [0, 255, 0, 255]);
  const stroke = rasterizeSvg('<svg viewBox="0 0 40 40"><line x1="0" y1="20" x2="40" y2="20" stroke="#000" stroke-width="4"/></svg>');
  assert.ok(Math.abs(alphaSum(stroke) - 160) < 1, `a 4 wide line over 40 covers 160, got ${alphaSum(stroke)}`);
  const faded = rasterizeSvg('<svg viewBox="0 0 4 4"><g opacity="0.5"><rect width="4" height="4" fill="#fff" fill-opacity="0.5"/></g></svg>');
  assert.ok(Math.abs(px(faded, 1, 1)[3] - 64) <= 1, 'opacities multiply');
});

test('gradients run from stop to stop in the bounding box', () => {
  const g = rasterizeSvg('<svg viewBox="0 0 100 10"><defs><linearGradient id="a"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="100" height="10" fill="url(#a)"/></svg>');
  assert.ok(px(g, 1, 5)[0] < 10 && px(g, 98, 5)[0] > 245 && Math.abs(px(g, 50, 5)[0] - 128) < 4, 'left black, right white, middle grey');
  const r = rasterizeSvg('<svg viewBox="0 0 100 100"><radialGradient id="r"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#f00" stop-opacity="0"/></radialGradient><rect width="100" height="100" fill="url(#r)"/></svg>');
  assert.ok(px(r, 50, 50)[3] > 245 && px(r, 1, 50)[3] < 10, 'opaque centre, clear edge');
  const skip = rasterizeSvg('<svg viewBox="0 0 10 10"><text x="1" y="5">hi</text></svg>');
  assert.deepEqual(skip.skipped, ['<text> is not drawn']);
});

const BODY = '<svg viewBox="0 0 100 120"><rect x="5" y="5" width="90" height="110" rx="30" fill="#7cc4ff" stroke="#2b1b4d" stroke-width="6"/></svg>';
const HEAD = '<svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="40" fill="#ffd84d"/></svg>';
const ARM = '<svg viewBox="0 0 24 70"><rect x="3" y="3" width="18" height="64" rx="9" fill="#e02447"/></svg>';
const PARTS = [
  { name: 'arm_back', svg: ARM, at: [-48, 60], pivot: [-48, 90], parent: 'body' },
  { name: 'body', svg: BODY, at: [0, 60], pivot: [0, 0] },
  { name: 'head', svg: HEAD, at: [0, 150], pivot: [0, 115], parent: 'body' },
  { name: 'arm_front', svg: ARM, at: [48, 60], pivot: [48, 90], parent: 'body' },
];

test('parts become a rig: parents first, drawing order kept, the setup pose is the picture', async () => {
  const rig = buildSvgRig({ name: 'pal', parts: PARTS });
  assert.deepEqual(checkSkeleton(rig.skeleton).filter(f => f.level === 'fatal'), []);
  assert.deepEqual(rig.skeleton.bones.map(b => b.name), ['root', 'body', 'arm_back', 'head', 'arm_front'], 'a parent comes before its child');
  assert.deepEqual(rig.skeleton.slots.map(s => s.name), ['arm_back', 'body', 'head', 'arm_front'], 'slots keep the drawing order');
  const atlas = parseAtlas(rig.atlasText);
  const page = decodePng(rig.png);
  assert.deepEqual([atlas.pages[0].width, atlas.pages[0].height], [page.width, page.height]);
  const head = atlas.regions.find(r => r.name === 'head');
  assert.deepEqual([head.width, head.height], [180, 180], 'drawn at 2 px per unit');
  const regions = atlas.regions.map(r => [r.x, r.y, r.x + r.width, r.y + r.height]);
  regions.forEach((a, i) => regions.slice(i + 1).forEach(b => assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], 'regions do not overlap')));
  const centre = (head.y + 90) * page.width + head.x + 90;
  assert.deepEqual([...page.data.subarray(centre * 4, centre * 4 + 4)], [255, 216, 77, 255], 'the head is drawn into its region');

  const pose = setupPose(compileSkeleton(rig.skeleton));
  const bone = name => pose.bones.find(b => b.data.name === name);
  for (const p of PARTS) assert.ok(Math.hypot(bone(p.name).worldX - p.pivot[0], bone(p.name).worldY - p.pivot[1]) < 1e-6, `${p.name} sits at its pivot`);

  // Rendered: the head's colour shows above the body and the front arm covers the body's edge.
  rig.skeleton.animations = { pose: { bones: { head: { rotate: [{ value: 0 }] } } } };
  const { frames, viewport, scale } = await renderFrames({ json: rig.skeleton, atlasText: rig.atlasText, pages: { 'pal.png': page }, animation: 'pose', times: [0], width: 256, height: 256 });
  const img = frames[0].image;
  const cx = viewport.x + viewport.width / 2, cy = viewport.y + viewport.height / 2;
  const at = (x, y) => { const sx = Math.round(128 + (x - cx) * scale), sy = Math.round(128 - (y - cy) * scale); return [...img.data.subarray((sy * 256 + sx) * 4, (sy * 256 + sx) * 4 + 3)]; };
  assert.ok(viewport && scale > 0);
  assert.deepEqual(at(0, 150), [255, 216, 77], 'head');
  assert.deepEqual(at(48, 60), [224, 36, 71], 'front arm over the body');
  assert.deepEqual(at(0, 40), [124, 196, 255], 'body');
});

test('a drawing is refused with every problem named', () => {
  assert.throws(() => buildSvgRig({ name: 'x', parts: [{ name: 'a', svg: '<g/>', at: [0, 0] }] }), { code: 'bad-parts' });
  assert.throws(() => buildSvgRig({ name: 'x', parts: [{ name: 'a', svg: BODY, at: [0, 0], parent: 'b' }, { name: 'b', svg: BODY, at: [0, 0], parent: 'a' }] }), /loop/);
  assert.throws(() => buildSvgRig({ name: 'x', parts: [{ name: 'a', svg: BODY, at: [0, 0] }, { name: 'a', svg: BODY, at: [0, 0] }] }), /twice/);
  assert.throws(() => buildSvgRig({ name: '../x', parts: PARTS }), { code: 'bad-argument' });
});

test('a dressed figure fits: a drawing grows past 64 parts call by call, up to the cap', async () => {
  assert.equal(MAX_PARTS, 128);
  assert.equal(BOARD_MAX_PARTS, MAX_PARTS, 'the drawing board holds as many parts as the builder');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-many-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
  const call = async args => { sent.length = 0; await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'draw_rig', arguments: args } }); return sent[0].result.structuredContent; };
  const piece = i => ({ name: `piece${i}`, at: [(i % 16) * 6, Math.floor(i / 16) * 6], svg: '<svg viewBox="0 0 4 4"><rect width="4" height="4" fill="#5E7BFF"/></svg>', ...(i ? { parent: 'piece0' } : {}) });
  try {
    for (let from = 0; from < MAX_PARTS; from += 64) {
      const r = await call({ name: 'hero', merge: from > 0, parts: Array.from({ length: 64 }, (_, k) => piece(from + k)) });
      assert.equal(r.error, undefined, JSON.stringify(r.error));
    }
    const sk = JSON.parse(fs.readFileSync(path.join(dir, 'hero.json'), 'utf8'));
    assert.equal(sk.slots.length, MAX_PARTS, 'every piece is drawn');
    assert.deepEqual(checkSkeleton(sk).filter(f => f.level === 'fatal'), []);
    const over = await call({ name: 'hero', merge: true, parts: [piece(MAX_PARTS)] });
    assert.match(over.error?.message ?? '', /at most 128 parts/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'hero.json'), 'utf8')).slots.length, MAX_PARTS, 'a refused call leaves the drawing as it was');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('draw_rig writes the rig, keeps clips on a redraw, and never redraws a file it did not draw', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-draw-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
  const call = async args => { sent.length = 0; await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'draw_rig', arguments: args } }); return sent[0].result.structuredContent; };
  try {
    const first = await call({ name: 'pal', parts: PARTS, folder: 'art' });
    assert.equal(first.error, undefined, JSON.stringify(first.error));
    for (const f of ['pal.json', 'pal.atlas', 'pal.png', 'pal.parts.json']) assert.ok(fs.existsSync(path.join(dir, 'art', f)), f);
    const file = path.join(dir, 'art', 'pal.json');
    const sk = JSON.parse(fs.readFileSync(file, 'utf8'));
    sk.animations = { wave: { bones: { arm_front: { rotate: [{ value: 0 }, { time: 0.5, value: 30 }] }, arm_back: { rotate: [{ value: 0 }] } } } };
    fs.writeFileSync(file, JSON.stringify(sk));
    const again = await call({ name: 'pal', parts: PARTS.filter(p => p.name !== 'arm_back'), folder: 'art' });
    assert.deepEqual(again.keptClips, ['wave']);
    assert.deepEqual(again.dropped, ['wave: bone arm_back']);
    assert.ok(again.backups?.json, 'the previous drawing is backed up');
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).animations.wave.bones), ['arm_front']);
    fs.writeFileSync(path.join(dir, 'owner.json'), '{}');
    const refused = await call({ name: 'owner', parts: PARTS });
    assert.equal(refused.error?.code, 'not-ours');
    assert.equal(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8'), '{}');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the official runtime reads the drawn rig and poses it the same', { skip: !SPINE && 'needs the Spine add-on' }, async () => {
  const runtime = await officialRuntime();
  const rig = buildSvgRig({ name: 'pal', parts: PARTS });
  rig.skeleton.animations = { pose: { bones: { head: { rotate: [{ value: 0 }, { time: 1, value: 20 }] } } } };
  const data = await runtime.parseSkeleton(rig.skeleton, { atlasText: rig.atlasText });
  const [official] = await runtime.sampleAnimation(data, 'pose', [0]);
  for (const p of PARTS) {
    const b = official.bones.find(x => x.name === p.name);
    assert.ok(Math.abs(b.worldX - p.pivot[0]) < 1e-3 && Math.abs(b.worldY - p.pivot[1]) < 1e-3, p.name);
  }
});

test('start_here sends an empty project to draw_rig, and leaves the step out once there is a rig', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-empty-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
  const start = async () => { sent.length = 0; await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'start_here', arguments: {} } }); return sent[0].result.structuredContent; };
  try {
    const empty = await start();
    assert.equal(empty.next.tool, 'draw_rig');
    assert.equal(empty.steps[0].step, 'DRAW');
    sent.length = 0;
    await wire.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'draw_rig', arguments: { name: 'pal', parts: PARTS } } });
    const drawn = await start();
    assert.equal(drawn.next.tool, 'read_rig');
    assert.ok(!drawn.steps.some(s => s.step === 'DRAW'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── flipbooks and parts that swing (the 0.2 engine) ──────────────────────────

const box = (w, h, fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`;

test('a part with frames becomes a sequence attachment the engine plays frame by frame', async () => {
  const built = buildSvgRig({ name: 'torch', parts: [
    { name: 'stick', svg: box(4, 20, '#8a5a2b'), at: [0, 10] },
    { name: 'flame', svg: box(10, 12, '#ffb000'), frames: [box(10, 12, '#ff4000'), box(10, 12, '#ffb000'), box(10, 12, '#ffff40')], at: [0, 26], parent: 'stick', blend: 'additive' },
  ] });
  const att = built.skeleton.skins[0].attachments.flame.flame;
  assert.deepEqual(att.sequence, { count: 3, start: 1, digits: 2, setup: 0 });
  assert.equal(att.path, 'flame_f');
  for (const r of ['flame_f01', 'flame_f02', 'flame_f03']) assert.match(built.atlasText, new RegExp(`^${r}$`, 'm'), r);
  assert.equal(checkSkeleton(built.skeleton).filter(f => f.level === 'fatal').length, 0);
  const json = { ...built.skeleton, animations: { burn: { attachments: { default: { flame: { flame: { sequence: [{ mode: 'loop', delay: 0.1 }] } } } }, bones: { stick: { rotate: [{ value: 0 }, { time: 0.3, value: 0 }] } } } } };
  const pages = new Map([[built.page, decodePng(built.png)]]);
  const colour = async t => {
    const { frames } = await renderFrames({ json, atlasText: built.atlasText, pages, animation: 'burn', times: [t], width: 40, height: 40, viewport: { x: -8, y: 20, width: 16, height: 12 }, supersample: 1 });
    const d = frames[0].image.data, i = (20 * 40 + 20) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const [a, b, c] = [await colour(0.01), await colour(0.11), await colour(0.21)];
  assert.ok(a[1] < 120 && b[1] > 140 && c[2] > 40, `red, then amber, then yellow (${a} / ${b} / ${c})`);
});

test('a part with physics points its bone through its art, stays drawn where it was, and swings when its parent moves', () => {
  const parts = [
    { name: 'head', svg: box(30, 30, '#f0c8a0'), at: [0, 60] },
    { name: 'tail', svg: box(8, 40, '#4a3060'), at: [20, 40], pivot: [20, 60], parent: 'head', physics: { strength: 40 } },
  ];
  const built = buildSvgRig({ name: 'pony', parts });
  const plain = buildSvgRig({ name: 'pony', parts: parts.map(({ physics: _, ...p }) => p) });
  const tailBone = built.skeleton.bones.find(b => b.name === 'tail');
  near(tailBone.rotation, -90, 'the bone points down the hanging tail');
  assert.ok(tailBone.length >= 40, 'it has a length to swing by');
  assert.deepEqual(built.skeleton.physics.map(c => [c.name, c.bone, c.rotate, c.strength]), [['tail', 'tail', 1, 40]]);
  const corners = sk => { const m = compileSkeleton(sk); const p = setupPose(m); const s = p.slots.find(x => x.data.name === 'tail');
    return Array.from(regionCorners(p.bones[s.data.bone], s.attachment)).map(v => Math.round(v * 100) / 100); };
  assert.deepEqual(corners(built.skeleton), corners(plain.skeleton), 'the tail is drawn exactly where it is without physics');
  const moving = compileSkeleton({ ...built.skeleton, animations: { shake: { bones: { head: { translate: [{ x: 0 }, { time: 0.2, x: 40 }, { time: 1, x: 40 }] } } } } });
  const swing = deg(poseAt(moving, 'shake', 0.15).bones[moving.boneIndex.get('tail')]) + 90;
  assert.ok(Math.abs(swing) > 3, `the tail swings when the head moves sideways (${swing})`);
  assert.throws(() => buildSvgRig({ name: 'bad', parts: [{ ...parts[1], parent: undefined, physics: { strength: -1 } }] }), /physics\.strength/);
  assert.throws(() => buildSvgRig({ name: 'bad', parts: [{ ...parts[0], frames: [box(2, 2, '#000')] }] }), /2 to 64/);
});

function near(a, b, msg, eps = 1e-6) { assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`); }
function deg(b) { return Math.atan2(b.c, b.a) * 180 / Math.PI; }
