// The Director's team: how the Director's run hands one task to a helper slot (the Art Director,
// the Senior Animator, the Researcher) and gets its answer back.
//
// The Director's tools run in their own MCP server process, started by its CLI; the slots are
// run by the studio (src/agent/hub.js). The two meet in the project folder: the ask_team tool
// leaves an ask in .keyframe/team/, the hub takes it (a rename, so it is taken once), runs the
// helper slot with it and leaves the answer beside it, and the tool returns that answer.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { CHAT_DIR } from './chat.js';

export const TEAM_DIR = 'team';
export const MAX_TASK = 4000;
const ID = /^[0-9]{13}-[a-z0-9]{6}$/;

const teamDir = dir => path.join(dir, CHAT_DIR, TEAM_DIR);
const file = (dir, id, kind) => path.join(teamDir(dir), `${id}.${kind}.json`);

function writeAtomic(abs, value) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, abs);
}

const readJson = abs => { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; } };

/**
 * Leave an ask for the hub. Answers its id.
 * @param {string} dir the project folder
 * @param {{ slot: string, task: string }} ask
 * @param {number} [now]
 */
export function postAsk(dir, { slot, task }, now = Date.now()) {
  const id = `${now}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
  writeAtomic(file(dir, id, 'ask'), { id, slot, task, at: new Date(now).toISOString() });
  return id;
}

/**
 * Take every waiting ask (each is taken once, even with two readers).
 * @param {string} dir
 * @returns {Array<{ id: string, slot: string, task: string }>}
 */
export function takeAsks(dir) {
  let names;
  try { names = fs.readdirSync(teamDir(dir)); } catch { return []; }
  const taken = [];
  for (const name of names.filter(n => n.endsWith('.ask.json')).sort()) {
    const id = name.slice(0, -'.ask.json'.length);
    if (!ID.test(id)) continue;
    try { fs.renameSync(file(dir, id, 'ask'), file(dir, id, 'taken')); } catch { continue; }
    const ask = readJson(file(dir, id, 'taken'));
    if (ask && typeof ask.slot === 'string' && typeof ask.task === 'string') taken.push({ id, slot: ask.slot, task: ask.task });
  }
  return taken;
}

/**
 * The hub's answer to an ask.
 * @param {string} dir
 * @param {string} id
 * @param {{ ok: boolean, text?: string, code?: string, message?: string, tools?: number }} answer
 */
export function answerAsk(dir, id, answer) {
  if (!ID.test(id)) return;
  writeAtomic(file(dir, id, 'answer'), answer);
  try { fs.rmSync(file(dir, id, 'taken'), { force: true }); } catch { /* the answer is what counts */ }
}

/**
 * Wait for the answer to an ask; null when the time runs out or the call is cancelled (the ask
 * is withdrawn if nobody took it yet).
 * @param {string} dir
 * @param {string} id
 * @param {{ timeoutMs: number, signal?: AbortSignal, pollMs?: number }} options
 */
export async function waitAnswer(dir, id, { timeoutMs, signal, pollMs = 250 }) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const answer = readJson(file(dir, id, 'answer'));
    if (answer) { fs.rmSync(file(dir, id, 'answer'), { force: true }); return answer; }
    if (signal?.aborted || Date.now() >= end) { fs.rmSync(file(dir, id, 'ask'), { force: true }); return null; }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
