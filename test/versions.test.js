// Versions (docs/concept.md, "Versions"): a base has one result file that every change updates
// in place, so a game keeps loading one name; the earlier states are the versions to go back to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp/server.js';

test('every change updates the one result file; each earlier state is a version to go back to', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-versions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'hero.json'), JSON.stringify({ skeleton: { hash: 'hero', spine: '4.2.43' }, bones: [{ name: 'root' }, { name: 'arm', parent: 'root', length: 40 }],
    slots: [], skins: [{ name: 'default', attachments: {} }], animations: {} }));
  /** @type {any[]} */
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: (m) => sent.push(m), all: true });
  const call = async (/** @type {string} */ name, /** @type {object} */ args) => {
    sent.length = 0;
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const r = sent[0].result;
    assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
    return r.structuredContent ?? JSON.parse(r.content.find((/** @type {any} */ c) => c.type === 'text').text);
  };
  const swing = (/** @type {number} */ deg) => ({ bones: { arm: { rotate: [{ value: 0 }, { time: 0.5, value: deg }, { time: 1, value: 0 }] } } });

  const first = await call('write_animation', { from: 'hero.json', animation: 'swing', clip: swing(20) });
  const second = await call('write_animation', { from: 'hero.json', animation: 'swing', clip: swing(60) });
  assert.equal(first.file, 'hero_v2.json');
  assert.equal(second.file, 'hero_v2.json', 'the second change updates the same file');
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort(), ['hero.json', 'hero_v2.json'], 'no numbered copy per change');

  const history = await call('list_history', { file: 'hero_v2.json' });
  const versions = history.history ?? history.backups ?? history.versions;
  assert.ok(Array.isArray(versions) && versions.length >= 1, `the earlier state is kept: ${JSON.stringify(history).slice(0, 200)}`);
  const stamp = versions[0].backup ?? versions[0].stamp;
  await call('restore_file', { file: 'hero_v2.json', backup: stamp });
  const back = JSON.parse(fs.readFileSync(path.join(dir, 'hero_v2.json'), 'utf8'));
  assert.equal(back.animations.swing.bones.arm.rotate[1].value, 20, 'going back brings the first pass');
});
