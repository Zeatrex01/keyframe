// The studio as a desktop app (`tools/studio.js --app`, what the packaged launcher starts): the
// page opens in the owner's default browser, there is no console, what the studio says goes to a
// log file, and the studio stops by itself once no page has been open for a while.
//
// A browser tab cannot say it was closed, but every open page polls the studio every second
// (a background tab about once a minute), so a studio nobody has polled for QUIET_LIMIT_MS stops.
// Opening the app again starts it again, and a page left open says the studio is not running.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const QUIET_LIMIT_MS = 150 * 1000;
export const FIRST_POLL_MS = 120 * 1000;

/**
 * When to stop: no page has polled for long, or none came at all after the start.
 * @param {{ startedAt: number, lastPoll: () => number }} seen  lastPoll: the time of the last page poll (0: none yet)
 * @param {number} now
 */
export function shouldStop({ startedAt, lastPoll }, now) {
  const polled = lastPoll();
  if (!polled) return now - startedAt >= FIRST_POLL_MS ? 'never-opened' : null;
  return now - polled >= QUIET_LIMIT_MS ? 'no-page' : null;
}

/**
 * Call `stop(reason)` once when no page has polled for long.
 * @returns {{ cancel(): void }}
 */
export function watchPages({ lastPoll, stop, now = Date.now, everyMs = 5000 }) {
  const startedAt = now();
  const timer = setInterval(() => {
    const reason = shouldStop({ startedAt, lastPoll }, now());
    if (reason) { clearInterval(timer); stop(reason); }
  }, everyMs);
  timer.unref?.();
  return { cancel() { clearInterval(timer); } };
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
