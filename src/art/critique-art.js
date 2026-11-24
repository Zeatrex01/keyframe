// The art critique: what an art director checks on a drawing before anyone animates it, measured
// on the parts themselves against the project's style guide.
//
//   palette    colours that are not the guide's roles or their lighter, darker or greyed tones
//   stroke     outline weights (in rig units, after the part's scale) off the guide's thin/regular/bold
//   align      part edges and centres that almost line up (a few units off) and edges off the grid
//   silhouette parts that fall apart when shown small (too thin to read at icon size)
//   states     states of a part that look too much like its normal look (a press nobody sees)
//   contrast   a part that disappears on the colour behind it (surface)
//   text       text cut off by the part's edge, spilling out of its shape, off the middle, or shrunk to fit
//
// Each finding names the part, what was measured, the guide's number and the fix. Pure and
// isomorphic: it reads the parts document (src/render/svg-rig.js) and draws with the studio's own
// renderer (src/engine/svg.js).

import { parseXml, rasterizeSvg, svgSize } from '../engine/svg.js';
import { colorOf, mix, desaturate, contrast } from './style.js';

const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const dist = (a, b) => { const x = toRgb(a), y = toRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const r1 = v => Math.round(v * 10) / 10;

/** Every colour and every stroke width a part's SVG uses (in its own units). */
function paintsOf(svg) {
  const colors = new Set(), strokes = [];
  const walk = (node, inherited) => {
    const style = {};
    for (const decl of String(node.attrs.style ?? '').split(';')) { const i = decl.indexOf(':'); if (i > 0) style[decl.slice(0, i).trim()] = decl.slice(i + 1).trim(); }
    const get = k => node.attrs[k] ?? style[k];
    const stroke = get('stroke') ?? inherited.stroke, sw = get('stroke-width') ?? inherited.sw;
    for (const k of ['fill', 'stroke', 'stop-color']) {
      const v = get(k);
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) colors.add(v.toLowerCase());
      else if (typeof v === 'string' && /^#[0-9a-f]{3}$/i.test(v)) colors.add(`#${[...v.slice(1)].map(c => c + c).join('')}`.toLowerCase());
    }
    if (['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line'].includes(node.tag) && stroke && stroke !== 'none') {
      const w = parseFloat(sw ?? '1');
      const linecap = get('stroke-linecap') ?? inherited.cap;
      const fill = get('fill') ?? inherited.fill;
      // Text and icon details are drawn as round-capped strokes with no fill: they are lettering, not outlines.
      if (w > 0 && !(fill === 'none' && linecap === 'round')) strokes.push({ w, scale: inherited.scale });
    }
    let scale = inherited.scale;
    const t = node.attrs.transform;
    const m = t && /scale\(\s*([\d.eE+-]+)/.exec(t);
    if (m) scale *= Number(m[1]);
    for (const c of node.children) walk(c, { stroke, sw, scale, cap: get('stroke-linecap') ?? inherited.cap, fill: get('fill') ?? inherited.fill });
  };
  const root = parseXml(svg);
  walk(root, { stroke: undefined, sw: undefined, scale: 1, cap: undefined, fill: undefined });
  return { colors: [...colors], strokes };
}

/** The colours the guide allows: each role and its tones toward white, black and grey. */
function allowedTones(style) {
  const out = [];
  // Shading a lighter or greyed tone darker (a top-lit gradient on a hover state) stays in the family.
  for (const c of Object.values(style.palette)) {
    for (const base of [c, desaturate(c, 0.85), desaturate(c, 1)]) {
      for (let a = 0; a <= 1.0001; a += 0.05) out.push(mix(base, '#ffffff', a), mix(base, '#000000', a));
      for (let a = 0.05; a <= 0.6; a += 0.05) for (let b = 0.05; b <= 0.6; b += 0.05) out.push(mix(mix(base, '#ffffff', a), '#000000', b));
    }
  }
  return out;
}

/** The share of the covered pixels whose colour clearly changes between two looks, 0 (same) to 1. */
function changedShare(a, b) {
  let changed = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] < 16 && b.data[i + 3] < 16) continue;
    n++;
    if (Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3])) > 14) changed++;
  }
  return n ? changed / n : 0;
}

/** The share of a part's covered pixels that are solid, drawn w x h. */
function solidity(svg, w, h) {
  const img = rasterizeSvg(svg, { width: w, height: h });
  let solid = 0, any = 0;
  for (let i = 3; i < img.data.length; i += 4) { if (img.data[i] > 200) solid++; if (img.data[i] > 20) any++; }
  return any > 8 ? solid / any : 1;
}

/** The text checks of one laid-out text (src/art/shapes.js `texts`), in the part's units. */
function textFindings(t, part, add, all) {
  const [x0, y0, x1, y1] = t.ink, [f0, g0, f1, g1] = t.frame, [W, H] = t.box ?? [Infinity, Infinity];
  const label = `"${String(t.text).slice(0, 24)}"`;
  const tol = 0.5;
  if (x0 < -tol || y0 < -tol || x1 > W + tol || y1 > H + tol) {
    add('text', 'warn', part.name, `${label} is cut off: its letters reach past the part's edge (ink ${r1(x0)}..${r1(x1)} of 0..${r1(W)} across).`, 'shorten the text, set it smaller, or widen the part; leave fit on so text is set to its frame.');
    return;
  }
  if (x0 < f0 - tol || x1 > f1 + tol) add('text', 'warn', part.name, `${label} spills out of the shape it sits on (ink ${r1(x0)}..${r1(x1)}, shape ${r1(f0)}..${r1(f1)}).`, 'leave fit on (the default), shorten the text or widen the shape.');
  if (t.align === 'middle') {
    const off = (x0 + x1) / 2 - (f0 + f1) / 2, fw = f1 - f0;
    if (Math.abs(off) > Math.max(2, fw * 0.04)) add('text', 'warn', part.name, `${label} sits ${r1(Math.abs(off))} units ${off > 0 ? 'right' : 'left'} of the middle of its shape (${Math.round(Math.abs(off) / fw * 100)}% of its width).`, 'put the anchor (at[0]) on the middle of the shape it sits on.');
    // Vertically only when it is the only text on its shape (lines of body text are stacked by design).
    const alone = all.filter(o => String(o.frame) === String(t.frame)).length === 1;
    const vOff = (y0 + y1) / 2 - (g0 + g1) / 2, fh = g1 - g0;
    if (alone && fh < (y1 - y0) * 3 && Math.abs(vOff) > Math.max(2, fh * 0.12)) add('text', 'warn', part.name, `${label} sits ${r1(Math.abs(vOff))} units ${vOff > 0 ? 'below' : 'above'} the middle of its shape.`, 'put the baseline (at[1]) at the middle of the shape plus half the text size.');
  }
  if (t.asked && t.size < t.asked * 0.75) add('text', 'info', part.name, `${label} was set at ${r1(t.size)} instead of ${r1(t.asked)} to fit its shape.`, 'shorten the text or widen the shape if it reads too small.');
}

/**
 * Critique a drawing.
 * @param {{ name: string, kind?: string, parts: Array<{ name: string, svg: string, at: number[], size: number[], states?: Record<string, string>, hidden?: boolean, blend?: string, source?: any }> }} doc
 * @param {object} style  a validated style guide
 * @returns {{ findings: object[], counts: object, checked: string[] }}
 */
export function critiqueArt(doc, style) {
  const findings = [];
  const add = (check, level, part, message, fix) => findings.push({ check, level, ...(part ? { part } : {}), message, fix });
  const tones = allowedTones(style);
  const weights = [style.stroke.thin, style.stroke.regular, style.stroke.bold].filter(w => w > 0);
  const effects = doc.parts.filter(p => p.blend === 'additive' || p.blend === 'screen');

  for (const p of doc.parts) {
    const looks = [['', p.svg], ...Object.entries(p.states ?? {}).map(([k, v]) => [`_${k}`, v])];
    const { colors, strokes } = paintsOf(p.svg);
    for (const [, svg] of looks.slice(1)) for (const c of paintsOf(svg).colors) if (!colors.includes(c)) colors.push(c);
    // palette
    const off = colors.filter(c => c !== '#ffffff' && c !== '#000000' && Math.min(...tones.map(t => dist(c, t))) > 22);
    if (off.length && !effects.includes(p)) add('palette', 'warn', p.name, `uses ${off.length} colour${off.length > 1 ? 's' : ''} outside the palette (${off.slice(0, 4).join(', ')}).`, 'draw it with palette roles (fill: "primary", "primary-20"), or add the colour to the guide as a role.');
    // stroke weights in rig units
    let vb = null;
    try { vb = svgSize(p.svg); } catch { vb = null; }
    if (vb && weights.length && style.stroke.color !== 'none') {
      const k = Math.min(p.size[0] / vb.width, p.size[1] / vb.height);
      const bad = [...new Set(strokes.map(s => r1(s.w * s.scale * k)))].filter(w => !weights.some(g => Math.abs(w - g) <= Math.max(0.6, g * 0.2)));
      if (bad.length && !effects.includes(p)) add('stroke', 'warn', p.name, `outline weight ${bad.join(', ')} is not one of the guide's ${weights.join(' / ')} (after the part's scale).`, 'use sw thin, regular or bold; draw the part at its rig size so the weight does not scale.');
    }
    // silhouette at small size: the share of the part that is still solid
    if (vb && !p.hidden && !effects.includes(p)) {
      const small = 24, k = small / Math.min(p.size[0], p.size[1]);
      if (k < 1) {
        const atSmall = solidity(p.svg, Math.max(1, Math.round(p.size[0] * k)), Math.max(1, Math.round(p.size[1] * k)));
        // A frame or a see-through overlay is open by design: only a part that is solid at full size and falls apart small is a problem.
        const atFull = solidity(p.svg, Math.max(1, Math.round(Math.min(256, p.size[0]))), Math.max(1, Math.round(p.size[1] * Math.min(256, p.size[0]) / p.size[0])));
        if (atSmall < 0.35 && atFull >= 0.6) add('silhouette', 'warn', p.name, `at ${small} px across only ${Math.round(atSmall * 100)}% of the part stays solid (${Math.round(atFull * 100)}% at full size): thin pieces blur away when it is shown small.`, 'fill the shape (a solid body with an outline) or make the thin pieces heavier.');
      }
    }
    // text: never cut off, centred where it is meant to be, not shrunk past reading to fit
    for (const t of Array.isArray(p.source?.texts) ? p.source.texts : []) textFindings(t, p, add, p.source.texts);
    // states: each must read as different from the normal look
    if (p.states) {
      const w = Math.max(8, Math.round(Math.min(96, p.size[0]))), h = Math.max(8, Math.round(p.size[1] * w / p.size[0]));
      const base = rasterizeSvg(p.svg, { width: w, height: h });
      for (const [state, svg] of Object.entries(p.states)) {
        const d = changedShare(base, rasterizeSvg(svg, { width: w, height: h }));
        if (d < 0.2) add('states', 'warn', p.name, `the ${state} look changes only ${Math.round(d * 100)}% of the part: a player will not see the change.`, state === 'pressed' ? 'press it down by the shadow depth and darken it (states: ["pressed"] does both).' : 'change its colour or shape more.');
      }
    }
    // contrast on the background it is shown on
    if (style.palette.surface && !effects.includes(p) && !p.hidden) {
      const img = rasterizeSvg(p.svg, { width: 32, height: Math.max(1, Math.round(32 * p.size[1] / p.size[0])) });
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 200) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
      if (n) {
        const avg = `#${[r, g, b].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('')}`;
        const ratio = contrast(avg, colorOf(style, 'surface'));
        const outlined = style.stroke.color !== 'none' && style.stroke.color !== 'tint' && strokes.length;
        if (ratio < 1.25 && !outlined) add('contrast', 'info', p.name, `its average colour is ${ratio.toFixed(2)}:1 against the surface: it melts into the background.`, 'give it an outline or a lighter or darker fill.');
      }
    }
  }

  // alignment and spacing between parts (top-level layout, ignoring effects and hidden parts)
  const shown = doc.parts.filter(p => !p.hidden && !effects.includes(p));
  const edges = p => ({ l: p.at[0] - p.size[0] / 2, r: p.at[0] + p.size[0] / 2, cx: p.at[0], b: p.at[1] - p.size[1] / 2, t: p.at[1] + p.size[1] / 2, cy: p.at[1] });
  // Parts of one component, or a part and what carries it, are laid out together on purpose.
  const groupOf = p => p.source?.of ?? null;
  const carries = (a, b) => { const byName = new Map(doc.parts.map(q => [q.name, q])); for (let q = b, n = 0; q?.parent && n < 64; n++) { if (q.parent === a.name) return true; q = byName.get(q.parent); } return false; };
  const together = (a, b) => (groupOf(a) && groupOf(a) === groupOf(b)) || carries(a, b) || carries(b, a);
  const near = [];
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    if (together(shown[i], shown[j])) continue;
    const a = edges(shown[i]), b = edges(shown[j]);
    for (const [ka, kb, axis] of [['cx', 'cx', 'centre x'], ['l', 'l', 'left edge'], ['r', 'r', 'right edge'], ['cy', 'cy', 'centre y'], ['b', 'b', 'bottom edge'], ['t', 't', 'top edge']]) {
      const d = Math.abs(a[ka] - b[kb]);
      if (d > 0.5 && d < Math.max(3, style.grid * 1.5)) near.push(`${shown[i].name} and ${shown[j].name}: ${axis} ${r1(d)} apart`);
    }
  }
  if (near.length) add('align', 'warn', null, `${near.length} pair${near.length > 1 ? 's' : ''} of parts almost line up: ${near.slice(0, 5).join('; ')}${near.length > 5 ? '…' : ''}.`, 'line them up exactly (same centre or edge) or move them apart by a clear step of the grid.');
  const offGrid = shown.filter(p => doc.kind === 'artboard' && [p.at[0] - p.size[0] / 2, p.at[1] - p.size[1] / 2].some(v => Math.abs(v / style.grid - Math.round(v / style.grid)) > 0.01));
  if (offGrid.length) add('align', 'info', null, `${offGrid.length} part${offGrid.length > 1 ? 's sit' : ' sits'} off the ${style.grid}-unit grid (${offGrid.slice(0, 5).map(p => p.name).join(', ')}).`, `place corners on multiples of ${style.grid}.`);

  const counts = { warn: findings.filter(f => f.level === 'warn').length, info: findings.filter(f => f.level === 'info').length };
  return { findings, counts, checked: ['palette', 'stroke', 'align', 'silhouette', 'states', 'contrast', 'text'] };
}
