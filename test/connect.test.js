// Gate for src/core/connect.js and tools/connect.js: every client gets a working line, and the
// check really talks MCP to the server the way a client does (roadmap Phase 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionFor } from '../src/core/connect.js';
import { checkServer } from '../tools/connect.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every client gets the same server, in a form it parses', () => {
  const { server, clients } = connectionFor(ROOT);
  assert.equal(server, path.join(ROOT, 'tools', 'mcp-server.js'));
  assert.ok(clients.length >= 7);
  for (const c of clients) {
    assert.ok(c.text.includes('mcp-server.js'), c.id);
    if (c.format === 'json') {
      const parsed = JSON.parse(c.text);
      const entry = (parsed.mcpServers ?? parsed.servers)['keyframe-studio'];
      assert.deepEqual(entry.args, [server], c.id);
      assert.equal(entry.command, 'node');
    }
  }
  assert.match(clients.find(c => c.id === 'codex').text, /^\[mcp_servers\.keyframe-studio\]/);
  assert.equal(new Set(clients.map(c => c.id)).size, clients.length);
});

test('the check performs a real handshake with the studio\'s MCP server', async () => {
  const result = await checkServer(path.join(ROOT, 'tools', 'mcp-server.js'));
  assert.equal(result.ok, true, result.problem);
  assert.equal(result.server.name, 'keyframe-studio');
  assert.ok(result.tools.includes('start_here'));
});

test('the check fails, and says why, when the server does not speak MCP', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-connect-'));
  const broken = path.join(dir, 'broken.js');
  fs.writeFileSync(broken, 'process.stdout.write("hello\\n"); setTimeout(() => {}, 10000);\n');
  try {
    const result = await checkServer(broken, { timeoutMs: 5000 });
    assert.equal(result.ok, false);
    assert.match(result.problem, /not JSON-RPC/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
