// Who is in the room: the rules behind the bar's agent pill. The studio can run an AI of its own
// (the embedded agent, a Director slot and helpers) or be driven by any MCP client the owner runs.
// No DOM here, so a test can load it.

/** The command-line agents the studio knows by id, as people call them. */
export const AGENT_NAMES = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' });
export const SLOT_STATUSES = Object.freeze(['off', 'starting', 'ready', 'working', 'error']);

export const agentName = id => AGENT_NAMES[id] ?? (id ? String(id) : null);

/** The slots of the embedded agent the state carries, or none. */
export const slotsOf = agent => (Array.isArray(agent?.slots) ? agent.slots : []);

/** The Director slot when the embedded agent has one running (any status but off), else null. */
export function directorOf(agent) {
  const director = slotsOf(agent).find(s => s.role === 'director') ?? null;
  return director && director.agent && SLOT_STATUSES.includes(director.status) && director.status !== 'off' ? director : null;
}

/**
 * What the pill says. tone: on (an AI is here), busy (it is working), wait (nobody yet), bad (the
 * studio or the agent failed). key is the locale key of the words after the name.
 * @returns {{ tone: 'on'|'busy'|'wait'|'bad', name: string|null, key: string, embedded: boolean }}
 */
export function pillState(state, online = true) {
  if (!online) return { tone: 'bad', name: null, key: 'nav.offline', embedded: false };
  const agent = state?.agent ?? null;
  const director = directorOf(agent);
  if (director) {
    const tone = director.status === 'error' ? 'bad' : director.status === 'ready' ? 'on' : 'busy';
    return { tone, name: agentName(director.agent), key: `agent.status.${director.status}`, embedded: true };
  }
  if (agent?.connected) {
    const tone = agent.work === 'writing' || agent.work === 'checking' ? 'busy' : 'on';
    return agent.name ? { tone, name: agent.name, key: 'nav.connectedShort', embedded: false } : { tone, name: null, key: 'nav.connectedAnon', embedded: false };
  }
  return { tone: 'wait', name: null, key: 'nav.waiting', embedded: false };
}

// ---------- the embedded agent's slots (Settings → AI connection) ----------

/** The roles a slot can have: the Director first, then the helpers the owner can add. */
export const SLOT_ROLES = Object.freeze(['director', 'art-director', 'senior-animator', 'researcher']);
const RUNNING = new Set(['starting', 'ready', 'working']);

/** Is the slot's agent running (so Stop makes sense)? */
export const isRunning = slot => RUNNING.has(slot?.status);

/** The slots in the order Settings lists them: the Director first (there is always one), then the rest as they came. */
export function orderSlots(slots) {
  const list = (Array.isArray(slots) ? slots : []).filter(s => s && typeof s.id === 'string' && SLOT_ROLES.includes(s.role));
  const director = list.find(s => s.role === 'director') ?? { id: 'director', role: 'director', agent: null, status: 'off' };
  return [director, ...list.filter(s => s !== director && s.role !== 'director')];
}

/** The helper roles that have no slot yet (one slot per role). */
export const rolesToAdd = slots => SLOT_ROLES.filter(role => role !== 'director' && !orderSlots(slots).some(s => s.role === role));

/** What PUT /api/agent/slots takes: each slot's id, role, agent (null for none), and its tools and brief when it has them. */
export function slotsForSave(slots) {
  return orderSlots(slots).map(({ id, role, agent, tools, brief, model }) => ({
    id, role, agent: agent || null,
    ...(typeof model === 'string' ? { model } : {}),
    ...(Array.isArray(tools) ? { tools } : {}),
    ...(typeof brief === 'string' && role !== 'director' ? { brief } : {}),
  }));
}

/** The slots after one change: `patch` merged into the slot `id`, a new helper slot for `add`, or slot `remove` gone.
 * @param {any[]} slots
 * @param {{ id?: string, patch?: object, add?: string, remove?: string }} [change]
 */
export function changeSlots(slots, { id, patch, add, remove } = {}) {
  let list = orderSlots(slots);
  if (add && rolesToAdd(list).includes(add)) list = [...list, { id: add, role: add, agent: null, brief: '', status: 'off' }];
  if (remove && remove !== 'director') list = list.filter(s => s.id !== remove);
  if (id && patch) list = list.map(s => (s.id === id ? { ...s, ...patch } : s));
  return list;
}
