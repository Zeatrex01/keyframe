// Repairs Spine path attachments that no runtime can load. Ported from legacy pathfix.js.
//
// The failure (verified against the official spine-ts 4.2 runtime itself, not guessed):
// the JSON loader does
//     let n = map.vertexCount; readVertices(map, path, n << 1); lengths = newArray(n / 3, 0);
// and `newArray` calls `new Array(n / 3)`. With vertexCount = 61 that is
// `new Array(20.333...)`, and JS throws "Invalid array length": the skeleton never loads,
// so the whole file looks broken even though every other attachment is fine.
// So `vertexCount % 3 === 0` is a hard runtime requirement.
//
// The cause (the owner's reading, confirmed by the data): older studio versions wrote an
// "anchor + triples" layout, one leading start point followed by 3 control points per
// curve: 3C+1 vertices and C+1 lengths. The current exporter writes 3C vertices (no
// leading anchor) with C lengths, which is what loads.
//
// Which end carries the extra point, measured rather than assumed: aligning a broken
// 61-vertex car path against the healthy 60-vertex one matched 57/60 points when the
// first vertex was dropped and 0/60 when the last was. Dropping the tail "fixes" the crash
// while silently shifting every curve by one control point, so this module drops the head.
//
// On `lengths`: Spine documents them as cumulative (distance from the path start to the
// end of each curve), and PathConstraint reads `lengths[curveCount - 2]` as the total path
// length. That branch only runs when `constantSpeed` is false; with constantSpeed (the
// loader's default) the runtime measures the curves itself and ignores the stored values.
// They are still written correctly so the file is right on its own terms, and that can be
// done exactly because the leading anchor is still present when measuring: it is the b0
// of the first curve. Measure first, then drop it.
//
// Division of labour with src/spine/check.js: the checker catches this pattern
// (`path-vc3`, "redraw this path in Spine and re-export") and refuses the file at the
// delivery gate; this module repairs it. They stay separate so that if the repair ever
// goes wrong the checker still speaks independently, which is why a repaired file goes
// through the checker before it is written anywhere.
//
// Pure: no file I/O, no DOM.

import { finding } from './findings.js';
import { skinsOf } from './check.js';
import { weightedGroupsExact } from './vertices.js';

export { weightedGroupsExact };

const round4 = v => Math.round(v * 1e4) / 1e4;
function bezier(a, b, c, d, t) {
  const u = 1 - t, u2 = u * u, t2 = t * t;
  return { x: u2 * u * a.x + 3 * u2 * t * b.x + 3 * u * t2 * c.x + t2 * t * d.x,
    y: u2 * u * a.y + 3 * u2 * t * b.y + 3 * u * t2 * c.y + t2 * t * d.y };
}
const distance = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
// The same 48-sample estimate the exporter uses, so a repaired file and a freshly
// generated one describe the path the same way.
export const ARC_SAMPLES = 48;
function arcLength(b0, b1, b2, b3) {
  let length = 0, prev = b0;
  for (let k = 1; k <= ARC_SAMPLES; k++) {
    const q = bezier(b0, b1, b2, b3, k / ARC_SAMPLES);
    length += distance(prev, q);
    prev = q;
  }
  return length;
}


// Walk every path attachment, with enough context to rewrite it in place.
function eachPath(sk, fn) {
  for (const skin of skinsOf(sk ?? {})) {
    for (const [slot, atts] of Object.entries(skin.attachments || {})) {
      for (const [attachment, a] of Object.entries(atts || {})) {
        if (a && (a.type || '') === 'path') {
          fn(a, { skin: skin.name, slot, attachment, where: `skins/${skin.name}/${slot}/${attachment}` });
        }
      }
    }
  }
}

const validCount = vc => typeof vc === 'number' && Number.isFinite(vc) && vc > 0;

/**
 * Report what is wrong with every path attachment.
 *
 * Level matters, because this drives a one-click repair:
 *   'fatal' - the runtime cannot load the file at all. Must be fixed.
 *   'warn'  - it loads; something is untidy, but rewriting it would edit a working file
 *             for no functional gain. Reported, never changed.
 * `params.fixable` says whether fixPaths can repair it without inventing geometry.
 *
 * @param {object} sk parsed skeleton JSON
 * @returns {{ ok: boolean, blocking: boolean, findings: ReturnType<typeof finding>[] }}
 */
export function scanPaths(sk) {
  const findings = [];
  eachPath(sk, (a, at) => {
    const vc = a.vertexCount, verts = a.vertices || [], lengths = a.lengths || [];
    const base = { skin: at.skin, slot: at.slot, attachment: at.attachment, vertexCount: vc ?? null,
      vertices: verts.length, lengths: lengths.length, closed: a.closed, constantSpeed: a.constantSpeed };
    const add = (level, code, message, extra) => findings.push(finding(level, code, at.where, message, { ...base, ...extra }));
    let layout = 'triples';
    let loads = true;

    if (!validCount(vc)) {
      add('fatal', 'path-count-invalid', `Path vertexCount is invalid: ${vc}.`, { fixable: false, layout: null });
      return;
    }
    if (verts.length !== vc * 2) {
      // A weighted path stores bone indices inline: vertexCount groups instead of
      // vertexCount * 2 numbers. It loads, and this module never rewrites one. (Legacy
      // called every weighted path blocking, so its write gate refused files the runtime
      // reads fine.)
      if (!weightedGroupsExact(verts, vc)) {
        add('fatal', 'path-vertices-layout',
          `Path vertices hold neither ${vc * 2} numbers (unweighted) nor ${vc} weighted groups; check it by hand.`,
          { fixable: false, layout: null });
        return;
      }
      layout = 'weighted';
    }
    if (vc % 3 === 1) {
      const weighted = layout === 'weighted';
      if (!weighted) layout = 'anchor-triples';
      add('fatal', 'path-anchor-triples',
        `Path vertexCount ${vc} is 3 x ${(vc - 1) / 3} + 1: one leading anchor point too many. The runtime fails with new Array(${(vc / 3).toFixed(3)}) ("Invalid array length").`
          + (weighted ? ' This path is weighted, so it is not repaired automatically.' : ''),
        { fixable: !weighted, layout });
      loads = false;
    } else if (vc % 3 === 2) {
      add('fatal', 'path-count-3n2',
        `Path vertexCount ${vc} is not a multiple of 3 (3n+2). This is not a known layout and it is unclear which point is extra; check it by hand.`,
        { fixable: false, layout });
      return;
    }

    // Only meaningful once the vertex layout itself is sane.
    const wanted = layout === 'anchor-triples' ? (vc - 1) / 3 : Math.floor(vc / 3);
    const lengthsLevel = loads ? 'warn' : 'fatal';
    if (lengths.length !== wanted) {
      add(lengthsLevel, 'path-lengths-count', `Path has ${lengths.length} lengths; it should have ${wanted}.`,
        { fixable: layout !== 'weighted', layout, expected: wanted });
    }
    if (lengths.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
      add(lengthsLevel, 'path-lengths-not-numbers', 'Path lengths contain a value that is not a finite number.',
        { fixable: layout !== 'weighted', layout });
    } else if (lengths.length > 1 && lengths.some((v, i) => i > 0 && v < lengths[i - 1])) {
      // Spine documents lengths as cumulative. Older studio exports wrote per-segment
      // values, which look non-monotonic here: harmless while constantSpeed is true (the
      // runtime measures the curves itself), so this stays a warning and is never
      // rewritten. Flagged so the convention gap is on record, not silent.
      add('warn', 'path-lengths-not-cumulative',
        'Path lengths are not increasing; Spine defines them as cumulative. With constantSpeed the runtime ignores them, so this is harmless.',
        { fixable: false, layout });
    }
  });
  return { ok: findings.length === 0, blocking: findings.some(f => f.level === 'fatal'), findings };
}

/**
 * Repair the paths that stop the runtime, on a clone.
 *
 * Minimal by design. Only paths that actually stop the runtime, or whose lengths are
 * missing or not numbers, are rewritten; a path that loads with the right number of
 * lengths is left byte-identical, even if its lengths use the other convention. Silently
 * "tidying" working files is how a repair tool loses trust. The input is never mutated:
 * callers keep the original to diff or discard.
 *
 * @param {object} sk parsed skeleton JSON
 * @returns {{ skeleton: object, changed: boolean, report: object[], skipped: object[] }}
 */
export function fixPaths(sk) {
  const out = structuredClone(sk);
  const report = [], skipped = [];
  eachPath(out, (a, at) => {
    const vc = a.vertexCount, verts = a.vertices || [];
    const place = { skin: at.skin, slot: at.slot, attachment: at.attachment, where: at.where };
    const skip = (code, reason) => skipped.push({ ...place, code, reason });
    if (!validCount(vc)) return skip('path-count-invalid', `vertexCount is invalid: ${vc}.`);
    if (verts.length !== vc * 2) {
      // A weighted path loads as long as its count and lengths are right; its lengths cannot
      // be measured without posing bones, so anything else about it is left to a human.
      const lengthsOk = (a.lengths || []).length === vc / 3;
      if (weightedGroupsExact(verts, vc) && vc % 3 === 0 && lengthsOk) return;
      return skip('path-not-flat', 'vertices are not vertexCount * 2 numbers (weighted or bone-bound); left untouched.');
    }
    if (vc % 3 === 2) return skip('path-count-3n2', 'vertexCount is 3n+2: which point is extra is unclear; left untouched.');

    const lengths = a.lengths || [];
    const needsVertexFix = vc % 3 === 1;
    const wanted = needsVertexFix ? (vc - 1) / 3 : vc / 3;
    // A path that loads and has the right number of finite lengths is left alone.
    const lengthsBroken = lengths.length !== wanted || lengths.some(v => typeof v !== 'number' || !Number.isFinite(v));
    if (!needsVertexFix && !lengthsBroken) return;                    // healthy: no diff at all

    const before = { vertexCount: vc, vertices: verts.length, lengths: lengths.length };
    const actions = [];
    let points = [];
    for (let i = 0; i < verts.length; i += 2) points.push({ x: verts[i], y: verts[i + 1] });

    let anchor = null;
    if (needsVertexFix) {
      // points = [P0, (c1, c2, P1), (c3, c4, P2), ...]. P0 is the first curve's b0, so the
      // arc lengths are measured while it is still here, then it is dropped.
      anchor = points[0];
      points = points.slice(1);
      actions.push({ code: 'dropped-leading-anchor', message: `Dropped the leading anchor point (vertexCount ${vc} -> ${points.length}).` });
      a.vertices = points.flatMap(p => [p.x, p.y]);
      a.vertexCount = points.length;
    }

    const curves = Math.floor(points.length / 3);
    const measured = [];
    let total = 0, b0 = anchor || points[0];
    for (let c = 0; c < curves; c++) {
      const b1 = points[c * 3], b2 = points[c * 3 + 1], b3 = points[c * 3 + 2];
      total += arcLength(b0, b1, b2, b3);
      measured.push(round4(total));
      b0 = b3;
    }
    a.lengths = measured;
    actions.push({ code: 'recomputed-lengths', message: `Recomputed lengths: cumulative, ${measured.length} values (total path ${round4(total)}).` });
    // Only stated when this path is being rewritten anyway.
    if (a.closed === undefined) { a.closed = false; actions.push({ code: 'wrote-closed', message: 'Wrote closed: false.' }); }
    if (a.constantSpeed === undefined) { a.constantSpeed = true; actions.push({ code: 'wrote-constant-speed', message: 'Wrote constantSpeed: true.' }); }

    report.push({ ...place, before,
      after: { vertexCount: a.vertexCount, vertices: a.vertices.length, lengths: a.lengths.length }, actions });
  });
  return { skeleton: out, changed: report.length > 0, report, skipped };
}

/**
 * Cheap post-check: would the runtime's own allocation succeed now?
 * @returns {{ ok: boolean, bad: { where: string, vertexCount: unknown, reason: string }[] }}
 */
export function pathsLoadable(sk) {
  const bad = [];
  eachPath(sk, (a, at) => {
    const vc = a.vertexCount;
    const verts = a.vertices || [];
    if (typeof vc !== 'number' || vc % 3 !== 0) {
      bad.push({ where: at.where, vertexCount: vc, reason: 'vertexCount is not a multiple of 3' });
    } else if (verts.length !== vc * 2 && !weightedGroupsExact(verts, vc)) {
      bad.push({ where: at.where, vertexCount: vc, reason: 'vertices are neither flat nor weighted groups' });
    }
  });
  return { ok: bad.length === 0, bad };
}
