// Updates of the installed app (Settings > About, and the header's pill): shown only when the
// studio runs as the packaged app. The studio does the checking and installing (src/core/update.js);
// this page asks, shows and confirms.
import { S, el } from './store.js';
import { api, formatSize, t } from './ui.js';
import { showView } from './views.js';

const json = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function loadUpdate(refresh = false) {
  try { S.update = await api(`/api/update${refresh ? '?refresh=1' : ''}`); } catch { S.update = null; }
  renderUpdate();
}

export function renderUpdate(message = '') {
  const u = S.update;
  el.updateBox.hidden = !u?.packaged;
  el.updatePill.hidden = !(u?.packaged && (u.available || u.installed));
  if (!u?.packaged) return;
  const release = u.release;
  el.updatePillText.textContent = u.installed ? t('update.pillRestart') : t('update.pill', { version: release?.version ?? '' });
  el.updateState.textContent = u.installed ? t('update.installed', { version: u.installed })
    : u.available ? t('update.available', { version: release.version, size: formatSize(release.size) })
      : u.reason === 'up-to-date' ? t('update.upToDate') : u.check || u.checkedAt ? t('update.unreachable') : t('update.off');
  el.updateState.classList.toggle('ok', !!(u.available || u.installed));
  el.updateNotes.hidden = !u.available || !release?.notes;
  el.updateNotesText.textContent = release?.notes ?? '';
  el.updateAuto.checked = u.check;
  el.updateInstall.hidden = !(u.available || u.installed);
  el.updateInstall.disabled = u.installing || (!u.writable && !u.installed);
  el.updateInstall.textContent = u.installed ? t('update.restart') : t('update.install');
  el.updateStatus.textContent = message || (!u.writable && u.available ? t('update.notWritable') : '');
}

async function install() {
  const u = S.update;
  if (!u) return;
  el.updateInstall.disabled = true;
  try {
    if (u.installed) {
      renderUpdate(t('update.restarting'));
      await api('/api/update/restart', json({}));
      return; // the page reloads when the new version answers (web/sync.js)
    }
    renderUpdate(t('update.downloading'));
    S.update = await api('/api/update/install', json({}));
    renderUpdate(t('update.ready'));
  } catch (err) { renderUpdate(String(err.message ?? err)); }
}

el.updateInstall.addEventListener('click', install);
el.updateCheckNow.addEventListener('click', () => { renderUpdate(t('update.checking')); loadUpdate(true); });
el.updateAuto.addEventListener('change', async () => {
  try { S.update = await api('/api/update/settings', { ...json({ check: el.updateAuto.checked }), method: 'PUT' }); renderUpdate(); }
  catch (err) { renderUpdate(String(err.message ?? err)); }
});
el.updatePill.addEventListener('click', () => { showView('settings'); document.getElementById('setAbout')?.scrollIntoView({ block: 'start' }); });
