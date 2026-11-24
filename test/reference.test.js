// Learning from a reference, end to end: a video of a known motion is measured, saved, applied
// to the rig and compared. Plus the pure parts: the library, the owner's focus, motion -> clip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from '../src/mcp/server.js';
import { locateFfmpeg, checkRegion } from '../src/core/video.js';
import { saveMotion, readMotion, listMotions, slugOf } from '../src/core/motions.js';
import { readFocus, writeFocus, clearFocus } from '../src/core/focus.js';
import { clipFromMotion } from '../src/mcp/tools/reference.js';
import { renderFrames } from '../src/render/frames.js';
import { decodePng, encodePng } from '../src/render/png.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-learn-'));
  for (const f of ['ident.json', 'ident.atlas', 'ident.png']) fs.copyFileSync(new URL(f, FIXTURE), path.join(dir, f));
  const library = path.join(dir, '.library');
  const previous = process.env.KS_LIBRARY; process.env.KS_LIBRARY = library;
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
  let id = 0;
  const call = async (name, args = {}) => { await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); return sent.find(m => m.id === id).result; };
  const meta = result => JSON.parse(result.content.find(c => c.type === 'text').text);
  return { dir, call, meta, cleanup: () => { if (previous === undefined) delete process.env.KS_LIBRARY; else process.env.KS_LIBRARY = previous; fs.rmSync(dir, { recursive: true, force: true }); } };
}
const MOTION = { duration: 0.5, fps: 30, anchor: 'bottom', tracks: {
  scale: [{ time: 0, x: 1, y: 1, ease: 'outCubic' }, { time: 0.2, x: 1.2, y: 0.8, ease: 'inOutSine' }, { time: 0.5, x: 1, y: 1 }],
  translate: [{ time: 0, x: 0, y: 0, ease: 'outQuad' }, { time: 0.2, x: 0, y: 0.25, ease: 'linear' }, { time: 0.5, x: 0, y: 0 }],
  alpha: [{ time: 0, value: 0.5, ease: 'linear' }, { time: 0.5, value: 1 }] } };

test('the library keeps motions per user: save, replace, list newest first, read by any spelling of the name', () => {
  const p = project();
  try {
    assert.deepEqual(listMotions(), []);
    assert.equal(slugOf('  Tap Hop!! '), 'tap-hop');
    assert.deepEqual(saveMotion('Tap Hop', MOTION, { note: 'icon tap' }), { name: 'tap-hop', replaced: false });
    assert.equal(saveMotion('tap-hop', MOTION).replaced, true);
    assert.deepEqual(listMotions().map(m => [m.name, m.duration, m.channels.join()]), [['tap-hop', 0.5, 'scale,translate,alpha']]);
    assert.equal(readMotion('TAP HOP').tracks.scale.length, 3);
    assert.throws(() => readMotion('nope'), e => e.code === 'unknown-motion' && e.details.available.includes('tap-hop'));
    assert.throws(() => saveMotion('!!!', MOTION), e => e.code === 'bad-argument');
    assert.throws(() => saveMotion('still', { duration: 1, tracks: {} }), e => e.code === 'empty-motion');
  } finally { p.cleanup(); }
});

test('the owner\'s focus is stored and validated; a region must lie inside the frame', () => {
  const p = project();
  try {
    assert.equal(readFocus(p.dir), null);
    const f = writeFocus(p.dir, { file: 'reference/a.mp4', region: { x: 0.25, y: 0.1, width: 0.5, height: 0.6 }, from: 1, to: 2.5, label: ' home button ' });
    assert.deepEqual([f.region.width, f.from, f.to, f.label], [0.5, 1, 2.5, 'home button']);
    assert.equal(readFocus(p.dir).file, 'reference/a.mp4');
    assert.throws(() => writeFocus(p.dir, { file: 'a.mp4', from: 2, to: 1 }), e => e.code === 'bad-argument');
    assert.throws(() => checkRegion({ x: 0.8, y: 0, width: 0.5, height: 1 }), e => e.code === 'bad-argument');
    assert.equal(checkRegion(undefined), null);
    clearFocus(p.dir);
    assert.equal(readFocus(p.dir), null);
  } finally { p.cleanup(); }
});

test('a motion becomes a clip: travel scales with the element, amount and speed reshape it, the fade goes to a slot', () => {
  const clip = clipFromMotion(MOTION, { bone: 'body', slot: 'art', height: 200 });
  assert.deepEqual(clip.bones.body.scale[1], { time: 0.2, x: 1.2, y: 0.8, curve: 'inOutSine' });
  assert.deepEqual(clip.bones.body.translate[1], { time: 0.2, x: 0, y: 50 }, 'a quarter of a 200-unit element; linear carries no curve');
  assert.deepEqual(clip.slots.art.rgba.map(k => k.color), ['ffffff80', 'ffffffff']);
  const high = clipFromMotion({ ...MOTION, tracks: { scale: MOTION.tracks.scale } }, { bone: 'b', height: 100, pivot: { x: 0, y: 0.5 } });
  const low = high.bones.b.translate.reduce((a, b) => (b.y < a.y ? b : a));
  assert.ok(Math.abs(low.y + 10) < 0.5 && Math.abs(low.time - 0.2) < 0.04, `a bone at mid-height: squashing to 0.8 needs 10 units down at 0.2 s to keep the base planted, got ${JSON.stringify(low)}`);
  assert.deepEqual([high.bones.b.translate[0].y, high.bones.b.translate.at(-1).y], [0, 0]);
  const soft = clipFromMotion(MOTION, { bone: 'b', height: 100, amount: 0.5, speed: 2, at: 1 });
  assert.deepEqual(soft.bones.b.scale[1], { time: 1.1, x: 1.1, y: 0.9, curve: 'inOutSine' });
  assert.equal(soft.bones.b.translate[1].y, 12.5);
  assert.equal(soft.slots, undefined, 'no slot named, no fade written');
});

test('apply_motion lists the library, refuses unknown names and bones, and never writes the base', async () => {
  const p = project();
  try {
    assert.deepEqual((await p.call('apply_motion')).structuredContent.library, []);
    saveMotion('tap hop', MOTION);
    assert.deepEqual((await p.call('apply_motion')).structuredContent.library.map(m => m.name), ['tap-hop']);
    const code = r => r.structuredContent.error.code;
    assert.equal(code(await p.call('apply_motion', { motion: 'nope', animation: 'a', bone: 'root' })), 'unknown-motion');
    assert.equal(code(await p.call('apply_motion', { motion: 'tap hop', animation: 'a', bone: 'ghost' })), 'unknown-bone');
    assert.equal(code(await p.call('apply_motion', { motion: 'tap hop', bone: 'root' })), 'bad-arguments');
    const before = fs.readFileSync(path.join(p.dir, 'ident.json'));
    const done = (await p.call('apply_motion', { motion: 'tap hop', animation: 'learned', bone: 'root' })).structuredContent;
    assert.ok(done.height > 50 && done.heightFrom === 'the visible art under the bone', JSON.stringify(done));
    // The root bone sits near the middle of the logo, not at its bottom, and the result says so.
    assert.ok(done.bonePivot.y > 0.3 && /adjusted/.test(done.corrected), JSON.stringify(done.bonePivot));
    assert.ok(before.equals(fs.readFileSync(path.join(p.dir, 'ident.json'))), 'the base is byte-identical');
    const delivery = JSON.parse(fs.readFileSync(path.join(p.dir, done.file), 'utf8'));
    assert.equal(delivery.animations.learned.bones.root.scale[1].y, 0.8);
    // Travel = (measured travel + pivot * (scale - 1)) * visible height: the squash to 0.8 about a
    // bone above the base would lift the base, and the correction takes that back out.
    const want = (0.25 + done.bonePivot.y * (0.8 - 1)) * done.height;
    const got = delivery.animations.learned.bones.root.translate.find(k => Math.abs((k.time ?? 0) - 0.2) < 0.04);
    assert.ok(Math.abs(got.y - want) < done.height * 0.02, `travel at the peak ${got.y}, wanted ${want}`);
  } finally { p.cleanup(); }
});

test('with ffmpeg: a video of a known motion is measured, applied to the rig, and the copy is proven', async t => {
  const ffmpeg = locateFfmpeg();
  if (!ffmpeg) return t.skip('ffmpeg is not installed on this machine');
  const p = project();
  try {
    // 1. The "reference": the rig itself playing a known squash, rendered and encoded as a video.
    const truth = { bones: { root: { scale: [{ time: 0, x: 1, y: 1, curve: 'outCubic' }, { time: 0.2, x: 1.2, y: 0.8, curve: 'inOutSine' }, { time: 0.5, x: 1, y: 1 }, { time: 0.8, x: 1, y: 1 }] } } };
    const wrote = (await p.call('write_animation', { animation: 'truth', clip: truth })).structuredContent;
    const sk = JSON.parse(fs.readFileSync(path.join(p.dir, wrote.file), 'utf8'));
    const pages = { 'ident.png': decodePng(new Uint8Array(fs.readFileSync(path.join(p.dir, 'ident.png')))) };
    const fps = 30, times = Array.from({ length: 25 }, (_, i) => i / fps);
    const { frames } = await renderFrames({ json: sk, atlasText: fs.readFileSync(path.join(p.dir, 'ident.atlas'), 'utf8'), pages, animation: 'truth', times,
      width: 240, height: 160, margin: 0.2, background: { r: 0.09, g: 0.08, b: 0.12, a: 1 } });
    const shots = path.join(p.dir, 'shots'); fs.mkdirSync(shots);
    frames.forEach((f, i) => fs.writeFileSync(path.join(shots, `${String(i).padStart(3, '0')}.png`), encodePng(f.image)));
    fs.mkdirSync(path.join(p.dir, 'reference'));
    const made = spawnSync(ffmpeg, ['-loglevel', 'error', '-framerate', String(fps), '-i', path.join(shots, '%03d.png'), '-c:v', 'png', path.join(p.dir, 'reference', 'squash.mov')]);
    if (made.status !== 0) return t.skip('this ffmpeg cannot write a lossless test video');
    // The same frames as a lossy, chroma-subsampled H.264 file, the way a screen recording arrives.
    const lossy = spawnSync(ffmpeg, ['-loglevel', 'error', '-framerate', String(fps), '-i', path.join(shots, '%03d.png'), '-c:v', 'libx264', '-crf', '30', '-pix_fmt', 'yuv420p', path.join(p.dir, 'recording.mp4')]).status === 0;
    fs.rmSync(shots, { recursive: true });

    // 2. Measure it: the squash is found at the right time with the right size.
    const measured = p.meta(await p.call('measure_reference', { anchor: 'center', saveAs: 'squash' }));
    assert.ok(measured.confidence > 0.8, `confidence ${measured.confidence}`);
    const peak = measured.motion.tracks.scale.reduce((a, b) => (b.x > a.x ? b : a));
    assert.ok(Math.abs(peak.time - 0.2) <= 0.034, `peak at ${peak.time}`);
    assert.ok(Math.abs(peak.x - 1.2) < 0.04 && Math.abs(peak.y - 0.8) < 0.04, JSON.stringify(peak));
    assert.ok(measured.motion.fitError < 0.04);
    assert.ok(measured.motion.beats.some(b => b.kind === 'hold' && b.from >= 0.45), 'the still tail is a hold');
    assert.deepEqual(measured.saved, { name: 'squash', replaced: false });

    // 3. Apply the learned motion and prove it against the reference.
    const applied = (await p.call('apply_motion', { motion: 'squash', animation: 'copy', bone: 'root' })).structuredContent;
    const proof = p.meta(await p.call('compare_reference', { skeleton: applied.file, animation: 'copy', anchor: 'center', bone: 'root' }));
    assert.equal(proof.bone, 'root');
    assert.equal((await p.call('compare_reference', { skeleton: applied.file, animation: 'copy', bone: 'ghost' })).structuredContent.error.code, 'unknown-bone');
    assert.equal(proof.verdict, 'matches', JSON.stringify(proof.channels));
    assert.ok(proof.channels.scaleY.rms < 0.03);

    // 4. A wrong copy is caught, with the channel named.
    await p.call('apply_motion', { motion: 'squash', animation: 'weak', bone: 'root', amount: 0.3 });
    const off = p.meta(await p.call('compare_reference', { skeleton: applied.file, animation: 'weak', anchor: 'center' }));
    assert.equal(off.verdict, 'differs');
    assert.ok(off.fix.includes('scaleY') || off.fix.includes('scaleX'), JSON.stringify(off.fix));

    // 6. A compressed recording of the same motion reads the same within a few percent.
    if (lossy) {
      const rough = p.meta(await p.call('measure_reference', { file: 'recording.mp4', anchor: 'center' }));
      const top = rough.motion.tracks.scale.reduce((a, b) => (b.x > a.x ? b : a));
      assert.ok(rough.confidence > 0.6, `confidence on H.264: ${rough.confidence}`);
      assert.ok(Math.abs(top.time - 0.2) <= 0.05 && Math.abs(top.x - 1.2) < 0.06 && Math.abs(top.y - 0.8) < 0.06, `H.264 peak ${JSON.stringify(top)} in ${JSON.stringify(rough.motion.tracks.scale)}`);
      const again = p.meta(await p.call('compare_reference', { file: 'recording.mp4', skeleton: applied.file, animation: 'copy', anchor: 'center', bone: 'root' }));
      assert.equal(again.verdict, 'matches', JSON.stringify(again.channels));
    }

    // 5. What the owner marked in the page is the default for every reference tool.
    writeFocus(p.dir, { file: 'reference/squash.mov', from: 0, to: 0.5 });
    const focused = p.meta(await p.call('measure_reference', { anchor: 'center' }));
    assert.deepEqual([focused.to, focused.markedByOwner], [0.5, true]);
  } finally { p.cleanup(); }
});
