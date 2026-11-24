// Find and run the Spine command line (Spine.com), nothing else. Ported from legacy
// core/spine_cli.js.
//
// The CLI is an OPTIONAL ability: it needs a paid license and breaks the zero-install
// promise. So `locateSpineCli` answers null instead of throwing, and every caller turns
// that into a plain refusal. Documented surface: the Spine User Guide, "Command line
// interface".
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { resolvePaths } from './app-paths.js';

const NAMES = ['Spine.com', 'Spine.exe', 'Spine.app/Contents/MacOS/Spine', 'Spine'];
const SUBFOLDERS = ['Spine', 'Spine Pro', ''];

const isFile = p => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };

/**
 * Order: $SPINE_CLI (final when set), then `spineCli` in studio.config.json (Settings),
 * then the usual install folders.
 * @returns {string|null}
 */
export function locateSpineCli(env = process.env) {
  // An explicit SPINE_CLI is the user's choice: if it points nowhere the answer is
  // "not found", never some other install they did not choose.
  if (env.SPINE_CLI) return isFile(env.SPINE_CLI) ? env.SPINE_CLI : null;
  try {
    const cfg = JSON.parse(fs.readFileSync(resolvePaths({ env }).configFile, 'utf8'));
    if (isFile(cfg.spineCli)) return cfg.spineCli;
  } catch { /* no config yet: keep looking */ }
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA, '/Applications'].filter(Boolean);
  for (const root of roots) {
    for (const sub of SUBFOLDERS) {
      for (const name of NAMES) {
        const p = path.join(root, sub, name);
        if (isFile(p)) return p;
      }
    }
  }
  return null;
}

/**
 * Run the CLI once and collect everything; never rejects. A `.js` or `.mjs` path runs
 * under Node: a wrapper script is accepted as the CLI so a gate can stand in for the
 * licensed editor.
 * @returns {Promise<{ code: number|null, spawnError: string|null, timedOut: boolean, stdout: string, stderr: string }>}
 */
export function runSpineCli(cli, args, { timeoutMs = 60000, maxBuffer = 1 << 20 } = {}) {
  const [cmd, argv] = /\.m?js$/i.test(cli) ? [process.execPath, [cli, ...args]] : [cli, args];
  return new Promise(resolve => {
    execFile(cmd, argv, { timeout: timeoutMs, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : null) : 0,
        // A non-numeric code: the process could not start (ENOENT, EACCES) or its output
        // overflowed maxBuffer (ERR_CHILD_PROCESS_STDIO_MAXBUFFER).
        spawnError: err && err.code && typeof err.code !== 'number' ? String(err.code) : null,
        timedOut: !!(err && err.killed && err.signal),
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}
