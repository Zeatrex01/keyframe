// The one place that understands Spine's weighted vertex array: decode, encode, report.
// Ported from legacy weights.js.
//
// Why it exists: no other tool returns a weight value. A diff can say "this mesh changed",
// but not "which bone carries this vertex, and how much". Writing motion on a rig whose
// weights you cannot see is working blind: you move a bone and cannot tell what follows.
// It is also the single decoder, so a second copy (legacy merge.js had one inline) never
// grows again.
//
// The format (Spine 4.x), and the trap in it. A mesh's `vertices` has two shapes, and only
// `uvs` tells them apart:
//   unweighted: [x, y, x, y, ...]                        length === uvs.length
//   weighted:   [n, (boneIndex, x, y, weight) * n, ...]  length  >  uvs.length
// In the weighted shape x/y are in the bone's space, not world; that is what makes the
// vertex follow the bone. Bone indices point into the skeleton's `bones` array order, so
// they mean nothing without that array. One vertex's weights should sum to 1, and nothing
// fixes a file whose sums drift: the official runtime draws exactly what is written.
//
// Pure: takes parsed JSON, returns plain data and findings (src/spine/findings.js).

import { finding } from './findings.js';
import { skinsOf } from './check.js';

const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

/** More than this many influences on one vertex: valid, but some GPU paths keep only 4. */
export const MAX_GPU_INFLUENCES = 4;
/** A vertex sum further than this from 1 is reported as drifted. */
export const SUM_TOLERANCE = 0.001;

/** True when the attachment's `vertices` use the weighted shape. */
export function isWeighted(attachment) {
  if (!attachment || !Array.isArray(attachment.vertices)) return false;
  const uvs = Array.isArray(attachment.uvs) ? attachment.uvs.length : 0;
  return uvs > 0 && attachment.vertices.length > uvs;
}

/**
 * Flat array -> per-vertex structure.
 *   unweighted: { weighted: false, vertices: [{ x, y }] }
 *   weighted:   { weighted: true,  vertices: [{ influences: [{ bone, x, y, weight }] }] }
 * Returns null when the array is malformed instead of guessing: a bone count that runs
 * past the end means this is not the format, and inventing a vertex there would be a
 * confident wrong answer, the worst output a measuring tool can give.
 * @returns {{ weighted: boolean, vertices: Array<{ x?: number, y?: number,
 *   influences?: Array<{ bone: number, x: number, y: number, weight: number }> }> } | null}
 */
export function decodeVertices(attachment) {
  if (!attachment || !Array.isArray(attachment.vertices)) return null;
  const v = attachment.vertices;
  if (!isWeighted(attachment)) {
    const vertices = [];
    for (let i = 0; i + 1 < v.length; i += 2) vertices.push({ x: v[i], y: v[i + 1] });
    return { weighted: false, vertices };
  }
  const vertices = [];
  let i = 0;
  while (i < v.length) {
    const n = v[i++];
    if (!(n >= 0) || !Number.isInteger(n) || i + n * 4 > v.length) return null;
    const influences = [];
    for (let k = 0; k < n; k++) influences.push({ bone: v[i++], x: v[i++], y: v[i++], weight: v[i++] });
    vertices.push({ influences });
  }
  return { weighted: true, vertices };
}

/**
 * Per-vertex structure -> flat array. The inverse of decodeVertices; the gate pins the
 * round trip on a real file, because a decoder that cannot rebuild what it read is a rewrite.
 */
export function encodeVertices(decoded) {
  if (!decoded) return null;
  const out = [];
  if (!decoded.weighted) {
    for (const p of decoded.vertices) out.push(p.x, p.y);
    return out;
  }
  for (const vertex of decoded.vertices) {
    out.push(vertex.influences.length);
    for (const e of vertex.influences) out.push(e.bone, e.x, e.y, e.weight);
  }
  return out;
}

/**
 * Every mesh attachment in the skeleton, with where it lives: { skin, slot, attachment, mesh }.
 * Only `type: 'mesh'`. A linked mesh has no vertices of its own (it shares its parent's);
 * the legacy filter matched /mesh/i, so every linked mesh was reported as malformed.
 */
export function listMeshes(sk) {
  const out = [];
  for (const skin of skinsOf(sk ?? {})) {
    for (const [slot, set] of Object.entries(skin?.attachments ?? {})) {
      for (const [attachment, mesh] of Object.entries(set ?? {})) {
        if (mesh?.type === 'mesh') out.push({ skin: skin.name, slot, attachment, mesh });
      }
    }
  }
  return out;
}

/**
 * The weight report: measurement first, raw numbers only on request. A weighted mesh with
 * 300 vertices and 3 bones is 3600 numbers; nobody reads that, and it buries the two facts
 * actually asked: which bones drive this mesh, and is anything wrong with its weights.
 *
 * @param {object} sk parsed skeleton JSON
 * @param {{ slot?: string, attachment?: string, detail?: boolean }} [options]
 */
export function weightReport(sk, { slot, attachment, detail = false } = {}) {
  const boneNames = (sk?.bones ?? []).map(b => b.name);
  /** @type {Record<string, any>[]} */
  const rows = [];
  for (const m of listMeshes(sk)) {
    if ((slot && m.slot !== slot) || (attachment && m.attachment !== attachment)) continue;
    const where = `skins/${m.skin}/${m.slot}/${m.attachment}`;
    const base = { slot: m.slot, attachment: m.attachment, ...(m.skin && m.skin !== 'default' ? { skin: m.skin } : {}) };
    const decoded = decodeVertices(m.mesh);
    if (!decoded) {
      // Measured with spine-ts 4.2: such an array parses, then posing reads past it and throws.
      rows.push({ ...base, malformed: true, findings: [finding('fatal', 'weight-malformed', where,
        'The vertices array does not follow the weighted mesh format (an influence count runs past the end); it was not read.')] });
      continue;
    }
    if (!decoded.weighted) {
      rows.push({ ...base, weighted: false, vertexCount: decoded.vertices.length,
        note: 'Unweighted mesh: bound to its slot\'s bone only; it can be deformed but is not shared between bones.' });
      continue;
    }
    const influencesPerVertex = {};
    const shares = new Map(); // bone name -> { vertices, total, max }
    let drifted = 0, zero = 0, outOfRange = 0, crowded = 0, worstDrift = 0;
    for (const vertex of decoded.vertices) {
      const n = vertex.influences.length;
      influencesPerVertex[n] = (influencesPerVertex[n] ?? 0) + 1;
      if (n > MAX_GPU_INFLUENCES) crowded++;
      let sum = 0;
      for (const e of vertex.influences) {
        sum += e.weight;
        if (e.weight === 0) zero++;
        if (!Number.isInteger(e.bone) || e.bone < 0 || e.bone >= boneNames.length) { outOfRange++; continue; }
        const name = boneNames[e.bone];
        const rec = shares.get(name) ?? { vertices: 0, total: 0, max: 0 };
        rec.vertices++;
        rec.total += e.weight;
        rec.max = Math.max(rec.max, e.weight);
        shares.set(name, rec);
      }
      const drift = Math.abs(sum - 1);
      if (drift > SUM_TOLERANCE) { drifted++; worstDrift = Math.max(worstDrift, drift); }
    }
    // Only the bone index is fatal (measured: spine-ts parses it, then throws when posing).
    // The rest plays. Legacy called them invisible because "Spine normalizes on load"; the
    // official 4.2 runtime does not (measured: a lone 0.5 influence is drawn at half its
    // offset), so a drifted sum does show. All of them mislead the reader and hand a repair
    // tool the wrong base.
    const findings = [];
    if (outOfRange) {
      findings.push(finding('fatal', 'weight-bone-range', where,
        `${outOfRange} influence(s) point outside the skeleton's bones array (length ${boneNames.length}); the file may come from another rig whose indices were never remapped.`,
        { influences: outOfRange, boneCount: boneNames.length }));
    }
    if (drifted) {
      findings.push(finding('warn', 'weight-sum', where,
        `${drifted} vertex(es) have weights that do not sum to 1 (worst drift ${round(worstDrift, 3)}). The official runtime does not normalize on load, so such a vertex is drawn off its intended place, and the numbers mislead whoever reads them.`,
        { vertices: drifted, worstDrift: round(worstDrift, 3) }));
    }
    if (zero) {
      findings.push(finding('warn', 'weight-zero', where,
        `${zero} influence(s) have weight 0: the bone looks bound to the vertex but carries nothing (a dead link).`,
        { influences: zero }));
    }
    if (crowded) {
      findings.push(finding('warn', 'weight-many-bones', where,
        `${crowded} vertex(es) are bound to more than ${MAX_GPU_INFLUENCES} bones: valid, but some runtime or GPU paths drop the influences after the first ${MAX_GPU_INFLUENCES}.`,
        { vertices: crowded, limit: MAX_GPU_INFLUENCES }));
    }
    const bones = [...shares.entries()]
      .map(([bone, r]) => ({ bone, vertices: r.vertices, meanWeight: round(r.total / r.vertices),
        maxWeight: round(r.max), sharePercent: round(100 * r.total / decoded.vertices.length, 1) }))
      .sort((a, b) => b.sharePercent - a.sharePercent);
    /** @type {Record<string, any>} */
    const row = { ...base, weighted: true, vertexCount: decoded.vertices.length, influencesPerVertex, bones };
    if (findings.length) row.findings = findings;
    if (detail) {
      // Raw data is expensive: only on request, and as nested arrays rather than an object
      // per influence, which carries the same information at 3-4 times the size.
      row.raw = { vertices: decoded.vertices.map(vertex => vertex.influences.map(e =>
        [e.bone, round(e.x, 2), round(e.y, 2), round(e.weight)])) };
      row.rawNote = 'Each vertex is a list of [boneIndex, x, y, weight]; x/y are in the bone\'s space, not world.';
    }
    rows.push(row);
  }
  return {
    boneCount: boneNames.length,
    meshCount: rows.length,
    weightedCount: rows.filter(r => r.weighted).length,
    meshes: rows,
    ...(rows.length ? {} : { note: 'This skeleton has no mesh attachments, so it has no weights.' }),
  };
}

/**
 * Change detection for one value (an attachment's `vertices`): "is the base's geometry
 * still what it was when a repair was stamped?". Every party that compares stamps must call
 * this same function, or the stamps never match and every repair silently counts as "base
 * changed". FNV-1a over the JSON text, no crypto: it runs in the browser too, and the job
 * is change detection, not collision resistance. Byte-compatible with the legacy stamp,
 * so repairs written by the legacy studio keep matching.
 */
export function signature(value) {
  const s = JSON.stringify(value === undefined ? null : value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8) + '-' + s.length.toString(36);
}
