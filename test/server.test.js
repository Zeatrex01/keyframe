// End to end: the real stdio server as a child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../tools/mcp-server.js', import.meta.url));

function start(args) {
  const child = spawn(process.execPath, [SERVER, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const replies = new Map();
  const waiters = new Map();
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      replies.set(msg.id, msg);
      waiters.get(msg.id)?.(msg);
    }
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const request = (id, method, params) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no reply to ${method}; stderr: ${stderr}`)), 10000);
    waiters.set(id, msg => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { child, request, stderr: () => stderr };
}

test('the stdio server handshakes, lists and explains over real stdio', async () => {
  const project = mkdtempSync(path.join(tmpdir(), 'kf-server-'));
  const server = start(['--project', project]);
  try {
    const init = await server.request(1, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'e2e' } });
    assert.equal(init.result.serverInfo.name, 'keyframe-studio');
    assert.match(init.result.instructions, /start_here/);
    const list = await server.request(2, 'tools/list');
    assert.ok(list.result.tools.some(t => t.name === 'help'));
    const index = await server.request(3, 'tools/call', { name: 'help', arguments: {} });
    assert.ok(index.result.structuredContent.tiers.core.some(t => t.name === 'help'));
    const one = await server.request(4, 'tools/call', { name: 'help', arguments: { tool: 'help' } });
    assert.match(one.result.structuredContent.description, /full description/);
    const unknown = await server.request(5, 'tools/call', { name: 'help', arguments: { tool: 'nope' } });
    assert.equal(unknown.result.structuredContent.error.code, 'unknown-tool');
    assert.match(server.stderr(), /ready/);
  } finally {
    server.child.kill();
    rmSync(project, { recursive: true, force: true });
  }
});
