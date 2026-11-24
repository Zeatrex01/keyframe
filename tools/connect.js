#!/usr/bin/env node
// Connect any AI agent to the studio, and prove the connection works.
//
//   npm run connect                 every client's lines for this checkout
//   npm run connect -- cursor       one client (claude-code, codex, gemini, cursor, vscode, windsurf, claude-desktop, other)
//   npm run connect -- --check      start the MCP server the way a client does and talk to it
//
// Nothing is written to any client's settings: the lines are printed to copy. The check spawns
// tools/mcp-server.js, performs the MCP handshake, lists the tools and calls `help`, exactly the
// first three messages a real client sends. Exit code 1 when the check fails.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionFor } from '../src/core/connect.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const { server, clients } = connectionFor(root);

/**
 * Talk to the server over stdio like a client. Resolves with what it answered.
 * @param {string} serverPath
 * @param {{ timeoutMs?: number, args?: string[] }} [options]
 */
export function checkServer(serverPath, { timeoutMs = 15000, args = [] } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [serverPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const answers = new Map();
    let buffer = '';
    let stderr = '';
    const finish = result => { clearTimeout(timer); child.kill(); resolve(result); };
    const timer = setTimeout(() => finish({ ok: false, problem: `no answer within ${timeoutMs / 1000} s`, stderr }), timeoutMs);
    child.on('error', err => finish({ ok: false, problem: `could not start node: ${err.message}`, stderr }));
    child.stderr.on('data', d => { stderr += d; });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { return finish({ ok: false, problem: `the server wrote something that is not JSON-RPC: ${line.slice(0, 120)}`, stderr }); }
        answers.set(msg.id, msg);
      }
      if (answers.has(3)) {
        const init = answers.get(1)?.result;
        const tools = answers.get(2)?.result?.tools ?? [];
        const help = answers.get(3)?.result;
        const ok = !!init?.serverInfo && tools.length > 0 && help && !help.isError;
        finish({ ok, server: init?.serverInfo, protocol: init?.protocolVersion, tools: tools.map(t => t.name),
          ...(ok ? {} : { problem: 'the handshake answered, but the tool list or help did not' }), stderr });
      }
    });
    const send = msg => child.stdin.write(`${JSON.stringify(msg)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'keyframe-connect-check', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'help', arguments: {} } });
  });
}

async function main() {
  if (argv.includes('--check')) {
    const result = await checkServer(server);
    if (result.ok) {
      console.log(`ok   ${result.server.name} ${result.server.version} answers over stdio (MCP ${result.protocol}), ${result.tools.length} tools served.`);
      console.log('     Connect your agent with the lines from `npm run connect`, then ask it to call start_here.');
    } else {
      console.log(`fail ${result.problem}`);
      if (result.stderr.trim()) console.log(result.stderr.trim().split('\n').slice(-5).join('\n'));
      process.exitCode = 1;
    }
    return;
  }
  const wanted = argv.filter(a => !a.startsWith('-'));
  const unknown = wanted.filter(id => !clients.some(c => c.id === id));
  if (unknown.length) {
    console.log(`Unknown client: ${unknown.join(', ')}. Known: ${clients.map(c => c.id).join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  const shown = wanted.length ? clients.filter(c => wanted.includes(c.id)) : clients;
  console.log(`Keyframe Studio MCP server: node "${server}"\n`);
  for (const c of shown) console.log(`## ${c.name} (${c.where})\n\n${c.text}\n`);
  console.log('Then start the studio (npm start), open a project, and ask the agent to call start_here.');
  console.log('Check the server itself: npm run connect -- --check');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
