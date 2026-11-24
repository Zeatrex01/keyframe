// The Projects view and the first run: the examples (each opens as a copy), the recent projects
// with their previews, opening a folder or making a new one. The first run shows instead of
// Projects while no project has ever been opened.

import { loadDesktop } from './connect.js';
import { pillState } from './agent-rules.js';
import { loadAgentSlots } from './agent-slots.js';
import { S, el } from './store.js';
import { poll } from './sync.js';
import { showView } from './views.js';
import { whenText } from './chat-view.js';
import { api, button, icon, node, t } from './ui.js';

let examples = null;            // [{ name, preview }] from the server
let connection = null;          // the connection snippets from /api/settings
let director = null;            // the agent CLI the built-in Director would run: { name, installed, install }, from /api/agent
let client = 'claudeCommand';   // the snippet the first run shows

/** Is the first run what the Projects view shows now? */
export const isFirstRun = () => Boolean(S.projects && !S.projects.projects.length && !S.firstDismissed);

/** Which of the two the Projects view shows: nothing until the list is known, so nothing flickers. */
export function placeProjects() {
  const on = S.view === 'projects';
  el.first.hidden = !(on && isFirstRun());
  el.hub.hidden = !(on && S.projects && !isFirstRun());
}

export async function loadProjects() {
  try {
    const [list, found] = await Promise.all([api('/api/projects'), examples ? { examples } : api('/api/examples').catch(() => ({ examples: [] }))]);
    S.projects = list;
    examples = found.examples ?? [];
    renderProjects();
    if (isFirstRun() && !connection) {
      api('/api/settings').then(s => {
        connection = s.connection ?? null;
        renderFirst();
        // The built-in Director comes first: say whether its agent CLI is on this computer.
        if (s.embeddedAgent) api('/api/agent').then(a => { director = (a.agents ?? []).find(x => x.id === 'claude-code') ?? null; renderFirst(); }).catch(() => {});
      }).catch(() => {});
    }
  } catch (err) { el.hubStatus.textContent = String(err.message ?? err); }
}

const exampleText = (name, part) => {
  const key = `example.${name}.${part}`;
  return S.dict[key] ? t(key) : part === 'title' ? name : '';
};
/** A count with its noun, in the page's language's plural form (hub.skeletons.one, hub.skeletons.other). */
const counted = (key, n) => t(`${key}.${new Intl.PluralRules(S.lang).select(n) === 'one' ? 'one' : 'other'}`, { n });
const previewOf = name => `/api/examples/preview?name=${encodeURIComponent(name)}`;

function preview(className, src) {
  const box = node('span', className);
  if (src) {
    const img = node('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = src;
    box.append(img);
  } else {
    box.append(icon('logo'));
  }
  return box;
}

export function renderProjects() {
  placeProjects();
  if (!S.projects) return;
  renderFirst();
  el.exampleList.replaceChildren(...(examples ?? []).map(({ name, preview: has }) => {
    const card = node('button', 'card ex');
    card.type = 'button';
    card.dataset.example = name;
    const meta = node('span', 'meta');
    meta.append(node('b', '', exampleText(name, 'title')));
    if (exampleText(name, 'lead')) meta.append(node('span', 't-caption', exampleText(name, 'lead')));
    if (exampleText(name, 'princ')) {
      const princ = node('span', 'princ');
      princ.append(node('span', 'kd ghost'), node('span', '', exampleText(name, 'princ')));
      meta.append(princ);
    }
    card.append(preview('preview', has ? previewOf(name) : null));
    if (exampleText(name, 'kind')) card.append(node('span', 'chip kind', exampleText(name, 'kind')));
    card.append(meta);
    return card;
  }));

  const { current, projects } = S.projects;
  const find = el.projectFilter.value.trim().toLowerCase();
  const shown = projects.filter(p => !find || p.name.toLowerCase().includes(find) || p.dir.toLowerCase().includes(find));
  el.hubEmpty.hidden = shown.length > 0;
  el.hubEmpty.textContent = t(projects.length ? 'hub.noMatch' : 'hub.empty');
  el.projectList.replaceChildren(...shown.map(p => {
    const item = node('li', `proj${p.dir === current ? ' current' : ''}`);
    const main = node('div', 'pmain');
    const name = node('div', 'pname');
    name.append(node('b', '', p.name));
    if (p.dir === current) name.append(node('span', 'chip key', t('hub.current')));
    if (!p.exists) name.append(node('span', 'chip bad', t('hub.missing')));
    main.append(name, node('span', 'mono path', p.dir));
    const counts = p.exists && p.skeletons !== undefined ? `${counted('hub.skeletons', p.skeletons)} · ${counted('hub.deliveries', p.deliveries)}` : '';
    item.append(preview('pthumb', p.preview ? `/api/projects/preview?dir=${encodeURIComponent(p.dir)}` : null), main,
      node('span', 't-caption hide-phone', counts), node('span', 't-caption hide-phone', p.opened ? whenText(p.opened, Date.now(), S.lang) : ''));
    if (p.exists) {
      const open = button('btn sm', p.dir === current ? t('hub.work') : t('hub.open'));
      open.addEventListener('click', () => openProject(p.dir));
      item.append(open);
    } else {
      item.append(node('span'));
    }
    const forget = button('btn ghost sm icon', '', 'i-close');
    forget.setAttribute('aria-label', t('hub.forgetNamed', { name: p.name }));
    forget.title = t('hub.forget');
    forget.addEventListener('click', () => projectCall('/api/projects/forget', { dir: p.dir }, t('hub.forgotten')));
    item.append(forget);
    return item;
  }));
}

/** The first run: the connection snippet, whether an AI is there yet, and the examples as minis. */
export function renderFirst() {
  if (el.first.hidden) return;
  for (const b of el.firstClient.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.client === client));
  el.firstCode.textContent = connection?.[client] ?? '';
  el.firstCode.closest('.code').hidden = !connection;
  el.firstDesktop.hidden = client !== 'claudeDesktop';
  el.firstDirector.hidden = !director;
  el.firstDirectorGo.hidden = !director;
  if (director) el.firstDirector.textContent = director.installed ? t('first.directorFound', { name: director.name }) : t('first.directorMissing', { install: director.install ?? '', signIn: director.signIn ?? 'claude' });
  const pill = pillState(S.state, S.online);
  const on = pill.tone === 'on' || pill.tone === 'busy';
  el.firstDot.className = `dot${on ? ' on' : ' busy'}`;
  el.firstStatusText.textContent = on ? t('first.connected', { name: pill.name ?? t('chat.aiName') }) : t('first.waiting');
  el.firstConnect.classList.toggle('now', !on);
  el.firstOpen.classList.toggle('now', on);
  const names = (examples ?? []).map(e => e.name).join(',');
  if (el.firstExamples.dataset.names === names + S.lang) return;
  el.firstExamples.dataset.names = names + S.lang;
  el.firstExamples.replaceChildren(...(examples ?? []).map(({ name, preview: has }) => {
    const mini = node('button', 'mini');
    mini.type = 'button';
    mini.dataset.example = name;
    mini.setAttribute('aria-label', t('first.openExample', { name: exampleText(name, 'title') }));
    mini.append(preview('mprev', has ? previewOf(name) : null), node('span', '', exampleText(name, 'title')));
    return mini;
  }));
}

export async function projectCall(path, body, done) {
  el.hubStatus.textContent = '';
  try {
    S.projects = await api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    renderProjects();
    if (done) el.hubStatus.textContent = done;
    await poll();
    return true;
  } catch (err) { el.hubStatus.textContent = String(err.message ?? err); return false; }
}

export async function openProject(dir) {
  if (await projectCall('/api/projects/open', { dir })) showView('work');
}

async function openExample(name) {
  if (await projectCall('/api/projects/sample', { example: name })) showView('work');
}

/** Show one of the two forms (or hide it again), with its button saying which is open. */
function toggleForm(form, opener, other, otherOpener) {
  const show = form.hidden;
  form.hidden = !show; opener.setAttribute('aria-expanded', String(show));
  other.hidden = true; otherOpener.setAttribute('aria-expanded', 'false');
  if (show) form.querySelector('input')?.focus();
}

for (const list of [el.exampleList, el.firstExamples]) {
  list.addEventListener('click', event => { const name = event.target.closest('[data-example]')?.dataset.example; if (name) openExample(name); });
}
/**
 * The system's own folder dialog (the studio shows it on this computer): the chosen folder, or
 * null when cancelled or when there is none (then the path box is the way, and the status says so).
 */
export async function browseFolder() {
  el.hubStatus.textContent = t('hub.browsing');
  try {
    const { dir } = await api('/api/projects/pick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    el.hubStatus.textContent = '';
    return dir ?? null;
  } catch (err) { el.hubStatus.textContent = String(err.message ?? err); return null; }
}

/** Open a folder: the form (with the path box) shows, and the folder dialog opens at once. */
async function openFolder() {
  if (el.openForm.hidden) toggleForm(el.openForm, el.hubOpen, el.createForm, el.hubNew);
  // Let the form paint first: the dialog takes the focus, and a browser in the background may not
  // draw the page again until it comes back.
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 60)));
  const dir = await browseFolder();
  if (dir) { el.openPath.value = dir; openProject(dir); }
}

el.hubOpen.addEventListener('click', () => { if (el.openForm.hidden) openFolder(); else toggleForm(el.openForm, el.hubOpen, el.createForm, el.hubNew); });
el.openBrowse.addEventListener('click', openFolder);
el.createBrowse.addEventListener('click', async () => { const dir = await browseFolder(); if (dir) { el.createParent.value = dir; el.createName.focus(); } });
el.outsideOpen.addEventListener('click', () => { if (el.outsideOpen.dataset.dir) openProject(el.outsideOpen.dataset.dir); });
el.hubNew.addEventListener('click', () => toggleForm(el.createForm, el.hubNew, el.openForm, el.hubOpen));
el.projectFilter.addEventListener('input', renderProjects);
el.firstFolder.addEventListener('click', () => {
  S.firstDismissed = true;
  placeProjects();
  openFolder();
});
// The Director is chosen in Settings → AI connection.
el.firstDirectorGo.addEventListener('click', async () => {
  showView('settings');
  await loadAgentSlots().catch(() => {});
  // The section's own nav button scrolls it under the bar; then the Director's agent menu has focus.
  el.settingsNav.querySelector('[data-section="setAi"]')?.click();
  el.slotList.querySelector('select')?.focus({ preventScroll: true });
});
el.firstClient.addEventListener('click', event => { const pick = event.target.closest('[data-client]')?.dataset.client; if (pick) { client = pick; renderFirst(); if (pick === 'claudeDesktop') loadDesktop(); } });
el.firstCopy.addEventListener('click', () => {
  const label = el.firstCopy.querySelector('span');
  navigator.clipboard?.writeText(el.firstCode.textContent).then(() => {
    label.textContent = t('settings.copied');
    setTimeout(() => { label.textContent = t('settings.copy'); }, 1400);
  }, () => {});
});
el.openForm.addEventListener('submit', event => { event.preventDefault(); if (el.openPath.value.trim()) openProject(el.openPath.value.trim()); });
el.createForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (await projectCall('/api/projects/create', { parent: el.createParent.value.trim(), name: el.createName.value.trim() })) showView('work');
});
