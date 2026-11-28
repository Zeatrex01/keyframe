// The inspector beside the stage (Clips, Reference, Versions; Keys as well when the stage column is
// too narrow for the key lanes under it) and the phone's tab bar (Chat, Keys, Reference, Clips): one
// panel at a time, chosen by the owner. Also the clip list in the Clips panel.

import { S, el } from './store.js';
import { node, t } from './ui.js';
import { renderTransport, setClip, togglePlay } from './stage.js';

export const INSPECTOR_TABS = ['keys', 'clips', 'reference', 'versions', 'assets'];
export const PHONE_TABS = ['chat', 'keys', 'reference', 'clips', 'versions', 'assets'];
// Wide enough for the key lanes to sit under the stage, so Keys is not a tab there.
const wide = matchMedia('(min-width: 1181px)');

function select(group, attribute, value, focus) {
  for (const b of group.querySelectorAll('[role="tab"]')) {
    const on = b.dataset[attribute] === value;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  }
}

/** Show one of the inspector's panels. */
export function setTab(tab, { focus = false } = {}) {
  if (!INSPECTOR_TABS.includes(tab) || (tab === 'keys' && wide.matches)) tab = 'clips';
  S.tab = tab;
  el.app.dataset.tab = tab;
  select(el.inspectorTabs, 'tab', tab, focus);
  // A panel that reads on demand (Assets) hears that it is shown.
  document.dispatchEvent(new CustomEvent('kf-tab', { detail: tab }));
}

/** Show one panel on a phone; the inspector follows, so a wider window shows the same thing. */
export function setPhoneTab(tab, { focus = false } = {}) {
  if (!PHONE_TABS.includes(tab)) tab = 'chat';
  S.phoneTab = tab;
  el.app.dataset.phone = tab;
  select(el.tabbar, 'phone', tab === 'versions' || tab === 'assets' ? 'clips' : tab, focus);
  if (tab !== 'chat') setTab(tab);
}

/** Bring a panel forward wherever the page is: the inspector's tab, and the phone's. */
export function showPanel(name) {
  setTab(name);
  if (S.phoneTab !== 'chat' || name === 'versions' || name === 'reference') setPhoneTab(name);
}

// Arrow keys move along a tab row, as in any tab list.
function arrows(group, attribute, apply) {
  group.addEventListener('keydown', event => {
    const tabs = [...group.querySelectorAll('[role="tab"]')].filter(b => b.offsetParent !== null);
    const at = tabs.indexOf(/** @type {HTMLElement} */ (event.target));
    if (at < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step ? (at + step + tabs.length) % tabs.length : -1;
    if (to < 0) return;
    event.preventDefault();
    apply(tabs[to].dataset[attribute], { focus: true });
  });
  group.addEventListener('click', event => {
    const tab = /** @type {HTMLElement} */ (event.target).closest('[role="tab"]');
    if (tab instanceof HTMLElement) apply(tab.dataset[attribute]);
  });
}
arrows(el.inspectorTabs, 'tab', setTab);
arrows(el.tabbar, 'phone', setPhoneTab);
wide.addEventListener('change', () => { if (S.tab === 'keys') setTab('clips'); });

// ---------- the clip list ----------

let clipsKey = '';
/** The clips of what the stage shows, each with its length once the player has read it. */
export function renderClips() {
  const names = S.shown?.animations ?? [];
  const data = S.ready ? S.player?.skeleton?.data : null;
  const lengths = names.map(name => data?.findAnimation?.(name)?.duration);
  const key = [S.lang, S.anim, ...names, ...lengths].join('\n');
  el.clipCount.textContent = names.length ? String(names.length) : '';
  el.clipCount.hidden = !names.length;
  el.clipsEmpty.hidden = names.length > 0;
  el.clipsEmpty.textContent = S.shown ? t('clips.empty') : t('clips.noFile');
  if (key === clipsKey) return;
  clipsKey = key;
  el.clipList.replaceChildren(...names.map((name, i) => {
    const current = name === S.anim;
    const row = node('button', `clip-row${current ? ' current' : ''}`);
    row.type = 'button';
    if (current) row.setAttribute('aria-current', 'true');
    const length = lengths[i];
    row.append(node('span', current ? 'kd' : 'kd ghost'), node('span', 'name', name),
      node('span', 'len', Number.isFinite(length) ? t('clips.seconds', { value: length.toFixed(2) }) : ''));
    row.addEventListener('click', () => {
      setClip(name);
      if (S.player?.paused) togglePlay();
      renderTransport();
    });
    const item = node('li');
    item.append(row);
    return item;
  }));
}
