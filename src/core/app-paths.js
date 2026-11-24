// Where the studio keeps its machine-local files: the config (project registry, the
// Spine CLI path, preferences) and the logs. Ported from legacy core/app_paths.js.
//
// The executable or checkout is replaceable; the owner's project registry is not. A
// packaged build therefore keeps its data in one per-user directory shared by every
// release, while a source checkout keeps its repo-local files (studio.config.json at the
// repository root, ignored by git).
//
// Not carried: packaging. Legacy detected a packaged exe itself (`node:sea`, `process.pkg`),
// migrated a versioned portable folder into the shared directory, and resolved install and
// learning-library folders. None of that exists in this tree; `packaged` is now an explicit
// option, so a future packaged launcher states it instead of the module guessing.
//
// Node-only (layer `core`).

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_NAME = 'Keyframe Studio';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The per-user data base of each platform. */
export function userDataBase(platform, env, homeDir) {
  if (platform === 'win32') return env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support');
  return env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share');
}

/**
 * @param {{ env?: object, platform?: string, homeDir?: string, packaged?: boolean, rootDir?: string, exePath?: string }} [opts]
 * Overrides, strongest first: KS_CONFIG (the config file itself, how gates isolate
 * themselves), KS_DATA_DIR (the packaged data root).
 */
export function resolvePaths(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const homeDir = opts.homeDir || os.homedir();
  const packaged = !!opts.packaged;
  const rootDir = path.resolve(opts.rootDir || REPO_ROOT);
  const exePath = path.resolve(opts.exePath || process.execPath);

  const dataRoot = packaged
    ? path.resolve(env.KS_DATA_DIR || path.join(userDataBase(platform, env, homeDir), APP_NAME))
    : rootDir;
  const configFile = path.resolve(env.KS_CONFIG || path.join(dataRoot, 'studio.config.json'));

  return Object.freeze({
    packaged, platform, rootDir, exePath, exeDir: path.dirname(exePath), dataRoot, configFile,
    logsDir: packaged ? path.join(dataRoot, 'logs') : rootDir,
  });
}
