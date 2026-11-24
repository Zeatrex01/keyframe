// Gate for the packaged app's updates (src/core/update.js, src/server/update-routes.js): which
// release counts, that a package is checked against its published checksum, that installing puts
// the new version beside the running one (the old one stays to go back to), and that the page's
// routes only let a packaged app update itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { compareVersions, pickRelease, checkForUpdate, downloadRelease, sumFor, installPackage, installState, cleanOldVersions, appRootOf, refreshLauncher, packageName } from '../src/core/update.js';
import { zipFolder } from '../src/core/zip.js';
import { createStudioServer } from '../src/server/http.js';

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
/** A version folder that would start. */
function versionDir(root, version, extra = {}) {
  const dir = path.join(root, `app-${version}`);
  put(path.join(dir, 'node', 'node.exe'), 'MZ');
  put(path.join(dir, 'studio', 'tools', 'studio.js'), '// studio');
  put(path.join(dir, 'studio', 'VERSION'), `${extra.versionText ?? version}\n`);
  return dir;
}
/** A package zip as tools/package-win.js writes it. */
function packageOf(version, extra = {}) {
  const src = tmp('kf-pkg-');
  const app = path.join(src, 'Keyframe Studio');
  versionDir(app, version, extra);
  put(path.join(app, 'current'), `app-${version}\r\n`);
  if (extra.drop) fs.rmSync(path.join(app, `app-${version}`, extra.drop), { force: true });
  return zipFolder(app, { prefix: 'Keyframe Studio' });
}
function install(current = '0.0.1-beta') {
  const root = tmp('kf-install-');
  versionDir(root, current);
  put(path.join(root, 'current'), `app-${current}\r\n`);
  return root;
}
const release = (tag, { draft = false, assets } = {}) => ({ tag_name: tag, draft, name: tag, body: `notes of ${tag}`, html_url: `https://example.test/${tag}`,
  assets: assets ?? [{ name: packageName(tag.replace(/^v/, '')), browser_download_url: `https://example.test/${tag}.zip`, size: 10 }, { name: 'SHA256SUMS.txt', browser_download_url: `https://example.test/${tag}.sums` }] });

/** A local release feed: path -> [status, body]. */
async function feed(routes) {
  const server = http.createServer((req, res) => {
    const hit = routes[req.url];
    if (!hit) { res.writeHead(404); return res.end('{"message":"Not Found"}'); }
    res.writeHead(hit[0], { 'content-type': 'application/octet-stream' });
    res.end(hit[1]);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  return { base, close: () => new Promise(done => server.close(done)) };
}

test('versions order the semantic-version way, pre-releases before their release', () => {
  const order = ['0.0.1-beta', '0.0.1-beta.2', '0.0.1-beta.10', '0.0.1-rc.1', '0.0.1', '0.0.2-alpha', '0.1.0', '1.0.0'];
  for (let i = 1; i < order.length; i++) assert.ok(compareVersions(order[i - 1], order[i]) < 0, `${order[i - 1]} < ${order[i]}`);
  assert.equal(compareVersions('v0.0.2-beta', '0.0.2-beta'), 0);
  assert.ok(compareVersions('nonsense', '0.0.1') < 0);
});

test('a release counts only when it is newer, not a draft, and carries its package and checksums', () => {
  const list = [release('v0.0.3-beta', { draft: true }), release('v0.0.1-beta'), release('v0.0.2-beta', { assets: [] }), release('v0.0.2-alpha'), release('not-a-version'), release('v0.0.2-beta.1')];
  assert.equal(pickRelease(list, '0.0.1-beta').version, '0.0.2-beta.1');
  assert.equal(pickRelease(list, '0.0.2-beta.1'), null);
  assert.equal(pickRelease('{}', '0.0.1'), null);
  const picked = pickRelease([release('v0.0.2-beta')], '0.0.1-beta');
  assert.deepEqual([picked.zip.name, picked.notes, picked.page], ['Keyframe-Studio-0.0.2-beta-win-x64.zip', 'notes of v0.0.2-beta', 'https://example.test/v0.0.2-beta']);
});

test('the check answers "nothing new" quietly when the feed is private, missing or broken, and sends nothing personal', async () => {
  let headers;
  const server = http.createServer((req, res) => {
    headers = req.headers;
    if (req.url === '/ok') { res.writeHead(200); return res.end(JSON.stringify([release('v0.0.2-beta')])); }
    if (req.url === '/junk') { res.writeHead(200); return res.end('<html>'); }
    res.writeHead(404); res.end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  try {
    assert.deepEqual(await checkForUpdate({ current: '0.0.1-beta', feed: `${base}/private` }), { current: '0.0.1-beta', available: false, reason: 'no-releases' });
    assert.equal((await checkForUpdate({ current: '0.0.1-beta', feed: `${base}/junk` })).reason, 'unreachable');
    assert.equal((await checkForUpdate({ current: '0.0.1-beta', feed: 'http://127.0.0.1:1/' })).reason, 'unreachable');
    const found = await checkForUpdate({ current: '0.0.1-beta', feed: `${base}/ok` });
    assert.equal(found.available, true);
    assert.equal(found.release.version, '0.0.2-beta');
    assert.equal(headers['user-agent'], 'Keyframe-Studio-Updater');
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.authorization, undefined);
  } finally { await new Promise(done => server.close(done)); }
});

test('a package is installed only when it matches the checksum its release publishes', async () => {
  const bytes = packageOf('0.0.2-beta');
  const name = packageName('0.0.2-beta');
  const good = crypto.createHash('sha256').update(bytes).digest('hex');
  const f = await feed({ '/pkg.zip': [200, bytes], '/good.sums': [200, `${'0'.repeat(64)}  other.zip\n${good}  ${name}\n`], '/bad.sums': [200, `${'a'.repeat(64)}  ${name}\n`], '/none.sums': [200, 'nothing'] });
  const rel = sums => ({ version: '0.0.2-beta', zip: { name, url: `${f.base}/pkg.zip` }, sums: { url: `${f.base}/${sums}` } });
  try {
    assert.equal(sumFor(`${good} *${name}\r\n`, name), good, 'binary-mode lines count too');
    assert.ok((await downloadRelease(rel('good.sums'))).equals(bytes));
    await assert.rejects(downloadRelease(rel('bad.sums')), err => err.code === 'update-checksum');
    await assert.rejects(downloadRelease(rel('none.sums')), err => err.code === 'update-no-checksum');
    await assert.rejects(downloadRelease(rel('good.sums'), { max: 10 }), err => err.code === 'update-too-big');
  } finally { await f.close(); }
});

test('installing puts the new version beside the running one; old versions go once the new one runs', () => {
  const root = install('0.0.1-beta');
  versionDir(root, '0.0.0-beta');
  fs.mkdirSync(path.join(root, 'app-0.0.9.partial'));
  const done = installPackage(root, packageOf('0.0.2-beta'), '0.0.2-beta');
  assert.deepEqual(done, { version: '0.0.2-beta', folder: 'app-0.0.2-beta', already: false });
  const state = installState(root);
  assert.equal(state.current, 'app-0.0.2-beta');
  assert.equal(state.previous, 'app-0.0.1-beta', 'the running version stays to go back to');
  assert.equal(fs.readFileSync(path.join(root, 'current'), 'utf8'), 'app-0.0.2-beta\r\n', 'CRLF, so cmd.exe reads it');
  assert.ok(fs.existsSync(path.join(root, 'app-0.0.1-beta', 'node', 'node.exe')));
  assert.equal(installPackage(root, packageOf('0.0.2-beta'), '0.0.2-beta').already, true);
  assert.deepEqual(cleanOldVersions(root).sort(), ['app-0.0.0-beta', 'app-0.0.9.partial']);
  assert.deepEqual(installState(root).folders.sort(), ['app-0.0.1-beta', 'app-0.0.2-beta']);
});

test('a broken or foreign package changes nothing', () => {
  const root = install('0.0.1-beta');
  assert.throws(() => installPackage(root, packageOf('0.0.2-beta', { drop: 'node/node.exe' }), '0.0.2-beta'), err => err.code === 'update-bad-package');
  assert.throws(() => installPackage(root, packageOf('0.0.2-beta', { versionText: '0.0.7' }), '0.0.2-beta'), err => err.code === 'update-bad-package');
  assert.throws(() => installPackage(root, packageOf('0.0.3-beta'), '0.0.2-beta'), err => err.code === 'update-bad-package');
  assert.equal(installState(root).current, 'app-0.0.1-beta');
  assert.deepEqual(installState(root).folders, ['app-0.0.1-beta']);
  assert.ok(!fs.readdirSync(root).some(n => n.endsWith('.partial')));
});

test('the install folder is found from the studio inside it; a checkout has none', () => {
  const root = install('0.0.1-beta');
  assert.equal(appRootOf(path.join(root, 'app-0.0.1-beta', 'studio')), root);
  assert.equal(appRootOf(path.resolve('.')), null);
  // the launcher follows the running version's copy, once
  put(path.join(root, 'app-0.0.1-beta', 'launcher', 'Keyframe Studio.exe'), 'new');
  put(path.join(root, 'Keyframe Studio.exe'), 'old');
  assert.equal(refreshLauncher(root, path.join(root, 'app-0.0.1-beta')), true);
  assert.equal(fs.readFileSync(path.join(root, 'Keyframe Studio.exe'), 'utf8'), 'new');
  assert.equal(refreshLauncher(root, path.join(root, 'app-0.0.1-beta')), false);
  assert.ok(cleanOldVersions(root).includes('Keyframe Studio.exe.old'));
});

function call(port, method, target, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('the page checks, turns the check off, installs after the owner confirms, and restarts', async () => {
  const root = install('0.0.1-beta');
  const configFile = path.join(tmp('kf-upcfg-'), 'studio.config.json');
  let checks = 0, restarted = 0;
  const rel = { version: '0.0.2-beta', name: 'v0.0.2-beta', notes: 'new things', page: 'https://example.test', zip: { name: 'x', url: 'https://example.test/secret-url', size: 5 }, sums: { url: '' } };
  const studio = createStudioServer({ version: '0.0.1-beta', configFile, appRoot: root, restart: () => { restarted++; },
    update: { check: async ({ current }) => { checks++; return { current, available: true, release: rel }; }, download: async () => packageOf('0.0.2-beta') } });
  const port = await studio.listen(0);
  try {
    const first = (await call(port, 'GET', '/api/update')).json;
    assert.equal(first.available, true);
    assert.equal(first.release.version, '0.0.2-beta');
    assert.ok(!JSON.stringify(first).includes('secret-url'), 'the page gets no download address');
    await call(port, 'GET', '/api/update');
    assert.equal(checks, 1, 'checked once, not at every page load');
    assert.equal(installState(root).current, 'app-0.0.1-beta', 'nothing is installed without the owner');
    const off = (await call(port, 'PUT', '/api/update/settings', { check: false })).json;
    assert.equal(off.check, false);
    assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).updateCheck, false);
    assert.equal((await call(port, 'PUT', '/api/update/settings', { check: 'no' })).status, 400);
    const done = (await call(port, 'POST', '/api/update/install', {})).json;
    assert.equal(done.installed, '0.0.2-beta');
    assert.equal(done.available, false);
    assert.equal(installState(root).current, 'app-0.0.2-beta');
    const again = await call(port, 'POST', '/api/update/restart', {});
    assert.deepEqual(again.json, { restarting: true, version: '0.0.2-beta' });
    await new Promise(r => setTimeout(r, 300));
    assert.equal(restarted, 1);
  } finally { await studio.close(); }
});

test('a source checkout does not update itself', async () => {
  const configFile = path.join(tmp('kf-upcfg-'), 'studio.config.json');
  let checks = 0;
  const studio = createStudioServer({ version: '0.0.1-beta', configFile, appRoot: null, update: { check: async () => { checks++; return {}; } } });
  const port = await studio.listen(0);
  try {
    const status = (await call(port, 'GET', '/api/update?refresh=1')).json;
    assert.equal(status.packaged, false);
    assert.equal(checks, 0, 'no request leaves a checkout');
    const refused = await call(port, 'POST', '/api/update/install', {});
    assert.equal(refused.json.error.code, 'update-not-packaged');
    assert.equal((await call(port, 'POST', '/api/update/restart', {})).json.error.code, 'update-not-packaged');
  } finally { await studio.close(); }
});
