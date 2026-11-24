#!/usr/bin/env node
// One-shot command line over the same wire the MCP server speaks.
//
//   node tools/cli.js list [--all]
//   node tools/cli.js <tool> [--project <folder>] [--args '<json>' | --args @file.json] [--out <file.png>] [--all]
//
// Project: --project, else the current folder. stdout carries the tool's answer; an image the
// tool returns is written to --out (default: <tool>.png in the project folder).
// Exit: 0 ok, 1 the tool refused or failed, 2 usage error.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/mcp/server.js';

const USAGE = 'usage: cli.js list | <tool> [--project <folder>] [--args <json>|@file] [--out <file.png>] [--all]';
const argv = process.argv.slice(2);
const flags = { all: false };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--all') flags.all = true;
  else if (a === '--project' || a === '--args' || a === '--out') {
    if (argv[i + 1] === undefined) { console.error(`${a} needs a value\n${USAGE}`); process.exit(2); }
    flags[a.slice(2)] = argv[++i];
  } else rest.push(a);
}
if (rest.length !== 1) { console.error(USAGE); process.exit(2); }

let args = {};
if (flags.args !== undefined) {
  try {
    args = JSON.parse(flags.args.startsWith('@') ? readFileSync(flags.args.slice(1), 'utf8') : flags.args);
    if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object');
  } catch (e) { console.error(`--args must be a JSON object: ${e.message}`); process.exit(2); }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (() => { try { return readFileSync(path.join(root, 'VERSION'), 'utf8').trim(); } catch { return 'unknown'; } })();
const dir = path.resolve(flags.project ?? process.cwd());
const isDirectory = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const sent = [];
const { wire } = createServer({ session: { dir, writable: () => isDirectory(dir) }, version, all: flags.all, write: m => sent.push(m) });

const [command] = rest;
if (command === 'list') {
  await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const t of sent[0].result.tools) console.log(`${t.name.padEnd(22)} ${t.description}`);
  process.exitCode = 0;
} else {

await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: command, arguments: args } });
const reply = sent.find(m => m.id === 1);
if (reply.error) { console.error(reply.error.message); process.exit(1); }
for (const part of reply.result.content ?? []) {
  if (part.type === 'text') console.log(part.text);
  else if (part.type === 'image') {
    const out = path.resolve(flags.out ?? path.join(dir, `${command}.png`));
    writeFileSync(out, Buffer.from(part.data, 'base64'));
    console.error(`image written: ${out}`);
  }
}
// Let stdout drain before leaving: process.exit() would cut a long answer short on a pipe.
process.exitCode = reply.result.isError ? 1 : 0;
}
