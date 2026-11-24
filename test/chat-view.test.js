// What each kind of message shows in the conversation: the owner's words in a bubble, the AI's
// words under its name, and on a delivered result the check, the file, the notes and the ways back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAX_NOTES, SUGGESTIONS, checkChip, messageView, whenText } from '../web/chat-view.js';

const en = JSON.parse(fs.readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));
const tr = JSON.parse(fs.readFileSync(new URL('../locale/tr.json', import.meta.url), 'utf8'));
const TIME = '2026-11-24T10:00:00.000Z';

test('the owner\'s message is a bubble with the words only', () => {
  const view = messageView({ id: 1, from: 'owner', text: 'Make her jump.', time: TIME }, { name: 'Claude Code' });
  assert.deepEqual(view, { kind: 'you', text: 'Make her jump.', time: TIME });
});

test('an AI message carries the AI\'s name and the time, and no card', () => {
  const view = messageView({ id: 2, from: 'agent', text: 'On it.', time: TIME, work: 'writing' }, { name: 'Codex' });
  assert.deepEqual(view, { kind: 'ai', text: 'On it.', time: TIME, name: 'Codex' });
  assert.equal(messageView({ from: 'agent', text: 'x', work: 'ready' }).kind, 'ai', 'ready without a file is a plain message');
  assert.equal(messageView({ from: 'agent', text: 'x' }).time, null);
});

test('a delivered result shows its file and clip, and up to three notes', () => {
  const message = { id: 3, from: 'agent', text: 'Done.', time: TIME, work: 'ready', file: 'out/mika_v3.json', animation: 'happy_in',
    notes: ['Anticipation: 3 frames', '  ', 'Tails overlap', 7, 'Ends on the pose', 'one too many'] };
  const view = messageView(message, { name: 'Claude Code' });
  assert.equal(view.kind, 'result');
  assert.equal(view.result.file, 'mika_v3.json', 'the file\'s name, not its folder');
  assert.equal(view.result.animation, 'happy_in');
  assert.deepEqual(view.result.notes, ['Anticipation: 3 frames', 'Tails overlap', 'Ends on the pose']);
  assert.equal(view.result.notes.length, MAX_NOTES);
  assert.equal(view.result.chip, null, 'a file not on the stage has no check here');
  assert.equal(view.result.actions, false);
});

test('the newest result on the stage shows its check and the ways back', () => {
  const message = { id: 4, from: 'agent', text: 'Done.', work: 'ready', file: 'out/mika_v3.json' };
  const on = (check, latest = true) => messageView(message, { shown: 'out/mika_v3.json', check, latest }).result;
  assert.deepEqual(on({ opens: true }).chip, { tone: 'ok', key: 'delivery.chipOk', icon: 'i-check' });
  assert.equal(on({ opens: false, findings: [] }).chip.key, 'delivery.chipBad');
  assert.equal(on({ failed: 'timeout' }).chip.key, 'delivery.chipFailed');
  assert.equal(on(null).chip, null, 'a check still running shows no chip yet');
  assert.equal(on({ opens: true }).actions, true);
  assert.equal(on({ opens: true }, false).actions, false, 'an older result has no Undo');
  assert.equal(messageView(message, { shown: 'other.json', latest: true }).result.actions, false);
  assert.equal(on({ opens: true }).notes.length, 0);
  assert.equal(checkChip(undefined), null);
});

test('times read the way a person says them, in the page\'s language', () => {
  const now = Date.parse(TIME);
  assert.equal(whenText(TIME, now + 10_000, 'en'), 'now');
  assert.equal(whenText(TIME, now + 120_000, 'en'), '2 minutes ago');
  assert.equal(whenText(TIME, now + 50_000, 'en'), '1 minute ago');
  assert.equal(whenText(TIME, now + 3 * 3600_000, 'en'), '3 hours ago');
  assert.equal(whenText(TIME, now + 86_400_000, 'en'), 'yesterday');
  assert.notEqual(whenText(TIME, now + 120_000, 'tr'), whenText(TIME, now + 120_000, 'en'), 'the other language says it its own way');
  assert.equal(whenText(null, now), '');
  assert.equal(whenText('not a time', now), '');
});

test('every label the conversation uses is in both languages', () => {
  const keys = ['chat.aiName', 'chat.undo', 'stage.showSource', 'steps.showing', 'delivery.chipOk', 'delivery.chipBad', 'delivery.chipFailed',
    ...SUGGESTIONS.flatMap(s => [s.label, s.fill])];
  for (const key of keys) {
    assert.ok(en[key], `en ${key}`);
    assert.ok(tr[key], `tr ${key}`);
  }
  assert.equal(en['steps.showing'], 'Showing');
  assert.deepEqual(SUGGESTIONS.map(s => en[s.label]), ['Slower', 'More bounce', 'Make it loop']);
});

test('the page draws messages from these views', () => {
  const chat = fs.readFileSync(new URL('../web/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /messageView\(message/);
  assert.match(chat, /i-spark/);
  assert.match(chat, /msg \$\{view\.kind === 'you' \? 'you' : 'ai'\}/);
  assert.match(fs.readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8'), /'\/web\/chat-view\.js'/);
});

test('the live row: what the director is doing, for how long, and the answer so far; stopped turns read as stopped', async () => {
  const { liveView, elapsedText, LIVE_PHASES, phaseText } = await import('../web/chat-view.js');
  assert.equal(liveView(null), null);
  assert.equal(liveView({ slots: [{ id: 'director', status: 'ready' }] }), null, 'idle shows nothing');
  const view = liveView({ slots: [{ id: 'director', status: 'working', live: { phase: 'reading', tool: 'read_rig', seconds: 12.4, text: 'Looking' } }] });
  assert.deepEqual(view, { phaseKey: 'chat.live.reading', tool: 'read_rig', last: null, steps: 0, seconds: 12, text: 'Looking' });
  // Between tools a long think says which step was done last, never a bare "Thinking".
  const tt = (key, v = {}) => `${key}${Object.keys(v).length ? JSON.stringify(v) : ''}`;
  const between = liveView({ slots: [{ id: 'director', status: 'working', live: { phase: 'thinking', tool: null, last: 'write_animation', steps: 3, seconds: 40 } }] });
  assert.equal(phaseText(between, tt), 'chat.live.thinking · chat.live.after{"tool":"write_animation","steps":3}');
  assert.equal(phaseText(view, tt), 'chat.live.reading · read_rig');
  assert.equal(liveView({ slots: [{ id: 'director', status: 'working', live: { phase: 'nonsense' } }] }).phaseKey, 'chat.live.working');
  assert.deepEqual([elapsedText(5), elapsedText(65)], ['5 s', '1 min 05 s']);
  const en = JSON.parse(fs.readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));
  const tr = JSON.parse(fs.readFileSync(new URL('../locale/tr.json', import.meta.url), 'utf8'));
  for (const p of LIVE_PHASES) assert.ok(en[`chat.live.${p}`] && tr[`chat.live.${p}`], p);
  assert.ok(en['chat.stop'] && en['chat.stopped'] && en['chat.live.after'] && tr['chat.live.after']);
  assert.deepEqual(messageView({ from: 'agent', text: 'Stopped.', stopped: true }, { name: 'Claude Code' }).stopped, true);
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="stopAgent"/);
  assert.match(fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'), /stopAgent\.addEventListener\('click', stopAgent\)/);
});
