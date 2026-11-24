#!/usr/bin/env node
// The studio page, served locally.
//
//   node tools/studio.js [--project <folder with the Spine export>] [--port 8731] [--open]
//
// Environment: KS_PORT (the port when --port is not given), KS_LOG_LEVEL (error, warn, info,
// debug), KS_LOG_FORMAT (text or json). The page answers on 127.0.0.1 only.
//
// Without --project the page opens on Projects (or on the project open last time).
// Open the printed address in a browser. Connect an agent to the same folder with
// tools/mcp-server.js; what you type in the page reaches it through wait_for_message.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from '../src/server/http.js';
import { openAppWindow, studioAnswers } from '../src/core/launch.js';
import { createLogger } from '../src/core/log.js';

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (() => { try { return readFileSync(path.join(root, 'VERSION'), 'utf8').trim(); } catch { return 'unknown'; } })();
const projectArg = option('--project');
const projectDir = projectArg ? path.resolve(projectArg) : undefined;
if (projectDir) { try { if (!statSync(projectDir).isDirectory()) throw new Error(); } catch { console.error(`Not a folder: ${projectDir}`); process.exit(2); } }

const log = createLogger();
process.on('unhandledRejection', err => log.error('unhandled rejection', { err: err instanceof Error ? err : new Error(String(err)) }));
process.on('uncaughtException', err => { log.error('uncaught exception; the studio stops', { err }); process.exit(1); });

const portOption = option('--port') ?? process.env.KS_PORT;
const wanted = portOption === undefined || portOption === '' ? 8731 : Number(portOption); // 0: any free port
if (portOption !== undefined && !(Number.isInteger(Number(portOption)) && Number(portOption) >= 0 && Number(portOption) < 65536)) {
  console.error(`Not a port: ${portOption}`); process.exit(2);
}
const show = address => {
  if (!argv.includes('--open')) return;
  const opened = openAppWindow(address);
  if (opened.as === 'tab') console.log('  (no Edge or Chrome found: opened in the default browser)');
};

const studio = createStudioServer({ projectDir, version, log });
let port;
try { port = await studio.listen(wanted); }
catch (err) {
  // Started a second time: the studio is already running, so just bring up its window.
  // A folder dropped on the launcher is opened in the running studio.
  if (err.code === 'EADDRINUSE' && portOption === undefined && await studioAnswers(wanted)) {
    console.log(`Keyframe Studio is already running at http://127.0.0.1:${wanted}/`);
    if (projectDir) await fetch(`http://127.0.0.1:${wanted}/api/projects/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: projectDir }) }).catch(() => {});
    show(`http://127.0.0.1:${wanted}/`);
    process.exit(0);
  }
  console.error(err.code === 'EADDRINUSE' ? 'That port is in use; pass --port <number>.' : String(err.message));
  process.exit(1);
}
const address = `http://127.0.0.1:${port}/`;
console.log(`Keyframe Studio ${version}\n  project: ${projectDir ?? '(choose in Projects)'}\n  open:    ${address}\n  Keep this window open while you use the studio; closing it stops the studio.`);
show(address);

// Ctrl+C or a service manager's stop: finish the requests in flight, then leave.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info('stopping', { signal });
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref();
    studio.close().then(() => process.exit(0));
  });
}
