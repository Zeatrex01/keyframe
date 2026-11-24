// The optional add-ons: programs the studio uses when they are on this machine and does without
// when they are not. Every add-on follows one contract, so a new one is one entry here plus its
// own module, never a special case in the server or the page.
//
// The contract (docs/addons.md):
//   1. Detection never throws and never prompts: `locate(env)` answers a path or command, or null.
//      An environment variable naming the program's path is checked first and is final when set
//      to something that works.
//   2. Absent is a normal state. Everything that does not need the program works exactly as
//      before; the feature that needs it refuses with `missingCode`, a StudioError the server
//      answers with 501 and the page explains in words.
//   3. The page shows the add-on in Settings from `addonStatus()`: its name, whether it is here,
//      what it adds (locale key `settings.addon.<id>`) and the install line for this platform.
//   4. The page hides an input the add-on alone makes useful instead of showing it disabled.
//   5. No add-on is downloaded, installed or updated by the studio.
//
// Node-only (layer `core`).

import { locateFfmpeg } from './video.js';
import { locateYtDlp } from './ytdlp.js';
import { locateSpineCli } from './spine-cli.js';

/**
 * @typedef {object} Addon
 * @property {string} id stable identifier; also the locale key `settings.addon.<id>`
 * @property {string} name the program's name as people know it
 * @property {string} env the environment variable that names the program's path
 * @property {string} missingCode the StudioError code a feature throws when the program is absent
 * @property {(env: NodeJS.ProcessEnv) => string | null} locate where the program is, or null; never throws
 * @property {{ win32: string, darwin: string, other: string }} install one install line per platform
 */

/** @type {readonly Addon[]} */
export const ADDONS = Object.freeze([
  {
    id: 'ffmpeg', name: 'ffmpeg', env: 'FFMPEG', missingCode: 'no-ffmpeg', locate: locateFfmpeg,
    install: { win32: 'winget install Gyan.FFmpeg', darwin: 'brew install ffmpeg', other: 'sudo apt install ffmpeg' },
  },
  {
    id: 'ytdlp', name: 'yt-dlp', env: 'YT_DLP', missingCode: 'no-yt-dlp', locate: locateYtDlp,
    install: { win32: 'winget install yt-dlp', darwin: 'brew install yt-dlp', other: 'pipx install yt-dlp' },
  },
  {
    id: 'spineCli', name: 'Spine CLI', env: 'SPINE_CLI', missingCode: 'no-spine-cli', locate: locateSpineCli,
    install: {
      win32: 'Install Spine (esotericsoftware.com), then set SPINE_CLI to Spine.com',
      darwin: 'Install Spine (esotericsoftware.com), then set SPINE_CLI to Spine.app/Contents/MacOS/Spine',
      other: 'Install Spine (esotericsoftware.com), then set SPINE_CLI to its executable',
    },
  },
]);

/**
 * Look every add-on up once. A failing locator counts as absent: detection must never stop the studio.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {readonly Addon[]} [list] the add-ons to look up (gates pass their own)
 * @returns {Record<string, string | null>} id -> path or command, or null
 */
export function detectAddons(env = process.env, list = ADDONS) {
  /** @type {Record<string, string | null>} */
  const found = {};
  for (const addon of list) {
    try { found[addon.id] = addon.locate(env) ?? null; } catch { found[addon.id] = null; }
  }
  return found;
}

/**
 * What Settings shows: each add-on, whether it is here, and the install line for this platform.
 * @param {Record<string, unknown>} found the answer of detectAddons (missing ids count as absent)
 * @param {string} [platform]
 * @returns {{ id: string, name: string, installed: boolean, install: string, env: string }[]}
 */
export function addonStatus(found, platform = process.platform) {
  return ADDONS.map(addon => ({
    id: addon.id,
    name: addon.name,
    installed: !!found[addon.id],
    install: addon.install[platform] ?? addon.install.other,
    env: addon.env,
  }));
}
