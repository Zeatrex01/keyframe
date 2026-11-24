// A small SVG renderer for placeholder art: the subset an agent writes when it draws one part of a
// rig (shapes, paths, groups with transforms, solid and gradient fills, strokes, opacity), turned
// into straight-alpha RGBA pixels with anti-aliased edges.
//
// Not a browser: no text, filters, masks, clip paths, patterns, images, <use> or CSS selectors.
// What it does not draw it names in `skipped`, so the drawing never silently differs.
// Pure and isomorphic (the drawing board in the page can use it too).

import { StudioError } from '../shared/errors.js';

// ---------------------------------------------------------------- parsing

/** @typedef {{ tag: string, attrs: Record<string, string>, children: Node[] }} Node */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10))
  : ENTITIES[e.toLowerCase()] ?? m));

/** The element tree of an SVG document (text content is ignored). */
export function parseXml(text) {
  const src = String(text ?? '');
  /** @type {Node} */
  const doc = { tag: '#document', attrs: {}, children: [] };
  const stack = [doc];
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = tagRe.exec(src))) {
    if (m[1]) {
      const name = m[1];
      while (stack.length > 1 && stack[stack.length - 1].tag !== name) stack.pop();
      if (stack.length > 1) stack.pop();
    } else if (m[2]) {
      /** @type {Record<string, string>} */
      const attrs = {};
      for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      /** @type {Node} */
      const node = { tag: m[2].replace(/^svg:/, ''), attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
    }
  }
  const svg = doc.children.find(n => n.tag === 'svg');
  if (!svg) throw new StudioError('bad-svg', 'This is not an SVG: no <svg> element.', {});
  return svg;
}

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
const numbers = s => (String(s ?? '').match(NUM) ?? []).map(Number);

/** A length in user units; percentages are of `ref`. */
function length(value, ref = 0, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const s = String(value).trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return fallback;
  if (s.endsWith('%')) return n / 100 * ref;
  return n;
}

// ---------------------------------------------------------------- colour

const NAMED = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', lime: '00ff00', blue: '0000ff', yellow: 'ffff00',
  orange: 'ffa500', purple: '800080', pink: 'ffc0cb', brown: 'a52a2a', gray: '808080', grey: '808080', silver: 'c0c0c0',
  navy: '000080', teal: '008080', cyan: '00ffff', magenta: 'ff00ff', gold: 'ffd700', maroon: '800000', olive: '808000',
};

/** [r, g, b, a] in 0..1, or null for none. */
export function parseColor(value) {
  let s = String(value ?? '').trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;
  if (s === 'currentcolor') s = 'black';
  if (NAMED[s]) s = `#${NAMED[s]}`;
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const v = i => parseInt(h.slice(i, i + 2), 16) / 255;
    return [v(0), v(2), v(4), h.length === 8 ? v(6) : 1];
  }
  m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const channel = p => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 255);
    const alpha = parts[3] === undefined ? 1 : (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]));
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha].map(x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)));
  }
  return null;
}

// ---------------------------------------------------------------- transforms

/** @typedef {[number, number, number, number, number, number]} Matrix  a b c d e f, as in SVG */
const IDENTITY = /** @type {Matrix} */ ([1, 0, 0, 1, 0, 0]);
const mul = (m, n) => /** @type {Matrix} */ ([
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]);
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function parseTransform(text) {
  let m = IDENTITY;
  for (const [, fn, args] of String(text ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = numbers(args);
    let t = IDENTITY;
    if (fn === 'matrix' && a.length === 6) t = /** @type {Matrix} */ (a);
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = (a[0] ?? 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      t = [c, s, -s, c, 0, 0];
      if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan((a[0] ?? 0) * Math.PI / 180), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan((a[0] ?? 0) * Math.PI / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

// ---------------------------------------------------------------- geometry

/** Subpaths of a path's d, in user space: { points, closed }[]; curves flattened with `steps`. */
export function pathPoints(d, steps = 16) {
  const tokens = String(d ?? '').match(/[a-df-z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  const out = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0, prev = '';
  let cur = null;
  const num = () => Number(tokens[i++]);
  const start = () => { if (!cur) { cur = { points: [[x, y]], closed: false }; out.push(cur); } };
  const line = (nx, ny) => { start(); cur.points.push([nx, ny]); x = nx; y = ny; };
  const cubic = (x1, y1, x2, y2, nx, ny) => {
    start();
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      cur.points.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * nx, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ny]);
    }
    x = nx; y = ny;
  };
  const quad = (x1, y1, nx, ny) => cubic(x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y), nx + 2 / 3 * (x1 - nx), ny + 2 / 3 * (y1 - ny), nx, ny);
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') {
      if (cur) { cur.closed = true; x = sx; y = sy; cur = null; }
      prev = C; continue;
    }
    if (i >= tokens.length) break;
    if (/[a-z]/i.test(tokens[i])) continue; // a command without its numbers: skip it
    if (C === 'M') {
      x = num() + ox; y = num() + oy; sx = x; sy = y; cur = { points: [[x, y]], closed: false }; out.push(cur);
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') line(num() + ox, num() + oy);
    else if (C === 'H') line(num() + ox, y);
    else if (C === 'V') line(x, num() + oy);
    else if (C === 'C') {
      const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, nx = num() + ox, ny = num() + oy;
      cubic(x1, y1, x2, y2, nx, ny); cx = x2; cy = y2;
    } else if (C === 'S') {
      const x1 = prev === 'C' || prev === 'S' ? 2 * x - cx : x, y1 = prev === 'C' || prev === 'S' ? 2 * y - cy : y;
      const x2 = num() + ox, y2 = num() + oy, nx = num() + ox, ny = num() + oy;
      cubic(x1, y1, x2, y2, nx, ny); cx = x2; cy = y2;
    } else if (C === 'Q') {
      const x1 = num() + ox, y1 = num() + oy, nx = num() + ox, ny = num() + oy;
      quad(x1, y1, nx, ny); qx = x1; qy = y1;
    } else if (C === 'T') {
      const x1 = prev === 'Q' || prev === 'T' ? 2 * x - qx : x, y1 = prev === 'Q' || prev === 'T' ? 2 * y - qy : y;
      const nx = num() + ox, ny = num() + oy;
      quad(x1, y1, nx, ny); qx = x1; qy = y1;
    } else if (C === 'A') {
      const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = num(), sweep = num(), nx = num() + ox, ny = num() + oy;
      start();
      for (const p of arcPoints(x, y, rx, ry, rot, large, sweep, nx, ny, steps)) cur.points.push(p);
      x = nx; y = ny;
    } else { i++; }
    prev = C;
  }
  return out.filter(p => p.points.length > 1);
}

/** Points along an SVG elliptical arc (endpoint parametrisation, F.6.5 of the spec). */
function arcPoints(x1, y1, rx, ry, rotDeg, large, sweep, x2, y2, steps) {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x2, y2]];
  const phi = rotDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(dt) / (Math.PI / 2) * steps / 2));
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = t1 + dt * k / n;
    out.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return out;
}

const ellipse = (cx, cy, rx, ry, scale) => {
  const n = Math.max(16, Math.min(512, Math.ceil(2 * Math.PI * Math.max(rx, ry) * scale / 1.5))), points = [];
  for (let k = 0; k < n; k++) { const t = k / n * 2 * Math.PI; points.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
  return [{ points, closed: true }];
};

/** A shape element's subpaths in its own user space, or null when it is not a shape. */
function shapeOf(node, steps, viewport, scale) {
  const a = node.attrs, w = viewport[0], h = viewport[1], diag = Math.hypot(w, h) / Math.SQRT2;
  switch (node.tag) {
    case 'rect': {
      const x = length(a.x, w), y = length(a.y, h), rw = length(a.width, w), rh = length(a.height, h);
      if (!(rw > 0 && rh > 0)) return [];
      let rx = a.rx !== undefined ? length(a.rx, w) : a.ry !== undefined ? length(a.ry, h) : 0;
      let ry = a.ry !== undefined ? length(a.ry, h) : rx;
      rx = Math.min(rx, rw / 2); ry = Math.min(ry, rh / 2);
      if (!rx || !ry) return [{ points: [[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]], closed: true }];
      return pathPoints(`M${x + rx},${y}H${x + rw - rx}A${rx},${ry} 0 0 1 ${x + rw},${y + ry}V${y + rh - ry}A${rx},${ry} 0 0 1 ${x + rw - rx},${y + rh}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + rh - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`, steps);
    }
    case 'circle': { const r = length(a.r, diag); return r > 0 ? ellipse(length(a.cx, w), length(a.cy, h), r, r, scale) : []; }
    case 'ellipse': { const rx = length(a.rx, w), ry = length(a.ry, h); return rx > 0 && ry > 0 ? ellipse(length(a.cx, w), length(a.cy, h), rx, ry, scale) : []; }
    case 'line': return [{ points: [[length(a.x1, w), length(a.y1, h)], [length(a.x2, w), length(a.y2, h)]], closed: false }];
    case 'polyline': case 'polygon': {
      const n = numbers(a.points), points = [];
      for (let k = 0; k + 1 < n.length; k += 2) points.push([n[k], n[k + 1]]);
      return points.length > 1 ? [{ points, closed: node.tag === 'polygon' }] : [];
    }
    case 'path': return pathPoints(a.d, steps);
    default: return null;
  }
}

// ---------------------------------------------------------------- style

const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linejoin', 'stroke-linecap', 'color'];

function styleOf(node, parent) {
  const own = { ...node.attrs };
  for (const decl of String(node.attrs.style ?? '').split(';')) {
    const k = decl.indexOf(':');
    if (k > 0) own[decl.slice(0, k).trim()] = decl.slice(k + 1).trim();
  }
  const style = { ...parent, opacity: 1 };
  for (const key of INHERITED) if (own[key] !== undefined && own[key] !== 'inherit') style[key] = own[key];
  if (own.opacity !== undefined) style.opacity = Math.max(0, Math.min(1, parseFloat(own.opacity)));
  if (style.fill === 'currentColor' && style.color) style.fill = style.color;
  if (style.stroke === 'currentColor' && style.color) style.stroke = style.color;
  return style;
}

const ROOT_STYLE = { fill: 'black', stroke: 'none', 'stroke-width': '1', 'fill-opacity': '1', 'stroke-opacity': '1', 'fill-rule': 'nonzero' };

// ---------------------------------------------------------------- paint

function gradientOf(id, defs) {
  const node = defs.get(id);
  if (!node || (node.tag !== 'linearGradient' && node.tag !== 'radialGradient')) return null;
  let stopsNode = node, guard = 0;
  while (!stopsNode.children.some(c => c.tag === 'stop') && guard++ < 8) {
    const href = (stopsNode.attrs.href ?? stopsNode.attrs['xlink:href'] ?? '').replace(/^#/, '');
    if (!defs.get(href)) break;
    stopsNode = defs.get(href);
  }
  const stops = stopsNode.children.filter(c => c.tag === 'stop').map(s => {
    const color = parseColor(styleProp(s, 'stop-color') ?? s.attrs['stop-color'] ?? 'black') ?? [0, 0, 0, 0];
    const opacity = parseFloat(styleProp(s, 'stop-opacity') ?? s.attrs['stop-opacity'] ?? '1');
    const off = String(s.attrs.offset ?? '0');
    const offset = Math.max(0, Math.min(1, off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0));
    return { offset, color: [color[0], color[1], color[2], color[3] * (Number.isFinite(opacity) ? opacity : 1)] };
  });
  for (let k = 1; k < stops.length; k++) stops[k].offset = Math.max(stops[k].offset, stops[k - 1].offset);
  if (!stops.length) return null;
  const a = node.attrs, user = a.gradientUnits === 'userSpaceOnUse';
  return { kind: node.tag === 'linearGradient' ? 'linear' : 'radial', user, attrs: a, stops, transform: parseTransform(a.gradientTransform) };
}

function styleProp(node, key) {
  for (const decl of String(node.attrs.style ?? '').split(';')) {
    const k = decl.indexOf(':');
    if (k > 0 && decl.slice(0, k).trim() === key) return decl.slice(k + 1).trim();
  }
  return undefined;
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  return /** @type {Matrix} */ ([m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]);
}

/** A function from device pixel centre to [r, g, b, a] (straight), or a constant colour. */
function paintOf(value, alpha, defs, ctm, bbox, viewport) {
  const ref = String(value ?? '').match(/^url\(\s*#([^)]+?)\s*\)/);
  if (!ref) {
    const c = parseColor(value);
    return c ? { color: [c[0], c[1], c[2], c[3] * alpha] } : null;
  }
  const g = gradientOf(ref[1], defs);
  if (!g) {
    const fallback = parseColor(String(value).replace(/^url\([^)]*\)\s*/, ''));
    return fallback ? { color: [fallback[0], fallback[1], fallback[2], fallback[3] * alpha] } : null;
  }
  // Gradient space: user space (userSpaceOnUse) or the shape's bounding box, then gradientTransform.
  const unit = g.user ? IDENTITY : /** @type {Matrix} */ ([bbox[2] - bbox[0] || 1, 0, 0, bbox[3] - bbox[1] || 1, bbox[0], bbox[1]]);
  const toDevice = mul(mul(ctm, unit), g.transform);
  const back = invert(toDevice);
  if (!back) return null;
  const a = g.attrs, rw = g.user ? viewport[0] : 1, rh = g.user ? viewport[1] : 1;
  const L = (v, ref, d) => length(v, ref, d);
  let at;
  if (g.kind === 'linear') {
    const x1 = L(a.x1, rw, 0), y1 = L(a.y1, rh, 0), x2 = L(a.x2, rw, rw), y2 = L(a.y2, rh, 0);
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
    at = (x, y) => ((x - x1) * dx + (y - y1) * dy) / len2;
  } else {
    const cx = L(a.cx, rw, rw / 2), cy = L(a.cy, rh, rh / 2), r = L(a.r, Math.hypot(rw, rh) / Math.SQRT2, (g.user ? Math.hypot(rw, rh) / Math.SQRT2 : 1) / 2) || 1;
    at = (x, y) => Math.hypot(x - cx, y - cy) / r;
  }
  const stops = g.stops;
  return {
    at(px, py) {
      const [x, y] = apply(back, px, py);
      const t = Math.max(0, Math.min(1, at(x, y)));
      let k = 0;
      while (k < stops.length - 1 && stops[k + 1].offset < t) k++;
      const s0 = stops[k], s1 = stops[Math.min(k + 1, stops.length - 1)];
      const span = s1.offset - s0.offset, f = span > 0 ? Math.max(0, Math.min(1, (t - s0.offset) / span)) : (t >= s1.offset ? 1 : 0);
      const c = s0.color.map((v, i) => v + (s1.color[i] - v) * f);
      return [c[0], c[1], c[2], c[3] * alpha];
    },
  };
}

// ---------------------------------------------------------------- rasterising

const SUB = 4; // sub-scanlines per pixel row

/**
 * Coverage (0..1 per pixel) of polygons under a fill rule, with exact horizontal span coverage.
 * @param {number[][][]} polygons  closed rings of device points
 */
function coverage(polygons, width, height, evenOdd) {
  let minY = Infinity, maxY = -Infinity;
  const edges = [];
  for (const ring of polygons) {
    for (let k = 0; k < ring.length; k++) {
      const [x0, y0] = ring[k], [x1, y1] = ring[(k + 1) % ring.length];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? { x0, y0, x1, y1, dir: 1 } : { x0: x1, y0: y1, x1: x0, y1: y0, dir: -1 });
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
    }
  }
  const cov = new Float32Array(width * height);
  if (!edges.length) return { cov, y0: 0, y1: -1 };
  const top = Math.max(0, Math.floor(minY)), bottom = Math.min(height - 1, Math.ceil(maxY));
  const hits = [];
  for (let py = top; py <= bottom; py++) {
    for (let s = 0; s < SUB; s++) {
      const sy = py + (s + 0.5) / SUB;
      hits.length = 0;
      for (const e of edges) {
        if (sy < e.y0 || sy >= e.y1) continue;
        hits.push({ x: e.x0 + (sy - e.y0) / (e.y1 - e.y0) * (e.x1 - e.x0), dir: e.dir });
      }
      if (hits.length < 2) continue;
      hits.sort((p, q) => p.x - q.x);
      let wind = 0;
      for (let k = 0; k < hits.length - 1; k++) {
        wind += evenOdd ? 1 : hits[k].dir;
        const inside = evenOdd ? wind % 2 === 1 : wind !== 0;
        if (!inside) continue;
        const xa = Math.max(0, hits[k].x), xb = Math.min(width, hits[k + 1].x);
        if (xb <= xa) continue;
        const row = py * width;
        const ia = Math.floor(xa), ib = Math.min(width - 1, Math.floor(xb));
        if (ia === ib) { cov[row + ia] += (xb - xa) / SUB; continue; }
        cov[row + ia] += (ia + 1 - xa) / SUB;
        for (let x = ia + 1; x < ib; x++) cov[row + x] += 1 / SUB;
        if (ib < width) cov[row + ib] += (xb - ib) / SUB;
      }
    }
  }
  return { cov, y0: top, y1: bottom };
}

/** Composite a paint through a coverage mask, source-over, into a premultiplied float canvas. */
function composite(canvas, width, mask, paint) {
  const { cov, y0, y1 } = mask;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x, c = Math.min(1, cov[i]);
      if (c <= 0) continue;
      const col = paint.color ?? paint.at(x + 0.5, y + 0.5);
      const a = col[3] * c;
      if (a <= 0) continue;
      const o = i * 4, keep = 1 - a;
      canvas[o] = col[0] * a + canvas[o] * keep;
      canvas[o + 1] = col[1] * a + canvas[o + 1] * keep;
      canvas[o + 2] = col[2] * a + canvas[o + 2] * keep;
      canvas[o + 3] = a + canvas[o + 3] * keep;
    }
  }
}

const signedArea = ring => { let s = 0; for (let k = 0; k < ring.length; k++) { const [x0, y0] = ring[k], [x1, y1] = ring[(k + 1) % ring.length]; s += x0 * y1 - x1 * y0; } return s / 2; };
const positive = ring => (signedArea(ring) < 0 ? ring.slice().reverse() : ring);

/** A stroke as rings that union under nonzero: a quad per segment, a disc per joint and round cap. */
function strokeRings(points, closed, halfWidth, cap) {
  const rings = [];
  const n = points.length, segs = closed ? n : n - 1;
  const disc = ([x, y]) => {
    const k = Math.max(8, Math.ceil(halfWidth * 1.5)), ring = [];
    for (let j = 0; j < k; j++) { const t = j / k * 2 * Math.PI; ring.push([x + halfWidth * Math.cos(t), y + halfWidth * Math.sin(t)]); }
    return ring;
  };
  for (let k = 0; k < segs; k++) {
    let [x0, y0] = points[k], [x1, y1] = points[(k + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (!len) continue;
    const nx = -(y1 - y0) / len * halfWidth, ny = (x1 - x0) / len * halfWidth;
    if (!closed && cap === 'square') {
      const ux = (x1 - x0) / len * halfWidth, uy = (y1 - y0) / len * halfWidth;
      if (k === 0) { x0 -= ux; y0 -= uy; }
      if (k === segs - 1) { x1 += ux; y1 += uy; }
    }
    rings.push(positive([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]));
  }
  const joints = closed ? points : points.slice(1, -1);
  for (const p of joints) rings.push(positive(disc(p)));
  if (!closed && cap === 'round') { rings.push(positive(disc(points[0]))); rings.push(positive(disc(points[n - 1]))); }
  return rings;
}

/**
 * Draw an SVG into RGBA pixels.
 * @param {string} text  the SVG document
 * @param {{ scale?: number, width?: number, height?: number }} [options]  pixels per user unit, or a target size
 * @returns {{ width: number, height: number, data: Uint8Array, viewBox: number[], skipped: string[] }}
 */
export function rasterizeSvg(text, options = {}) {
  const svg = parseXml(text);
  const vb = numbers(svg.attrs.viewBox);
  const w = length(svg.attrs.width, 0, vb[2] ?? 0), h = length(svg.attrs.height, 0, vb[3] ?? 0);
  const viewBox = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb : [0, 0, w || 100, h || 100];
  const scale = options.scale ?? (options.width ? options.width / viewBox[2] : options.height ? options.height / viewBox[3] : 1);
  const width = Math.max(1, Math.min(4096, Math.round(options.width ?? viewBox[2] * scale)));
  const height = Math.max(1, Math.min(4096, Math.round(options.height ?? viewBox[3] * scale)));
  const sx = width / viewBox[2], sy = height / viewBox[3];
  const root = /** @type {Matrix} */ ([sx, 0, 0, sy, -viewBox[0] * sx, -viewBox[1] * sy]);
  const defs = new Map();
  const index = node => { if (node.attrs.id) defs.set(node.attrs.id, node); node.children.forEach(index); };
  index(svg);
  const canvas = new Float32Array(width * height * 4);
  const skipped = new Set();
  const viewport = [viewBox[2], viewBox[3]];

  const draw = (node, ctm, parentStyle, groupAlpha) => {
    if (node.attrs.display === 'none' || node.attrs.visibility === 'hidden' || styleProp(node, 'display') === 'none') return;
    const style = styleOf(node, parentStyle);
    const m = node.attrs.transform ? mul(ctm, parseTransform(node.attrs.transform)) : ctm;
    const alpha = groupAlpha * style.opacity;
    if (node.tag === 'g' || node.tag === 'svg' || node.tag === 'a') { for (const c of node.children) draw(c, m, style, alpha); return; }
    if (['defs', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc', 'metadata', 'style'].includes(node.tag)) return;
    if (node.attrs['clip-path'] || node.attrs.mask || node.attrs.filter) skipped.add(`${node.tag}: clip-path, mask and filter are ignored`);
    const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
    const steps = Math.max(12, Math.min(64, Math.ceil(Math.sqrt(det) * 12)));
    const shape = shapeOf(node, steps, viewport, Math.sqrt(det));
    if (shape === null) { skipped.add(`<${node.tag}> is not drawn`); return; }
    if (!shape.length) return;
    let bbox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const sub of shape) for (const [x, y] of sub.points) bbox = [Math.min(bbox[0], x), Math.min(bbox[1], y), Math.max(bbox[2], x), Math.max(bbox[3], y)];
    const device = shape.map(sub => ({ points: sub.points.map(([x, y]) => apply(m, x, y)), closed: sub.closed }));
    const fill = node.tag === 'line' ? null : paintOf(style.fill, alpha * parseFloat(style['fill-opacity']), defs, m, bbox, viewport);
    if (fill) composite(canvas, width, coverage(device.map(s => s.points), width, height, style['fill-rule'] === 'evenodd'), fill);
    const stroke = paintOf(style.stroke, alpha * parseFloat(style['stroke-opacity']), defs, m, bbox, viewport);
    const strokeWidth = length(style['stroke-width'], Math.hypot(...viewport) / Math.SQRT2, 1) * Math.sqrt(det);
    if (stroke && strokeWidth > 0) {
      const cap = style['stroke-linecap'] ?? 'butt';
      const rings = device.flatMap(s => strokeRings(s.points, s.closed, strokeWidth / 2, cap));
      composite(canvas, width, coverage(rings, width, height, false), stroke);
    }
  };
  for (const c of svg.children) draw(c, root, styleOf(svg, ROOT_STYLE), 1);

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = canvas[i * 4 + 3];
    if (a <= 0) continue;
    data[i * 4] = Math.round(Math.min(1, canvas[i * 4] / a) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, canvas[i * 4 + 1] / a) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, canvas[i * 4 + 2] / a) * 255);
    data[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
  }
  return { width, height, data, viewBox, skipped: [...skipped] };
}

/** An SVG's size in user units (its viewBox, or width and height). */
export function svgSize(text) {
  const svg = parseXml(text);
  const vb = numbers(svg.attrs.viewBox);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  const w = length(svg.attrs.width, 0, 0), h = length(svg.attrs.height, 0, 0);
  if (!(w > 0 && h > 0)) throw new StudioError('bad-svg', 'An SVG part needs a viewBox (or width and height).', {});
  return { width: w, height: h };
}
