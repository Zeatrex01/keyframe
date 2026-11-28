// Gate: the asset catalog (src/core/asset-catalog.js) and find_assets. It finds the owner's art in
// the project, the library and their asset folders; it knows what uses what, so it can say what
// nothing uses; it tells what changed since the last look, a move as one line; it never writes
// into the folders it reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCatalog, searchCatalog, lookForChanges, imageInfo, atlasPages, walk } from '../src/core/asset-catalog.js';
import { readConfig } from '../src/core/projects.js';
import { createServer } from '../src/mcp/server.js';
import { encodePng } from '../src/render/png.js';

const png = (w, h) => Buffer.from(encodePng({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };

/** A project with a skeleton + atlas + page, a skeleton that loads loose images, a drawing, a Godot scene, a stray image. */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-assets-'));
  write(path.join(dir, 'hero.json'), JSON.stringify({ skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }], slots: [] }));
  write(path.join(dir, 'hero.atlas'), 'hero.png\nsize:4,4\nfilter:Linear,Linear\nbody\nbounds:0,0,4,4\n');
  write(path.join(dir, 'hero.png'), png(4, 4));
  write(path.join(dir, 'loose', 'cat.json'), JSON.stringify({ skeleton: { images: './images/' }, bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'root' }],
    skins: [{ name: 'default', attachments: { s: { tail: { path: 'parts/tail' } } } }] }));
  write(path.join(dir, 'loose', 'images', 'parts', 'tail.png'), png(8, 2));
  write(path.join(dir, 'menu.parts.json'), JSON.stringify({ format: 'keyframe-parts', version: 1, name: 'menu', parts: [{ name: 'c', svg: 'asset:keyframe-basics/coin' }] }));
  write(path.join(dir, 'game', 'project.godot'), 'config_version=5\n');
  write(path.join(dir, 'game', 'scenes', 'level.tscn'), '[ext_resource type="Texture2D" path="res://art/tree.png" id="1"]\n');
  write(path.join(dir, 'game', 'art', 'tree.png'), png(16, 32));
  write(path.join(dir, 'stray.png'), png(2, 2));
  write(path.join(dir, 'node_modules', 'x', 'skip.png'), png(1, 1));
  return dir;
}

test('the project catalog knows what uses what, so it names the files nothing uses', () => {
  const dir = project();
  try {
    const { assets, sources } = buildCatalog({ projectDir: dir });
    const at = p => assets.find(a => a.source === 'project' && a.path === p);
    assert.equal(at('hero.json').kind, 'skeleton');
    assert.deepEqual(at('hero.json').uses, ['hero.atlas']);
    assert.deepEqual(at('hero.atlas').usedBy, ['hero.json']);
    assert.equal(at('hero.png').usage, 'used', 'an atlas page is used through its atlas');
    assert.equal(at('loose/images/parts/tail.png').usage, 'used', 'a skeleton without an atlas loads <images>/<path>.png');
    assert.equal(at('game/art/tree.png').usage, 'used', 'res:// resolves from the folder holding project.godot');
    assert.equal(at('menu.parts.json').kind, 'drawing');
    assert.ok(at('menu.parts.json').uses.includes('asset:keyframe-basics/coin'));
    assert.equal(at('stray.png').usage, 'unreferenced');
    assert.deepEqual(at('game/art/tree.png').image, { width: 16, height: 32, format: 'PNG' });
    assert.ok(!assets.some(a => a.path.includes('node_modules')), 'package folders are not read');
    const coin = assets.find(a => a.ref === 'asset:keyframe-basics/coin');
    assert.equal(coin.source, 'library');
    assert.deepEqual(coin.usedBy, ['menu.parts.json'], 'a library item knows which project file draws it');
    assert.equal(sources[0].source, 'project');
    const unused = searchCatalog(assets, { usage: 'unreferenced', source: 'project' }).map(a => a.path);
    assert.deepEqual(unused, ['stray.png']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('search matches every word in path, tags or kind, whatever the letters', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-pack-'));
  try {
    write(path.join(dir, 'A\u011fa\u00e7', 'b\u00fcy\u00fck_a\u011fa\u00e7.png'), png(3, 3));
    write(path.join(dir, 'ui', 'button_play.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"></svg>');
    write(path.join(dir, 'sfx', 'coin.ogg'), 'OggS');
    write(path.join(dir, 'notes.txt'), 'not an asset');
    const { assets } = buildCatalog({ folders: [dir] });
    const mine = assets.filter(a => a.source === 'folder');
    assert.deepEqual(mine.map(a => a.path).sort(), ['A\u011fa\u00e7/b\u00fcy\u00fck_a\u011fa\u00e7.png', 'sfx/coin.ogg', 'ui/button_play.svg']);
    assert.deepEqual(searchCatalog(mine, { query: 'agac buyuk' }).map(a => a.path), ['A\u011fa\u00e7/b\u00fcy\u00fck_a\u011fa\u00e7.png']);
    assert.deepEqual(searchCatalog(mine, { query: 'play', kind: ['image'] }).map(a => a.image), [{ width: 120, height: 40, format: 'SVG' }]);
    assert.deepEqual(searchCatalog(mine, { kind: ['audio'] }).map(a => a.path), ['sfx/coin.ogg']);
    assert.deepEqual(searchCatalog(assets, { query: 'coin', source: 'library' }).map(a => a.ref), ['asset:keyframe-basics/coin']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('image sizes come from the first bytes; atlas pages from their lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-img-'));
  try {
    const gif = Buffer.from('GIF89a\x05\x00\x07\x00', 'latin1');
    const bmp = Buffer.alloc(30); bmp.write('BM', 0, 'latin1'); bmp.writeInt32LE(9, 18); bmp.writeInt32LE(-6, 22);
    for (const [name, data, want] of [['a.png', png(10, 20), [10, 20, 'PNG']], ['b.gif', gif, [5, 7, 'GIF']], ['c.bmp', bmp, [9, 6, 'BMP']],
      ['d.svg', '<svg width="64px" height="32" viewBox="0 0 1 1"/>', [64, 32, 'SVG']]]) {
      write(path.join(dir, name), data);
      assert.deepEqual(imageInfo(path.join(dir, name)), { width: want[0], height: want[1], format: want[2] }, name);
    }
    write(path.join(dir, 'broken.png'), 'nope');
    assert.equal(imageInfo(path.join(dir, 'broken.png')), null);
    assert.deepEqual(atlasPages('one.png\nsize:2,2\nr\nbounds:0,0,1,1\n\ntwo.png\nsize:2,2\n'), ['one.png', 'two.png']);
    assert.equal(walk(dir, { files: 2 }).truncated, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('what changed since the last look: a baseline first, then added, changed, moved and removed, until marked seen', () => {
  const dir = project();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-state-'));
  try {
    const look = (opts, t) => lookForChanges(buildCatalog({ projectDir: dir }), state, { ...opts, now: t });
    const first = look({}, 1000);
    assert.deepEqual(first.baseline, ['project']);
    assert.equal(first.total, 0);
    write(path.join(dir, 'new.png'), png(3, 3));
    write(path.join(dir, 'hero.png'), png(6, 6));
    fs.mkdirSync(path.join(dir, 'moved'));
    fs.renameSync(path.join(dir, 'game', 'art', 'tree.png'), path.join(dir, 'moved', 'tree.png'));
    fs.rmSync(path.join(dir, 'stray.png'));
    const second = look({}, 2000);
    const lines = second.changes.map(c => `${c.what} ${c.path}${c.from ? ` <- ${c.from}` : ''}`).sort();
    assert.deepEqual(lines, ['added new.png', 'changed hero.png', 'moved moved/tree.png <- game/art/tree.png', 'removed stray.png']);
    assert.equal(look({}, 3000).total, 4, 'the log grows; the mark does not move by itself');
    assert.equal(look({ markSeen: true }, 4000).total, 4);
    assert.equal(look({}, 5000).total, 0, 'after the mark, only what comes next');
    // Nothing is ever written beside the owner's files.
    assert.ok(!fs.readdirSync(dir).some(n => n.startsWith('.') || /snapshot|changes|seen/.test(n)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(state, { recursive: true, force: true }); }
});

test('find_assets on the wire: brief rows, one asset in full, an asset folder kept in the studio list, changes', async () => {
  const dir = project();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-folder-'));
  write(path.join(folder, 'trees', 'oak.png'), png(12, 24));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
  let id = 0;
  const call = async (args = {}) => {
    await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'find_assets', arguments: args } });
    return sent.find(m => m.id === id).result.structuredContent;
  };
  try {
    const all = await call({});
    assert.ok(all.total >= 8 && all.assets.length <= 25);
    assert.match(all.note, /folder/, 'it says how to add an asset folder when none is listed');
    const unused = await call({ usage: 'unreferenced', source: 'project' });
    assert.deepEqual(unused.assets.map(a => a.path), ['stray.png']);
    assert.deepEqual(unused.assets[0], { source: 'project', path: 'stray.png', kind: 'image', image: '2x2 PNG', usage: 'unreferenced', size: fs.statSync(path.join(dir, 'stray.png')).size });
    const one = (await call({ file: 'hero.atlas' })).asset;
    assert.deepEqual(one.usedBy, ['hero.json']);
    assert.equal(one.file, path.join(dir, 'hero.atlas'));
    assert.equal((await call({ file: 'nope.png' })).error.code, 'asset-not-found');

    const kept = await call({ folder, remember: true, query: 'oak' });
    assert.deepEqual(kept.assets.map(a => [a.source, a.path, a.root]), [['folder', 'trees/oak.png', path.resolve(folder)]]);
    assert.deepEqual(readConfig().assetFolders, [path.resolve(folder)], 'the folder is in the studio list, not in the project');
    assert.equal((await call({ query: 'oak' })).total, 1, 'a kept folder is read on every later look');
    assert.equal((await call({ folder: 'relative/path' })).error.code, 'bad-argument');

    assert.ok((await call({ changes: true })).baseline);
    write(path.join(folder, 'trees', 'pine.png'), png(4, 4));
    const changed = await call({ changes: true, mark_seen: true });
    assert.deepEqual(changed.changes.map(c => [c.what, c.source, c.path]), [['added', 'folder', 'trees/pine.png']]);
    assert.equal((await call({ changes: true })).total, 0);
    assert.equal((await call({ mark_seen: true })).error.code, 'bad-argument');

    await call({ forget: folder });
    assert.deepEqual(readConfig().assetFolders, []);
    assert.ok(fs.existsSync(path.join(folder, 'trees', 'oak.png')), 'forgetting a folder never touches it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('the page reads the same catalog: rows, changes, folders, and thumbnails of catalogued pictures only', async () => {
  const { createStudioServer } = await import('../src/server/http.js');
  const http = await import('node:http');
  const dir = project();
  write(path.join(dir, 'secret.env'), 'TOKEN=1');
  write(path.join(dir, 'bad.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><script>alert(1)</script></svg>');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-pagefolder-'));
  write(path.join(folder, 'rock.png'), png(5, 5));
  const studio = createStudioServer({ projectDir: dir, version: 'test' });
  const port = await studio.listen(0);
  const ask = (method, target, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}`, ...(body ? { 'content-type': 'application/json' } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks); let json; try { json = JSON.parse(raw.toString('utf8')); } catch { json = undefined; } resolve({ status: res.statusCode, headers: res.headers, raw, json }); });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const unused = await ask('GET', '/api/assets/find?source=project&usage=unreferenced');
    assert.equal(unused.status, 200);
    assert.deepEqual(unused.json.assets.map(a => a.path).sort(), ['bad.svg', 'stray.png']);
    const added = await ask('POST', '/api/assets/folders', { folder });
    assert.equal(added.status, 200);
    const rows = (await ask('GET', '/api/assets/find?q=rock')).json.assets;
    assert.deepEqual(rows.map(r => [r.source, r.path]), [['folder', 'rock.png']]);
    const pic = await ask('GET', `/api/assets/file?source=folder&path=rock.png&root=${encodeURIComponent(path.resolve(folder))}`);
    assert.equal(pic.status, 200);
    assert.equal(pic.headers['content-type'], 'image/png');
    const svg = await ask('GET', '/api/assets/file?source=project&path=bad.svg');
    assert.match(svg.headers['content-security-policy'], /sandbox/, 'an owner SVG can never run as a page of the studio');
    for (const target of ['/api/assets/file?source=project&path=secret.env', '/api/assets/file?source=project&path=../../etc/passwd',
      '/api/assets/file?source=project&path=hero.json', `/api/assets/file?source=folder&path=rock.png&root=${encodeURIComponent(dir)}`]) {
      assert.equal((await ask('GET', target)).status, 404, target);
    }
    assert.ok((await ask('GET', '/api/assets/changes')).json.baseline);
    write(path.join(dir, 'fresh.png'), png(7, 7));
    assert.equal((await ask('GET', '/api/assets/changes')).json.total, 1);
    assert.equal((await ask('POST', '/api/assets/seen', {})).status, 200);
    assert.equal((await ask('GET', '/api/assets/changes')).json.total, 0);
    assert.equal((await ask('POST', '/api/assets/forget', { folder })).status, 200);
    assert.equal((await ask('GET', '/api/assets/find?q=rock')).json.total, 0);
  } finally {
    await new Promise(done => studio.server.close(done));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
