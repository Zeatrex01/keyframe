// Adding the studio's MCP server to the Claude desktop app, on the owner's click (Settings > AI
// connection, or the first run). The app reads its servers from claude_desktop_config.json
// (modelcontextprotocol.io, "Connect to local MCP servers"); this adds one entry under
// "mcpServers", keeps every other server and setting as it was, and leaves a dated backup of the
// file beside it first. Nothing here runs without that click. Claude Desktop reads the file at
// start, so it has to be quit and opened again.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SERVER_NAME } from './connect.js';
import { StudioError } from '../shared/errors.js';

/** Where Claude Desktop keeps its config on this platform (KS_CLAUDE_DESKTOP_CONFIG overrides it). */
export function desktopConfigPath(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.KS_CLAUDE_DESKTOP_CONFIG) return path.resolve(env.KS_CLAUDE_DESKTOP_CONFIG);
  // That platform's own separators, whatever system this runs on (gates ask for every platform).
  if (platform === 'win32') return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

function readConfig(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* below */ }
  throw new StudioError('claude-desktop-config-invalid', `${file} is not valid JSON, so the studio leaves it alone. Fix it in Claude Desktop (Settings > Developer > Edit Config) or add the block by hand.`, { file });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Is the studio in Claude Desktop's config, and is it the entry this studio would write?
 * @param {{ command: string, args: string[] }} entry
 */
export function desktopStatus(entry, file = desktopConfigPath()) {
  const installed = fs.existsSync(path.dirname(file));
  let servers = {};
  let invalid = false;
  try { servers = readConfig(file).mcpServers ?? {}; } catch { invalid = true; }
  const mine = servers?.[SERVER_NAME];
  return { file, installed, invalid, added: !!mine, current: !!mine && same(mine, entry) };
}

/**
 * Add (or update) the studio's entry, keeping everything else. Answers the status and the backup's path.
 * @param {{ command: string, args: string[] }} entry
 */
export function addToDesktop(entry, file = desktopConfigPath(), now = new Date()) {
  if (!fs.existsSync(path.dirname(file))) throw new StudioError('claude-desktop-missing', 'Claude Desktop was not found on this computer (it has no settings folder yet). Install it from claude.ai/download, open it once, then try again.', { file });
  const config = readConfig(file);
  const servers = config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers) ? config.mcpServers : {};
  if (same(servers[SERVER_NAME], entry)) return { ...desktopStatus(entry, file), backup: null, changed: false };
  let backup = null;
  if (fs.existsSync(file)) {
    backup = `${file}.keyframe-backup-${now.toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
  }
  const next = { ...config, mcpServers: { ...servers, [SERVER_NAME]: entry } };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { ...desktopStatus(entry, file), backup, changed: true };
}
