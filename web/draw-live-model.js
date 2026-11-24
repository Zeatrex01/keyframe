// The rules of the live drawing, without the page: how long a part takes to draw, when each of its
// shapes is traced and filled, which feed events to play, and where the view moves to follow the
// part being drawn. draw-live.js does the drawing; node tests read these rules directly.

/** Speeds the page offers; 0 is instant. */
export const SPEEDS = Object.freeze([0.5, 1, 2, 4, 0]);
export const DEFAULT_SPEED = 1;
/** A stored or chosen speed, or the default when there is none (an empty value is not instant). */
export function speedOf(value) {
  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_SPEED;
  const v = Number(value);
  return SPEEDS.includes(v) ? v : DEFAULT_SPEED;
}
const PART_MS = 1400;      // one part at speed 1: outlines first, then fills
const GAP_MS = 120;        // a beat between two parts

/** The shapes of a safe tree in drawing order, with the path of child indices that reaches each. */
export function shapesOf(tree) {
  const out = [];
  const walk = (nodes, trail) => nodes.forEach((n, i) => {
    if (n.tag === 'defs' || n.tag === 'linearGradient' || n.tag === 'radialGradient' || n.tag === 'stop') return;
    if (n.tag === 'g') { walk(n.children ?? [], [...trail, i]); return; }
    out.push({ trail: [...trail, i], tag: n.tag, stroked: paints(n, 'stroke', trail, tree), filled: n.tag !== 'line' && n.tag !== 'polyline' ? paints(n, 'fill', trail, tree) : false });
  });
  walk(tree?.children ?? [], []);
  return out;
}

// Whether a shape (or the group it inherits from) paints this channel. Fill defaults to black, stroke to none.
function paints(node, key, trail, tree) {
  let value = node.attrs?.[key];
  if (value === undefined) {
    let nodes = tree.children, found;
    for (const i of trail) { const g = nodes[i]; if (g?.attrs?.[key] !== undefined) found = g.attrs[key]; nodes = g?.children ?? []; }
    value = found;
  }
  if (value === undefined) return key === 'fill';
  return value !== 'none' && value !== 'transparent';
}

/**
 * When each shape of one part is traced and filled, in ms from the part's start.
 * @param {{ children: object[] } | null} tree  the part's safe tree (null: the part just appears)
 * @param {number} speed  1 normal, 2 twice as fast, 0 instant
 * @returns {{ duration: number, steps: Array<{ trail: number[], kind: 'stroke' | 'fill', start: number, duration: number }> }}
 */
export function revealSchedule(tree, speed = DEFAULT_SPEED) {
  if (!tree || !(speed > 0)) return { duration: 0, steps: [] };
  const total = PART_MS / speed;
  const shapes = shapesOf(tree);
  const stroked = shapes.filter(s => s.stroked), filled = shapes.filter(s => s.filled);
  const strokePhase = stroked.length ? total * 0.6 : 0;
  const steps = [];
  // Outlines one after another, overlapping, so the pen seems to move on.
  stroked.forEach((s, i) => {
    const start = Math.round(i * strokePhase * 0.55 / Math.max(1, stroked.length));
    steps.push({ trail: s.trail, kind: 'stroke', start, duration: Math.max(60, Math.round(strokePhase - start)) });
  });
  // Fills after the outline is mostly down, back to front.
  const fillStart = stroked.length ? strokePhase * 0.7 : 0, fillPhase = total - fillStart;
  filled.forEach((s, i) => {
    const start = Math.round(fillStart + i * fillPhase * 0.4 / Math.max(1, filled.length));
    steps.push({ trail: s.trail, kind: 'fill', start, duration: Math.max(60, Math.round(total - start)) });
  });
  return { duration: Math.round(total), steps };
}

/** The pause after a part before the next one starts. */
export const gapAfter = speed => (speed > 0 ? Math.round(GAP_MS / speed) : 0);

/**
 * Group feed events into drawing sessions: each `start` opens one, its `part`s follow and `done`
 * closes it. Events of a session whose start was missed (the page opened mid-way) still play.
 * @param {object[]} events
 * @returns {Array<{ rig: string, file: string, parts: object[], done: boolean, total: number }>}
 */
export function sessionsOf(events) {
  const out = [];
  let current = null;
  for (const e of events ?? []) {
    if (!e || typeof e !== 'object') continue;
    if (e.kind === 'start' || !current || current.file !== e.file) {
      current = { rig: e.rig, file: e.file, parts: [], done: false, total: e.total ?? 0 };
      out.push(current);
    }
    if (e.kind === 'part' && e.part?.name) current.parts.push(e);
    if (e.kind === 'done') { current.done = true; current.total = e.total ?? current.total; current = null; }
  }
  return out;
}

/**
 * The view to use so a part's box stays on screen: unchanged when the box is already inside the
 * visible area (with a margin), else centred on the box at the same scale.
 * @param {{ cx: number, cy: number, scale: number }} view  rig point at the screen centre, px per unit
 * @param {{ x: number, y: number, width: number, height: number }} box  in rig units, y up
 * @param {number} w @param {number} h  the canvas in px
 */
export function follow(view, box, w, h) {
  const halfW = w / 2 / view.scale, halfH = h / 2 / view.scale, mx = halfW * 0.1, my = halfH * 0.1;
  const inside = box.x >= view.cx - halfW + mx && box.x + box.width <= view.cx + halfW - mx
    && box.y >= view.cy - halfH + my && box.y + box.height <= view.cy + halfH - my;
  if (inside) return view;
  return { ...view, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}
