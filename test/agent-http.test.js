// The embedded agent's HTTP contract, the one the page builds against:
//   GET /api/agent, PUT /api/agent/slots, POST /api/agent/stop, POST /api/agent/run,
//   `agent` in /api/state, and the director started by POST /api/messages.
// Plus the MCP server's --only, which is what keeps a slot to its tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from '../src/server/http.js';
import { readMessages } from '../src/core/chat.js';
import { checkServer } from '../tools/connect.js';

const FAKE = fileURLToPath(new URL('./fixtures/agent/fake-claude.js', import.meta.url));
const SERVER = fileURLToPath(new URL('../tools/mcp-server.js', import.meta.url));

function request(port, method, target, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { let json; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json = undefined; } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function setup({ cli = FAKE } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-agent-http-'));
  const dir = path.join(root, 'project');
  fs.mkdirSync(dir);
  const studio = createStudioServer({ projectDir: dir, version: 'test', configFile: path.join(root, 'studio.config.json'),
    agentEnv: { ...process.env, KS_AGENT_CLAUDE: cli, KS_AGENT_CODEX: '/nowhere/codex', KS_AGENT_GEMINI: '/nowhere/gemini' } });
  const port = await studio.listen(0);
  const call = (method, target, options) => request(port, method, target, options);
  return { dir, studio, call,
    cleanup: async () => { studio.agents.stopAll(); await studio.agents.idle(); await studio.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } };
}

const DIRECTOR = { id: 'director', role: 'director', agent: 'claude-code' };

test('GET /api/agent: the slots with their status, and every supported CLI with whether it is here', async () => {
  const s = await setup();
  try {
    const r = await s.call('GET', '/api/agent');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.slots, [{ id: 'director', role: 'director', agent: null, tools: 'studio', brief: '', status: 'off', activity: [] }]);
    assert.deepEqual(r.json.agents.map(a => [a.id, a.name, a.installed]), [['claude-code', 'Claude Code', true], ['codex', 'Codex CLI', false], ['gemini', 'Gemini CLI', false]]);
    assert.ok(r.json.agents.every(a => typeof a.install === 'string' && a.install));
    const state = (await s.call('GET', '/api/state')).json;
    assert.equal(state.agent.connected, false, 'what the page already read is kept');
    assert.deepEqual(state.agent.slots, r.json.slots);
    assert.deepEqual(state.agent.agents, r.json.agents);
  } finally { await s.cleanup(); }
});

test('PUT /api/agent/slots validates and saves; the director answers the owner from then on', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call('PUT', '/api/agent/slots', { body: { slots: [{ id: 'look', role: 'illustrator', agent: null }] } })).json.error.code, 'bad-slots');
    assert.equal((await s.call('PUT', '/api/agent/slots', { body: { slots: [{ id: 'director', role: 'director', agent: 'chatgpt' }] } })).status, 400);
    assert.equal((await s.call('PUT', '/api/agent/slots', { body: {} })).status, 400);
    const saved = await s.call('PUT', '/api/agent/slots', { body: { slots: [DIRECTOR, { id: 'look', role: 'illustrator', agent: 'gemini' }] } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.slots.map(x => [x.id, x.agent, x.tools, x.status]), [['director', 'claude-code', 'studio', 'ready'], ['look', 'gemini', 'read', 'error']]);
    assert.match(saved.json.slots[1].message, /Gemini CLI is not installed/);

    const sent = await s.call('POST', '/api/messages', { body: { text: 'add a bounce' } });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.from, 'owner');
    assert.deepEqual(sent.json.agent, { slot: 'director', started: true });
    await s.studio.agents.idle();
    const last = readMessages(s.dir).at(-1);
    assert.deepEqual([last.from, last.text, last.name], ['agent', 'Reply to: add a bounce', 'Claude Code']);
    const after = (await s.call('GET', '/api/state')).json.agent.slots[0];
    assert.equal(after.status, 'ready');
    assert.ok(after.activity.some(a => a.kind === 'tool' && a.name === 'start_here'));
  } finally { await s.cleanup(); }
});

test('POST /api/agent/run and /api/agent/stop: busy is 409, stop cancels, unknown slot 404', { timeout: 20_000 }, async () => {
  const s = await setup();
  try {
    await s.call('PUT', '/api/agent/slots', { body: { slots: [DIRECTOR] } });
    assert.deepEqual((await s.call('POST', '/api/agent/run', { body: { slot: 'director', text: '#slow think' } })).json, { slot: 'director', started: true });
    const busy = await s.call('POST', '/api/agent/run', { body: { slot: 'director', text: 'again' } });
    assert.deepEqual([busy.status, busy.json.error.code], [409, 'agent-busy']);
    assert.equal((await s.call('POST', '/api/agent/run', { body: { slot: 'ghost', text: 'x' } })).status, 404);
    assert.equal((await s.call('POST', '/api/agent/run', { body: { slot: 'director' } })).status, 400);
    const stopped = await s.call('POST', '/api/agent/stop', { body: { slot: 'director' } });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.json.stopped, true);
    await s.studio.agents.idle();
    assert.equal((await s.call('GET', '/api/agent')).json.slots[0].status, 'ready');
    assert.equal((await s.call('POST', '/api/agent/stop', { body: { slot: 'ghost' } })).status, 404);
    assert.equal((await s.call('GET', '/api/agent/stop')).status, 405);
  } finally { await s.cleanup(); }
});

test('an absent CLI is 501 on a run, and the owner message is still saved', async () => {
  const s = await setup({ cli: '/nowhere/claude' });
  try {
    await s.call('PUT', '/api/agent/slots', { body: { slots: [DIRECTOR] } });
    const r = await s.call('POST', '/api/agent/run', { body: { slot: 'director', text: 'hello' } });
    assert.deepEqual([r.status, r.json.error.code], [501, 'no-agent-cli']);
    const sent = await s.call('POST', '/api/messages', { body: { text: 'hello' } });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.agent.code, 'no-agent-cli');
    assert.equal(readMessages(s.dir).length, 1);
  } finally { await s.cleanup(); }
});

test('another site cannot reach the agent routes', async () => {
  const s = await setup();
  try {
    const evil = { origin: 'https://evil.example' };
    assert.equal((await s.call('PUT', '/api/agent/slots', { headers: evil, body: { slots: [DIRECTOR] } })).json.error.code, 'foreign-origin');
    assert.equal((await s.call('POST', '/api/agent/run', { headers: evil, body: { slot: 'director', text: 'x' } })).json.error.code, 'foreign-origin');
    assert.equal((await s.call('POST', '/api/agent/stop', { headers: { 'sec-fetch-site': 'cross-site' }, body: { slot: 'director' } })).json.error.code, 'cross-site');
    assert.equal((await s.call('GET', '/api/agent', { headers: { host: 'evil.example' } })).json.error.code, 'foreign-host');
    assert.equal((await s.call('GET', '/api/agent')).json.slots[0].agent, null, 'nothing was saved');
  } finally { await s.cleanup(); }
});

test('the MCP server serves exactly the tools --only names', async () => {
  const r = await checkServer(SERVER, { args: ['--only', 'help,read_rig,check_skeleton'] });
  assert.equal(r.ok, true, r.problem);
  assert.deepEqual([...r.tools].sort(), ['check_skeleton', 'help', 'read_rig']);
  const plain = await checkServer(SERVER);
  assert.ok(plain.tools.includes('write_animation') && plain.tools.includes('wait_for_message'), 'without --only nothing changes');
});

test('a Director turn that wrote and did not prove ends with a plain "Not proven yet" note', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call('PUT', '/api/agent/slots', { body: { slots: [DIRECTOR] } })).status, 200);
    await s.call('POST', '/api/messages', { body: { text: 'make a jump #unproven' } });
    await s.studio.agents.idle();
    const last = readMessages(s.dir).at(-1);
    assert.equal(last.from, 'agent');
    assert.match(last.text, /Not proven yet: hero_v2\.json \(jump\) needs check_skeleton and critique_animation/);
    assert.equal(last.work, 'idle', 'an unproven delivery is never shown as ready');
  } finally { await s.cleanup(); }
});
