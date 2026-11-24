// A part's SVG as a plain, safe tree the page can rebuild element by element: the live drawing
// board shows each part being drawn (its outlines traced, then its fills), so the page needs the
// shapes themselves, not a picture of them.
//
// Only what the studio's rasterizer draws survives: shapes, groups, gradients and their
// geometry and paint attributes. Everything else is dropped (scripts, event handlers, links,
// images, foreignObject, external url() references), so the page can create the elements with
// setAttribute and nothing in a part can run. Ids are prefixed per part, so two parts on one
// board never share a gradient by accident. Pure and isomorphic.

import { parseXml } from '../engine/svg.js';

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINERS = new Set(['g', 'defs']);
const PAINT_SERVERS = new Set(['linearGradient', 'radialGradient', 'stop']);
export const SAFE_TAGS = Object.freeze([...SHAPES, ...CONTAINERS, ...PAINT_SERVERS]);

const GEOMETRY = ['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'fx', 'fy', 'offset'];
const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-opacity', 'stroke-opacity',
  'opacity', 'fill-rule', 'stop-color', 'stop-opacity', 'display', 'visibility'];
const OTHER = ['transform', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'id'];
export const SAFE_ATTRIBUTES = Object.freeze([...GEOMETRY, ...PAINT, ...OTHER]);
const ALLOWED = new Set(SAFE_ATTRIBUTES);

// A value is plain text of numbers, words and the few functions SVG paint and transforms use.
// url() only as a reference inside the same part (#id); nothing that can name a script or a file.
const FUNCTIONS = /\b([a-z-]+)\s*\(/gi;
const KNOWN_FUNCTIONS = new Set(['url', 'rgb', 'rgba', 'hsl', 'hsla', 'matrix', 'translate', 'rotate', 'scale', 'skewx', 'skewy']);
const MAX_VALUE = 20000;

function safeValue(name, value) {
  const v = String(value).trim();
  if (!v || v.length > MAX_VALUE || /[<>\\`]|javascript:|data:|expression/i.test(v)) return null;
  for (const m of v.matchAll(FUNCTIONS)) if (!KNOWN_FUNCTIONS.has(m[1].toLowerCase())) return null;
  for (const m of v.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) if (!/^#[\w.-]+$/.test(m[2])) return null;
  if (name === 'id' && !/^[\w.-]{1,64}$/.test(v)) return null;
  return v;
}

/** `style="fill: red; stroke-width: 2"` as attributes (only the allowed paint properties). */
function styleAttributes(style) {
  const out = {};
  for (const decl of String(style ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const key = decl.slice(0, i).trim().toLowerCase(), value = decl.slice(i + 1).trim();
    if (PAINT.includes(key)) out[key] = value;
  }
  return out;
}

/**
 * The safe tree of one part's SVG.
 * @param {string} svg  one SVG document
 * @param {string} [prefix] prefix for every id and every url(#id) reference (the part's name)
 * @returns {{ viewBox: number[], children: SafeNode[], shapes: number }}
 * @typedef {{ tag: string, attrs: Record<string, string>, children: SafeNode[] }} SafeNode
 */
export function safeTree(svg, prefix = '') {
  const root = parseXml(svg);
  const vb = String(root.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  const w = parseFloat(root.attrs.width), h = parseFloat(root.attrs.height);
  const viewBox = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0 ? vb : [0, 0, w > 0 ? w : 100, h > 0 ? h : 100];
  const pre = prefix ? `${String(prefix).replace(/[^\w.-]/g, '_')}-` : '';
  let shapes = 0;
  /** @type {Record<string, string>} */
  const rootPaint = {};
  for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(root.attrs).filter(([k]) => PAINT.includes(k))), ...styleAttributes(root.attrs.style) })) {
    const safe = safeValue(k, v);
    if (safe !== null) rootPaint[k] = safe;
  }
  const walk = node => {
    const tag = node.tag;
    if (!SHAPES.has(tag) && !CONTAINERS.has(tag) && !PAINT_SERVERS.has(tag)) return null;
    /** @type {Record<string, string>} */
    const attrs = {};
    const merged = { ...node.attrs, ...styleAttributes(node.attrs.style) };
    for (const [k, v] of Object.entries(merged)) {
      if (!ALLOWED.has(k)) continue;
      let safe = safeValue(k, v);
      if (safe === null) continue;
      if (pre && k === 'id') safe = pre + safe;
      if (pre && safe.includes('url(')) safe = safe.replace(/url\(\s*(['"]?)#([\w.-]+)\1\s*\)/g, `url(#${pre}$2)`);
      attrs[k] = safe;
    }
    if (SHAPES.has(tag)) shapes++;
    const children = SHAPES.has(tag) ? [] : node.children.map(walk).filter(Boolean);
    return { tag, attrs, children };
  };
  const children = root.children.map(walk).filter(Boolean);
  const wrapped = Object.keys(rootPaint).length ? [{ tag: 'g', attrs: rootPaint, children }] : children;
  return { viewBox, children: wrapped, shapes };
}
