// Find an agent CLI on this machine and turn it into something `spawn` can start, on every
// platform, without a shell whenever possible.
//
// The add-on contract (docs/addons.md) holds here too: locating never throws and never prompts;
// an environment variable that names the program is final when set (a path that is not a file
// means "not here", never some other install the owner did not choose).
//
// Windows: an npm-installed CLI is a `.cmd` shim, which Node cannot start without a shell. The
// shim names the script it runs, so the script is started under this Node instead; only a shim
// that cannot be read falls back to cmd.exe, with every argument quoted and stripped of the
// characters cmd.exe would interpret. The owner's words never travel on the command line: they
// go to the CLI on standard input.
//
// Node-only (layer `agent`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isFile = p => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
const SCRIPT = /\.(?:m|c)?js$/i;
const SHIM = /\.(?:cmd|bat)$/i;

/** The folders searched after PATH: where the vendors' own installers put their CLI. */
export function extraDirs(env = process.env, home = os.homedir()) {
  const dirs = [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin')];
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  return dirs;
}

/**
 * Where a CLI is, or null. Order: the override variable (final when set), PATH, the vendor folders.
 * @param {{ bin: string, env: string }} spec the executable's base name and its override variable
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 * @returns {string|null}
 */
export function locateCli(spec, env = process.env, platform = process.platform) {
  try {
    const override = env[spec.env];
    if (override) return isFile(override) ? override : null;
    const pathVar = env.PATH ?? env.Path ?? '';
    const dirs = [...pathVar.split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean), ...extraDirs(env)];
    const names = platform === 'win32' ? [`${spec.bin}.exe`, `${spec.bin}.cmd`, `${spec.bin}.bat`, spec.bin] : [spec.bin];
    for (const dir of dirs) {
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (!isFile(candidate)) continue;
        if (platform === 'win32' && name === spec.bin) continue; // an extension-less file is not runnable there
        if (platform !== 'win32') { try { fs.accessSync(candidate, fs.constants.X_OK); } catch { continue; } }
        return candidate;
      }
    }
    return null;
  } catch { return null; }
}

/** The script or program an npm `.cmd` shim runs, or null when the shim does not say. */
export function shimTarget(shimPath) {
  let text = '';
  try { text = fs.readFileSync(shimPath, 'utf8'); } catch { return null; }
  const m = /"%(?:~?dp0%?|dp0%)\\?([^"%]+\.(?:(?:m|c)?js|exe))"/i.exec(text);
  if (!m) return null;
  const target = path.join(path.dirname(shimPath), m[1].replace(/\\/g, path.sep));
  return isFile(target) ? target : null;
}

/** One argument made safe for cmd.exe: characters it would interpret are dropped, the rest quoted. */
export function quoteForCmd(arg) {
  return `"${String(arg).replace(/[\r\n]+/g, ' ').replace(/["%^&|<>!]/g, '')}"`;
}

/**
 * How to start a located CLI with these arguments.
 * @param {string} cli the located path
 * @param {string[]} args
 * @param {string} [platform]
 * @returns {{ command: string, args: string[], shell: boolean }}
 */
export function commandFor(cli, args, platform = process.platform) {
  if (SCRIPT.test(cli)) return { command: process.execPath, args: [cli, ...args], shell: false };
  if (platform === 'win32' && SHIM.test(cli)) {
    const target = shimTarget(cli);
    // A shim that runs a script runs it under node; one that runs a program (Claude Code's
    // native build is claude.exe) runs that program. Either way cmd.exe never sees the arguments.
    if (target && /\.exe$/i.test(target)) return { command: target, args, shell: false };
    if (target) return { command: process.execPath, args: [target, ...args], shell: false };
    return { command: [quoteForCmd(cli), ...args.map(quoteForCmd)].join(' '), args: [], shell: true };
  }
  return { command: cli, args, shell: false };
}
