// The system's own "choose a folder" dialog, for the page's Open a folder and New project.
// A browser tab can never hand a page a folder's real path, and the studio runs on the owner's
// own computer, so the studio asks the system instead: Windows' folder dialog through the
// built-in PowerShell, macOS' through osascript, Linux' through zenity when it is installed.
//
// Node-only (layer `core`).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';

/** The dialog stays at most this long; nobody is choosing after that. */
export const PICK_LIMIT_MS = 10 * 60 * 1000;

const WIN_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  // An owner that stays on top, so the dialog does not open behind the browser.
  '$o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$d.Description = 'Keyframe Studio: choose a folder'",
  '$d.ShowNewFolderButton = $true',
  "if ($d.ShowDialog($o) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
].join('; ');

/**
 * The command that shows the dialog and prints the chosen folder (nothing when cancelled).
 * @param {string} [platform]
 * @param {Record<string, string|undefined>} [env]
 * @returns {[string, string[]]|null} null where the studio knows no dialog
 */
export function pickerCommand(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    // By full path: a shortened PATH must not lose PowerShell.
    const ps = path.win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return [ps, ['-NoProfile', '-NonInteractive', '-STA', '-Command', WIN_SCRIPT]];
  }
  if (platform === 'darwin') return ['osascript', ['-e', 'POSIX path of (choose folder with prompt "Keyframe Studio: choose a folder")']];
  if (platform === 'linux') return ['zenity', ['--file-selection', '--directory', '--title=Keyframe Studio: choose a folder']];
  return null;
}

/**
 * Show the dialog and wait for the owner. Resolves the absolute folder, or null when cancelled.
 * @param {{ platform?: string, env?: object, spawnImpl?: typeof spawn, limitMs?: number }} [deps]
 * @returns {Promise<string|null>}
 */
export function pickFolder({ platform = process.platform, env = process.env, spawnImpl = spawn, limitMs = PICK_LIMIT_MS } = {}) {
  const command = pickerCommand(platform, env);
  if (!command) return Promise.reject(new StudioError('folder-picker-missing', 'This system has no folder dialog the studio knows; type or paste the folder\'s path.'));
  return new Promise((resolve, reject) => {
    let out = '', done = false;
    const finish = fn => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    let child;
    try { child = spawnImpl(command[0], command[1], { windowsHide: false, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (err) { reject(missing(err)); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish(() => resolve(null)); }, limitMs);
    child.stdout?.setEncoding?.('utf8');
    child.stdout?.on('data', chunk => { out += chunk; });
    child.on('error', err => finish(() => reject(missing(err))));
    // A cancel exits non-zero on macOS and Linux and prints nothing on Windows: both are "no folder".
    child.on('close', code => finish(() => {
      const dir = out.trim();
      resolve(code === 0 && dir ? dir : null);
    }));
  });
}

const missing = err => new StudioError('folder-picker-missing',
  `The folder dialog could not start (${err?.code ?? err?.message ?? err}); type or paste the folder's path.`);
