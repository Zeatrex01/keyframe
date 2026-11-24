// The studio as a desktop app (`tools/studio.js --app`, what the packaged launcher starts): its
// own window with its own browser profile, no console, a log file, and the local server stops
// when the window is closed.
//
// The window is Edge or Chrome in app mode with a profile of the studio's own, so it is a browser
// process of its own: when it exits, the studio stops. Pages also poll the studio every second, so
// a studio that nobody has polled for a while (a window that was never opened, a default-browser
// tab that was closed) stops as well. A minimized window is throttled to about one poll a minute,
// so the quiet limit is well above that.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { findAppBrowser, openAppWindow } from './launch.js';

export const QUIET_LIMIT_MS = 150 * 1000;
export const FIRST_POLL_MS = 120 * 1000;
export const AFTER_WINDOW_MS = 8 * 1000;

/**
 * Open the studio in an app window with its own profile. Answers the window's process (null when
 * the page went to the default browser instead).
 * @param {string} url
 * @param {{ profileDir: string, browser?: string|null, spawnImpl?: typeof spawn }} options
 */
export function openOwnWindow(url, { profileDir, browser = findAppBrowser(), spawnImpl = spawn }) {
  if (!browser) { openAppWindow(url, { browser: null }); return null; }
  try {
    const child = spawnImpl(browser, [`--app=${url}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--new-window'],
      { stdio: 'ignore', detached: false, windowsHide: false });
    child.on('error', () => {});
    return child;
  } catch {
    openAppWindow(url, { browser: null });
    return null;
  }
}

/**
 * When to stop: the window's process is gone and no page polls, or no page has polled for long.
 * @param {{ startedAt: number, lastPoll: () => number, windowGone: () => number|null }} seen
 *   lastPoll: the time of the last page poll (0: none yet); windowGone: when the window's process exited
 * @param {number} now
 */
export function shouldStop({ startedAt, lastPoll, windowGone }, now) {
  const polled = lastPoll();
  const gone = windowGone();
  if (gone !== null && now - gone >= AFTER_WINDOW_MS && now - polled >= AFTER_WINDOW_MS) return 'window-closed';
  if (!polled) return now - startedAt >= FIRST_POLL_MS ? 'never-opened' : null;
  return now - polled >= QUIET_LIMIT_MS ? 'no-page' : null;
}

/**
 * Watch the window and the polls; call `stop(reason)` once when the studio should end.
 * @returns {{ window(child: import('node:child_process').ChildProcess|null): void, cancel(): void }}
 */
export function watchWindow({ lastPoll, stop, now = Date.now, everyMs = 2000 }) {
  const startedAt = now();
  let gone = null;
  const timer = setInterval(() => {
    const reason = shouldStop({ startedAt, lastPoll, windowGone: () => gone }, now());
    if (reason) { clearInterval(timer); stop(reason); }
  }, everyMs);
  timer.unref?.();
  return {
    window(child) { if (child) child.once('exit', () => { gone = now(); }); },
    cancel() { clearInterval(timer); },
  };
}

/** A log stream into `<logsDir>/studio.log`, started over when it passes `max` bytes. */
export function logFile(logsDir, { max = 5 * 1024 * 1024 } = {}) {
  fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, 'studio.log');
  try { if (fs.statSync(file).size > max) fs.renameSync(file, `${file}.1`); } catch { /* no log yet */ }
  return { file, stream: fs.createWriteStream(file, { flags: 'a' }) };
}

/** Keep the installed app's entry in Windows' app list on the running version (only if the installer made one). */
export function markInstalledVersion(version, { platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32') return;
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KeyframeStudio';
  run('reg', ['query', key], { windowsHide: true }, err => {
    if (!err) run('reg', ['add', key, '/v', 'DisplayVersion', '/d', version, '/f'], { windowsHide: true }, () => {});
  });
}
