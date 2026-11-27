// Gate for the asset library (src/core/asset-library.js): every bundled pack carries a license
// that lets it ship and be used freely, credits its author in NOTICE when the license asks for
// it, and its items draw; draw_rig and the page reach them by reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { listPacks, packProblems, readAssetSvg, ASSET_ROOT, LICENSES } from '../src/core/asset-library.js';
import { rasterizeSvg } from '../src/engine/svg.js';
import { createServer } from '../src/mcp/server.js';
import { createStudioServer } from '../src/server/http.js';

const NOTICE = fs.readFileSync(new URL('../NOTICE', import.meta.url), 'utf8');

test('every bundled pack is sound, freely licensed, credited where it must be, and draws', () => {
  const packs = listPacks();
  assert.ok(packs.some(p => p.id === 'keyframe-basics'));
  for (const pack of packs) {
    assert.equal(pack.problems, undefined, `${pack.id}: ${pack.problems}`);
    assert.ok(pack.license in LICENSES, pack.id);
    if (pack.attribution) assert.ok(NOTICE.includes(pack.author) && NOTICE.includes(`assets/library/${pack.id}`), `NOTICE credits ${pack.id} (${pack.license})`);
    for (const item of pack.items.filter(i => i.file.endsWith('.svg'))) {
      const img = rasterizeSvg(readAssetSvg(item.ref), { height: 32 });
      assert.deepEqual(img.skipped, [], item.ref);
      // Solid art covers a good part of its box; soft effect sprites (a glow, a slash) carry
      // their ink in gradients, so their summed alpha counts instead.
      let opaque = 0, mass = 0;
      for (let i = 3; i < img.data.length; i += 4) { opaque += img.data[i] > 128 ? 1 : 0; mass += img.data[i] / 255; }
      assert.ok(opaque > img.width * img.height * 0.15 || mass > img.width * img.height * 0.05, `${item.ref} draws something`);
    }
  }
});

test('a pack without a usable license, credit or file is refused, and references are checked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-assets-'));
  try {
    fs.mkdirSync(path.join(root, 'nc'));
    fs.writeFileSync(path.join(root, 'nc', 'pack.json'), JSON.stringify({ id: 'nc', title: 'x', author: 'a', source: 's', license: 'CC-BY-NC-4.0', items: [{ id: 'a', file: 'a.svg' }] }));
    const [nc] = listPacks(root);
    assert.ok(nc.problems.some(p => /license/.test(p)) && nc.problems.some(p => /missing/.test(p)));
    assert.throws(() => readAssetSvg('asset:nc/a', root), { code: 'unknown-asset' });
    assert.deepEqual(packProblems({ id: 'ok', title: 't', author: 'a', source: 's', license: 'CC0-1.0', items: [{ id: 'a', file: 'a.svg' }] }), []);
    assert.ok(packProblems({ id: 'ok', title: 't', license: 'MIT', items: [] }).length >= 3);
    assert.throws(() => readAssetSvg('asset:keyframe-basics/nothing'), { code: 'unknown-asset' });
    assert.throws(() => readAssetSvg('asset:../x/y'), { code: 'bad-argument' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('draw_rig takes an asset reference, and the page lists the packs and serves their files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-assets-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
  const studio = createStudioServer({ projectDir: dir, version: 'test' });
  const port = await studio.listen(0);
  const get = target => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: target, headers: { host: `127.0.0.1:${port}` } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
  try {
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'draw_rig', arguments: { name: 'reward', parts: [{ name: 'coin', svg: 'asset:keyframe-basics/coin', at: [0, 0] }] } } });
    const out = sent[0].result.structuredContent;
    assert.equal(out.error, undefined, JSON.stringify(out.error));
    assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'reward.parts.json'), 'utf8')).parts[0].svg, /^<svg/);
    const list = await get('/api/assets');
    assert.equal(list.status, 200);
    const pack = JSON.parse(list.body).packs.find(p => p.id === 'keyframe-basics');
    assert.ok(pack.items.some(i => i.ref === 'asset:keyframe-basics/coin'));
    const file = await get('/assets/keyframe-basics/coin.svg');
    assert.equal(file.status, 200);
    assert.equal(file.body, fs.readFileSync(path.join(ASSET_ROOT, 'keyframe-basics', 'coin.svg'), 'utf8'));
    assert.equal((await get('/assets/../package.json')).status, 404);
  } finally {
    await new Promise(done => studio.server.close(done));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
