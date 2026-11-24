// The tools through the real wire, on a temporary project: scan, check, write, see, delete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp/server.js';
import { decodePng } from '../src/render/png.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);

function setup({ withProject = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-tools-'));
  for (const ext of ['json', 'atlas']) fs.copyFileSync(new URL(`ident.${ext}`, FIXTURE), path.join(dir, `logo.${ext}`));
  // The page keeps the name the atlas gives it, as in a real export.
  fs.copyFileSync(new URL('ident.png', FIXTURE), path.join(dir, 'ident.png'));
  const sent = [];
  const session = { dir: withProject ? dir : null, writable: () => withProject };
  const { wire } = createServer({ session, version: 'test', all: true, write: m => sent.push(m) });
  let id = 0;
  const call = async (name, args = {}) => {
    await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const reply = sent.find(m => m.id === id);
    return reply.result;
  };
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'logo.json'), 'utf8'));
  return { dir, call, base, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('scan_project and check_skeleton describe the folder and the runtime verdict', async () => {
  const p = setup();
  try {
    const scan = (await p.call('scan_project')).structuredContent;
    assert.equal(scan.skeletons.length, 1);
    const [logo] = scan.skeletons;
    assert.equal(logo.file, 'logo.json');
    assert.equal(logo.role, 'base');
    assert.equal(logo.atlas, 'logo.atlas');
    assert.deepEqual(logo.pages, ['ident.png']);
    assert.equal(logo.opensInRuntime, true);
    const check = (await p.call('check_skeleton')).structuredContent;
    assert.equal(check.file, 'logo.json');
    assert.equal(check.runtime.opens, true);
    assert.equal(check.fatal, 0);
  } finally { p.cleanup(); }
});

test('write -> see -> delete: the full loop on the wire', async () => {
  const p = setup();
  try {
    const bone = p.base.bones[1].name;
    const written = await p.call('write_animation', { animation: 'wave', clip: { bones: { [bone]: { rotate: [{ value: 0, curve: 'easeOut' }, { time: 1, value: 30 }] } } } });
    assert.equal(written.isError, undefined, JSON.stringify(written));
    assert.equal(written.structuredContent.file, 'logo_v2.json');
    assert.deepEqual(written.structuredContent.presets.map(x => x.where), [`bones/${bone}/rotate[0]`]);

    const seen = await p.call('see_animation', { file: 'logo_v2.json', animation: 'wave', times: [0, 0.5, 1], width: 120 });
    assert.equal(seen.content[0].type, 'image');
    const strip = decodePng(new Uint8Array(Buffer.from(seen.content[0].data, 'base64')));
    assert.equal(strip.width, 120 * 3 + 4 * 2);
    const meta = JSON.parse(seen.content[1].text);
    assert.deepEqual(meta.times, [0, 0.5, 1]);

    const scan = (await p.call('scan_project')).structuredContent;
    const delivery = scan.skeletons.find(s => s.file === 'logo_v2.json');
    assert.equal(delivery.role, 'delivery');
    assert.equal(delivery.deliveryOf, 'logo.json');

    const missing = await p.call('delete_animation', { file: 'logo_v2.json', animations: ['wave', 'nope'] });
    assert.equal(missing.structuredContent.error.code, 'unknown-animation');
    const owner = await p.call('delete_animation', { file: 'logo.json', animations: ['wave'] });
    assert.equal(owner.structuredContent.error.code, 'base-protected');
    const deleted = await p.call('delete_animation', { file: 'logo_v2.json', animations: ['wave'] });
    assert.deepEqual(deleted.structuredContent.deleted, ['wave']);
    assert.ok(deleted.structuredContent.backup);
  } finally { p.cleanup(); }
});

test('refusals reach the agent as codes: bad clip, unknown animation, no project', async () => {
  const p = setup();
  try {
    const bad = await p.call('write_animation', { animation: 'x', clip: { bones: { ghost: { rotate: [{ value: 1 }] } } } });
    assert.equal(bad.structuredContent.error.code, 'delivery-refused');
    const unknown = await p.call('see_animation', { animation: 'nope' });
    assert.equal(unknown.structuredContent.error.code, 'unknown-animation');
    const args = await p.call('write_animation', { animation: 'x' });
    assert.equal(args.structuredContent.error.code, 'bad-arguments');
    fs.renameSync(path.join(p.dir, 'ident.png'), path.join(p.dir, 'renamed.png'));
    const page = await p.call('see_animation', { times: [0] });
    assert.equal(page.structuredContent.error.code, 'missing-page');
    assert.equal(page.structuredContent.error.details.page, 'ident.png');
    const scan = (await p.call('scan_project')).structuredContent;
    assert.deepEqual(scan.skeletons[0].missingPages, ['ident.png']);
  } finally { p.cleanup(); }
  const none = setup({ withProject: false });
  try {
    assert.equal((await none.call('write_animation', { animation: 'x', clip: {} })).structuredContent.error.code, 'foreign-folder');
    assert.equal((await none.call('scan_project')).structuredContent.error.code, 'no-project');
  } finally { none.cleanup(); }
});

test('start_here hands over a working write call for this rig; the result is seen, measured and undone', async () => {
  const p = setup();
  try {
    const start = (await p.call('start_here')).structuredContent;
    assert.equal(start.example.tool, 'write_animation');
    const wrote = await p.call(start.example.tool, start.example.args);
    assert.ok(!wrote.isError, JSON.stringify(wrote.content));
    const delivery = wrote.structuredContent.file ?? wrote.structuredContent.delivery ?? 'logo_v2.json';
    assert.ok(fs.existsSync(path.join(p.dir, delivery)), 'the example produced a delivery');

    const seen = await p.call('see_animation', { file: delivery, animation: 'example_rise', times: [0, 0.2, 5] });
    const meta = JSON.parse(seen.content.find(c => c.type === 'text').text);
    assert.match(meta.warning, /past the end/);
    assert.ok(meta.duration > 0 && meta.duration < 1);

    const rig = (await p.call('read_rig')).structuredContent;
    assert.ok(JSON.stringify(rig).includes('"blend":"additive"'), 'read_rig says which slots are additive');

    const dup = await p.call('write_animation', { animation: 'dup', clip: { bones: { [Object.keys(start.example.args.clip.bones)[0]]:
      { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 10 }, { time: 0.5, value: -10 }] } } } });
    assert.ok(dup.isError && /share the time/.test(dup.content[0].text), 'duplicate key times are refused at the write');

    const gone = await p.call('delete_animation', { file: delivery, animations: ['example_rise'] });
    assert.ok(!gone.isError, JSON.stringify(gone.content));
    assert.ok(!('example_rise' in JSON.parse(fs.readFileSync(path.join(p.dir, delivery), 'utf8')).animations));
  } finally { p.cleanup(); }
});
