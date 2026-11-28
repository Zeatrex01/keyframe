// The Assets panel: the asset catalog (find_assets) for the owner. What the project, the bundled
// library and the owner's own asset folders hold, found by words; what nothing in the project
// uses; what changed since the last look; and the list of asset folders. The page reads the same
// answers the agent does, so both see the same art.

import { el } from './store.js';
import { api, formatSize, formatTime, icon, node, t } from './ui.js';

const A = { source: 'all', offset: 0, rows: /** @type {any[]} */ ([]), total: 0, folders: /** @type {any[]} */ ([]), timer: /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined), ask: 0 };
const KIND_ICON = { image: 'i-square', skeleton: 'i-bone', drawing: 'i-pen', atlas: 'i-box', aseprite: 'i-square', audio: 'i-spark',
  font: 'i-info', model: 'i-box', scene: 'i-puzzle', video: 'i-film', page: 'i-link' };
const SHOWN = /\.(png|jpe?g|webp|gif|svg|bmp)$/i;

const fileUrl = row => `/api/assets/file?${new URLSearchParams({ source: row.source, path: row.path, ...(row.root ? { root: row.root } : {}) })}`;

function thumb(row) {
  const box = node('span', 'thumb');
  if (row.kind === 'image' && SHOWN.test(row.path)) {
    const img = node('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = fileUrl(row);
    box.append(img);
  } else box.append(icon(KIND_ICON[row.kind] ?? 'i-box'));
  return box;
}

function assetRow(row) {
  const item = node('li');
  item.title = row.root ? `${row.root}/${row.path}` : row.ref ?? row.path;
  const what = node('span', 'what');
  const facts = [t(`assets.kind.${row.kind}`), row.image, row.size ? formatSize(row.size) : '', row.source === 'project' ? '' : t(`assets.from.${row.source}`)].filter(Boolean);
  what.append(node('b', '', row.path.split('/').pop()), node('span', '', `${row.path.includes('/') ? `${row.path.slice(0, row.path.lastIndexOf('/'))} · ` : ''}${facts.join(' · ')}`));
  item.append(thumb(row), what);
  if (row.usage === 'unreferenced') item.append(node('span', 'chip warn', t('assets.usage.unreferenced')));
  else if (row.usage === 'used') item.append(node('span', 'chip ok', t('assets.usage.used')));
  return item;
}

function renderList() {
  el.assetCount.textContent = t('assets.count', { shown: A.rows.length, total: A.total });
  el.assetList.replaceChildren(...A.rows.map(assetRow));
  el.assetMore.hidden = A.rows.length >= A.total;
  el.assetFolders.replaceChildren(...A.folders.map(folder => {
    const item = node('li');
    const forget = node('button', 'btn ghost sm icon');
    forget.type = 'button';
    forget.setAttribute('aria-label', t('assets.folderForget'));
    forget.title = t('assets.folderForget');
    forget.append(icon('i-close'));
    forget.addEventListener('click', () => folderCall('/api/assets/forget', folder.root));
    item.append(icon('i-folder'), node('span', '', folder.root), node('span', 'size', folder.missing ? t('assets.folderMissing') : t('assets.files', { count: folder.files })), forget);
    return item;
  }));
}

async function find({ more = false } = {}) {
  const ask = ++A.ask;
  const offset = more ? A.rows.length : 0;
  const q = new URLSearchParams({ q: el.assetQuery.value.trim(), source: A.source, offset: String(offset), ...(el.assetUnused.checked ? { usage: 'unreferenced' } : {}) });
  try {
    const r = await api(`/api/assets/find?${q}`);
    if (ask !== A.ask) return;
    A.rows = more ? [...A.rows, ...r.assets] : r.assets;
    A.total = r.total;
    A.folders = (r.sources ?? []).filter(s => s.source === 'folder');
    el.assetStatus.textContent = '';
    renderList();
  } catch (err) { el.assetStatus.textContent = err.message; }
}

function changeRow(c) {
  const item = node('li');
  const what = node('span', 'what');
  what.append(node('b', '', c.path.split('/').pop()),
    node('span', '', `${t(`assets.change.${c.what}`)}${c.from ? ` ← ${c.from}` : ''} · ${t(`assets.from.${c.source}`)} · ${formatTime(c.time)}`));
  item.title = c.root ? `${c.root}/${c.path}` : c.path;
  item.append(node('span', 'thumb'), what);
  item.firstChild.append(icon(c.what === 'removed' ? 'i-trash' : c.what === 'moved' ? 'i-sync' : c.what === 'added' ? 'i-plus' : 'i-pen'));
  return item;
}

async function changes() {
  try {
    const r = await api('/api/assets/changes');
    el.assetChangesNote.textContent = r.baseline ? t('assets.baseline') : r.total ? t('assets.changeCount', { count: r.total }) : t('assets.noChanges');
    el.assetChangeList.replaceChildren(...r.changes.map(changeRow));
    el.assetSeen.hidden = !r.total;
  } catch (err) { el.assetChangesNote.textContent = err.message; }
}

async function folderCall(route, folder) {
  try {
    await api(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder }) });
    el.assetFolder.value = '';
    el.assetStatus.textContent = '';
    await find();
    await changes();
  } catch (err) { el.assetStatus.textContent = err.message; }
}

/** Read the catalog again: when the panel is shown, and when the project changes. */
export function refreshAssets() {
  find();
  changes();
}

el.assetQuery.addEventListener('input', () => { clearTimeout(A.timer); A.timer = setTimeout(() => find(), 200); });
el.assetUnused.addEventListener('change', () => find());
el.assetMore.addEventListener('click', () => find({ more: true }));
el.assetSource.addEventListener('click', event => {
  const b = /** @type {HTMLElement} */ (event.target).closest('button[data-source]');
  if (!(b instanceof HTMLElement)) return;
  A.source = b.dataset.source ?? 'all';
  for (const other of el.assetSource.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === b));
  find();
});
el.assetSeen.addEventListener('click', async () => {
  try { await api('/api/assets/seen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); await changes(); }
  catch (err) { el.assetStatus.textContent = err.message; }
});
el.assetFolderForm.addEventListener('submit', event => {
  event.preventDefault();
  const folder = el.assetFolder.value.trim();
  if (folder) folderCall('/api/assets/folders', folder);
});
document.addEventListener('kf-tab', event => { if (/** @type {CustomEvent} */ (event).detail === 'assets') refreshAssets(); });
