// Editing what the AI drew, by hand: the words and colours of a part drawn from a component or
// from shapes, changed on the Draw board and drawn again in the style guide, so a label, a title
// or a colour is fixed without asking the AI. Positions, pivots and parents the owner set on the
// board are kept. Pure and isomorphic: the board runs it in the page, the gate in Node.

import { expandParts } from './draw-spec.js';
import { COMPONENTS } from './components.js';
import { svgSize } from '../engine/svg.js';

/** Words a component carries, and the colours it is painted with (by key). */
const TEXT_KEYS = ['label', 'title', 'button', 'value'];
const COLOUR_KEYS = { button: ['color'], iconButton: ['color'], panel: ['color', 'titleColor'], popup: ['color', 'titleColor', 'buttonColor'],
  progress: ['color'], toggle: ['color'], badge: ['color', 'plateColor'], icon: ['color', 'plateColor'], figure: ['skin', 'shirt', 'pants', 'hair', 'shoes'] };

/** The part that holds how a component was drawn: the part itself, or the one it was drawn with. */
export function ownerOf(parts, part) {
  if (!part?.source) return null;
  if (part.source.component || part.source.shapes) return part;
  return parts.find(p => p.source?.component && p.source.of === part.source.of) ?? null;
}

/**
 * What can be edited on a part by hand: its words and its colours, each with a key and its value.
 * @returns {{ owner: string, texts: Array<{ key: string, value: string }>, colours: Array<{ key: string, value: string }> } | null}
 */
export function editableOf(parts, part) {
  const owner = ownerOf(parts, part);
  if (!owner) return null;
  const texts = [], colours = [];
  const c = owner.source.component;
  if (c && COMPONENTS[c.component]) {
    for (const k of TEXT_KEYS) if (typeof c[k] === 'string' || typeof c[k] === 'number') texts.push({ key: k, value: String(c[k]) });
    (Array.isArray(c.lines) ? c.lines : []).forEach((line, i) => texts.push({ key: `lines.${i}`, value: String(line) }));
    for (const k of COLOUR_KEYS[c.component] ?? []) colours.push({ key: k, value: typeof c[k] === 'string' ? c[k] : '' });
  } else if (Array.isArray(owner.source.shapes)) {
    owner.source.shapes.forEach((s, i) => { if (s && typeof s.text === 'string') texts.push({ key: `shapes.${i}.text`, value: s.text }); });
    const fills = [...new Set(owner.source.shapes.map(s => s?.fill).filter(f => typeof f === 'string' && f !== 'none'))];
    for (const f of fills) colours.push({ key: `fill:${f}`, value: f });
  }
  return texts.length || colours.length ? { owner: owner.name, texts, colours } : null;
}

/**
 * Change one word or colour and draw the part (or the whole component) again in the guide.
 * @param {object[]} parts  the drawing's parts
 * @param {string} name     the part being edited (any part of a component)
 * @param {string} key      from editableOf
 * @param {string} value    the new text, or a colour (palette role, role+20, #rrggbb)
 * @param {object} style    the project's validated style guide
 * @returns {object[]} the new parts (the same array when nothing changed)
 */
export function applyEdit(parts, name, key, value, style) {
  const part = parts.find(p => p.name === name);
  const owner = ownerOf(parts, part);
  if (!owner) return parts;
  let spec;
  if (owner.source.component) {
    const c = structuredClone(owner.source.component);
    if (key.startsWith('lines.')) { const i = Number(key.slice(6)); if (!Array.isArray(c.lines) || !(i >= 0 && i < c.lines.length)) return parts; c.lines[i] = value; }
    else if (TEXT_KEYS.includes(key) || (COLOUR_KEYS[c.component] ?? []).includes(key)) { if (value === '' || value === null || value === undefined) delete c[key]; else c[key] = value; }
    else return parts;
    spec = { name: owner.name, component: c, at: owner.source.at ?? owner.at, ...(owner.source.pivot ? { pivot: owner.source.pivot } : {}), ...(owner.source.parent ? { parent: owner.source.parent } : {}) };
  } else {
    const shapes = structuredClone(owner.source.shapes);
    const m = /^shapes\.(\d+)\.text$/.exec(key);
    if (m) { if (!shapes[Number(m[1])] || typeof shapes[Number(m[1])].text !== 'string') return parts; shapes[Number(m[1])].text = value; }
    else if (key.startsWith('fill:')) { const from = key.slice(5); for (const s of shapes) if (s && s.fill === from) s.fill = value; }
    else return parts;
    spec = { name: owner.name, at: owner.at, box: owner.source.box, shapes, ...(owner.source.states !== undefined ? { states: owner.source.states } : {}) };
  }
  const { parts: drawn } = expandParts([spec], style);   // throws a StudioError on a value the guide cannot use
  const byName = new Map(drawn.map(d => [d.name, d]));
  return parts.map(p => {
    const d = byName.get(p.name);
    if (!d) return p;
    // The new art at the part's own scale (the owner may have resized it on the board).
    const was = svgSize(p.svg), now = svgSize(d.svg);
    const k = p.size && was.width > 0 ? [p.size[0] / was.width, p.size[1] / was.height] : [1, 1];
    const { svg, states, source } = d;
    return { ...p, svg, source, ...(states ? { states } : {}), size: [now.width * k[0], now.height * k[1]].map(v => Math.round(v * 100) / 100) };
  });
}
