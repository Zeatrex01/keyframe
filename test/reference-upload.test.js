// A reference upload from the page never replaces a file, never leaves the project, and a body
// over the limit is answered with a 413 the page can read (not a cut connection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStudioServer } from '../src/server/http.js';

function post(port, target, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: target, headers: { host: `127.0.0.1:${port}` } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function setup(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-upload-'));
  const dir = path.join(root, 'project');
  fs.mkdirSync(dir);
  process.env.KS_LIBRARY = path.join(root, '.library');
  const studio = createStudioServer({ projectDir: dir, version: 'test', configFile: path.join(root, 'config.json'), ...options });
  const port = await studio.listen(0);
  return { root, dir, upload: (name, body) => post(port, `/api/reference?name=${encodeURIComponent(name)}`, body),
    cleanup: () => new Promise(done => studio.server.close(() => { fs.rmSync(root, { recursive: true, force: true }); done(); })) };
}

test('an upload under a taken name keeps the file already there and saves beside it', async () => {
  const s = await setup();
  try {
    const ref = name => path.join(s.dir, 'reference', name);
    assert.deepEqual((await s.upload('walk.mp4', Buffer.from('the owner recording'))).json, { file: 'reference/walk.mp4' });
    const second = await s.upload('walk.mp4', Buffer.from('another clip'));
    assert.equal(second.status, 200);
    assert.deepEqual(second.json, { file: 'reference/walk (2).mp4' }, 'the second file gets a free name');
    assert.equal(fs.readFileSync(ref('walk.mp4'), 'utf8'), 'the owner recording', 'the first file is untouched');
    assert.equal(fs.readFileSync(ref('walk (2).mp4'), 'utf8'), 'another clip');
    assert.deepEqual((await s.upload('walk.mp4', Buffer.from('third'))).json, { file: 'reference/walk (3).mp4' });
    assert.equal(fs.readFileSync(ref('walk.mp4'), 'utf8'), 'the owner recording');
  } finally { await s.cleanup(); }
});

test('an upload is refused when reference/ is a link out of the project', async t => {
  const s = await setup();
  try {
    const outside = path.join(s.root, 'elsewhere');
    fs.mkdirSync(outside);
    try { fs.symlinkSync(outside, path.join(s.dir, 'reference'), 'junction'); } catch { t.skip('links cannot be made here'); return; }
    const r = await s.upload('walk.mp4', Buffer.from('x'));
    assert.equal(r.status, 403, "a path out of the project is forbidden, not malformed");
    assert.equal(r.json.error.code, 'outside-project');
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing was written outside the project');
  } finally { await s.cleanup(); }
});

test('an upload over the limit is answered with a 413 and saves nothing', async () => {
  const s = await setup({ maxUpload: 1024 });
  try {
    const r = await s.upload('big.mp4', Buffer.alloc(256 * 1024, 1));
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, 'too-large');
    assert.equal(fs.existsSync(path.join(s.dir, 'reference', 'big.mp4')), false);
    assert.equal((await s.upload('small.mp4', Buffer.alloc(512, 1))).status, 200, 'the server still answers after a refused body');
  } finally { await s.cleanup(); }
});
