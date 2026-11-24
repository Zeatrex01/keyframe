// The drawing board: placeholder art as parts, each with its pivot and the part that carries it.
// "Use in the project" sends the parts to draw_rig (POST /api/drawing), which builds the rig the
// stage plays. The board edits only drawings the studio made (<name>.parts.json); the owner's own
// files are never touched. The rules live in draw-model.js; this module draws and listens.

import { S, el } from './store.js';
import { api, button, node, t } from './ui.js';
import { addShape, bonesOf, boxOf, drawingBounds, fitView, movePart, parentChoices, partAt, readShape, removePart, renamePart, reorder,
  resizePart, restyle, savePayload, setParent, setPivot, toRig, toScreen, uniqueName, formatNumber, parseNumber, PALETTE, NAME, MAX_PARTS } from './draw-model.js';

const SVG = 'http://www.w3.org/2000/svg';
const UNDO_KEEP = 60;
const TOOLS = { v: 'select', e: 'ellipse', r: 'rect', o: 'pivot' };

/** The board's state: one drawing at a time. */
const D = {
  list: null,            // the project's drawings (GET /api/drawings)
  file: '',              // the drawing's parts.json, or '' for a new one
  name: 'drawing', folder: 'art',
  parts: [], sel: null, tool: 'select', bones: true,
  view: null, undo: [], dirty: false, busy: false, gesture: null, project: undefined, leaving: false,
};

const svgNode = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const size = () => ({ w: Math.max(1, el.drawSvg.clientWidth), h: Math.max(1, el.drawSvg.clientHeight) });
const selected = () => D.parts.find(p => p.name === D.sel) ?? null;
const say = (key, vars, tone = '') => { el.drawStatus.textContent = key ? t(key, vars) : ''; el.drawStatus.className = `status${tone ? ` ${tone}` : ''}`; };

/** Change the parts, keeping the old ones for Undo (one step per gesture). */
function commit(parts, { keep = true } = {}) {
  if (parts === D.parts) return;
  if (keep) { D.undo.push(D.parts); if (D.undo.length > UNDO_KEEP) D.undo.shift(); }
  D.parts = parts;
  D.dirty = true;
  if (D.sel && !parts.some(p => p.name === D.sel)) D.sel = null;
  say('');
  render();
}

function undo() {
  if (!D.undo.length) return;
  D.parts = D.undo.pop();
  D.dirty = true;
  if (D.sel && !D.parts.some(p => p.name === D.sel)) D.sel = null;
  render();
}

function fit() {
  const { w, h } = size();
  D.view = fitView(drawingBounds(D.parts), w, h);
  render();
}

// ---------- loading ----------

/** Called when the board opens: list the project's drawings and open one (or a new one). */
export async function showDraw() {
  if (D.project !== S.projectDir) {
    Object.assign(D, { list: null, file: '', name: 'drawing', parts: [], sel: null, undo: [], dirty: false, view: null, project: S.projectDir });
  }
  render();
  try {
    D.list = (await api('/api/drawings')).drawings;
    if (!D.file && !D.dirty && D.list.length) await openDrawing(D.list[0].file);
    else render();
  } catch (err) { say('draw.loadFailed', { reason: err.message }, 'bad'); }
  if (!D.view) fit();
}

async function openDrawing(file) {
  if (!file) {
    Object.assign(D, { file: '', name: uniqueName((D.list ?? []).map(d => ({ name: d.name })), 'drawing'), folder: 'art', parts: [], sel: null, undo: [], dirty: false });
    fit();
    return;
  }
  const doc = await api(`/api/drawing?file=${encodeURIComponent(file)}`);
  Object.assign(D, { file, name: doc.name, folder: doc.folder ?? '', parts: doc.parts ?? [], sel: null, undo: [], dirty: false });
  fit();
}

async function save() {
  const name = el.drawName.value.trim();
  if (!NAME.test(name)) { say('draw.badName', {}, 'bad'); el.drawName.focus(); return; }
  if (!D.parts.length) { say('draw.nothing', {}, 'bad'); return; }
  D.busy = true; render();
  say('draw.saving');
  try {
    const result = await api('/api/drawing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(savePayload({ name, folder: D.folder, parts: D.parts })) });
    D.name = name;
    D.file = `${D.folder ? `${D.folder}/` : ''}${name}.parts.json`;
    D.dirty = false;
    D.list = (await api('/api/drawings')).drawings;
    say('draw.saved', { file: result.file }, 'ok');
  } catch (err) {
    say(err.code === 'not-ours' ? 'draw.notOurs' : 'draw.saveFailed', { reason: err.message, name }, 'bad');
  }
  D.busy = false;
  render();
}

// ---------- drawing ----------

export function renderDraw() {
  if (!el.draw || el.draw.hidden) return;
  render();
}

function render() {
  for (const b of el.drawTools.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === D.tool));
  el.drawStage.dataset.tool = D.tool;
  el.drawBones.setAttribute('aria-pressed', String(D.bones));
  if (document.activeElement !== el.drawName) el.drawName.value = D.name;
  el.drawUndo.disabled = !D.undo.length;
  el.drawSave.disabled = D.busy || !D.parts.length;
  renderPicker();
  renderParts();
  renderCanvas();
  renderProps();
}

function renderPicker() {
  const options = (D.list ?? []).map(d => {
    const o = node('option', '', d.file);
    o.value = d.file;
    return o;
  });
  const fresh = node('option', '', t('draw.new'));
  fresh.value = '';
  el.drawPick.replaceChildren(...options, fresh);
  el.drawPick.value = D.file;
}

function renderParts() {
  el.drawCount.textContent = t('draw.count', { parts: D.parts.length });
  const rows = D.parts.slice().reverse().map(p => {
    const row = node('li', `part${p.name === D.sel ? ' sel' : ''}`);
    const b = button('', p.name, readShape(p.svg)?.shape === 'rect' ? 'i-square' : readShape(p.svg) ? 'i-circle' : 'i-spark');
    b.dataset.part = p.name;
    b.setAttribute('aria-pressed', String(p.name === D.sel));
    b.append(node('span', 'muted mono', p.parent ?? ''));
    b.addEventListener('click', () => { D.sel = p.name; render(); });
    row.append(b);
    return row;
  });
  el.drawParts.replaceChildren(...rows);
  const bones = D.parts.length;
  el.drawSummary.textContent = D.parts.length ? t('draw.summary', { parts: D.parts.length, bones }) : '';
}

function renderCanvas() {
  const { w, h } = size();
  if (!D.view) D.view = fitView(drawingBounds(D.parts), w, h);
  const view = D.view;
  const at = point => toScreen(view, w, h, point);
  el.drawSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const layer = [];
  // The origin: where the rig's root sits.
  const [ox, oy] = at([0, 0]);
  layer.push(svgNode('path', { d: `M${ox - 10} ${oy}H${ox + 10}M${ox} ${oy - 10}V${oy + 10}`, class: 'origin' }));
  for (const p of D.parts) {
    if (p.hidden) continue;
    const b = boxOf(p);
    const [x, y] = at([b.x, b.y + b.height]);
    const image = svgNode('image', { x, y, width: b.width * view.scale, height: b.height * view.scale, preserveAspectRatio: 'none', 'data-part': p.name });
    image.setAttribute('href', `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.svg)}`);
    layer.push(image);
  }
  if (D.bones) {
    const g = svgNode('g', { class: 'bones' });
    for (const bone of bonesOf(D.parts)) {
      const [x1, y1] = at(bone.at);
      if (bone.from) { const [x0, y0] = at(bone.from); g.append(svgNode('path', { d: `M${x0} ${y0}L${x1} ${y1}` })); }
      g.append(svgNode('circle', { cx: x1, cy: y1, r: 3, class: 'joint' }));
    }
    layer.push(g);
  }
  const part = selected();
  if (part) {
    const b = boxOf(part);
    const [x, y] = at([b.x, b.y + b.height]);
    layer.push(svgNode('rect', { x, y, width: b.width * view.scale, height: b.height * view.scale, class: 'selection' }));
    const [px, py] = at(part.pivot ?? part.at);
    const ring = svgNode('g', { class: 'pivot' });
    ring.append(svgNode('circle', { cx: px, cy: py, r: 5 }), svgNode('path', { d: `M${px - 11} ${py}h4M${px + 7} ${py}h4M${px} ${py - 11}v4M${px} ${py + 7}v4` }));
    layer.push(ring);
  }
  const g = D.gesture;
  if (g?.mode === 'create' && g.now) {
    const [x0, y0] = at(g.start), [x1, y1] = at(g.now);
    layer.push(svgNode(g.shape === 'rect' ? 'rect' : 'ellipse', g.shape === 'rect'
      ? { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0), class: 'ghost' }
      : { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: Math.abs(x1 - x0) / 2, ry: Math.abs(y1 - y0) / 2, class: 'ghost' }));
  }
  el.drawSvg.replaceChildren(...layer);
  el.drawEmpty.hidden = D.parts.length > 0 || Boolean(g);
  el.drawZoom.textContent = `${Math.round(view.scale * 100)}%`;
}

// ---------- part settings ----------

function field(labelKey, control, hint) {
  const f = node('div', 'field');
  const id = `drawField-${labelKey.replace(/\W/g, '')}`;
  control.id = control.id || id;
  const label = node('label', '', t(labelKey));
  label.htmlFor = control.id;
  f.append(label, control);
  if (hint) f.append(node('p', 't-caption', hint));
  return f;
}
function numberInput(value, onSet, label) {
  const input = node('input', 'input mono');
  // Text, not type=number: a number field shows the system's decimal comma ("80,15") whatever the
  // page's language. The board always writes a point and reads either.
  input.type = 'text'; input.inputMode = 'decimal'; input.spellcheck = false; input.value = formatNumber(value);
  if (label) input.setAttribute('aria-label', label);
  input.addEventListener('change', () => { const v = parseNumber(input.value); if (v !== null) onSet(v); else render(); });
  return input;
}
function pair(labelKey, values, onSet, hint) {
  const f = node('div', 'field');
  f.append(node('span', 'field-name', t(labelKey)));
  const g = node('div', 'grid2');
  g.append(numberInput(values[0], v => onSet([v, values[1]]), `${t(labelKey)} x`), numberInput(values[1], v => onSet([values[0], v]), `${t(labelKey)} y`));
  f.append(g);
  if (hint) f.append(node('p', 't-caption', hint));
  return f;
}

function renderProps() {
  const p = selected();
  el.drawPartTitle.textContent = p ? p.name : t('draw.noPart');
  const shape = p ? readShape(p.svg) : null;
  el.drawPartKind.hidden = !p;
  el.drawPartKind.textContent = shape ? t(`draw.kind.${shape.shape}`) : t('draw.kind.art');
  if (!p) { el.drawProps.replaceChildren(node('p', 't-caption', t('draw.pickPart'))); return; }
  const out = [];

  const name = node('input', 'input mono');
  name.value = p.name; name.spellcheck = false;
  name.addEventListener('change', () => {
    const r = renamePart(D.parts, p.name, name.value);
    if (r.problem) { say(r.problem === 'taken' ? 'draw.nameTaken' : 'draw.badName', {}, 'bad'); name.value = p.name; return; }
    D.sel = name.value.trim();
    commit(r.parts);
  });
  out.push(field('draw.partName', name));

  if (shape) {
    const swatches = node('div', 'swatches');
    for (const colour of PALETTE) {
      const sw = node('button', `sw${shape.fill.toUpperCase() === colour ? ' on' : ''}`);
      sw.type = 'button'; sw.style.background = colour; sw.setAttribute('aria-label', colour);
      sw.setAttribute('aria-pressed', String(shape.fill.toUpperCase() === colour));
      sw.addEventListener('click', () => commit(restyle(D.parts, p.name, { fill: colour })));
      swatches.append(sw);
    }
    const custom = node('input', 'sw custom');
    custom.type = 'color'; custom.value = /^#[0-9a-f]{6}$/i.test(shape.fill) ? shape.fill : '#ffffff';
    custom.setAttribute('aria-label', t('draw.customColour'));
    custom.addEventListener('change', () => commit(restyle(D.parts, p.name, { fill: custom.value.toUpperCase() })));
    swatches.append(custom);
    const f = node('div', 'field');
    f.append(node('span', 'field-name', t('draw.fill')), swatches);
    out.push(f);
    const row = node('div', 'input-row');
    const colour = node('input', 'outline-colour');
    colour.type = 'color'; colour.value = /^#[0-9a-f]{6}$/i.test(shape.stroke) ? shape.stroke : '#2e2a52';
    colour.setAttribute('aria-label', t('draw.outlineColour'));
    const width = numberInput(shape.strokeWidth, v => commit(restyle(D.parts, p.name, { stroke: colour.value.toUpperCase(), strokeWidth: Math.max(0, v) })), t('draw.outlineWidth'));
    colour.addEventListener('change', () => commit(restyle(D.parts, p.name, { stroke: colour.value.toUpperCase(), strokeWidth: Math.max(1, shape.strokeWidth) })));
    row.append(colour, width);
    const o = node('div', 'field');
    o.append(node('span', 'field-name', t('draw.outline')), row);
    out.push(o);
  } else {
    out.push(node('p', 't-caption', t('draw.artNote')));
  }

  out.push(pair('draw.size', p.size, v => commit(resizePart(D.parts, p.name, v[0], v[1]))));
  out.push(pair('draw.position', p.at, v => commit(movePart(D.parts, p.name, v[0] - p.at[0], v[1] - p.at[1]))));
  out.push(pair('draw.pivot', p.pivot ?? p.at, v => commit(setPivot(D.parts, p.name, v)), t('draw.pivotHint')));

  const parent = node('select', 'select');
  const root = node('option', '', t('draw.root'));
  root.value = '';
  parent.append(root, ...parentChoices(D.parts, p.name).map(n => { const o = node('option', '', n); o.value = n; return o; }));
  parent.value = p.parent ?? '';
  parent.addEventListener('change', () => commit(setParent(D.parts, p.name, parent.value || null)));
  out.push(field('draw.parent', parent, t('draw.parentHint')));

  const acts = node('div', 'input-row');
  const back = button('btn sm', t('draw.back'), 'i-down');
  back.addEventListener('click', () => commit(reorder(D.parts, p.name, -1)));
  const front = button('btn sm', t('draw.front'), 'i-up');
  front.addEventListener('click', () => commit(reorder(D.parts, p.name, 1)));
  const remove = button('btn sm ghost', t('draw.remove'), 'i-trash');
  remove.addEventListener('click', () => commit(removePart(D.parts, p.name)));
  acts.append(back, front, remove);
  out.push(acts);
  el.drawProps.replaceChildren(...out);
}

// ---------- the canvas: select and move, draw a shape, place a pivot ----------

const pointOf = event => {
  const r = el.drawSvg.getBoundingClientRect();
  const { w, h } = size();
  return toRig(D.view, w, h, [event.clientX - r.left, event.clientY - r.top]);
};

el.drawSvg.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !D.view) return;
  const pt = pointOf(event);
  try { el.drawSvg.setPointerCapture(event.pointerId); } catch { /* a synthetic pointer */ }
  if (D.tool === 'ellipse' || D.tool === 'rect') {
    if (D.parts.length >= MAX_PARTS) { say('draw.tooMany', { max: MAX_PARTS }, 'bad'); return; }
    D.gesture = { mode: 'create', shape: D.tool, start: pt, now: null, screen: [event.clientX, event.clientY] };
    return;
  }
  if (D.tool === 'pivot') {
    const target = D.sel ?? partAt(D.parts, pt);
    if (!target) return;
    D.sel = target;
    D.gesture = { mode: 'pivot', before: D.parts };
    commit(setPivot(D.parts, target, pt), { keep: false });
    return;
  }
  const hit = partAt(D.parts, pt);
  D.sel = hit;
  D.gesture = hit ? { mode: 'move', last: pt, before: D.parts } : null;
  render();
});

el.drawSvg.addEventListener('pointermove', event => {
  const g = D.gesture;
  if (!g) return;
  const pt = pointOf(event);
  if (g.mode === 'create') { g.now = pt; renderCanvas(); return; }
  if (g.mode === 'pivot') { D.parts = setPivot(D.parts, D.sel, pt); D.dirty = true; render(); return; }
  if (g.mode === 'move') {
    const dx = pt[0] - g.last[0], dy = pt[1] - g.last[1];
    if (!dx && !dy) return;
    g.last = pt;
    D.parts = movePart(D.parts, D.sel, dx, dy); D.dirty = true;
    render();
  }
});

function endGesture(event) {
  const g = D.gesture;
  D.gesture = null;
  if (!g) return;
  if (g.mode === 'create') {
    const pt = g.now ?? g.start;
    const dragged = Math.hypot(event.clientX - g.screen[0], event.clientY - g.screen[1]) > 6;
    // A click without a drag places a shape of a usable size at the click.
    const side = 80 / Math.max(D.view.scale, 0.01);
    const box = dragged ? { x: g.start[0], y: g.start[1], width: pt[0] - g.start[0], height: pt[1] - g.start[1] } : { x: g.start[0] - side / 2, y: g.start[1] - side / 2, width: side, height: side };
    const parts = addShape(D.parts, { shape: g.shape, box, parent: D.sel ?? null });
    D.sel = parts.at(-1).name;
    D.tool = 'select';
    commit(parts);
    return;
  }
  // A move or a pivot drag is one step for Undo.
  if (g.before && g.before !== D.parts) { D.undo.push(g.before); if (D.undo.length > UNDO_KEEP) D.undo.shift(); }
  render();
}
el.drawSvg.addEventListener('pointerup', endGesture);
el.drawSvg.addEventListener('pointercancel', endGesture);

el.drawSvg.addEventListener('wheel', event => {
  if (!D.view) return;
  event.preventDefault();
  const before = pointOf(event);
  const factor = Math.exp(-event.deltaY * 0.0015);
  D.view = { ...D.view, scale: Math.min(40, Math.max(0.05, D.view.scale * factor)) };
  const after = pointOf(event);
  D.view = { ...D.view, cx: D.view.cx + before[0] - after[0], cy: D.view.cy + before[1] - after[1] };
  renderCanvas();
}, { passive: false });

// ---------- controls ----------

el.drawTools.addEventListener('click', event => {
  const tool = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest?.('[data-tool]'))?.dataset.tool;
  if (tool) { D.tool = tool; render(); }
});
el.drawBones.addEventListener('click', () => { D.bones = !D.bones; render(); });
el.drawZoom.addEventListener('click', fit);
el.drawUndo.addEventListener('click', undo);
el.drawSave.addEventListener('click', save);
el.drawName.addEventListener('change', () => { D.name = el.drawName.value.trim() || D.name; D.dirty = true; });
el.drawPick.addEventListener('change', async () => {
  if (D.dirty && !confirmLeave()) { el.drawPick.value = D.file; return; }
  try { await openDrawing(el.drawPick.value); } catch (err) { say('draw.loadFailed', { reason: err.message }, 'bad'); }
});
// Leaving unsaved changes asks once, in the page (no browser dialog).
function confirmLeave() {
  if (D.leaving) { D.leaving = false; return true; }
  D.leaving = true;
  say('draw.unsaved', {}, 'bad');
  return false;
}

document.addEventListener('keydown', event => {
  if (el.draw.hidden || event.altKey) return;
  if (/** @type {HTMLElement} */ (event.target).closest?.('input, textarea, select, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); undo(); return; }
  if (event.ctrlKey || event.metaKey) return;
  if (TOOLS[key]) { D.tool = TOOLS[key]; render(); return; }
  const p = selected();
  if (!p) return;
  if (key === 'delete' || key === 'backspace') { event.preventDefault(); commit(removePart(D.parts, p.name)); return; }
  const step = (event.shiftKey ? 10 : 1) / Math.max(D.view?.scale ?? 1, 0.01);
  const move = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, step], arrowdown: [0, -step] }[key];
  if (move) { event.preventDefault(); commit(movePart(D.parts, p.name, move[0], move[1])); }
});

new ResizeObserver(() => { if (!el.draw.hidden && D.view) renderCanvas(); }).observe(el.drawStage);

/** The wand: ask the AI to draw, in the conversation. */
export function askToDraw(showWork) {
  showWork();
  el.text.value = t('draw.askFill');
  el.text.dispatchEvent(new Event('input', { bubbles: true }));
  el.text.focus();
  el.text.setSelectionRange(el.text.value.length, el.text.value.length);
}

export const drawState = D; // for the e2e gate
