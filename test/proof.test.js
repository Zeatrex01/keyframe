// Gate for the prove step (src/core/proof.js): a write is not delivered until the calls that prove
// it ran after it. `reply` refuses work "ready" for an unproven delivery, and the Director's turn
// ends with a plain note naming what it wrote and did not prove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/mcp/server.js';
import { readMessages } from '../src/core/chat.js';
import { unproven, proofOf, noteCall } from '../src/core/proof.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'showcase', 'play-button');

function studio() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-proof-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
  const call = async (name, args) => {
    sent.length = 0;
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const r = sent[0].result;
    if (r.structuredContent) return r.structuredContent;
    const text = r.content.find(c => c.type === 'text');
    const image = r.content.find(c => c.type === 'image');
    return image ? JSON.parse(text.text) : JSON.parse(text.text);
  };
  return { dir, call, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a clip written is not ready until check_skeleton and critique_animation ran on it after the write', async () => {
  const s = studio();
  try {
    for (const f of ['play-button.json', 'play-button.atlas', 'play-button.png']) fs.copyFileSync(path.join(FIXTURE, f), path.join(s.dir, f));
    const clip = { bones: { root: { scale: [{ time: 0, x: 1, y: 1, curve: 'outCubic' }, { time: 0.1, x: 0.92, y: 0.92, curve: 'outBack' }, { time: 0.3, x: 1, y: 1 }] } } };
    const w = await s.call('write_animation', { from: 'play-button.json', animation: 'tap', clip });
    assert.equal(w.error, undefined, JSON.stringify(w.error));
    const early = await s.call('reply', { text: 'Done.', work: 'ready', file: w.file, animation: 'tap' });
    assert.equal(early.error?.code, 'not-proven');
    assert.deepEqual(early.error.details.missing, ['check_skeleton', 'critique_animation']);
    assert.deepEqual(unproven(s.dir).map(u => [u.file, u.animation]), [[w.file, 'tap']]);
    await s.call('check_skeleton', { file: w.file });
    assert.deepEqual(proofOf(s.dir, w.file, 'tap').missing, ['critique_animation'], 'one of two');
    await s.call('critique_animation', { file: w.file, animation: 'tap' });
    const ok = await s.call('reply', { text: 'Done.', work: 'ready', file: w.file, animation: 'tap' });
    assert.equal(ok.error, undefined, JSON.stringify(ok.error));
    assert.equal(ok.work, 'ready');
    // A second write opens it again.
    await s.call('write_animation', { from: 'play-button.json', animation: 'tap', clip, replace: true });
    assert.deepEqual(proofOf(s.dir, w.file, 'tap').missing, ['check_skeleton', 'critique_animation']);
  } finally { s.done(); }
});

test('a weak critique is revised or said plainly: "mechanical" needs `weak`, "faulty" is refused', async () => {
  const s = studio();
  try {
    for (const f of ['play-button.json', 'play-button.atlas', 'play-button.png']) fs.copyFileSync(path.join(FIXTURE, f), path.join(s.dir, f));
    const clip = { bones: { root: { scale: [{ time: 0, x: 1, y: 1, curve: 'outCubic' }, { time: 0.1, x: 0.92, y: 0.92, curve: 'outBack' }, { time: 0.3, x: 1, y: 1 }] } } };
    const w = await s.call('write_animation', { from: 'play-button.json', animation: 'tap', clip });
    await s.call('check_skeleton', { file: w.file });
    noteCall(s.dir, 'critique_animation', { file: w.file, animation: 'tap' }, { file: w.file, verdict: 'mechanical' });
    assert.equal(proofOf(s.dir, w.file, 'tap').verdict, 'mechanical');
    const passed = await s.call('reply', { text: 'Written and checked.', work: 'ready', file: w.file, animation: 'tap' });
    assert.equal(passed.error?.code, 'weak-verdict', 'a mechanical clip is not passed off as done');
    const honest = await s.call('reply', { text: 'Here is the tap.', work: 'ready', file: w.file, animation: 'tap', weak: 'the overshoot is small, so the press reads a little stiff.' });
    assert.equal(honest.error, undefined, JSON.stringify(honest.error));
    assert.match(readMessages(s.dir).at(-1).text, /Still weak: the overshoot is small/);
    noteCall(s.dir, 'critique_animation', { file: w.file, animation: 'tap' }, { file: w.file, verdict: 'faulty' });
    assert.equal((await s.call('reply', { text: 'Done.', work: 'ready', file: w.file, animation: 'tap', weak: 'x' })).error?.code, 'weak-verdict');
  } finally { s.done(); }
});

test('a drawing is not ready until critique_art looked at it', async () => {
  const s = studio();
  try {
    await s.call('draw_rig', { name: 'ui', parts: [{ name: 'play', component: { component: 'button', label: 'PLAY' }, at: [0, 0] }] });
    const early = await s.call('reply', { text: 'Drawn.', work: 'ready', file: 'ui.json' });
    assert.deepEqual(early.error?.details?.missing, ['critique_art']);
    await s.call('critique_art', { file: 'ui.parts.json' });
    assert.equal((await s.call('reply', { text: 'Drawn.', work: 'ready', file: 'ui.json' })).error, undefined);
    assert.deepEqual(unproven(s.dir), []);
  } finally { s.done(); }
});
