// What a posed skeleton draws, in draw order: triangles in world space with texture
// coordinates, tint, blend mode and clipping. The same list feeds the headless rasterizer
// (src/render) and the Canvas player (web/), so a frame looks the same in both.
//
// Pure and isomorphic.

import { regionVertices, meshVertices } from './pose.js';

const QUAD = [0, 1, 2, 2, 3, 0];

/** Texture coordinates of a region attachment, in the corner order of regionVertices. */
export function regionUVs(r) {
  if (r.degrees === 90) return Float64Array.of(r.u2, r.v2, r.u, r.v2, r.u, r.v, r.u2, r.v);
  return Float64Array.of(r.u, r.v2, r.u, r.v, r.u2, r.v, r.u2, r.v2);
}

/** Texture coordinates of a mesh, mapped into its atlas region. */
export function meshUVs(regionUVsIn, r) {
  const n = regionUVsIn.length;
  const out = new Float64Array(n);
  const W = r.pageWidth, H = r.pageHeight;
  let u = r.u, v = r.v, w, h;
  switch (r.degrees) {
    case 90:
      u -= (r.originalHeight - r.offsetY - r.height) / W; v -= (r.originalWidth - r.offsetX - r.width) / H;
      w = r.originalHeight / W; h = r.originalWidth / H;
      for (let i = 0; i < n; i += 2) { out[i] = u + regionUVsIn[i + 1] * w; out[i + 1] = v + (1 - regionUVsIn[i]) * h; }
      return out;
    case 180:
      u -= (r.originalWidth - r.offsetX - r.width) / W; v -= r.offsetY / H;
      w = r.originalWidth / W; h = r.originalHeight / H;
      for (let i = 0; i < n; i += 2) { out[i] = u + (1 - regionUVsIn[i]) * w; out[i + 1] = v + (1 - regionUVsIn[i + 1]) * h; }
      return out;
    case 270:
      u -= r.offsetY / W; v -= r.offsetX / H;
      w = r.originalHeight / W; h = r.originalWidth / H;
      for (let i = 0; i < n; i += 2) { out[i] = u + (1 - regionUVsIn[i + 1]) * w; out[i + 1] = v + regionUVsIn[i] * h; }
      return out;
    default:
      u -= r.offsetX / W; v -= (r.originalHeight - r.offsetY - r.height) / H;
      w = r.originalWidth / W; h = r.originalHeight / H;
      for (let i = 0; i < n; i += 2) { out[i] = u + regionUVsIn[i] * w; out[i + 1] = v + regionUVsIn[i + 1] * h; }
      return out;
  }
}

/**
 * @param {import('./pose.js').Pose} pose   posed and with updateWorld() done
 * @param {(path: string) => object|null} regionOf  texture source (src/engine/atlas.js)
 * @returns {{ draws: Array<{ slot: string, positions: Float64Array, uvs: Float64Array, indices: number[], page: string, pma: boolean,
 *   blend: number, light: {r:number,g:number,b:number,a:number}, dark: {r:number,g:number,b:number}|null, clip: Float64Array|null }>,
 *   missing: string[] }}
 */
export function collectDraws(pose, regionOf) {
  const draws = [];
  const missing = new Set();
  let clip = null, clipEnd = -1;
  const sc = pose.color;
  for (const slot of pose.drawOrder) {
    const att = slot.attachment;
    if (att?.type === 'clipping') {
      clip = meshVertices(pose, slot, att);
      clipEnd = att.endIndex ?? -1;
      continue;
    }
    if (att && (att.type === 'region' || att.type === 'mesh')) {
      const lc = slot.color, ac = att.color;
      const light = { r: sc.r * lc.r * ac.r, g: sc.g * lc.g * ac.g, b: sc.b * lc.b * ac.b, a: sc.a * lc.a * ac.a };
      const region = regionOf(att.path);
      if (!region) missing.add(att.path);
      else if (light.a > 0) {
        const bone = pose.bones[slot.data.bone];
        const positions = att.type === 'region' ? regionVertices(bone, att, region) : meshVertices(pose, slot, att);
        const uvs = att.type === 'region' ? regionUVs(region) : meshUVs(att.uvs, region);
        draws.push({ slot: slot.data.name, positions, uvs, indices: att.type === 'region' ? QUAD : Array.from(att.triangles),
          page: region.page, pma: !!region.pma, blend: slot.data.blend, light,
          dark: slot.dark ? { r: slot.dark.r, g: slot.dark.g, b: slot.dark.b } : null, clip });
      }
    }
    if (clip && slot.data.index === clipEnd) { clip = null; clipEnd = -1; }
  }
  return { draws, missing: [...missing] };
}

/** World-space box around every vertex drawn; null when nothing is drawn. */
export function boundsOf(drawLists) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const draws of drawLists) for (const d of draws) for (let i = 0; i < d.positions.length; i += 2) {
    const x = d.positions[i], y = d.positions[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

/** Triangulate a simple polygon (x, y pairs) by ear clipping; returns index triples. */
export function triangulate(polygon) {
  const n = polygon.length / 2;
  const idx = [...Array(n).keys()];
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += polygon[i * 2] * polygon[j * 2 + 1] - polygon[j * 2] * polygon[i * 2 + 1]; }
  if (area < 0) idx.reverse();
  const out = [];
  const cross = (a, b, c) => (polygon[b * 2] - polygon[a * 2]) * (polygon[c * 2 + 1] - polygon[a * 2 + 1]) - (polygon[b * 2 + 1] - polygon[a * 2 + 1]) * (polygon[c * 2] - polygon[a * 2]);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue;
      if (idx.some(p => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/**
 * Cut a draw's triangles to its clipping polygon (for the rasterizer; a Canvas clips with a
 * path instead). Each triangle is clipped against each convex triangle of the polygon.
 */
export function applyClip(draw) {
  if (!draw.clip) return draw;
  const poly = draw.clip;
  const clipTris = triangulate(poly);
  const positions = [], uvs = [], indices = [];
  const P = draw.positions, U = draw.uvs;
  for (let t = 0; t < draw.indices.length; t += 3) {
    const tri = [draw.indices[t], draw.indices[t + 1], draw.indices[t + 2]];
    const verts = tri.map(i => [P[i * 2], P[i * 2 + 1], U[i * 2], U[i * 2 + 1]]);
    for (let c = 0; c < clipTris.length; c += 3) {
      let shape = verts;
      const ci = [clipTris[c], clipTris[c + 1], clipTris[c + 2]];
      for (let e = 0; e < 3 && shape.length; e++) {
        const ax = poly[ci[e] * 2], ay = poly[ci[e] * 2 + 1], bx = poly[ci[(e + 1) % 3] * 2], by = poly[ci[(e + 1) % 3] * 2 + 1];
        const side = p => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
        const next = [];
        for (let k = 0; k < shape.length; k++) {
          const p = shape[k], q = shape[(k + 1) % shape.length];
          const sp = side(p), sq = side(q);
          if (sp >= 0) next.push(p);
          if ((sp >= 0) !== (sq >= 0)) {
            const f = sp / (sp - sq);
            next.push(p.map((v, j) => v + (q[j] - v) * f));
          }
        }
        shape = next;
      }
      if (shape.length < 3) continue;
      const base = positions.length / 2;
      for (const p of shape) { positions.push(p[0], p[1]); uvs.push(p[2], p[3]); }
      for (let k = 1; k + 1 < shape.length; k++) indices.push(base, base + k, base + k + 1);
    }
  }
  return { ...draw, positions: Float64Array.from(positions), uvs: Float64Array.from(uvs), indices, clip: null };
}
