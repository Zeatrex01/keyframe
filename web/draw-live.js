// The live drawing: when the AI draws (draw_rig), the board shows each part being drawn as it
// arrives: its outlines are traced, then its fills come in, with the part's name on the canvas and
// the view following it. Replay draws the open drawing again; the speed menu sets the pace, and
// "instant" (or the system's reduced-motion setting) shows the parts at once.
//
// The parts come as safe trees (src/render/svg-safe.js: only shapes, groups and gradients with
// their geometry and paint), built here with createElementNS and setAttribute, so nothing in a
// part can run. The rules (timing, sessions, following) live in draw-live-model.js.

import { S, el } from './store.js';
import { api, t } from './ui.js';
import { board } from './draw.js';
import { showView } from './views.js';
import { boxOf, fitView, drawingBounds, toScreen } from './draw-model.js';
import { SPEEDS, DEFAULT_SPEED, speedOf, revealSchedule, gapAfter, sessionsOf, follow } from './draw-live-model.js';

const SVG = 'http://www.w3.org/2000/svg';
const KEY = 'keyframe.drawSpeed';
const D = board.D;
const L = { cursor: null, fetching: false, queue: [], playing: false, stop: false, speed: readSpeed(), timers: [] };

function readSpeed() {
  try { return speedOf(localStorage.getItem(KEY)); } catch { return DEFAULT_SPEED; }
}
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const speedNow = () => (reduced() ? 0 : L.speed);
const wait = ms => new Promise(resolve => { if (!(ms > 0)) { resolve(); return; } const id = setTimeout(resolve, ms); L.timers.push(id); });

/** One element of a safe tree (attributes are already filtered by the server). */
function build(node) {
  const n = document.createElementNS(SVG, node.tag);
  for (const [k, v] of Object.entries(node.attrs ?? {})) n.setAttribute(k, v);
  for (const c of node.children ?? []) n.append(build(c));
  return n;
}
const at = (root, trail) => trail.reduce((n, i) => n?.children?.[i] ?? null, root);

/** Draw one part on the live layer, tracing its outlines then filling it; resolves when it is done. */
async function drawPart(part, tree) {
  const { w, h } = board.size();
  D.view = follow(D.view ?? fitView(drawingBounds(D.parts), w, h), boxOf(part), w, h);
  board.render();
  const speed = speedNow(), plan = revealSchedule(tree, speed);
  el.drawLiveLabel.textContent = t('draw.liveDrawing', { part: part.name });
  el.drawLiveLabel.hidden = false;
  if (!tree || !plan.duration) { D.pending.delete(part.name); board.render(); return; }
  const b = boxOf(part), [x, y] = toScreen(D.view, w, h, [b.x, b.y + b.height]);
  el.drawLive.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const holder = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ x, y, width: b.width * D.view.scale, height: b.height * D.view.scale, viewBox: tree.viewBox.join(' '), preserveAspectRatio: 'none', overflow: 'visible' })) holder.setAttribute(k, String(v));
  const content = document.createElementNS(SVG, 'g');
  for (const c of tree.children) content.append(build(c));
  holder.append(content);
  el.drawLive.replaceChildren(holder);
  // Everything starts unseen: outlines as an undrawn dash, fills transparent.
  const shapes = plan.steps.map(step => ({ step, node: at(content, step.trail) })).filter(s => s.node);
  for (const { step, node } of shapes) {
    if (step.kind === 'fill') node.style.fillOpacity = '0';
    else {
      let len = 0;
      try { len = node.getTotalLength(); } catch { len = 0; }
      const total = Math.max(1, len) * 1.02;
      node.style.strokeDasharray = `${total} ${total}`;
      node.style.strokeDashoffset = String(total);
      node.dataset.len = String(total);
    }
  }
  const animations = shapes.map(({ step, node }) => {
    const options = { delay: step.start, duration: step.duration, easing: step.kind === 'stroke' ? 'cubic-bezier(.45,.05,.35,1)' : 'ease-out', fill: 'forwards' };
    if (step.kind === 'stroke') return node.animate([{ strokeDashoffset: node.dataset.len }, { strokeDashoffset: '0' }], options);
    const target = node.getAttribute('fill-opacity') ?? '1';
    return node.animate([{ fillOpacity: '0' }, { fillOpacity: target }], options);
  });
  await wait(plan.duration);
  for (const a of animations) a.cancel?.();
  D.pending.delete(part.name);
  board.render();
  el.drawLive.replaceChildren();
}

/** Play the queued parts one after another. */
async function play() {
  if (L.playing) return;
  L.playing = true;
  el.drawReplay.disabled = true;
  try {
    while (L.queue.length && !L.stop) {
      const { part, tree, last } = L.queue.shift();
      await drawPart(part, tree);
      if (!last) await wait(gapAfter(speedNow()));
    }
  } finally {
    L.playing = false; L.stop = false;
    for (const name of [...D.pending]) D.pending.delete(name);
    el.drawLive.replaceChildren();
    el.drawLiveLabel.hidden = true;
    el.drawReplay.disabled = !D.parts.length;
    board.render();
  }
}

/** A session from the feed: open its drawing (its new parts hidden), then draw them in order. */
async function playSession(session) {
  if (!session.parts.length) return;
  if (D.dirty) return;   // never take the board from unsaved edits
  // Hidden before the board opens, so the new parts never flash in whole before they are drawn.
  const names = new Set(session.parts.map(e => e.part.name));
  for (const n of names) D.pending.add(n);
  if (S.view !== 'draw') showView('draw');
  try {
    const doc = await api(`/api/drawing?file=${encodeURIComponent(session.file)}`);
    Object.assign(D, { file: session.file, name: doc.name, folder: doc.folder ?? '', parts: doc.parts ?? [], trees: doc.trees ?? {}, sel: null, undo: [], dirty: false });
    D.list = (await api('/api/drawings')).drawings;
  } catch { for (const n of names) D.pending.delete(n); board.render(); return; }
  if (!D.view) { const { w, h } = board.size(); D.view = fitView(drawingBounds(D.parts), w, h); }
  board.render();
  session.parts.forEach((e, i) => L.queue.push({ part: D.parts.find(p => p.name === e.part.name) ?? e.part, tree: e.tree, last: i === session.parts.length - 1 }));
  await play();
  board.say(session.done ? 'draw.liveDone' : '', { parts: session.parts.length, file: session.file }, 'ok');
}

/**
 * Called by the poll with the feed's newest number: fetch what is new and draw it. The first call
 * only takes the cursor, so opening the page never replays old drawings.
 * @param {number} last
 */
export async function liveFeed(last) {
  if (!Number.isInteger(last)) return;
  if (L.cursor === null || last < L.cursor) { L.cursor = last; return; }
  if (last <= L.cursor || L.fetching) return;
  L.fetching = true;
  try {
    const { events } = await api(`/api/draw-feed?since=${L.cursor}`);
    L.cursor = Math.max(L.cursor, ...events.map(e => e.seq));
    const fresh = events.filter(e => e.seq > D.feedSkip);   // the board's own save is not drawn again
    for (const session of sessionsOf(fresh)) await playSession(session);
  } catch { /* the next poll tries again */ }
  L.fetching = false;
}

/** Forget the cursor (another project opened): the next poll takes it afresh, and a drawing in play stops. */
export function resetLive() { L.cursor = null; L.queue = []; L.stop = L.playing; }

/** Replay: draw the open drawing again from the first part. */
function replay() {
  if (L.playing || !D.parts.length) return;
  for (const p of D.parts) if (!p.hidden) D.pending.add(p.name);
  D.parts.filter(p => !p.hidden).forEach((p, i, all) => L.queue.push({ part: p, tree: D.trees?.[p.name] ?? null, last: i === all.length - 1 }));
  play();
}

/** The speed menu, in the page's language (sync.js renderAll calls it after a language switch). */
export function renderSpeed() {
  el.drawSpeed.replaceChildren(...SPEEDS.map(v => { const o = document.createElement('option'); o.value = String(v); o.textContent = v ? `${v}×` : t('draw.instant'); return o; }));
  el.drawSpeed.value = String(L.speed);
}
el.drawSpeed.addEventListener('change', () => {
  L.speed = speedOf(el.drawSpeed.value);
  try { localStorage.setItem(KEY, String(L.speed)); } catch { /* a convenience only */ }
});
el.drawReplay.addEventListener('click', replay);
renderSpeed();
