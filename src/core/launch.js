// Opening the studio as an app: its own window (Edge or Chrome with --app), not a browser tab.
// Falls back to the default browser when neither is installed.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** Browsers that can open a page as an app window, most likely first, for this platform. */
export function appBrowsers(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap(root => [path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')]);
  }
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  const dirs = String(env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap(name => dirs.map(dir => path.join(dir, name)));
}

/**
 * The first app-capable browser that exists, or null.
 * @param {{ platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean }} [options]
 */
export function findAppBrowser({ platform, env, exists = p => { try { return fs.statSync(p).isFile(); } catch { return false; } } } = {}) {
  return appBrowsers(platform, env).find(exists) ?? null;
}

/** Open `url` in its own app window; returns how it was opened. */
export function openAppWindow(url, { platform = process.platform, browser = findAppBrowser({ platform }) } = {}) {
  const run = (command, args) => { try { spawn(command, args, { stdio: 'ignore', detached: true }).unref(); return true; } catch { return false; } };
  if (browser && run(browser, [`--app=${url}`, '--new-window'])) return { as: 'app', browser };
  const [command, args] = platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  return { as: run(command, args) ? 'tab' : 'none' };
}

/** True when a Keyframe Studio already answers on this port (so a second start just opens a window). */
export async function studioAnswers(port, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/api/settings`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return typeof body?.version === 'string' && !!body?.connection?.server;
  } catch { return false; }
}

/**
 * Listen on `wanted`, or on the next free port above it when another program holds it. A port where
 * a Keyframe Studio already answers is not skipped: the caller opens that one instead of starting twice.
 * @param {(port: number) => Promise<number>} listen
 * @param {number} wanted
 * @param {{ tries?: number, answers?: (port: number) => Promise<boolean> }} [options]
 * @returns {Promise<{ port: number, running: boolean }>} running: a studio already answers on `port`
 */
export async function listenNear(listen, wanted, { tries = 10, answers = studioAnswers } = {}) {
  let last;
  for (let port = wanted; port < Math.min(wanted + tries, 65536); port++) {
    try { return { port: await listen(port), running: false }; }
    catch (err) {
      if (/** @type {any} */ (err).code !== 'EADDRINUSE') throw err;
      if (await answers(port)) return { port, running: true };
      last = err;
    }
  }
  throw last;
}
