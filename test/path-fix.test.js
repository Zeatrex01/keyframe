// Gate for src/spine/path-fix.js: the repair really repairs, and breaks nothing it did not
// repair. Ported from legacy test_pathfix.js.
//
// Why this gate exists: path-fix is the only module that writes into a working file. A
// wrong repair is a silent geometry drift with no error message (a curve control point
// slipping), so four things are proven separately:
//   1) 3n+1 (anchor + triples) is repaired and the result passes the official parser,
//   2) unrecognised layouts (3n+2, malformed weighted vertices) are left untouched,
//   3) a healthy file stays identical: no file is changed in the name of "cleanup",
//   4) the repair introduces no new fatal into the skeleton check (the write gate).
// The cross-check against the official spine-ts 4.2 parser always runs (legacy needed a
// headless browser for it and skipped it without one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scanPaths, fixPaths, pathsLoadable, weightedGroupsExact } from '../src/spine/path-fix.js';
import { checkSkeleton } from '../src/spine/check.js';
import { fatalsOf, splitFatals } from '../src/spine/findings.js';
import { parseSkeleton, sampleAnimation } from '../src/runtime/index.js';
import { needsSpine, SPINE } from './helpers/spine-addon.js';

const clone = o => structuredClone(o);

// A valid 4.2 skeleton carrying a path. The path must be a real curve: on a straight line
// "a point slipped" is invisible and blinds the test.
function pathSkeleton(vertices, lengths) {
  return {
    skeleton: { hash: 'h', spine: '4.2.43', x: 0, y: 0, width: 100, height: 100, images: '', audio: '' },
    bones: [{ name: 'root' }, { name: 'b', parent: 'root' }],
    slots: [{ name: 'img', bone: 'b', attachment: 'square' },
      { name: 'track', bone: 'b', attachment: 'track' }],
    skins: [{ name: 'default', attachments: {
      img: { square: { width: 10, height: 10 } },
      track: { track: { type: 'path', closed: false, constantSpeed: true,
        vertexCount: vertices.length / 2, lengths, vertices } },
    } }],
    path: [{ name: 'pc', bones: ['b'], target: 'track' }],
    animations: { intro: { bones: { b: { rotate: [{ value: 0 }, { time: 1, value: 5 }] } } } },
  };
}

// A healthy two-curve path: 6 points (3C), 2 lengths. Curved, not straight.
const HEALTHY_POINTS = [
  100, 0, 200, 120, 300, 120,    // curve 1: c1, c2, P1
  400, 120, 500, 0, 600, 0,      // curve 2: c3, c4, P2
];
const HEALTHY = pathSkeleton(HEALTHY_POINTS, [253.4, 517.6]);

// The same path in the old form: anchor P0 prepended, 7 points (3C+1), 3 lengths.
const ANCHOR = { x: 0, y: 0 };
const BROKEN = pathSkeleton([ANCHOR.x, ANCHOR.y, ...HEALTHY_POINTS], [0, 253.4, 517.6]);

const pathOf = sk => sk.skins[0].attachments.track.track;
// The official parser when the Spine add-on is here, else the studio's engine (which refuses the
// same 3n+1 file; only the official error text is checked under needsSpine).
const officialParse = async sk => {
  try { await parseSkeleton(sk, SPINE ? { backend: 'spine' } : {}); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
};

// ── scan ─────────────────────────────────────────────────────────────────────

test('scan: a 3n+1 file is blocking, recognised as anchor + triples, and fixable', () => {
  const s = scanPaths(BROKEN);
  assert.equal(s.blocking, true, JSON.stringify(s.findings));
  assert.equal(s.ok, false);
  const f = s.findings.find(x => x.code === 'path-anchor-triples');
  assert.ok(f, JSON.stringify(s.findings));
  assert.equal(f.level, 'fatal');
  assert.equal(f.params.layout, 'anchor-triples');
  assert.equal(f.params.fixable, true);
  assert.equal(f.where, 'skins/default/track/track');
  // Its lengths count is judged against the anchor layout: 3 lengths for 2 curves.
  const lengths = s.findings.find(x => x.code === 'path-lengths-count');
  assert.equal(lengths?.params.expected, 2);
  for (const x of s.findings) {
    assert.ok(x.message.length > 10);
    assert.equal(typeof x.params, 'object');
  }
});

test('scan: a healthy file has no findings', () => {
  assert.deepEqual(scanPaths(HEALTHY), { ok: true, blocking: false, findings: [] });
});

test('loadable: the broken file fails the check, the healthy one passes', () => {
  assert.equal(pathsLoadable(BROKEN).ok, false);
  assert.match(pathsLoadable(BROKEN).bad[0].reason, /multiple of 3/);
  const healthy = pathsLoadable(HEALTHY);
  assert.equal(healthy.ok, true, JSON.stringify(healthy.bad));
});

test('scan: lengths that are not cumulative are a warning, never blocking, and never fixed', () => {
  const perSegment = pathSkeleton(HEALTHY_POINTS, [253.4, 120]);   // per-segment, not cumulative
  const s = scanPaths(perSegment);
  assert.equal(s.blocking, false);
  assert.deepEqual(s.findings.map(f => [f.code, f.level]), [['path-lengths-not-cumulative', 'warn']]);
  const r = fixPaths(perSegment);
  assert.equal(r.changed, false);
  assert.deepEqual(r.skeleton, perSegment);
});

test('scan: a wrong lengths count on a loading path is a warning; non-numbers are flagged', () => {
  const s = scanPaths(pathSkeleton(HEALTHY_POINTS, [253.4]));
  assert.deepEqual(s.findings.map(f => [f.code, f.level]), [['path-lengths-count', 'warn']]);
  const nan = scanPaths(pathSkeleton(HEALTHY_POINTS, [253.4, 'x']));
  assert.deepEqual(nan.findings.map(f => f.code), ['path-lengths-not-numbers']);
});

// ── fix: 3n+1 ────────────────────────────────────────────────────────────────

test('fix: 3n+1 drops the head, keeps the curve, and rebuilds cumulative lengths', () => {
  const before = clone(BROKEN);
  const r = fixPaths(BROKEN);
  const a = pathOf(r.skeleton);
  assert.equal(r.changed, true);
  assert.deepEqual(BROKEN, before, 'the input object is not mutated (the caller keeps the original)');
  assert.equal(a.vertexCount, 6);
  assert.equal(a.vertices.length, 12);
  assert.deepEqual(a.vertices, HEALTHY_POINTS, 'the remaining points equal the healthy version: the head was dropped, not the tail');
  assert.equal(a.lengths.length, 2, 'one length per curve');
  assert.ok(a.lengths.every((v, i) => i === 0 || v > a.lengths[i - 1]), `cumulative: ${a.lengths}`);
  // Dropping the anchor before measuring would make the first length wrong: b0 vanishes
  // and the first curve starts from c1. The first value must be the real arc length from
  // the anchor: never below the straight chord |P0 -> P1| and reasonably above it.
  const chord = Math.hypot(300 - ANCHOR.x, 120 - ANCHOR.y);
  assert.ok(a.lengths[0] > chord * 0.95 && a.lengths[0] < chord * 1.6, `first length ${a.lengths[0]} vs chord ${chord}`);
  const loadable = pathsLoadable(r.skeleton);
  assert.equal(loadable.ok, true, JSON.stringify(loadable.bad));
  assert.deepEqual(fatalsOf(checkSkeleton(r.skeleton)), [], 'the repaired file passes the skeleton check with no fatal');
  assert.ok(fatalsOf(checkSkeleton(BROKEN)).some(f => f.code === 'path-vc3'),
    'the checker already caught the broken file as path-vc3 (checker and repairer see the same pattern)');
  assert.deepEqual(r.report[0].actions.map(x => x.code), ['dropped-leading-anchor', 'recomputed-lengths']);
  assert.deepEqual(r.report[0].before, { vertexCount: 7, vertices: 14, lengths: 3 });
  assert.deepEqual(r.report[0].after, { vertexCount: 6, vertices: 12, lengths: 2 });
});

test('fix: the lengths are the measured arc lengths, not the old stored ones', () => {
  const a = pathOf(fixPaths(BROKEN).skeleton);
  // A curve's arc length lies between its chord and its control polygon.
  const p = [ANCHOR, ...Array.from({ length: 6 }, (_, i) => ({ x: HEALTHY_POINTS[i * 2], y: HEALTHY_POINTS[i * 2 + 1] }))];
  const d = (u, v) => Math.hypot(v.x - u.x, v.y - u.y);
  const first = a.lengths[0], second = a.lengths[1] - a.lengths[0];
  assert.ok(first >= d(p[0], p[3]) && first <= d(p[0], p[1]) + d(p[1], p[2]) + d(p[2], p[3]), `curve 1: ${first}`);
  assert.ok(second >= d(p[3], p[6]) && second <= d(p[3], p[4]) + d(p[4], p[5]) + d(p[5], p[6]), `curve 2: ${second}`);
  assert.notDeepEqual(a.lengths, [253.4, 517.6]);
  // And they match an independent fine-sampled arc length (4096 chords per curve) to
  // within the 48-sample estimate's error, far tighter than "between chord and polygon".
  const fine = (b0, b1, b2, b3) => {
    let total = 0, prev = b0;
    for (let k = 1; k <= 4096; k++) {
      const t = k / 4096, u = 1 - t;
      const x = u * u * u * b0.x + 3 * u * u * t * b1.x + 3 * u * t * t * b2.x + t * t * t * b3.x;
      const y = u * u * u * b0.y + 3 * u * u * t * b1.y + 3 * u * t * t * b2.y + t * t * t * b3.y;
      total += Math.hypot(x - prev.x, y - prev.y);
      prev = { x, y };
    }
    return total;
  };
  const reference1 = fine(p[0], p[1], p[2], p[3]);
  const reference2 = reference1 + fine(p[3], p[4], p[5], p[6]);
  assert.ok(Math.abs(a.lengths[0] - reference1) < 0.05, `curve 1: ${a.lengths[0]} vs ${reference1}`);
  assert.ok(Math.abs(a.lengths[1] - reference2) < 0.1, `cumulative: ${a.lengths[1]} vs ${reference2}`);
});

test('fix: closed and constantSpeed are stated only on a path being rewritten', () => {
  const bare = clone(BROKEN);
  delete pathOf(bare).closed;
  delete pathOf(bare).constantSpeed;
  const r = fixPaths(bare);
  assert.equal(pathOf(r.skeleton).closed, false);
  assert.equal(pathOf(r.skeleton).constantSpeed, true);
  assert.deepEqual(r.report[0].actions.map(x => x.code),
    ['dropped-leading-anchor', 'recomputed-lengths', 'wrote-closed', 'wrote-constant-speed']);
  const healthyBare = clone(HEALTHY);
  delete pathOf(healthyBare).closed;
  assert.equal(fixPaths(healthyBare).changed, false);
  assert.equal('closed' in pathOf(fixPaths(healthyBare).skeleton), false);
});

test('fix: missing lengths on a loading path are rebuilt without touching the vertices', () => {
  const r = fixPaths(pathSkeleton(HEALTHY_POINTS, [253.4]));
  const a = pathOf(r.skeleton);
  assert.equal(r.changed, true);
  assert.deepEqual(a.vertices, HEALTHY_POINTS);
  assert.equal(a.vertexCount, 6);
  assert.equal(a.lengths.length, 2);
  assert.deepEqual(r.report[0].actions.map(x => x.code), ['recomputed-lengths']);
});

// ── left untouched ───────────────────────────────────────────────────────────

test('a healthy file comes back with no change at all', () => {
  const before = JSON.stringify(HEALTHY);
  const r = fixPaths(HEALTHY);
  assert.equal(r.changed, false);
  assert.equal(JSON.stringify(r.skeleton), before, 'identical, key order included');
  assert.notEqual(r.skeleton, HEALTHY, 'still a clone');
});

test('3n+2: which point is extra is ambiguous, so it is not repaired by guesswork', () => {
  // 6 points + 2 points = 8 = 3 x 2 + 2. (Adding one point would make 7, which is 3n+1.)
  const two = pathSkeleton([...HEALTHY_POINTS, 700, 0, 800, 40], [253.4, 517.6]);
  const s = scanPaths(two);
  assert.equal(s.findings[0]?.code, 'path-count-3n2');
  assert.equal(s.findings[0].params.fixable, false, JSON.stringify(s.findings));
  const r = fixPaths(two);
  assert.equal(r.changed, false);
  assert.equal(r.skipped.length, 1, JSON.stringify(r.skipped));
  assert.equal(r.skipped[0].code, 'path-count-3n2');
  assert.deepEqual(r.skeleton, two);
});

test('malformed weighted vertices are skipped untouched', () => {
  const weighted = pathSkeleton(HEALTHY_POINTS, [253.4, 517.6]);
  pathOf(weighted).vertexCount = 6;
  pathOf(weighted).vertices = [1, 1, 10, 0, 1, 1, 1, 20, 0, 1];   // deliberately not vc * 2, and only 2 groups
  const r = fixPaths(weighted);
  assert.equal(r.changed, false);
  assert.equal(r.skipped.length, 1, JSON.stringify(r.skipped));
  assert.equal(r.skipped[0].code, 'path-not-flat');
  const s = scanPaths(weighted);
  assert.deepEqual(s.findings.map(f => [f.code, f.level, f.params.fixable]), [['path-vertices-layout', 'fatal', false]]);
  assert.equal(pathsLoadable(weighted).ok, false);
});

// Legacy bug, fixed here: legacy scan called every weighted path blocking and legacy
// loadable() failed it, so the write gate refused files the official runtime reads fine.
test('a well-formed weighted path is neither blocking nor rewritten, and the runtime loads it', async () => {
  const weighted = pathSkeleton(HEALTHY_POINTS, [253.4, 517.6]);
  const groups = [];
  for (let i = 0; i < 6; i++) groups.push(1, 1, HEALTHY_POINTS[i * 2], HEALTHY_POINTS[i * 2 + 1], 1);
  pathOf(weighted).vertices = groups;
  assert.equal(weightedGroupsExact(groups, 6), true);
  assert.deepEqual(scanPaths(weighted), { ok: true, blocking: false, findings: [] });
  assert.equal(pathsLoadable(weighted).ok, true);
  const r = fixPaths(weighted);
  assert.equal(r.changed, false);
  assert.deepEqual(r.skipped, []);
  assert.equal((await officialParse(weighted)).ok, true, 'the official parser accepts a weighted path');
  // Weighted with an extra anchor is still blocking, but this module will not touch it.
  const anchored = clone(weighted);
  pathOf(anchored).vertexCount = 7;
  pathOf(anchored).vertices = [1, 1, 0, 0, 1, ...groups];
  const s = scanPaths(anchored);
  const f = s.findings.find(x => x.code === 'path-anchor-triples');
  assert.equal(s.blocking, true);
  assert.equal(f.params.layout, 'weighted');
  assert.equal(f.params.fixable, false);
  assert.equal(fixPaths(anchored).changed, false);
  assert.equal(fixPaths(anchored).skipped.length, 1);
});

test('an invalid vertexCount is blocking, unfixable and skipped', () => {
  const bad = pathSkeleton(HEALTHY_POINTS, [253.4, 517.6]);
  pathOf(bad).vertexCount = 0;
  assert.deepEqual(scanPaths(bad).findings.map(f => [f.code, f.level]), [['path-count-invalid', 'fatal']]);
  assert.equal(fixPaths(bad).skipped[0].code, 'path-count-invalid');
  assert.equal(pathsLoadable(bad).ok, false);
});

test('skins written as a pre-4.x object map are walked too', () => {
  const legacyShape = clone(BROKEN);
  legacyShape.skins = { default: legacyShape.skins[0].attachments };
  assert.equal(scanPaths(legacyShape).blocking, true);
  assert.equal(fixPaths(legacyShape).changed, true);
});

// ── the write gate: no new fatal ─────────────────────────────────────────────

test('on a file broken elsewhere, the repair still runs and adds no fatal of its own', () => {
  // The write gate does not count an inherited fatal as a blocker, but refuses to write if
  // the repair mints one. On a file that is otherwise broken (a slot's bone is missing)
  // the repair must still be writable: the breakage comes from the file, not from us.
  const inherited = clone(BROKEN);
  inherited.slots[0].bone = 'no_such_bone';
  const r = fixPaths(inherited);
  assert.equal(r.changed, true);
  const { fresh, inherited: kept } = splitFatals(checkSkeleton(inherited), checkSkeleton(r.skeleton));
  assert.deepEqual(fresh, [], 'the repair produced no new fatal');
  assert.ok(kept.some(f => f.code === 'slot-bone'), 'the inherited fatal is still reported');
});

// ── cross-check: the official parser ─────────────────────────────────────────
// The static checks above grade path-fix against its own premise (vertexCount % 3). The
// only outside answer to "does the official runtime reject the 3n+1 file" is this block.

test('official parser: accepts the healthy file', async () => {
  const r = await officialParse(HEALTHY);
  assert.equal(r.ok, true, r.error);
});

test('official parser: rejects the 3n+1 file with "Invalid array length" (why this repair exists)', needsSpine, async () => {
  const r = await officialParse(BROKEN);
  assert.equal(r.ok, false, 'accepted: the runtime constraint may have changed; review the repair');
  assert.match(r.error, /Invalid array length/i);
});

test('official parser: accepts the repaired file', async () => {
  const r = await officialParse(fixPaths(BROKEN).skeleton);
  assert.equal(r.ok, true, r.error);
});

// The real project file the binary gate uses carries a 61-vertex path.
test('real fixture: sample_intro is rejected as found and plays after the repair', async () => {
  const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/binary/sample_intro.json', import.meta.url), 'utf8'));
  const s = scanPaths(raw);
  assert.equal(s.blocking, true);
  const f = s.findings.find(x => x.code === 'path-anchor-triples');
  assert.equal(f.params.vertexCount, 61);
  assert.equal(f.params.fixable, true);
  assert.equal((await officialParse(raw)).ok, false);

  const r = fixPaths(raw);
  assert.equal(r.report.length, 1);
  assert.deepEqual(r.report[0].after, { vertexCount: 60, vertices: 120, lengths: 20 });
  assert.equal(scanPaths(r.skeleton).blocking, false);
  const { fresh } = splitFatals(checkSkeleton(raw), checkSkeleton(r.skeleton));
  assert.deepEqual(fresh, []);
  // Everything except the one path is byte-identical.
  const strip = sk => { const c = clone(sk); delete c.skins[0].attachments[f.params.slot][f.params.attachment]; return c; };
  assert.deepEqual(strip(r.skeleton), strip(raw));

  const data = await parseSkeleton(r.skeleton);
  const name = data.animations[0].name;
  const [pose] = await sampleAnimation(data, name, [data.animations[0].duration / 2]);
  assert.ok(pose.bones.every(b => Number.isFinite(b.worldX) && Number.isFinite(b.worldY)), 'the repaired path constraint poses finite bones');
});
