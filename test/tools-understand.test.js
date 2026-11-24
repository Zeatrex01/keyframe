// The seeing tools through the wire: start_here, read, sample, describe, critique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp/server.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-tools-see-'));
  for (const ext of ['json', 'atlas']) fs.copyFileSync(new URL(`ident.${ext}`, FIXTURE), path.join(dir, `logo.${ext}`));
  fs.copyFileSync(new URL('ident.png', FIXTURE), path.join(dir, 'ident.png'));
  for (const [name, json] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), JSON.stringify(json));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', all: true, write: m => sent.push(m) });
  let id = 0;
  const call = async (name, args = {}) => {
    await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    return sent.find(m => m.id === id).result.structuredContent;
  };
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'logo.json'), 'utf8'));
  return { dir, call, base, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('start_here points at read_rig first, then at the delivery once one exists', async () => {
  const p = setup();
  try {
    const first = await p.call('start_here');
    assert.deepEqual(first.steps.map(s => s.step), ['SEE', 'WRITE', 'PROVE', 'DELIVER']);
    assert.equal(first.next.tool, 'read_rig');
    assert.deepEqual(first.next.args, { file: 'logo.json' });
    const clip = { bones: { [p.base.bones[1].name]: { rotate: [{ value: 0 }, { time: 1, value: 5 }] } } };
    await p.call('write_animation', { animation: 'w', clip });
    const second = await p.call('start_here');
    assert.equal(second.next.tool, 'describe_animation');
    assert.equal(second.next.args.file, 'logo_v2.json');
    for (const step of second.steps) {
      for (const tool of step.tools) assert.equal((await p.call('help', { tool })).name, tool, `${tool} exists`);
    }
  } finally { p.cleanup(); }
});

test('read_rig and read_animation read the real file', async () => {
  const p = setup();
  try {
    const rig = await p.call('read_rig');
    assert.equal(rig.error, undefined, JSON.stringify(rig.error));
    assert.equal(rig.file, 'logo.json');
    const anyAnimation = Object.keys(p.base.animations)[0];
    const anim = await p.call('read_animation', { animation: anyAnimation });
    assert.equal(anim.error, undefined, JSON.stringify(anim.error));
    assert.equal((await p.call('read_animation', { animation: 'nope' })).error.code, 'unknown-animation');
  } finally { p.cleanup(); }
});

test('sample_animation returns engine-exact poses with constraints applied', async () => {
  const ik = {
    skeleton: { spine: '4.2.43', hash: 'ik' },
    bones: [{ name: 'root' }, { name: 'upper', parent: 'root', length: 50 }, { name: 'lower', parent: 'upper', length: 50, x: 50 },
      { name: 'target', parent: 'root', x: 100 }, { name: 'idle', parent: 'root' }],
    ik: [{ name: 'reach', bones: ['upper', 'lower'], target: 'target' }],
    animations: { lift: { bones: { target: { translate: [{ x: 0, y: 0 }, { time: 1, x: -40, y: 60 }] } } } },
  };
  const p = setup({ 'arm.json': ik });
  try {
    const result = await p.call('sample_animation', { file: 'arm.json', animation: 'lift' });
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(result.samples.length, 5);
    const end = result.samples[4];
    const bend = Math.acos((60 * Math.SQRT2) / 100) * 180 / Math.PI;
    assert.ok(Math.abs(end.bones.upper.applied.rotation - (45 - bend)) < 0.01, 'IK resolved in the applied transform');
    assert.equal(end.bones.upper.local.rotation, 0, 'the keyed local value is untouched');
    assert.ok(!('idle' in end.bones), 'bones that never move are left out by default');
    assert.ok('target' in end.bones);
  } finally { p.cleanup(); }
});

test('describe_animation speaks in sentences; critique gives a verdict; critique_rig reads the rig', async () => {
  const p = setup();
  try {
    const all = await p.call('describe_animation');
    assert.equal(all.animations.length, Object.keys(p.base.animations).length);
    const name = Object.keys(p.base.animations)[0];
    const one = await p.call('describe_animation', { animation: name });
    assert.equal(typeof one.summary, 'string');
    assert.ok(one.summary.length > 20);
    assert.ok(one.quality.verdict);
    const critique = await p.call('critique_animation', { animation: name });
    assert.ok(['good', 'mechanical', 'faulty'].includes(critique.verdict));
    const rig = await p.call('critique_rig');
    assert.equal(rig.error, undefined, JSON.stringify(rig.error));
  } finally { p.cleanup(); }
});
