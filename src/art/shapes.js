// Parametric drawing: a part described as a few short shapes that use the style guide by name,
// turned into one clean SVG. An AI writes
//
//   { box: [220, 80], shapes: [{ rect: [0, 0, 220, 80], r: 'pill', fill: 'primary', shine: true },
//                             { text: 'PLAY', at: [110, 54], size: 'md' }] }
//
// instead of the SVG itself: a tenth of the tokens, and every part follows the same palette,
// stroke weights, radii and light. Shapes: rect, circle, ellipse, path, poly, line, star, text
// (the built-in stroke font) and icon (the glyph family). Paint: fill and stroke by role
// ("primary", "primary-20", "#rrggbb", "none"), sw (thin, regular, bold or a number), and the
// light of the guide: shade (top-lit gradient), shine (a highlight), shadow (a drop shadow).
// Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { colorOf, weightOf, radiusOf, lighten, darken } from './style.js';
import { layoutText, strokesPath } from './font.js';
import { GLYPHS, GLYPH_NAMES } from './glyphs.js';

export const SHAPE_KINDS = Object.freeze(['rect', 'circle', 'ellipse', 'path', 'poly', 'line', 'star', 'text', 'icon']);
const r2 = v => Math.round(v * 100) / 100;
const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const nums = (v, n, label) => {
  if (!Array.isArray(v) || v.length !== n || !v.every(Number.isFinite)) throw new StudioError('bad-argument', `${label} is ${n} numbers.`, { value: v });
  return v;
};

/** The geometry of a shape as SVG element text (without paint), and its box. */
function geometry(s, style, where) {
  const kind = SHAPE_KINDS.find(k => s[k] !== undefined);
  if (!kind) throw new StudioError('bad-argument', `${where} names no shape: one of ${SHAPE_KINDS.join(', ')}.`, { shape: s });
  if (kind === 'rect') {
    const [x, y, w, h] = nums(s.rect, 4, `${where}.rect [x, y, w, h]`);
    const r = Math.min(radiusOf(style, s.r), w / 2, h / 2);
    return { kind, tag: 'rect', attrs: { x, y, width: w, height: h, ...(r > 0 ? { rx: r2(r) } : {}) }, box: [x, y, w, h], r };
  }
  if (kind === 'circle') { const [cx, cy, r] = nums(s.circle, 3, `${where}.circle [cx, cy, r]`); return { kind, tag: 'circle', attrs: { cx, cy, r }, box: [cx - r, cy - r, 2 * r, 2 * r] }; }
  if (kind === 'ellipse') { const [cx, cy, rx, ry] = nums(s.ellipse, 4, `${where}.ellipse [cx, cy, rx, ry]`); return { kind, tag: 'ellipse', attrs: { cx, cy, rx, ry }, box: [cx - rx, cy - ry, 2 * rx, 2 * ry] }; }
  if (kind === 'line') { const [x1, y1, x2, y2] = nums(s.line, 4, `${where}.line [x1, y1, x2, y2]`); return { kind, tag: 'line', attrs: { x1, y1, x2, y2 }, box: [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)] }; }
  if (kind === 'path') {
    if (typeof s.path !== 'string' || !/^[\sMmLlHhVvCcSsQqTtAaZz0-9.,eE+-]+$/.test(s.path)) throw new StudioError('bad-argument', `${where}.path is SVG path data.`, { path: s.path });
    return { kind, tag: 'path', attrs: { d: s.path }, box: s.bbox ?? null };
  }
  if (kind === 'poly' || kind === 'star') {
    let pts;
    if (kind === 'star') {
      const [cx, cy, r] = nums(s.star, 3, `${where}.star [cx, cy, r]`);
      const n = Math.max(3, Math.min(16, Math.round(s.points ?? 5))), inner = r * (s.inner ?? 0.46);
      pts = Array.from({ length: n * 2 }, (_, i) => { const a = (-90 + i * 180 / n) * Math.PI / 180, rr = i % 2 ? inner : r; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; });
    } else {
      const flat = Array.isArray(s.poly?.[0]) ? s.poly.flat() : s.poly;
      if (!Array.isArray(flat) || flat.length < 6 || flat.length % 2 || !flat.every(Number.isFinite)) throw new StudioError('bad-argument', `${where}.poly is three or more [x, y] points.`, { poly: s.poly });
      pts = []; for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { kind, tag: 'polygon', attrs: { points: pts.map(p => p.map(r2).join(',')).join(' ') }, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] };
  }
  return { kind };
}

/**
 * One part's shapes as an SVG document.
 * @param {{ box: number[], shapes: object[] }} spec  box: [w, h] of the part's drawing space
 * @param {object} style  a validated style guide
 * @returns {{ svg: string, missing: string[], texts: object[] }}  texts: each text's size (and the size asked
 *   for, when it was set smaller to fit), its ink box and the frame it sits in, in the part's units
 */
export function renderShapes(spec, style) {
  const [W, H] = nums(spec?.box, 2, 'box [w, h]');
  if (!(W > 0 && H > 0)) throw new StudioError('bad-argument', 'box must be positive.', { box: spec.box });
  if (!Array.isArray(spec.shapes) || !spec.shapes.length || spec.shapes.length > 80) throw new StudioError('bad-argument', 'shapes is a list of 1-80 shapes.', {});
  const defs = [], body = [], missing = [], texts = [], frames = [];
  let gid = 0;
  const lightDx = style.light.from === 'top-left' ? 0.5 : style.light.from === 'top-right' ? -0.5 : 0;
  const gradient = (top, bottom) => {
    const id = `g${++gid}`;
    defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`);
    return `url(#${id})`;
  };
  const el = (tag, attrs) => `<${tag}${Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${esc(typeof v === 'number' ? r2(v) : v)}"`).join('')}/>`;
  spec.shapes.forEach((s, i) => {
    const where = `shapes[${i}]`;
    if (!s || typeof s !== 'object') throw new StudioError('bad-argument', `${where} is not a shape.`, {});
    const g = geometry(s, style, where);
    const opacity = s.opacity !== undefined ? Math.max(0, Math.min(1, Number(s.opacity))) : undefined;
    const ink = colorOf(style, style.stroke.color === 'none' ? 'ink' : style.stroke.color);
    const sw = weightOf(style, s.sw ?? 'regular');

    if (g.kind === 'text') {
      const size = typeof s.size === 'number' ? s.size : style.type.size[s.size ?? 'md'];
      if (!(size > 0)) throw new StudioError('bad-argument', `${where}.size is sm, md, lg or a number.`, { size: s.size });
      const [x, y] = nums(s.at, 2, `${where}.at [x, y] (baseline)`);
      const align = s.align ?? 'middle';
      const outline = s.outline ?? style.type.outline;
      const strokeOf = k => k * (style.type.weight === 'bold' ? 0.2 : 0.13) * (s.weight === 'thin' ? 0.7 : 1);
      const outlineOf = k => (outline ? Math.max(strokeOf(k) * 0.55, style.stroke.regular * 0.6) : 0);
      const lay = k => layoutText(s.text, { size: k, upper: style.type.case === 'upper', align, x, y });
      // The frame the text sits in: the last filled shape drawn under its middle, else the part's box.
      const mid = [x, y - size / 2];
      const frame = [...frames].reverse().find(f => mid[0] >= f[0] && mid[0] <= f[2] && mid[1] >= f[1] && mid[1] <= f[3]) ?? [0, 0, W, H];
      // Text never spills out of its frame: it is set smaller until its ink fits, with a margin.
      let laid = lay(size), k = size;
      const room = kk => {
        const pad = Math.max(kk * 0.25, style.stroke.thin);
        return align === 'middle' ? 2 * Math.min(x - frame[0], frame[2] - x) - 2 * pad : align === 'end' ? x - frame[0] - pad : frame[2] - x - pad;
      };
      const inkWidth = (l, kk) => l.bounds[2] - l.bounds[0] + strokeOf(kk) + 2 * outlineOf(kk);
      for (let i = 0; i < 4 && s.fit !== false && laid.strokes.length && inkWidth(laid, k) > room(k) && room(k) > 0; i++) {
        k = Math.max(size * 0.3, k * room(k) / inkWidth(laid, k) * 0.99);
        laid = lay(k);
      }
      missing.push(...laid.missing);
      const d = strokesPath(laid.strokes);
      if (!d) return;
      const w = strokeOf(k);
      const half = w / 2 + outlineOf(k);
      texts.push({ text: String(s.text), align, size: r2(k), asked: r2(size),
        ink: [laid.bounds[0] - half, laid.bounds[1] - half, laid.bounds[2] + half, laid.bounds[3] + half].map(r2), frame: frame.map(r2), box: [W, H] });
      const color = colorOf(style, s.color ?? 'text');
      const line = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity };
      if (outline) {
        const ow = outlineOf(k);
        if (style.light.shadow > 0) body.push(el('path', { d, ...line, stroke: ink, 'stroke-width': w + ow * 2, transform: `translate(${r2(lightDx * k * 0.12)} ${r2(k * 0.12)})` }));
        body.push(el('path', { d, ...line, stroke: ink, 'stroke-width': w + ow * 2 }));
      }
      body.push(el('path', { d, ...line, stroke: color, 'stroke-width': w }));
      return;
    }

    if (g.kind === 'icon') {
      const glyph = GLYPHS[s.icon];
      if (!glyph) throw new StudioError('bad-argument', `${where}.icon "${s.icon}" is not in the icon family: ${GLYPH_NAMES.join(', ')}.`, { icon: s.icon });
      const [x, y, size] = nums(s.box ?? [0, 0, Math.min(W, H)], 3, `${where}.box [x, y, size]`);
      const k = size / 64, t = `translate(${r2(x)} ${r2(y)}) scale(${r2(k * 1000) / 1000})`;
      const fill = colorOf(style, s.fill ?? 'accent');
      const holes = (glyph.details ?? []).filter(d => d.tone === 'hole').map(d => d.d).join('');
      const d = glyph.body + holes;
      // A small icon keeps a thinner outline, so the outline never swallows the glyph.
      const iconSw = s.sw === undefined && size < 48 ? Math.min(sw, style.stroke.thin) : sw;
      const strokeW = (s.stroke === false || style.stroke.color === 'none' ? 0 : iconSw) / k;
      const paint = s.shade ?? style.light.shade > 0 ? gradient(lighten(fill, style.light.shade * 0.5), darken(fill, style.light.shade * 0.6)) : fill;
      const parts = [];
      if (s.shadow && style.light.shadow > 0) parts.push(el('path', { d, fill: ink, 'fill-opacity': style.light.shadowAlpha, 'fill-rule': 'evenodd', transform: `translate(${r2(lightDx * style.light.shadow / k)} ${r2(style.light.shadow / k)})` }));
      parts.push(el('path', { d, fill: paint, 'fill-rule': 'evenodd', ...(strokeW > 0 ? { stroke: ink, 'stroke-width': strokeW, 'stroke-linejoin': 'round' } : {}) }));
      for (const det of glyph.details ?? []) {
        if (det.tone === 'hole') continue;
        if (det.tone.endsWith('line')) {
          const c = det.tone === 'lightline' ? colorOf(style, 'text') : ink;
          parts.push(el('path', { d: det.d, fill: 'none', stroke: c, 'stroke-width': Math.max(strokeW, sw / k) * 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        } else {
          const c = det.tone === 'ink' ? ink : det.tone === 'dark' ? darken(fill, 0.22) : lighten(fill, 0.6);
          parts.push(el('path', { d: det.d, fill: c, ...(det.tone === 'ink' ? {} : { 'fill-opacity': det.tone === 'light' ? 0.85 : 1 }) }));
        }
      }
      body.push(`<g transform="${t}"${opacity !== undefined ? ` opacity="${opacity}"` : ''}>${parts.join('')}</g>`);
      return;
    }

    const fillName = s.fill ?? (g.kind === 'line' ? 'none' : 'primary');
    const fill = g.kind === 'line' ? 'none' : colorOf(style, fillName);
    // A filled box text may sit in (and be fitted to); a frame inside the stroke.
    if (fill !== 'none' && g.box && (g.kind === 'rect' || g.kind === 'circle' || g.kind === 'ellipse')) {
      const [bx, by, bw, bh] = g.box, inset = s.stroke === 'none' ? 0 : sw / 2;
      frames.push([bx + inset, by + inset, bx + bw - inset, by + bh - inset]);
    }
    const strokeColor = s.stroke === false ? 'none' : colorOf(style, s.stroke ?? (style.stroke.color === 'none' ? 'none' : style.stroke.color));
    const shaded = fill !== 'none' && (s.shade ?? style.light.shade > 0) && !s.grad;
    const paint = s.grad ? gradient(colorOf(style, s.grad[0]), colorOf(style, s.grad[1]))
      : shaded ? gradient(lighten(fill, style.light.shade * 0.5), darken(fill, style.light.shade * 0.6)) : fill;
    if (s.shadow && style.light.shadow > 0 && g.kind !== 'line') {
      body.push(el(g.tag, { ...g.attrs, fill: ink, 'fill-opacity': style.light.shadowAlpha, transform: `translate(${r2(lightDx * style.light.shadow)} ${style.light.shadow})` }));
    }
    body.push(el(g.tag, {
      ...g.attrs, fill: paint, opacity,
      ...(strokeColor !== 'none' && sw > 0 ? { stroke: strokeColor, 'stroke-width': sw, 'stroke-linejoin': 'round', ...(g.kind === 'line' || g.kind === 'path' ? { 'stroke-linecap': 'round' } : {}) } : {}),
    }));
    // The shine: a soft highlight across the top, inside the outline.
    if (s.shine && g.box && style.light.shine > 0 && (g.kind === 'rect' || g.kind === 'circle' || g.kind === 'ellipse')) {
      const [x, y, w, h] = g.box, inset = sw / 2 + Math.max(2, Math.min(w, h) * 0.06);
      const hw = w - inset * 2, hh = Math.max(2, h * 0.32);
      if (hw > 4) {
        const attrs = g.kind === 'rect'
          ? { x: x + inset, y: y + inset, width: hw, height: hh, rx: r2(Math.max(0, Math.min((g.r ?? 0) - inset, hh / 2))) }
          : { cx: x + w / 2 - lightDx * w * 0.12, cy: y + inset + hh / 2, rx: hw * 0.36, ry: hh / 2 };
        body.push(el(g.kind === 'rect' ? 'rect' : 'ellipse', { ...attrs, fill: '#ffffff', 'fill-opacity': r2(style.light.shine * 0.75) }));
      }
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(W)} ${r2(H)}" width="${r2(W)}" height="${r2(H)}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}</svg>`;
  return { svg, missing: [...new Set(missing)], texts };
}
