// The key lanes under the transport: read-only, drawn from the file the stage shows (the same
// file the player loads), one lane per bone or slot and channel, keys as channel-coloured
// diamonds, the amber playhead, and the reference's marked range in violet. Clicking or dragging
// on the ruler or the lanes moves the playhead; the ruler is a slider for the keyboard. Clicking a
// bone lane's name draws that channel's curve under the lanes (read-only: values over time, the
// eases between the keys), with the same playhead.

import { CHANNEL_COLOUR, along, laneCurve, lanesFromAnimation, rulerTicks } from './lanes.js';
import { clock, renderTransport, seek } from './stage.js';
import { S, el } from './store.js';
import { fileUrl, node, t } from './ui.js';
import { isKeyframeDocument, toSkeletonJson } from '/src/engine/keyframe-format.js';

const FRAME = 1 / 30;
let source = { key: '', json: null };   // the skeleton JSON of the file on the stage
let drawn = '';                         // what the lanes show now (file, clip, language)
let lastX = -1;

const place = (element, x, w) => {
  element.style.setProperty('--x', x.toFixed(4));
  if (w !== undefined) element.style.setProperty('--w', w.toFixed(4));
};

/** Fetch the skeleton of the file on the stage when it changed, then draw its lanes. */
export function refreshLanes() {
  const shown = S.shown;
  const key = shown ? `${shown.file}\n${shown.modified}` : '';
  if (key !== source.key) {
    source = { key, json: null };
    if (shown) {
      fetch(fileUrl(shown.file)).then(r => (r.ok ? r.json() : null)).then(json => {
        if (source.key !== key) return;
        source.json = json && isKeyframeDocument(json) ? toSkeletonJson(json) : json;
        renderLanes();
      }).catch(() => {});
    }
  }
  renderLanes();
}

/** Draw the lanes of the clip on the stage (only when the file, the clip or the language changed). */
export function renderLanes() {
  const model = source.json && S.anim ? lanesFromAnimation(source.json, S.anim) : null;
  const key = `${source.key}\n${S.anim}\n${S.lang}\n${Boolean(model)}`;
  if (key === drawn) return;
  drawn = key;
  lastX = -1;
  const has = Boolean(model && model.lanes.length);
  el.timeline.hidden = !has;
  el.keysEmpty.hidden = has;
  if (!has) return;
  const { duration, lanes } = model;
  const ticks = rulerTicks(duration);
  const ruler = [];
  for (const time of ticks.major) {
    const label = node('span', '', time.toFixed(ticks.step < 0.1 ? 2 : ticks.step < 1 ? 2 : 1));
    const mark = node('i');
    place(label, along(time, duration)); place(mark, along(time, duration));
    ruler.push(label, mark);
  }
  for (const time of [0, duration, ...ticks.minor]) {
    const mark = node('i', ticks.minor.includes(time) ? 'minor' : '');
    place(mark, along(time, duration));
    ruler.push(mark);
  }
  el.ruler.replaceChildren(...ruler);
  el.ruler.setAttribute('aria-valuemax', duration.toFixed(2));
  el.laneLabels.replaceChildren(...lanes.map(lane => {
    const label = node('div', `label${lane.child ? ' child' : ''}`);
    if (lane.kind === 'bone' && CURVED.has(lane.channel)) {
      const id = `${lane.target}\n${lane.channel}`;
      label.dataset.lane = id;
      label.classList.add('pick');
      label.tabIndex = 0;
      label.setAttribute('role', 'button');
      label.setAttribute('aria-pressed', String(S.curveLane === id));
      const pick = () => { S.curveLane = S.curveLane === id ? '' : id; renderCurve(); };
      label.addEventListener('click', pick);
      label.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); } });
    }
    const swatch = node('span', 'sw');
    swatch.style.background = `var(${CHANNEL_COLOUR[lane.channel]})`;
    label.append(swatch, node('span', 'target', lane.kind === 'events' ? t('keys.events') : lane.target));
    if (lane.kind !== 'events') label.append(node('span', 'channel', t(`keys.channel.${lane.channel}`)));
    label.title = lane.kind === 'events' ? t('keys.events') : `${lane.target} · ${t(`keys.channel.${lane.channel}`)}${label.dataset.lane ? ` — ${t('keys.curveHint')}` : ''}`;
    return label;
  }));
  const rows = lanes.map(lane => {
    const row = node('div', 'lane');
    const colour = `var(${CHANNEL_COLOUR[lane.channel]})`;
    if (lane.kind !== 'events' && lane.keys.length > 1) {
      const span = node('span', 'span');
      const a = along(lane.keys[0], duration), b = along(lane.keys[lane.keys.length - 1], duration);
      place(span, a, b - a);
      span.style.background = colour;
      row.append(span);
    }
    for (const time of lane.keys) {
      const k = node('span', lane.kind === 'events' ? 'k ev' : 'k');
      place(k, along(time, duration));
      k.style.background = colour;
      k.title = `${time.toFixed(2)} s`;
      row.append(k);
    }
    return row;
  });
  el.lanes.replaceChildren(...rows, el.laneRange, el.playhead);
  renderCurve();
}

const CURVED = new Set(['rotate', 'move', 'scale', 'shear']);
const SVG = 'http://www.w3.org/2000/svg';
let curvePlayhead = null;

/** Draw the picked lane's curve under the lanes, or hide it. */
function renderCurve() {
  for (const label of el.laneLabels.querySelectorAll('[data-lane]')) label.setAttribute('aria-pressed', String(label.dataset.lane === S.curveLane));
  const [target, channel] = S.curveLane ? S.curveLane.split('\n') : [];
  const curve = target && source.json && S.anim ? laneCurve(source.json, S.anim, target, channel) : null;
  el.curve.hidden = el.curveLabel.hidden = !curve;
  curvePlayhead = null;
  if (!curve) { el.curve.replaceChildren(); el.curveLabel.replaceChildren(); return; }
  const { min, max, series, keys, duration } = curve;
  const colour = `var(${CHANNEL_COLOUR[channel]})`;
  const y = v => 92 - (v - min) / (max - min) * 84;   // 8 % margin top and bottom
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  if (min < 0 && max > 0) {
    const zero = document.createElementNS(SVG, 'line');
    zero.setAttribute('x1', '0'); zero.setAttribute('x2', '1000'); zero.setAttribute('y1', String(y(0))); zero.setAttribute('y2', String(y(0)));
    zero.setAttribute('class', 'zero');
    svg.append(zero);
  }
  series.forEach((s, i) => {
    const line = document.createElementNS(SVG, 'polyline');
    line.setAttribute('points', s.points.map(([time, v]) => `${(along(time, duration) * 1000).toFixed(1)},${y(v).toFixed(2)}`).join(' '));
    line.setAttribute('class', i ? 'second' : 'first');
    line.style.stroke = colour;
    svg.append(line);
  });
  const marks = keys.map(time => {
    const k = node('span', 'k');
    place(k, along(time, duration));
    // The key sits on the first curve at its time.
    const first = series[0].points.reduce((best, p) => (Math.abs(p[0] - time) < Math.abs(best[0] - time) ? p : best));
    k.style.setProperty('--y', (y(first[1]) / 100).toFixed(4));
    k.style.background = colour;
    k.title = `${time.toFixed(2)} s`;
    return k;
  });
  curvePlayhead = node('span', 'playhead');
  place(curvePlayhead, Math.max(0, lastX));   // where the lanes' playhead is now, paused or not
  el.curve.replaceChildren(svg, ...marks, curvePlayhead);
  const unit = series[0].unit;
  const digits = Math.max(Math.abs(min), Math.abs(max)) >= 10 ? 1 : 2;
  const fmt = v => v.toFixed(digits);
  el.curveLabel.replaceChildren(
    node('span', 'target', t('keys.curveOf', { target, channel: t(`keys.channel.${channel}`) })),
    node('span', 'range', t('keys.curveRange', { min: fmt(min), max: fmt(max), unit })),
    ...series.map((s, i) => node('span', `series${i ? ' second' : ''}`, s.property)));
}

/** Move the playhead and the slider's value with the clock (called every frame by the stage). */
export function renderPlayhead(time, duration) {
  const x = along(time, duration);
  if (Math.abs(x - lastX) < 1e-4) return;
  lastX = x;
  place(el.playhead, x);
  if (curvePlayhead) place(curvePlayhead, x);
  el.ruler.setAttribute('aria-valuenow', time.toFixed(2));
  el.ruler.setAttribute('aria-valuetext', t('keys.at', { time: time.toFixed(2), duration: duration.toFixed(2) }));
}

/** Show the reference's marked stretch on the lanes (stage time 0 is the start of the mark). */
export function renderRange(from, to, duration) {
  const show = duration > 0 && from !== undefined && to !== undefined;
  el.laneRange.hidden = !show;
  if (show) place(el.laneRange, 0, along(to - from, duration));
}

// ---------- scrubbing: the ruler and the lanes, by pointer and by keyboard ----------

function timeAt(event) {
  const c = clock();
  if (!c) return null;
  const box = el.ruler.getBoundingClientRect();
  // Keys sit inside a 12 px inset on both ends (components.css), so the mapping uses the same.
  const x = (event.clientX - box.left - 12) / Math.max(1, box.width - 24);
  return { c, time: Math.max(0, Math.min(1, x)) * c.duration };
}

let dragging = false;
function scrubTo(event) {
  const at = timeAt(event);
  if (!at) return;
  seek(at.time);
  renderTransport();
}
for (const area of [el.ruler, el.lanes]) {
  area.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging = true;
    area.setPointerCapture(event.pointerId);
    scrubTo(event);
  });
  area.addEventListener('pointermove', event => { if (dragging) scrubTo(event); });
  area.addEventListener('pointerup', () => { dragging = false; });
  area.addEventListener('pointercancel', () => { dragging = false; });
}
el.ruler.addEventListener('keydown', event => {
  const c = clock();
  if (!c) return;
  const step = event.shiftKey ? 10 * FRAME : FRAME;
  const to = { ArrowRight: c.time + step, ArrowUp: c.time + step, ArrowLeft: c.time - step, ArrowDown: c.time - step, Home: 0, End: c.duration }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  seek(Math.max(0, Math.min(c.duration, to)));
  renderTransport();
});
