// The reference: the owner's video or image beside the stage, the mark on it, and the learned moves.

import { resizeText } from './chat.js';
import { linkFailure, linkRange, linkWarnings } from './link-text.js';
import { clock } from './stage.js';
import { renderRange } from './timeline.js';
import { S, VIDEO, el } from './store.js';
import { api, baseName, button, fileUrl, node, t } from './ui.js';

// ---------- reference ----------

export const video = () => (S.sync && S.media?.tagName === 'VIDEO' ? S.media : null);
// The reference and the animation run on two clocks. Once a start is marked, stage time 0 is
// that instant of the video, so the marked move plays beside the animation made from it.
export const mediaOffset = () => S.focus?.from ?? 0;
export function seekMedia(time) {
  const v = video();
  if (!v || !Number.isFinite(v.duration)) return;
  try { v.currentTime = Math.min(mediaOffset() + time, Math.max(0, v.duration - 0.01)); } catch { /* not seekable yet */ }
}
export function playMedia() {
  const v = video();
  if (!v || !S.player || S.player.paused) return;
  v.playbackRate = S.speed;
  if (!Number.isFinite(v.duration) || v.currentTime < v.duration - 0.02) v.play().catch(() => {});
}
export function pauseMedia() { video()?.pause(); }
// While the stage plays: restart the video when the animation wraps, and pull it back when it drifts.
export function followMedia(time) {
  const v = video();
  if (!v || !Number.isFinite(v.duration)) return;
  if (time < S.lastTime - 0.05) { seekMedia(time); playMedia(); return; }
  if (mediaOffset() + time >= v.duration) return;
  if (Math.abs(v.currentTime - mediaOffset() - time) > 0.25) seekMedia(time);
  if (v.paused) playMedia();
}

export function placeMedia() {
  if (!S.wrap) return;
  const slot = S.compare ? el.refPaneSlot : el.refThumb;
  if (S.wrap.parentNode !== slot) {
    slot.replaceChildren(S.wrap);
    const c = clock();
    if (c) { seekMedia(c.time); playMedia(); }
  }
}

export function selectRef(rel) {
  S.ref = rel;
  S.wrap?.remove();
  S.media = null; S.wrap = null; S.layer = null; S.area = null;
  S.marking = false; S.drag = null;
  const known = S.state?.focus;
  S.focus = known && known.file === rel ? { region: known.region, from: known.from, to: known.to } : null;
  if (rel) {
    if (VIDEO.test(rel)) {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = fileUrl(rel);
      v.addEventListener('loadedmetadata', () => { const c = clock(); if (c) { seekMedia(c.time); playMedia(); } layoutArea(); });
      S.media = v;
      buildMarkLayer();
    } else {
      const img = document.createElement('img');
      img.alt = baseName(rel); img.src = fileUrl(rel);
      S.media = img;
    }
    S.wrap = node('div', 'media-wrap');
    S.wrap.append(S.media);
    if (S.layer) S.wrap.append(S.layer);
  } else {
    S.compare = false;
  }
  renderRef();
}

export function renderRef() {
  const has = Boolean(S.ref);
  if (!has) S.compare = false;
  el.app.classList.toggle('compare', S.compare);
  el.refPane.hidden = !S.compare;
  el.refThumb.hidden = !has || S.compare;
  el.refEmpty.hidden = has;
  el.refName.hidden = !has;
  el.refName.textContent = has ? baseName(S.ref) : '';
  el.refPaneName.textContent = el.refName.textContent;
  el.refCount.textContent = S.refs.length ? String(S.refs.length) : '';
  el.refCount.hidden = !S.refs.length;
  const isVideo = has && VIDEO.test(S.ref);
  el.refSync.hidden = !isVideo;
  el.refSync.setAttribute('aria-pressed', String(S.sync));
  el.refCompare.hidden = !has;
  el.refCompare.setAttribute('aria-pressed', String(S.compare));
  if (S.media?.tagName === 'VIDEO') S.media.controls = !S.sync;
  placeMedia();
  el.refList.hidden = S.refs.length < 2;
  el.refList.replaceChildren(...S.refs.map(rel => {
    const b = button('btn sm', baseName(rel));
    b.setAttribute('aria-pressed', String(rel === S.ref));
    b.addEventListener('click', () => selectRef(rel));
    return b;
  }));
  renderMark();
  renderLink();
}

// The link intake is an optional add-on (yt-dlp on this computer); without it the field says how to get it.
export function renderLink() {
  const can = S.state?.canFetchLink === true;
  el.refLink.disabled = !can || S.linkBusy;
  el.refLinkGo.disabled = !can || S.linkBusy;
  el.refFrom.disabled = !can || S.linkBusy;
  el.refTo.disabled = !can || S.linkBusy;
  // yt-dlp is an optional add-on: without it the link field is not shown at all (Settings lists it).
  el.refLinkForm.hidden = !can;
  el.refLinkHint.textContent = '';
}

export async function fetchLink(text) {
  const url = text.trim();
  if (!url || S.linkBusy) return;
  // An empty range is the whole video; a range that cannot be read is refused here, in the page language.
  const range = linkRange(el.refFrom.value, el.refTo.value);
  if (!range) {
    el.refStatus.className = 'status bad';
    el.refStatus.textContent = t('ref.linkRangeBad');
    return;
  }
  S.linkBusy = true;
  renderLink();
  el.refStatus.className = 'status';
  el.refStatus.textContent = t('ref.linkBusy');
  try {
    const result = await api('/api/reference/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, ...range }) });
    el.refLink.value = '';
    el.refFrom.value = '';
    el.refTo.value = '';
    if (!S.refs.includes(result.file)) S.refs = [...S.refs, result.file].sort();
    selectRef(result.file);
    el.refStatus.className = 'status';
    el.refStatus.textContent = linkWarnings(t, result);
  } catch (err) {
    el.refStatus.className = 'status bad';
    el.refStatus.textContent = t('ref.failed', { reason: linkFailure(t, err) });
  } finally {
    S.linkBusy = false;
    renderLink();
  }
}

export async function upload(file) {
  if (!file) return;
  el.refStatus.className = 'status';
  el.refStatus.textContent = t('ref.uploading', { name: file.name });
  try {
    const result = await api(`/api/reference?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
    el.refStatus.textContent = '';
    if (!S.refs.includes(result.file)) S.refs = [...S.refs, result.file].sort();
    selectRef(result.file);
  } catch (err) {
    el.refStatus.className = 'status bad';
    el.refStatus.textContent = t('ref.failed', { reason: err.message });
  }
}

// ---------- learn from the reference: one element, one stretch of time ----------

export const round = (value, digits) => Number(value.toFixed(digits));
export const clamp01 = value => Math.max(0, Math.min(1, value));
export const hasMark = () => Boolean(S.focus && (S.focus.region || S.focus.from !== undefined || S.focus.to !== undefined));

// Where the video picture sits inside its element (object-fit: contain leaves bars).
export function picture() {
  const v = S.media;
  const width = S.layer?.clientWidth ?? 0;
  const height = S.layer?.clientHeight ?? 0;
  if (!v?.videoWidth || !v.videoHeight || !width || !height) return null;
  const scale = Math.min(width / v.videoWidth, height / v.videoHeight);
  const w = v.videoWidth * scale;
  const h = v.videoHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export function buildMarkLayer() {
  S.layer = node('div', 'mark-layer');
  S.area = node('div', 'mark-area');
  S.area.hidden = true;
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const handle = node('span', 'mark-handle');
    handle.dataset.corner = corner;
    S.area.append(handle);
  }
  S.layer.append(S.area);
  S.layer.addEventListener('pointerdown', markDown);
  S.layer.addEventListener('pointermove', markMove);
  S.layer.addEventListener('pointerup', markUp);
  S.layer.addEventListener('pointercancel', markUp);
  new ResizeObserver(layoutArea).observe(S.layer);
}

export function layoutArea() {
  if (!S.area) return;
  const region = S.focus?.region;
  const p = region ? picture() : null;
  S.area.hidden = !p;
  if (!p) return;
  Object.assign(S.area.style, {
    left: `${p.x + region.x * p.w}px`, top: `${p.y + region.y * p.h}px`,
    width: `${region.width * p.w}px`, height: `${region.height * p.h}px`,
  });
}

export function pointAt(event) {
  const p = picture();
  if (!p) return null;
  const box = S.layer.getBoundingClientRect();
  return { x: clamp01((event.clientX - box.left - p.x) / p.w), y: clamp01((event.clientY - box.top - p.y) / p.h) };
}
export function regionBetween(a, b) {
  const x = round(Math.min(a.x, b.x), 4);
  const y = round(Math.min(a.y, b.y), 4);
  return { x, y, width: round(Math.max(a.x, b.x) - x, 4), height: round(Math.max(a.y, b.y) - y, 4) };
}

export function markDown(event) {
  if (!S.marking || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const at = pointAt(event);
  if (!at) return;
  event.preventDefault();
  S.layer.setPointerCapture(event.pointerId);
  const before = S.focus?.region ?? null;
  const corner = event.target.dataset?.corner;
  if (corner && before) {
    // Resize from a corner: the opposite corner stays where it is.
    const anchor = { x: corner.includes('w') ? before.x + before.width : before.x, y: corner.includes('n') ? before.y + before.height : before.y };
    S.drag = { mode: 'draw', start: anchor, before };
  } else if (before && event.target === S.area) {
    S.drag = { mode: 'move', start: at, before };
  } else {
    S.drag = { mode: 'draw', start: at, before };
  }
}

export function markMove(event) {
  const drag = S.drag;
  if (!drag) return;
  const at = pointAt(event);
  if (!at) return;
  let region;
  if (drag.mode === 'move') {
    const b = drag.before;
    region = { x: round(Math.max(0, Math.min(1 - b.width, b.x + at.x - drag.start.x)), 4),
      y: round(Math.max(0, Math.min(1 - b.height, b.y + at.y - drag.start.y)), 4), width: b.width, height: b.height };
  } else {
    region = regionBetween(drag.start, at);
  }
  S.focus = { ...(S.focus ?? {}), region };
  layoutArea();
}

export function markUp() {
  const drag = S.drag;
  if (!drag) return;
  S.drag = null;
  const region = S.focus?.region;
  // A click without a drag is not a mark: keep what was there.
  if (!region || region.width < 0.02 || region.height < 0.02) {
    S.focus = { ...(S.focus ?? {}), region: drag.before ?? undefined };
    layoutArea();
    renderMark();
    return;
  }
  renderMark();
  saveFocus();
}

export async function saveFocus() {
  if (!S.ref) return true;
  S.focusEpoch += 1;
  const epoch = S.focusEpoch;
  const f = S.focus ?? {};
  const body = hasMark()
    ? { file: S.ref, ...(f.region ? { region: f.region } : {}), ...(f.from !== undefined ? { from: f.from } : {}), ...(f.to !== undefined ? { to: f.to } : {}) }
    : { clear: true };
  try {
    const result = await api('/api/focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (epoch === S.focusEpoch) { S.focusStamp = result.focus?.time ?? ''; S.focusEpoch += 1; }
    S.markError = '';
    renderMark();
    return true;
  } catch (err) {
    S.markError = err.message;
    renderMark();
    return false;
  }
}

export function setRangeEnd(which) {
  if (S.media?.tagName !== 'VIDEO') return;
  const now = round(S.media.currentTime, 2);
  const f = { ...(S.focus ?? {}) };
  f[which] = now;
  // The range must run forward; the end just set wins.
  if (f.from !== undefined && f.to !== undefined && f.to <= f.from) delete f[which === 'from' ? 'to' : 'from'];
  S.focus = f;
  renderMark();
  saveFocus();
}

export function clearMark() {
  S.focus = null;
  layoutArea();
  renderMark();
  saveFocus();
}

export async function learnMove() {
  if (!hasMark()) return;
  el.markLearn.disabled = true;
  const saved = await saveFocus();
  renderMark();
  if (!saved) return;
  el.text.value = t('mark.sentence');
  resizeText();
  el.text.focus();
  el.text.setSelectionRange(el.text.value.length, el.text.value.length);
}

export let spanDuration = -1;
export function renderSpan(duration) {
  spanDuration = duration;
  const f = S.focus;
  const show = Boolean(f && duration > 0 && (f.from !== undefined || f.to !== undefined) && S.media?.tagName === 'VIDEO');
  // On the stage clock the marked range starts at 0 (see mediaOffset); an open end runs to the clip's end.
  if (!show) renderRange(undefined, undefined, duration);
  else renderRange(f.from ?? 0, Math.min(f.to ?? Infinity, (f.from ?? 0) + duration), duration);
}

export function renderMark() {
  const isVideo = S.media?.tagName === 'VIDEO';
  el.markTools.hidden = !isVideo;
  if (!isVideo) S.marking = false;
  el.refCard.classList.toggle('marking', S.marking && !S.compare);
  S.layer?.classList.toggle('on', S.marking);
  el.markToggle.setAttribute('aria-pressed', String(S.marking));
  const f = S.focus ?? {};
  const marked = hasMark();
  const seconds = value => value.toFixed(2);
  const range = f.from !== undefined && f.to !== undefined ? t('mark.range', { from: seconds(f.from), to: seconds(f.to) })
    : f.from !== undefined ? t('mark.from', { from: seconds(f.from) }) : f.to !== undefined ? t('mark.to', { to: seconds(f.to) }) : '';
  el.markRange.hidden = !range;
  el.markRange.textContent = range;
  el.markClear.hidden = !marked;
  const canRead = S.state?.canReadVideo !== false;
  el.markLearn.disabled = !marked || !canRead;
  el.markHint.className = S.markError ? 'status bad' : 'quiet';
  el.markHint.textContent = S.markError ? t('mark.failed', { reason: S.markError })
    : !canRead ? t('mark.noFfmpeg') : S.marking && !f.region ? t('mark.drawHint') : !marked ? t('mark.hint') : '';
  renderSpan(spanDuration);
}

export let libraryKey = null;
export function renderLibrary() {
  const library = S.state?.library ?? [];
  const key = `${S.lang}\n${JSON.stringify(library)}`;
  if (key === libraryKey) return;
  libraryKey = key;
  el.libraryEmpty.hidden = library.length > 0;
  el.moves.replaceChildren(...library.map(move => {
    const row = node('button', 'move');
    row.type = 'button';
    row.append(node('b', '', move.name));
    if (Number.isFinite(move.duration)) row.append(node('span', '', t('library.seconds', { value: move.duration.toFixed(2) })));
    for (const channel of move.channels ?? []) row.append(node('span', 'chip', channel));
    if (move.note) row.append(node('span', 'move-note', move.note));
    row.addEventListener('click', () => {
      el.text.value = t('library.apply', { name: move.name });
      resizeText();
      el.text.focus();
      el.text.setSelectionRange(el.text.value.length, el.text.value.length);
    });
    const item = node('li');
    item.append(row);
    return item;
  }));
}
