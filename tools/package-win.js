#!/usr/bin/env node
// Build the Windows app: a portable folder with Node bundled (no Node install needed), its zip,
// the checksum list the updater checks, and on Windows also the launcher .exe and a setup .exe.
//
//   node tools/package-win.js [--out dist] [--node-zip <node-vX-win-x64.zip>] [--no-setup]
//
// Output (dist/):
//   Keyframe Studio/                          the portable folder (start Keyframe Studio.exe)
//   Keyframe-Studio-<version>-win-x64.zip     the same folder zipped: the release asset the updater installs
//   Keyframe-Studio-<version>-win-x64-setup.exe   the installer (Windows builds only)
//   SHA256SUMS.txt                            checksums of both, published with the release
//
// Node is downloaded once from nodejs.org (the pinned version below) and checked against the
// release's SHASUMS256.txt; it is cached in dist/cache/. --node-zip uses a local copy instead.
// The launcher and the setup are compiled with the C# compiler of the .NET Framework that every
// Windows 10 and 11 has, so the build needs nothing installed. Off Windows the package gets a
// .cmd launcher instead and is meant for trying the layout, not for a release.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packageFiles, zipFolder, unzip, PACKAGE_SKIP } from '../src/core/zip.js';
import { PACKAGED_MARK } from '../src/core/app-paths.js';
import { packageName, versionFolder, SUMS_NAME } from '../src/core/update.js';
import { rasterizeSvg } from '../src/engine/svg.js';
import { encodePng } from '../src/render/png.js';

export const NODE_VERSION = '24.22.3';
export const APP_DIR = 'Keyframe Studio';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** What the app does not need: the gates, the developer tooling and type stubs. */
export const APP_SKIP = new Set([...PACKAGE_SKIP, 'test', 'e2e', '.github', 'types', 'eslint.config.js', 'tsconfig.json', 'package-lock.json', 'CLAUDE.md', 'CONTRIBUTING.md', 'Start Studio.cmd']);
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** An .ico holding PNG images of the studio's mark at the sizes Windows asks for. */
export function iconFile(svg = fs.readFileSync(path.join(ROOT, 'web', 'icons', 'favicon.svg'), 'utf8'), sizes = ICON_SIZES) {
  const images = sizes.map(size => encodePng(rasterizeSvg(svg, { width: size, height: size })));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((size, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, at); head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(images[i].length, at + 8); head.writeUInt32LE(offset, at + 12);
    offset += images[i].length;
  });
  return Buffer.concat([head, ...images]);
}

/** node.exe and its license out of an official node-v<x>-win-x64.zip. */
export function nodeFromZip(bytes) {
  const files = unzip(bytes);
  const pick = name => [...files.entries()].find(([n]) => n.split('/').length === 2 && n.endsWith(`/${name}`))?.[1];
  const exe = pick('node.exe'), license = pick('LICENSE');
  if (!exe) throw new Error('The Node zip holds no node.exe.');
  return { exe, license: license ?? Buffer.from('') };
}

async function fetchNode(version, cacheDir) {
  const name = `node-v${version}-win-x64.zip`;
  const cached = path.join(cacheDir, name);
  const base = `https://nodejs.org/dist/v${version}/`;
  const sums = await (await fetch(`${base}SHASUMS256.txt`)).text();
  const want = sums.split('\n').map(l => l.trim().split(/\s+/)).find(([, n]) => n === name)?.[0];
  if (!want) throw new Error(`nodejs.org lists no ${name}.`);
  if (fs.existsSync(cached) && sha256(fs.readFileSync(cached)) === want) return fs.readFileSync(cached);
  console.log(`  downloading ${name}`);
  const res = await fetch(`${base}${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha256(bytes) !== want) throw new Error(`${name} does not match nodejs.org's checksum.`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, bytes);
  return bytes;
}

/** The C# compiler of the .NET Framework, or null (off Windows). */
export function findCsc(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return null;
  const windir = env.WINDIR || env.SystemRoot || 'C:\\Windows';
  return ['Framework64', 'Framework'].map(f => path.win32.join(windir, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find(p => fs.existsSync(p)) ?? null;
}

const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

/**
 * Lay out the portable folder.
 * @param {{ out: string, version: string, node: { exe: Buffer, license: Buffer }, csc?: string|null, root?: string }} options
 */
export function layout({ out, version, node, csc = null, root = ROOT }) {
  const app = path.join(out, APP_DIR);
  fs.rmSync(app, { recursive: true, force: true });
  const folder = versionFolder(version);
  const dir = path.join(app, folder);
  for (const rel of packageFiles(root, APP_SKIP)) copy(path.join(root, ...rel.split('/')), path.join(dir, 'studio', ...rel.split('/')));
  fs.writeFileSync(path.join(dir, 'studio', PACKAGED_MARK), 'This studio is the packaged app: its settings live in the user\'s app data folder.\n');
  fs.mkdirSync(path.join(dir, 'node'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node', 'node.exe'), node.exe);
  fs.writeFileSync(path.join(dir, 'node', 'LICENSE'), node.license);
  const win = path.join(root, 'tools', 'win');
  for (const f of ['install.ps1', 'uninstall.ps1']) copy(path.join(win, f), path.join(dir, 'install', f));
  for (const f of ['Install.cmd', 'keyframe-mcp.cmd', 'README.txt']) copy(path.join(win, f), path.join(app, f));
  const ico = iconFile();
  fs.writeFileSync(path.join(app, 'keyframe.ico'), ico);
  fs.writeFileSync(path.join(dir, 'keyframe.ico'), ico);
  fs.writeFileSync(path.join(app, 'current'), `${folder}\r\n`);
  if (csc) {
    const exe = path.join(dir, 'launcher', 'Keyframe Studio.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    execFileSync(csc, ['/nologo', '/optimize+', '/target:winexe', `/out:${exe}`, `/win32icon:${path.join(app, 'keyframe.ico')}`, '/r:System.Windows.Forms.dll', path.join(win, 'launcher.cs')], { stdio: 'inherit' });
    fs.copyFileSync(exe, path.join(app, 'Keyframe Studio.exe'));
  } else copy(path.join(win, 'Keyframe Studio.cmd'), path.join(app, 'Keyframe Studio.cmd'));
  return { app, dir, folder };
}

/**
 * Build everything into `out`. Answers the files written and their checksums.
 * @param {{ out?: string, nodeZip?: Buffer, setup?: boolean, csc?: string|null, root?: string }} [options]
 */
export async function build({ out = path.join(ROOT, 'dist'), nodeZip, setup = true, csc = findCsc(), root = ROOT } = {}) {
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  const node = nodeFromZip(nodeZip ?? await fetchNode(NODE_VERSION, path.join(out, 'cache')));
  const { app } = layout({ out, version, node, csc, root });
  const zipName = packageName(version);
  const zip = zipFolder(app, { prefix: APP_DIR, files: packageFiles(app, new Set()), date: new Date(2026, 0, 1) });
  fs.writeFileSync(path.join(out, zipName), zip);
  const sums = { [zipName]: sha256(zip) };
  if (csc && setup) {
    const setupName = zipName.replace(/\.zip$/, '-setup.exe');
    execFileSync(csc, ['/nologo', '/optimize+', '/target:winexe', `/out:${path.join(out, setupName)}`, `/win32icon:${path.join(app, 'keyframe.ico')}`,
      `/resource:${path.join(out, zipName)},package.zip`, '/r:System.Windows.Forms.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll',
      path.join(root, 'tools', 'win', 'setup.cs')], { stdio: 'inherit' });
    sums[setupName] = sha256(fs.readFileSync(path.join(out, setupName)));
  }
  fs.writeFileSync(path.join(out, SUMS_NAME), Object.entries(sums).map(([name, sum]) => `${sum}  ${name}\n`).join(''));
  return { version, app, files: Object.keys(sums), sums, launcher: csc ? 'exe' : 'cmd' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const option = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const nodeZip = option('--node-zip');
  const result = await build({ out: path.resolve(option('--out') ?? path.join(ROOT, 'dist')), nodeZip: nodeZip ? fs.readFileSync(nodeZip) : undefined, setup: !argv.includes('--no-setup') });
  console.log(`Keyframe Studio ${result.version} for Windows: ${result.app}`);
  for (const f of result.files) console.log(`  ${f}  ${result.sums[f]}`);
  if (result.launcher === 'cmd') console.log('  (built off Windows: the launcher is a .cmd and there is no setup .exe; build a release on Windows)');
}
