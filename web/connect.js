// The "Add to Claude Desktop" button, in Settings and on the first run: whether the studio is in
// Claude Desktop's config, and adding it there when the owner presses it (src/core/claude-desktop.js).
import { el } from './store.js';
import { api, t } from './ui.js';

let status = null, message = '';

export async function loadDesktop() {
  try { status = await api('/api/connect/claude-desktop'); } catch { status = null; }
  renderDesktop();
}

export function renderDesktop() {
  const text = message || (!status ? '' : status.current ? t('connect.desktopAdded') : status.added ? t('connect.desktopOld')
    : !status.installed ? t('connect.desktopMissing') : '');
  for (const row of [el.settingsDesktop, el.firstDesktop]) {
    const add = /** @type {HTMLButtonElement} */ (row.querySelector('[data-desktop-add]'));
    add.textContent = status?.added ? t('connect.desktopAgain') : t('connect.desktopAdd');
    /** @type {HTMLElement} */ (row.querySelector('[data-desktop-status]')).textContent = text;
  }
}

async function add(button) {
  button.disabled = true;
  message = t('connect.desktopAdding');
  renderDesktop();
  try {
    status = await api('/api/connect/claude-desktop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    message = status.backup ? t('connect.desktopDone', { backup: status.backup }) : t('connect.desktopAdded');
  } catch (err) { message = String(err.message ?? err); }
  button.disabled = false;
  renderDesktop();
}

for (const row of [el.settingsDesktop, el.firstDesktop]) {
  row.querySelector('[data-desktop-add]').addEventListener('click', event => add(event.currentTarget));
}
