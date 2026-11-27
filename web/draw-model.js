// The drawing board's model: a drawing is the parts document draw_rig reads and writes
// (src/render/svg-rig.js), edited here as plain data. Every function is pure and returns new
// values, so the board can undo by keeping old ones, and the rules are gated in node.
//
// Rig coordinates: y up, units. A part's `at` is the centre of its art, `size` its size in the
// rig, `pivot` where its bone turns it, `parent` the part whose bone carries it. Parts are listed
// back to front.

export const NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$/;
export const SHAPES = ['ellipse', 'rect'];
export const PALETTE = ['#FFC890', '#3B2A55', '#5E7BFF', '#2E2A52', '#FFB36B', '#F06A82', '#4FC9A6', '#FFFFFF'];
export const MAX_PARTS = 64;
const round = v => Math.round(v * 100) / 100;
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * One shape the board draws, as an SVG the rig builder reads. `data-shape` lets the board read
 * it back and edit it; art drawn elsewhere (the AI, an asset) has none and keeps its own look.
 * @param {{ shape: string, width: number, height: number, fill?: string, stroke?: string, strokeWidth?: number }} s
 */
export function shapeSvg({ shape, width, height, fill = PALETTE[0], stroke = 'none', strokeWidth = 0 }) {
  const w = Math.max(1, round(width)), h = Math.max(1, round(height));
  const sw = stroke !== 'none' && HEX.test(stroke) ? Math.max(0, Math.min(round(strokeWidth), Math.min(w, h) / 2)) : 0;
  const paint = `fill="${HEX.test(fill) ? fill : PALETTE[0]}"${sw ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}`;
  const body = shape === 'rect'
    ? `<rect x="${round(sw / 2)}" y="${round(sw / 2)}" width="${round(w - sw)}" height="${round(h - sw)}" rx="${round(Math.min(w, h) * 0.18)}" ${paint}/>`
    : `<ellipse cx="${round(w / 2)}" cy="${round(h / 2)}" rx="${round((w - sw) / 2)}" ry="${round((h - sw) / 2)}" ${paint}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" data-shape="${shape === 'rect' ? 'rect' : 'ellipse'}">${body}</svg>`;
}

/** The shape settings of an SVG the board drew, or null for other art. */
/** An SVG shown as an image needs its namespace; drawings written without one still show. */
export function withNamespace(svg) {
  const text = String(svg ?? '');
  return /<svg\b[^>]*\sxmlns\s*=/.test(text) ? text : text.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

export function readShape(svg) {
  if (typeof svg !== 'string') return null;
  const shape = /data-shape="(ellipse|rect)"/.exec(svg)?.[1];
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!shape || !box) return null;
  const attr = name => new RegExp(`\\s${name}="([^"]*)"`).exec(svg.slice(svg.indexOf('>') + 1))?.[1];
  return { shape, width: Number(box[1]), height: Number(box[2]), fill: attr('fill') ?? PALETTE[0], stroke: attr('stroke') ?? 'none', strokeWidth: Number(attr('stroke-width') ?? 0) };
}

/** A number as the board writes it: a point for decimals, at most two places, whatever the system locale. */
export const formatNumber = v => (Number.isFinite(v) ? String(round(v)) : '');

/** A number the owner typed, with a point or a comma for decimals; null when it is not one. */
export function parseNumber(text) {
  const clean = String(text ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(clean)) return null;
  const v = Number(clean);
  return Number.isFinite(v) ? v : null;
}

/** A free name: `base`, else `base_2`, `base_3`... */
export function uniqueName(parts, base) {
  const taken = new Set(['root', ...parts.map(p => p.name)]);
  const clean = String(base || 'part').replace(/[^A-Za-z0-9_ .-]/g, '_').replace(/^[ .-]+/, '').slice(0, 56) || 'part';
  if (!taken.has(clean)) return clean;
  for (let i = 2; ; i++) if (!taken.has(`${clean}_${i}`)) return `${clean}_${i}`;
}

/**
 * Add a shape on top of the drawing, filling the box (rig units, x/y the lower-left corner).
 * @param {object[]} parts
 * @param {{ shape: string, box: { x: number, y: number, width: number, height: number }, fill?: string, parent?: string|null, name?: string }} o
 */
export function addShape(parts, { shape, box, fill, parent = null, name }) {
  const width = Math.max(4, Math.abs(box.width)), height = Math.max(4, Math.abs(box.height));
  const x = Math.min(box.x, box.x + box.width), y = Math.min(box.y, box.y + box.height);
  const at = [round(x + width / 2), round(y + height / 2)];
  const part = { name: uniqueName(parts, name ?? shape), svg: shapeSvg({ shape, width, height, fill: fill ?? PALETTE[parts.length % PALETTE.length] }),
    at, pivot: [...at], size: [round(width), round(height)], ...(parent ? { parent } : {}) };
  return [...parts, part];
}

const replace = (parts, name, change) => parts.map(p => (p.name === name ? { ...p, ...change(p) } : p));

/** Move a part (its art and its pivot together). */
export const movePart = (parts, name, dx, dy) => replace(parts, name, p => ({ at: [round(p.at[0] + dx), round(p.at[1] + dy)], pivot: [round((p.pivot ?? p.at)[0] + dx), round((p.pivot ?? p.at)[1] + dy)] }));

/** Put a part's pivot (where it turns) at a point. */
export const setPivot = (parts, name, point) => replace(parts, name, () => ({ pivot: [round(point[0]), round(point[1])] }));

/** Resize a part around its centre; a board shape is redrawn at the new size so it stays sharp. */
export function resizePart(parts, name, width, height) {
  if (!(width > 0 && height > 0)) return parts;
  return replace(parts, name, p => {
    const shape = readShape(p.svg);
    return { size: [round(width), round(height)], ...(shape ? { svg: shapeSvg({ ...shape, width, height }) } : {}) };
  });
}

/** Change a board shape's fill or outline; other art is left as drawn. */
export function restyle(parts, name, style) {
  return replace(parts, name, p => {
    const shape = readShape(p.svg);
    return shape ? { svg: shapeSvg({ ...shape, ...style }) } : {};
  });
}

/** Rename a part and the links to it; refuses a bad or taken name with a reason. */
export function renamePart(parts, from, to) {
  const name = String(to ?? '').trim();
  if (name === from) return { parts };
  if (!NAME.test(name)) return { parts, problem: 'bad-name' };
  if (name === 'root' || parts.some(p => p.name === name)) return { parts, problem: 'taken' };
  return { parts: parts.map(p => ({ ...p, ...(p.name === from ? { name } : {}), ...(p.parent === from ? { parent: name } : {}) })) };
}

/** Remove a part; the parts it carried hang from its own parent instead. */
export function removePart(parts, name) {
  const gone = parts.find(p => p.name === name);
  if (!gone) return parts;
  return parts.filter(p => p.name !== name).map(p => {
    if (p.parent !== name) return p;
    const { parent, ...rest } = p;
    return gone.parent ? { ...rest, parent: gone.parent } : rest;
  });
}

/** Move a part toward the front (+1) or the back (-1) of the drawing order. */
export function reorder(parts, name, delta) {
  const i = parts.findIndex(p => p.name === name), j = i + delta;
  if (i < 0 || j < 0 || j >= parts.length) return parts;
  const out = parts.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** The parts a part may hang from: any other part that does not already hang from it. */
export function parentChoices(parts, name) {
  const byName = new Map(parts.map(p => [p.name, p]));
  const carries = candidate => {
    for (let q = byName.get(candidate), guard = 0; q && guard <= parts.length; q = byName.get(q.parent), guard++) if (q.name === name) return true;
    return false;
  };
  return parts.filter(p => p.name !== name && !carries(p.name)).map(p => p.name);
}

/** Hang a part from another (or from the root with null); a loop is refused. */
export function setParent(parts, name, parent) {
  if (parent && !parentChoices(parts, name).includes(parent)) return parts;
  return parts.map(p => {
    if (p.name !== name) return p;
    const { parent: _old, ...rest } = p;
    return parent ? { ...rest, parent } : rest;
  });
}

/** The bones to draw over the art: each part's pivot, joined to its parent's. */
export function bonesOf(parts) {
  const byName = new Map(parts.map(p => [p.name, p]));
  return parts.map(p => ({ name: p.name, at: p.pivot ?? p.at, from: p.parent && byName.has(p.parent) ? (byName.get(p.parent).pivot ?? byName.get(p.parent).at) : null }));
}

/** A part's box in the rig: lower-left corner and size. */
export const boxOf = p => ({ x: p.at[0] - p.size[0] / 2, y: p.at[1] - p.size[1] / 2, width: p.size[0], height: p.size[1] });

/** The box around every part (and pivot), or null for an empty drawing. */
export function drawingBounds(parts) {
  if (!parts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) {
    const b = boxOf(p);
    for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y + b.height], p.pivot ?? p.at]) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The view that fits a box in a canvas of w x h pixels, with a margin; an empty drawing gets a
 * 400 x 400 area around the origin.
 * @returns {{ scale: number, cx: number, cy: number }}
 */
export function fitView(box, w, h, margin = 0.15) {
  const b = box && box.width > 0 && box.height > 0 ? box : { x: -200, y: -100, width: 400, height: 400 };
  const scale = Math.min(w * (1 - 2 * margin) / b.width, h * (1 - 2 * margin) / b.height);
  return { scale: Number.isFinite(scale) && scale > 0 ? scale : 1, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

/** Rig point to canvas pixels (y down). @param {{ scale: number, cx: number, cy: number }} view @param {number} w @param {number} h @param {number[]} point */
export const toScreen = (view, w, h, [x, y]) => [w / 2 + (x - view.cx) * view.scale, h / 2 - (y - view.cy) * view.scale];
/** Canvas pixels to a rig point. @param {{ scale: number, cx: number, cy: number }} view @param {number} w @param {number} h @param {number[]} point */
export const toRig = (view, w, h, [sx, sy]) => [round(view.cx + (sx - w / 2) / view.scale), round(view.cy - (sy - h / 2) / view.scale)];

/** The front-most part under a rig point, or null. @param {object[]} parts @param {number[]} point */
export function partAt(parts, [x, y]) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const b = boxOf(parts[i]);
    if (!parts[i].hidden && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return parts[i].name;
  }
  return null;
}

/** What the board sends to POST /api/drawing: the parts with only the fields draw_rig takes. */
export function savePayload({ name, folder, parts, base }) {
  const keep = ['name', 'svg', 'at', 'pivot', 'parent', 'size', 'blend', 'hidden', 'states', 'frames', 'physics', 'stack', 'taper', 'source'];
  return { name, ...(folder ? { folder } : {}), ...(typeof base === 'string' && base ? { base } : {}),
    parts: parts.map(p => Object.fromEntries(keep.filter(k => p[k] !== undefined && p[k] !== null).map(k => [k, p[k]]))) };
}

/**
 * What the board does with a drawing the AI just drew: play it, or (when the board holds unsaved
 * edits) show a conflict the owner settles. Never a silent drop.
 * @param {{ dirty: boolean }} board
 * @returns {'play' | 'conflict'}
 */
export const incomingAction = board => (board.dirty ? 'conflict' : 'play');

/** The file a save writes: <folder>/<name>.parts.json. */
export const drawingFile = (name, folder) => `${folder ? `${folder}/` : ''}${name}.parts.json`;
