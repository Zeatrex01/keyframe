// Gate for flowing cycles: the "smooth" curve passes through keys without stopping (a loop wraps
// its seam), and critique_animation catches the stiff run: legs that halt at every key, a run
// that never leaves the ground, a body leaning the whole clip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeAnimation } from '../src/deliver/normalize.js';
import { createServer } from '../src/mcp/server.js';
import { actionFindings } from '../src/understand/actions.js';

test('a smooth curve passes through a key at speed, and a loop flows through its seam', () => {
  const keys = [[0, 0], [0.2, 30], [0.4, 0], [0.6, -30], [0.8, 0]].map(([time, value]) => ({ time, value, curve: 'smooth' }));
  const { animation } = normalizeAnimation({ bones: { arm: { rotate: keys } } });
  const out = animation.bones.arm.rotate;
  // The bezier from the key at 0.4 leaves with the slope of its neighbours: (-30 - 30) / 0.4.
  const [cx1, cy1] = out[2].curve;
  assert.ok(Math.abs((cy1 - 0) / (cx1 - 0.4) - (-150)) < 0.05, `slope ${(cy1) / (cx1 - 0.4)}`);
  // At the seam the first key takes the slope through the last-but-one and the second key.
  const [sx1, sy1] = out[0].curve;
  assert.ok(Math.abs(sy1 / sx1 - (30 - -30) / 0.4) < 0.05);
  assert.equal(out[out.length - 1].curve, undefined);
});

test('critique catches a stiff run: eased at every key, never airborne, leaning like a falling tower', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-run-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
  const call = async (name, args) => { sent.length = 0; await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); const r = sent[0].result; return r.structuredContent ?? JSON.parse(r.content.find(c => c.type === 'text').text); };
  try {
    await call('draw_rig', { name: 'hero', parts: [{ name: 'hero', component: { component: 'figure', build: 'side', h: 300 }, at: [0, 0] }] });
    const K = (pairs, curve) => pairs.map(([time, value]) => ({ time, value, curve }));
    const stride = curve => ({ bones: {
      body: { rotate: K([[0, -16], [0.3, -14], [0.6, -16]], curve), translate: [{ time: 0, x: 0, y: -12, curve }, { time: 0.15, x: 0, y: 0, curve }, { time: 0.3, x: 0, y: -12, curve }, { time: 0.45, x: 0, y: 0, curve }, { time: 0.6, x: 0, y: -12 }] },
      thighFront: { rotate: K([[0, 30], [0.15, 0], [0.3, -30], [0.45, 0], [0.6, 30]], curve) },
      thighBack: { rotate: K([[0, -30], [0.15, 0], [0.3, 30], [0.45, 0], [0.6, -30]], curve) },
      upperArmFront: { rotate: K([[0, -30], [0.3, 30], [0.6, -30]], curve) },
    } });
    const w = await call('write_animation', { from: 'hero.json', animation: 'run', clip: stride('inOutSine') });
    assert.equal(w.error, undefined, JSON.stringify(w.error));
    const sk = JSON.parse(fs.readFileSync(path.join(dir, w.file), 'utf8'));
    const codes = actionFindings(sk, 'run').map(f => f.code);
    for (const code of ['stop-start', 'constant-lean']) assert.ok(codes.includes(code), `${code} missing from ${codes}`);
    // Upright, the hips drop exactly as far as the legs swing up: a foot is always on the ground.
    const grounded = stride('smooth');
    delete grounded.bones.body.rotate;
    const g = await call('write_animation', { from: 'hero.json', animation: 'run', clip: grounded, replace: true });
    const walked = actionFindings(JSON.parse(fs.readFileSync(path.join(dir, g.file), 'utf8')), 'run').map(f => f.code);
    assert.ok(walked.includes('no-flight') && !walked.includes('constant-lean'), `${walked}`);
    const smooth = await call('write_animation', { from: 'hero.json', animation: 'run', clip: stride('smooth'), replace: true });
    const flowing = actionFindings(JSON.parse(fs.readFileSync(path.join(dir, smooth.file), 'utf8')), 'run').map(f => f.code);
    assert.ok(!flowing.includes('stop-start'), `a smooth cycle flows: ${flowing}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
