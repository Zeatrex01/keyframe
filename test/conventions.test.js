// Gate for the three findings of the first real-agent session (2026-11-24): a blink written by
// showing the closed lid alone (the rig also hides the eye and pupil), a critique that called a
// clip without bone motion "good" on an empty measurement, and an agent that skipped PROVE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rigConventions, conventionFindings } from '../src/understand/conventions.js';
import { critiqueAnimation, clipDuration } from '../src/understand/critique.js';
import { readRig } from '../src/understand/read-rig.js';
import { createServer } from '../src/mcp/server.js';

const blinkOf = (time, hideEyes) => ({ slots: {
  lid: { attachment: [{ name: null }, { time, name: 'lid_closed' }, { time: time + 0.1, name: null }] },
  ...(hideEyes ? {
    eye: { attachment: [{ name: 'eye' }, { time, name: null }, { time: time + 0.1, name: 'eye' }] },
    pupil: { attachment: [{ name: 'pupil' }, { time, name: null }, { time: time + 0.1, name: 'pupil' }] },
  } : {}),
} });

// A face whose own clips always hide the eye and pupil under the closed lid.
const face = extra => ({
  skeleton: { spine: '4.2.43' },
  bones: [{ name: 'root' }, { name: 'head', parent: 'root', length: 10 }],
  slots: [{ name: 'eye', bone: 'head', attachment: 'eye' }, { name: 'pupil', bone: 'head', attachment: 'pupil' }, { name: 'lid', bone: 'head' }],
  skins: [{ name: 'default', attachments: {
    eye: { eye: { width: 10, height: 10 } }, pupil: { pupil: { width: 4, height: 4 } }, lid: { lid_closed: { width: 10, height: 10 } },
  } }],
  animations: { idle: blinkOf(1.2, true), sleepy: blinkOf(0.5, true), wake: blinkOf(0.3, true), ...extra },
});

test('the rig conventions are mined from the owner\'s clips; a pose at time 0 does not vote', () => {
  const sk = face();
  assert.deepEqual(rigConventions(sk), [{ slot: 'lid', attachment: 'lid_closed',
    alsoSets: [{ slot: 'eye', attachment: null }, { slot: 'pupil', attachment: null }], inBetweens: [], occurrences: 3, clips: ['idle', 'sleepy', 'wake'] }]);
  // Two clips are not enough evidence for a rule.
  assert.deepEqual(rigConventions({ ...sk, animations: { idle: blinkOf(1, true), b: blinkOf(2, true) } }), []);
  // Time-0 poses: every slot is keyed together, which says nothing about a transition.
  const poses = Object.fromEntries(['a', 'b', 'c'].map(n => [n, blinkOf(0, true)]));
  assert.deepEqual(rigConventions({ ...sk, animations: poses }), []);
});

test('a half blink (lid shown, eye left visible) is named, with the keys that fix it', () => {
  const sk = face({ blink_twice: blinkOf(0.4, false) });
  const [f] = conventionFindings(sk, 'blink_twice');
  assert.equal(f.code, 'rig-convention');
  assert.equal(f.severity, 'weak', 'art showing through a closed lid is a fault, not taste');
  assert.deepEqual(f.measure.missing, [{ slot: 'eye', attachment: null }, { slot: 'pupil', attachment: null }]);
  assert.match(f.fix, /eye to null \(hidden\), pupil to null \(hidden\) at 0\.4 s/);
  assert.doesNotMatch(f.fix, /softer/, 'no in-between in this rig');
  // A rig whose clips pass through a half-closed lid offers it for a softer blink.
  const soft = { lid: { attachment: [{ name: null }, { time: 0.3, name: 'lid_half' }, { time: 0.35, name: 'lid_closed' }, { time: 0.45, name: 'lid_half' }, { time: 0.5, name: null }] },
    eye: { attachment: [{ name: 'eye' }, { time: 0.35, name: null }, { time: 0.45, name: 'eye' }] },
    pupil: { attachment: [{ name: 'pupil' }, { time: 0.35, name: null }, { time: 0.45, name: 'pupil' }] } };
  const halfRig = face({ sleepy: { slots: soft } });
  assert.deepEqual(rigConventions(halfRig).find(c => c.attachment === 'lid_closed').inBetweens, ['lid_half']);
  assert.match(conventionFindings({ ...halfRig, animations: { ...halfRig.animations, quick: blinkOf(0.2, false) } }, 'quick')[0].fix, /pass through lid_half/);
  // Notes that ask for nothing are level info, not warn.
  const info = critiqueAnimation(face({ swap: blinkOf(0.4, true) }), 'swap').findings.find(x => x.code === 'no-bone-motion');
  assert.equal(info.level, 'info');
  assert.deepEqual(conventionFindings(face({ blink_twice: blinkOf(0.4, true) }), 'blink_twice'), [], 'a full blink passes');
  // The critique carries it and stops calling the clip good.
  const r = critiqueAnimation(sk, 'blink_twice');
  assert.ok(r.findings.some(x => x.code === 'rig-convention'));
  assert.equal(r.verdict, 'mechanical');
  // read_rig lists the rule so the agent can follow it before writing.
  const rig = readRig(face());
  assert.deepEqual(rig.conventions, [{ when: { slot: 'lid', attachment: 'lid_closed' }, alsoSets: { eye: null, pupil: null }, seenIn: ['idle', 'sleepy', 'wake'] }]);
  assert.match(rig.conventionsNote, /describe_animation/);
});

test('a clip that only swaps attachments has a duration, counts its slot timelines and is never "good" on nothing', () => {
  const sk = face({ swap: blinkOf(0.4, true) });
  const r = critiqueAnimation(sk, 'swap');
  assert.equal(r.measures.duration, 0.5);
  assert.equal(r.measures.slotChannels, 3);
  assert.equal(r.measures.movingChannels, 0);
  assert.equal(r.verdict, 'unmeasured');
  assert.ok(r.findings.some(x => x.code === 'no-bone-motion' && /see_animation/.test(x.params.fix)));
  const empty = critiqueAnimation({ ...sk, animations: { nothing: {} } }, 'nothing');
  assert.equal(empty.verdict, 'unmeasured');
  assert.match(empty.findings.find(x => x.code === 'no-bone-motion').message, /no keys at all/);
  assert.equal(clipDuration({ drawOrder: [{ time: 2 }], events: [{ time: 3, name: 'e' }] }), 3);
});

test('write_animation answers with the PROVE calls and the conventions it breaks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-prove-'));
  try {
    fs.writeFileSync(path.join(dir, 'face.json'), JSON.stringify(face()));
    const sent = [];
    const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m) });
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_animation', arguments: { animation: 'blink_twice', clip: blinkOf(0.4, false) } } });
    const result = sent[0].result.structuredContent;
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(result.prove.required, true);
    assert.deepEqual(result.prove.calls.map(c => c.tool), ['check_skeleton', 'critique_animation', 'see_animation']);
    assert.deepEqual(result.prove.calls[1].arguments, { file: result.file, animation: 'blink_twice' });
    assert.equal(result.duration, 0.5, 'the clip length comes up front');
    assert.deepEqual(result.prove.calls[2].arguments.times, [0, 0.4, 0.5], 'looks at the switch moments, never past the end');
    assert.equal(result.conventions[0].severity, 'weak');
    assert.match(result.conventions[0].message, /lid shows lid_closed at 0\.4 s/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('start_here tells the agent to read a similar clip first and to run the PROVE calls', async () => {
  const { default: startHere } = await import('../src/mcp/tools/start-here.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-start-'));
  try {
    const out = await startHere.run({}, { session: { dir, writable: () => true } });
    const text = JSON.stringify(out);
    assert.match(text, /read a similar clip/);
    assert.match(text, /conventions/);
    assert.match(text, /check_skeleton, critique_animation, see_animation/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
