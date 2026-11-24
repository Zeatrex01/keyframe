#!/usr/bin/env node
// The stdio MCP server.
//
//   node tools/mcp-server.js [--project <folder>] [--all] [--full-descriptions] [--only <tool,tool>] [--team <id:role,...>] [--slot <id>]
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
import { presenceStamper } from '../src/core/presence.js';

const log = createLogger();

const argv = process.argv.slice(2);
const option = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (() => { try { return readFileSync(path.join(root, 'VERSION'), 'utf8').trim(); } catch { return 'unknown'; } })();
// KS_PROJECT: the same pin, from a client's env (the .mcp.json that `keyframe setup` writes).
const projectArg = option('--project') ?? (process.env.KS_PROJECT || undefined);
const dir = projectArg ? path.resolve(projectArg) : null;
const isDirectory = p => { try { return statSync(p).isDirectory(); } catch { return false; } };

// --team id:role,id:role — the helpers the embedded Director may hand tasks to (ask_team).
const team = (option('--team') ?? '').split(',').map(e => e.trim().split(':')).filter(([id, role]) => id && role).map(([id, role]) => ({ id, role }));
// --slot <id>: the studio slot this server works for; what it says through reply carries it.
const slot = option('--slot') ?? null;
const session = dir
  ? { dir, team, slot, writable: () => isDirectory(dir) }
  : { get dir() { return currentProject(); }, team, slot, writable() { const d = currentProject(); return !!d && isDirectory(d); } };
const only = option('--only');
const onlyNames = only === undefined ? null : new Set(only.split(',').map(n => n.trim()).filter(Boolean));
const { wire } = createServer({
  session, version,
  ...(onlyNames ? { tools: TOOLS.filter(t => onlyNames.has(t.name)), all: true } : {}),
  write: message => process.stdout.write(`${JSON.stringify(message)}\n`),
  fullDescriptions: argv.includes('--full-descriptions'),
  ...(onlyNames ? {} : { all: argv.includes('--all') }),
  onRefusal: record => log.info('refused', record),
  // An outside client (not one of the studio's own slots) tells the page it is here, and where.
  ...(slot ? {} : { onCall: presenceStamper() }),
});

const feed = wire.lineReader();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { feed(chunk); });
log.info('ready', { version, project: dir ?? `follows the studio (now ${currentProject() ?? 'none open'})` });
