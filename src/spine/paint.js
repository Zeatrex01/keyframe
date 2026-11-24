// Weight painting: bind a mesh to a chain of bones, with smooth falloff between them.
//
// Since 2026-11-12 painting weights is the studio's job, so a body, a tail or a
// ribbon can bend instead of being cut into rigid pieces.
//
// What it does, in order:
//   1. Finds the attachment. A region can be turned into a grid mesh first (`grid: [cols, rows]`):
//      the picture is the same, it just gets vertices that can bend.
//   2. Takes every vertex to the world, in the setup pose.
//   3. Gives each vertex a raw weight per bone from its distance to that bone's segment
//      (origin to tip): w = 1 / (d + soft)^falloff. Near a joint two bones share it; far from
//      every bone but one, that bone owns it.
//   4. Smooths the weights over the mesh's own edges (each pass mixes a vertex with its
//      neighbours), so the bend spreads over a band instead of folding at one row of vertices.
//   5. Keeps the strongest `maxInfluences` per vertex, drops crumbs, sums each vertex to 1.
//   6. Writes each influence's position in its bone's own space, derived from the vertex's world
//      point. Because every influence points at the same world point and the weights sum to 1,
//      the setup pose is unchanged by construction; this is measured and refused if not.
//
// Pure: the caller passes the setup-pose bones (poseSetup from the runtime).

import { StudioError } from '../shared/errors.js';
import { skinsOf } from './check.js';
import { decodeVertices, encodeVertices, isWeighted, signature, MAX_GPU_INFLUENCES } from './weights.js';
import { deformAnimation } from './weight-repair.js';

export const PAINT_MARKER = '_kfPaint';
const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

/** The attachment a request names, by skin, slot and attachment; ambiguity is refused. */
export function findAttachment(sk, { skin, slot, attachment }) {
  if (!slot || !attachment) throw new StudioError('bad-argument', 'Name the slot and the attachment to paint.');
  const found = [];
  for (const s of skinsOf(sk)) {
    if (skin && s.name !== skin) continue;
    const a = s.attachments?.[slot]?.[attachment];
    if (a) found.push({ skin: s.name, slot, attachment, value: a });
  }
  if (!found.length) throw new StudioError('attachment-not-found', `No attachment "${attachment}" in slot "${slot}"${skin ? ` of skin "${skin}"` : ''}.`, { slot, attachment, skin: skin ?? null });
  if (found.length > 1) throw new StudioError('attachment-ambiguous', `"${slot}/${attachment}" exists in ${found.length} skins (${found.map(f => f.skin).join(', ')}); name the skin.`, { skins: found.map(f => f.skin) });
  return found[0];
}

const worldOf = (bone, x, y) => ({ x: bone.matrix.a * x + bone.matrix.b * y + bone.worldX, y: bone.matrix.c * x + bone.matrix.d * y + bone.worldY });
function toBone(bone, p) {
  const { a, b, c, d } = bone.matrix, det = a * d - b * c;
  if (!(Math.abs(det) > 1e-12)) throw new StudioError('degenerate-bone', `Bone "${bone.name}" has a zero scale in the setup pose; a position in its space is undefined.`, { bone: bone.name });
  const dx = p.x - bone.worldX, dy = p.y - bone.worldY;
  return { x: (d * dx - b * dy) / det, y: (a * dy - c * dx) / det };
}

/**
 * A region as a grid mesh: (cols+1) x (rows+1) vertices, the hull first in order around the edge
 * (Spine requires it), then the inner vertices. Local positions in the slot bone's space, exactly
 * where the region's corners and inner points are drawn.
 */
export function gridFromRegion(region, cols, rows) {
  const w = region.width, h = region.height;
  if (!(w > 0 && h > 0)) throw new StudioError('bad-region', 'The region has no width or height to grid.');
  const sx = region.scaleX ?? 1, sy = region.scaleY ?? 1, r = (region.rotation ?? 0) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const local = (u, v) => { const x = (u - 0.5) * w * sx, y = (0.5 - v) * h * sy; return { x: (region.x ?? 0) + x * cos - y * sin, y: (region.y ?? 0) + x * sin + y * cos }; };
  const key = (i, j) => `${i},${j}`, order = [];
  for (let i = 0; i <= cols; i++) order.push([i, 0]);
  for (let j = 1; j <= rows; j++) order.push([cols, j]);
  for (let i = cols - 1; i >= 0; i--) order.push([i, rows]);
  for (let j = rows - 1; j >= 1; j--) order.push([0, j]);
  const hull = order.length;
  for (let j = 1; j < rows; j++) for (let i = 1; i < cols; i++) order.push([i, j]);
  const index = new Map(order.map(([i, j], k) => [key(i, j), k]));
  const uvs = [], points = [], triangles = [];
  for (const [i, j] of order) { const u = i / cols, v = j / rows; uvs.push(round(u, 6), round(v, 6)); points.push(local(u, v)); }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = index.get(key(i, j)), b = index.get(key(i + 1, j)), c = index.get(key(i + 1, j + 1)), d = index.get(key(i, j + 1));
    triangles.push(a, b, c, a, c, d);
  }
  return { uvs, points, triangles, hull };
}

// Distance from a point to a bone's segment in the world (a bone without length is a point).
function segmentDistance(p, s) {
  const dx = s.tx - s.x, dy = s.ty - s.y, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (s.x + t * dx), p.y - (s.y + t * dy));
}

/**
 * Paint one attachment. Returns the new attachment and a report; the skeleton is not touched.
 * @param {object} sk parsed skeleton
 * @param {object} request { skin?, slot, attachment, bones: string[], grid?: [cols, rows], falloff?, smooth?, maxInfluences? }
 * @param {{ setupBones: Array }} options the bones of poseSetup(data), in the skeleton's order
 */
export function paintWeights(sk, request, { setupBones }) {
  const { bones: names, grid, falloff = 2.5, smooth = 3, maxInfluences = 3 } = request ?? {};
  if (!Array.isArray(names) || !names.length) throw new StudioError('bad-argument', '`bones` lists the bones the mesh bends with (at least one), usually a chain from the root of the part to its tip.');
  if (!(falloff >= 0.5 && falloff <= 8)) throw new StudioError('bad-argument', 'falloff is 0.5 (soft, wide blend) to 8 (sharp, short blend); default 2.5.');
  if (!(Number.isInteger(smooth) && smooth >= 0 && smooth <= 20)) throw new StudioError('bad-argument', 'smooth is a number of passes, 0 to 20; default 3.');
  if (!(Number.isInteger(maxInfluences) && maxInfluences >= 1 && maxInfluences <= MAX_GPU_INFLUENCES)) throw new StudioError('bad-argument', `maxInfluences is 1 to ${MAX_GPU_INFLUENCES} (what mobile GPUs skin); default 3.`);
  const boneIndex = new Map(sk.bones.map((b, i) => [b.name, i]));
  const chosen = names.map(name => { if (!boneIndex.has(name)) throw new StudioError('unknown-bone', `No bone named "${name}".`, { bone: name }); return boneIndex.get(name); });
  if (new Set(chosen).size !== chosen.length) throw new StudioError('bad-argument', 'A bone is listed twice in `bones`.');
  const sameRig = Array.isArray(setupBones) && setupBones.length === sk.bones.length && setupBones.every((b, i) => b?.name === sk.bones[i].name);
  if (!sameRig) throw new StudioError('bone-world-mismatch', 'setupBones must be the setup pose of this skeleton, bone for bone.');

  const target = findAttachment(sk, request);
  const where = { skin: target.skin, slot: target.slot, attachment: target.attachment };
  const type = target.value.type ?? 'region';
  if (type !== 'mesh' && type !== 'region') throw new StudioError('not-paintable', `${target.slot}/${target.attachment} is a ${type}; only meshes and regions (turned into a grid) can be painted.`, where);
  if (type === 'region' && !grid) throw new StudioError('needs-grid', `${target.slot}/${target.attachment} is a flat image (region). Pass grid: [columns, rows] to turn it into a mesh that can bend; more cells along the bend give a smoother curve.`, where);
  if (type === 'mesh' && grid) throw new StudioError('bad-argument', `${target.slot}/${target.attachment} is already a mesh; its own vertices are painted, grid applies to regions only.`, where);
  if (grid && !(Array.isArray(grid) && grid.length === 2 && grid.every(n => Number.isInteger(n) && n >= 1 && n <= 40))) throw new StudioError('bad-argument', 'grid is [columns, rows], each 1 to 40.');
  if (type === 'mesh') {
    const animation = deformAnimation(sk, { skin: target.skin, slot: target.slot, attachment: target.attachment });
    if (animation) throw new StudioError('mesh-has-deform', `${target.slot}/${target.attachment} has deform keys (animation "${animation}"); they are offsets against the current vertices and would be wrong after painting.`, { ...where, animation });
  }
  const slotData = sk.slots.find(s => s.name === target.slot);
  if (!slotData) throw new StudioError('unknown-slot', `No slot named "${target.slot}".`, where);
  const slotBone = setupBones[boneIndex.get(slotData.bone)];

  // 1-2. the vertices in the world, and the mesh they belong to
  let mesh, world;
  if (type === 'region') {
    const g = gridFromRegion(target.value, grid[0], grid[1]);
    world = g.points.map(p => worldOf(slotBone, p.x, p.y));
    const { x, y, rotation, scaleX, scaleY, width, height, ...rest } = target.value;
    mesh = { ...rest, type: 'mesh', uvs: g.uvs, triangles: g.triangles, hull: g.hull, width, height };
  } else {
    const decoded = decodeVertices(target.value);
    if (!decoded) throw new StudioError('mesh-malformed', `The vertices of ${target.slot}/${target.attachment} cannot be decoded.`, where);
    world = decoded.weighted
      ? decoded.vertices.map(v => { const s = v.influences.reduce((a, e) => a + e.weight, 0); let x = 0, y = 0; for (const e of v.influences) { const p = worldOf(setupBones[e.bone], e.x, e.y); x += e.weight * p.x; y += e.weight * p.y; } return { x: x / s, y: y / s }; })
      : decoded.vertices.map(v => worldOf(slotBone, v.x, v.y));
    mesh = structuredClone(target.value);
  }

  // 3. raw weights from the distance to each bone's segment
  const segments = chosen.map(i => { const b = setupBones[i], len = sk.bones[i].length ?? 0; return { x: b.worldX, y: b.worldY, tx: b.worldX + b.matrix.a * len, ty: b.worldY + b.matrix.c * len, len }; });
  const lengths = segments.map(s => s.len).filter(l => l > 0);
  const span = Math.max(...world.map(p => p.x)) - Math.min(...world.map(p => p.x)) + Math.max(...world.map(p => p.y)) - Math.min(...world.map(p => p.y));
  const soft = Math.max(1, 0.15 * (lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : span / 4));
  let weights = world.map(p => { const raw = segments.map(s => 1 / (segmentDistance(p, s) + soft) ** falloff), sum = raw.reduce((a, b) => a + b, 0); return raw.map(w => w / sum); });

  // 4. smoothing over the mesh's own edges
  const neighbours = world.map(() => new Set());
  const tri = mesh.triangles;
  for (let t = 0; t + 2 < tri.length; t += 3) for (const [a, b] of [[tri[t], tri[t + 1]], [tri[t + 1], tri[t + 2]], [tri[t + 2], tri[t]]]) { neighbours[a].add(b); neighbours[b].add(a); }
  for (let pass = 0; pass < smooth; pass++) {
    weights = weights.map((w, v) => { const n = [...neighbours[v]]; if (!n.length) return w; return w.map((value, k) => 0.5 * value + 0.5 * n.reduce((a, u) => a + weights[u][k], 0) / n.length); });
  }

  // 5. the strongest few, no crumbs, each vertex sums to 1
  const influences = weights.map(w => {
    let kept = w.map((weight, k) => ({ k, weight })).sort((a, b) => b.weight - a.weight).slice(0, maxInfluences).filter((e, i) => i === 0 || e.weight >= 0.01);
    const sum = kept.reduce((a, e) => a + e.weight, 0);
    kept = kept.map(e => ({ k: e.k, weight: round(e.weight / sum, 5) }));
    const drift = 1 - kept.reduce((a, e) => a + e.weight, 0);
    kept[0].weight = round(kept[0].weight + drift, 5);
    return kept;
  });

  // 6. each influence's position in its bone's space, from the vertex's world point
  const decodedOut = { weighted: true, vertices: influences.map((list, v) => ({ influences: list.map(e => { const bone = setupBones[chosen[e.k]], p = toBone(bone, world[v]); return { bone: chosen[e.k], x: round(p.x), y: round(p.y), weight: e.weight }; }) })) };
  mesh.vertices = encodeVertices(decodedOut);
  if (!isWeighted(mesh)) throw new StudioError('invariant-violation', 'The painted mesh did not come out in the weighted form; nothing was produced.', where);

  // the proof: the setup pose did not move
  let drift = 0;
  decodedOut.vertices.forEach((v, i) => { let x = 0, y = 0; for (const e of v.influences) { const p = worldOf(setupBones[e.bone], e.x, e.y); x += e.weight * p.x; y += e.weight * p.y; } drift = Math.max(drift, Math.hypot(x - world[i].x, y - world[i].y)); });
  if (drift > 0.01) throw new StudioError('setup-moved', `Painting would move a vertex ${drift.toFixed(3)} units in the setup pose; nothing was produced.`, { ...where, drift });

  const owner = names.map((name, k) => ({ bone: name, vertices: influences.filter(list => list[0].k === k).length, share: round(influences.reduce((a, list) => a + (list.find(e => e.k === k)?.weight ?? 0), 0) / influences.length, 3) }));
  const blended = influences.filter(list => list.length > 1).length;
  return {
    target: where,
    attachment: mesh,
    sourceSignature: signature(target.value),
    report: {
      ...where,
      ...(type === 'region' ? { madeMesh: { grid, vertices: world.length, triangles: mesh.triangles.length / 3 } } : { vertices: world.length }),
      bones: owner,
      blendedVertices: blended,
      maxInfluences: Math.max(...influences.map(l => l.length)),
      setupDrift: round(drift, 5),
      settings: { falloff, smooth, maxInfluences },
      ...(owner.some(o => o.share === 0) ? { note: `Some listed bones carry nothing (${owner.filter(o => o.share === 0).map(o => o.bone).join(', ')}): they are far from every vertex. Check the bones sit inside the art.` } : {}),
    },
  };
}

/**
 * The painted attachment put in place, with a record so a later rebuild can carry it (or let the base win).
 * @param {object} sk
 * @param {object} result
 * @param {{ baseSkeleton?: object, baseName?: string | null, time?: string | null }} [options]
 */
export function applyPaint(sk, result, { baseSkeleton, baseName = null, time = null } = {}) {
  const out = structuredClone(sk);
  const { skin, slot, attachment } = result.target;
  const place = skinsOf(out).find(s => s.name === skin)?.attachments?.[slot];
  if (!place?.[attachment] || signature(place[attachment]) !== result.sourceSignature) throw new StudioError('stale-paint', `${slot}/${attachment} is not the attachment this paint was computed from; paint again.`, result.target);
  place[attachment] = result.attachment;
  let baseSignature = null;
  if (baseSkeleton) { try { baseSignature = signature(findAttachment(baseSkeleton, result.target).value); } catch { baseSignature = null; } }
  out[PAINT_MARKER] = { ...(out[PAINT_MARKER] ?? {}), [`${skin}/${slot}/${attachment}`]: { baseSignature, base: baseName, bones: result.report.bones.map(b => b.bone), time } };
  return out;
}

/** Carry painted attachments from the previous delivery onto a skeleton rebuilt from the base. */
export function carryPaints(out, previous) {
  const kept = [], dropped = [], records = previous?.[PAINT_MARKER];
  if (!records || typeof records !== 'object') return { kept, dropped };
  const carried = {};
  for (const [key, record] of Object.entries(records)) {
    const [skin, slot, ...rest] = key.split('/'), attachment = rest.join('/');
    const painted = skinsOf(previous).find(s => s.name === skin)?.attachments?.[slot]?.[attachment];
    const fromBase = skinsOf(out).find(s => s.name === skin)?.attachments?.[slot];
    if (!painted || !fromBase?.[attachment]) { dropped.push({ attachment: key, reason: painted ? 'missing-in-base' : 'missing-in-previous' }); continue; }
    if (record?.baseSignature && record.baseSignature !== signature(fromBase[attachment])) { dropped.push({ attachment: key, reason: 'base-changed' }); continue; }
    fromBase[attachment] = structuredClone(painted);
    carried[key] = record;
    kept.push(key);
  }
  if (kept.length) out[PAINT_MARKER] = { ...(out[PAINT_MARKER] ?? {}), ...carried };
  return { kept, dropped };
}
