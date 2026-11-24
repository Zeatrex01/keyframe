// ask_team: the Director's hand-off to a helper slot, through the project folder (src/core/team.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askTeamTool } from '../src/mcp/tools/team.js';
import { postAsk, takeAsks, answerAsk, waitAnswer } from '../src/core/team.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kf-team-'));
const code = async (promise) => { try { await promise; return null; } catch (err) { return /** @type {any} */ (err).code; } };

test('an ask is taken once and answered once', async () => {
  const dir = temp();
  try {
    const id = postAsk(dir, { slot: 'art-director', task: 'redraw the chest' });
    const [ask] = takeAsks(dir);
    assert.deepEqual(ask, { id, slot: 'art-director', task: 'redraw the chest' });
    assert.deepEqual(takeAsks(dir), [], 'a second reader finds nothing');
    answerAsk(dir, id, { ok: true, text: 'done' });
    assert.deepEqual(await waitAnswer(dir, id, { timeoutMs: 1000 }), { ok: true, text: 'done' });
    assert.deepEqual(fs.readdirSync(path.join(dir, '.keyframe', 'team')), []);
    // Nobody takes it: the ask is withdrawn when the time runs out.
    const late = postAsk(dir, { slot: 'x', task: 'y' });
    assert.equal(await waitAnswer(dir, late, { timeoutMs: 100, pollMs: 20 }), null);
    assert.deepEqual(takeAsks(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ask_team returns the helper\'s answer, and refuses without a team or for a stranger', async () => {
  const dir = temp();
  try {
    const session = { dir, writable: () => true, team: [{ id: 'senior-animator', role: 'senior-animator' }] };
    // The hub's side: take the ask and answer it.
    const hub = setInterval(() => { for (const ask of takeAsks(dir)) answerAsk(dir, ask.id, { ok: true, text: `did: ${ask.task}`, tools: 3 }); }, 20);
    try {
      const out = await askTeamTool.run({ slot: 'senior-animator', task: ' polish the jump ' }, { session });
      assert.deepEqual([out.slot, out.role, out.answer, out.toolCalls], ['senior-animator', 'senior-animator', 'did: polish the jump', 3]);
    } finally { clearInterval(hub); }
    assert.equal(await code(askTeamTool.run({ slot: 'art-director', task: 'x' }, { session })), 'unknown-slot');
    assert.equal(await code(askTeamTool.run({ slot: 'senior-animator', task: 'x' }, { session: { dir, writable: () => true } })), 'no-team');
    // A helper that fails says so.
    const failing = setInterval(() => { for (const ask of takeAsks(dir)) answerAsk(dir, ask.id, { ok: false, code: 'agent-busy', message: 'still working' }); }, 20);
    try { assert.equal(await code(askTeamTool.run({ slot: 'senior-animator', task: 'x' }, { session })), 'agent-busy'); } finally { clearInterval(failing); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
