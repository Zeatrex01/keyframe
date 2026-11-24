// What the page says about who is connected and what is on the stage, held to the acceptance
// test's findings: the built-in Director counts as connected, the first run leads with it, and a
// project switch leaves nothing of the last project on the stage or in the delivery card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const web = name => fs.readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8');

test('the chat says no AI is connected only when the pill waits (no Director and no MCP client)', () => {
  const chat = web('chat.js');
  assert.match(chat, /pill\.tone === 'wait' \? t\('chat\.noAgent'\)/);
  assert.doesNotMatch(chat, /!agent\?\.connected \? t\('chat\.noAgent'\)/, 'an MCP-only check ignores the Director');
  // Settings' connection check counts the Director too.
  assert.match(web('views.js'), /directorOf\(S\.state\?\.agent\)[\s\S]{0,400}settings\.directorHere/);
});

test('the first run leads with the built-in Director; the MCP lines come second, folded', () => {
  const html = web('index.html');
  const step = html.slice(html.indexOf('id="firstConnect"'), html.indexOf('id="firstOpen"'));
  const director = step.indexOf('id="firstDirectorGo"'), mcp = step.indexOf('<details class="first-mcp">');
  assert.ok(director > 0 && mcp > director, 'the Director comes first');
  assert.ok(step.indexOf('id="firstCode"') > mcp, 'the MCP command is inside the fold');
  const en = JSON.parse(fs.readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));
  assert.match(en['first.directorLead'], /Director/);
});

test('a project switch redraws the stage and the delivery card, and the stage menu lists every skeleton', () => {
  const views = web('views.js');
  const reset = /S\.shownKey = ('[^']*'|null)/.exec(views.slice(views.indexOf('export function switchedProject')))?.[1];
  assert.ok(reset && reset !== "''", 'an empty key equals the empty project\'s and keeps the last card');
  assert.match(web('index.html'), /<select class="file" id="stageFile"/);
  assert.match(web('app.js'), /el\.stageFile\.addEventListener\('change', \(\) => pickStage\(el\.stageFile\.value\)\)/);
});
