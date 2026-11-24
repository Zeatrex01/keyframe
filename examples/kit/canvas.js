// A small vector painter for the example art: the part of the Canvas 2D API the kit draws with,
// in plain JavaScript, so the examples rebuild without a browser. The studio's own PNG encoder
// (src/render/png.js) writes the result.
//
//   const g = createContext(200, 120, 2);   // logical size, pixel density
//   g.beginPath(); g.roundRect(10, 10, 180, 100, 24); g.fillStyle = g.linear(0, 10, 0, 110, ['#ffd95a', '#f0a01c']); g.fill();
//   g.lineWidth = 6; g.strokeStyle = '#2b1b4d'; g.stroke();
//   const image = g.toImage();               // { width, height, data } straight RGBA, for encodePng
//
// Supported: paths (moveTo, lineTo, quadraticCurveTo, bezierCurveTo, arc, ellipse, rect,
// roundRect, closePath), fill (nonzero or evenodd), stroke (round joins and caps), clip,
// save / restore, translate / rotate / scale, globalAlpha, fillRect, solid colours
// (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()) and linear / radial gradients.
// Coverage is computed per pixel on 5 sub-scanlines with exact horizontal span area, so edges
// are anti-aliased. Everything is premultiplied float RGBA until toImage().

const SUB = 5;

/** Parse a CSS colour into straight [r, g, b, a] in 0..1. */
export function parseColor(text) {
  const s = String(text).trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    const n = i => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map(v => parseFloat(v));
    return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
  }
  if (s === 'white') return [1, 1, 1, 1];
  if (s === 'black') return [0, 0, 0, 1];
  if (s === 'transparent') return [0, 0, 0, 0];
  throw new Error(`canvas: unknown colour "${text}"`);
}

const premul = ([r, g, b, a]) => [r * a, g * a, b * a, a];

function gradient(kind, geometry, stops) {
  const list = (Array.isArray(stops) ? stops.map((c, i) => [i / Math.max(1, stops.length - 1), c]) : []);
  const g = { kind, geometry, stops: list.map(([o, c]) => [o, premul(parseColor(c))]),
    addColorStop(offset, color) { this.stops.push([offset, premul(parseColor(color))]); this.stops.sort((a, b) => a[0] - b[0]); return this; } };
  return g;
}

function stopColor(stops, t, out) {
  if (t <= stops[0][0]) { out.set(stops[0][1]); return; }
  const last = stops[stops.length - 1];
  if (t >= last[0]) { out.set(last[1]); return; }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [o0, c0] = stops[i - 1], [o1, c1] = stops[i], k = (t - o0) / Math.max(1e-9, o1 - o0);
      for (let c = 0; c < 4; c++) out[c] = c0[c] + (c1[c] - c0[c]) * k;
      return;
    }
  }
}

const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const invert = m => { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };

/** Coverage (0..1 per pixel) of polygons in device space. */
function coverage(polys, W, H, rule) {
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i += 2) {
      const j = (i + 2) % poly.length;
      const x0 = poly[i], y0 = poly[i + 1], x1 = poly[j], y1 = poly[j + 1];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
    }
  }
  const cov = new Float32Array(W * H);
  cov.box = [0, 0, -1, -1];
  if (!edges.length) return cov;
  let minX = Infinity, maxX = -Infinity;
  for (const E of edges) { minX = Math.min(minX, E[0], E[2]); maxX = Math.max(maxX, E[0], E[2]); }
  edges.sort((a, b) => a[1] - b[1]);
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
  const hits = [];
  for (let py = y0; py <= y1; py++) {
    const row = py * W;
    for (let s = 0; s < SUB; s++) {
      const y = py + (s + 0.5) / SUB;
      hits.length = 0;
      for (let e = 0; e < edges.length; e++) {
        const E = edges[e];
        if (E[1] > y) break;
        if (y >= E[3]) continue;
        hits.push(E[0] + (y - E[1]) * (E[2] - E[0]) / (E[3] - E[1]), E[4]);
      }
      if (!hits.length) continue;
      const order = [];
      for (let i = 0; i < hits.length; i += 2) order.push(i);
      order.sort((a, b) => hits[a] - hits[b]);
      let wind = 0;
      for (let k = 0; k < order.length - 1; k++) {
        wind += hits[order[k] + 1];
        const inside = rule === 'evenodd' ? (wind & 1) !== 0 : wind !== 0;
        if (!inside) continue;
        let a = hits[order[k]], b = hits[order[k + 1]];
        if (b <= 0 || a >= W) continue;
        a = Math.max(0, a); b = Math.min(W, b);
        const ia = Math.floor(a), ib = Math.min(W - 1, Math.floor(b));
        if (ia === ib) { cov[row + ia] += (b - a) / SUB; continue; }
        cov[row + ia] += (ia + 1 - a) / SUB;
        for (let i = ia + 1; i < ib; i++) cov[row + i] += 1 / SUB;
        if (ib < W) cov[row + ib] += (b - ib) / SUB;
      }
    }
  }
  for (let i = 0; i < cov.length; i++) if (cov[i] > 1) cov[i] = 1;
  cov.box = [Math.max(0, Math.floor(minX)), y0, Math.min(W - 1, Math.ceil(maxX)), y1];
  return cov;
}

const signedArea = p => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a; };
const oriented = p => { if (signedArea(p) >= 0) return p; const q = []; for (let i = p.length - 2; i >= 0; i -= 2) q.push(p[i], p[i + 1]); return q; };
function disc(x, y, r) { const n = Math.max(12, Math.min(48, Math.ceil(r * 2))); const p = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; p.push(x + Math.cos(a) * r, y + Math.sin(a) * r); } return p; }

/**
 * @param {number} width  logical width
 * @param {number} height logical height
 * @param {number} [density=1] device pixels per logical unit
 */
export function createContext(width, height, density = 1) {
  const W = Math.max(1, Math.round(width * density)), H = Math.max(1, Math.round(height * density));
  const data = new Float32Array(W * H * 4);
  let state = { m: [density, 0, 0, density, 0, 0], clip: null, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1 };
  const stack = [];
  let subpaths = [], current = null, pen = null;

  const tx = (x, y) => { const m = state.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };
  const scaleOf = () => Math.sqrt(Math.abs(state.m[0] * state.m[3] - state.m[1] * state.m[2]));
  const add = (x, y) => { const [X, Y] = tx(x, y); if (!current) { current = { points: [], closed: false }; subpaths.push(current); } current.points.push(X, Y); pen = [x, y]; };
  const segments = len => Math.max(6, Math.min(96, Math.ceil(len * scaleOf() / 3)));

  function paintAt(style, px, py, out) {
    if (typeof style === 'string') { out.set(premul(parseColor(style))); return; }
    const inv = invert(style.m), x = inv[0] * px + inv[2] * py + inv[4], y = inv[1] * px + inv[3] * py + inv[5];
    let t;
    if (style.kind === 'linear') {
      const [x0, y0, x1, y1] = style.geometry, dx = x1 - x0, dy = y1 - y0;
      t = ((x - x0) * dx + (y - y0) * dy) / Math.max(1e-9, dx * dx + dy * dy);
    } else {
      const [, , r0, x1, y1, r1] = style.geometry;
      t = (Math.hypot(x - x1, y - y1) - r0) / Math.max(1e-9, r1 - r0);
    }
    stopColor(style.stops, t, out);
  }

  function composite(cov, style) {
    const color = new Float32Array(4);
    const solid = typeof style === 'string' ? premul(parseColor(style)) : null;
    const alpha = state.globalAlpha, mask = state.clip;
    const [bx0, by0, bx1, by1] = cov.box;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const i = y * W + x;
        let c = cov[i];
        if (!(c > 0)) continue;
        if (mask) { c *= mask[i]; if (!(c > 0)) continue; }
        if (solid) color.set(solid); else paintAt(style, x + 0.5, y + 0.5, color);
        const k = c * alpha, o = i * 4, inv = 1 - color[3] * k;
        data[o] = color[0] * k + data[o] * inv;
        data[o + 1] = color[1] * k + data[o + 1] * inv;
        data[o + 2] = color[2] * k + data[o + 2] * inv;
        data[o + 3] = color[3] * k + data[o + 3] * inv;
      }
    }
  }

  const g = {
    width, height, density,
    get fillStyle() { return state.fillStyle; }, set fillStyle(v) { state.fillStyle = v; },
    get strokeStyle() { return state.strokeStyle; }, set strokeStyle(v) { state.strokeStyle = v; },
    get lineWidth() { return state.lineWidth; }, set lineWidth(v) { state.lineWidth = v; },
    get globalAlpha() { return state.globalAlpha; }, set globalAlpha(v) { state.globalAlpha = v; },
    lineJoin: 'round', lineCap: 'round',
    save() { stack.push(state); state = { ...state, m: [...state.m] }; },
    restore() { if (stack.length) state = stack.pop(); },
    translate(x, y) { state.m = multiply(state.m, [1, 0, 0, 1, x, y]); },
    scale(x, y = x) { state.m = multiply(state.m, [x, 0, 0, y, 0, 0]); },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); state.m = multiply(state.m, [c, s, -s, c, 0, 0]); },
    beginPath() { subpaths = []; current = null; pen = null; },
    moveTo(x, y) { current = null; add(x, y); },
    lineTo(x, y) { if (!current) { add(x, y); return; } add(x, y); },
    closePath() { if (current) { current.closed = true; const [x, y] = [current.points[0], current.points[1]]; current = null; const inv = invert(state.m); pen = [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]; } },
    quadraticCurveTo(cx, cy, x, y) {
      const [x0, y0] = pen ?? [cx, cy], n = segments(Math.hypot(cx - x0, cy - y0) + Math.hypot(x - cx, y - cy));
      if (!current) add(x0, y0);
      for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; add(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y); }
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const [x0, y0] = pen ?? [c1x, c1y], n = segments(Math.hypot(c1x - x0, c1y - y0) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(x - c2x, y - c2y));
      if (!current) add(x0, y0);
      for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; add(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y); }
    },
    ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
      let sweep = a1 - a0;
      if (!ccw && sweep >= Math.PI * 2) sweep = Math.PI * 2;
      else if (ccw && -sweep >= Math.PI * 2) sweep = -Math.PI * 2;
      else if (!ccw) { while (sweep < 0) sweep += Math.PI * 2; } else { while (sweep > 0) sweep -= Math.PI * 2; }
      const n = Math.max(8, segments(Math.abs(sweep) * Math.max(rx, ry))), c = Math.cos(rot), s = Math.sin(rot);
      for (let i = 0; i <= n; i++) {
        const a = a0 + sweep * i / n, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
        add(cx + ex * c - ey * s, cy + ex * s + ey * c);
      }
    },
    arc(cx, cy, r, a0, a1, ccw = false) { g.ellipse(cx, cy, r, r, 0, a0, a1, ccw); },
    rect(x, y, w, h) { g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); },
    roundRect(x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.ellipse(x + w - r, y + r, r, r, 0, -Math.PI / 2, 0);
      g.lineTo(x + w, y + h - r); g.ellipse(x + w - r, y + h - r, r, r, 0, 0, Math.PI / 2);
      g.lineTo(x + r, y + h); g.ellipse(x + r, y + h - r, r, r, 0, Math.PI / 2, Math.PI);
      g.lineTo(x, y + r); g.ellipse(x + r, y + r, r, r, 0, Math.PI, Math.PI * 1.5); g.closePath();
    },
    /** Linear gradient in the current user space; `stops` is an optional list of colours spread evenly. */
    createLinearGradient(x0, y0, x1, y1, stops) { return Object.assign(gradient('linear', [x0, y0, x1, y1], stops), { m: [...state.m] }); },
    createRadialGradient(x0, y0, r0, x1, y1, r1, stops) { return Object.assign(gradient('radial', [x0, y0, r0, x1, y1, r1], stops), { m: [...state.m] }); },
    linear(x0, y0, x1, y1, stops) { return g.createLinearGradient(x0, y0, x1, y1, stops); },
    radial(x, y, r0, r1, stops) { return g.createRadialGradient(x, y, r0, x, y, r1, stops); },
    fill(rule = 'nonzero') { composite(coverage(subpaths.map(s => s.points).filter(p => p.length >= 6), W, H, rule), state.fillStyle); },
    stroke() {
      const w = state.lineWidth * scaleOf() / 2, polys = [];
      for (const s of subpaths) {
        const p = s.points, n = p.length / 2;
        if (n < 2) continue;
        const count = s.closed ? n : n - 1;
        for (let i = 0; i < count; i++) {
          const j = (i + 1) % n, x0 = p[i * 2], y0 = p[i * 2 + 1], x1 = p[j * 2], y1 = p[j * 2 + 1], len = Math.hypot(x1 - x0, y1 - y0);
          if (len < 1e-6) continue;
          const nx = -(y1 - y0) / len * w, ny = (x1 - x0) / len * w;
          polys.push(oriented([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny]));
        }
        for (let i = 0; i < n; i++) if (w > 0.6) polys.push(oriented(disc(p[i * 2], p[i * 2 + 1], w)));
      }
      composite(coverage(polys, W, H, 'nonzero'), state.strokeStyle);
    },
    clip(rule = 'nonzero') {
      const cov = coverage(subpaths.map(s => s.points).filter(p => p.length >= 6), W, H, rule);
      if (state.clip) for (let i = 0; i < cov.length; i++) cov[i] *= state.clip[i];
      cov.box = [0, 0, W - 1, H - 1];
      state.clip = cov;
    },
    fillRect(x, y, w, h) { const keep = subpaths; g.beginPath(); g.rect(x, y, w, h); g.fill(); subpaths = keep; },
    /** Straight-alpha 8-bit RGBA, the shape encodePng takes. */
    toImage() {
      const out = new Uint8Array(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const a = data[i * 4 + 3], k = a > 1e-6 ? 1 / a : 0;
        for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(Math.min(1, data[i * 4 + c] * k) * 255);
        out[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
      }
      return { width: W, height: H, data: out };
    },
  };
  return g;
}
