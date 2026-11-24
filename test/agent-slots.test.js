// The slots: one agent per slot, a director always first, the list kept in the studio config
// beside the projects, and each slot's session kept per project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSlots, readSlots, writeSlots, defaultSlots, sessionFor, saveSession, MAX_SLOTS, MAX_BRIEF } from '../src/agent/slots.js';
import { isStudioError } from '../src/shared/errors.js';

const refused = (input, pattern) => assert.throws(() => validateSlots(input), err => isStudioError(err, 'bad-slots') && pattern.test(err.message), JSON.stringify(input));

test('a valid list is filled in with defaults and the director comes first', () => {
  const slots = validateSlots([
    { id: 'look', role: 'illustrator', agent: 'gemini' },
    { id: 'director', role: 'director', agent: 'claude-code', brief: '  Keep replies short.  ' },
    { id: 'refs', role: 'researcher', agent: null, tools: ['read_rig', 'read_rig', 'see_reference'] },
  ]);
  assert.deepEqual(slots.map(s => s.id), ['director', 'look', 'refs']);
  assert.deepEqual(slots[0], { id: 'director', role: 'director', agent: 'claude-code', tools: 'studio', brief: 'Keep replies short.' });
  assert.equal(slots[1].tools, 'read', 'a role other than the director reads by default');
  assert.deepEqual(slots[2].tools, ['read_rig', 'see_reference']);
});

test('the list is refused whole: director required, unique ids, known agents and tools', () => {
  refused([], /non-empty/);
  refused('director', /non-empty/);
  refused([{ id: 'look', role: 'illustrator', agent: null }], /"director" slot is required/);
  refused([{ id: 'director', role: 'director' }, { id: 'director', role: 'director' }], /used twice/);
  refused([{ id: 'director', role: 'illustrator' }], /director role/);
  refused([{ id: 'director', role: 'director' }, { id: 'x', role: 'director' }], /Only the "director"/);
  refused([{ id: 'director', role: 'director', agent: 'chatgpt' }], /"agent" is one of claude-code, codex, gemini or null/);
  refused([{ id: 'Director', role: 'director' }], /"id"/);
  refused([{ id: 'director', role: 'Lead Animator' }], /"role"/);
  refused([{ id: 'director', role: 'director', tools: 'everything' }], /"tools"/);
  refused([{ id: 'director', role: 'director', tools: ['write_animation', 'rm_rf'] }], /unknown tools rm_rf/);
  refused([{ id: 'director', role: 'director', tools: ['wait_for_message'] }], /unknown tools wait_for_message/);
  refused([{ id: 'director', role: 'director', tools: [] }], /empty list/);
  refused([{ id: 'director', role: 'director', brief: 'x'.repeat(MAX_BRIEF + 1) }], /brief/);
  refused([{ id: 'director', role: 'director', model: '--dangerously-skip' }], /"model"/);
  refused([{ id: 'director', role: 'director', model: 'son net' }], /"model"/);
  assert.equal(validateSlots([{ id: 'director', role: 'director', model: 'claude-sonnet-4-5' }])[0].model, 'claude-sonnet-4-5');
  assert.equal(validateSlots([{ id: 'director', role: 'director', model: '' }])[0].model, '', "'' keeps the agent's own default");
  refused([{ id: 'director', role: 'director' }, ...Array.from({ length: MAX_SLOTS }, (_, i) => ({ id: `s${i}`, role: 'helper' }))], /At most/);
  refused([null], /object/);
});

test('slots are saved in the studio config beside the projects; a broken saved list falls back to the default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-slots-'));
  const file = path.join(dir, 'studio.config.json');
  try {
    assert.deepEqual(readSlots(file), defaultSlots(), 'nothing saved: a director with no agent');
    fs.writeFileSync(file, JSON.stringify({ projects: [{ dir: '/p' }], current: '/p' }));
    writeSlots([{ id: 'director', role: 'director', agent: 'codex' }], file);
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(config.projects, [{ dir: '/p' }], 'the project registry is kept');
    assert.equal(config.agentSlots[0].agent, 'codex');
    assert.equal(readSlots(file)[0].agent, 'codex');
    fs.writeFileSync(file, JSON.stringify({ agentSlots: [{ id: 'oops' }] }));
    assert.deepEqual(readSlots(file), defaultSlots());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a session is resumed only in its own project and only by the CLI that made it', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-sess-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-sess-b-'));
  try {
    assert.equal(sessionFor(a, 'director', 'claude-code'), null);
    saveSession(a, 'director', 'claude-code', 's-1');
    assert.equal(sessionFor(a, 'director', 'claude-code'), 's-1');
    assert.equal(sessionFor(a, 'director', 'codex'), null, 'another CLI starts fresh');
    assert.equal(sessionFor(b, 'director', 'claude-code'), null, 'another project starts fresh');
    saveSession(a, 'director', 'claude-code', null);
    assert.equal(sessionFor(a, 'director', 'claude-code'), null);
    fs.writeFileSync(path.join(a, '.keyframe', 'agent-sessions.json'), 'torn');
    assert.equal(sessionFor(a, 'director', 'claude-code'), null, 'an unreadable store is no session, not a crash');
  } finally { for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true }); }
});
