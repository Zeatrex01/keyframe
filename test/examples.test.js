// The examples the Projects view offers: the showcase folders with a preview, in the page's order,
// nothing without a preview, and the sample endpoint copying exactly the one asked for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_ORDER, copyExample, findExample, listExamples } from '../src/server/examples.js';
import { createStudioServer } from '../src/server/http.js';
import { isStudioError } from '../src/shared/errors.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const write = (file, text = '{}') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

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

test('the showcase folders with a preview are the examples, in the page\'s order', () => {
  const root = temp('kf-ex-');
  try {
    const showcase = path.join(root, 'examples', 'showcase');
    for (const name of ['coin-burst', 'zebra', 'mika', 'pip']) { write(path.join(showcase, name, `${name}.json`)); write(path.join(showcase, name, 'preview.png'), 'png'); }
    write(path.join(showcase, 'victory', 'victory.json'));   // no preview: not offered
    write(path.join(root, 'examples', 'characters', 'cat', 'cat.json'));
    assert.deepEqual(listExamples(root).map(e => e.name), ['mika', 'pip', 'coin-burst', 'zebra']);
    assert.equal(findExample(root).name, 'mika', 'no name: the first');
    assert.equal(findExample(root, 'pip').name, 'pip');
    for (const bad of ['victory', 'cat', '../characters/cat', 'nope', 7]) {
      assert.throws(() => findExample(root, bad), err => isStudioError(err) && err.code === 'unknown-example', String(bad));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a folder without a preview is not offered; no examples at all is said plainly', () => {
  const root = temp('kf-ex-');
  try {
    write(path.join(root, 'examples', 'characters', 'cat', 'cat.json'));
    write(path.join(root, 'examples', 'showcase', 'draft', 'draft.json'));
    assert.deepEqual(listExamples(root), []);
    fs.rmSync(path.join(root, 'examples'), { recursive: true });
    assert.deepEqual(listExamples(root), []);
    assert.throws(() => findExample(root), err => err.code === 'unknown-example');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a copy takes the example\'s art and data, once, and keeps the owner\'s changes after', () => {
  const root = temp('kf-ex-');
  try {
    const dir = path.join(root, 'examples', 'showcase', 'pip');
    write(path.join(dir, 'pip.json'), '{"a":1}'); write(path.join(dir, 'preview.png'), 'png'); write(path.join(dir, 'images', 'head.png'), 'png');
    write(path.join(dir, 'build.js'), '// not copied'); write(path.join(dir, 'README.md'), 'not copied');
    const samples = path.join(root, 'data', 'samples');
    const copy = copyExample(findExample(root, 'pip'), samples);
    assert.equal(copy, path.join(samples, 'pip'));
    assert.deepEqual(fs.readdirSync(copy).sort(), ['images', 'pip.json', 'preview.png']);
    assert.ok(fs.existsSync(path.join(copy, 'images', 'head.png')));
    fs.writeFileSync(path.join(copy, 'pip.json'), '{"changed":true}');
    copyExample(findExample(root, 'pip'), samples);
    assert.equal(fs.readFileSync(path.join(copy, 'pip.json'), 'utf8'), '{"changed":true}', 'a second open keeps the copy');
    assert.equal(fs.readFileSync(path.join(dir, 'pip.json'), 'utf8'), '{"a":1}', 'the example itself is untouched');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the server lists the examples, opens each by name as a copy, and refuses an unknown one', async () => {
  const root = temp('kf-exs-');
  const studio = createStudioServer({ version: 'test', configFile: path.join(root, 'config.json') });
  const port = await studio.listen(0);
  try {
    const listed = (await request(port, 'GET', '/api/examples')).json.examples;
    assert.deepEqual(listed.map(e => e.name), listExamples(ROOT).map(e => e.name));
    assert.ok(listed.length >= 1);
    for (const { name, preview } of listed) {
      const opened = await request(port, 'POST', '/api/projects/sample', { example: name });
      assert.equal(opened.status, 200, name);
      assert.equal(opened.json.current, path.join(root, 'samples', name), `${name} opens its own copy`);
      const source = findExample(ROOT, name).dir;
      const jsons = fs.readdirSync(source).filter(f => f.endsWith('.json'));
      for (const f of jsons) assert.ok(fs.existsSync(path.join(opened.json.current, f)), `${name}: ${f}`);
      const image = await request(port, 'GET', `/api/examples/preview?name=${encodeURIComponent(name)}`);
      assert.equal(image.status, preview ? 200 : 404, `${name} preview`);
      if (preview) assert.equal(image.headers['content-type'], 'image/png');
    }
    const unknown = await request(port, 'POST', '/api/projects/sample', { example: 'nope' });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.error.code, 'unknown-example');
    assert.equal((await request(port, 'POST', '/api/projects/sample', { example: '../characters/cat' })).status, 404);
    assert.equal((await request(port, 'GET', '/api/examples/preview?name=nope')).status, 404);
    assert.ok(!fs.existsSync(path.join(root, 'samples', 'nope')));
  } finally { await new Promise(done => studio.server.close(done)); fs.rmSync(root, { recursive: true, force: true }); }
});

test('a project\'s preview is served only for a folder in the list', async () => {
  const root = temp('kf-exp-');
  const project = path.join(root, 'mine'); write(path.join(project, 'a.json')); write(path.join(project, 'preview.png'), 'png');
  const outside = path.join(root, 'outside'); write(path.join(outside, 'preview.png'), 'png');
  const studio = createStudioServer({ version: 'test', configFile: path.join(root, 'config.json') });
  const port = await studio.listen(0);
  try {
    const opened = await request(port, 'POST', '/api/projects/open', { dir: project });
    assert.equal(opened.json.projects[0].preview, true);
    const ok = await request(port, 'GET', `/api/projects/preview?dir=${encodeURIComponent(project)}`);
    assert.equal(ok.status, 200); assert.equal(ok.raw.toString(), 'png');
    assert.equal((await request(port, 'GET', `/api/projects/preview?dir=${encodeURIComponent(outside)}`)).status, 404);
    assert.equal((await request(port, 'GET', '/api/projects/preview')).status, 404);
  } finally { await new Promise(done => studio.server.close(done)); fs.rmSync(root, { recursive: true, force: true }); }
});

test('the page\'s order names the five planned examples', () => {
  assert.deepEqual([...EXAMPLE_ORDER], ['mika', 'pip', 'chest', 'play-button', 'coin-burst']);
});
