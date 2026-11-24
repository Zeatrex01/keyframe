// The top bar's agent state and the conversation: messages, the describe box, sending.

import { S, el } from './store.js';
import { cursorAfter, insertAt } from './chat-rules.js';
import { pillState } from './agent-rules.js';
import { messageView, SUGGESTIONS, whenText, liveView, elapsedText, phaseText } from './chat-view.js';
import { askUndo } from './delivery.js';
import { showPanel } from './panels.js';
import { renderFirst } from './projects.js';
import { updateSlotStatus } from './agent-slots.js';
import { flipStage } from './sync.js';
import { api, button, icon, node, t } from './ui.js';

// ---------- nav and conversation ----------

export function renderAgent() {
  const agent = S.state?.agent;
  // The pill: the embedded Director when it runs, else the MCP client that called in, else waiting.
  const pill = pillState(S.state, S.online);
  el.agentPill.classList.toggle('on', pill.tone === 'on' || pill.tone === 'busy');
  el.agentDot.className = 'dot' + ({ on: ' on', busy: ' on busy', bad: ' bad', wait: '' })[pill.tone];
  el.agentName.hidden = !pill.name;
  el.agentName.textContent = pill.name ?? '';
  el.agentLabel.textContent = t(pill.key);
  el.agentLabel.classList.toggle('hide-phone', Boolean(pill.name));
  const name = S.state?.project?.name;
  el.projectSwitch.hidden = !name;
  el.barSep.hidden = !name;
  if (name && el.projectName.textContent !== name) el.projectName.textContent = name;
  // The project's own picture in the switcher when it has a preview.png, else the mark.
  const thumb = S.state?.project?.preview ? `/api/projects/preview?dir=${encodeURIComponent(S.state.project.dir)}` : '';
  if (el.projectThumb.dataset.src !== thumb) {
    el.projectThumb.dataset.src = thumb;
    const img = node('img');
    img.alt = ''; img.src = thumb;
    el.projectThumb.replaceChildren(...(thumb ? [img] : [logoMark()]));
  }

  const work = agent?.work ?? 'idle';
  const stage = ['writing', 'checking', 'ready'].indexOf(work);
  el.steps.hidden = stage < 0;
  if (stage >= 0) {
    const labels = [
      stage === 0 ? 'steps.writing' : 'steps.written',
      stage === 0 ? 'steps.check' : stage === 1 ? 'steps.checking' : 'steps.checked',
      'steps.showing',
    ];
    el.steps.querySelectorAll('.s').forEach((step, i) => {
      const done = i < stage || stage === 2;
      const now = i === stage && stage < 2;
      step.className = 's' + (done ? ' done' : now ? ' now' : '');
      step.lastElementChild.textContent = t(labels[i]);
    });
  }

  // Nobody to answer: neither the studio's own Director nor an MCP client (the pill says the same).
  const hint = S.sendError ? t('chat.failed', { reason: S.sendError }) : (S.state && S.online && pill.tone === 'wait' ? t('chat.noAgent') : '');
  el.chatHint.hidden = !hint;
  el.chatHint.textContent = hint;
  el.chatHint.classList.toggle('bad', Boolean(S.sendError));
  renderMessages();
  renderLive(pill.name);
  renderFirst();
  updateSlotStatus();
}

/** The studio's mark, for a project with no picture of its own. */
function logoMark() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#logo');
  svg.append(use);
  return svg;
}

/** The director at work: its phase, the tool it is on, how long, the answer so far, and Stop. */
function renderLive(name) {
  const live = liveView(S.state?.agent);
  el.live.hidden = !live;
  if (!live) { el.stopAgent.disabled = false; return; }
  el.liveName.textContent = name ?? t('chat.aiName');
  el.livePhase.textContent = phaseText(live, t);
  el.liveSecs.textContent = elapsedText(live.seconds);
  if (el.liveText.textContent !== live.text) {
    const atEnd = el.liveText.scrollHeight - el.liveText.scrollTop - el.liveText.clientHeight < 8;
    el.liveText.textContent = live.text;
    if (atEnd) el.liveText.scrollTop = el.liveText.scrollHeight;
  }
}

export async function stopAgent() {
  el.stopAgent.disabled = true;
  try { await api('/api/agent/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'director' }) }); }
  catch (err) { S.sendError = err.message; el.stopAgent.disabled = false; renderAgent(); }
}

const shownMessages = new Map();   // id -> message, for re-drawing the result cards and the times

export function addMessage(message, { fromPoll = true } = {}) {
  S.lastId = cursorAfter(S.lastId, message, { fromPoll });
  if (S.seen.has(message.id)) return;
  S.seen.add(message.id);
  shownMessages.set(message.id, message);
  el.chatEmpty.hidden = true;
  const view = messageView(message);
  const row = node('div', `msg ${view.kind === 'you' ? 'you' : 'ai'}${view.stopped ? ' stopped' : ''}`);
  row.dataset.id = String(message.id);
  if (view.kind !== 'you') {
    const who = node('div', 'who');
    const avatar = node('span', 'avatar');
    avatar.append(icon('i-spark'));
    const time = node('time', 'when');
    if (view.time) time.dateTime = view.time;
    who.append(avatar, node('b', 'name'), time);
    row.append(who);
  }
  row.append(node('div', 'body', view.stopped ? t('chat.stopped') : view.text));
  const shown = [...el.msgs.querySelectorAll('.msg')];
  const at = insertAt(shown.map(r => Number(r.dataset.id)), message.id);
  el.msgs.insertBefore(row, shown[at] ?? null);
  renderMessages();
  el.msgs.scrollTop = el.msgs.scrollHeight;
}

/** Bring the AI's name, the times and the result cards up to date (the stage, its check, the clock). */
export function renderMessages() {
  const name = pillState(S.state, S.online).name ?? t('chat.aiName');
  const latest = Math.max(0, ...[...shownMessages.values()].filter(m => m.from !== 'owner' && m.work === 'ready' && m.file).map(m => m.id));
  for (const row of el.msgs.querySelectorAll('.msg.ai')) {
    const message = shownMessages.get(Number(row.dataset.id));
    if (!message) continue;
    const view = messageView(message, { name, shown: S.shown?.file ?? null, check: S.check, latest: message.id === latest });
    row.querySelector('.who .name').textContent = view.name ?? '';
    const when = whenText(view.time, Date.now(), S.lang);
    const time = row.querySelector('.who .when');
    if (time.textContent !== when) time.textContent = when;
    const key = view.result ? JSON.stringify(view.result) + S.lang : '';
    if (row.dataset.result === key) continue;
    row.dataset.result = key;
    row.querySelector('.result')?.remove();
    if (view.result) row.append(resultCard(view.result));
  }
  const suggest = S.shown ? S.lang : '';
  if (el.suggest.dataset.lang === suggest) return;
  el.suggest.dataset.lang = suggest;
  el.suggest.replaceChildren(...(suggest ? SUGGESTIONS.map(s => {
    const b = button('', t(s.label));
    b.addEventListener('click', () => { el.text.value = t(s.fill); resizeText(); el.text.focus(); });
    return b;
  }) : []));
}

function resultCard(result) {
  const card = node('div', 'result');
  const top = node('div', 'top');
  if (result.chip) {
    const chip = node('span', `chip ${result.chip.tone}`);
    chip.append(icon(result.chip.icon), document.createTextNode(t(result.chip.key)));
    top.append(chip);
  }
  top.append(node('span', 'chip file', result.animation ? `${result.file} · ${result.animation}` : result.file));
  card.append(top);
  if (result.notes.length) {
    const notes = node('ul', 'notes');
    for (const text of result.notes) {
      const li = node('li');
      li.append(node('span', 'kd'), node('span', '', text));
      notes.append(li);
    }
    card.append(notes);
  }
  if (result.actions) {
    const acts = node('div', 'acts');
    const original = button('btn sm', t('stage.showSource'), 'i-compare');
    original.addEventListener('click', flipStage);
    const undo = button('btn sm ghost', t('chat.undo'), 'i-undo');
    undo.addEventListener('click', () => { showPanel('versions'); askUndo(); });
    acts.append(original, undo);
    card.append(acts);
  }
  return card;
}

export function resizeText() {
  el.text.style.height = 'auto';
  el.text.style.height = `${Math.min(160, el.text.scrollHeight)}px`;
  el.send.disabled = !el.text.value.trim();
}

export async function sendMessage() {
  const text = el.text.value.trim();
  if (!text) return;
  el.send.disabled = true;
  try {
    const message = await api('/api/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    S.sendError = '';
    el.text.value = '';
    addMessage(message, { fromPoll: false });
  } catch (err) {
    S.sendError = err.message;
  }
  resizeText();
  renderAgent();
}
