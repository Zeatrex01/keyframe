// Where the studio keeps its machine-local files: the config (project registry, the
// Spine CLI path, preferences) and the logs. Ported from legacy core/app_paths.js.
//
// The executable or checkout is replaceable; the owner's project registry is not. A
// packaged build therefore keeps its data in one per-user directory shared by every
// release, while a source checkout keeps its repo-local files (studio.config.json at the
// repository root, ignored by git).
//
// A packaged build (tools/package-win.js) carries a PACKAGED file at the studio root; the app
// mode also says so with KS_PACKAGED=1. The install folder holds one folder per version, so the
// data can never live inside it: an update would leave it behind.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_NAME = 'Keyframe Studio';
/** The file a packaged build carries at the studio root. */
export const PACKAGED_MARK = 'PACKAGED';

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
  const rootDir = path.resolve(opts.rootDir || REPO_ROOT);
  const packaged = opts.packaged ?? (env.KS_PACKAGED === '1' || fs.existsSync(path.join(rootDir, PACKAGED_MARK)));
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
