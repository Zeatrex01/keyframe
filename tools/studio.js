#!/usr/bin/env node
// The studio page, served locally.
//
//   node tools/studio.js [--project <folder with the Spine export>] [--port 8731] [--open] [--app]
//
// --app is the desktop app (what the packaged launcher starts): the studio's own window with a
// profile of its own, the log in the user's data folder instead of a console, and the studio
// stops when its window is closed (src/core/desktop.js). It can also install updates (src/core/update.js).
//
// Environment: KS_PORT (the port when --port is not given), KS_LOG_LEVEL (error, warn, info,
// debug), KS_LOG_FORMAT (text or json). The page answers on 127.0.0.1 only.
//
// Without --project the page opens on Projects (or on the project open last time).
// Open the printed address in a browser. Connect an agent to the same folder with
// tools/mcp-server.js; what you type in the page reaches it through wait_for_message.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from '../src/server/http.js';
import { openAppWindow, listenNear } from '../src/core/launch.js';
import { createLogger } from '../src/core/log.js';
import { resolvePaths } from '../src/core/app-paths.js';
import { openOwnWindow, watchWindow, logFile, markInstalledVersion } from '../src/core/desktop.js';
import { appRootOf, installState, cleanOldVersions, refreshLauncher } from '../src/core/update.js';

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (() => { try { return readFileSync(path.join(root, 'VERSION'), 'utf8').trim(); } catch { return 'unknown'; } })();
const projectArg = option('--project');
const projectDir = projectArg ? path.resolve(projectArg) : undefined;
if (projectDir) { try { if (!statSync(projectDir).isDirectory()) throw new Error(); } catch { console.error(`Not a folder: ${projectDir}`); process.exit(2); } }

const appMode = argv.includes('--app');
if (appMode) process.env.KS_PACKAGED = '1';
const paths = resolvePaths();
// The app has no console: what the studio says goes to <data>/logs/studio.log.
const logged = appMode ? logFile(paths.logsDir) : null;
const say = logged ? (/** @type {string} */ line) => logged.stream.write(`${line}\n`) : (/** @type {string} */ line) => console.log(line);
const fail = logged ? (/** @type {string} */ line) => logged.stream.write(`${line}\n`) : (/** @type {string} */ line) => console.error(line);
const log = createLogger(logged ? { stream: logged.stream } : {});
const appRoot = appRootOf(root);
process.on('unhandledRejection', err => log.error('unhandled rejection', { err: err instanceof Error ? err : new Error(String(err)) }));
process.on('uncaughtException', err => { log.error('uncaught exception; the studio stops', { err }); process.exit(1); });

const portOption = option('--port') ?? process.env.KS_PORT;
const wanted = portOption === undefined || portOption === '' ? 8731 : Number(portOption); // 0: any free port
if (portOption !== undefined && !(Number.isInteger(Number(portOption)) && Number(portOption) >= 0 && Number(portOption) < 65536)) {
  console.error(`Not a port: ${portOption}`); process.exit(2);
}
/** @type {ReturnType<typeof watchWindow> | null} */
let watch = null;
const show = address => {
  if (appMode) { watch?.window(openOwnWindow(address, { profileDir: path.join(paths.dataRoot, 'window') })); return; }
  if (!argv.includes('--open')) return;
  const opened = openAppWindow(address);
  if (opened.as === 'tab') say('  (no Edge or Chrome found: opened in the default browser)');
};
const exit = code => (logged ? logged.stream.end(() => process.exit(code)) : process.exit(code));

// An installed update starts in place of this studio, on the same port, and the open window
// reloads into it (web/sync.js reloads when the version changes).
const restart = () => {
  const state = appRoot ? installState(appRoot) : null;
  if (!appRoot || !state?.current) return;
  const dir = path.join(appRoot, state.current);
  log.info('restarting into', { version: state.current });
  stopStudio('update', () => spawn(path.join(dir, 'node', 'node.exe'), [path.join(dir, 'studio', 'tools', 'studio.js'), '--app', '--port', String(port), '--reuse-window'],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref());
};

const studio = createStudioServer({ projectDir, version, log, restart });
let port;
try {
  if (portOption === undefined) {
    // The usual port, or the next free one when another program holds it.
    const found = await listenNear(p => studio.listen(p), wanted);
    if (found.running) {
      // Started a second time: the studio is already running, so just bring up its window.
      // A folder dropped on the launcher is opened in the running studio.
      say(`Keyframe Studio is already running at http://127.0.0.1:${found.port}/`);
      if (projectDir) await fetch(`http://127.0.0.1:${found.port}/api/projects/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: projectDir }) }).catch(() => {});
      if (appMode) openOwnWindow(`http://127.0.0.1:${found.port}/`, { profileDir: path.join(paths.dataRoot, 'window') });
      else show(`http://127.0.0.1:${found.port}/`);
      exit(0);
      await new Promise(() => {});
    }
    port = found.port;
    if (port !== wanted) say(`  (port ${wanted} is taken by another program: using ${port})`);
  } else port = await listenRetry(wanted, argv.includes('--reuse-window') ? 10000 : 0);
} catch (err) {
  fail(err.code === 'EADDRINUSE' ? (portOption === undefined ? `Ports ${wanted} to ${wanted + 9} are all in use; pass --port <number>.` : `Port ${wanted} is in use; pass another --port, or leave it out to let the studio pick a free one.`) : String(err.message));
  exit(1);
  await new Promise(() => {});
}
const address = `http://127.0.0.1:${port}/`;
say(`Keyframe Studio ${version}\n  project: ${projectDir ?? '(choose in Projects)'}\n  open:    ${address}\n  ${appMode ? 'Closing the studio window stops the studio.' : 'Keep this window open while you use the studio; closing it stops the studio.'}`);
if (appMode) {
  watch = watchWindow({ lastPoll: () => studio.lastPoll(), stop: reason => stopStudio(reason) });
  // After an update the old window reloads into this studio; a new one opens only if none comes back.
  if (argv.includes('--reuse-window')) setTimeout(() => { if (!studio.lastPoll()) show(address); }, 15000).unref();
  else show(address);
  // Once this version has run for a while it is the good one: old version folders go, and the
  // launcher and Windows' app list follow it.
  setTimeout(() => {
    if (!appRoot) return;
    const removed = cleanOldVersions(appRoot);
    if (removed.length) log.info('removed old versions', { removed });
    if (refreshLauncher(appRoot, path.dirname(root))) log.info('launcher updated');
    markInstalledVersion(version);
  }, 30000).unref();
} else show(address);

/** Listen on exactly `wanted`, trying again for a while when the port is still being let go. */
async function listenRetry(wanted, forMs) {
  const end = Date.now() + forMs;
  for (;;) {
    try { return await studio.listen(wanted); } catch (err) {
      if (err.code !== 'EADDRINUSE' || Date.now() >= end) throw err;
      await new Promise(done => setTimeout(done, 300));
    }
  }
}

// Ctrl+C, a service manager's stop, or the app's window closing: finish the requests in flight, then leave.
let stopping = false;
function stopStudio(reason, then = () => {}) {
  if (stopping) return;
  stopping = true;
  watch?.cancel();
  log.info('stopping', { reason });
  let finished = false;
  const done = () => { if (finished) return; finished = true; then(); exit(0); };
  setTimeout(done, 3000).unref();
  studio.close().then(done);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (stopping) process.exit(1); stopStudio(signal); });
