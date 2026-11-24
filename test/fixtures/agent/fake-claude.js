#!/usr/bin/env node
// Stands in for `claude -p --output-format stream-json --verbose` in the agent gates
// (KS_AGENT_CLAUDE=<this file>). It reads the request on standard input, records how it was
// called (KS_FAKE_AGENT_LOG, one JSON line per run), and streams Claude Code's event shapes.
//
// The request steers it: "#slow" waits (for stop, busy and timeout), "#fail" answers a login
// error, "#write" (with "#slow") writes and checks first, "#crash" exits with only a stderr line, "#reply" first appends a reply through the
// conversation file the way the studio's `reply` tool does, "#unproven" leaves a write in the
// proof ledger that nothing proved, "#team" hands "polish the jump" to the first helper its
// server was given (--team) the way ask_team does, and answers with what came back. A --resume of "stale-session" fails
// the way Claude Code fails for a session it does not know.

import fs from 'node:fs';
import path from 'node:path';
import { postAsk, waitAnswer } from '../../../src/core/team.js';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
let prompt = '';
// `node --test` runs every script under test/ as a gate: without -p this is that run, and it passes.
if (args.includes('-p')) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { prompt += d; });
  process.stdin.on('end', main);
}

const out = obj => process.stdout.write(`${JSON.stringify(obj)}\n`);

// The steering words count only in what the owner writes now, not in the context quoted before it.
let asked = '';

function main() {
  asked = prompt.split('The owner now writes:\n').pop();
  const resume = option('--resume');
  if (process.env.KS_FAKE_AGENT_LOG) {
    fs.appendFileSync(process.env.KS_FAKE_AGENT_LOG, `${JSON.stringify({ args, prompt, cwd: process.cwd(), pid: process.pid })}\n`);
  }
  if (resume === 'stale-session') {
    process.stderr.write(`No conversation found with session ID: ${resume}\n`);
    process.exit(1);
  }
  const session = resume ?? 'fake-session-1';
  out({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: session, tools: ['mcp__keyframe-studio__start_here'], mcp_servers: [{ name: 'keyframe-studio', status: 'connected' }] });
  if (asked.includes('#crash')) { process.stderr.write('boom: the fake CLI crashed\n'); process.exit(2); }
  if (asked.includes('#fail')) {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', session_id: session });
    process.exit(1);
  }
  if (asked.includes('#team')) {
    const mcp = JSON.parse(fs.readFileSync(option('--mcp-config'), 'utf8')).mcpServers['keyframe-studio'];
    const team = mcp.args.includes('--team') ? mcp.args[mcp.args.indexOf('--team') + 1].split(',').map(e => e.split(':')[0]) : [];
    if (!team.length) { finish(session, 'No team.'); return; }
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_team', name: 'mcp__keyframe-studio__ask_team', input: {} }] }, parent_tool_use_id: null, session_id: session });
    const id = postAsk(process.cwd(), { slot: team[0], task: asked.includes('#slowtask') ? 'polish the jump #slow' : 'polish the jump' });
    waitAnswer(process.cwd(), id, { timeoutMs: 20_000, pollMs: 50 }).then(answer => {
      out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_team', content: JSON.stringify(answer), is_error: false }] }, parent_tool_use_id: null, session_id: session });
      if (asked.includes('#slowtask')) { setTimeout(() => finish(session), 60_000); return; }
      finish(session, answer?.ok ? `${team[0]} said: ${answer.text}` : `${team[0]} failed: ${answer?.code}`);
    });
    return;
  }
  if (asked.includes('#slow')) {
    // What --include-partial-messages streams: a tool announced, then the answer token by token.
    out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_0', name: 'mcp__keyframe-studio__read_rig', input: {} } }, parent_tool_use_id: null, session_id: session });
    // "#write": a write and its check, the way a real change goes.
    if (asked.includes('#write')) {
      for (const name of ['write_animation', 'check_skeleton']) {
        out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${name}`, name: `mcp__keyframe-studio__${name}`, input: {} }] }, parent_tool_use_id: null, session_id: session });
        out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${name}`, content: '{}', is_error: false }] }, parent_tool_use_id: null, session_id: session });
      }
    }
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Looking at ' } }, parent_tool_use_id: null, session_id: session });
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'the rig' } }, parent_tool_use_id: null, session_id: session });
    setTimeout(() => finish(session), 60_000);
    return;
  }
  finish(session);
}

function finish(session, said = null) {
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__keyframe-studio__start_here', input: {} }] }, parent_tool_use_id: null, session_id: session });
  out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}', is_error: false }] }, parent_tool_use_id: null, session_id: session });
  const last = prompt.trim().split('\n').pop();
  const answer = said ?? `Reply to: ${last}`;
  if (asked.includes('#reply')) {
    // What the studio's reply tool does from the MCP server process: append to the conversation.
    const file = path.join(process.cwd(), '.keyframe', 'chat.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const id = Math.max(...lines.map(m => m.id)) + 1;
    // "#reply" says the answer itself; "#short" a shorter delivery; "#status" only how it goes.
    const said = asked.includes('#short') ? 'Done: two waves.' : asked.includes('#status') ? 'Working on it.' : answer;
    const work = asked.includes('#status') ? 'writing' : 'ready';
    fs.appendFileSync(file, `${JSON.stringify({ id, from: 'agent', text: said, work, time: new Date().toISOString() })}\n`);
  }
  if (asked.includes('#unproven')) {
    // What the MCP server notes on a write: the clip was written, and nothing proved it after.
    const ledger = path.join(process.cwd(), '.keyframe', 'proof.json');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    fs.writeFileSync(ledger, JSON.stringify({ writes: { 'hero_v2.json#jump': { kind: 'motion', file: 'hero_v2.json', animation: 'jump', tool: 'write_animation', written: Date.now() } }, checks: {} }));
  }
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: answer }] }, parent_tool_use_id: null, session_id: session });
  out({ type: 'result', subtype: 'success', is_error: false, result: answer, session_id: session, num_turns: 2 });
}
