// The page's HTTP surface: local only, read-mostly, confined to the project.
import { test } from 'node:test';
import { locateSpineRuntime } from '../src/core/spine-addon.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStudioServer } from '../src/server/http.js';
import { createServer } from '../src/mcp/server.js';
import { readMessages } from '../src/core/chat.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);

// A bare client, so the Host and Origin headers can be forged.
function request(port, method, target, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks); let json; try { json = JSON.parse(raw.toString('utf8')); } catch { json = undefined; } resolve({ status: res.statusCode, headers: res.headers, raw, json }); });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)));
  });
}

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-http-'));
  for (const f of ['ident.json', 'ident.atlas', 'ident.png']) fs.copyFileSync(new URL(f, FIXTURE), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'secret.env'), 'TOKEN=1');
  // The motion library is per user; a gate must not read the real one.
  process.env.KS_LIBRARY = path.join(dir, '.library');
  const studio = createStudioServer({ projectDir: dir, version: 'test' });
  const port = await studio.listen(0);
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
  let id = 0;
  const agent = async (name, args = {}) => { await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); return sent.find(m => m.id === id).result; };
  return { dir, port, agent, get: (t, o) => request(port, 'GET', t, o), post: (t, o) => request(port, 'POST', t, o),
    cleanup: () => new Promise(done => studio.server.close(() => {
      // Windows frees a file some time after its last stream closes (and a virus scan may still hold a
      // freshly written video), so removing the temp folder retries and then leaves it to the OS.
      // Only the cleanup is best effort: every assertion has already run.
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* left in the OS temp folder */ }
      done(); })) };
}

test('the link intake refuses what is not one public https video link and tells the page whether it is available', async () => {
  const s = await setup();
  try {
    assert.equal(typeof (await s.get('/api/state')).json.canFetchLink, 'boolean');
    for (const url of ['https://evil.example/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/playlist?list=PLabcdefghijk', '-o x', 'http://vimeo.com/76979871', 'https://127.0.0.1/x', 'https://2130706433/x', 'https://localhost/x', 'https://printer.local/x', 'https://user:pw@vimeo.com/1']) {
      const r = await s.post('/api/reference/link', { body: { url } });
      assert.equal(r.status, 400);
      assert.equal(r.json.error.code, 'bad-link');
    }
    assert.equal((await s.post('/api/reference/link', { headers: { origin: 'https://evil.example' }, body: { url: 'https://youtu.be/dQw4w9WgXcQ' } })).json.error.code, 'foreign-origin');
    assert.equal(fs.existsSync(path.join(s.dir, 'reference')), false, 'a refused link saved nothing');
  } finally { await s.cleanup(); }
});

test('answers only on its own local address and refuses other sites', async () => {
  const s = await setup();
  try {
    assert.equal((await s.get('/api/state')).status, 200);
    assert.equal((await s.get('/api/state', { headers: { host: 'evil.example' } })).json.error.code, 'foreign-host');
    assert.equal((await s.post('/api/messages', { headers: { origin: 'https://evil.example' }, body: { text: 'hi' } })).json.error.code, 'foreign-origin');
    assert.deepEqual(readMessages(s.dir), [], 'the forged post wrote nothing');
  } finally { await s.cleanup(); }
});

test('serves the page, the engine modules and project files; nothing outside them', async () => {
  const s = await setup();
  try {
    const page = await s.get('/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.equal((await s.get('/src/engine/index.js')).status, 200, 'the page plays on the engine, imported as is');
    assert.equal((await s.get('/src/shared/errors.js')).status, 200);
    // The official player is served only while the Spine add-on is on.
    assert.equal((await s.get('/addons/spine/spine-player.min.js')).status === 200, locateSpineRuntime() !== null);
    // Turning the add-on on needs the owner's acceptance of the Spine license; nothing is downloaded
    // without it. A scratch add-on folder, so a broken refusal can never install into the real one.
    const realAddon = process.env.KS_SPINE_RUNTIME;
    const scratch = path.join(s.dir, '.addon');
    process.env.KS_SPINE_RUNTIME = scratch;
    try {
      const refused = await s.post('/api/addons/spine', { body: { on: true } });
      assert.deepEqual([refused.status, refused.json.error.code], [400, 'spine-license-required']);
      assert.equal((await s.post('/api/addons/spine', { body: { on: 'maybe' } })).status, 400);
      assert.equal((await s.post('/api/addons/spine', { headers: { origin: 'https://evil.example' }, body: { on: false } })).json.error.code, 'foreign-origin');
      assert.equal(fs.existsSync(scratch), false);
    } finally {
      if (realAddon === undefined) delete process.env.KS_SPINE_RUNTIME; else process.env.KS_SPINE_RUNTIME = realAddon;
    }
    assert.equal(typeof (await s.get('/api/settings')).json.spine.on, 'boolean');
    for (const hidden of ['/src/core/spine-addon.js', '/src/server/http.js', '/src/engine/../core/paths.js', '/vendor/spine-player-4.2/spine-player.min.js']) {
      assert.notEqual((await s.get(hidden)).status, 200, hidden);
    }
    assert.equal((await s.get('/files/ident.json')).json.skeleton.spine, '4.2.43');
    assert.equal((await s.get('/files/ident.png')).headers['content-type'], 'image/png');
    for (const target of ['/files/secret.env', '/files/..%2F..%2Fetc%2Fpasswd', '/files/%2E%2E/package.json', '/web/..%2Fpackage.json', '/src/engine/%2E%2E/%2E%2E/package.json', '/src/engine/..%2F..%2Fpackage.json', '/addons/spine/LICENSE', '/addons/spine/consent.json', '/api/nope']) {
      assert.notEqual((await s.get(target)).status, 200, target);
    }
    const part = await s.get('/files/ident.png', { headers: { range: 'bytes=0-7' } });
    assert.deepEqual([part.status, part.raw.length, part.raw[1]], [206, 8, 0x50], 'a byte range is served, so a video can seek');
  } finally { await s.cleanup(); }
});

test('the conversation: the owner posts, the agent reads it through its tool, the reply and the delivery show up in state', async () => {
  const s = await setup();
  try {
    let state = (await s.get('/api/state')).json;
    assert.deepEqual([state.project.name, state.agent.connected, state.show.file], [path.basename(s.dir), false, 'ident.json']);
    assert.equal((await s.post('/api/messages', { body: { text: '   ' } })).status, 400);
    assert.equal((await s.post('/api/messages', { body: { text: 'add a bounce' } })).json.from, 'owner');

    assert.deepEqual((await s.agent('wait_for_message', { timeoutSec: 1, name: 'Claude' })).structuredContent.messages.map(m => m.text), ['add a bounce']);
    const base = JSON.parse(fs.readFileSync(path.join(s.dir, 'ident.json'), 'utf8'));
    const bone = base.bones.find(b => b.parent).name;
    const wrote = await s.agent('write_animation', { animation: 'bounce', clip: { bones: { [bone]: { translate: [{ time: 0, x: 0, y: 0, curve: 'outBack' }, { time: 0.4, x: 0, y: 10 }] } } } });
    assert.ok(!wrote.isError, JSON.stringify(wrote.content));
    await s.agent('reply', { text: 'Added.', work: 'ready', file: wrote.structuredContent.file, animation: 'bounce' });

    state = (await s.get('/api/state')).json;
    assert.deepEqual([state.agent.connected, state.agent.name, state.agent.work], [true, 'Claude', 'ready']);
    assert.deepEqual(state.show, { file: wrote.structuredContent.file, animation: 'bounce' }, 'the stage follows what the agent called ready');
    assert.deepEqual((await s.get('/api/messages?after=1')).json.messages.map(m => [m.from, m.text]), [['agent', 'Added.']]);

    const check = (await s.get(`/api/check?file=${wrote.structuredContent.file}`)).json;
    assert.deepEqual([check.opens, check.fatal], [true, 0]);
    // The art is part of "opens": without the atlas image the owner would see nothing.
    fs.renameSync(path.join(s.dir, 'ident.png'), path.join(s.dir, 'ident.png.away'));
    const blind = (await s.get(`/api/check?file=${wrote.structuredContent.file}`)).json;
    assert.deepEqual([blind.opens, blind.findings[0].code], [false, 'missing-page']);
  } finally { await s.cleanup(); }
});

test('undo from the page restores a backup; a reference upload lands in reference/ and is listed', async () => {
  const s = await setup();
  try {
    const base = JSON.parse(fs.readFileSync(path.join(s.dir, 'ident.json'), 'utf8'));
    const bone = base.bones.find(b => b.parent).name;
    const clip = y => ({ bones: { [bone]: { translate: [{ time: 0, x: 0, y: 0 }, { time: 0.4, x: 0, y }] } } });
    const first = (await s.agent('write_animation', { animation: 'a', clip: clip(5) })).structuredContent;
    await s.agent('write_animation', { animation: 'a', clip: clip(50), replace: true });
    const history = (await s.get(`/api/history?file=${first.file}`)).json;
    assert.ok(history.backups.length >= 1);
    const restored = await s.post('/api/restore', { body: { file: first.file, backup: history.backups[0].backup } });
    assert.equal(restored.status, 200, restored.raw.toString());
    const now = JSON.parse(fs.readFileSync(path.join(s.dir, first.file), 'utf8'));
    assert.equal(now.animations.a.bones[bone].translate.at(-1).y, 5, 'the earlier version is back');
    assert.equal((await s.post('/api/restore', { body: { file: 'ident.json', backup: 'x' } })).status, 400, 'an owner file has no history');

    const up = await s.post('/api/reference?name=..%2F..%2Fintro%20ref.mp4', { body: Buffer.from('not really a video') });
    assert.deepEqual(up.json, { file: 'reference/intro ref.mp4' }, 'the name is reduced to a file name inside reference/');
    assert.equal((await s.post('/api/reference?name=run.exe', { body: Buffer.from('x') })).status, 400);
    const state = (await s.get('/api/state')).json;
    assert.deepEqual(state.references, ['reference/intro ref.mp4']);
    assert.deepEqual([state.focus, state.library, typeof state.canReadVideo], [null, [], 'boolean']);

    // The owner marks a part of the reference and a stretch of time; the agent is told with the next message.
    assert.equal((await s.post('/api/focus', { body: { file: 'reference/other.mp4' } })).status, 400, 'only a listed reference can be marked');
    assert.equal((await s.post('/api/focus', { body: { file: 'reference/intro ref.mp4', region: { x: 0.9, y: 0, width: 0.5, height: 1 } } })).status, 400);
    const marked = (await s.post('/api/focus', { body: { file: 'reference/intro ref.mp4', region: { x: 0.2, y: 0.2, width: 0.4, height: 0.5 }, from: 0.4, to: 0.9 } })).json.focus;
    assert.deepEqual([marked.from, marked.to, marked.region.width], [0.4, 0.9, 0.4]);
    assert.equal((await s.get('/api/state')).json.focus.file, 'reference/intro ref.mp4');
    await s.post('/api/messages', { body: { text: 'learn this move' } });
    const told = (await s.agent('wait_for_message', { timeoutSec: 1 })).structuredContent;
    assert.deepEqual([told.messages.at(-1).text, told.markedInReference.from], ['learn this move', 0.4]);
    assert.equal((await s.post('/api/focus', { body: { clear: true } })).json.focus, null);
    assert.equal((await s.get('/files/reference/intro%20ref.mp4')).status, 200);
  } finally { await s.cleanup(); }
});

test('a malformed address is refused as a bad path, not as a server failure', async () => {
  const s = await setup();
  try {
    for (const target of ['/files/%E0%A4%A.json', '/web/%', '/%zz']) {
      const r = await s.get(target);
      assert.equal(r.status, 400, target);
      assert.equal(r.json.error.code, 'bad-path');
    }
    assert.equal((await s.get('/files/ident.json')).status, 200, 'a good address still answers');
  } finally { await s.cleanup(); }
});
