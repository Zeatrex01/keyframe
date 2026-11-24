// Projects, settings, the studio package and the opening: the page's hub, and an MCP server
// that follows whichever project the page has open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { listProjects, openProject, createProject, forgetProject, currentProject } from '../src/core/projects.js';
import { zipFolder, unzip, packageFiles } from '../src/core/zip.js';
import { createStudioServer, connectionBlocks } from '../src/server/http.js';
import { listExamples } from '../src/server/examples.js';
import { createServer } from '../src/mcp/server.js';
import { isStudioError } from '../src/shared/errors.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
function spineFolder(root, name) {
  const dir = path.join(root, name); fs.mkdirSync(dir);
  for (const f of ['ident.json', 'ident.atlas', 'ident.png']) fs.copyFileSync(new URL(f, FIXTURE), path.join(dir, f));
  return dir;
}
function request(port, method, target, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}` } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks); let json; try { json = JSON.parse(raw.toString('utf8')); } catch { json = undefined; } resolve({ status: res.statusCode, headers: res.headers, raw, json }); });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('the registry opens, lists newest first, creates empty projects and forgets without deleting', () => {
  const root = temp('kf-reg-'), file = path.join(root, 'config.json');
  try {
    const a = spineFolder(root, 'alpha'), b = spineFolder(root, 'beta');
    assert.deepEqual(listProjects({ file }), { current: null, projects: [] });
    openProject(a, { file, now: 1 }); openProject(b, { file, now: 2 }); openProject(a, { file, now: 3 });
    const listed = listProjects({ file });
    assert.deepEqual(listed.projects.map(p => p.name), ['alpha', 'beta']);
    assert.equal(listed.current, a);
    const fresh = createProject(root, 'gamma', { file });
    assert.ok(fs.statSync(fresh.dir).isDirectory()); assert.equal(currentProject({ file }), fresh.dir);
    assert.throws(() => createProject(root, 'alpha', { file }), e => isStudioError(e) && e.code === 'folder-in-use');
    assert.throws(() => createProject(root, '../escape', { file }), e => isStudioError(e) && e.code === 'bad-name');
    assert.throws(() => openProject(path.join(root, 'nope'), { file }), e => isStudioError(e) && e.code === 'not-a-folder');
    forgetProject(fresh.dir, { file });
    assert.ok(fs.existsSync(fresh.dir), 'forgetting never deletes the folder');
    assert.equal(currentProject({ file }), null);
    fs.rmSync(b, { recursive: true });
    assert.equal(listProjects({ file }).projects.find(p => p.name === 'beta').exists, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a package zip opens again file for file and leaves out version control and machine files', () => {
  const root = temp('kf-zip-');
  try {
    fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, '.git')); fs.mkdirSync(path.join(root, 'p', '.keyframe'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n'.repeat(50));
    fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref'); fs.writeFileSync(path.join(root, 'studio.config.json'), '{}'); fs.writeFileSync(path.join(root, 'p', '.keyframe', 'chat.jsonl'), '');
    for (const name of ['.env', '.env.local', '.mcp.json', 'studio.log', 'run.lock']) fs.writeFileSync(path.join(root, name), 'SECRET=1');
    fs.mkdirSync(path.join(root, '.claude')); fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), '{}');
    fs.mkdirSync(path.join(root, 'state')); fs.writeFileSync(path.join(root, 'state', 'x.json'), '{}');
    assert.deepEqual(packageFiles(root), ['logo.png', 'src/a.js']);
    const files = unzip(zipFolder(root, { prefix: 'ks' }));
    assert.deepEqual([...files.keys()], ['ks/logo.png', 'ks/src/a.js']);
    assert.equal(files.get('ks/src/a.js').toString(), fs.readFileSync(path.join(root, 'src', 'a.js'), 'utf8'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the page switches projects without a restart, and the opening and settings are served', async () => {
  const root = temp('kf-hub-'), configFile = path.join(root, 'config.json');
  const a = spineFolder(root, 'alpha'), b = spineFolder(root, 'beta');
  // A delivery is known by the studio's marker, not by its name: hero_v2.json is the owner's own file.
  const ident = JSON.parse(fs.readFileSync(path.join(b, 'ident.json'), 'utf8'));
  fs.writeFileSync(path.join(b, 'ident_v2.json'), JSON.stringify({ ...ident, _kfDelivery: { base: 'ident.json' } }));
  fs.writeFileSync(path.join(b, 'hero_v2.json'), JSON.stringify(ident));
  fs.writeFileSync(path.join(a, 'ident_v7.json'), JSON.stringify(ident));
  const studio = createStudioServer({ version: 'test', configFile });
  const port = await studio.listen(0);
  const get = t => request(port, 'GET', t), post = (t, body) => request(port, 'POST', t, body);
  try {
    assert.equal((await get('/api/state')).json.project, null, 'nothing open yet');
    assert.equal((await get('/api/messages')).json.error.code, 'no-project');
    await post('/api/projects/open', { dir: a });
    assert.equal((await get('/api/state')).json.project.name, 'alpha');
    const opened = await post('/api/projects/open', { dir: b });
    assert.deepEqual(opened.json.projects.map(p => [p.name, p.skeletons, p.deliveries]), [['beta', 2, 1], ['alpha', 2, 0]]);
    assert.equal((await get('/api/state')).json.project.name, 'beta');
    assert.equal((await post('/api/projects/open', { dir: path.join(root, 'nope') })).json.error.code, 'not-a-folder');
    const made = await post('/api/projects/create', { parent: root, name: 'gamma' });
    assert.equal(made.json.current, path.join(root, 'gamma'));
    await post('/api/projects/forget', { dir: path.join(root, 'gamma') });
    assert.equal((await get('/api/state')).json.project, null, 'forgetting the open project closes it');

    const settings = (await get('/api/settings')).json;
    assert.ok(settings.connection.claudeCommand.includes(path.join('tools', 'mcp-server.js')));
    assert.ok(!settings.connection.claudeCommand.includes('--project'), 'the agent follows the page, so no folder is written in');
    assert.match(settings.connection.codexToml, /^\[mcp_servers\.keyframe-studio\]/);
    const opening = await get('/opening/mark_v2.json');
    assert.equal(opening.status, 200); assert.ok(JSON.parse(opening.raw.toString()).animations.intro);
    assert.equal((await get('/opening/../package.json')).status, 404);

    const pack = await get('/api/package');
    assert.equal(pack.headers['content-type'], 'application/zip');
    const files = unzip(pack.raw);
    assert.ok(files.has('keyframe-studio/tools/mcp-server.js') && files.has('keyframe-studio/web/index.html'));
    assert.ok(![...files.keys()].some(n => n.includes('/.git/') || n.endsWith('studio.config.json')));
  } finally { await new Promise(done => studio.server.close(done)); fs.rmSync(root, { recursive: true, force: true }); }
});

test('an MCP server without --project follows the project open in the studio', async () => {
  const root = temp('kf-follow-'), configFile = path.join(root, 'config.json');
  const a = spineFolder(root, 'alpha'), b = spineFolder(root, 'beta');
  const previous = process.env.KS_CONFIG;
  process.env.KS_CONFIG = configFile;
  try {
    const session = { get dir() { return currentProject(); }, writable() { return !!currentProject(); } };
    const sent = [];
    const { wire } = createServer({ session, version: 'test', write: m => sent.push(m) });
    let id = 0;
    const call = async (name, args = {}) => { await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); return sent.find(m => m.id === id).result; };
    assert.equal((await call('scan_project')).structuredContent.error.code, 'no-project');
    openProject(a);
    assert.equal((await call('scan_project')).structuredContent.project, a);
    openProject(b);
    assert.equal((await call('scan_project')).structuredContent.project, b, 'switching in the page brings the agent along');
    assert.ok(connectionBlocks('/x').claudeJson.includes('mcp-server.js'));
  } finally {
    if (previous === undefined) delete process.env.KS_CONFIG; else process.env.KS_CONFIG = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the app shell: manifest, service worker at the root, icons, an opening that is on screen before any script, and a sample', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const splash = /<div class="splash" id="splash"([^>]*)>/.exec(html);
  assert.ok(splash && !/hidden/.test(splash[1]), 'the opening must be visible at first paint, not wait for the app script');
  const boot = readFileSync(new URL('../web/boot.js', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="splashStatus"') > 0 && boot.includes("addEventListener('error'"), 'a failed start is written on the opening');
  assert.ok(html.indexOf('src="/web/boot.js"') < html.indexOf('src="/web/app.js"'), 'the start guard loads before the app');
  assert.match(html, /<link rel="manifest" href="\/web\/manifest\.webmanifest">/);
  const root = temp('kf-app-'), configFile = path.join(root, 'config.json');
  const studio = createStudioServer({ version: 'test', configFile });
  const port = await studio.listen(0);
  try {
    const manifest = await request(port, 'GET', '/web/manifest.webmanifest');
    assert.equal(manifest.headers['content-type'], 'application/manifest+json');
    const m = JSON.parse(manifest.raw.toString());
    assert.equal(m.display, 'standalone'); assert.equal(m.start_url, '/');
    for (const icon of m.icons) assert.equal((await request(port, 'GET', icon.src)).status, 200, icon.src);
    const sw = await request(port, 'GET', '/sw.js');
    assert.equal(sw.status, 200); assert.equal(sw.headers['service-worker-allowed'], '/');
    const sample = await request(port, 'POST', '/api/projects/sample', {});
    const first = listExamples(fileURLToPath(new URL('..', import.meta.url)))[0];
    assert.equal(path.basename(sample.json.current), first.name, 'no name opens the first example');
    assert.ok(fs.readdirSync(sample.json.current).some(f => f.endsWith('.json')));
    assert.ok(sample.json.current.startsWith(root), 'the sample lives beside the config, never in the examples');
    assert.ok((await request(port, 'GET', '/api/state')).json.skeletons.length >= 2);
  } finally { await new Promise(done => studio.server.close(done)); fs.rmSync(root, { recursive: true, force: true }); }
});

test('the launcher finds an app-capable browser for each platform and reuses a running studio', async () => {
  const { appBrowsers, findAppBrowser, studioAnswers } = await import('../src/core/launch.js');
  const win = appBrowsers('win32', { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\U\\AppData\\Local' });
  assert.ok(win[0].endsWith('msedge.exe') && win.some(p => p.endsWith('chrome.exe')));
  assert.equal(findAppBrowser({ platform: 'win32', env: { ProgramFiles: 'C:\\PF' }, exists: p => p.endsWith('chrome.exe') }), 'C:\\PF\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal(findAppBrowser({ platform: 'linux', env: { PATH: '/nope' }, exists: () => false }), null);
  const root = temp('kf-launch-'), studio = createStudioServer({ version: 'test', configFile: path.join(root, 'config.json') });
  const port = await studio.listen(0);
  try {
    assert.equal(await studioAnswers(port), true);
    await new Promise(done => studio.server.close(done));
    assert.equal(await studioAnswers(port), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
