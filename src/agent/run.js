// One headless run of an agent CLI: start it in the project folder, give it the request on
// standard input, read its stream line by line through the adapter, and settle once with the
// answer or the reason it failed. A run can be stopped, and stops itself at its time limit;
// either way the CLI and everything it started are ended, not left behind.
//
// Node-only (layer `agent`).

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { commandFor } from './locate.js';

const STDERR_KEEP = 4000;
const KILL_GRACE_MS = 3000;

/**
 * @typedef {object} RunResult
 * @property {boolean} ok
 * @property {string} text the final answer ('' when there is none)
 * @property {string|null} session the CLI session id, when it said one
 * @property {string[]} tools every tool the run started, in order
 * @property {string[]} texts every text block the agent wrote, in order
 * @property {'agent-failed'|'agent-timeout'|'agent-stopped'|'agent-start-failed'|'agent-signed-out'} [code]
 * @property {string} [message]
 */

/** End a process and its children: a process group on POSIX, the tree on Windows. */
export function killTree(child, platform = process.platform) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  const signal = sig => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* already gone */ } } };
  signal('SIGTERM');
  setTimeout(() => { if (child.exitCode === null && child.signalCode === null) signal('SIGKILL'); }, KILL_GRACE_MS).unref();
}

const SIGNED_OUT = /not logged in|please run \/login|invalid api key|please (log|sign) ?in|not authenticated|unauthenticated/i;
/** What the owner does when the agent's CLI is installed but not signed in. */
export const signedOutMessage = adapter => `${adapter.name} is installed but not signed in. Open a terminal, run \`${adapter.bin}\`, sign in, then send your message again.`;

/**
 * @param {object} options
 * @param {import('./adapters.js').Adapter} options.adapter
 * @param {string} options.cli the located executable
 * @param {import('./adapters.js').RunPlan} options.plan
 * @param {string} options.prompt the request, written to standard input
 * @param {NodeJS.ProcessEnv} [options.env] the environment the CLI runs with (the owner's own: it carries their login)
 * @param {number} [options.timeoutMs]
 * @param {(event: import('./adapters.js').AgentEvent) => void} [options.onEvent]
 * @returns {{ done: Promise<RunResult>, stop(): void, pid: number|undefined }}
 */
export function startRun({ adapter, cli, plan, prompt, env = process.env, timeoutMs = 20 * 60_000, onEvent = () => {} }) {
  const built = adapter.command(plan);
  for (const [file, content] of Object.entries(built.files ?? {})) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const { command, args, shell } = commandFor(cli, built.args);
  /** @type {RunResult} */
  const result = { ok: false, text: '', session: null, tools: [], texts: [] };
  let current = '', finished = false, stderr = '', buffer = '', ending = /** @type {null|'agent-timeout'|'agent-stopped'} */ (null);
  /** @type {import('./adapters.js').AgentEvent|null} */
  let terminal = null;

  let child;
  try {
    child = spawn(command, args, {
      cwd: plan.projectDir, env: { ...env, ...(built.env ?? {}) }, shell, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    return { done: Promise.resolve({ ...result, code: 'agent-start-failed', message: String(err?.message ?? err) }), stop() {}, pid: undefined };
  }

  const handle = event => {
    if (event.type === 'session') result.session = event.session;
    else if (event.type === 'text') {
      // The answer is what the agent said after its last tool call.
      current = event.delta ? current + event.text : event.text;
      if (!event.delta) result.texts.push(event.text);
    } else if (event.type === 'tool' && event.phase === 'start') { result.tools.push(event.name); current = ''; }
    else if (event.type === 'done' || event.type === 'error') {
      terminal = terminal ?? event;
      if (event.type === 'done' && event.session) result.session = event.session;
    }
    try { onEvent(event); } catch { /* a listener never breaks the run */ }
  };
  const feed = chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) for (const event of adapter.parse(line)) handle(event);
    }
  };

  const done = new Promise(resolve => {
    const timer = setTimeout(() => { ending = 'agent-timeout'; killTree(child); }, timeoutMs);
    timer.unref?.();
    const settle = (/** @type {Partial<RunResult>} */ extra) => {
      if (finished) return;
      // A CLI that is installed but not signed in answers in its own terminal words ("Please run
      // /login"): say what to do from the studio instead.
      const said = extra.ok ? (result.tools.length || (extra.text ?? '').length > 200 ? '' : extra.text) : `${extra.message ?? ''} ${extra.text ?? ''}`;
      if (extra.code !== 'agent-stopped' && extra.code !== 'agent-timeout' && SIGNED_OUT.test(said ?? '')) {
        extra = { ok: false, text: '', code: 'agent-signed-out', message: signedOutMessage(adapter) };
      }
      finished = true;
      clearTimeout(timer);
      resolve({ ...result, ...extra });
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', feed);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-STDERR_KEEP); });
    child.on('error', err => settle({ ok: false, code: 'agent-start-failed', message: `${adapter.name} could not start: ${err.message}` }));
    child.on('close', code => {
      if (buffer.trim()) feed('\n');
      const text = (/** @type {any} */ (terminal)?.type === 'done' && /** @type {any} */ (terminal).text) || current || '';
      if (ending === 'agent-stopped') return settle({ ok: false, text, code: 'agent-stopped', message: 'Stopped.' });
      if (ending === 'agent-timeout') return settle({ ok: false, text, code: 'agent-timeout', message: `${adapter.name} took longer than ${Math.round(timeoutMs / 60000) || '<1'} min and was stopped.` });
      if (/** @type {any} */ (terminal)?.type === 'error') return settle({ ok: false, text, code: 'agent-failed', message: /** @type {any} */ (terminal).message });
      if (terminal || (code === 0 && text)) return settle({ ok: true, text: text.trim() });
      const tail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
      return settle({ ok: false, text, code: 'agent-failed', message: tail || `${adapter.name} ended (exit code ${code}) without an answer.` });
    });
    child.stdin.on('error', () => { /* a CLI that exits before reading its input */ });
    child.stdin.end(prompt);
  });

  return {
    done,
    pid: child.pid,
    stop() { if (!finished && !ending) { ending = 'agent-stopped'; killTree(child); } },
  };
}
