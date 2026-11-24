// Gate for Phase 3: the studio proposes what a skeleton is and what each clip is for, the agent
// confirms it in the brief, and critique_animation judges by it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifySubject, intentOf, proposeBrief, validateBrief, critiqueOptions } from '../src/understand/subject.js';
import { critiqueAnimation } from '../src/understand/critique.js';
import { createServer } from '../src/mcp/server.js';

const rig = (names, extra = {}) => ({ skeleton: { spine: '4.2.43', height: 400 },
  bones: names.map((name, i) => ({ name, ...(i ? { parent: names[Math.max(0, i - 1)] } : {}) })), slots: [], animations: {}, ...extra });

test('the subject is read from the rig: names, hierarchy, blend modes', () => {
  assert.equal(classifySubject(rig(['root', 'hips', 'torso', 'chest', 'neck', 'head', 'arm_l', 'hand_l', 'leg_r', 'foot_r'])).subject, 'character');
  assert.equal(classifySubject(rig(['root', 'body', 'head', 'ear_l', 'tail1', 'tail2', 'paw_fl'])).subject, 'creature');
  assert.equal(classifySubject(rig(['root', 'button', 'label', 'icon'])).subject, 'ui');
  const fx = rig(['root', 'spark1', 'spark2', 'glow', 'ring'], { slots: ['spark1', 'spark2', 'glow'].map(n => ({ name: n, bone: n, blend: 'additive' })) });
  fx.bones = fx.bones.map((b, i) => (i ? { ...b, parent: 'root' } : b));
  assert.equal(classifySubject(fx).subject, 'vfx');
  assert.equal(classifySubject(rig(['root', 'base', 'lid', 'lock'])).subject, 'prop');
  const c = classifySubject(rig(['root', 'hips', 'torso', 'head', 'arm_l', 'leg_l']));
  assert.ok(c.confidence > 0.5 && c.evidence.includes('head'));
});

test('a clip\'s intent comes from its name', () => {
  assert.deepEqual(['idle', 'walk_cycle', 'attack', 'hit', 'popup_in', 'reward_burst', 'xyz'].map(intentOf),
    ['idle', 'loop', 'action', 'reaction', 'transition', 'reward', null]);
});

test('the proposal and the confirmed brief carry display size, loops and the subject preset', () => {
  const sk = rig(['root', 'button', 'label'], { animations: { press: {}, idle: {} } });
  const proposal = proposeBrief(sk);
  assert.equal(proposal.subject, 'ui');
  assert.deepEqual(proposal.clips, [{ name: 'press', intent: 'action', loop: false }, { name: 'idle', intent: 'idle', loop: true }]);
  assert.equal(proposal.display.pixelsPerUnit, 0.3, '120 px for a 400-unit rig');
  assert.ok(proposal.timing.some(t => t.clip === 'button press / release'));
  const { problems } = validateBrief({ subject: 'robot', clips: [{ name: 'x', intent: 'dance' }] }, sk);
  assert.equal(problems.length, 2);
  const { brief } = validateBrief({ subject: 'ui', clips: [{ name: 'press', seconds: 0.2 }, { name: 'shine', intent: 'loop' }], display: { height: 80 } }, sk);
  assert.deepEqual(brief.clips.map(c => [c.name, c.intent, c.loop, c.planned]), [['press', 'action', false, false], ['shine', 'loop', true, true]]);
  assert.equal(brief.display.pixelsPerUnit, 0.2);
  assert.deepEqual(critiqueOptions(brief, 'shine'), { subject: 'ui', loop: true, pixelsPerUnit: 0.2, skip: ['twinning', 'no-overlap', 'no-anticipation'] });
});

test('critique_animation leaves out the checks a subject\'s brief says do not apply', () => {
  const sk = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }, { name: 'arm_l', parent: 'root' }, { name: 'arm_r', parent: 'root' }], slots: [],
    animations: { wave: { bones: {
      arm_l: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 30 }, { time: 1, value: 0 }] },
      arm_r: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 30 }, { time: 1, value: 0 }] },
    } } } };
  const plain = critiqueAnimation(sk, 'wave').findings.map(f => f.code);
  assert.ok(plain.includes('twinning'), plain.join());
  const tuned = critiqueAnimation(sk, 'wave', { skip: ['twinning'] });
  assert.ok(!tuned.findings.some(f => f.code === 'twinning'));
  assert.deepEqual(tuned.measures.skipped, ['twinning']);
});

test('the brief tool proposes, stores, and critique_animation reads it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-brief-'));
  const sk = { skeleton: { spine: '4.2.43', height: 100 }, bones: [{ name: 'root' }, { name: 'button', parent: 'root' }], slots: [],
    animations: { pulse: { bones: { button: { scale: [{ time: 0, x: 1, y: 1 }, { time: 0.5, x: 1.3, y: 1.3 }, { time: 1, x: 1.1, y: 1.1 }] } } } } };
  fs.writeFileSync(path.join(dir, 'btn.json'), JSON.stringify(sk));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
  let id = 0;
  const call = async (name, args = {}) => { await wire.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); return sent.find(m => m.id === id).result.structuredContent; };
  try {
    const proposal = await call('brief', {});
    assert.equal(proposal.stored, false);
    assert.equal(proposal.brief.subject, 'ui');
    const before = await call('critique_animation', { animation: 'pulse' });
    assert.ok(!before.findings.some(f => f.code === 'loop-seam'), 'not a loop by its name');
    const stored = await call('brief', { brief: { subject: 'ui', clips: [{ name: 'pulse', intent: 'loop' }] } });
    assert.equal(stored.stored, true);
    assert.ok(fs.existsSync(path.join(dir, '.keyframe', 'brief.json')));
    assert.equal((await call('brief', {})).brief.subject, 'ui');
    const after = await call('critique_animation', { animation: 'pulse' });
    assert.equal(after.brief.subject, 'ui');
    assert.ok(after.findings.some(f => f.code === 'loop-seam'), 'the brief says it loops: its seam pops');
    assert.equal((await call('brief', { brief: { subject: 'toaster' } })).error.code, 'bad-argument');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
