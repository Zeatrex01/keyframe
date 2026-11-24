// The delivery: the runtime check of what the stage shows (in the Clips panel), its earlier
// versions and going back to one (the Versions panel).

import { renderMessages } from './chat.js';
import { counterpart } from './stage-pick.js';
import { S, el } from './store.js';
import { poll } from './sync.js';
import { api, baseName, button, formatSize, formatTime, icon, node, t } from './ui.js';

// ---------- delivery ----------

export async function refreshDelivery() {
  const shown = S.shown;
  S.check = null; S.history = null; S.confirming = null;
  renderDelivery();
  if (!shown) return;
  const file = shown.file;
  const still = () => S.shown?.file === file;
  api(`/api/check?file=${encodeURIComponent(file)}`)
    .then(result => { if (still()) { S.check = result; renderDelivery(); } })
    .catch(err => { if (still()) { S.check = { failed: err.message }; renderDelivery(); } });
  api(`/api/history?file=${encodeURIComponent(file)}`)
    .then(result => { if (still()) { S.history = result.backups ?? []; renderDelivery(); } })
    .catch(() => { if (still()) { S.history = []; renderDelivery(); } });
}

export async function restore(backup) {
  const file = S.shown?.file;
  if (!file) return;
  S.confirming = null;
  try {
    await api('/api/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, backup }) });
    S.deliveryMessage = { tone: 'ok', key: 'delivery.restored' };
    await poll();
    if (S.shown?.file === file) refreshDelivery();
  } catch (err) {
    S.deliveryMessage = { tone: 'bad', key: 'delivery.restoreFailed', reason: err.message };
    renderDelivery();
  }
}

/** Ask to go back to the newest earlier version (the chat's Undo); the Versions panel confirms it. */
export function askUndo() {
  const latest = S.history?.[0];
  if (!latest) return false;
  S.confirming = latest.backup;
  S.deliveryMessage = null;
  renderDelivery();
  el.versions.querySelector('.confirming button')?.focus();
  return true;
}

/** The check, said in a few words for the chip, and in full when it failed. */
function checkWords(check) {
  if (!check) return { tone: '', chip: t('delivery.checking'), icon: null, note: '' };
  if (check.failed) return { tone: 'bad', chip: t('delivery.chipFailed'), icon: 'i-alert', note: t('delivery.checkFailed', { reason: check.failed }) };
  if (check.opens) return { tone: 'ok', chip: t('delivery.chipOk'), icon: 'i-check', note: '' };
  const first = (check.findings ?? []).find(f => f.level === 'fatal' || f.level === 'error') ?? (check.findings ?? [])[0];
  return { tone: 'bad', chip: t('delivery.chipBad'), icon: 'i-alert', note: t('delivery.bad', { reason: first?.message ?? check.summary ?? '' }) };
}

export function renderDelivery() {
  renderMessages();
  const shown = S.shown;
  el.deliveryEmpty.hidden = Boolean(shown);
  el.deliveryTop.hidden = !shown;
  el.deliveryActs.hidden = !shown;
  el.deliveryNote.hidden = !shown;
  el.versionsEmpty.hidden = Boolean(shown);
  el.versionsNote.hidden = true;
  el.versions.replaceChildren();
  el.deliveryStatus.textContent = S.deliveryMessage ? t(S.deliveryMessage.key, { reason: S.deliveryMessage.reason }) : '';
  el.deliveryStatus.className = `status ${S.deliveryMessage?.tone ?? ''}`;
  if (!shown) return;
  el.deliveryFile.textContent = baseName(shown.file);
  el.deliveryFile.title = shown.file;

  const words = checkWords(S.check);
  el.deliveryCheck.className = `chip ${words.tone}`;
  el.deliveryCheck.replaceChildren(...(words.icon ? [icon(words.icon)] : []), document.createTextNode(words.chip));

  const other = S.state ? counterpart(S.state.skeletons, shown.file) : null;
  const delivery = shown.role === 'delivery';
  // What this file is, in one sentence; a failed check says why instead.
  el.deliveryNote.className = `t-caption${words.note ? ' bad' : ''}`;
  el.deliveryNote.textContent = words.note
    || (delivery ? t('delivery.written', { base: baseName(shown.deliveryOf ?? other?.file ?? '') })
      : t(other ? 'delivery.sourceHasResult' : 'delivery.source'));
  el.deliveryFlip.hidden = !other;
  el.deliveryFlip.querySelector('span').textContent = t(delivery ? 'stage.showSource' : 'stage.showResult');
  el.deliveryVersions.hidden = !delivery;

  if (!delivery) {
    el.versionsNote.hidden = false;
    el.versionsNote.textContent = t('versions.sourceNote');
    return;
  }
  const current = node('li', 'current');
  current.append(node('span', '', `${t('delivery.current')} · ${formatTime(shown.modified)}`));
  el.versions.append(current);
  if (S.history && !S.history.length) {
    el.versionsNote.hidden = false;
    el.versionsNote.textContent = t('delivery.noHistory');
  }
  for (const item of S.history ?? []) {
    const row = node('li');
    if (S.confirming === item.backup) {
      row.className = 'confirming';
      row.append(node('span', '', t('delivery.confirm')));
      const yes = button('btn sm primary', t('delivery.yes'));
      yes.addEventListener('click', () => restore(item.backup));
      const no = button('btn sm', t('delivery.cancel'));
      no.addEventListener('click', () => { S.confirming = null; renderDelivery(); });
      row.append(yes, no);
    } else {
      row.append(node('span', '', formatTime(item.time)), node('span', 'size', formatSize(item.size)));
      const back = button('btn sm ghost', t('delivery.goBack'), 'i-undo');
      back.addEventListener('click', () => { S.confirming = item.backup; S.deliveryMessage = null; renderDelivery(); el.versions.querySelector('.confirming button')?.focus(); });
      row.append(back);
    }
    el.versions.append(row);
  }
}
