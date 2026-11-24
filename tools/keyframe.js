#!/usr/bin/env node
// The `keyframe` command: one name for everything the studio runs from a terminal.
//
//   keyframe                    open the studio in the browser (on the project open last time)
//   keyframe <folder>           open the studio on that folder (`keyframe .` for this one)
//   keyframe mcp [folder]       the MCP server for an agent client; with a folder it works on that
//                               folder, without one it follows the project open in the studio page
//   keyframe setup [folder]     write the folder's .mcp.json, so `claude` started there has the
//                               studio's tools for that folder (default: this folder)
//   keyframe run <tool> [...]   call one tool once (tools/cli.js), on this folder
//   keyframe help | --version
//
// From a checkout: `npm link` once puts `keyframe` on PATH (package.json "bin"). The Windows app's
// installer puts its keyframe.cmd on the user's PATH.

import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HELP = `Keyframe Studio

  keyframe                    open the studio in your browser
  keyframe <folder>           open the studio on that folder (keyframe . for this one)
  keyframe mcp [folder]       run the MCP server for an AI client (Claude Code, Claude Desktop, Codex...)
                              with a folder: works on that folder; without: on the project open in the studio
  keyframe setup [folder]     make \`claude\` started in that folder use the studio on it (writes .mcp.json)
  keyframe run <tool> [...]   call one studio tool once on this folder (keyframe run list shows them)
  keyframe help | --version
`;

/**
 * What a command line asks for. Pure, so a gate can read it.
 * @param {string[]} argv the words after `keyframe`
 * @param {string} cwd
 * @param {{ packaged?: boolean }} [options] the installed app opens the studio in app mode (it stops once its page is closed)
 * @returns {{ kind: 'help'|'version' } | { kind: 'error', message: string } | { kind: 'setup', dir: string }
 *   | { kind: 'run', script: string, args: string[] }}
 */
export function planCommand(argv, cwd = process.cwd(), { packaged = false } = {}) {
  const [first, ...rest] = argv;
  const open = packaged ? '--app' : '--open';
  const folder = value => path.resolve(cwd, value);
  if (first === 'help' || first === '--help' || first === '-h') return { kind: 'help' };
  if (first === '--version' || first === '-v' || first === 'version') return { kind: 'version' };
  if (first === 'mcp') {
    const [dir, ...more] = rest;
    const pinned = dir && !dir.startsWith('-') ? ['--project', folder(dir), ...more] : rest;
    return { kind: 'run', script: 'mcp-server.js', args: pinned };
  }
  if (first === 'setup') {
    if (rest.length > 1) return { kind: 'error', message: 'keyframe setup takes one folder at most.' };
    return { kind: 'setup', dir: folder(rest[0] ?? '.') };
  }
  if (first === 'run') {
    if (!rest.length) return { kind: 'error', message: 'keyframe run needs a tool name (keyframe run list shows them).' };
    return { kind: 'run', script: 'cli.js', args: rest.includes('--project') ? rest : [...rest, '--project', cwd] };
  }
  if (first === undefined) return { kind: 'run', script: 'studio.js', args: [open] };
  if (first.startsWith('-')) return { kind: 'run', script: 'studio.js', args: [open, ...argv] };
  if (rest.length) return { kind: 'error', message: `Unknown command "${first}".\n\n${HELP}` };
  return { kind: 'run', script: 'studio.js', args: [open, '--project', folder(first)] };
}

async function main() {
  const { appRootOf } = await import('../src/core/update.js');
  const appRoot = appRootOf(root);
  const plan = planCommand(process.argv.slice(2), process.cwd(), { packaged: !!appRoot });
  if (plan.kind === 'help') { process.stdout.write(HELP); return; }
  if (plan.kind === 'version') { process.stdout.write(`${readFileSync(path.join(root, 'VERSION'), 'utf8').trim()}\n`); return; }
  if (plan.kind === 'error') { process.stderr.write(`${plan.message}\n`); process.exitCode = 2; return; }
  if (plan.kind === 'setup') {
    const { addToProject, projectEntry } = await import('../src/core/project-mcp.js');
    try {
      const done = addToProject(plan.dir, projectEntry(root, plan.dir, { appRoot }));
      process.stdout.write(`${done.changed ? 'Wrote' : 'Already set:'} ${done.file}${done.backup ? `\n  the old file is kept as ${done.backup}` : ''}\n\n`
        + `Next: start Claude Code in that folder (cd "${plan.dir}" then claude) and approve "keyframe-studio" when it asks.\n`
        + 'It works on this folder; open the studio (keyframe) to watch it live.\n');
    } catch (err) { process.stderr.write(`${err.message}\n`); process.exitCode = 1; }
    return;
  }
  if (plan.kind !== 'run') return;
  const child = spawn(process.execPath, [path.join(root, 'tools', plan.script), ...plan.args], { stdio: 'inherit' });
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) process.on(signal, () => child.kill(signal));
  child.on('exit', code => { process.exitCode = code ?? 1; });
}

// Run as a command (npm link makes a symlink, hence the real path), not when a gate imports it.
const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; } })();
if (invoked === import.meta.url) main();
