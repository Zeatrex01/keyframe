// The embedded agent: the owner's own agent CLI, driven headless from the studio's chat panel,
// so nobody needs a second terminal. One agent per slot, one run at a time per slot.
//
// The flow: the owner's message is appended to the project conversation (.keyframe/chat.jsonl)
// as always; when the director slot has an installed CLI, a run starts with that message (the
// CLI's own session, resumed per project, carries the conversation before it). Its tool calls
// show as activity; its final answer is appended to the conversation as an agent message that
// carries the CLI's name. A message that arrives while the director works waits and goes in the
// next run. Extra slots run the same way when they are given a task.
//
// What a run may touch: the studio's MCP server for this project, serving only the slot's tools
// (enforced by the server itself, and again by the CLI's own allow-list where it has one), with
// the project folder as its working folder. No shell, no file tools, no credentials: the CLI
// runs on the owner's own login.
//
// Node-only (layer `agent`).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioError } from '../shared/errors.js';
import { appendMessage, readMessages, readAgent, touchAgent, MAX_TEXT, CHAT_DIR } from '../core/chat.js';
import { unproven } from '../core/proof.js';
import { silentLogger } from '../core/log.js';
import { ADAPTERS, adapterFor } from './adapters.js';
import { locateCli } from './locate.js';
import { briefFor, toolsFor, TEAM_TOOL } from './roles.js';
import { takeAsks, answerAsk } from '../core/team.js';
import { readSlots, writeSlots, sessionFor, saveSession } from './slots.js';
import { startRun } from './run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACTIVITY_KEEP = 20;
const CONTEXT_MESSAGES = 12;
const SEEN_REFRESH_MS = 15_000;
const TEAM_POLL_MS = 400;
export const DEFAULT_TIMEOUT_MS = 20 * 60_000;

// What the owner sees while a run works: the phase follows the tool being called.
const PHASES = {
  answering: ['reply'],
  reading: ['start_here', 'help', 'scan_project', 'brief', 'read_rig', 'read_animation', 'sample_animation', 'describe_animation', 'see_reference', 'measure_reference', 'list_history'],
  writing: ['write_animation', 'set_curves', 'add_effect', 'draw_rig', 'apply_motion', 'bake_animation', 'paint_weights', 'delete_animation', 'restore_file'],
  checking: ['check_skeleton', 'critique_animation', 'see_animation', 'compare_reference'],
};
/** @param {string} tool */
export const phaseOf = tool => Object.keys(PHASES).find(k => PHASES[k].includes(tool)) ?? 'working';
const LIVE_TEXT = 4000;
// A tool phase stays on screen at least this long: checks often take a fraction of a second, and
// the page, which asks about once a second, would otherwise only ever see "Thinking".
export const MIN_PHASE_MS = 1500;

/**
 * What the page shows: the live phase, or the tool phase just finished while it is still young.
 * @param {{ phase: string, tool: string|null, held?: { phase: string, tool: string, until: number } }} live
 * @param {number} now
 */
export function shownPhase(live, now) {
  if (live.phase === 'thinking' && live.held && now < live.held.until) return { phase: live.held.phase, tool: live.held.tool };
  return { phase: live.phase, tool: live.tool };
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * @param {object} [options]
 * @param {string} [options.configFile] the studio config (where the slots are saved)
 * @param {NodeJS.ProcessEnv} [options.env] where the CLIs are looked up and the environment they run with
 * @param {string} [options.root] the checkout (its tools/mcp-server.js is what a run connects to)
 * @param {number} [options.timeoutMs] the longest one run may take
 * @param {ReturnType<typeof import('../core/log.js').createLogger>} [options.log]
 */
export function createAgentHub({ configFile, env = process.env, root = ROOT, timeoutMs, log = silentLogger } = {}) {
  const limit = timeoutMs ?? (Number(env.KS_AGENT_TIMEOUT_MS) > 0 ? Number(env.KS_AGENT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS);
  /** @type {Record<string, string|null>} */
  let found = {};
  /** @type {Map<string, { status: string, message?: string, live?: null|{ phase: string, tool: string|null, text: string, startedAt: number }, activity: Array<{ kind: string, name: string, at: string, dir?: string }>, lastDir?: string, run: null|{ stop(): void, dir: string }, pending: Array<{ dir: string, text: string }>, idle: Promise<void>, settle?: () => void, team?: ReturnType<typeof setInterval>|null }>} */
  const states = new Map();

  function detect() {
    found = Object.fromEntries(ADAPTERS.map(a => [a.id, locateCli(a, env)]));
    return found;
  }
  detect();

  const stateOf = id => {
    if (!states.has(id)) states.set(id, { status: 'ready', activity: [], run: null, pending: [], idle: Promise.resolve() });
    return states.get(id);
  };
  const install = adapter => adapter.install[process.platform] ?? adapter.install.other;

  function agents() {
    return ADAPTERS.map(a => ({ id: a.id, name: a.name, installed: !!found[a.id], install: install(a), models: a.models, defaultModel: a.defaultModel }));
  }

  /**
   * A slot as the page shows it, for the open project: what it did and said elsewhere (another
   * project's activity, its error or stop) is left out, so a project never shows another's state.
   * @param {object} slot @param {string|null} [dir] the open project; omitted, everything
   */
  function slotSummary(slot, dir) {
    const st = stateOf(slot.id);
    const here = dir === undefined || !st.lastDir || st.lastDir === dir;
    const adapter = slot.agent ? adapterFor(slot.agent) : null;
    let status = st.run || here ? st.status : (st.status === 'error' ? 'ready' : st.status), message = here ? st.message : undefined;
    if (!st.run) {
      if (!adapter) { status = 'off'; message = undefined; }
      else if (!found[adapter.id]) { status = 'error'; message = `${adapter.name} is not installed here. ${install(adapter)}`; }
    }
    return { id: slot.id, role: slot.role, agent: slot.agent, tools: slot.tools, brief: slot.brief, model: slot.model ?? adapter?.defaultModel ?? '', status,
      ...(message ? { message } : {}), activity: st.activity.filter(a => dir === undefined || !a.dir || a.dir === dir),
      ...(st.run && st.live ? { live: liveSummary(st.live) } : {}) };
  }

  function liveSummary(live) {
    const now = Date.now();
    const { held, ...rest } = live;
    return { ...rest, ...shownPhase(live, now), seconds: Math.round((now - live.startedAt) / 1000) };
  }

  /** @param {string|null} [dir] the open project (see slotSummary) */
  function summary(dir) {
    return { slots: readSlots(configFile).map(slot => slotSummary(slot, dir)), agents: agents() };
  }

  function note(st, kind, name) {
    st.activity.push({ kind, name: clip(String(name ?? ''), 120), at: new Date().toISOString(), ...(st.lastDir ? { dir: st.lastDir } : {}) });
    if (st.activity.length > ACTIVITY_KEEP) st.activity.splice(0, st.activity.length - ACTIVITY_KEEP);
  }

  /** What a fresh session is told before the request: the brief when the CLI has no system prompt, and the recent conversation. */
  /** When the slot's last turn was stopped by the owner, the words that say it is cancelled. */
  function cancelledNote(slot, dir, uptoId) {
    const earlier = readMessages(dir).filter(m => uptoId === undefined || m.id < uptoId);
    const lastTurn = earlier.filter(m => m.from !== 'owner' && (m.slot ?? 'director') === slot.id).at(-1);
    if (!lastTurn?.stopped) return '';
    const asked = earlier.filter(m => m.from === 'owner' && m.id < lastTurn.id).at(-1);
    return `The owner pressed Stop during your previous turn${asked ? ` (their request was: "${clip(String(asked.text), 300)}")` : ''}. `
      + 'That request is cancelled: do not continue it, finish it or write anything for it unless the owner asks for it again. '
      + 'Work only on what they write now.';
  }

  function promptFor({ adapter, slot, dir, text, resume, uptoId }) {
    const cancelled = cancelledNote(slot, dir, uptoId);
    if (resume) return cancelled ? `${cancelled}\n\nThe owner now writes:\n${text}` : text;
    const parts = [];
    if (!adapter.systemPrompt) parts.push(briefFor(slot.role, slot.brief));
    if (slot.role === 'director') {
      const earlier = readMessages(dir).filter(m => uptoId === undefined || m.id < uptoId).slice(-CONTEXT_MESSAGES);
      if (earlier.length) parts.push(`Earlier in this conversation:\n${earlier.map(m => `${m.from === 'owner' ? 'Owner' : 'Agent'}: ${clip(String(m.text), 600)}`).join('\n')}`);
      if (cancelled) parts.push(cancelled);
      parts.push(earlier.length ? `The owner now writes:\n${text}` : text);
    } else parts.push(text);
    return parts.join('\n\n');
  }

  /**
   * Start a run on a slot. Refuses when the slot has no agent, its CLI is not installed, or it is busy.
   * @param {string} slotId
   * @param {string} dir the project folder
   * @param {string} text the request
   * @param {{ uptoId?: number, onDone?: (result: { ok: boolean, text: string, code?: string, message?: string, tools: unknown[] }) => void }} [options]
   *   onDone: told how the run ended (a helper's answer goes back to the Director's ask_team)
   */
  function run(slotId, dir, text, { uptoId, onDone } = {}) {
    const slot = readSlots(configFile).find(s => s.id === slotId);
    if (!slot) throw new StudioError('unknown-slot', `There is no slot "${slotId}".`, { slot: slotId });
    if (typeof text !== 'string' || !text.trim()) throw new StudioError('bad-argument', 'A run needs text.');
    const adapter = slot.agent ? adapterFor(slot.agent) : null;
    if (!adapter) throw new StudioError('agent-off', `The ${slot.id} slot has no agent; choose one in Settings.`, { slot: slot.id });
    const cli = found[adapter.id] ?? detect()[adapter.id];
    if (!cli) throw new StudioError('no-agent-cli', `${adapter.name} is not installed here. ${install(adapter)}`, { slot: slot.id, agent: adapter.id });
    const st = stateOf(slot.id);
    if (st.run) throw new StudioError('agent-busy', `The ${slot.id} slot is still working; wait for it or stop it.`, { slot: slot.id });
    launch({ slot, adapter, cli, dir, text: text.trim(), uptoId, st, retried: false, onDone });
    return { slot: slot.id, started: true };
  }

  /** The helpers the Director may hand tasks to: every other slot that has an agent. */
  const teamOf = () => readSlots(configFile).filter(s => s.role !== 'director' && s.agent);

  function launch({ slot, adapter, cli, dir, text, uptoId, st, retried, onDone }) {
    const resume = sessionFor(dir, slot.id, adapter.id); // a retry finds none: the stale one was dropped
    const director = slot.role === 'director';
    const team = director ? teamOf() : [];
    const tools = [...toolsFor(slot.tools), ...(team.length ? [TEAM_TOOL] : [])];
    const plan = {
      projectDir: dir, tools, resume, model: slot.model ?? adapter.defaultModel,
      brief: adapter.systemPrompt ? briefFor(slot.role, slot.brief) : '',
      mcp: { command: process.execPath, args: [path.join(root, 'tools', 'mcp-server.js'), '--project', dir, '--only', tools.join(','),
        ...(team.length ? ['--team', team.map(m => `${m.id}:${m.role}`).join(',')] : [])] },
      configFile: path.join(dir, CHAT_DIR, 'agent', `${slot.id}-${adapter.id}.json`),
    };
    const before = readMessages(dir).reduce((max, m) => Math.max(max, Number(m.id) || 0), 0);
    const started = Date.now();
    if (!retried) {
      st.activity = [];
      st.idle = new Promise(resolve => { st.settle = resolve; });
    }
    st.status = 'starting'; st.message = undefined; st.lastDir = dir;
    // phase: starting -> thinking -> reading | writing | checking -> answering; text: the answer so far.
    st.live = { phase: 'starting', tool: null, text: '', startedAt: retried && st.live ? st.live.startedAt : Date.now() };
    let stamped = 0;
    const seen = (patch = {}) => {
      if (!director) return;
      try { touchAgent(dir, { name: adapter.name, ...patch }); stamped = Date.now(); } catch (err) { log.warn('agent state not written', { err }); }
    };
    // The steps bar (writing -> checking -> ready) follows what the run actually does: a question
    // never shows "Writing", a write does, and the checks after it show "Checking".
    let work = 'idle';
    const step = phase => {
      const next = phase === 'writing' ? 'writing' : phase === 'checking' && work !== 'idle' ? 'checking' : work;
      if (next !== work) { work = next; seen({ work }); }
    };
    seen({ work });
    const handle = startRun({
      adapter, cli, plan, env, timeoutMs: limit,
      prompt: promptFor({ adapter, slot, dir, text, resume, uptoId }),
      onEvent: event => {
        st.status = 'working';
        const live = st.live;
        if (event.type === 'session') {
          if (live.phase === 'starting') live.phase = 'thinking';
          try { saveSession(dir, slot.id, adapter.id, event.session); } catch { /* resumed fresh next time */ }
        } else if (event.type === 'tool' && event.phase === 'start') {
          if (live.tool !== event.name || !event.early) {
            Object.assign(live, { phase: phaseOf(event.name), tool: event.name, text: '' });
            live.held = { phase: live.phase, tool: event.name, until: Date.now() + MIN_PHASE_MS };
          }
          step(live.phase);
          if (!event.early) note(st, 'tool', event.name);
        } else if (event.type === 'tool' && event.phase === 'end') {
          // Between steps the page says which one was done last and how many, never a bare "Thinking".
          Object.assign(live, { phase: 'thinking', last: live.tool || (event.name !== 'result' ? event.name : null) || live.last || null, steps: (live.steps ?? 0) + 1, tool: null });
        } else if (event.type === 'text') {
          live.text = clip(event.delta ? live.text + event.text : event.text, LIVE_TEXT);
          live.phase = 'answering'; live.tool = null;
          if (!event.delta) note(st, 'text', event.text);
        } else if (event.type === 'error') note(st, 'error', event.message);
        if (Date.now() - stamped > SEEN_REFRESH_MS) seen();
      },
    });
    st.run = { stop: () => handle.stop(), dir };
    if (team.length && !st.team) st.team = setInterval(() => serveAsks(dir, team), TEAM_POLL_MS);
    log.info('agent run started', { slot: slot.id, agent: adapter.id, resume: !!resume });

    handle.done.then(result => {
      // A session the CLI no longer knows (cleared, or made on another machine): start fresh once.
      if (!result.ok && resume && result.code === 'agent-failed' && !result.tools.length && !result.texts.length) {
        try { saveSession(dir, slot.id, adapter.id, null); } catch { /* nothing to forget */ }
        st.run = null;
        return launch({ slot, adapter, cli, dir, text, uptoId, st, retried: true, onDone });
      }
      if (result.session) { try { saveSession(dir, slot.id, adapter.id, result.session); } catch { /* resumed fresh next time */ } }
      finish({ slot, adapter, dir, st, result, before, started, onDone });
    }).catch(err => {
      log.error('agent run failed unexpectedly', { slot: slot.id, err });
      finish({ slot, adapter, dir, st, result: { ok: false, text: '', session: null, tools: [], texts: [], code: 'agent-failed', message: String(err?.message ?? err) }, before, started, onDone });
    });
  }

  /** The Director's asks (ask_team): each runs its helper slot, and the helper's answer goes back. */
  function serveAsks(dir, team) {
    for (const ask of takeAsks(dir)) {
      const member = team.find(m => m.id === ask.slot);
      if (!member) { answerAsk(dir, ask.id, { ok: false, code: 'unknown-slot', message: `there is no helper "${ask.slot}"` }); continue; }
      log.info('director asks a helper', { slot: member.id });
      try {
        run(member.id, dir, `The Director asks:\n${ask.task}`, {
          onDone: result => answerAsk(dir, ask.id, result.ok
            ? { ok: true, text: result.text.trim(), tools: result.tools.length }
            : { ok: false, code: result.code, message: result.message ?? result.code }),
        });
      } catch (err) {
        answerAsk(dir, ask.id, { ok: false, code: err?.code ?? 'agent-failed', message: String(err?.message ?? err) });
      }
    }
  }

  function finish({ slot, adapter, dir, st, result, before, started = Date.now(), onDone }) {
    const director = slot.role === 'director';
    if (st.team) {
      clearInterval(st.team); st.team = null;
      // An ask left when the Director's turn ends has nobody to answer to.
      for (const ask of takeAsks(dir)) answerAsk(dir, ask.id, { ok: false, code: 'agent-stopped', message: 'the Director\'s turn ended' });
      // A helper still working for a turn that was stopped stops with it.
      for (const member of teamOf()) states.get(member.id)?.run?.stop();
    }
    try { onDone?.(result); } catch (err) { log.warn('run result not handed back', { slot: slot.id, err }); }
    const name = adapter.name;
    try {
      if (result.ok) {
        // What the agent already said through `reply` during the run is not said twice, and a
        // reply that delivered (work "ready", with its result card) is the turn's answer: the
        // closing words of the run would only repeat it at more length.
        const replies = readMessages(dir, before).filter(m => m.from === 'agent');
        const said = replies.map(m => String(m.text).trim());
        const delivered = replies.some(m => m.work === 'ready');
        const text = clip(result.text.trim(), MAX_TEXT);
        const work = director && readAgent(dir).work === 'ready' ? 'ready' : 'idle';
        // What this turn wrote and did not prove is said plainly: it is not delivered yet.
        const open = unproven(dir, started);
        const proofNote = open.length ? `Not proven yet: ${open.slice(0, 4).map(w => `${w.file}${w.animation ? ` (${w.animation})` : ''} needs ${w.missing.join(' and ')}`).join('; ')}.` : '';
        if (text && !delivered && !said.includes(text)) appendMessage(dir, { from: 'agent', text: proofNote ? clip(`${text}\n\n${proofNote}`, MAX_TEXT) : text, work: proofNote ? 'idle' : work, name, slot: slot.id, ...(proofNote ? { unproven: open } : {}) });
        else if (proofNote) appendMessage(dir, { from: 'agent', text: proofNote, work: 'idle', name, slot: slot.id, unproven: open });
        if (proofNote) log.warn('agent turn ended with unproven writes', { slot: slot.id, unproven: open.length });
        note(st, 'done', `${result.tools.length} tool calls`);
      } else if (result.code === 'agent-stopped') {
        // The owner pressed Stop: the turn is closed in the conversation, not left unanswered.
        appendMessage(dir, { from: 'agent', text: 'Stopped.', work: 'idle', name, slot: slot.id, stopped: true });
      } else {
        appendMessage(dir, { from: 'agent', text: clip(`${name} stopped: ${result.message}`, MAX_TEXT), work: 'idle', name, slot: slot.id, error: result.code });
      }
    } catch (err) { log.warn('agent answer not appended', { slot: slot.id, err }); }
    if (director) { try { touchAgent(dir, { name, work: readAgent(dir).work === 'ready' && result.ok ? 'ready' : 'idle' }); } catch { /* the page shows the last state */ } }
    st.run = null;
    st.live = null;
    st.status = result.ok || result.code === 'agent-stopped' ? 'ready' : 'error';
    // A stop the owner asked for is not an error to show.
    st.message = result.ok || result.code === 'agent-stopped' ? undefined : result.message;
    log.info('agent run ended', { slot: slot.id, ok: result.ok, code: result.code });
    // What the owner wrote meanwhile goes in the next run, as one request.
    const settle = st.settle;
    const next = st.pending.splice(0);
    if (next.length && next.every(p => p.dir === next[0].dir)) {
      try { run(slot.id, next[0].dir, next.map(p => p.text).join('\n\n')); } catch (err) { log.warn('queued request not started', { slot: slot.id, err }); }
    }
    settle?.();
  }

  /**
   * The owner wrote in the page (the message is already in the conversation). Starts the
   * director, or queues the message when it is working. Never throws: the message is saved either way.
   * @param {string} dir
   * @param {{ id: number, text: string }} message
   */
  function onOwnerMessage(dir, message) {
    const director = readSlots(configFile)[0];
    if (!director.agent) return { slot: 'director', started: false, code: 'agent-off' };
    const st = stateOf('director');
    if (st.run) {
      if (st.run.dir === dir) { st.pending.push({ dir, text: message.text }); return { slot: 'director', started: false, queued: true }; }
      return { slot: 'director', started: false, code: 'agent-busy' };
    }
    try { return run('director', dir, message.text, { uptoId: message.id }); }
    catch (err) { return { slot: 'director', started: false, code: err?.code ?? 'agent-failed', message: String(err?.message ?? err) }; }
  }

  /** Stop a slot's run (and drop what was queued for it). */
  function stop(slotId) {
    if (!readSlots(configFile).some(s => s.id === slotId)) throw new StudioError('unknown-slot', `There is no slot "${slotId}".`, { slot: slotId });
    const st = stateOf(slotId);
    st.pending.length = 0;
    const running = !!st.run;
    st.run?.stop();
    return { stopped: running, ...summary() };
  }

  /** Save a new slot list; a slot that is working cannot be changed or removed under it. */
  function setSlots(input) {
    const current = readSlots(configFile);
    for (const slot of current) {
      const st = stateOf(slot.id);
      if (!st.run) continue;
      const next = Array.isArray(input) ? input.find(s => s?.id === slot.id) : undefined;
      if (!next || next.agent !== slot.agent || next.role !== slot.role) {
        throw new StudioError('agent-busy', `The ${slot.id} slot is working; stop it before changing it.`, { slot: slot.id });
      }
    }
    writeSlots(input, configFile);
    detect();
    for (const id of states.keys()) if (!readSlots(configFile).some(s => s.id === id) && !states.get(id).run) states.delete(id);
    return summary();
  }

  /** Resolves when every slot has finished what it was doing (gates and shutdown). */
  async function idle() {
    for (;;) {
      const busy = [...states.values()].filter(st => st.run);
      if (!busy.length) return;
      await Promise.all(busy.map(st => st.idle));
    }
  }

  /** Stop everything (the studio is closing). */
  function stopAll() { for (const st of states.values()) { st.pending.length = 0; st.run?.stop(); if (st.team) { clearInterval(st.team); st.team = null; } } }

  return { summary, agents, detect: () => { detect(); return agents(); }, run, onOwnerMessage, stop, setSlots, idle, stopAll };
}
