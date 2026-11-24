// Gate for driving the studio from your own agent, and for opening a project:
//   - an outside MCP client is seen on every tool call (not only the chat tools), by its name,
//     with the folder it works on; the page points at a client at work on another folder;
//   - `keyframe` reads its command line the way its help says, and `keyframe setup` writes the
//     folder's .mcp.json pinned to that folder, keeping what was there;
//   - Open a folder asks the system's own folder dialog, and a cancel is not an error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { clientLabel, presenceStamper, readPresence, STAMP_EVERY_MS, PRESENT_MS } from '../src/core/presence.js';
import { readAgent } from '../src/core/chat.js';
import { createServer } from '../src/mcp/server.js';
import { outsideNote, pillState } from '../web/agent-rules.js';
import { touchAgent } from '../src/core/chat.js';
import { ADAPTERS } from '../src/agent/adapters.js';
import { planCommand } from '../tools/keyframe.js';
import { addToProject, projectEntry } from '../src/core/project-mcp.js';
import { pickerCommand, pickFolder } from '../src/core/folder-pick.js';
import { createStudioServer } from '../src/server/http.js';

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('clients are called by the names people know', () => {
  assert.equal(clientLabel('claude-code 2.1.4'), 'Claude Code');
  assert.equal(clientLabel('claude-ai 0.1.0'), 'Claude Desktop');
  assert.equal(clientLabel('my-own-client'), 'my-own-client');
  assert.equal(clientLabel(null), 'An AI client');
});

test('every tool call stamps the client and its folder, at most once per burst', () => {
  const dir = tmp('kf-presence-');
  const file = path.join(tmp('kf-presence-cfg-'), 'client.json');
  let clock = Date.parse('2026-11-24T18:00:00Z');
  const stamp = presenceStamper({ file, now: () => clock });
  assert.equal(stamp({ client: 'claude-code 2.1', dir }), true);
  assert.equal(stamp({ client: 'claude-code 2.1', dir }), false, 'a burst writes once');
  assert.deepEqual(readPresence(file, clock), { name: 'Claude Code', dir, at: new Date(clock).toISOString() });
  const agent = readAgent(dir, clock);
  assert.deepEqual([agent.connected, agent.name], [true, 'Claude Code'], 'the pill of that project says who is here');
  clock += STAMP_EVERY_MS;
  assert.equal(stamp({ client: 'claude-code 2.1', dir }), true);
  assert.equal(readPresence(file, clock + PRESENT_MS + 1), null, 'gone after a quiet while');
});

test('the MCP wire tells the presence hook about a writing call too', async () => {
  const calls = [];
  const dir = tmp('kf-presence-wire-');
  const out = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 't', write: m => out.push(m), onCall: c => calls.push(c) });
  const feed = wire.lineReader();
  feed(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code', version: '2.1' }, capabilities: {} } })}\n`);
  feed(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'help', arguments: {} } })}\n`);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(calls, [{ tool: 'help', client: 'claude-code 2.1', dir }]);
});

test('the page points at a client working on another folder, and stays quiet when it is here', () => {
  const at = '2026-11-24T18:00:00Z';
  assert.equal(outsideNote({ project: { dir: '/p/a' }, outside: null }), null);
  assert.equal(outsideNote({ project: { dir: '/p/a' }, outside: { name: 'Claude Code', dir: '/p/a', at } }), null);
  assert.deepEqual(outsideNote({ project: { dir: '/p/a' }, outside: { name: 'Claude Code', dir: 'C:\\Games\\Hero', at } }),
    { key: 'outside.elsewhere', name: 'Claude Code', dir: 'C:\\Games\\Hero', folder: 'Hero' });
  assert.equal(outsideNote({ project: null, outside: { name: 'Claude Code', dir: null, at } }).key, 'outside.noProject');
});

test('the keyframe command reads its line the way its help says', () => {
  const cwd = path.resolve('/work/hero');
  assert.deepEqual(planCommand([], cwd), { kind: 'run', script: 'studio.js', args: ['--open'] });
  assert.deepEqual(planCommand(['.'], cwd), { kind: 'run', script: 'studio.js', args: ['--open', '--project', cwd] });
  assert.deepEqual(planCommand(['.'], cwd, { packaged: true }).args, ['--app', '--project', cwd], 'the installed app stops once its page is closed');
  assert.deepEqual(planCommand(['mcp'], cwd), { kind: 'run', script: 'mcp-server.js', args: [] }, 'no folder: follows the studio');
  assert.deepEqual(planCommand(['mcp', '../villain', '--all'], cwd).args, ['--project', path.resolve(cwd, '../villain'), '--all']);
  assert.deepEqual(planCommand(['setup'], cwd), { kind: 'setup', dir: cwd });
  assert.deepEqual(planCommand(['run', 'list'], cwd).args, ['list', '--project', cwd]);
  assert.equal(planCommand(['run'], cwd).kind, 'error');
  assert.equal(planCommand(['bogus', 'x'], cwd).kind, 'error');
  assert.equal(planCommand(['--help'], cwd).kind, 'help');
});

test('keyframe setup writes the folder\'s .mcp.json pinned to it, keeping what was there', () => {
  const dir = tmp('kf-setup-');
  const entry = projectEntry('/repo', dir, { execPath: '/opt/node' });
  assert.deepEqual(entry, { command: '/opt/node', args: ['/repo/tools/mcp-server.js'], env: { KS_PROJECT: dir } });
  assert.deepEqual(projectEntry('/x', 'C:\\My Games\\Hero', { appRoot: 'C:\\Apps\\Keyframe Studio' }).args, ['/c', 'C:\\Apps\\Keyframe Studio\\keyframe-mcp.cmd'],
    'the folder rides in env: cmd /c cannot carry a second quoted argument');
  const file = path.join(dir, '.mcp.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  const done = addToProject(dir, entry, new Date('2026-11-24T18:00:00Z'));
  assert.equal(done.changed, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers, { other: { command: 'x' }, 'keyframe-studio': entry });
  assert.deepEqual(JSON.parse(fs.readFileSync(done.backup, 'utf8')), { mcpServers: { other: { command: 'x' } } });
  assert.equal(addToProject(dir, entry).changed, false);
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => addToProject(dir, entry), err => err.code === 'project-mcp-invalid');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken', 'a file it cannot read is left alone');
});

/** A child process that prints `out` and exits with `code`, or fails to start. */
function fakeSpawn({ out = '', code = 0, error = null }) {
  return () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill() {} });
    setImmediate(() => {
      if (error) { child.emit('error', Object.assign(new Error('spawn failed'), { code: error })); return; }
      if (out) child.stdout.emit('data', out);
      child.emit('close', code);
    });
    return child;
  };
}

test('Open a folder uses the system\'s own dialog; a cancel is no folder, a missing dialog says to type the path', async () => {
  const [ps, psArgs] = pickerCommand('win32', { SystemRoot: 'C:\\Windows' });
  assert.equal(ps, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(psArgs.includes('-STA') && /FolderBrowserDialog/.test(psArgs.at(-1)));
  assert.equal(pickerCommand('darwin')[0], 'osascript');
  assert.equal(pickerCommand('aix'), null);
  assert.equal(await pickFolder({ platform: 'win32', spawnImpl: /** @type {any} */ (fakeSpawn({ out: 'C:\\Games\\Hero\r\n' })) }), 'C:\\Games\\Hero');
  assert.equal(await pickFolder({ platform: 'win32', spawnImpl: /** @type {any} */ (fakeSpawn({ out: '' })) }), null);
  assert.equal(await pickFolder({ platform: 'darwin', spawnImpl: /** @type {any} */ (fakeSpawn({ code: 1 })) }), null);
  await assert.rejects(pickFolder({ platform: 'linux', spawnImpl: /** @type {any} */ (fakeSpawn({ error: 'ENOENT' })) }), err => err.code === 'folder-picker-missing');
  await assert.rejects(pickFolder({ platform: 'aix' }), err => err.code === 'folder-picker-missing');
});

test('the page asks the studio for the dialog, and its state names the outside client', async () => {
  const config = path.join(tmp('kf-pick-cfg-'), 'studio.config.json');
  fs.writeFileSync(path.join(path.dirname(config), 'client.json'), JSON.stringify({ name: 'Claude Code', dir: '/elsewhere', at: new Date().toISOString() }));
  const studio = createStudioServer({ version: 'test', configFile: config, appRoot: null, pick: async () => '/picked/folder' });
  const port = await studio.listen(0);
  const call = (method, at) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: at, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject); req.end(method === 'POST' ? '{}' : undefined);
  });
  try {
    assert.deepEqual(await call('POST', '/api/projects/pick'), { dir: '/picked/folder' });
    assert.deepEqual((await call('GET', '/api/state')).outside?.name, 'Claude Code');
  } finally { await studio.close(); }
});

test('after the built-in Director is turned off, its own stamps do not read as a connected AI', () => {
  const dir = tmp('kf-embedded-');
  const now = Date.now();
  touchAgent(dir, { name: 'Claude Code', embedded: true }, now);
  const left = readAgent(dir, now);
  assert.deepEqual([left.connected, left.embedded], [true, true]);
  assert.equal(pillState({ agent: { ...left, slots: [{ id: 'director', role: 'director', agent: null, status: 'off' }] } }).key, 'nav.waiting');
  presenceStamper({ file: path.join(tmp('kf-embedded-cfg-'), 'client.json'), now: () => now })({ client: 'claude-code', dir });
  const outside = readAgent(dir, now);
  assert.equal(outside.embedded, false, 'an outside client\'s call clears the mark');
  assert.equal(pillState({ agent: outside }).key, 'nav.connectedShort');
});

test('install hints are commands only; the words around them come from the page\'s language', () => {
  for (const a of ADAPTERS) for (const line of Object.values(a.install)) assert.doesNotMatch(line, /sign in|then run/i, `${a.id}: ${line}`);
  for (const lang of ['en', 'tr']) {
    const dict = JSON.parse(fs.readFileSync(`locale/${lang}.json`, 'utf8'));
    for (const key of ['agent.install', 'first.directorMissing']) assert.match(dict[key], /\{signIn\}/, `${lang} ${key}`);
  }
});
