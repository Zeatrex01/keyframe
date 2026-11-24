// Gate for the Windows app: the app mode opens the default browser and stops the studio once no
// page has been open for a while, a packaged studio keeps its data outside the app folder, its agent clients start
// through the shim that survives updates, and tools/package-win.js lays out a package the
// updater can install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { shouldStop, watchPages, QUIET_LIMIT_MS, FIRST_POLL_MS } from '../src/core/desktop.js';
import { defaultOpener, openInBrowser } from '../src/core/launch.js';
import { resolvePaths, PACKAGED_MARK } from '../src/core/app-paths.js';
import { connectionFor } from '../src/core/connect.js';
import { zipFolder, unzip } from '../src/core/zip.js';
import { installPackage, installState, packageName } from '../src/core/update.js';
import { build, iconFile, APP_SKIP } from '../tools/package-win.js';

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('the studio stops once no page has polled for long, or none came after the start', () => {
  const t0 = 1_000_000;
  const seen = lastPoll => ({ startedAt: t0, lastPoll: () => lastPoll });
  assert.equal(shouldStop(seen(0), t0 + FIRST_POLL_MS - 1), null, 'the browser may take a while to open');
  assert.equal(shouldStop(seen(0), t0 + FIRST_POLL_MS), 'never-opened');
  assert.equal(shouldStop(seen(t0 + 10), t0 + 70_000), null, 'a background tab polls about once a minute');
  assert.equal(shouldStop(seen(t0 + 10), t0 + 10 + QUIET_LIMIT_MS), 'no-page');
});

test('the watch stops once', async () => {
  let clock = 0, polled = 1;
  const stops = [];
  watchPages({ lastPoll: () => polled, stop: reason => stops.push(reason), now: () => clock, everyMs: 5 });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(stops, []);
  clock = QUIET_LIMIT_MS + 2;
  await new Promise(r => setTimeout(r, 30));
  polled = 0;
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(stops, ['no-page']);
});

test('the page opens in the default browser, with no browser of our choosing and no profile', () => {
  assert.deepEqual(defaultOpener('http://127.0.0.1:8731/', 'win32'), ['cmd', ['/c', 'start', '', 'http://127.0.0.1:8731/']]);
  assert.deepEqual(defaultOpener('http://127.0.0.1:8731/', 'darwin'), ['open', ['http://127.0.0.1:8731/']]);
  assert.deepEqual(defaultOpener('http://127.0.0.1:8731/', 'linux'), ['xdg-open', ['http://127.0.0.1:8731/']]);
  let call;
  assert.equal(openInBrowser('http://127.0.0.1:8731/', { platform: 'win32', spawnImpl: /** @type {any} */ ((cmd, args) => { call = [cmd, ...args]; return new EventEmitter(); }) }), true);
  assert.ok(!call.some(a => /--app|--user-data-dir|msedge|chrome/i.test(a)));
  const studio = fs.readFileSync('tools/studio.js', 'utf8');
  assert.doesNotMatch(studio, /user-data-dir|openOwnWindow|msedge/);
});

test('a packaged studio keeps its data in the user\'s app data, never in the app folder', () => {
  const root = tmp('kf-packaged-');
  fs.writeFileSync(path.join(root, PACKAGED_MARK), '');
  const p = resolvePaths({ rootDir: root, platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, homeDir: 'C:\\Users\\u' });
  assert.equal(p.packaged, true);
  assert.ok(!p.configFile.startsWith(root));
  assert.match(p.configFile, /Keyframe Studio[\\/]studio\.config\.json$/);
  assert.equal(resolvePaths({ rootDir: tmp('kf-checkout-'), env: {} }).packaged, false);
  assert.equal(resolvePaths({ rootDir: tmp('kf-checkout-'), env: { KS_PACKAGED: '1' } }).packaged, true);
});

test('agent clients of the packaged app start through the shim, which survives updates', () => {
  const { server, clients } = connectionFor('C:\\app\\app-0.0.1-beta\\studio', { appRoot: 'C:\\Apps\\Keyframe Studio' });
  assert.equal(server, 'C:\\Apps\\Keyframe Studio\\keyframe-mcp.cmd');
  const text = id => clients.find(c => c.id === id).text;
  assert.equal(text('claude-code'), 'claude mcp add --scope user keyframe-studio -- cmd /c "C:\\Apps\\Keyframe Studio\\keyframe-mcp.cmd"');
  assert.deepEqual(JSON.parse(text('claude-desktop')).mcpServers['keyframe-studio'], { command: 'cmd', args: ['/c', 'C:\\Apps\\Keyframe Studio\\keyframe-mcp.cmd'] });
  assert.match(text('codex'), /command = "cmd"\nargs = \["\/c", "C:\\\\Apps/);
  assert.ok(!JSON.stringify(clients).includes('app-0.0.1-beta'), 'no version folder in a client\'s setting');
  assert.match(connectionFor('/repo').clients[0].text, /-- node "\/repo\/tools\/mcp-server\.js"$/);
});

test('the icon holds the mark at every size Windows asks for', () => {
  const ico = iconFile();
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1]);
  const count = ico.readUInt16LE(4);
  assert.equal(count, 7);
  for (let i = 0; i < count; i++) {
    const size = ico.readUInt32LE(6 + 16 * i + 8), at = ico.readUInt32LE(6 + 16 * i + 12);
    assert.ok(ico.subarray(at, at + 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'each image is a PNG');
    assert.ok(at + size <= ico.length);
  }
});

test('the package builds with Node bundled, without the gates, and the updater can install it', async () => {
  const fakeNode = tmp('kf-node-');
  fs.mkdirSync(path.join(fakeNode, 'node-v0-win-x64'));
  fs.writeFileSync(path.join(fakeNode, 'node-v0-win-x64', 'node.exe'), 'MZ fake node');
  fs.writeFileSync(path.join(fakeNode, 'node-v0-win-x64', 'LICENSE'), 'Node license');
  const out = tmp('kf-dist-');
  const result = await build({ out, nodeZip: zipFolder(path.join(fakeNode, 'node-v0-win-x64'), { prefix: 'node-v0-win-x64' }), csc: null });
  const version = fs.readFileSync('VERSION', 'utf8').trim();
  const zipName = packageName(version);
  assert.deepEqual(result.files, [zipName]);
  const bytes = fs.readFileSync(path.join(out, zipName));
  assert.equal(fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8'), `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${zipName}\n`);
  const names = [...unzip(bytes).keys()];
  const at = `Keyframe Studio/app-${version}/`;
  for (const want of ['Keyframe Studio/current', 'Keyframe Studio/Install.cmd', 'Keyframe Studio/keyframe-mcp.cmd', 'Keyframe Studio/Keyframe Studio.cmd', 'Keyframe Studio/keyframe.ico', 'Keyframe Studio/README.txt',
    `${at}node/node.exe`, `${at}node/LICENSE`, `${at}studio/tools/studio.js`, `${at}studio/${PACKAGED_MARK}`, `${at}studio/web/index.html`, `${at}studio/LICENSE`, `${at}install/install.ps1`, `${at}install/uninstall.ps1`]) {
    assert.ok(names.includes(want), `${want} is in the package`);
  }
  for (const skipped of APP_SKIP) assert.ok(!names.some(n => n.startsWith(`${at}studio/${skipped}/`) || n === `${at}studio/${skipped}`), `${skipped} stays out`);
  assert.ok(!names.some(n => /\/\.keyframe\/|\/\.backup\/|studio\.config\.json$/.test(n)), 'nothing machine-local');
  // what the builder writes is what the updater installs
  const root = tmp('kf-install-');
  for (const f of ['node/node.exe', 'studio/tools/studio.js']) { fs.mkdirSync(path.dirname(path.join(root, 'app-0.0.0', f)), { recursive: true }); fs.writeFileSync(path.join(root, 'app-0.0.0', f), ''); }
  fs.writeFileSync(path.join(root, 'current'), 'app-0.0.0\r\n');
  installPackage(root, bytes, version);
  assert.equal(installState(root).current, `app-${version}`);
  assert.ok(fs.existsSync(path.join(root, `app-${version}`, 'studio', PACKAGED_MARK)));
});
