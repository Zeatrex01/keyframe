// Gate for the drawing board's server side: the page lists drawings, reads one and saves an edit,
// which draw_rig turns into the rig again; a file the studio did not draw is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStudioServer } from '../src/server/http.js';

const BODY = '<svg viewBox="0 0 100 120"><rect x="5" y="5" width="90" height="110" rx="30" fill="#7cc4ff"/></svg>';
const HEAD = '<svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="40" fill="#ffd84d"/></svg>';

function call(port, method, target, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('the drawing board lists, reads and saves drawings through draw_rig', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-drawing-'));
  const studio = createStudioServer({ projectDir: dir, version: 'test' });
  const port = await studio.listen(0);
  try {
    assert.deepEqual((await call(port, 'GET', '/api/drawings')).json.drawings, []);
    const parts = [{ name: 'body', svg: BODY, at: [0, 60], pivot: [0, 0] }, { name: 'head', svg: HEAD, at: [0, 150], pivot: [0, 115], parent: 'body' }];
    const saved = await call(port, 'POST', '/api/drawing', { name: 'pal', folder: 'art', parts });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.file, 'art/pal.json');
    const list = (await call(port, 'GET', '/api/drawings')).json.drawings;
    assert.deepEqual(list, [{ file: 'art/pal.parts.json', name: 'pal', parts: 2, folder: 'art' }]);
    const doc = (await call(port, 'GET', '/api/drawing?file=art/pal.parts.json')).json;
    assert.equal(doc.folder, 'art');
    assert.deepEqual(doc.parts.map(p => p.name), ['body', 'head']);
    // The owner moves the head and its pivot on the board, and saves.
    doc.parts[1].at = [10, 160]; doc.parts[1].pivot = [10, 120];
    const again = await call(port, 'POST', '/api/drawing', { name: doc.name, folder: doc.folder, parts: doc.parts });
    assert.equal(again.status, 200);
    const sk = JSON.parse(fs.readFileSync(path.join(dir, 'art', 'pal.json'), 'utf8'));
    assert.deepEqual([sk.bones[2].x, sk.bones[2].y], [10, 120]);
    // A board that opened an older version cannot save over a newer one (the AI drew on it since).
    assert.match(doc.version, /^[0-9a-f]{16}$/);
    const opened = (await call(port, 'GET', '/api/drawing?file=art/pal.parts.json')).json;
    assert.equal(again.json.version, opened.version, 'a save answers with the new version');
    const ai = await call(port, 'POST', '/api/drawing', { name: 'pal', folder: 'art', parts: opened.parts.map(p => (p.name === 'head' ? { ...p, at: [20, 170] } : p)) });
    assert.equal(ai.status, 200);
    const stale = await call(port, 'POST', '/api/drawing', { name: 'pal', folder: 'art', parts: opened.parts, base: opened.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, 'stale-drawing');
    const kept = JSON.parse(fs.readFileSync(path.join(dir, 'art', 'pal.parts.json'), 'utf8'));
    assert.deepEqual(kept.parts.find(p => p.name === 'head').at, [20, 170], 'the newer drawing is kept');
    const fresh = await call(port, 'POST', '/api/drawing', { name: 'pal', folder: 'art', parts: opened.parts, base: ai.json.version });
    assert.equal(fresh.status, 200, 'saving over the version it opened is fine');
    fs.writeFileSync(path.join(dir, 'mine.json'), '{"owner":true}');
    const refused = await call(port, 'POST', '/api/drawing', { name: 'mine', parts });
    assert.equal(refused.status, 409);
    assert.equal(fs.readFileSync(path.join(dir, 'mine.json'), 'utf8'), '{"owner":true}');
    assert.equal((await call(port, 'GET', '/api/drawing?file=mine.json')).status, 400);
    assert.equal((await call(port, 'GET', '/api/drawing?file=../x.parts.json')).status >= 400, true);
  } finally {
    await new Promise(done => studio.server.close(done));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
