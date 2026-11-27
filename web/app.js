// The studio page: the conversation on one side, the stage on the other.
// It reads state and files, sends the owner's words, uploads a reference and can restore a
// backup. It never writes a skeleton. Every visible string comes from /locale/<lang>.json.
//
// This module wires the page together and starts it; each part lives in its own module.

import { resizeText, sendMessage, stopAgent } from './chat.js';
import { askToDraw } from './draw.js';
import { clearMark, fetchLink, learnMove, pauseMedia, playMedia, renderMark, renderRef, seekMedia, setRangeEnd, upload } from './reference.js';
import { clock, frame, renderTransport, setBlend, setClip, setLoop, setOverlay, setSpeed, togglePlay } from './stage.js';
import { POLL_MS, S, el } from './store.js';
import { flipStage, pickStage, poll } from './sync.js';
import { setPhoneTab, setTab, showPanel } from './panels.js';
import { setLang, setTheme, storedLang, storedTheme, t } from './ui.js';
import { closeOpening, opening, playOpening, showView } from './views.js';
import { loadUpdate } from './update.js';

// ---------- wiring ----------

el.text.addEventListener('input', () => { S.sendError = ''; resizeText(); });
el.text.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); }
});
el.compose.addEventListener('submit', event => { event.preventDefault(); sendMessage(); });
el.stopAgent.addEventListener('click', stopAgent);
el.modeAnimate.addEventListener('click', () => showView('work'));
el.modeDraw.addEventListener('click', () => showView('draw'));
el.drawAsk.addEventListener('click', () => askToDraw(() => showView('work')));
el.attach.addEventListener('click', () => el.refFile.click());

el.play.addEventListener('click', togglePlay);
el.flipSource.addEventListener('click', flipStage);
el.flipResult.addEventListener('click', flipStage);
el.stageFile.addEventListener('change', () => pickStage(el.stageFile.value));
el.deliveryFlip.addEventListener('click', flipStage);
el.deliveryVersions.addEventListener('click', () => showPanel('versions'));
el.player.addEventListener('click', togglePlay);
el.clip.addEventListener('change', () => { setClip(el.clip.value); renderTransport(); });
el.loop.addEventListener('click', () => setLoop(!S.loop));
el.overlay.addEventListener('change', () => setOverlay(el.overlay.value));
el.blend.addEventListener('click', () => setBlend(!S.blend));
el.speed.addEventListener('click', event => {
  const value = Number(event.target.closest('button')?.dataset.speed);
  if (value) setSpeed(value);
});

document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/** @type {HTMLElement} */ (event.target).closest?.('textarea, input, select, button, a, video, [contenteditable]')) return;
  event.preventDefault();
  togglePlay();
});

el.refAdd.addEventListener('click', () => el.refFile.click());
el.refLinkForm.addEventListener('submit', event => { event.preventDefault(); fetchLink(el.refLink.value); });
el.refFile.addEventListener('change', () => { if (el.refFile.files[0]) showPanel('reference'); upload(el.refFile.files[0]); el.refFile.value = ''; });
el.refSync.addEventListener('click', () => {
  if (S.sync) pauseMedia();
  S.sync = !S.sync;
  renderRef();
  const c = clock();
  if (S.sync && c) { seekMedia(c.time); playMedia(); }
});
el.refCompare.addEventListener('click', () => { S.compare = !S.compare; renderRef(); });
el.markToggle.addEventListener('click', () => { S.marking = !S.marking; renderMark(); });
el.markStart.addEventListener('click', () => setRangeEnd('from'));
el.markEnd.addEventListener('click', () => setRangeEnd('to'));
el.markClear.addEventListener('click', clearMark);
el.markLearn.addEventListener('click', learnMove);

const carriesFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragover', event => { if (carriesFiles(event)) event.preventDefault(); });
window.addEventListener('drop', event => { if (carriesFiles(event)) event.preventDefault(); });
// A video or an image dropped anywhere on the studio becomes a reference.
el.app.addEventListener('dragover', event => { if (carriesFiles(event)) el.app.classList.add('drop'); });
el.app.addEventListener('dragleave', event => { if (!el.app.contains(event.relatedTarget)) el.app.classList.remove('drop'); });
el.app.addEventListener('drop', event => {
  el.app.classList.remove('drop');
  if (!carriesFiles(event)) return;
  showPanel('reference');
  upload(event.dataTransfer.files[0]);
});

document.body.dataset.ready = '1';
setTheme(storedTheme());
setTab(S.tab);
setPhoneTab(S.phoneTab);
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => setTheme(storedTheme()));
await setLang(storedLang()).catch(() => {});
resizeText();
playOpening();
// The window can open before the studio answers (it is still starting, or it was closed):
// say so on the opening and keep trying, then show the page.
await poll();
while (!S.online) {
  el.splashStatus.textContent = t('splash.offline');
  await new Promise(done => setTimeout(done, 1500));
  await poll();
}
el.splashStatus.textContent = '';
// The installed app's worker is registered once the studio answers: registering while it is still
// starting (the window can open first) fails with "An unknown error occurred when fetching the script".
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
showView(location.hash.slice(1) || 'work');
// The installed app asks once at start whether a newer version is out (only if the owner left that on).
loadUpdate();
await opening;
closeOpening();
setInterval(poll, POLL_MS);
requestAnimationFrame(frame);
