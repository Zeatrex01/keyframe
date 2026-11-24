// State from the server: what the stage shows, and the poll that keeps the page current.

import { addMessage, renderAgent } from './chat.js';
import { refreshDelivery, renderDelivery } from './delivery.js';
import { layoutArea, renderLibrary, renderLink, renderMark, renderRef, selectRef } from './reference.js';
import { counterpart, stageFile } from './stage-pick.js';
import { entry, forgetShownTime, loadPlayer, renderStageNote, renderTransport, setClip, togglePlay } from './stage.js';
import { S } from './store.js';
import { hasNewMessages } from './chat-rules.js';
import { api } from './ui.js';
import { refreshLanes } from './timeline.js';
import { showView, switchedProject } from './views.js';

// ---------- state from the server ----------


// The owner flips the stage between a delivery and its base; the clip stays if the other has it.
export function flipStage() {
  if (!S.state || !S.shown) return;
  const other = counterpart(S.state.skeletons, S.shown.file);
  if (!other) return;
  S.picked = other.file === S.state.show?.file ? null : other.file;
  applyState(S.state);
}

// The owner picks a skeleton in the stage's file menu; it stays until the server proposes something new.
export function pickStage(file) {
  if (!S.state || !S.state.skeletons.some(s => s.file === file)) return;
  S.picked = file === S.state.show?.file ? null : file;
  applyState(S.state);
}

export function applyState(state, epoch = S.focusEpoch) {
  S.state = state;
  renderAgent();

  const show = state.show;
  const serverShow = show ? `${show.file}\n${show.animation ?? ''}` : '';
  const askedAnew = serverShow !== S.serverShow;
  // Something new from the server (a fresh "ready") takes the stage back from the owner's flip.
  if (askedAnew) S.picked = null;
  const file = stageFile(state.skeletons, show?.file ?? null, S.picked);
  if (file !== S.picked) S.picked = null;
  const shown = file ? state.skeletons.find(s => s.file === file) ?? null : null;
  const key = shown ? `${shown.file}\n${shown.modified}\n${shown.atlas ?? ''}` : '';
  const fileChanged = shown?.file !== S.shown?.file;
  S.serverShow = serverShow;
  S.shown = shown;
  if (shown) {
    if (askedAnew && show.animation) S.anim = show.animation;
    if (!S.anim || !shown.animations.includes(S.anim)) S.anim = shown.animations[0] ?? null;
  } else {
    S.anim = null;
  }
  if (key !== S.shownKey) {
    S.shownKey = key;
    loadPlayer();
    if (!fileChanged) S.deliveryMessage = S.deliveryMessage?.tone === 'ok' ? S.deliveryMessage : null; else S.deliveryMessage = null;
    refreshDelivery();
  } else if (askedAnew && S.anim && entry() && entry().animation.name !== S.anim) {
    setClip(S.anim);
    if (S.player.paused) togglePlay();
  }
  renderStageNote();
  renderTransport();
  refreshLanes();

  const refs = state.references ?? [];
  if (refs.join('\n') !== S.refs.join('\n')) {
    S.refs = refs;
    const marked = state.focus && refs.includes(state.focus.file) ? state.focus.file : null;
    if (!S.ref || !refs.includes(S.ref)) selectRef(marked ?? refs[0] ?? null); else renderRef();
  }
  // Take the saved mark from the server unless the owner is changing it right now.
  const stamp = state.focus?.time ?? '';
  if (stamp !== S.focusStamp && epoch === S.focusEpoch && !S.drag) {
    S.focusStamp = stamp;
    S.focus = state.focus && state.focus.file === S.ref ? { region: state.focus.region, from: state.focus.from, to: state.focus.to } : null;
    layoutArea();
  }
  renderMark();
  renderLink();
  renderLibrary();
}

export let polling = false;
export async function poll() {
  if (polling) return;
  polling = true;
  try {
    const epoch = S.focusEpoch;
    const state = await api('/api/state');
    const dir = state.project?.dir ?? null;
    if (dir !== S.projectDir) switchedProject(dir);
    // The conversation is fetched only when the state says there is something past the cursor.
    const chat = dir && hasNewMessages(state, S.lastId) ? await api(`/api/messages?after=${S.lastId}`) : { messages: [] };
    S.online = true;
    for (const message of chat.messages ?? []) addMessage(message);
    applyState(state, epoch);
    if (!dir && (S.view === 'work' || S.view === 'draw')) showView('projects');
  } catch {
    S.online = false;
    renderAgent();
  } finally {
    polling = false;
  }
}

export function renderAll() {
  renderAgent();
  renderStageNote();
  renderTransport();
  renderRef();
  renderLibrary();
  renderDelivery();
  forgetShownTime();
}
