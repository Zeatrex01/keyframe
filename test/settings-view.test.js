// Settings: a section nav that scrolls to its sections, the AI connection (the embedded agent's
// slots when the studio runs one, the external MCP instructions always), add-ons, appearance, about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SLOT_ROLES, changeSlots, isRunning, orderSlots, rolesToAdd, slotsForSave, slotAction } from '../web/agent-rules.js';

const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const en = JSON.parse(fs.readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));
const tr = JSON.parse(fs.readFileSync(new URL('../locale/tr.json', import.meta.url), 'utf8'));
const settings = html.slice(html.indexOf('<section class="view" id="settings"'), html.indexOf('</section>\n', html.indexOf('id="setAbout"')));

test('the section nav names four sections, in order, and each exists', () => {
  const nav = settings.slice(settings.indexOf('id="settingsNav"'), settings.indexOf('</nav>'));
  const targets = [...nav.matchAll(/data-section="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(targets, ['setAi', 'setAddons', 'setLook', 'setAbout']);
  for (const id of targets) assert.match(settings, new RegExp(`<section class="panel sec" id="${id}"`), id);
  assert.doesNotMatch(nav, /<a /, 'buttons, not hash links: the hash names the view');
  assert.deepEqual([...nav.matchAll(/data-i18n="([\w.]+)"/g)].map(m => en[m[1]]), ['Settings', 'AI connection', 'Add-ons', 'Appearance and language', 'About']);
  const views = fs.readFileSync(new URL('../web/views.js', import.meta.url), 'utf8');
  assert.match(views, /scrollIntoView\(/);
});

test('the AI connection keeps the external instructions and the slots for an embedded agent', () => {
  for (const id of ['agentSlots', 'slotList', 'slotAdd', 'externalTitle', 'settingsClient', 'clientCode', 'clientJson', 'checkButton']) assert.match(settings, new RegExp(`id="${id}"`), id);
  assert.deepEqual([...settings.matchAll(/data-client="(\w+)"/g)].map(m => m[1]), ['claudeCommand', 'claudeDesktop', 'codexToml', 'claudeJson']);
  assert.equal(en['settings.externalTitle'], 'Or connect any MCP client');
  const slots = fs.readFileSync(new URL('../web/agent-slots.js', import.meta.url), 'utf8');
  assert.match(slots, /fetch\('\/api\/agent'/);
  assert.match(slots, /response\.ok \? await response\.json\(\) : null/, 'a 404 leaves only the external instructions');
  assert.match(slots, /'\/api\/agent\/slots'/);
  assert.match(slots, /!S\.settings\.embeddedAgent/, 'a studio without an embedded agent is not asked for one');
  assert.match(fs.readFileSync(new URL('../src/server/http.js', import.meta.url), 'utf8'), /embeddedAgent: 'GET \/api\/agent' in routes/);
  assert.match(slots, /'\/api\/agent\/stop', \{ slot: slot\.id \}/);
  assert.match(settings, /id="spineToggle"/, 'the Spine add-on block stays');
  assert.match(settings, /id="spineAccept"/);
});

test('slots: the Director first and always there, one slot per helper role', () => {
  assert.deepEqual(orderSlots(undefined).map(s => s.id), ['director']);
  const slots = [{ id: 'researcher', role: 'researcher', agent: 'codex', status: 'ready' }, { id: 'd', role: 'director', agent: 'claude-code', status: 'working' }, { id: 'x', role: 'singer' }];
  assert.deepEqual(orderSlots(slots).map(s => s.id), ['d', 'researcher'], 'unknown roles are left out');
  assert.deepEqual(rolesToAdd(slots), ['art-director', 'senior-animator']);
  assert.deepEqual(rolesToAdd([]), ['art-director', 'senior-animator', 'researcher']);
  assert.deepEqual(SLOT_ROLES, ['director', 'art-director', 'senior-animator', 'researcher']);
  assert.equal(isRunning({ status: 'working' }), true);
  assert.equal(isRunning({ status: 'off' }), false);
  assert.equal(isRunning({ status: 'error' }), false);
  // a ready agent has no turn to stop: its button switches it off instead of a Stop that does nothing
  assert.equal(slotAction({ agent: 'claude-code', status: 'ready' }), 'off');
  assert.equal(slotAction({ agent: 'claude-code', status: 'working' }), 'stop');
  assert.equal(slotAction({ agent: 'claude-code', status: 'starting' }), 'stop');
  assert.equal(slotAction({ agent: null, status: 'off' }), null);
});

test('slots: a change is saved as the whole list the server takes', () => {
  const slots = [{ id: 'director', role: 'director', agent: 'claude-code', status: 'ready', brief: 'ignored', message: 'x' }];
  const added = changeSlots(slots, { add: 'art-director' });
  assert.deepEqual(slotsForSave(added), [{ id: 'director', role: 'director', agent: 'claude-code' }, { id: 'art-director', role: 'art-director', agent: null, brief: '' }]);
  const picked = changeSlots(added, { id: 'art-director', patch: { agent: 'gemini', brief: 'Flat shapes' } });
  assert.deepEqual(slotsForSave(picked)[1], { id: 'art-director', role: 'art-director', agent: 'gemini', brief: 'Flat shapes' });
  assert.deepEqual(slotsForSave(changeSlots(picked, { id: 'director', patch: { agent: '' } }))[0].agent, null, 'none is null');
  assert.deepEqual(slotsForSave(changeSlots(picked, { remove: 'art-director' })).map(s => s.id), ['director']);
  assert.deepEqual(slotsForSave(changeSlots(picked, { remove: 'director' })).map(s => s.id), ['director', 'art-director'], 'the Director cannot be removed');
  assert.equal(changeSlots(added, { add: 'art-director' }).length, 2, 'one slot per role');
  assert.deepEqual(slotsForSave([{ id: 'r', role: 'researcher', agent: 'codex', tools: ['see'] }])[1].tools, ['see']);
});

test('every word the settings use is in both languages', () => {
  const keys = new Set([...settings.matchAll(/data-i18n(?:-label|-placeholder)?="([\w.]+)"/g)].map(m => m[1]));
  for (const role of SLOT_ROLES) for (const k of [`agent.role.${role}`, `agent.roleLead.${role}`]) keys.add(k);
  for (const k of ['agent.pick', 'agent.none', 'agent.notInstalled', 'agent.stop', 'agent.remove', 'agent.lastActivity', 'agent.brief', 'agent.add', 'agent.install',
    'agent.briefPlaceholder.art-director', 'agent.briefPlaceholder.senior-animator', 'agent.briefPlaceholder.researcher', 'settings.aboutName', 'settings.whereClaude', 'settings.whereCodex', 'settings.whereOther']) keys.add(k);
  for (const k of keys) { assert.ok(en[k], `en ${k}`); assert.ok(tr[k], `tr ${k}`); }
});
