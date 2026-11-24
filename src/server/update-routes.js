// The page's update routes (Settings > About, and the header's "update" pill): is there a newer
// version, turn the check at start on or off, install it, restart into it. Only a packaged app
// can update itself; a source checkout is told to use git.
//
// Node-only (layer `server`).

import fs from 'node:fs';
import path from 'node:path';
import { checkForUpdate, downloadRelease, installPackage, installState } from '../core/update.js';
import { readConfig, writeConfig } from '../core/projects.js';
import { StudioError } from '../shared/errors.js';

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const writable = dir => { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } };

/**
 * @param {{ version: string, appRoot: string|null, registry: { file?: string }, restart?: () => void,
 *   check?: typeof checkForUpdate, download?: typeof downloadRelease, now?: () => number }} options
 */
export function updateRoutes({ version, appRoot, registry, restart, check = checkForUpdate, download = downloadRelease, now = Date.now }) {
  let last = null, lastAt = 0, busy = null, installed = null;
  const enabled = () => readConfig(registry.file).updateCheck !== false;
  const status = () => ({
    current: version, packaged: !!appRoot, check: enabled(), writable: !!appRoot && writable(appRoot),
    available: !!last?.available && !installed, release: last?.available ? publicRelease(last.release) : null,
    reason: last?.reason ?? null, checkedAt: lastAt || null, installing: !!busy, installed,
  });
  async function refresh(force) {
    if (!appRoot) return;
    if (!force && (!enabled() || (last && now() - lastAt < CHECK_EVERY_MS))) return;
    last = await check({ current: version });
    lastAt = now();
  }
  return {
    'GET /api/update': { run: async ({ url }) => { await refresh(url.searchParams.get('refresh') === '1'); return status(); } },
    'PUT /api/update/settings': { run: async ({ body }) => {
      const b = await body();
      if (typeof b.check !== 'boolean') throw new StudioError('bad-argument', 'Send { check: true } or { check: false }.');
      const config = readConfig(registry.file);
      writeConfig({ ...config, updateCheck: b.check }, registry.file);
      return status();
    } },
    'POST /api/update/install': { run: async () => {
      if (!appRoot) throw new StudioError('update-not-packaged', 'This studio runs from a source folder: update it with git pull.');
      if (!writable(appRoot)) throw new StudioError('update-not-writable', `The app folder ${appRoot} cannot be written; download the new version by hand.`);
      if (installed) return status();
      busy ??= (async () => {
        await refresh(true);
        if (!last?.available) throw new StudioError('update-none', 'There is no newer version to install.');
        const bytes = await download(last.release);
        installPackage(appRoot, bytes, last.release.version);
        installed = last.release.version;
      })().finally(() => { busy = null; });
      await busy;
      return status();
    } },
    'POST /api/update/restart': { run: () => {
      if (!appRoot || !restart) throw new StudioError('update-not-packaged', 'Only the installed app restarts itself.');
      const state = installState(appRoot);
      if (!state.current) throw new StudioError('update-bad-install', `${path.join(appRoot, 'current')} is missing.`);
      setTimeout(restart, 200);
      return { restarting: true, version: state.current.replace(/^app-/, '') };
    } },
  };
}

/** What the page shows of a release: no download addresses. */
function publicRelease(r) {
  return { version: r.version, name: r.name, notes: r.notes, page: r.page, size: r.zip?.size ?? 0, published: r.published };
}
