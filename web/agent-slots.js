// Settings → AI connection, when the studio can run an AI of its own: the Director slot (one
// installed command-line agent, or none), its status and Stop, and helper slots (Art Director, Senior Animator,
// Researcher), each with its own agent and brief. One agent per slot. When the studio has no
// embedded agent (GET /api/agent answers 404), only the external MCP instructions show.

import { agentName, changeSlots, isRunning, orderSlots, slotAction, rolesToAdd, slotsForSave, slotsOf } from './agent-rules.js';
import { whenText } from './chat-view.js';
import { S, el } from './store.js';
import { api, button, icon, node, t } from './ui.js';

let data = null;      // { slots, agents } from GET /api/agent, or null when there is no embedded agent
let busy = false;

/** Ask the server whether it runs an embedded agent, and what its slots are. */
export async function loadAgentSlots() {
  if (S.settings && !S.settings.embeddedAgent) { data = null; renderAgentSlots(); return; }
  try {
    const response = await fetch('/api/agent', { headers: { accept: 'application/json' } });
    data = response.ok ? await response.json() : null;
  } catch { data = null; }
  if (data && !Array.isArray(data.slots)) data = null;
  renderAgentSlots();
}

/** The state's slot summary moves the statuses along between loads (each poll). */
export function updateSlotStatus() {
  if (!data || el.settings.hidden) return;
  const live = slotsOf(S.state?.agent);
  if (!live.length) return;
  let changed = false;
  data.slots = data.slots.map(slot => {
    const now = live.find(s => s.id === slot.id);
    if (!now || (now.status === slot.status && now.message === slot.message)) return slot;
    changed = true;
    return { ...slot, status: now.status, message: now.message, activity: now.activity ?? slot.activity };
  });
  // Never redraw under the owner's hands (a brief being typed, a menu open).
  if (changed && !el.slotList.contains(document.activeElement)) renderAgentSlots();
}

async function call(path, body) {
  if (busy) return;
  busy = true;
  el.slotStatus.textContent = '';
  try {
    const result = await api(path, { method: path.endsWith('/stop') ? 'POST' : 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (result && Array.isArray(result.slots)) data = { ...data, ...result };
    else await loadAgentSlots();
  } catch (err) {
    el.slotStatus.textContent = String(err.message ?? err);
  } finally { busy = false; }
  renderAgentSlots();
}
const save = change => call('/api/agent/slots', { slots: slotsForSave(changeSlots(data.slots, change)) });

function agentPicker(slot) {
  const select = node('select', 'select sm');
  select.setAttribute('aria-label', t('agent.pick', { role: t(`agent.role.${slot.role}`) }));
  const none = node('option', '', t('agent.none'));
  none.value = '';
  select.append(none);
  for (const a of data.agents ?? []) {
    const option = node('option', '', a.installed ? (a.name ?? agentName(a.id)) : t('agent.notInstalled', { name: a.name ?? agentName(a.id) }));
    option.value = a.id;
    option.disabled = !a.installed && a.id !== slot.agent;
    select.append(option);
  }
  select.value = slot.agent ?? '';
  select.addEventListener('change', () => save({ id: slot.id, patch: { agent: select.value || null } }));
  return select;
}

/** The model the slot's agent runs: the studio's default (a lower-cost one) unless the owner picks another. */
function modelPicker(slot) {
  const agent = (data.agents ?? []).find(a => a.id === slot.agent);
  if (!agent) return null;
  const select = node('select', 'select sm');
  select.setAttribute('aria-label', t('agent.model', { role: t(`agent.role.${slot.role}`) }));
  const names = [...new Set([...(agent.models ?? []), ...(slot.model ? [slot.model] : [])])];
  for (const m of names) {
    const option = node('option', '', m === agent.defaultModel ? t('agent.modelSuggested', { model: m }) : m);
    option.value = m;
    select.append(option);
  }
  const own = node('option', '', t('agent.modelOwn'));
  own.value = '';
  select.append(own);
  select.value = slot.model ?? agent.defaultModel ?? '';
  select.addEventListener('change', () => save({ id: slot.id, patch: { model: select.value } }));
  return select;
}

function slotRow(slot) {
  const row = node('li', `slot${slot.role === 'director' ? ' director' : ''}`);
  row.dataset.slot = slot.id;
  const head = node('div', 'slot-head');
  const badge = node('span', 'aic');
  badge.append(icon(slot.role === 'director' ? 'i-spark' : slot.role === 'art-director' ? 'i-pen' : slot.role === 'senior-animator' ? 'i-bone' : 'i-video'));
  const title = node('div', 'grow');
  const name = node('div', 'slot-name');
  const status = slot.agent ? (slot.status ?? 'off') : 'off';
  const chip = node('span', `chip${status === 'error' ? ' bad' : isRunning(slot) ? ' agent' : ''}`);
  chip.append(node('span', `dot${status === 'ready' ? ' on' : status === 'starting' || status === 'working' ? ' on busy' : status === 'error' ? ' bad' : ''}`), document.createTextNode(t(`agent.status.${status}`)));
  name.append(node('b', '', t(`agent.role.${slot.role}`)), chip);
  title.append(name, node('p', 't-caption', t(`agent.roleLead.${slot.role}`)));
  head.append(badge, title, agentPicker(slot));
  const model = modelPicker(slot);
  if (model) head.append(model);
  const action = slotAction(slot);
  if (action === 'stop') {
    const stop = button('btn sm', t('agent.stop'), 'i-close');
    stop.addEventListener('click', () => call('/api/agent/stop', { slot: slot.id }));
    head.append(stop);
  } else if (action === 'off') {
    const off = button('btn sm ghost', t('agent.turnOff'), 'i-close');
    off.addEventListener('click', () => save({ id: slot.id, patch: { agent: null } }));
    head.append(off);
  }
  if (slot.role !== 'director') {
    const remove = button('btn ghost sm icon', '', 'i-close');
    remove.setAttribute('aria-label', t('agent.remove', { role: t(`agent.role.${slot.role}`) }));
    remove.title = remove.getAttribute('aria-label');
    remove.addEventListener('click', () => save({ remove: slot.id }));
    head.append(remove);
  }
  row.append(head);
  if (slot.message) row.append(node('p', `t-caption slot-message${status === 'error' ? ' bad' : ''}`, slot.message));
  const last = Array.isArray(slot.activity) ? slot.activity[slot.activity.length - 1] : null;
  if (last?.name) row.append(node('p', 't-caption', t('agent.lastActivity', { name: last.name, when: whenText(last.at, Date.now(), S.lang) })));
  if (slot.role !== 'director') {
    const id = `brief-${slot.id}`;
    const label = node('label', 'field-label', t('agent.brief'));
    label.htmlFor = id;
    const brief = node('textarea', 'input brief');
    brief.id = id; brief.rows = 2; brief.maxLength = 2000;
    brief.value = slot.brief ?? '';
    brief.placeholder = t(`agent.briefPlaceholder.${slot.role}`);
    brief.addEventListener('change', () => save({ id: slot.id, patch: { brief: brief.value.trim() } }));
    row.append(label, brief);
  }
  return row;
}

export function renderAgentSlots() {
  el.agentSlots.hidden = !data;
  el.externalTitle.hidden = !data;
  if (!data) return;
  el.slotList.replaceChildren(...orderSlots(data.slots).map(slotRow));
  const missing = (data.agents ?? []).filter(a => !a.installed && a.install);
  const adds = rolesToAdd(data.slots).map(role => {
    const add = button('btn sm ghost', t('agent.add', { role: t(`agent.role.${role}`) }), 'i-plus');
    add.addEventListener('click', () => save({ add: role }));
    return add;
  });
  const help = missing.length ? [node('p', 't-caption slot-install', missing.map(a => t('agent.install', { name: a.name ?? agentName(a.id), install: a.install })).join(' '))] : [];
  el.slotAdd.replaceChildren(...adds, ...help);
}
