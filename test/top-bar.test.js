// The top bar: the brand, the open project, who is in the room, and Settings. Nothing in the page
// is set in capitals; section titles are sentence case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pillState, directorOf, agentName } from '../web/agent-rules.js';

const WEB = new URL('../web/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, WEB), 'utf8');

test('no stylesheet sets text in capitals', () => {
  for (const name of fs.readdirSync(WEB).filter(n => n.endsWith('.css'))) {
    assert.doesNotMatch(read(name), /text-transform:\s*uppercase/i, name);
    assert.doesNotMatch(read(name), /font-variant(-caps)?:\s*(all-)?small-caps/i, name);
  }
});

test('the bar holds the brand, the project switcher, the agent pill and Settings, and no language switch', () => {
  const html = read('index.html');
  const bar = html.slice(html.indexOf('<header class="bar"'), html.indexOf('</header>'));
  for (const id of ['navProjects', 'projectSwitch', 'projectName', 'agentPill', 'agentDot', 'navSettings']) assert.match(bar, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(bar, /data-lang=/, 'the language lives in Settings');
  assert.match(bar, /href="#i-sliders"/, 'Settings is the sliders icon');
  assert.ok(bar.indexOf('id="projectSwitch"') < bar.indexOf('id="agentPill"') && bar.indexOf('id="agentPill"') < bar.indexOf('id="navSettings"'));
});

test('the pill names the client that called in, and says when it works', () => {
  assert.deepEqual(pillState(null, false), { tone: 'bad', name: null, key: 'nav.offline', embedded: false });
  assert.equal(pillState({ agent: null }).key, 'nav.waiting');
  assert.equal(pillState({ agent: { connected: false, name: 'Codex' } }).tone, 'wait');
  assert.deepEqual(pillState({ agent: { connected: true, name: 'Claude Code', work: 'idle' } }), { tone: 'on', name: 'Claude Code', key: 'nav.connectedShort', embedded: false });
  assert.equal(pillState({ agent: { connected: true, name: 'Codex', work: 'writing' } }).tone, 'busy');
  assert.equal(pillState({ agent: { connected: true, name: 'Codex', work: 'checking' } }).tone, 'busy');
  assert.deepEqual(pillState({ agent: { connected: true } }), { tone: 'on', name: null, key: 'nav.connectedAnon', embedded: false });
});

test('the embedded Director, when it runs, is the one the pill shows', () => {
  const slots = status => ({ connected: true, name: 'Other client', slots: [
    { id: 's2', role: 'illustrator', agent: 'gemini', status: 'ready' },
    { id: 's1', role: 'director', agent: 'claude-code', status } ] });
  assert.deepEqual(pillState({ agent: slots('ready') }), { tone: 'on', name: 'Claude Code', key: 'agent.status.ready', embedded: true });
  assert.equal(pillState({ agent: slots('working') }).tone, 'busy');
  assert.equal(pillState({ agent: slots('starting') }).tone, 'busy');
  assert.equal(pillState({ agent: slots('error') }).tone, 'bad');
  // Off, or no Director at all: the external client's state as before.
  assert.deepEqual(pillState({ agent: slots('off') }), { tone: 'on', name: 'Other client', key: 'nav.connectedShort', embedded: false });
  assert.equal(directorOf({ slots: [{ role: 'researcher', agent: 'codex', status: 'ready' }] }), null);
  assert.equal(directorOf({ slots: 'nonsense' }), null);
  assert.equal(agentName('codex'), 'Codex');
  assert.equal(agentName('new-cli'), 'new-cli');
  for (const lang of ['en', 'tr']) {
    const dict = JSON.parse(fs.readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'));
    for (const key of ['nav.offline', 'nav.waiting', 'nav.connectedShort', 'nav.connectedAnon', 'agent.status.starting', 'agent.status.ready', 'agent.status.working', 'agent.status.error'])
      assert.ok(dict[key], `${lang}: ${key}`);
  }
});
