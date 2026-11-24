// The project registry: the folders the owner has opened, newest first, and which one is open
// now. Kept in the studio's config file (src/core/app-paths.js), so the page and every agent on
// this machine agree on "the current project": the page switches it, an MCP server started
// without --project follows it.
//
// The registry only ever lists and creates folders. It never deletes one: "remove from the
// list" forgets the entry and leaves the folder as it is.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';
import { resolvePaths } from './app-paths.js';

const MAX_PROJECTS = 20;
const NAME = /^[\w][\w .-]{0,79}$/;
const isDirectory = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const configFile = () => resolvePaths().configFile;

/** The whole config object, or {} when there is none yet (or it cannot be read). */
export function readConfig(file = configFile()) {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}

/** Write the config atomically: a half-written file must never lose the owner's list. */
export function writeConfig(config, file = configFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, file);
}

const entriesOf = config => (Array.isArray(config.projects) ? config.projects : [])
  .filter(p => p && typeof p.dir === 'string' && path.isAbsolute(p.dir));

/**
 * @returns {{ current: string|null, projects: Array<{ dir: string, name: string, opened: string|null, exists: boolean }> }}
 *   `current` is null when the recorded one is gone, so nothing works on a folder that moved.
 * @param {{ file?: string }} [registry]
 */
export function listProjects({ file } = {}) {
  const config = readConfig(file);
  const projects = entriesOf(config).map(p => ({ dir: p.dir, name: path.basename(p.dir), opened: p.opened ?? null, exists: isDirectory(p.dir) }));
  const current = typeof config.current === 'string' && isDirectory(config.current) ? config.current : null;
  return { current, projects };
}

/** The open project's folder, or null. @param {{ file?: string }} [registry] */
export function currentProject({ file } = {}) {
  return listProjects({ file }).current;
}

/**
 * Open a folder: it becomes the current project and moves to the top of the list.
 * @param {string} dir
 * @param {{ file?: string, now?: number }} [registry]
 */
export function openProject(dir, { file, now = Date.now() } = {}) {
  if (typeof dir !== 'string' || !dir.trim()) throw new StudioError('bad-argument', 'Give the folder to open.');
  const abs = path.resolve(dir.trim());
  if (!isDirectory(abs)) throw new StudioError('not-a-folder', `There is no folder at ${abs}.`, { dir: abs });
  const config = readConfig(file);
  const entry = { dir: abs, opened: new Date(now).toISOString() };
  config.projects = [entry, ...entriesOf(config).filter(p => p.dir !== abs)].slice(0, MAX_PROJECTS);
  config.current = abs;
  writeConfig(config, file);
  return { dir: abs, name: path.basename(abs), opened: entry.opened, exists: true };
}

/**
 * Make a new, empty project folder inside `parent` and open it. An existing folder with files in it is refused.
 * @param {string} parent
 * @param {string} name
 * @param {{ file?: string, now?: number }} [registry]
 */
export function createProject(parent, name, { file, now } = {}) {
  if (typeof parent !== 'string' || !parent.trim()) throw new StudioError('bad-argument', 'Give the folder the new project goes in.');
  if (typeof name !== 'string' || !NAME.test(name.trim())) throw new StudioError('bad-name', 'A project name is letters, digits, spaces, dots, dashes and underscores (at most 80).');
  const base = path.resolve(parent.trim());
  if (!isDirectory(base)) throw new StudioError('not-a-folder', `There is no folder at ${base}.`, { dir: base });
  const abs = path.join(base, name.trim());
  if (fs.existsSync(abs) && (!isDirectory(abs) || fs.readdirSync(abs).length)) {
    throw new StudioError('folder-in-use', `${abs} already exists and is not empty; open it instead.`, { dir: abs });
  }
  fs.mkdirSync(abs, { recursive: true });
  return openProject(abs, { file, now });
}

/**
 * Take a folder off the list (the folder itself is left alone).
 * @param {string} dir
 * @param {{ file?: string }} [registry]
 */
export function forgetProject(dir, { file } = {}) {
  const abs = path.resolve(String(dir ?? ''));
  const config = readConfig(file);
  const before = entriesOf(config);
  config.projects = before.filter(p => p.dir !== abs);
  if (config.current === abs) config.current = null;
  writeConfig(config, file);
  return { forgotten: before.length !== config.projects.length };
}
