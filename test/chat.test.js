// The conversation store and the agent's two tools, through the real wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendMessage, readMessages, readAgent, touchAgent, waitForOwner, CHAT_DIR } from '../src/core/chat.js';
import { createServer } from '../src/mcp/server.js';
import { findSkeletons } from '../src/deliver/write.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-chat-'));
  for (const f of ['ident.json', 'ident.atlas', 'ident.png']) fs.copyFileSync(new URL(f, FIXTURE), path.join(dir, f));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
  let id = 0;
  const call = async (name, args = {}) => { await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); return sent.find(m => m.id === id).result; };
  return { dir, call, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('messages append with rising ids; a torn last line and bad input do not break the store', () => {
  const p = project();
  try {
    assert.deepEqual(readMessages(p.dir), []);
    assert.equal(appendMessage(p.dir, { from: 'owner', text: '  make it softer  ' }).id, 1);
    assert.equal(appendMessage(p.dir, { from: 'agent', text: 'On it.', work: 'writing' }).id, 2);
    fs.appendFileSync(path.join(p.dir, CHAT_DIR, 'chat.jsonl'), '{"id":3,"from":"own');
    assert.deepEqual(readMessages(p.dir).map(m => [m.id, m.from, m.text]), [[1, 'owner', 'make it softer'], [2, 'agent', 'On it.']]);
    assert.deepEqual(readMessages(p.dir, 1).map(m => m.id), [2]);
    for (const bad of [{ from: 'owner', text: '   ' }, { from: 'someone', text: 'x' }, { from: 'owner', text: 'x'.repeat(4001) }]) {
      assert.throws(() => appendMessage(p.dir, bad), e => e.code === 'bad-argument');
    }
    assert.deepEqual(findSkeletons(p.dir, { includeDeliveries: true }).map(s => s.file), ['ident.json'], 'the chat folder is never scanned for skeletons');
  } finally { p.cleanup(); }
});

test('the agent is connected while it waits and stale 90 s after it was last seen', () => {
  const p = project();
  try {
    assert.equal(readAgent(p.dir).connected, false, 'never seen');
    touchAgent(p.dir, { name: 'Claude', work: 'writing' }, 1_000_000);
    assert.deepEqual([readAgent(p.dir, 1_000_000 + 60_000).connected, readAgent(p.dir, 1_000_000 + 91_000).connected], [true, false]);
    assert.equal(readAgent(p.dir).work, 'writing');
    assert.throws(() => touchAgent(p.dir, { work: 'dancing' }), e => e.code === 'bad-argument');
  } finally { p.cleanup(); }
});

test('waitForOwner returns only unread owner messages, wakes on a new one, and times out empty', async () => {
  const p = project();
  try {
    assert.deepEqual(await waitForOwner(p.dir, { timeoutMs: 30, pollMs: 10 }), []);
    appendMessage(p.dir, { from: 'owner', text: 'first' });
    assert.deepEqual((await waitForOwner(p.dir, { timeoutMs: 30, pollMs: 10 })).map(m => m.text), ['first']);
    assert.deepEqual(await waitForOwner(p.dir, { timeoutMs: 30, pollMs: 10 }), [], 'already read');
    const waiting = waitForOwner(p.dir, { timeoutMs: 3000, pollMs: 10 });
    setTimeout(() => appendMessage(p.dir, { from: 'owner', text: 'second' }), 40);
    const started = Date.now();
    assert.deepEqual((await waiting).map(m => m.text), ['second']);
    assert.ok(Date.now() - started < 1500, 'woke on the message, not on the timeout');
  } finally { p.cleanup(); }
});

test('through the wire: wait_for_message hands over the request, reply answers and sets the work state', async () => {
  const p = project();
  try {
    appendMessage(p.dir, { from: 'owner', text: 'slow the reveal down' });
    const got = (await p.call('wait_for_message', { timeoutSec: 1, name: 'Codex' })).structuredContent;
    assert.deepEqual(got.messages.map(m => m.text), ['slow the reveal down']);
    assert.deepEqual([readAgent(p.dir).name, readAgent(p.dir).connected], ['Codex', true]);

    const said = (await p.call('reply', { text: 'Slowing it to 4 s.', work: 'writing' })).structuredContent;
    assert.equal(said.work, 'writing');
    await p.call('reply', { text: 'Done: the reveal now takes 4 s.', work: 'ready', file: 'ident.json', animation: 'x' });
    const last = readMessages(p.dir).at(-1);
    assert.deepEqual([last.from, last.work, last.file, last.animation], ['agent', 'ready', 'ident.json', 'x']);
    assert.equal(readAgent(p.dir).work, 'ready');
    assert.deepEqual((await p.call('wait_for_message', { timeoutSec: 1 })).structuredContent.messages, [], 'its own replies are not handed back');

    const escape = await p.call('reply', { text: 'x', work: 'ready', file: '../outside.json' });
    assert.ok(escape.isError, 'a file outside the project is refused');
    assert.ok((await p.call('reply', { text: 'x', work: 'dancing' })).isError);
  } finally { p.cleanup(); }
});

test('an owner message that arrives while the agent works is not skipped by its reply', async () => {
  const p = project();
  try {
    appendMessage(p.dir, { from: 'owner', text: 'make it softer' });
    assert.deepEqual((await p.call('wait_for_message', { timeoutSec: 1 })).structuredContent.messages.map(m => m.text), ['make it softer']);
    appendMessage(p.dir, { from: 'owner', text: 'and a little faster' });
    await p.call('reply', { text: 'Done.', work: 'ready' });
    const next = (await p.call('wait_for_message', { timeoutSec: 1 })).structuredContent.messages;
    assert.deepEqual(next.map(m => m.text), ['and a little faster'], 'the reply did not move the cursor past it');
    assert.deepEqual((await p.call('wait_for_message', { timeoutSec: 1 })).structuredContent.messages, [], 'and it is handed over once');
  } finally { p.cleanup(); }
});

test('the page and the agent append from two processes and no two messages share an id', async () => {
  const p = project();
  try {
    const chat = new URL('../src/core/chat.js', import.meta.url).href;
    const script = `import { appendMessage } from ${JSON.stringify(chat)};
      for (let i = 0; i < 150; i++) appendMessage(process.argv[1], { from: process.argv[2], text: 'm' + i });`;
    const { spawn } = await import('node:child_process');
    const run = from => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, p.dir, from], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; child.stderr.on('data', d => { err += d; });
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(err))));
    });
    await Promise.all([run('owner'), run('agent'), run('owner')]);
    const ids = readMessages(p.dir).map(m => m.id);
    assert.equal(ids.length, 450);
    assert.equal(new Set(ids).size, 450, 'every id is unique');
    assert.ok(ids.every((id, i) => i === 0 || id > ids[i - 1]), 'ids rise in file order');
    assert.equal(fs.existsSync(path.join(p.dir, CHAT_DIR, 'chat.lock')), false, 'the lock is released');
  } finally { p.cleanup(); }
});

test('a lock left behind by a dead process does not block the conversation for good', () => {
  const p = project();
  try {
    fs.mkdirSync(path.join(p.dir, CHAT_DIR), { recursive: true });
    const lock = path.join(p.dir, CHAT_DIR, 'chat.lock');
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    assert.equal(appendMessage(p.dir, { from: 'owner', text: 'still here' }).id, 1);
  } finally { p.cleanup(); }
});

test('while it waits, the agent is stamped as seen now and then, not on every poll', async () => {
  const p = project();
  try {
    const file = path.join(p.dir, CHAT_DIR, 'agent.state');
    const writes = [];
    const watcher = setInterval(() => { try { const s = fs.readFileSync(file, 'utf8'); if (writes.at(-1) !== s) writes.push(s); } catch { /* not yet */ } }, 5);
    await waitForOwner(p.dir, { timeoutMs: 600, pollMs: 20, name: 'Claude' });
    clearInterval(watcher);
    assert.equal(writes.length, 1, 'one stamp for a short wait, not one per poll');
    assert.equal(readAgent(p.dir).connected, true);
    assert.equal(readAgent(p.dir).name, 'Claude');
  } finally { p.cleanup(); }
});

test('reply from a server started for a studio slot carries that slot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-reply-slot-'));
  try {
    /** @type {any[]} */
    const sent = [];
    const { wire } = createServer({ session: { dir, slot: 'director', writable: () => true }, version: 'test', write: m => sent.push(m) });
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reply', arguments: { text: 'On it.', work: 'writing' } } });
    assert.ok(!sent[0].result.isError);
    assert.equal(readMessages(dir).at(-1).slot, 'director');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
