// One project, one agent: `keyframe setup <folder>` writes the folder's own .mcp.json, the file
// Claude Code (and other clients that read a project's .mcp.json) loads when it is started in that
// folder. Its server is pinned to the folder (KS_PROJECT, an env value rather than --project: the
// packaged app's `cmd /c "<shim>"` cannot carry a second quoted argument), so `claude` started there works on that
// project whatever the studio page has open, and the page shows it at work there.
//
// The file is merged, never replaced: other servers and settings stay, and an existing file is
// backed up first. A file that is not valid JSON is left alone.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';
import { SERVER_NAME, desktopEntry } from './connect.js';

export const PROJECT_MCP = '.mcp.json';

/**
 * The server entry for one project: the same command as everywhere, pinned with KS_PROJECT.
 * @param {string} root the studio's checkout
 * @param {string} dir the project folder (absolute)
 * @param {{ appRoot?: string|null, execPath?: string }} [options]
 * @returns {{ command: string, args: string[], env: { KS_PROJECT: string } }}
 */
export function projectEntry(root, dir, options = {}) {
  return { ...desktopEntry(root, options), env: { KS_PROJECT: dir } };
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* below */ }
  throw new StudioError('project-mcp-invalid', `${file} is not valid JSON, so the studio leaves it alone.`, { file });
}

/**
 * Add (or update) the studio's server in <dir>/.mcp.json.
 * @param {string} dir
 * @param {{ command: string, args: string[], env?: object }} entry
 * @returns {{ file: string, backup: string|null, changed: boolean }}
 */
export function addToProject(dir, entry, now = new Date()) {
  const abs = path.resolve(dir);
  try { if (!fs.statSync(abs).isDirectory()) throw new Error(); } catch { throw new StudioError('not-a-folder', `There is no folder at ${abs}.`, { dir: abs }); }
  const file = path.join(abs, PROJECT_MCP);
  const config = readJson(file);
  const servers = config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers) ? config.mcpServers : {};
  if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(entry)) return { file, backup: null, changed: false };
  let backup = null;
  if (fs.existsSync(file)) {
    backup = `${file}.keyframe-backup-${now.toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...config, mcpServers: { ...servers, [SERVER_NAME]: entry } }, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { file, backup, changed: true };
}
