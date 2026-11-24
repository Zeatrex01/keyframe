// The slots: which agent CLI plays which role. Exactly one agent per slot; the `director` slot is
// the one the owner talks to and always exists. Extra slots (an illustrator, a researcher, any
// named role) each have their own CLI, tool scope and brief.
//
// The slots are a machine-local setting, kept in the studio's config file under `agentSlots`
// beside the project registry (src/core/projects.js). The session id each slot resumes is per
// project, in the project's own `.keyframe/agent-sessions.json`, so switching projects never
// carries one project's conversation into another.
//
// Node-only (layer `agent`).

import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';
import { readConfig, writeConfig } from '../core/projects.js';
import { CHAT_DIR } from '../core/chat.js';
import { AGENT_IDS } from './adapters.js';
import { KNOWN_TOOLS, TOOL_SCOPES, defaultScope } from './roles.js';

export const MAX_SLOTS = 6;
export const MAX_BRIEF = 2000;
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const CONFIG_KEY = 'agentSlots';

/**
 * @typedef {{ id: string, role: string, agent: string|null, tools: 'studio'|'read'|string[], brief: string }} Slot
 */

/** @returns {Slot[]} */
export const defaultSlots = () => [{ id: 'director', role: 'director', agent: null, tools: 'studio', brief: '' }];

const bad = (message, details = {}) => new StudioError('bad-slots', message, details);

/**
 * Check a slot list from the page and fill in the defaults. Refuses the whole list on the first problem.
 * @param {unknown} input
 * @returns {Slot[]}
 */
export function validateSlots(input) {
  if (!Array.isArray(input) || input.length === 0) throw bad('"slots" must be a non-empty list.');
  if (input.length > MAX_SLOTS) throw bad(`At most ${MAX_SLOTS} slots.`, { count: input.length });
  const ids = new Set();
  const slots = input.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad(`Slot ${i + 1} must be an object.`, { index: i });
    const { id, role, agent = null, tools, brief = '' } = /** @type {Record<string, any>} */ (raw);
    if (typeof id !== 'string' || !ID.test(id)) throw bad(`Slot ${i + 1}: "id" is lower-case letters, digits and dashes, starting with a letter.`, { index: i });
    if (ids.has(id)) throw bad(`Slot id "${id}" is used twice.`, { id });
    ids.add(id);
    if (typeof role !== 'string' || !ID.test(role)) throw bad(`Slot "${id}": "role" is lower-case letters, digits and dashes.`, { id });
    if (id === 'director' && role !== 'director') throw bad('The "director" slot plays the director role.', { id });
    if (id !== 'director' && role === 'director') throw bad('Only the "director" slot plays the director role.', { id });
    if (agent !== null && !AGENT_IDS.includes(agent)) throw bad(`Slot "${id}": "agent" is one of ${AGENT_IDS.join(', ')} or null.`, { id, agent });
    let scope = tools ?? defaultScope(role);
    if (typeof scope === 'string') {
      if (!(scope in TOOL_SCOPES)) throw bad(`Slot "${id}": "tools" is ${Object.keys(TOOL_SCOPES).join(' or ')}, or a list of tool names.`, { id });
    } else if (Array.isArray(scope)) {
      const unknown = scope.filter(t => typeof t !== 'string' || !KNOWN_TOOLS.includes(t));
      if (unknown.length || scope.length === 0) throw bad(`Slot "${id}": unknown tools ${unknown.join(', ') || '(empty list)'}.`, { id, unknown });
      scope = [...new Set(scope)];
    } else throw bad(`Slot "${id}": "tools" is a scope name or a list of tool names.`, { id });
    if (typeof brief !== 'string' || brief.length > MAX_BRIEF) throw bad(`Slot "${id}": "brief" is text of at most ${MAX_BRIEF} characters.`, { id });
    return { id, role, agent, tools: scope, brief: brief.trim() };
  });
  if (!ids.has('director')) throw bad('A "director" slot is required: it is the one the owner talks to.');
  // The director comes first, always: it is started first and listed first.
  return [...slots.filter(s => s.id === 'director'), ...slots.filter(s => s.id !== 'director')];
}

/**
 * The saved slots, or the default (a director with no agent) when none are saved or the saved
 * list no longer passes (a hand-edited config never stops the studio).
 * @param {string} [file] the config file
 * @returns {Slot[]}
 */
export function readSlots(file) {
  const saved = readConfig(file)[CONFIG_KEY];
  if (saved === undefined) return defaultSlots();
  try { return validateSlots(saved); } catch { return defaultSlots(); }
}

/**
 * Validate and save; answers what was saved.
 * @param {unknown} input
 * @param {string} [file]
 */
export function writeSlots(input, file) {
  const slots = validateSlots(input);
  const config = readConfig(file);
  config[CONFIG_KEY] = slots;
  writeConfig(config, file);
  return slots;
}

// ---------- per-project session ids ----------

const sessionsFile = projectDir => path.join(projectDir, CHAT_DIR, 'agent-sessions.json');

/** @returns {Record<string, { agent: string, session: string, at: string }>} */
function readSessions(projectDir) {
  try { const v = JSON.parse(fs.readFileSync(sessionsFile(projectDir), 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** The session a slot resumes in this project, when it was started by the same CLI. */
export function sessionFor(projectDir, slotId, agent) {
  const entry = readSessions(projectDir)[slotId];
  return entry && entry.agent === agent && typeof entry.session === 'string' ? entry.session : null;
}

/** Remember (or with null, forget) the session a slot resumes in this project. */
export function saveSession(projectDir, slotId, agent, session, now = Date.now()) {
  const all = readSessions(projectDir);
  if (session) all[slotId] = { agent, session, at: new Date(now).toISOString() };
  else delete all[slotId];
  fs.mkdirSync(path.dirname(sessionsFile(projectDir)), { recursive: true });
  const tmp = `${sessionsFile(projectDir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, sessionsFile(projectDir));
}
