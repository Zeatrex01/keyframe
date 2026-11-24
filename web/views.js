// The other views: Projects, Settings, and the opening at every start.

import { loadUpdate } from './update.js';
import { loadDesktop } from './connect.js';
import { disposePlayer } from './stage.js';
import { S, el } from './store.js';
import { loadProjects, placeProjects } from './projects.js';
import { loadAgentSlots, renderCheck } from './agent-slots.js';
import { showDraw } from './draw.js';
import { api, icon, node, setLang, setTheme, t } from './ui.js';
import { KeyframePlayer, loadSpineAddon } from './keyframe-player.js';

// ---------- projects, settings and the opening ----------

// Another project is open (or none): forget everything that belonged to the last one.
export function switchedProject(dir) {
  S.projectDir = dir;
  S.seen.clear(); S.lastId = 0;
  for (const row of [...el.msgs.querySelectorAll('.msg')]) row.remove();
  el.chatEmpty.hidden = false;
  // A key no state has: the next state always differs, so the stage and the delivery card are redrawn
  // even when the new project has nothing to show (no card of the last project stays behind).
  S.shownKey = '\0switched'; S.serverShow = ''; S.shown = null; S.picked = null; S.anim = null; S.refs = []; S.ref = null; S.focus = null; S.focusStamp = null;
  S.check = null; S.history = null; S.deliveryMessage = null;
  disposePlayer();
  el.modeSwitch.hidden = !dir || (S.view !== 'work' && S.view !== 'draw');
  if (dir && S.view === 'draw') showDraw();
}

export const VIEWS = ['work', 'draw', 'projects', 'settings'];
export function showView(view) {
  if (!VIEWS.includes(view)) view = 'work';
  if ((view === 'work' || view === 'draw') && !S.projectDir && S.state) view = 'projects';
  S.view = view;
  el.app.hidden = view !== 'work';
  el.tabbar.hidden = view !== 'work';
  el.draw.hidden = view !== 'draw';
  // Animate / Draw: the two ways to work on the open project.
  el.modeSwitch.hidden = !S.projectDir || (view !== 'work' && view !== 'draw');
  el.modeAnimate.setAttribute('aria-selected', String(view === 'work'));
  el.modeDraw.setAttribute('aria-selected', String(view === 'draw'));
  placeProjects();
  el.settings.hidden = view !== 'settings';
  for (const [button, name] of [[el.navProjects, 'projects'], [el.projectSwitch, 'projects'], [el.navSettings, 'settings']]) {
    if (view === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  const hash = view === 'work' ? '' : `#${view}`;
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname);
  if (view === 'projects') loadProjects();
  if (view === 'draw') showDraw();
  if (view === 'settings') loadSettings();
}

export async function loadSettings() {
  try { S.settings = await api('/api/settings'); renderSettings(); loadAgentSlots(); loadUpdate(); }
  catch (err) { el.checkText.textContent = String(err.message ?? err); }
}

export function renderSettings() {
  const s = S.settings;
  if (!s) return;
  renderClient();
  // Optional programs: what each adds, whether it is here, and how to add it. Nothing else asks.
  el.addonList.replaceChildren(...(s.addons ?? []).map(addon => {
    const row = node('li', 'addon');
    const badge = node('span', 'aic');
    badge.append(icon(ADDON_ICONS[addon.id] ?? 'i-puzzle'));
    const text = node('div', 'grow');
    const head = node('div', 'addon-head');
    const chip = node('span', `chip${addon.installed ? ' ok' : ''}`);
    if (addon.installed) chip.append(icon('i-check'));
    chip.append(document.createTextNode(t(addon.installed ? 'settings.addonInstalled' : 'settings.addonMissing')));
    head.append(node('b', '', addon.name), chip);
    text.append(head, node('p', 't-caption', t(`settings.addon.${addon.id}`)));
    if (!addon.installed) text.append(node('code', 'mono addon-install', addon.install));
    row.append(badge, text);
    return row;
  }));
  renderSpineAddon(s.spine);
  el.aboutTitle.textContent = t('settings.aboutName', { version: s.version });
  el.aboutFolder.textContent = s.root;
  el.aboutData.textContent = s.data ?? '';
  renderCheck();
}

// The Spine add-on: off by default, with the license stated before anything is downloaded.
export function renderSpineAddon(spine) {
  if (!spine) { el.spineAddon.hidden = true; return; }
  el.spineAddon.hidden = false;
  el.spineState.textContent = t(spine.on ? 'settings.spineOn' : 'settings.spineOff', { version: spine.version });
  el.spineState.classList.toggle('ok', spine.on);
  el.spineAccept.closest('label').hidden = spine.on;
  el.spineToggle.textContent = t(spine.on ? 'settings.spineDisable' : 'settings.spineEnable');
  el.spineToggle.disabled = !spine.on && !el.spineAccept.checked;
  el.spineLicense.href = spine.licenseUrl;
  if (spine.on) loadSpineAddon();
}

async function toggleSpineAddon() {
  const on = !S.settings?.spine?.on;
  el.spineToggle.disabled = true;
  el.spineStatus.textContent = on ? t('settings.spineInstalling') : '';
  try {
    const spine = await api('/api/addons/spine', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on, acceptLicense: on ? el.spineAccept.checked : undefined }) });
    S.settings = { ...S.settings, spine };
    el.spineStatus.textContent = on ? t('settings.spineInstalled') : t('settings.spineRemoved');
  } catch (err) { el.spineStatus.textContent = String(err.message ?? err); }
  renderSpineAddon(S.settings?.spine);
}
el.spineAccept.addEventListener('change', () => renderSpineAddon(S.settings?.spine));
el.spineToggle.addEventListener('click', toggleSpineAddon);

const ADDON_ICONS = { ffmpeg: 'i-video', ytdlp: 'i-link', spineCli: 'i-terminal' };
/** Where each connection snippet goes, by the client the owner picked. */
const CLIENT_WHERE = { claudeCommand: 'settings.whereClaude', claudeDesktop: 'connect.whereDesktop', codexToml: 'settings.whereCodex', claudeJson: 'settings.whereOther' };
let client = 'claudeCommand';
function renderClient() {
  const connection = S.settings?.connection ?? {};
  for (const b of el.settingsClient.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.client === client));
  el.clientCode.textContent = connection[client] ?? '';
  el.clientWhere.textContent = t(CLIENT_WHERE[client]);
  // Claude Code can also take the settings file the other apps use.
  el.clientMore.hidden = client !== 'claudeCommand';
  el.settingsDesktop.hidden = client !== 'claudeDesktop';
  if (client === 'claudeDesktop') loadDesktop();
  el.clientJson.textContent = connection.claudeJson ?? '';
}
el.settingsClient.addEventListener('click', event => { const pick = event.target.closest('[data-client]')?.dataset.client; if (pick) { client = pick; renderClient(); } });

/** The section nav scrolls to its section (buttons, not links: the hash names the view). */
el.settingsNav.addEventListener('click', event => {
  const target = event.target.closest('[data-section]');
  if (!target) return;
  for (const b of el.settingsNav.querySelectorAll('[data-section]')) b.setAttribute('aria-current', String(b === target));
  const section = document.getElementById(target.dataset.section);
  section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  section.focus({ preventScroll: true });
});

export function copyBlock(button) {
  const text = button.closest('.block').querySelector('pre').textContent;
  const label = button.querySelector('span');
  const done = () => { label.textContent = t('settings.copied'); setTimeout(() => { label.textContent = t('settings.copy'); }, 1400); };
  navigator.clipboard?.writeText(text).then(done, () => {
    const range = document.createRange(); range.selectNodeContents(button.closest('.block').querySelector('pre'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
}

// The opening plays at every start of the app. The mark is on screen from the first paint (CSS,
// in index.html); the live intro takes over when the runtime is ready. A click or any key ends it.
export let openingDone;
export const opening = new Promise(resolve => { openingDone = resolve; });
export let openingPlayer = null;
export function playOpening() {
  const still = () => setTimeout(openingDone, 1300);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return still();
  setTimeout(openingDone, 5000);
  try {
    openingPlayer = new KeyframePlayer(el.splashPlayer, {
      skeleton: '/opening/mark_v2.json', atlas: '/opening/mark_v2.atlas', animation: 'intro',
      premultipliedAlpha: false, showControls: false, backgroundColor: '#00000000', alpha: true,
      success: p => {
        const data = p.skeleton.data;
        // the key flies in from the left of the finished lockup, so frame it with room around
        if (data.width > 0) Object.assign(p.config.viewport, { x: data.x - data.width * 0.12, y: data.y - data.height * 0.12, width: data.width * 1.24, height: data.height * 1.24 });
        p.setAnimation('intro', false);
        p.animationState.addListener({ complete: e => { if (e.animation.name === 'intro') setTimeout(openingDone, 450); } });
        p.play();
        el.splash.classList.add('playing');
      },
      error: still,
    });
  } catch { still(); }
}
export function closeOpening() {
  el.splash.classList.add('out');
  setTimeout(() => { el.splash.hidden = true; try { openingPlayer?.dispose(); } catch { /* gone */ } el.splashPlayer.replaceChildren(); }, 400);
}
el.splash.addEventListener('click', () => openingDone());
window.addEventListener('keydown', () => openingDone());

el.navProjects.addEventListener('click', () => showView('projects'));
el.projectSwitch.addEventListener('click', () => showView(S.view === 'projects' && S.projectDir ? 'work' : 'projects'));
el.navSettings.addEventListener('click', () => showView(S.view === 'settings' ? (S.projectDir ? 'work' : 'projects') : 'settings'));
el.checkButton.addEventListener('click', async () => { el.checkText.textContent = '…'; await loadSettings(); });
el.settings.addEventListener('click', event => { const copy = event.target.closest('.copy'); if (copy) copyBlock(copy); });
el.settingsLang.addEventListener('click', event => {
  const lang = event.target.closest('button')?.dataset.lang;
  if (lang && lang !== S.lang) setLang(lang).catch(() => {});
});
el.settingsTheme.addEventListener('click', event => {
  const theme = event.target.closest('button')?.dataset.themeChoice;
  if (theme) setTheme(theme);
});
window.addEventListener('hashchange', () => showView(location.hash.slice(1) || 'work'));
