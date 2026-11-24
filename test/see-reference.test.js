// Reading a reference video: the PNG stream splitter, the refusals, and (where ffmpeg exists)
// real frames with their times through the wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { splitPngs, locateFfmpeg, extractFrames } from '../src/core/video.js';
import { createServer } from '../src/mcp/server.js';
import { decodePng } from '../src/render/png.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-ref-'));
  for (const f of ['ident.json', 'ident.atlas', 'ident.png']) fs.copyFileSync(new URL(f, FIXTURE), path.join(dir, f));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
  let id = 0;
  const call = async (name, args = {}) => { await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); return sent.find(m => m.id === id).result; };
  return { dir, call, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const codeOf = result => JSON.parse(result.content[0].text).error.code;

test('a stream of concatenated PNGs is split into its files', () => {
  const one = fs.readFileSync(new URL('ident.png', FIXTURE));
  const parts = splitPngs(Buffer.concat([Buffer.from('noise'), one, one, one.subarray(0, 40)]));
  assert.equal(parts.length, 2, 'a truncated third file is dropped');
  assert.ok(parts.every(p => p.equals(one)));
});

test('refusals name what is missing: no reference, several references, not a video, no ffmpeg', async () => {
  const p = project();
  try {
    assert.equal(codeOf(await p.call('see_reference')), 'no-reference');
    fs.mkdirSync(path.join(p.dir, 'reference'));
    for (const n of ['a.mp4', 'b.webm']) fs.writeFileSync(path.join(p.dir, 'reference', n), 'x');
    assert.equal(codeOf(await p.call('see_reference')), 'which-reference');
    assert.equal(codeOf(await p.call('see_reference', { file: 'ident.png' })), 'bad-argument');
    assert.ok((await p.call('see_reference', { file: '../outside.mp4' })).isError);
    await assert.rejects(extractFrames(path.join(p.dir, 'reference', 'a.mp4'), { ffmpeg: null }), e => e.code === 'no-ffmpeg');
    assert.equal(locateFfmpeg({ FFMPEG: path.join(p.dir, 'nope') }) === null || typeof locateFfmpeg() === 'string', true);
  } finally { p.cleanup(); }
});

test('with ffmpeg: frames of a real video come back as one filmstrip with a time per frame', async t => {
  const ffmpeg = locateFfmpeg();
  if (!ffmpeg) return t.skip('ffmpeg is not installed on this machine');
  const p = project();
  try {
    fs.mkdirSync(path.join(p.dir, 'reference'));
    const video = path.join(p.dir, 'reference', 'bars.mp4');
    const made = spawnSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=30', '-pix_fmt', 'yuv420p', video]);
    if (made.status !== 0) return t.skip('this ffmpeg cannot synthesise a test video');
    const whole = await p.call('see_reference', { count: 8, width: 80, columns: 4 });
    assert.ok(!whole.isError, JSON.stringify(whole.content));
    const meta = JSON.parse(whole.content.find(c => c.type === 'text').text);
    assert.equal(meta.file, 'reference/bars.mp4');
    assert.ok(Math.abs(meta.duration - 2) < 0.1);
    assert.equal(meta.times.length, 8);
    assert.deepEqual(meta.times.map(x => +x.toFixed(2)), [0.13, 0.38, 0.63, 0.88, 1.13, 1.38, 1.63, 1.88]);
    const strip = decodePng(new Uint8Array(Buffer.from(whole.content.find(c => c.type === 'image').data, 'base64')));
    assert.deepEqual([strip.width, strip.height], [4 * 80 + 3 * 4, 2 * 60 + 4]);
    const part = JSON.parse((await p.call('see_reference', { from: 0.5, to: 1, count: 5 })).content.find(c => c.type === 'text').text);
    assert.ok(part.times[0] >= 0.5 && part.times.at(-1) <= 1, 'a narrowed range stays inside it');
    assert.equal(codeOf(await p.call('see_reference', { from: 5, to: 6 })), 'bad-argument');
  } finally { p.cleanup(); }
});
