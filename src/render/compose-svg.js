// Clean SVG out of a drawing: one part as a standalone file, or the whole drawing (every part
// placed as in the rig) as one file for a web page, a design tool or a printout.
//
// Only the safe subset survives (src/render/svg-safe.js: shapes, groups, gradients, geometry and
// paint), ids are prefixed per part so parts never share a gradient by accident, and each part is
// a <g id="<part>"> a page can find, style or animate. No editor metadata, no scripts. Pure.

import { safeTree } from './svg-safe.js';

const r2 = v => Math.round(v * 100) / 100;
const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const ID = /[^\w.-]/g;

/** A safe tree as SVG text. */
export function treeToSvg(nodes) {
  return nodes.map(n => {
    const attrs = Object.entries(n.attrs ?? {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    const kids = treeToSvg(n.children ?? []);
    return kids ? `<${n.tag}${attrs}>${kids}</${n.tag}>` : `<${n.tag}${attrs}/>`;
  }).join('');
}

/** The group that draws one part in a box at (x, y) of size (w, h), its own viewBox stretched into it. */
function placed(svg, name, x, y, w, h) {
  const tree = safeTree(svg, name);
  const [vx, vy, vw, vh] = tree.viewBox;
  const sx = w / vw, sy = h / vh;
  const t = `translate(${r2(x - vx * sx)} ${r2(y - vy * sy)})${sx !== 1 || sy !== 1 ? ` scale(${r2(sx * 10000) / 10000} ${r2(sy * 10000) / 10000})` : ''}`;
  return `<g id="${esc(String(name).replace(ID, '_'))}" transform="${t}">${treeToSvg(tree.children)}</g>`;
}

/** One part as a clean standalone SVG at its own size. */
export function partSvg(part) {
  const [w, h] = part.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(w)} ${r2(h)}" width="${r2(w)}" height="${r2(h)}">${placed(part.svg, part.name, 0, 0, w, h)}</svg>\n`;
}

/**
 * The whole drawing as one SVG (y down, top left at the drawing's top left), back to front.
 * @param {{ name: string, parts: Array<{ name: string, svg: string, at: number[], size: number[], hidden?: boolean }> }} doc
 * @param {{ hidden?: boolean, padding?: number }} [options]  hidden: include parts hidden in the setup pose
 */
export function drawingSvg(doc, { hidden = false, padding = 0 } = {}) {
  const parts = doc.parts.filter(p => hidden || !p.hidden);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p.at[0] - p.size[0] / 2); x1 = Math.max(x1, p.at[0] + p.size[0] / 2);
    y0 = Math.min(y0, p.at[1] - p.size[1] / 2); y1 = Math.max(y1, p.at[1] + p.size[1] / 2);
  }
  if (!parts.length) { x0 = y0 = 0; x1 = y1 = 1; }
  x0 -= padding; y0 -= padding; x1 += padding; y1 += padding;
  const W = r2(x1 - x0), H = r2(y1 - y0);
  const body = parts.map(p => placed(p.svg, p.name, p.at[0] - p.size[0] / 2 - x0, y1 - (p.at[1] + p.size[1] / 2), p.size[0], p.size[1])).join('');
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>\n`, origin: [r2(-x0), r2(y1)], size: [W, H] };
}
