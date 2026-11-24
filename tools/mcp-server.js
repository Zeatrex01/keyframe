#!/usr/bin/env node
// The stdio MCP server.
//
//   node tools/mcp-server.js [--project <folder>] [--all] [--full-descriptions] [--only <tool,tool>]
//
// Without --project it follows the studio: every call works on the project open in the page
// (Projects), so switching there brings the agent along.
//
// By default only the core tools are served (read, write, check, see, undo). --all adds the
// shelf: bake, merge, skin migration, weights, binary export and the other specialist tools.
// --only serves exactly the named tools (core or shelf) and nothing else: the studio's embedded
// agent (src/agent) starts each slot's server with the tools its role may call.
//
// stdout carries JSON-RPC only; log lines go to stderr (KS_LOG_LEVEL, KS_LOG_FORMAT: src/core/log.js).

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, TOOLS } from '../src/mcp/server.js';
import { currentProject } from '../src/core/projects.js';
import { createLogger } from '../src/core/log.js';

const log = createLogger();

const argv = process.argv.slice(2);
const option = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (() => { try { return readFileSync(path.join(root, 'VERSION'), 'utf8').trim(); } catch { return 'unknown'; } })();
const projectArg = option('--project');
const dir = projectArg ? path.resolve(projectArg) : null;
const isDirectory = p => { try { return statSync(p).isDirectory(); } catch { return false; } };

const session = dir
  ? { dir, writable: () => isDirectory(dir) }
  : { get dir() { return currentProject(); }, writable() { const d = currentProject(); return !!d && isDirectory(d); } };
const only = option('--only');
const onlyNames = only === undefined ? null : new Set(only.split(',').map(n => n.trim()).filter(Boolean));
const { wire } = createServer({
  session, version,
  ...(onlyNames ? { tools: TOOLS.filter(t => onlyNames.has(t.name)), all: true } : {}),
  write: message => process.stdout.write(`${JSON.stringify(message)}\n`),
  fullDescriptions: argv.includes('--full-descriptions'),
  ...(onlyNames ? {} : { all: argv.includes('--all') }),
  onRefusal: record => log.info('refused', record),
});

const feed = wire.lineReader();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { feed(chunk); });
log.info('ready', { version, project: dir ?? `follows the studio (now ${currentProject() ?? 'none open'})` });
