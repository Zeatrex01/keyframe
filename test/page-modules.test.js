// The page is split into modules by what they look after. These gates keep the split honest: every
// import resolves to an export, the installed app caches every module, the conversation keeps every
// message in order, and a phone shows the conversation right under the stage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasNewMessages, cursorAfter, insertAt } from '../web/chat-rules.js';

const WEB = new URL('../web/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, WEB), 'utf8');
const modules = fs.readdirSync(WEB).filter(n => n.endsWith('.js') && n !== 'sw.js' && n !== 'boot.js');

test('every name a page module imports is exported by the module it names', () => {
  const exported = Object.fromEntries(modules.map(m => [m,
    new Set([...read(m).matchAll(/^export (?:async )?(?:function|const|let|class) ([\w$]+)/gm)].map(x => x[1]))]));
  const missing = [];
  for (const m of modules) {
    for (const im of read(m).matchAll(/^import \{([^}]*)\} from '\.\/([\w-]+\.js)';/gm)) {
      if (!exported[im[2]]) { missing.push(`${m}: ${im[2]} does not exist`); continue; }
      for (const name of im[1].split(',').map(s => s.trim()).filter(Boolean)) if (!exported[im[2]].has(name)) missing.push(`${m}: ${name} from ${im[2]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('no page module is a monolith again', () => {
  for (const m of modules) assert.ok(read(m).split('\n').length <= 450, `${m} is ${read(m).split('\n').length} lines; split it by what it looks after`);
});

test('the installed app caches every page module and the start guard', () => {
  const sw = read('sw.js');
  for (const m of [...modules, 'boot.js']) assert.match(sw, new RegExp(`'/web/${m.replace('.', '\\.')}'`), m);
});

test('the poll asks for messages only when the server has one past the cursor', () => {
  assert.equal(hasNewMessages({ lastMessage: 0 }, 0), false);
  assert.equal(hasNewMessages({ lastMessage: 7 }, 7), false);
  assert.equal(hasNewMessages({ lastMessage: 8 }, 7), true);
  assert.equal(hasNewMessages(null, 0), false);
  assert.match(read('sync.js'), /hasNewMessages\(state, S\.lastId\)/, 'the poll uses the rule');
});

test('the owner\'s own message never moves the cursor past an agent reply the page has not read', () => {
  // The agent replied (id 4) after the last poll; the owner sends and gets id 5 back.
  let cursor = 3;
  cursor = cursorAfter(cursor, { id: 5 }, { fromPoll: false });
  assert.equal(cursor, 3, 'the next poll still asks for everything after 3, so reply 4 arrives');
  cursor = cursorAfter(cursor, { id: 4 }, { fromPoll: true });
  cursor = cursorAfter(cursor, { id: 5 }, { fromPoll: true });
  assert.equal(cursor, 5);
  // Reply 4 is shown before the owner's 5, not after it.
  assert.equal(insertAt([1, 2, 3, 5], 4), 3);
  assert.equal(insertAt([1, 2], 3), 2);
  assert.equal(insertAt([], 1), 0);
  assert.match(read('chat.js'), /addMessage\(message, \{ fromPoll: false \}\)/, 'a sent message is shown without moving the cursor');
});

test('on a phone the stage and its transport come first, then one panel from the tab bar', () => {
  const css = read('app.css');
  const phone = css.slice(css.indexOf('@media (max-width: 760px)'));
  // The order a selector is given on a phone (the rule that lists it and sets order).
  const order = sel => Number(phone.split('\n').find(line => line.includes(sel) && /order: \d/.test(line))?.match(/order: (\d+)/)[1]);
  assert.ok(order('.center > .panes') < order('.center > .transport') && order('.center > .transport') < order('.studio > .chat'),
    `panes ${order('.center > .panes')}, transport ${order('.center > .transport')}, chat ${order('.studio > .chat')}`);
  assert.match(phone, /\.studio:not\(\[data-phone="chat"\]\) > \.chat \{ display: none; \}/, 'the conversation is one of the panels');
  const html = read('index.html');
  const bar = html.slice(html.indexOf('<nav class="tabbar"'), html.indexOf('</nav>', html.indexOf('<nav class="tabbar"')));
  assert.deepEqual([...bar.matchAll(/data-phone="(\w+)"/g)].map(m => m[1]), ['chat', 'keys', 'reference', 'clips']);
});
