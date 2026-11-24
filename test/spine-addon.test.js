// Gate for the Spine add-on (src/core/spine-addon.js): off by default, on only with the owner's
// consent, installs only a download that matches its pinned integrity, keeps only its own files,
// and turning it off removes exactly those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { SPINE_RUNTIME, spineAddonDir, locateSpineRuntime, spineAddonStatus, readTar, matchesIntegrity, installSpineRuntime, removeSpineRuntime }
  from '../src/core/spine-addon.js';

/** A ustar archive of regular files, as npm packs them. */
function tar(files) {
  const blocks = [];
  for (const [name, text] of Object.entries(files)) {
    const content = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('0', 156);
    header.write('ustar\0', 257); header.write('00', 263);
    header.write('        ', 148);
    let sum = 0; for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const FILES = { 'package/dist/iife/spine-player.min.js': 'var spine = {};', 'package/dist/spine-player.min.css': '.spine-player{}',
  'package/LICENSE': 'Spine Runtimes License Agreement', 'package/README.md': 'not kept' };
const tarball = zlib.gzipSync(tar(FILES));
const integrity = `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`;
const RUNTIME = { ...SPINE_RUNTIME, tarball: 'https://registry.example/spine-player.tgz', integrity };
const serve = bytes => async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
const folder = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-addon-'));
  return { root, env: { KS_SPINE_RUNTIME: path.join(root, 'spine') } };
};

test('the add-on lives in the user\'s app data, per runtime version, unless KS_SPINE_RUNTIME names a folder', () => {
  assert.equal(spineAddonDir({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a').includes(`spine-runtime-${SPINE_RUNTIME.version}`), true);
  assert.equal(spineAddonDir({ XDG_DATA_HOME: '/x' }, 'linux', '/home/a'), path.join('/x', 'Keyframe Studio', 'addons', `spine-runtime-${SPINE_RUNTIME.version}`));
  assert.equal(spineAddonDir({ KS_SPINE_RUNTIME: '/y/z' }), path.resolve('/y/z'));
  assert.match(SPINE_RUNTIME.tarball, /^https:\/\/registry\.npmjs\.org\/@esotericsoftware\/spine-player\/-\//, 'downloads only Esoteric Software\'s own package');
  assert.match(SPINE_RUNTIME.integrity, /^sha512-/);
});

test('off by default: nothing there, or the runtime without the owner\'s consent record, is off', () => {
  const { env } = folder();
  assert.equal(locateSpineRuntime(env), null);
  assert.equal(spineAddonStatus(env).on, false);
  fs.mkdirSync(env.KS_SPINE_RUNTIME, { recursive: true });
  fs.writeFileSync(path.join(env.KS_SPINE_RUNTIME, 'spine-player.min.js'), 'var spine = {};');
  assert.equal(locateSpineRuntime(env), null, 'a copied runtime without consent stays off');
});

test('the archive reader and the integrity check', () => {
  const entries = readTar(tar(FILES));
  assert.equal(entries.get('package/LICENSE').toString(), 'Spine Runtimes License Agreement');
  assert.equal(entries.size, 4);
  assert.equal(matchesIntegrity(tarball, integrity), true);
  assert.equal(matchesIntegrity(Buffer.concat([tarball, Buffer.from([0])]), integrity), false);
});

test('turning it on refuses without the license accepted and downloads nothing', async () => {
  const { env } = folder();
  let fetched = 0;
  for (const acceptLicense of [false, undefined, 'yes']) {
    await assert.rejects(installSpineRuntime({ acceptLicense: /** @type {any} */ (acceptLicense), env, runtime: RUNTIME, fetch: async () => { fetched++; return serve(tarball)(); } }),
      err => err.code === 'spine-license-required' && /own Spine Editor license/.test(err.message) && err.details.licenseUrl === SPINE_RUNTIME.licenseUrl);
  }
  assert.equal(fetched, 0);
  assert.equal(fs.existsSync(env.KS_SPINE_RUNTIME), false);
});

test('a download that does not match the pinned integrity installs nothing', async () => {
  const { env } = folder();
  const tampered = zlib.gzipSync(tar({ ...FILES, 'package/dist/iife/spine-player.min.js': 'steal()' }));
  await assert.rejects(installSpineRuntime({ acceptLicense: true, env, runtime: RUNTIME, fetch: serve(tampered) }), { code: 'download-failed' });
  await assert.rejects(installSpineRuntime({ acceptLicense: true, env, runtime: RUNTIME, fetch: async () => ({ ok: false, status: 404 }) }), { code: 'download-failed' });
  await assert.rejects(installSpineRuntime({ acceptLicense: true, env, runtime: RUNTIME, fetch: async () => { throw new Error('offline'); } }), /offline/);
  assert.equal(locateSpineRuntime(env), null);
  assert.equal(fs.existsSync(env.KS_SPINE_RUNTIME), false);
});

test('on with consent: keeps the three files and a dated consent record; off removes exactly those', async () => {
  const { env } = folder();
  const status = await installSpineRuntime({ acceptLicense: true, env, runtime: RUNTIME, fetch: serve(tarball), now: () => new Date('2026-11-24T10:00:00Z') });
  assert.deepEqual([status.on, status.acceptedAt], [true, '2026-11-24T10:00:00.000Z']);
  assert.deepEqual(fs.readdirSync(env.KS_SPINE_RUNTIME).sort(), ['LICENSE', 'consent.json', 'spine-player.min.css', 'spine-player.min.js']);
  assert.equal(locateSpineRuntime(env), path.join(env.KS_SPINE_RUNTIME, 'spine-player.min.js'));
  const consent = JSON.parse(fs.readFileSync(path.join(env.KS_SPINE_RUNTIME, 'consent.json'), 'utf8'));
  assert.equal(consent.license, SPINE_RUNTIME.license);
  assert.equal(fs.readdirSync(path.dirname(env.KS_SPINE_RUNTIME)).some(n => n.includes('.partial-')), false, 'no staging folder left behind');

  fs.writeFileSync(path.join(env.KS_SPINE_RUNTIME, 'notes.txt'), 'the owner\'s');
  assert.equal(removeSpineRuntime(env).on, false);
  assert.deepEqual(fs.readdirSync(env.KS_SPINE_RUNTIME), ['notes.txt'], 'only the add-on\'s own files are deleted');
  fs.rmSync(path.join(env.KS_SPINE_RUNTIME, 'notes.txt'));
  removeSpineRuntime(env);
  assert.equal(fs.existsSync(env.KS_SPINE_RUNTIME), false, 'an empty add-on folder goes too');
});

test('a package missing a file it should carry installs nothing', async () => {
  const { env } = folder();
  const partial = zlib.gzipSync(tar({ 'package/LICENSE': 'x' }));
  const runtime = { ...RUNTIME, integrity: `sha512-${crypto.createHash('sha512').update(partial).digest('base64')}` };
  await assert.rejects(installSpineRuntime({ acceptLicense: true, env, runtime, fetch: serve(partial) }), /has no package\/dist/);
  assert.equal(locateSpineRuntime(env), null);
});
