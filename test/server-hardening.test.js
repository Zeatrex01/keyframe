// The page server as a public tool needs it: every response carries the security headers, an
// error code maps to its HTTP status, an unexpected failure never shows its internals, the polled
// state parses a skeleton again only when it changed, and the server closes cleanly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStudioServer, statusFor } from '../src/server/http.js';
import { SECURITY_HEADERS, CONTENT_SECURITY_POLICY } from '../src/server/respond.js';
import { fileCache } from '../src/server/state.js';
import { createLogger } from '../src/core/log.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);

function request(port, method, target, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(raw); } catch { json = undefined; } resolve({ status: res.statusCode, headers: res.headers, raw, json }); });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)));
  });
}

async function setup({ withProject = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-hard-'));
  const dir = path.join(root, 'project');
  fs.mkdirSync(dir);
  for (const f of ['ident.json', 'ident.atlas', 'ident.png']) fs.copyFileSync(new URL(f, FIXTURE), path.join(dir, f));
  process.env.KS_LIBRARY = path.join(root, '.library');
  const lines = [];
  const log = createLogger({ level: 'debug', stream: { write: s => lines.push(s) } });
  const studio = createStudioServer({ projectDir: withProject ? dir : undefined, version: 'test', configFile: path.join(root, 'studio.config.json'), log });
  const port = await studio.listen(0);
  return { root, dir, port, lines, studio, get: (t, o) => request(port, 'GET', t, o), post: (t, o) => request(port, 'POST', t, o),
    cleanup: async () => { await studio.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}

test('every kind of response carries the security headers, the page included', async () => {
  for (const name of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy'])
    assert.ok(SECURITY_HEADERS[name], name);
  const s = await setup();
  try {
    for (const target of ['/', '/web/app.js', '/api/state', '/files/ident.json', '/api/nope', '/files/missing.json']) {
      const r = await s.get(target);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers[name], value, `${target} ${name}`);
    }
    assert.equal((await s.get('/', { headers: { host: 'evil.example' } })).headers['x-frame-options'], 'DENY', 'a refusal too');
  } finally { await s.cleanup(); }
});

test('the page runs under a policy that allows no inline script and no other origin', async () => {
  assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'(;|$)/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /connect-src 'self'/);
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /\bsrc="\//, 'every script is a file of this origin');
    assert.equal(m[2].trim(), '', 'no inline script');
  }
  assert.doesNotMatch(html, /\son[a-z]+="/, 'no inline event handlers');
});

test('an error code maps to the status a client expects', () => {
  assert.equal(statusFor('file-not-found'), 404);
  assert.equal(statusFor('unknown-animation'), 404);
  assert.equal(statusFor('no-such-backup'), 404);
  assert.equal(statusFor('outside-project'), 403);
  assert.equal(statusFor('busy'), 409);
  assert.equal(statusFor('no-project'), 409);
  assert.equal(statusFor('too-large'), 413);
  assert.equal(statusFor('no-ffmpeg'), 501);
  assert.equal(statusFor('bad-argument'), 400);
  assert.equal(statusFor('anything-else'), 400);
});

test('a missing file through a tool is a 404, a wrong method a 405, a bad body a 400 that names the field', async () => {
  const s = await setup();
  try {
    const missing = await s.get('/api/check?file=nope.json');
    assert.equal(missing.status, 404, JSON.stringify(missing.json));
    const wrong = await s.post('/api/state');
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.allow, 'GET');
    const notObject = await s.post('/api/messages', { body: '[1,2]' });
    assert.equal(notObject.status, 400);
    assert.equal(notObject.json.error.code, 'bad-json');
    const noDir = await s.post('/api/projects/open', { body: {} });
    assert.equal(noDir.status, 400);
    assert.match(noDir.json.error.message, /"dir"/);
    assert.equal((await s.get('/api/health')).json.ok, true);
  } finally { await s.cleanup(); }
});

test('a request a browser marks as cross-site is refused even without an Origin header', async () => {
  const s = await setup();
  try {
    const r = await s.post('/api/messages', { headers: { 'sec-fetch-site': 'cross-site' }, body: { text: 'hi' } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 'cross-site');
    assert.equal((await s.post('/api/messages', { headers: { 'sec-fetch-site': 'same-origin' }, body: { text: 'hi' } })).status, 200);
  } finally { await s.cleanup(); }
});

test('an unexpected failure answers a plain 500 and logs the details, never sending them to the page', async () => {
  const s = await setup();
  try {
    // A file where the reference folder should be makes the upload fail in a way no rule names.
    fs.writeFileSync(path.join(s.dir, 'reference'), 'not a folder');
    const r = await s.post('/api/reference?name=a.mp4', { body: 'x' });
    assert.equal(r.status, 500);
    assert.equal(r.json.error.code, 'internal-error');
    assert.doesNotMatch(r.raw, /EEXIST|ENOTDIR|\.js:\d+/, 'no internals in the answer');
    assert.ok(s.lines.some(l => /ERROR unexpected failure/.test(l) && /\.js:\d+/.test(l)), 'the log has the error and its stack');
    await new Promise(r => setImmediate(r));
    assert.ok(s.lines.some(l => /DEBUG request method=POST path=\/api\/reference status=500 ms=/.test(l)), 'the access line is logged at debug');
  } finally { await s.cleanup(); }
});

test('the polled state parses a skeleton again only when its file changed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-cache-'));
  try {
    const file = path.join(root, 'a.json');
    fs.writeFileSync(file, '{"a":1}');
    const cache = fileCache(abs => JSON.parse(fs.readFileSync(abs, 'utf8')));
    assert.deepEqual(cache.get(file), { a: 1 });
    cache.get(file); cache.get(file);
    assert.equal(cache.counter.computed, 1, 'read once while unchanged');
    fs.writeFileSync(file, '{"a":22}');
    assert.deepEqual(cache.get(file), { a: 22 }, 'a change in size is seen');
    assert.equal(cache.counter.computed, 2);
    fs.rmSync(file);
    assert.equal(cache.get(file), undefined, 'a removed file is gone from the answer');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }

  const s = await setup();
  try {
    const first = (await s.get('/api/state')).json;
    assert.deepEqual(first.skeletons.map(k => k.file), ['ident.json']);
    // Same content written again with a new time: parsed again and still right.
    const abs = path.join(s.dir, 'ident.json');
    const sk = JSON.parse(fs.readFileSync(abs, 'utf8'));
    sk.animations = { ...sk.animations, extra: {} };
    fs.writeFileSync(abs, JSON.stringify(sk));
    const second = (await s.get('/api/state')).json;
    assert.ok(second.skeletons[0].animations.includes('extra'), 'a changed skeleton is seen on the next poll');
  } finally { await s.cleanup(); }
});

test('close() ends the server even with an idle keep-alive connection open', async () => {
  const s = await setup({ withProject: false });
  const agent = new http.Agent({ keepAlive: true });
  await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: s.port, path: '/api/health', agent, headers: { host: `127.0.0.1:${s.port}` } }, res => { res.resume(); res.on('end', resolve); }).on('error', reject));
  const closed = await Promise.race([s.cleanup().then(() => 'closed'), new Promise(r => setTimeout(() => r('hung'), 3000))]);
  agent.destroy();
  assert.equal(closed, 'closed');
});
