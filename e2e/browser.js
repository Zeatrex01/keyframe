// Which browser the e2e test drives. A module of its own so `npm run doctor` can ask without
// running the test.

import fs from 'node:fs';
import path from 'node:path';
import { findAppBrowser } from '../src/core/launch.js';

/**
 * KS_E2E_BROWSER when set (final), else Edge or Chrome where the launcher looks, else Playwright's Chromium.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function findBrowser(env = process.env) {
  const exists = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (env.KS_E2E_BROWSER) return exists(env.KS_E2E_BROWSER) ? env.KS_E2E_BROWSER : null;
  const found = findAppBrowser({ platform: process.platform, env, exists });
  if (found) return found;
  // Playwright's bundled Chromium, where a machine has one.
  for (const base of [env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean)) {
    for (const name of ['chromium/chrome-linux/chrome', 'chromium/chrome-linux64/chrome']) if (exists(path.join(base, name))) return path.join(base, name);
  }
  return null;
}
