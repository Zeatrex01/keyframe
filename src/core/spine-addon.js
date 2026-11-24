// The Spine add-on: the official Spine runtime, on the owner's request only.
//
// The studio is MIT and plays animation on its own engine. The official spine-ts runtime is
// under the Spine Runtimes License: every user of a product that integrates it needs their own
// Spine Editor license. So it is not in this repository and not loaded by default. When the
// owner turns the add-on on (Settings, or `npm run spine-addon -- --accept-license`), and only
// then, the studio downloads Esoteric Software's own npm package of the runtime, checks it
// against the integrity pinned here, and keeps three files in the user's app data:
// spine-player.min.js, spine-player.min.css and the license, plus a consent record. Turning the
// add-on off deletes them.
//
// What it unlocks: the official runtime's verdict beside the engine's, posing files the engine
// does not evaluate yet (transform, path and physics constraints), baking physics, binary .skel
// import and export. Reading and writing Spine 4.2 JSON never needs it: that is a data format.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { StudioError } from '../shared/errors.js';
import { APP_NAME, userDataBase } from './app-paths.js';

export const SPINE_RUNTIME = Object.freeze({
  package: '@esotericsoftware/spine-player',
  version: '4.2.119',
  tarball: 'https://registry.npmjs.org/@esotericsoftware/spine-player/-/spine-player-4.2.119.tgz',
  integrity: 'sha512-hcbg1xaTq5DHjeLmyMP90YX8p0A9v4G1cS3Xp4tD+MDw/reVqJhL2O/8NbTnOlc6lQvc8Vi9S1JjYyIILgWm3Q==',
  license: 'Spine Runtimes License Agreement',
  licenseUrl: 'https://esotericsoftware.com/spine-runtimes-license',
  /** tarball path -> file name kept */
  files: Object.freeze({
    'package/dist/iife/spine-player.min.js': 'spine-player.min.js',
    'package/dist/spine-player.min.css': 'spine-player.min.css',
    'package/LICENSE': 'LICENSE',
  }),
});

const CONSENT = 'consent.json';
const SCRIPT = 'spine-player.min.js';
const MAX_TARBALL = 32 * 1024 * 1024;

/** Where the add-on lives: KS_SPINE_RUNTIME (a folder), else the user's app data. */
export function spineAddonDir(env = process.env, platform = process.platform, homeDir = os.homedir()) {
  if (env.KS_SPINE_RUNTIME) return path.resolve(env.KS_SPINE_RUNTIME);
  return path.join(userDataBase(platform, env, homeDir), APP_NAME, 'addons', `spine-runtime-${SPINE_RUNTIME.version}`);
}

/**
 * The runtime script, or null when the add-on is off. Never throws (the add-on contract).
 * The add-on is on only when the script AND the owner's consent record are there.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function locateSpineRuntime(env = process.env) {
  try {
    const dir = spineAddonDir(env);
    const script = path.join(dir, SCRIPT);
    return fs.existsSync(script) && fs.existsSync(path.join(dir, CONSENT)) ? script : null;
  } catch {
    return null;
  }
}

/** What Settings shows. */
export function spineAddonStatus(env = process.env) {
  const script = locateSpineRuntime(env);
  let consent = null;
  if (script) { try { consent = JSON.parse(fs.readFileSync(path.join(path.dirname(script), CONSENT), 'utf8')); } catch { consent = null; } }
  return { on: !!script, version: SPINE_RUNTIME.version, license: SPINE_RUNTIME.license, licenseUrl: SPINE_RUNTIME.licenseUrl,
    acceptedAt: consent?.acceptedAt ?? null };
}

/** The entries of an uncompressed tar archive (ustar; regular files only). */
export function readTar(buffer) {
  const out = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = field(0, 100), prefix = field(345, 155);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    if (!Number.isFinite(size) || size < 0) throw new StudioError('download-failed', 'The Spine runtime package is not a valid archive.');
    const full = prefix ? `${prefix}/${name}` : name;
    const start = offset + 512;
    if (type === '0') out.set(full, buffer.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Check a download against an npm `sha512-<base64>` integrity string. */
export function matchesIntegrity(bytes, integrity) {
  const [algorithm, expected] = integrity.split('-', 2);
  return crypto.createHash(algorithm).update(bytes).digest('base64') === expected;
}

/**
 * Turn the add-on on: download, verify, unpack, record consent. Refuses without consent.
 * @param {{ acceptLicense: boolean, env?: NodeJS.ProcessEnv, fetch?: typeof fetch, now?: () => Date, runtime?: typeof SPINE_RUNTIME }} options
 *   runtime: the package to install; gates pass a synthetic one, the studio always the pinned one.
 */
export async function installSpineRuntime({ acceptLicense, env = process.env, fetch: fetchImpl = globalThis.fetch, now = () => new Date(), runtime = SPINE_RUNTIME }) {
  if (acceptLicense !== true) {
    throw new StudioError('spine-license-required', `The Spine add-on installs Esoteric Software's official runtime, which is under the ${SPINE_RUNTIME.license}: you need your own Spine Editor license to use it. Accept it to continue.`,
      { licenseUrl: SPINE_RUNTIME.licenseUrl });
  }
  let bytes;
  try {
    const response = await fetchImpl(runtime.tarball);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    throw new StudioError('download-failed', `The Spine runtime could not be downloaded from npm: ${err.message}`, { url: runtime.tarball });
  }
  if (bytes.length > MAX_TARBALL || !matchesIntegrity(bytes, runtime.integrity)) {
    throw new StudioError('download-failed', 'The downloaded Spine runtime does not match the published package; nothing was installed.', { url: runtime.tarball });
  }
  const entries = readTar(zlib.gunzipSync(bytes));
  const dir = spineAddonDir(env);
  const staging = `${dir}.partial-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const [from, to] of Object.entries(runtime.files)) {
    const content = entries.get(from);
    if (!content) { fs.rmSync(staging, { recursive: true, force: true }); throw new StudioError('download-failed', `The Spine runtime package has no ${from}.`); }
    fs.writeFileSync(path.join(staging, to), content);
  }
  fs.writeFileSync(path.join(staging, CONSENT), `${JSON.stringify({ license: runtime.license, licenseUrl: runtime.licenseUrl,
    package: runtime.package, version: runtime.version, acceptedAt: now().toISOString() }, null, 2)}\n`);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(staging)) fs.renameSync(path.join(staging, name), path.join(dir, name));
  fs.rmSync(staging, { recursive: true, force: true });
  return spineAddonStatus(env);
}

/** Turn the add-on off: delete the runtime files and the consent record (nothing else in the folder). */
export function removeSpineRuntime(env = process.env) {
  const dir = spineAddonDir(env);
  for (const name of [...Object.values(SPINE_RUNTIME.files), CONSENT]) fs.rmSync(path.join(dir, name), { force: true });
  try { fs.rmdirSync(dir); } catch { /* not empty or already gone */ }
  return spineAddonStatus(env);
}
