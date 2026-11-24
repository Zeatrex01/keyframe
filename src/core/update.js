// Updates for the packaged app (Windows): find a newer release, download it, check it against the
// checksum the release publishes, and put it beside the running version so the next start uses it.
//
// The release feed is the public repository's GitHub releases. A release counts when its tag is a
// version (v0.0.2-beta), it is not a draft, and it carries two assets:
//   Keyframe-Studio-<version>-win-x64.zip   the package tools/package-win.js builds
//   SHA256SUMS.txt                          "<sha256>  <file name>" lines, as sha256sum writes them
// Pre-releases count too (every beta is one). Nothing is sent but a plain GET with a generic
// user agent: no identifiers, no telemetry. While the repository is private or has no release, the
// check answers "nothing new" quietly.
//
// The install folder holds one folder per version and a `current` file naming the one to start:
//   Keyframe Studio.exe   current   previous   app-0.0.1-beta/   app-0.0.2-beta/
// The launcher starts `current`; on the first start after an update (`pending`), if it fails right
// away and `previous` still exists, the launcher goes back to it. User data lives elsewhere (src/core/app-paths.js), so an update never touches it.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzip } from './zip.js';
import { StudioError } from '../shared/errors.js';

export const UPDATE_FEED = 'https://api.github.com/repos/Zeatrex01/keyframe/releases?per_page=20';
export const SUMS_NAME = 'SHA256SUMS.txt';
export const USER_AGENT = 'Keyframe-Studio-Updater';
export const PLATFORM = 'win-x64';
export const MAX_PACKAGE = 400 * 1024 * 1024;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const FOLDER = /^app-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** The package file name of a version. */
export const packageName = (/** @type {string} */ version, platform = PLATFORM) => `Keyframe-Studio-${version}-${platform}.zip`;
/** The folder a version lives in, inside the install folder. */
export const versionFolder = (/** @type {string} */ version) => `app-${version}`;

/** @returns {{ core: number[], pre: string[] } | null} */
export function parseVersion(text) {
  const m = VERSION.exec(String(text ?? '').trim());
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] } : null;
}

/** Semantic-version order: <0 when a is older than b. Versions that do not parse sort first. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  // 1.0.0-beta < 1.0.0: a version without a pre-release tag is the newer one.
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) + (y.pre.length ? 1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The newest release in a GitHub releases list that is newer than `current` and carries a package
 * and its checksum list, or null.
 * @param {any[]} releases
 * @param {string} current
 */
export function pickRelease(releases, current, platform = PLATFORM) {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft) continue;
    const parsed = parseVersion(r.tag_name);
    if (!parsed) continue;
    const version = String(r.tag_name).trim().replace(/^v/, '');
    if (compareVersions(version, current) <= 0) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const zip = assets.find(a => a?.name === packageName(version, platform));
    const sums = assets.find(a => a?.name === SUMS_NAME);
    if (!zip?.browser_download_url || !sums?.browser_download_url) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = { version, tag: String(r.tag_name), name: String(r.name ?? r.tag_name), notes: String(r.body ?? '').slice(0, 6000),
      page: typeof r.html_url === 'string' ? r.html_url : null, published: r.published_at ?? null,
      zip: { name: zip.name, url: zip.browser_download_url, size: Number(zip.size) || 0 }, sums: { url: sums.browser_download_url } };
  }
  return best;
}

const get = (fetchImpl, url, timeoutMs, accept) => fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });

/**
 * Ask the feed for a newer version. Never throws: an unreachable or empty feed is "nothing new".
 * @param {{ current: string, feed?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export async function checkForUpdate({ current, feed = process.env.KS_UPDATE_FEED || UPDATE_FEED, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  try {
    const res = await get(fetchImpl, feed, timeoutMs, 'application/vnd.github+json');
    if (!res.ok) return { current, available: false, reason: res.status === 404 ? 'no-releases' : 'unreachable' };
    const release = pickRelease(await res.json(), current);
    return release ? { current, available: true, release } : { current, available: false, reason: 'up-to-date' };
  } catch {
    return { current, available: false, reason: 'unreachable' };
  }
}

/** The checksum a SHA256SUMS.txt lists for `name`, lower-case hex, or null. */
export function sumFor(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

async function readCapped(res, max) {
  const declared = Number(res.headers.get('content-length'));
  if (declared > max) throw new StudioError('update-too-big', 'The update package is larger than any Keyframe Studio package should be.');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) throw new StudioError('update-too-big', 'The update package is larger than any Keyframe Studio package should be.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Download a release's package and prove it is the one the release lists.
 * @returns {Promise<Buffer>}
 */
export async function downloadRelease(release, { fetchImpl = globalThis.fetch, timeoutMs = 10 * 60 * 1000, max = MAX_PACKAGE } = {}) {
  const sumsRes = await get(fetchImpl, release.sums.url, 30000, 'application/octet-stream');
  if (!sumsRes.ok) throw new StudioError('update-unreachable', `The checksum list of ${release.version} could not be downloaded (${sumsRes.status}).`);
  const want = sumFor(await sumsRes.text(), release.zip.name);
  if (!want) throw new StudioError('update-no-checksum', `${SUMS_NAME} of ${release.version} does not list ${release.zip.name}; the update is not installed.`);
  const res = await get(fetchImpl, release.zip.url, timeoutMs, 'application/octet-stream');
  if (!res.ok || !res.body) throw new StudioError('update-unreachable', `The package of ${release.version} could not be downloaded (${res.status}).`);
  const bytes = await readCapped(res, max);
  const got = crypto.createHash('sha256').update(bytes).digest('hex');
  if (got !== want) throw new StudioError('update-checksum', `The downloaded package does not match its published checksum; it was thrown away and nothing changed.`, { want, got });
  return bytes;
}

/** The install folder of a packaged studio (the folder with `current`), or null for a checkout. */
export function appRootOf(studioRoot) {
  const versionDir = path.dirname(path.resolve(studioRoot));
  if (path.basename(path.resolve(studioRoot)) !== 'studio' || !FOLDER.test(path.basename(versionDir))) return null;
  const root = path.dirname(versionDir);
  return fs.existsSync(path.join(root, 'current')) ? root : null;
}

const readName = file => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };
const writeAtomic = (file, text) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };

/** The version folders of an install, and which one starts. */
export function installState(appRoot) {
  const current = readName(path.join(appRoot, 'current'));
  const previous = readName(path.join(appRoot, 'previous'));
  let folders = [];
  try { folders = fs.readdirSync(appRoot).filter(n => FOLDER.test(n) && fs.statSync(path.join(appRoot, n)).isDirectory()); } catch { /* none */ }
  return { current, previous, folders };
}

/** Whether a version folder is complete enough to start. */
export function startable(dir) {
  return fs.existsSync(path.join(dir, 'node', 'node.exe')) && fs.existsSync(path.join(dir, 'studio', 'tools', 'studio.js'));
}

/**
 * Put a downloaded package's version folder into the install and make it the one that starts next.
 * The running version stays as `previous`, so the launcher can go back to it.
 * @param {string} appRoot
 * @param {Buffer} bytes the package zip
 * @param {string} version
 */
export function installPackage(appRoot, bytes, version) {
  const folder = versionFolder(version);
  const files = unzip(bytes);
  const prefix = [...files.keys()].map(name => name.split('/')).find(parts => parts[1] === folder)?.[0];
  if (prefix === undefined) throw new StudioError('update-bad-package', `The package does not hold ${folder}; nothing changed.`);
  const before = installState(appRoot);
  const target = path.join(appRoot, folder);
  if (before.current === folder) return { version, folder, already: true };
  const staging = `${target}.partial`;
  fs.rmSync(staging, { recursive: true, force: true });
  const head = `${prefix}/${folder}/`;
  for (const [name, data] of files) {
    if (!name.startsWith(head) || name.endsWith('/')) continue;
    const rel = name.slice(head.length);
    if (rel.split('/').some(p => p === '..' || p === '' || p.includes(':') || p.includes('\\'))) throw new StudioError('update-bad-package', `The package holds an unsafe path (${name}); nothing changed.`);
    const abs = path.join(staging, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }
  if (!startable(staging) || readName(path.join(staging, 'studio', 'VERSION')) !== version) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new StudioError('update-bad-package', `The package of ${version} is incomplete; nothing changed.`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
  if (before.current) writeAtomic(path.join(appRoot, 'previous'), `${before.current}\r\n`);
  // The launcher may go back to `previous` only on this version's first start.
  writeAtomic(path.join(appRoot, 'pending'), `${folder}\r\n`);
  writeAtomic(path.join(appRoot, 'current'), `${folder}\r\n`);
  return { version, folder, already: false };
}

/** Remove version folders other than `current` and `previous`, and unfinished downloads. Answers what went. */
export function cleanOldVersions(appRoot) {
  const { current, previous, folders } = installState(appRoot);
  const keep = new Set([current, previous].filter(Boolean));
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(appRoot); } catch { return removed; }
  for (const name of names) {
    const old = (folders.includes(name) && !keep.has(name)) || /^app-.+\.partial$/.test(name) || name.endsWith('.exe.old');
    if (!old) continue;
    try { fs.rmSync(path.join(appRoot, name), { recursive: true, force: true }); removed.push(name); } catch { /* in use: next start */ }
  }
  return removed;
}

/**
 * Bring the top-level launcher up to the running version's copy. The launcher has exited by the
 * time this runs; a running one is renamed aside (Windows allows that) and removed on a later start.
 */
export function refreshLauncher(appRoot, versionDir, name = 'Keyframe Studio.exe') {
  const fresh = path.join(versionDir, 'launcher', name);
  const live = path.join(appRoot, name);
  let want;
  try { want = fs.readFileSync(fresh); } catch { return false; }
  try { if (fs.readFileSync(live).equals(want)) return false; } catch { /* missing: copy it */ }
  try { if (fs.existsSync(live)) fs.renameSync(live, `${live}.old`); fs.writeFileSync(live, want); return true; } catch { return false; }
}
