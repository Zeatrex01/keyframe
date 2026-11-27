// The stage: the studio's own player (or the official one when the Spine add-on is on), driven by
// the page's own transport.

import { followMedia, pauseMedia, playMedia, renderSpan, seekMedia, spanDuration } from './reference.js';
import { counterpart } from './stage-pick.js';
import { PHYSICS_UPDATE, S, el } from './store.js';
import { baseName, fileUrl, node, plainText, t } from './ui.js';
import { renderClips } from './panels.js';
import { renderLanes, renderPlayhead } from './timeline.js';
import { playerClass } from './keyframe-player.js';

// ---------- stage: the player, driven by our own transport ----------

export const entry = () => (S.ready ? S.player?.animationState?.getCurrent(0) ?? null : null);

export function stageNote(kind, title, body) {
  el.stageNote.hidden = !kind;
  el.stageNote.classList.toggle('bad', kind === 'error');
  el.stageNoteTitle.textContent = title ?? '';
  el.stageNoteBody.textContent = body ?? '';
}

export function renderStageNote() {
  if (!S.state) return stageNote(null);
  if (!S.shown) return stageNote('empty', t('stage.emptyTitle'), t('stage.emptyBody', { name: S.state.project?.name ?? '' }));
  if (!S.shown.atlas) return stageNote('error', t('stage.noAtlasTitle'), t('stage.noAtlasBody', { file: S.shown.file }));
  if (S.stageError) return stageNote('error', t('stage.errorTitle'), S.stageError);
  return stageNote(null);
}

export function disposePlayer() {
  S.token += 1;
  S.ready = false;
  const old = S.player;
  S.player = null;
  if (old) { try { old.dispose(); } catch { /* already gone */ } }
  el.player.replaceChildren();
}

export function loadPlayer() {
  disposePlayer();
  S.stageError = null;
  renderStageNote();
  renderTransport();
  const shown = S.shown;
  if (!shown || !shown.atlas) return;
  const token = S.token;
  const host = node('div');
  el.player.append(host);
  const config = {
    skeleton: fileUrl(shown.file), atlas: fileUrl(shown.atlas),
    premultipliedAlpha: false, showControls: false, backgroundColor: '#00000000', alpha: true,
    success: player => { if (token === S.token) playerReady(player); },
    error: (player, reason) => { if (token === S.token) { S.stageError = plainText(reason); S.ready = false; el.player.replaceChildren(); renderStageNote(); renderTransport(); } },
  };
  if (S.anim) config.animation = S.anim;
  try { S.player = new (playerClass())(host, config); }
  catch (err) { S.stageError = String(err?.message ?? err); renderStageNote(); }
}

export function playerReady(player) {
  S.ready = true;
  frameClip(player, S.anim);
  player.animationState.data.defaultMix = 0;
  player.speed = S.speed;
  if (S.anim && player.skeleton.data.findAnimation(S.anim)) player.setAnimation(S.anim, S.loop);
  if ('mix' in player) player.mix = S.blend ? 0.2 : 0;
  if (S.overlay && typeof player.setLayer === 'function' && player.skeleton.data.findAnimation(S.overlay)) player.setLayer(S.overlay, { mix: 0 });
  player.play();
  S.lastTime = 0;
  seekMedia(0);
  playMedia();
  renderTransport();
}

export function clock() {
  const e = entry();
  if (!e) return null;
  const duration = e.animation.duration;
  const raw = e.trackTime;
  const time = duration <= 0 ? 0 : (S.loop ? raw % duration : Math.min(raw, duration));
  return { e, duration, time, ended: !S.loop && raw >= duration };
}

// Put the skeleton at a time while paused: the player does not apply the state when paused.
export function pose(e, time) {
  e.trackTime = time;
  S.player.animationState.apply(S.player.skeleton);
  S.player.skeleton.updateWorldTransform(PHYSICS_UPDATE);
}

export function seek(time) {
  const c = clock();
  if (!c) return;
  S.player.pause();
  pauseMedia();
  pose(c.e, Math.max(0, Math.min(time, S.loop ? c.duration - 0.0001 : c.duration)));
  S.lastTime = time;
  seekMedia(time);
}

export function togglePlay() {
  const c = clock();
  if (!c) return;
  if (S.player.paused) {
    if (c.ended) { c.e.trackTime = 0; seekMedia(0); }
    S.player.play();
    playMedia();
  } else {
    S.player.pause();
    pauseMedia();
  }
  renderTransport();
}

/**
 * Frame the stage on a clip: the setup pose and everything the clip draws (the studio's player
 * knows each clip's box), so a small overlay clip is not lost in the box of a big one and an arm
 * at its lowest is not cut off. The official player frames the whole rig once.
 */
export function frameClip(player, name) {
  const data = player.skeleton.data;
  const box = (name && data.frameOf?.(name)) || data;
  if (box && box.width > 0 && box.height > 0) Object.assign(player.config.viewport, { x: box.x, y: box.y, width: box.width, height: box.height });
}

export function setClip(name) {
  S.anim = name;
  if (S.overlay === name) { S.overlay = ''; S.player?.setLayer?.(null, { mix: 0 }); }
  if (!S.ready || !S.player.skeleton.data.findAnimation(name)) return;
  frameClip(S.player, name);
  const wasPaused = S.player.paused;
  S.player.setAnimation(name, S.loop);
  const e = entry();
  if (wasPaused && e) pose(e, 0);
  S.lastTime = 0;
  seekMedia(0);
}

/** Play a clip over the stage's clip (track 1, fading in), or '' for none. The official player has no layer menu. */
export function setOverlay(name) {
  S.overlay = name && name !== S.anim ? name : '';
  if (S.ready && typeof S.player.setLayer === 'function') S.player.setLayer(S.overlay || null);
  renderTransport();
}

/** Crossfade into the next clip (0.2 s) instead of cutting. */
export function setBlend(on) {
  S.blend = on;
  if (S.player && 'mix' in S.player) S.player.mix = on ? 0.2 : 0;
  renderTransport();
}

export function setLoop(on) {
  S.loop = on;
  const c = entry();
  if (c) {
    const duration = c.animation.duration;
    if (on && duration > 0) c.trackTime %= duration;
    c.loop = on;
  }
  renderTransport();
}

export function setSpeed(value) {
  S.speed = value;
  if (S.player) S.player.speed = value;
  if (S.media?.tagName === 'VIDEO') S.media.playbackRate = value;
  renderTransport();
}

export function renderTransport() {
  const animations = S.shown?.animations ?? [];
  const wanted = animations.join('\n');
  if (el.clip.dataset.names !== wanted) {
    el.clip.dataset.names = wanted;
    el.clip.replaceChildren(...(animations.length ? animations : ['']).map(name => {
      const option = node('option', '', name || t('stage.noClips'));
      option.value = name;
      return option;
    }));
  } else if (!animations.length && el.clip.options[0]) {
    el.clip.options[0].textContent = t('stage.noClips');
  }
  if (S.anim && animations.includes(S.anim)) el.clip.value = S.anim;
  const live = Boolean(entry());
  el.clip.disabled = !animations.length;
  // The layer menu: any other clip over this one (the studio's own player only).
  const layering = typeof S.player?.setLayer === 'function';
  const overlays = ['', ...animations.filter(n => n !== S.anim)];
  const wantedOverlays = `${S.lang}\n${overlays.join('\n')}`;
  if (el.overlay.dataset.names !== wantedOverlays) {
    el.overlay.dataset.names = wantedOverlays;
    el.overlay.replaceChildren(...overlays.map(name => { const o = node('option', '', name || t('stage.noLayer')); o.value = name; return o; }));
  }
  el.overlay.value = overlays.includes(S.overlay) ? S.overlay : '';
  el.overlay.disabled = !live || !layering || animations.length < 2;
  el.overlay.hidden = !layering;
  el.blend.hidden = !layering;
  el.blend.setAttribute('aria-pressed', String(S.blend));
  el.blend.title = t('stage.blendHint');
  el.play.disabled = !live;
  el.loop.setAttribute('aria-pressed', String(S.loop));
  for (const b of el.speed.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === S.speed));
  const paused = !live || S.player.paused;
  const wantIcon = paused ? '#i-play' : '#i-pause';
  if (el.playIcon.getAttribute('href') !== wantIcon) {
    el.playIcon.setAttribute('href', wantIcon);
    const label = t(paused ? 'stage.play' : 'stage.pause');
    el.play.setAttribute('aria-label', label);
    el.play.title = label;
  }
  renderFlip();
  renderClips();
  renderLanes();
}

// The Original / Result switch on the stage: which file it shows, and the other one when there is one.
export function renderFlip() {
  el.stageFlipWrap.hidden = !S.shown;
  if (!S.shown) return;
  const result = S.shown.role === 'delivery';
  const other = S.state ? counterpart(S.state.skeletons, S.shown.file) : null;
  el.flipResult.setAttribute('aria-pressed', String(result));
  el.flipSource.setAttribute('aria-pressed', String(!result));
  el.flipResult.hidden = !result && !other;
  el.flipSource.hidden = result && !other;
  el.flipResult.disabled = result;
  el.flipSource.disabled = !result;
  // The file menu: every skeleton of the project, so a rig drawn on the board (or another
  // character) can be put on the stage; one skeleton is just its name.
  const files = (S.state?.skeletons ?? []).map(s => s.file);
  if (el.stageFile.dataset.files !== files.join('\n')) {
    el.stageFile.dataset.files = files.join('\n');
    el.stageFile.replaceChildren(...files.map(file => { const o = node('option', '', file.includes('/') ? file : baseName(file)); o.value = file; return o; }));
  }
  el.stageFile.value = S.shown.file;
  el.stageFile.disabled = files.length < 2;
  el.stageFile.title = S.shown.file;
}

export let shownTime = '';
export function frame() {
  requestAnimationFrame(frame);
  const c = clock();
  if (c && c.ended && !S.player.paused) {
    S.player.pause();
    pauseMedia();
    pose(c.e, c.duration);
    renderTransport();
  }
  const time = c ? c.time : 0;
  const duration = c ? c.duration : 0;
  const text = `${time.toFixed(2)} / ${duration.toFixed(2)}`;
  if (text !== shownTime) {
    shownTime = text;
    el.time.replaceChildren(node('b', '', time.toFixed(2)), document.createTextNode(` / ${duration.toFixed(2)} s`));
    renderPlayhead(time, duration);
  }
  if (duration !== spanDuration) renderSpan(duration);
  if (c && !S.player.paused) followMedia(time);
  S.lastTime = time;
}
export function forgetShownTime() { shownTime = ''; }
