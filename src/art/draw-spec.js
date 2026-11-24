// What draw_rig accepts as a part, turned into what the rig builder draws. A part comes as
//
//   { name, svg, at, ... }                       an SVG written out (or asset:<pack>/<item>)
//   { name, box, shapes, at, states?, ... }      parametric shapes in the style guide (shapes.js)
//   { name, component: { component, ... }, at }  a component (components.js): one or more parts
//
// Shape parts may derive their states: `states: ["hover", "pressed", "disabled"]` re-colours the
// same shapes (lighter, darker and pressed down, greyed), so a state never has to be drawn twice.
// Each resulting part keeps its `source` (box and shapes, or the component), so a change to the
// style guide can redraw every part from it. Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { renderShapes } from './shapes.js';
import { componentParts } from './components.js';

export const DERIVED_STATES = Object.freeze(['hover', 'pressed', 'disabled']);
const r2 = v => Math.round(v * 100) / 100;

/** One shape list re-coloured for a state. */
export function deriveShapes(shapes, state, style) {
  const tone = value => {
    if (typeof value !== 'string' || value === 'none' || value.startsWith('#')) return value;
    const base = value.replace(/[+-]\d+$|~$/g, '');
    return state === 'hover' ? `${base}+22` : state === 'pressed' ? `${base}-18` : `${base}-15~`;
  };
  const dy = state === 'pressed' ? style.light.shadow * 0.75 : 0;
  return shapes.map(s => {
    const out = { ...s };
    if (s.fill) out.fill = tone(s.fill);
    else if (s.fill === undefined && !s.text && !s.line) out.fill = tone(s.icon ? 'accent' : 'primary');
    if (s.text && state === 'disabled') out.color = 'muted';
    if (state === 'pressed' || state === 'disabled') out.shine = false;
    if (dy) {
      if (s.rect) out.rect = [s.rect[0], s.rect[1] + dy, s.rect[2], s.rect[3]];
      if (s.circle) out.circle = [s.circle[0], s.circle[1] + dy, s.circle[2]];
      if (s.ellipse) out.ellipse = [s.ellipse[0], s.ellipse[1] + dy, ...s.ellipse.slice(2)];
      if (s.star) out.star = [s.star[0], s.star[1] + dy, s.star[2]];
      if (s.text) out.at = [s.at[0], s.at[1] + dy];
      if (s.icon && s.box) out.box = [s.box[0], s.box[1] + dy, s.box[2]];
    }
    return out;
  });
}

const add = (a, b) => [r2(a[0] + b[0]), r2(a[1] + b[1])];

/** The text metrics a drawn part keeps (for critique_art: clipped, off-centre or shrunk text). */
const textsOf = drawn => (drawn.texts?.length ? { texts: drawn.texts } : {});

/**
 * Expand the parts of a draw_rig call: parametric shapes and components become SVG parts.
 * @param {object[]} parts  as draw_rig receives them (asset references already read)
 * @param {object} style    a validated style guide
 * @returns {{ parts: object[], missing: string[], parametric: number }}
 */
export function expandParts(parts, style) {
  const out = [], missing = [];
  let parametric = 0;
  for (const p of parts) {
    if (!p || typeof p !== 'object') { out.push(p); continue; }
    const { component, shapes, box, states, ...rest } = p;
    if (component !== undefined) {
      parametric++;
      const spec = typeof component === 'string' ? { component } : component;
      const at = Array.isArray(p.at) ? p.at : [0, 0];
      const subs = componentParts(spec, style, p.name);
      const owner = subs.find(sub => sub.name === p.name) ?? subs.find(sub => sub.owner) ?? subs[0];   // keeps how the whole component was drawn
      for (const sub of subs) {
        const svgs = renderShapes({ box: sub.box, shapes: sub.shapes }, style);
        missing.push(...svgs.missing);
        const where = add(at, sub.offset ?? [0, 0]);
        out.push({
          name: sub.name, svg: svgs.svg, at: where,
          pivot: sub.pivot ? add(where, sub.pivot) : p.pivot && sub === owner ? p.pivot : where,
          parent: sub.parent ?? p.parent,
          ...(sub.blend ? { blend: sub.blend } : {}), ...(sub.hidden || (p.hidden && sub === owner) ? { hidden: true } : {}),
          ...(sub.states ? { states: Object.fromEntries(Object.entries(sub.states).map(([k, v]) => [k, renderShapes(v, style).svg])) } : {}),
          ...(sub === owner ? { source: { component: spec, of: p.name, at, ...(p.pivot ? { pivot: p.pivot } : {}), ...(p.parent ? { parent: p.parent } : {}), ...textsOf(svgs) } } : { source: { of: p.name, ...textsOf(svgs) } }),
        });
      }
      continue;
    }
    if (shapes !== undefined) {
      parametric++;
      const drawn = renderShapes({ box, shapes }, style);
      missing.push(...drawn.missing);
      let stateSvgs;
      if (states !== undefined) {
        stateSvgs = {};
        const list = Array.isArray(states) ? states.map(s => [s, null]) : Object.entries(states);
        for (const [state, own] of list) {
          if (!/^[a-z][a-zA-Z0-9]{0,23}$/.test(state)) throw new StudioError('bad-argument', `${p.name}: state "${state}" must be a short word (hover, pressed, on).`, { state });
          if (own) stateSvgs[state] = renderShapes({ box: own.box ?? box, shapes: own.shapes }, style).svg;
          else if (DERIVED_STATES.includes(state)) stateSvgs[state] = renderShapes({ box, shapes: deriveShapes(shapes, state, style) }, style).svg;
          else throw new StudioError('bad-argument', `${p.name}: state "${state}" is derived only for ${DERIVED_STATES.join(', ')}; give its own { shapes } otherwise.`, { state });
        }
      }
      out.push({ ...rest, svg: drawn.svg, ...(stateSvgs ? { states: stateSvgs } : {}), source: { box, shapes, ...(states !== undefined ? { states } : {}), ...textsOf(drawn) } });
      continue;
    }
    out.push(p.states && typeof p.states === 'object' && !Array.isArray(p.states) ? p : rest);
  }
  return { parts: out, missing: [...new Set(missing)], parametric };
}
