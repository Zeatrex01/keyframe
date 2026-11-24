// Mechanical weight repair: the five operations that need no artistic judgment, and the
// invariants that keep them from becoming vandalism. Ported from legacy weight_edit.js.
//
// The studio does not weight from scratch here; it fixes what exists. The reader could already see real defects
// in artists' files (the fixture carries crumb influences under 0.01) but nothing could
// fix them.
//
// The boundary, named before the code (docs/concept.md
// "Division of labour"): what crosses is only the mechanical half. Drop crumbs,
// renormalize, move weight between two bones that already exist, add or drop one existing
// bone's influence. What stays the artist's: mesh topology, new meshes, deform painting,
// and every "does it bend nicely" question. None of the verbs below is painting.
//
// The guarantees, each enforced here and pinned in test/weight-repair.test.js:
//   * topology (uvs, triangles, hull, edges, width, height) passes through byte-identical
//   * the vertex count cannot change, every vertex keeps at least one influence
//   * every vertex sums to 1 (no other gate checks this: check.js has no sum rule, and
//     the official runtime does NOT normalize on load; a drifted vertex is drawn off its
//     place, measured with spine-ts 4.2)
//   * bones come only from the current rig
//   * a mesh carrying a deform timeline is refused for every operation that can change
//     how many influences a vertex has
//   * any violation throws a StudioError and nothing is produced; the input is never mutated
//
// Layering: this module does no rig math of its own and never imports the runtime. The
// two operations that place a new influence need the setup-pose world matrix of each bone;
// the caller passes them in (`setupBones`, exactly the `bones` of the runtime's
// `poseSetup(data)` snapshot: { name, worldX, worldY, matrix: { a, b, c, d } }).

import { StudioError } from '../shared/errors.js';
import { LEGACY_MARKERS, LEGACY_MARKER_FIELDS } from '../shared/legacy-names.js';
import { checkSkeleton } from './check.js';
import { splitFatals, describe } from './findings.js';
import { decodeVertices, encodeVertices, isWeighted, listMeshes, signature } from './weights.js';

export const OPERATIONS = Object.freeze(['clean', 'normalize', 'transfer', 'add_influence', 'remove_influence']);
/** A vertex sum within this of 1 counts as settled and is left byte-identical. */
export const WEIGHT_EPSILON = 1e-6;
export const DEFAULT_THRESHOLD = 0.01;
export const DEFAULT_RATIO = 1;
export const DEFAULT_WEIGHT = 0.1;
export const TOPOLOGY_FIELDS = Object.freeze(['uvs', 'triangles', 'hull', 'edges', 'width', 'height']);

/** The delivery marker this tree writes: which attachments carry a repair, and the base's stamp. */
export const REPAIR_MARKER = '_kfWeights';
// The legacy studio wrote the same marker under its Turkish name. Decided 2026-10-28:
// read it as an alias, never write it. The name lives in src/shared/legacy-names.js.
export const LEGACY_REPAIR_MARKER = LEGACY_MARKERS[REPAIR_MARKER];

const NEEDS_WORLD = new Set(['transfer', 'add_influence']);
const round6 = v => Math.round(v * 1e6) / 1e6;
const sumOf = vertex => vertex.influences.reduce((a, e) => a + e.weight, 0);
const json = v => JSON.stringify(v);

/**
 * The mesh a request names, by slot and attachment across every skin. Ambiguity is refused,
 * not resolved: two skins can carry the same attachment name with different geometry, and
 * silently picking one would edit a mesh the caller never named.
 */
export function findTarget(sk, slot, attachment) {
  const found = listMeshes(sk).filter(m => (!slot || m.slot === slot) && (!attachment || m.attachment === attachment));
  if (!found.length) {
    throw new StudioError('mesh-not-found', `No mesh attachment matches slot "${slot ?? '(any)'}", attachment "${attachment ?? '(any)'}".`,
      { slot: slot ?? null, attachment: attachment ?? null });
  }
  if (found.length > 1) {
    throw new StudioError('mesh-ambiguous',
      `${found.length} meshes match (${found.map(m => `${m.skin}/${m.slot}/${m.attachment}`).join(', ')}); name both the slot and the attachment.`,
      { matches: found.map(m => ({ skin: m.skin, slot: m.slot, attachment: m.attachment })) });
  }
  return found[0];
}

/**
 * The first animation with a deform timeline on this mesh, or null. A deform timeline stores
 * per-influence offsets against this exact vertex array, so changing how many influences a
 * vertex has silently invalidates every key in it. Checked:
 *   * 4.x `attachments/<skin>/<slot>/<name>/deform`, and an array in that place (a
 *     pre-4 shaped key under the 4.x section: unreadable as anything else, so refused)
 *   * pre-4 `deform/<skin>/<slot>/<name>`, because a file that opens in either can be handed over
 *   * the same on every linked mesh that shares this mesh's vertices (legacy missed these)
 * A `sequence`-only entry is not a deform and does not depend on the vertex array.
 */
export function deformAnimation(sk, target) {
  const keyed = [[target.skin, target.attachment]];
  for (const skin of Array.isArray(sk.skins) ? sk.skins : []) {
    for (const [name, a] of Object.entries(skin?.attachments?.[target.slot] ?? {})) {
      if (a?.type === 'linkedmesh' && a.parent === target.attachment && (a.skin ?? 'default') === target.skin) keyed.push([skin.name, name]);
    }
  }
  for (const [animation, a] of Object.entries(sk.animations ?? {})) {
    for (const [skin, name] of keyed) {
      const entry = a?.attachments?.[skin]?.[target.slot]?.[name];
      if (entry && (Array.isArray(entry) || entry.deform !== undefined)) return animation;
      if (a?.deform?.[skin]?.[target.slot]?.[name]) return animation;
    }
  }
  return null;
}

// Rigid bind (legacy `_kfBind`) is not carried in this tree, but a file bound by the legacy
// studio can still arrive. Its marker cannot express a repair layered on the bind, so
// composing the two would make the next rebuild lose the repair or carry stale bone
// indices. Legacy refused a bound target; a marker this module cannot read is refused too,
// because then it cannot prove the target is unbound.
function refuseBound(sk, target) {
  if (!Object.prototype.hasOwnProperty.call(sk, '_kfBind')) return;
  const marker = sk._kfBind;
  if (!marker || typeof marker !== 'object' || !Array.isArray(marker.edits)) {
    throw new StudioError('bind-marker-malformed', 'The skeleton carries a rigid-bind marker (_kfBind) that cannot be read; weight repair is refused.');
  }
  const hit = marker.edits.find(r => r?.target?.slot === target.slot && r.target.attachment === target.attachment);
  if (hit) {
    throw new StudioError('mesh-bound', `${target.slot}/${target.attachment} is rigidly bound (_kfBind); weight repair on a bound mesh is not supported.`,
      { slot: target.slot, attachment: target.attachment });
  }
}

// Bone name -> index, and (for the operations that place an influence) the caller's
// setup-pose world matrices. They must describe this rig, bone for bone, in order: a matrix
// set from another skeleton would put new influences in the wrong place.
function rigOf(sk, setupBones, needsWorld) {
  const names = sk.bones.map(b => b.name);
  const index = new Map(names.map((n, i) => [n, i]));
  if (!needsWorld) return { names, index, world: null };
  if (!Array.isArray(setupBones)) {
    throw new StudioError('missing-bone-world', 'This operation places new influences; pass setupBones (the bones of poseSetup(data)).');
  }
  const sameRig = setupBones.length === names.length && setupBones.every((b, i) => b?.name === names[i]);
  const finite = setupBones.every(b => [b?.worldX, b?.worldY, b?.matrix?.a, b?.matrix?.b, b?.matrix?.c, b?.matrix?.d].every(Number.isFinite));
  if (!sameRig || !finite) {
    throw new StudioError('bone-world-mismatch', 'setupBones does not describe this rig bone for bone (names, order and a finite world matrix each).',
      { expected: names, got: setupBones.map(b => b?.name ?? null) });
  }
  return { names, index, world: setupBones };
}

// Bone space -> world, with the setup-pose matrix: world = [a b; c d] * local + (worldX, worldY).
function toWorld(rig, bone, x, y) {
  const B = rig.world[bone];
  return { x: B.matrix.a * x + B.matrix.b * y + B.worldX, y: B.matrix.c * x + B.matrix.d * y + B.worldY };
}

// World -> one bone's space. This is why a new influence is exact rather than a guess: its
// x/y are derived, never copied from another bone's local space. The legacy version used
// rotation and scale only (no shear) and replaced a zero scale with 1; a singular matrix is
// refused instead.
function toBone(rig, bone, p) {
  const { a, b, c, d } = rig.world[bone].matrix;
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-12)) {
    throw new StudioError('degenerate-bone', `Bone "${rig.names[bone]}" has a singular setup-pose matrix (zero scale); a position in its space is undefined.`,
      { bone: rig.names[bone] });
  }
  const dx = p.x - rig.world[bone].worldX, dy = p.y - rig.world[bone].worldY;
  return { x: (d * dx - b * dy) / det, y: (a * dy - c * dx) / det };
}

// Where the vertex sits once its sum is 1: the weighted average of its influences' world
// points. (Legacy used the raw sum, which on a drifted vertex put the new influence at a
// point the final normalization then moved away from.)
function vertexWorld(rig, vertex) {
  let x = 0, y = 0;
  const s = sumOf(vertex);
  for (const e of vertex.influences) {
    const p = toWorld(rig, e.bone, e.x, e.y);
    x += e.weight * p.x;
    y += e.weight * p.y;
  }
  return { x: x / s, y: y / s };
}

// Rescale one vertex to sum to 1. A settled vertex (within WEIGHT_EPSILON) is left as is:
// the legacy version re-rounded every weight of every vertex to 6 decimals, so repairing a
// clean mesh rewrote the owner's numbers and reported a change. A vertex whose influences
// sum to zero cannot be rescued by scaling.
function normalizeVertex(vertex) {
  const s = sumOf(vertex);
  if (!(s > 0)) return false;
  if (Math.abs(s - 1) <= WEIGHT_EPSILON) return true;
  for (const e of vertex.influences) e.weight = round6(e.weight / s);
  // Rounding can leave a few ulps; the largest share takes the remainder so the sum is 1,
  // not "1 within rounding": the next reader compares to 1.
  const remainder = 1 - sumOf(vertex);
  if (remainder) {
    let top = vertex.influences[0];
    for (const e of vertex.influences) if (e.weight > top.weight) top = e;
    top.weight = round6(top.weight + remainder);
  }
  return true;
}

const zeroSum = i => new StudioError('zero-weight-vertex', `Vertex ${i} has influences that sum to 0; it cannot be normalized.`, { vertex: i });

function numberIn(value, fallback, field, ok, range) {
  const n = value === undefined ? fallback : Number(value);
  if (!ok(n)) throw new StudioError('bad-argument', `${field} must be ${range}; got ${value}.`, { field, value });
  return n;
}

function boneIndex(rig, name, field) {
  const i = rig.index.get(name);
  if (i === undefined) throw new StudioError('unknown-bone', `Bone "${name}" (${field}) is not in this rig.`, { field, bone: name ?? null });
  return i;
}

// ── the operations: each mutates the decoded copy and returns its measurement ──

function clean(decoded, request) {
  const threshold = numberIn(request.threshold, DEFAULT_THRESHOLD, 'threshold', n => n > 0 && n < 1, 'between 0 and 1');
  let removed = 0;
  decoded.vertices.forEach((vertex, i) => {
    const kept = vertex.influences.filter(e => e.weight >= threshold);
    if (!kept.length) {
      // Every influence is a crumb: keep the largest. Dropping them all would leave the
      // vertex unbound, which Spine's own loader treats as fatal.
      let top = vertex.influences[0];
      for (const e of vertex.influences) if (e.weight > top.weight) top = e;
      removed += vertex.influences.length - 1;
      vertex.influences = [top];
    } else {
      removed += vertex.influences.length - kept.length;
      vertex.influences = kept;
    }
    if (!normalizeVertex(vertex)) throw zeroSum(i);
  });
  return { removedInfluences: removed, threshold };
}

function normalize(decoded) {
  let fixed = 0, maxDrift = 0;
  decoded.vertices.forEach((vertex, i) => {
    const drift = Math.abs(sumOf(vertex) - 1);
    if (drift > WEIGHT_EPSILON) { fixed++; maxDrift = Math.max(maxDrift, drift); }
    if (!normalizeVertex(vertex)) throw zeroSum(i);
  });
  return { fixedVertices: fixed, maxDrift: round6(maxDrift) };
}

function transfer(decoded, request, rig) {
  const from = boneIndex(rig, request.from, 'from');
  const to = boneIndex(rig, request.to, 'to');
  if (from === to) throw new StudioError('same-bone', `from and to are the same bone: "${request.from}".`, { bone: request.from });
  const ratio = numberIn(request.ratio, DEFAULT_RATIO, 'ratio', n => n > 0 && n <= 1, 'greater than 0 and at most 1');
  let touched = 0, opened = 0, moved = 0;
  for (const vertex of decoded.vertices) {
    const src = vertex.influences.find(e => e.bone === from);
    if (!src || !(src.weight > 0)) continue;
    const share = src.weight * ratio;
    let dst = vertex.influences.find(e => e.bone === to);
    if (!dst) {
      // The target bone does not touch this vertex yet. Its position is the SOURCE
      // influence's world point, re-expressed in the target's space: the share that
      // followed `from` keeps its place and now follows `to`, so the setup pose does not
      // move (legacy derived it from the whole vertex, which moved inconsistent vertices).
      const local = toBone(rig, to, toWorld(rig, from, src.x, src.y));
      dst = { bone: to, x: round6(local.x), y: round6(local.y), weight: 0 };
      vertex.influences.push(dst);
      opened++;
    }
    src.weight = round6(src.weight - share);
    dst.weight = round6(dst.weight + share);
    moved += share;
    touched++;
    // A drained influence is a dead link; drop it unless it is the last one.
    if (src.weight <= WEIGHT_EPSILON && vertex.influences.length > 1) vertex.influences = vertex.influences.filter(e => e !== src);
    normalizeVertex(vertex);
  }
  if (!touched) {
    throw new StudioError('bone-not-on-mesh', `Bone "${request.from}" does not influence any vertex of this mesh; there is no weight to transfer.`,
      { bone: request.from });
  }
  return { touchedVertices: touched, openedInfluences: opened, movedWeight: round6(moved) };
}

function addInfluence(decoded, request, rig) {
  const bone = boneIndex(rig, request.bone, 'bone');
  const weight = numberIn(request.weight, DEFAULT_WEIGHT, 'weight', n => n > 0 && n < 1, 'between 0 and 1 (both exclusive)');
  let added = 0;
  for (const vertex of decoded.vertices) {
    if (vertex.influences.some(e => e.bone === bone)) continue;
    const local = toBone(rig, bone, vertexWorld(rig, vertex));
    const s = sumOf(vertex);
    for (const e of vertex.influences) e.weight = round6(e.weight / s * (1 - weight));
    vertex.influences.push({ bone, x: round6(local.x), y: round6(local.y), weight: round6(weight) });
    normalizeVertex(vertex);
    added++;
  }
  if (!added) {
    throw new StudioError('bone-already-on-mesh', `Bone "${request.bone}" already influences every vertex of this mesh.`, { bone: request.bone });
  }
  return { addedInfluences: added, weight };
}

function removeInfluence(decoded, request, rig) {
  const bone = boneIndex(rig, request.bone, 'bone');
  let removed = 0;
  decoded.vertices.forEach((vertex, i) => {
    if (!vertex.influences.some(e => e.bone === bone)) return;
    if (vertex.influences.length === 1) {
      throw new StudioError('last-influence',
        `Vertex ${i} is bound only to "${request.bone}"; removing it would leave the vertex unbound. Transfer its weight to another bone first (op: transfer).`,
        { vertex: i, bone: request.bone });
    }
    vertex.influences = vertex.influences.filter(e => e.bone !== bone);
    if (!normalizeVertex(vertex)) throw zeroSum(i);
    removed++;
  });
  if (!removed) {
    throw new StudioError('bone-not-on-mesh', `Bone "${request.bone}" does not influence any vertex of this mesh.`, { bone: request.bone });
  }
  return { removedInfluences: removed };
}

const RUN = { clean, normalize, transfer, add_influence: addInfluence, remove_influence: removeInfluence };

/**
 * The guard. Runs on the RESULT after every operation, and is deliberately paranoid: it
 * re-decodes the produced array with the same decoder the rest of the tree uses instead of
 * trusting the structure just built. Returns a reason code, or null.
 */
export function invariantProblem(vertices, uvs, expectedVertexCount, boneCount) {
  // For valid input this first line is arithmetically unreachable (a weighted vertex holds
  // at least 5 numbers, uvs hold 2). It stays: if the lengths ever matched, every reader,
  // check.js included, would take the mesh for unweighted and skip its weighted audit.
  if (!Array.isArray(vertices) || vertices.length === (uvs ?? []).length) return 'unweighted-length';
  const decoded = decodeVertices({ vertices, uvs });
  if (!decoded || !decoded.weighted) return 'undecodable';
  if (decoded.vertices.length !== expectedVertexCount) return 'vertex-count';
  for (const vertex of decoded.vertices) {
    if (!vertex.influences.length) return 'no-influence';
    for (const e of vertex.influences) {
      if (!Number.isInteger(e.bone) || e.bone < 0 || e.bone >= boneCount) return 'bone-index-range';
      if (!(e.weight >= 0)) return 'bad-weight';
    }
    if (Math.abs(sumOf(vertex) - 1) > WEIGHT_EPSILON) return 'sum';
  }
  return null;
}

function boneTotals(decoded, names) {
  const m = new Map();
  for (const vertex of decoded.vertices) {
    for (const e of vertex.influences) {
      const name = names[e.bone] ?? `#${e.bone}`;
      const r = m.get(name) ?? { vertices: 0, total: 0 };
      r.vertices++;
      r.total += e.weight;
      m.set(name, r);
    }
  }
  return m;
}

// Per bone, before and after: "written" is not proof; the caller must be able to say which
// bone gained how much on how many vertices, and hand that to the owner.
function boneDelta(before, after, names) {
  const a = boneTotals(before, names), b = boneTotals(after, names);
  const out = [];
  for (const bone of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(bone) ?? { vertices: 0, total: 0 };
    const y = b.get(bone) ?? { vertices: 0, total: 0 };
    if (x.vertices === y.vertices && Math.abs(x.total - y.total) < 1e-5) continue;
    out.push({ bone, verticesBefore: x.vertices, verticesAfter: y.vertices,
      weightBefore: round6(x.total), weightAfter: round6(y.total), change: round6(y.total - x.total) });
  }
  return out.sort((p, q) => Math.abs(q.change) - Math.abs(p.change));
}

const influenceCount = decoded => decoded.vertices.reduce((a, v) => a + v.influences.length, 0);

/**
 * Compute one mechanical repair. Pure: never mutates `sk`, never touches a file. Throws a
 * StudioError on every refusal; on success returns the new `vertices` for the target and
 * the measurement. Apply it with applyRepair.
 *
 * @param {object} sk parsed skeleton JSON
 * @param {{ op: string, slot?: string, attachment?: string, threshold?: number, from?: string,
 *           to?: string, ratio?: number, bone?: string, weight?: number }} request
 * @param {{ setupBones?: Array<{ name: string, worldX: number, worldY: number, matrix: object }> }} [options]
 *        setupBones is required by `transfer` and `add_influence`
 */
export function repairWeights(sk, request, { setupBones } = {}) {
  const r = /** @type {typeof request} */ (request ?? {});
  if (!OPERATIONS.includes(r.op)) {
    throw new StudioError('unknown-operation', `Unknown operation "${r.op}"; valid: ${OPERATIONS.join(', ')}.`, { op: r.op ?? null, valid: OPERATIONS });
  }
  if (!sk || !Array.isArray(sk.bones) || !sk.bones.length) throw new StudioError('no-bones', 'The skeleton has no bones.');

  const target = findTarget(sk, r.slot, r.attachment);
  const where = { skin: target.skin, slot: target.slot, attachment: target.attachment };
  refuseBound(sk, target);
  if (!isWeighted(target.mesh)) {
    throw new StudioError('mesh-unweighted', `${target.slot}/${target.attachment} is an unweighted mesh (bound to one bone); there are no weights to repair. Assigning weights is done in Spine.`, where);
  }
  const decoded = decodeVertices(target.mesh);
  if (!decoded) throw new StudioError('mesh-malformed', `The vertices array of ${target.slot}/${target.attachment} cannot be decoded; it is left untouched.`, where);
  // Checked on the input, before any arithmetic: an index outside the rig would make the
  // world maths read a bone that does not exist (legacy threw a TypeError there).
  const boneCount = sk.bones.length;
  const badIndex = decoded.vertices.findIndex(v => v.influences.some(e => !Number.isInteger(e.bone) || e.bone < 0 || e.bone >= boneCount));
  if (badIndex >= 0) {
    throw new StudioError('bone-index-range', `Vertex ${badIndex} of ${target.slot}/${target.attachment} points at a bone outside this rig; the mesh is not repaired.`,
      { ...where, vertex: badIndex, boneCount });
  }
  // Only `normalize` never changes how many influences a vertex has, so it alone stays
  // available on a deformed mesh.
  if (r.op !== 'normalize') {
    const animation = deformAnimation(sk, target);
    if (animation) {
      throw new StudioError('mesh-has-deform',
        `${target.slot}/${target.attachment} has a deform timeline (animation "${animation}"). Operations that change the influence count would silently corrupt its keys; only normalize is safe.`,
        { ...where, animation });
    }
  }

  const rig = rigOf(sk, setupBones, NEEDS_WORLD.has(r.op));
  const before = decodeVertices(target.mesh); // a second, untouched copy
  const measure = RUN[r.op](decoded, r, rig);

  // Final pass: settle the pre-existing drift of vertices the operation did not touch, and
  // report how many. Born from a legacy gate finding: add_influence left the owner's own
  // 1e-5 drift on untouched vertices and the invariant check rightly failed. The answer
  // was not to loosen the check: a repair tool may not leave the mesh it writes partly
  // inconsistent, and the side effect is reported, not silent.
  let sideNormalized = 0;
  decoded.vertices.forEach((vertex, i) => {
    if (Math.abs(sumOf(vertex) - 1) > WEIGHT_EPSILON) sideNormalized++;
    if (!normalizeVertex(vertex)) throw zeroSum(i);
  });

  const vertices = encodeVertices(decoded);
  const problem = invariantProblem(vertices, target.mesh.uvs, before.vertices.length, boneCount);
  if (problem) {
    throw new StudioError('invariant-violation', `Invariant violated (${problem}); nothing was produced.`, { ...where, reason: problem });
  }
  return {
    target: where,
    op: r.op,
    vertices,
    changed: json(vertices) !== json(target.mesh.vertices),
    sourceSignature: signature(target.mesh.vertices),
    measure,
    ...(sideNormalized ? { sideNormalized } : {}),
    boneDelta: boneDelta(before, decoded, rig.names),
    vertexCount: decoded.vertices.length,
    influencesBefore: influenceCount(before),
    influencesAfter: influenceCount(decoded),
  };
}

/**
 * The repair records a skeleton carries, keyed "slot/attachment":
 * { baseSignature, base, operation, time }. Reads `_kfWeights` and the legacy alias; a key
 * present in both takes the `_kfWeights` record. From a legacy record only the base signature
 * is carried (LEGACY_MARKER_FIELDS): it is what decides "base wins", and the legacy export
 * never read the other fields. base, operation and time come back null for such a record.
 */
export function readRepairMarker(sk) {
  const records = {};
  const legacy = sk?.[LEGACY_REPAIR_MARKER];
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [key, rec] of Object.entries(legacy)) {
      records[key] = { baseSignature: rec?.[LEGACY_MARKER_FIELDS.baseSignature] ?? null, base: null, operation: null, time: null };
    }
  }
  const current = sk?.[REPAIR_MARKER];
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    for (const [key, rec] of Object.entries(current)) {
      records[key] = { baseSignature: rec?.baseSignature ?? null, base: rec?.base ?? null,
        operation: rec?.operation ?? null, time: rec?.time ?? null };
    }
  }
  return records;
}

/**
 * Apply a repairWeights result to a copy of the skeleton and stamp the marker. Only the
 * target's `vertices` change. The marker is written as `_kfWeights` only; a legacy alias
 * marker is folded into it and removed, so the file never carries two.
 *
 * Refuses when `sk` is not the skeleton the repair was computed from (its target vertices
 * changed since), or when the result carries a fatal the input did not
 * (findings.js: inherited fatals are the owner's and never block).
 *
 * @param {object} sk     the skeleton to write into (the delivery, or a copy of the source)
 * @param {object} result from repairWeights
 * @param {{ baseSkeleton?: object, baseName?: string, time?: string }} [stamp]
 *        baseSkeleton: the protected base, whose target vertices are fingerprinted so a later
 *        rebuild can tell whether the owner touched that mesh (then the base wins)
 * @returns {object} a new skeleton
 */
export function applyRepair(sk, result, { baseSkeleton, baseName = null, time = null } = {}) {
  if (!result?.target || !Array.isArray(result.vertices) || typeof result.sourceSignature !== 'string') {
    throw new StudioError('bad-argument', 'applyRepair needs a result returned by repairWeights.');
  }
  const { slot, attachment } = result.target;
  const before = findTarget(sk, slot, attachment);
  if (before.skin !== result.target.skin || signature(before.mesh.vertices) !== result.sourceSignature) {
    throw new StudioError('stale-repair', `${slot}/${attachment} is not the mesh this repair was computed from; compute it again on this skeleton.`,
      { slot, attachment });
  }
  const out = structuredClone(sk);
  const place = findTarget(out, slot, attachment);
  // Only `vertices` is assigned: topology passes through untouched by construction.
  place.mesh.vertices = result.vertices.slice();

  let baseSignature = null;
  if (baseSkeleton) {
    const base = listMeshes(baseSkeleton).filter(m => m.slot === slot && m.attachment === attachment);
    if (base.length === 1) baseSignature = signature(base[0].mesh.vertices);
  }
  const records = readRepairMarker(out);
  records[`${slot}/${attachment}`] = { baseSignature, base: baseName, operation: result.op, time };
  delete out[LEGACY_REPAIR_MARKER];
  out[REPAIR_MARKER] = records;

  const { fresh } = splitFatals(checkSkeleton(sk), checkSkeleton(out));
  if (fresh.length) {
    throw new StudioError('repair-new-fatal', `The repaired skeleton fails a check the input passed: ${describe(fresh).join('; ')}`,
      { slot, attachment, findings: fresh });
  }
  return out;
}
