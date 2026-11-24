// The conversation between the owner (in the page) and whichever agent is connected.
//
// Two processes share it through the project folder: the HTTP server the page talks to and the
// MCP server the agent talks to. So the store is files, append-only for messages:
//   <project>/.keyframe/chat.jsonl   one JSON message per line
//   <project>/.keyframe/agent.state  the agent's cursor, last-seen time and work state
// No API key and no network: the agent is the one the owner already runs.

import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';

export const CHAT_DIR = '.keyframe';
export const WORK_STATES = Object.freeze(['idle', 'writing', 'checking', 'ready']);
export const MAX_TEXT = 4000;
const AGENT_FRESH_MS = 90_000;
// While it waits, the agent is stamped as seen this often (well inside AGENT_FRESH_MS), not on
// every poll: a write into the owner's folder twice a second wakes sync clients and disks for nothing.
const SEEN_REFRESH_MS = 15_000;
// The page's server and the agent's MCP server append from two processes. The next id is read
// and the line appended under this lock, so two messages never share an id (a shared id hides one
// in the page and can move the agent's cursor past a message it never read).
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 10_000;

const chatFile = dir => path.join(dir, CHAT_DIR, 'chat.jsonl');
const stateFile = dir => path.join(dir, CHAT_DIR, 'agent.state');
const lockFile = dir => path.join(dir, CHAT_DIR, 'chat.lock');
const LOCK_BUSY = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withChatLock(projectDir, fn) {
  const lock = lockFile(projectDir);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (err) {
      // Windows answers EPERM (or EACCES) while another process is still deleting the lock: busy, not broken.
      if (!LOCK_BUSY.has(err.code)) throw err;
      // A lock left by a process that died mid-append is taken over once it is clearly old.
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { age = 0; }
      if (age > LOCK_STALE_MS) { removeLock(lock); continue; }
      if (Date.now() > deadline) {
        // Still refused with no lock there: the folder itself does not let us write.
        if (err.code !== 'EEXIST' && !fs.existsSync(lock)) throw err;
        throw new StudioError('busy', 'The conversation is busy; send the message again.');
      }
      pause(3);
    }
  }
  try { return fn(); } finally { removeLock(lock); }
}

function removeLock(lock) {
  for (let tries = 0; ; tries++) {
    try { fs.rmSync(lock, { force: true }); return; } catch (err) {
      if (!LOCK_BUSY.has(err.code) || tries >= 50) throw err;
      pause(2);
    }
  }
}

/** Every message after `afterId`, oldest first. A torn last line (mid-append) is skipped. */
export function readMessages(projectDir, afterId = 0) {
  let text = '';
  try { text = fs.readFileSync(chatFile(projectDir), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); if (m && m.id > afterId) out.push(m); } catch { /* torn line */ }
  }
  return out;
}

/** Append one message and return it with its id. */
export function appendMessage(projectDir, { from, text, ...extra }, now = Date.now()) {
  if (from !== 'owner' && from !== 'agent') throw new StudioError('bad-argument', 'A message is from "owner" or "agent".', { from });
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) throw new StudioError('bad-argument', 'A message needs text.');
  if (body.length > MAX_TEXT) throw new StudioError('bad-argument', `A message is at most ${MAX_TEXT} characters.`, { length: body.length });
  fs.mkdirSync(path.join(projectDir, CHAT_DIR), { recursive: true });
  return withChatLock(projectDir, () => {
    const lastId = readMessages(projectDir).reduce((max, m) => (Number.isFinite(m.id) && m.id > max ? m.id : max), 0);
    const message = { ...extra, id: lastId + 1, from, text: body, time: new Date(now).toISOString() };
    fs.appendFileSync(chatFile(projectDir), `${JSON.stringify(message)}\n`);
    return message;
  });
}

export function readAgent(projectDir, now = Date.now()) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile(projectDir), 'utf8')); } catch { /* never connected */ }
  const lastSeen = state.lastSeen ?? null;
  return { cursor: state.cursor ?? 0, work: WORK_STATES.includes(state.work) ? state.work : 'idle',
    name: state.name ?? null, focusSeen: state.focusSeen ?? null, lastSeen, connected: lastSeen !== null && now - Date.parse(lastSeen) < AGENT_FRESH_MS };
}

/** Merge a patch into the agent's state and stamp it as seen now. */
export function touchAgent(projectDir, patch = {}, now = Date.now()) {
  if (patch.work !== undefined && !WORK_STATES.includes(patch.work)) {
    throw new StudioError('bad-argument', `work is one of ${WORK_STATES.join(', ')}.`, { work: patch.work });
  }
  fs.mkdirSync(path.join(projectDir, CHAT_DIR), { recursive: true });
  const { connected, ...current } = readAgent(projectDir, now);
  const next = { ...current, ...patch, lastSeen: new Date(now).toISOString() };
  const tmp = `${stateFile(projectDir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, stateFile(projectDir));
  return next;
}

/**
 * Wait until the owner has said something the agent has not read, or the time is up.
 * Returns the unread owner messages (possibly none) and advances the agent's cursor.
 * @param {string} projectDir
 * @param {{ timeoutMs?: number, pollMs?: number, signal?: AbortSignal, name?: string }} [options]
 */
export async function waitForOwner(projectDir, { timeoutMs = 50_000, pollMs = 400, signal, name } = {}) {
  const deadline = Date.now() + timeoutMs;
  let stamped = -Infinity;
  for (;;) {
    const fresh = Date.now() - stamped < SEEN_REFRESH_MS;
    const agent = fresh ? readAgent(projectDir) : touchAgent(projectDir, name ? { name } : {});
    if (!fresh) stamped = Date.now();
    const unread = readMessages(projectDir, agent.cursor);
    const fromOwner = unread.filter(m => m.from === 'owner');
    if (fromOwner.length) {
      touchAgent(projectDir, { cursor: unread[unread.length - 1].id });
      return fromOwner;
    }
    if (unread.length) { touchAgent(projectDir, { cursor: unread[unread.length - 1].id }); stamped = Date.now(); }
    if (signal?.aborted || Date.now() >= deadline) return [];
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}
