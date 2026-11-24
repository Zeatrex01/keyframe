// The embedded agent's run lifecycle, with a fake CLI standing in for Claude Code
// (test/fixtures/agent/fake-claude.js): the owner's message in, the answer appended to the
// conversation, the session resumed, a stop that cancels, a busy slot refused, an absent CLI 501.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentHub, shownPhase, MIN_PHASE_MS } from '../src/agent/hub.js';
import { writeSlots } from '../src/agent/slots.js';
import { appendMessage, readMessages, readAgent } from '../src/core/chat.js';
import { isStudioError } from '../src/shared/errors.js';
import { statusFor } from '../src/server/respond.js';

const FAKE = fileURLToPath(new URL('./fixtures/agent/fake-claude.js', import.meta.url));

function setup({ cli = FAKE, slots = [{ id: 'director', role: 'director', agent: 'claude-code' }], timeoutMs } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-agent-'));
  const dir = path.join(root, 'project');
  fs.mkdirSync(dir);
  const configFile = path.join(root, 'studio.config.json');
  const log = path.join(root, 'calls.jsonl');
  writeSlots(slots, configFile);
  const hub = createAgentHub({ configFile, timeoutMs, env: { ...process.env, KS_AGENT_CLAUDE: cli, KS_FAKE_AGENT_LOG: log } });
  const say = text => { const m = appendMessage(dir, { from: 'owner', text }); return hub.onOwnerMessage(dir, m); };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
  const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise(r => setTimeout(r, 20)); } };
  return { dir, hub, say, calls, until, configFile,
    cleanup: async () => { hub.stopAll(); await hub.idle(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } };
}

const director = hub => hub.summary().slots.find(s => s.id === 'director');

test('an owner message starts the director; its answer is appended as an agent message carrying the CLI name', async () => {
  const s = setup();
  try {
    assert.deepEqual(s.say('make the logo bounce'), { slot: 'director', started: true });
    assert.ok(['starting', 'working'].includes(director(s.hub).status));
    assert.equal(readAgent(s.dir).name, 'Claude Code', 'the page sees the agent at work');
    await s.hub.idle();
    const answer = readMessages(s.dir).at(-1);
    assert.deepEqual([answer.from, answer.text, answer.name, answer.slot, answer.work], ['agent', 'Reply to: make the logo bounce', 'Claude Code', 'director', 'idle']);
    const d = director(s.hub);
    assert.equal(d.status, 'ready');
    assert.deepEqual(d.activity.map(a => a.kind), ['tool', 'text', 'done']);
    assert.equal(d.activity[0].name, 'start_here');

    // How it was called: in the project, only the studio's tools, through a server limited to them.
    const [call] = s.calls();
    assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(s.dir));
    assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
    assert.ok(!call.args.includes('--resume'), 'the first run is a new session');
    const allowed = call.args[call.args.indexOf('--allowedTools') + 1].split(',');
    assert.ok(allowed.includes('mcp__keyframe-studio__write_animation') && !allowed.some(t => t.endsWith('wait_for_message')));
    const mcp = JSON.parse(fs.readFileSync(call.args[call.args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers['keyframe-studio'];
    assert.equal(mcp.command, process.execPath);
    assert.deepEqual(mcp.args.slice(1, 3), ['--project', s.dir]);
    assert.ok(mcp.args[mcp.args.indexOf('--only') + 1].split(',').includes('write_animation'));
    assert.match(fs.readFileSync(call.args[call.args.indexOf('--append-system-prompt-file') + 1], 'utf8'), /Director/);

    // The next message resumes the same session, and gets only the new words.
    s.say('slower please');
    await s.hub.idle();
    const second = s.calls()[1];
    assert.equal(second.args[second.args.indexOf('--resume') + 1], 'fake-session-1');
    assert.equal(second.prompt, 'slower please');
    assert.equal(readMessages(s.dir).at(-1).text, 'Reply to: slower please');
  } finally { await s.cleanup(); }
});

test('a fresh session hears the recent conversation first', async () => {
  const s = setup();
  try {
    appendMessage(s.dir, { from: 'owner', text: 'earlier idea' });
    appendMessage(s.dir, { from: 'agent', text: 'earlier answer' });
    s.say('now this');
    await s.hub.idle();
    assert.match(s.calls()[0].prompt, /Earlier in this conversation:\nOwner: earlier idea\nAgent: earlier answer\n\nThe owner now writes:\nnow this$/);
  } finally { await s.cleanup(); }
});

test('what the agent already said through reply is not appended twice', async () => {
  const s = setup();
  try {
    s.say('#reply do it');
    await s.hub.idle();
    const agentLines = readMessages(s.dir).filter(m => m.from === 'agent');
    assert.equal(agentLines.length, 1, agentLines.map(m => m.text).join(' | '));
    // A delivering reply is the answer: the run's longer closing words are not added after it.
    s.say('#reply #short wave twice');
    await s.hub.idle();
    assert.deepEqual(readMessages(s.dir).filter(m => m.from === 'agent').slice(1).map(m => m.text), ['Done: two waves.']);
    // A reply that only says how it goes does not close the turn: the answer still follows.
    s.say('#reply #status and again');
    await s.hub.idle();
    assert.deepEqual(readMessages(s.dir).filter(m => m.from === 'agent').slice(2).map(m => m.text), ['Working on it.', 'Reply to: #reply #status and again']);
  } finally { await s.cleanup(); }
});

test('stop cancels the run: the process ends, the turn is marked stopped, the slot is ready again', { timeout: 20_000 }, async () => {
  const s = setup();
  try {
    s.say('#slow take your time');
    await s.until(() => s.calls().length === 1 && director(s.hub).live?.text === 'Looking at the rig');
    // While it works the page sees what it is doing and the answer so far.
    const live = director(s.hub).live;
    assert.equal(live.phase, 'answering');
    assert.ok(live.seconds >= 0);
    assert.equal(readAgent(s.dir).work, 'idle', 'reading and answering is not "Writing"');
    const before = readMessages(s.dir).length;
    const answer = s.hub.stop('director');
    assert.equal(answer.stopped, true);
    await s.hub.idle();
    const after = readMessages(s.dir);
    assert.equal(after.length, before + 1, 'the stopped turn is closed in the conversation');
    assert.deepEqual([after.at(-1).text, after.at(-1).stopped, after.at(-1).from], ['Stopped.', true, 'agent']);
    assert.equal(director(s.hub).live, undefined, 'nothing live once it stopped');
    assert.equal(director(s.hub).status, 'ready');
    assert.equal(director(s.hub).message, undefined, 'a stop the owner asked for is not an error to show');
    const pid = s.calls()[0].pid;
    await s.until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
    assert.equal(s.hub.stop('director').stopped, false, 'stopping an idle slot is harmless');
    // The next turn resumes the conversation, but is told the stopped request is cancelled, so
    // the agent does not quietly finish it.
    s.say('what clips are there?');
    await s.hub.idle();
    const next = s.calls()[1];
    assert.match(next.prompt, /pressed Stop[\s\S]*#slow take your time[\s\S]*cancelled: do not continue it/);
    assert.match(next.prompt, /The owner now writes:\nwhat clips are there\?$/);
    // Only right after the stop: the turn after that is plain again.
    s.say('thanks');
    await s.hub.idle();
    assert.doesNotMatch(s.calls()[2].prompt, /pressed Stop/);
    assert.throws(() => s.hub.stop('nobody'), err => isStudioError(err, 'unknown-slot') && statusFor(err.code) === 404);
  } finally { await s.cleanup(); }
});

test('the steps bar follows the run: a write shows writing, the checks after it show checking', { timeout: 20_000 }, async () => {
  const s = setup();
  try {
    s.say('#slow #write change the wave');
    await s.until(() => director(s.hub).live?.text === 'Looking at the rig');
    assert.equal(readAgent(s.dir).work, 'checking');
    assert.ok(director(s.hub).activity.some(a => a.name === 'write_animation'));
    s.hub.stop('director');
    await s.hub.idle();
    assert.equal(readAgent(s.dir).work, 'idle');
  } finally { await s.cleanup(); }
});

test('a busy slot refuses a second run; an owner message meanwhile waits for the next run', { timeout: 20_000 }, async () => {
  const s = setup();
  try {
    s.say('#slow first');
    assert.throws(() => s.hub.run('director', s.dir, 'again'), err => isStudioError(err, 'agent-busy') && statusFor(err.code) === 409);
    assert.deepEqual(s.say('second'), { slot: 'director', started: false, queued: true });
    assert.deepEqual(s.say('third'), { slot: 'director', started: false, queued: true });
    await s.until(() => s.calls().length === 1);
    // Ending the slow run (stop) drops the queue too: the owner asked everything to stop.
    s.hub.stop('director');
    await s.hub.idle();
    assert.equal(s.calls().length, 1);
  } finally { await s.cleanup(); }
});

test('messages queued while the director works go in one next run', async () => {
  const s = setup({ timeoutMs: 1500 });
  try {
    s.say('#slow first');
    s.say('second');
    s.say('third');
    await s.hub.idle();
    const calls = s.calls();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].prompt, 'second\n\nthird');
    const texts = readMessages(s.dir).filter(m => m.from === 'agent').map(m => m.text);
    assert.match(texts[0], /Claude Code stopped: Claude Code took longer than/, 'the timeout is said in the conversation');
    assert.equal(texts[1], 'Reply to: third');
  } finally { await s.cleanup(); }
});

test('a failing CLI is said in the conversation and marks the slot as error', async () => {
  // Signed out, the CLI's own terminal words ("Please run /login") become what to do from the studio.
  for (const [request, pattern, code] of [['#fail', /not signed in\. Open a terminal, run `claude`, sign in/, 'agent-signed-out'], ['#crash', /boom: the fake CLI crashed/, 'agent-failed']]) {
    const s = setup();
    try {
      s.say(request);
      await s.hub.idle();
      const last = readMessages(s.dir).at(-1);
      assert.equal(last.from, 'agent');
      assert.equal(last.error, code);
      assert.doesNotMatch(last.text, /\/login/);
      assert.match(last.text, pattern);
      assert.equal(director(s.hub).status, 'error');
      assert.match(director(s.hub).message, pattern);
    } finally { await s.cleanup(); }
  }
});

test('a session the CLI no longer knows is dropped and the run starts fresh once', async () => {
  const s = setup();
  try {
    fs.mkdirSync(path.join(s.dir, '.keyframe'), { recursive: true });
    fs.writeFileSync(path.join(s.dir, '.keyframe', 'agent-sessions.json'), JSON.stringify({ director: { agent: 'claude-code', session: 'stale-session' } }));
    s.say('hello');
    await s.hub.idle();
    const calls = s.calls();
    assert.equal(calls.length, 2);
    assert.ok(calls[0].args.includes('stale-session'));
    assert.ok(!calls[1].args.includes('--resume'));
    assert.equal(readMessages(s.dir).at(-1).text, 'Reply to: hello');
  } finally { await s.cleanup(); }
});

test('absent CLI and no agent: refused with codes the server maps, and the owner message is never lost', async () => {
  const s = setup({ cli: '/nowhere/claude' });
  try {
    const answer = s.say('hello');
    assert.equal(answer.started, false);
    assert.equal(answer.code, 'no-agent-cli');
    assert.equal(statusFor('no-agent-cli'), 501);
    assert.throws(() => s.hub.run('director', s.dir, 'x'), err => isStudioError(err, 'no-agent-cli'));
    assert.equal(readMessages(s.dir).length, 1);
    const d = director(s.hub);
    assert.equal(d.status, 'error');
    assert.match(d.message, /Claude Code is not installed here/);
    assert.equal(s.hub.summary().agents.find(a => a.id === 'claude-code').installed, false);
  } finally { await s.cleanup(); }
  const off = setup({ slots: [{ id: 'director', role: 'director', agent: null }] });
  try {
    assert.deepEqual(off.say('hello'), { slot: 'director', started: false, code: 'agent-off' });
    assert.equal(director(off.hub).status, 'off');
    assert.throws(() => off.hub.run('director', off.dir, 'x'), err => isStudioError(err, 'agent-off') && statusFor(err.code) === 409);
  } finally { await off.cleanup(); }
});

test('an extra slot runs with its own brief and only the reading tools', async () => {
  const s = setup({ slots: [{ id: 'director', role: 'director', agent: null }, { id: 'look', role: 'illustrator', agent: 'claude-code', brief: 'Mind the silhouette.' }] });
  try {
    assert.deepEqual(s.hub.run('look', s.dir, 'is the pose readable?'), { slot: 'look', started: true });
    await s.hub.idle();
    const [call] = s.calls();
    assert.match(fs.readFileSync(call.args[call.args.indexOf('--append-system-prompt-file') + 1], 'utf8'), /Illustrator[\s\S]*Mind the silhouette\.$/);
    const allowed = call.args[call.args.indexOf('--allowedTools') + 1];
    assert.ok(allowed.includes('see_animation') && !allowed.includes('write_animation') && !allowed.includes('reply'));
    const last = readMessages(s.dir).at(-1);
    assert.deepEqual([last.slot, last.name], ['look', 'Claude Code']);
    assert.equal(readAgent(s.dir).name, null, 'only the director stands for the agent in the page');
  } finally { await s.cleanup(); }
});

test('a working slot cannot be changed under it; the slot list changes otherwise', { timeout: 20_000 }, async () => {
  const s = setup();
  try {
    s.say('#slow working');
    await s.until(() => s.calls().length === 1);
    assert.throws(() => s.hub.setSlots([{ id: 'director', role: 'director', agent: 'codex' }]), err => isStudioError(err, 'agent-busy'));
    const kept = s.hub.setSlots([{ id: 'director', role: 'director', agent: 'claude-code', brief: 'Short answers.' }, { id: 'refs', role: 'researcher', agent: 'gemini' }]);
    assert.deepEqual(kept.slots.map(x => [x.id, x.brief]), [['director', 'Short answers.'], ['refs', '']]);
    s.hub.stop('director');
    await s.hub.idle();
  } finally { await s.cleanup(); }
});

test('a quick tool phase stays on screen long enough for the page to see it', () => {
  const live = { phase: 'thinking', tool: null, held: { phase: 'checking', tool: 'check_skeleton', until: 10_000 } };
  assert.deepEqual(shownPhase(live, 10_000 - MIN_PHASE_MS + 200), { phase: 'checking', tool: 'check_skeleton' });
  assert.deepEqual(shownPhase(live, 10_000), { phase: 'thinking', tool: null }, 'then thinking again');
  assert.deepEqual(shownPhase({ ...live, phase: 'answering' }, 9_000).phase, 'answering', 'the answer is never held back');
  assert.ok(MIN_PHASE_MS >= 1000, 'longer than the page\'s poll');
});

test('the slots are seen per project: the error and activity of another project do not show in this one', async () => {
  const s = setup();
  try {
    s.say('#fail');
    await s.hub.idle();
    const there = s.hub.summary(s.dir).slots.find(x => x.id === 'director');
    assert.equal(there.status, 'error');
    assert.match(there.message, /not signed in/);
    assert.ok(there.activity.length > 0 && there.activity.every(a => a.dir === s.dir));
    // Another project open: the Director is ready to work there, with nothing from the other one.
    const elsewhere = s.hub.summary(path.join(s.dir, '..', 'other')).slots.find(x => x.id === 'director');
    assert.equal(elsewhere.status, 'ready');
    assert.equal(elsewhere.message, undefined);
    assert.deepEqual(elsewhere.activity, []);
  } finally { await s.cleanup(); }
});
