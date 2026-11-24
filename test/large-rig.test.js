// A rig of 240 bones (eight chains of thirty) goes through read, write, check and critique in
// well under a second each: the tools do not slow down on a large character.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp/server.js';

const LIMIT_MS = 1500;   // generous for slow machines; the tools take tens of milliseconds today

function bigRig() {
  const bones = [{ name: 'root' }];
  for (let c = 0; c < 8; c++) {
    for (let i = 0; i < 30; i++) {
      bones.push({ name: `t${c}_${i}`, parent: i ? `t${c}_${i - 1}` : 'root', x: i ? 10 : 0, rotation: i ? 0 : c * 45, length: 10 });
    }
  }
  return {
    skeleton: { hash: 'large-rig', spine: '4.2.43', width: 600, height: 600 },
    bones,
    slots: bones.slice(1).map((b) => ({ name: b.name, bone: b.name })),
    skins: [{ name: 'default', attachments: {} }],
    animations: { idle: { bones: { t0_1: { rotate: [{ value: 0 }, { time: 1, value: 10 }] } } } },
  };
}

test('a 240-bone rig is read, written, checked and critiqued quickly', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-large-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rig = bigRig();
  assert.equal(rig.bones.length, 241);
  fs.writeFileSync(path.join(dir, 'big.json'), JSON.stringify(rig));

  /** @type {any[]} */
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: (m) => sent.push(m), all: true });
  const call = async (/** @type {string} */ name, /** @type {object} */ args) => {
    sent.length = 0;
    const start = performance.now();
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const ms = performance.now() - start;
    const result = sent[0].result;
    const value = result.structuredContent ?? JSON.parse(result.content.find((/** @type {any} */ c) => c.type === 'text')?.text ?? '{}');
    assert.ok(!result.isError, `${name}: ${JSON.stringify(value).slice(0, 300)}`);
    assert.ok(ms < LIMIT_MS, `${name} took ${Math.round(ms)} ms`);
    return value;
  };

  const read = await call('read_rig', { file: 'big.json' });
  assert.match(JSON.stringify(read), /t7_29/, 'the last bone of the last chain is read');

  const sway = Object.fromEntries(rig.bones.slice(1).map((b, i) => [b.name, {
    rotate: [{ value: 0, curve: 'inOutSine' }, { time: 0.5, value: 8 * Math.sin(i), curve: 'inOutSine' }, { time: 1, value: 0 }],
  }]));
  const written = await call('write_animation', { from: 'big.json', animation: 'sway', clip: { bones: sway } });
  assert.ok(written.file, 'a delivery file is written');
  const out = JSON.parse(fs.readFileSync(path.join(dir, written.file), 'utf8'));
  assert.equal(Object.keys(out.animations.sway.bones).length, 240, 'every bone is keyed');

  const checked = await call('check_skeleton', { file: written.file });
  assert.equal(checked.fatal, 0, 'no fatal finding');
  assert.equal(checked.runtime.opens, true, 'the engine opens it');
  await call('critique_animation', { file: written.file, animation: 'sway' });
});
