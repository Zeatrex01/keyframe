// End-to-end smoke test of the core flow, in a real browser, with no dependency:
//
//   the launcher starts the page server -> the page opens and plays the opening -> the owner opens
//   an example project -> the stage plays it -> an agent connects over MCP (stdio) -> the owner
//   writes in the page -> the agent receives it through wait_for_message -> the agent replies ->
//   the reply appears in the page -> Settings lists the optional add-ons.
//
// The browser is driven over the Chrome DevTools Protocol with Node's own WebSocket (Node 22+).
// Any Chrome, Chromium or Edge works: KS_E2E_BROWSER names one, otherwise the usual places are
// searched. Without a browser the test is skipped, unless KS_E2E_REQUIRED=1 (CI), where it fails.
//
//   npm run test:e2e
//
// Everything runs in a temporary folder (KS_CONFIG), so the owner's own projects are never touched.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowser } from './browser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = process.env.KS_E2E_REQUIRED === '1';
const TIMEOUT = 20_000;

/** Resolve with the first match of `pattern` in a child's stream, or reject after the timeout. */
function waitForLine(stream, pattern, what) {
  return new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => { stream.off('data', on); reject(new Error(`${what}: no answer in ${TIMEOUT} ms. Output:\n${seen.slice(-2000)}`)); }, TIMEOUT);
    const on = chunk => {
      seen += chunk;
      const m = pattern.exec(seen);
      if (m) { clearTimeout(timer); stream.off('data', on); resolve(m); }
    };
    stream.setEncoding('utf8');
    stream.on('data', on);
  });
}

/** A minimal DevTools Protocol client on one page target. */
async function connectPage(debugPort) {
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Could not reach the browser.')); });
  let id = 0;
  const pending = new Map();
  const problems = [];
  ws.onmessage = event => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push(`console.error: ${msg.params.args.map(a => a.value ?? a.description).join(' ')}`);
    // A content security policy violation or a failed load is reported here.
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`In the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const waitFor = async (expression, what) => {
    const until = Date.now() + TIMEOUT;
    let last;
    while (Date.now() < until) {
      try { last = await evaluate(expression); if (last) return last; } catch (err) { last = err.message; }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)}).`);
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  /** Ask the browser to quit (every process of it, not only the one we started), within `ms`. */
  const quit = (ms = 3000) => Promise.race([send('Browser.close').catch(() => {}), new Promise(r => setTimeout(r, ms).unref())]);
  return { send, evaluate, waitFor, problems, quit, close: () => ws.close() };
}

/** The agent: tools/mcp-server.js over stdio, speaking JSON-RPC by lines. */
function startAgent(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'mcp-server.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  let buffer = '', id = 0;
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const call = (method, params) => new Promise(resolve => {
    const n = ++id;
    pending.set(n, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
  });
  const tool = async (name, args) => {
    const r = await call('tools/call', { name, arguments: args });
    assert.ok(!r.error && !r.result.isError, `${name} failed: ${JSON.stringify(r.error ?? r.result)}`);
    return r.result.structuredContent;
  };
  return { child, call, tool };
}

const browser = findBrowser();
const canRun = typeof WebSocket === 'function' && browser !== null;
const reason = typeof WebSocket !== 'function' ? 'needs Node 22 or newer (global WebSocket)' : 'no Chrome, Chromium or Edge found (set KS_E2E_BROWSER)';

test('core flow: open the sample, talk to an agent, see the reply', { skip: !canRun && !REQUIRED ? reason : false, timeout: 120_000 }, async () => {
  assert.ok(canRun, `The e2e smoke test is required here but ${reason}.`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-e2e-'));
  const env = { ...process.env, KS_CONFIG: path.join(tmp, 'studio.config.json'), KS_LOG_LEVEL: 'warn' };
  const children = [];
  let page;
  try {
    // 1. The launcher, on a free port.
    const studio = spawn(process.execPath, [path.join(ROOT, 'tools', 'studio.js'), '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(studio);
    let studioErr = '';
    studio.stderr.on('data', c => { studioErr += c; });
    const [, base] = await waitForLine(studio.stdout, /open:\s+(http:\/\/127\.0\.0\.1:\d+\/)/, 'the studio')
      .catch(err => { throw new Error(`${err.message}\nstderr: ${studioErr}`); });

    // 2. The browser, headless, in its own profile.
    const chrome = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', `--user-data-dir=${path.join(tmp, 'profile')}`, '--window-size=1280,800', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(chrome);
    const [, debugPort] = await waitForLine(chrome.stderr, /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//, 'the browser');
    page = await connectPage(debugPort);

    // 3. The page starts and, with no project open, lands on Projects.
    await page.send('Page.navigate', { url: base });
    await page.waitFor(`document.body.dataset.ready === '1'`, 'the page to start');
    await page.evaluate(`document.getElementById('splashSkip')?.click(), true`);
    // With no project ever opened, that is the first run, and it offers the examples.
    await page.waitFor(`!document.getElementById('first').hidden && document.getElementById('hub').hidden`, 'the first run');
    await page.waitFor(`!!document.querySelector('#firstExamples [data-example]')`, 'the examples in the first run');
    // The first step leads with the built-in Director; the MCP command waits in a closed fold.
    await page.waitFor(`!document.getElementById('firstDirectorGo').hidden && document.getElementById('firstDirector').textContent.length > 0`, 'the Director on the first run');
    assert.equal(await page.evaluate(`document.querySelector('#firstConnect details.first-mcp').open`), false, 'the MCP lines are folded');

    // 4. An example opens as a project of its own and the stage plays it.
    const example = await page.evaluate(`document.querySelector('#firstExamples [data-example]').dataset.example`);
    await page.evaluate(`document.querySelector('#firstExamples [data-example]').click(), true`);
    await page.waitFor(`!document.getElementById('app').hidden && document.getElementById('projectName').textContent === ${JSON.stringify(example)}`, 'the example project');
    await page.waitFor(`!!document.querySelector('#player canvas')`, 'the stage to draw');
    // The stage's file menu holds the skeletons of the project, with the shown one selected.
    await page.waitFor(`(() => { const s = document.getElementById('stageFile'); return s.options.length >= 2 && s.value && s.value === s.title; })()`, 'the stage file menu');
    // 4b. The studio's layout at a desktop and a phone size: the stage, the describe box and every
    // panel can be reached, and nothing scrolls sideways.
    const visible = id => `(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`;
    const noSideScroll = `document.documentElement.scrollWidth <= document.documentElement.clientWidth`;
    const panels = { keys: 'keysPanel', clips: 'clipsPanel', reference: 'refCard', versions: 'versionsPanel', chat: 'chat' };
    for (const { width, height, mobile, group, attribute, tabs } of [
      { width: 1440, height: 900, mobile: false, group: 'inspectorTabs', attribute: 'tab', tabs: ['clips', 'reference', 'versions'] },
      { width: 390, height: 844, mobile: true, group: 'tabbar', attribute: 'phone', tabs: ['keys', 'reference', 'clips', 'chat'] },
    ]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await page.waitFor(`innerWidth === ${width}`, `the window at ${width} px`);
      await page.waitFor(visible('stage'), `the stage at ${width} px`);
      if (!mobile) {
        await page.waitFor(visible('compose'), `the describe box at ${width} px`);
        await page.waitFor(visible('keysPanel'), `the key lanes under the stage at ${width} px`);
      }
      for (const tab of tabs) {
        await page.evaluate(`document.querySelector('#${group} [data-${attribute}="${tab}"]').click(), true`);
        await page.waitFor(visible(panels[tab]), `the ${tab} panel at ${width} px`);
        assert.ok(await page.evaluate(noSideScroll), `no sideways scroll at ${width} px with ${tab} open`);
      }
      await page.waitFor(visible('compose'), `the describe box at ${width} px`);
    }
    await page.send('Emulation.clearDeviceMetricsOverride');

    const capitals = await page.evaluate(`[...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).textTransform === 'uppercase').map(e => e.id || e.className)`);
    assert.deepEqual(capitals, [], 'no element is set in capitals');

    // 4c. The keyboard goes bar -> conversation -> transport -> inspector, and every stop shows where it is.
    await page.evaluate(`document.activeElement?.blur(), document.body.focus(), true`);
    const stops = [];
    for (let i = 0; i < 60 && !stops.some(s => s.id === 'tabClips'); i++) {
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      stops.push(await page.evaluate(`(() => { const e = document.activeElement; const s = getComputedStyle(e); const box = e.closest('.box');
        const shown = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none' || (box && getComputedStyle(box).boxShadow !== 'none');
        return { id: e.id || e.className || e.tagName, shown }; })()`));
    }
    const order = ['navProjects', 'text', 'play', 'tabClips'].map(id => stops.findIndex(s => s.id === id));
    assert.ok(order.every(i => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), `keyboard order: ${stops.map(s => s.id).join(' > ')}`);
    assert.deepEqual(stops.filter(s => !s.shown).map(s => s.id), [], 'every keyboard stop shows its focus');

    // 5. An agent connects and waits for the owner.
    const agent = startAgent(env);
    children.push(agent.child);
    const init = await agent.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
    assert.ok(init.result?.serverInfo, 'the MCP server answers initialize');
    const waiting = agent.tool('wait_for_message', { timeoutSec: 30, name: 'Smoke' });
    await page.waitFor(`document.getElementById('agentDot').classList.contains('on')`, 'the agent to show as connected');

    // 6. The owner writes; the agent receives exactly that.
    const words = 'Make her blink twice.';
    await page.evaluate(`(() => { const t = document.getElementById('text'); t.value = ${JSON.stringify(words)}; t.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send').click(); return true; })()`);
    const received = await waiting;
    assert.deepEqual(received.messages.map(m => m.text), [words]);

    // 7. The agent replies; the page shows it.
    await agent.tool('reply', { text: 'Done: two blinks.', work: 'idle' });
    await page.waitFor(`[...document.querySelectorAll('#msgs .msg.ai')].some(m => m.textContent.includes('Done: two blinks.'))`, 'the reply in the page');

    // 7b. Draw mode: drag a shape on the board, place its pivot, use it in the project.
    await page.evaluate(`document.getElementById('modeDraw').click(), true`);
    await page.waitFor(`!document.getElementById('draw').hidden && document.getElementById('app').hidden`, 'the drawing board');
    const area = await page.evaluate(`(() => { const r = document.getElementById('drawSvg').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const mouse = async (type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await page.evaluate(`document.querySelector('#drawTools [data-tool="ellipse"]').click(), true`);
    if (await page.evaluate(`document.getElementById('drawPick').value !== ''`)) {
      await page.evaluate(`(() => { const s = document.getElementById('drawPick'); s.value = ''; s.dispatchEvent(new Event('change')); return true; })()`);
    }
    await mouse('mousePressed', area.x - 40, area.y - 40);
    await mouse('mouseMoved', area.x, area.y);
    await mouse('mouseMoved', area.x + 40, area.y + 40);
    await mouse('mouseReleased', area.x + 40, area.y + 40);
    await page.waitFor(`document.querySelectorAll('#drawParts [data-part]').length === 1`, 'the drawn part in the list');
    // A second part does not hang from the one selected; deleting it updates the count.
    await page.evaluate(`document.querySelector('#drawTools [data-tool="rect"]').click(), true`);
    await mouse('mousePressed', area.x + 60, area.y - 60);
    await mouse('mouseMoved', area.x + 90, area.y - 30);
    await mouse('mouseReleased', area.x + 90, area.y - 30);
    await page.waitFor(`document.querySelectorAll('#drawParts [data-part]').length === 2`, 'the second part in the list');
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#drawParts [data-part] .mono')].map(s => s.textContent)`), ['', ''], 'new parts hang from the root');
    const counted = await page.evaluate(`document.getElementById('drawCount').textContent`);
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })), true`);
    await page.waitFor(`document.querySelectorAll('#drawParts [data-part]').length === 1`, 'the part deleted');
    const after = await page.evaluate(`document.getElementById('drawCount').textContent`);
    assert.ok(after !== counted && /1/.test(after), `the count follows a delete: ${counted} -> ${after}`);
    await page.evaluate(`document.querySelector('#drawParts [data-part]').click(), true`);
    await page.evaluate(`document.querySelector('#drawTools [data-tool="pivot"]').click(), true`);
    await mouse('mousePressed', area.x, area.y + 30);
    await mouse('mouseReleased', area.x, area.y + 30);
    await page.evaluate(`(() => { const n = document.getElementById('drawName'); n.value = 'smoke_ball'; n.dispatchEvent(new Event('change')); document.getElementById('drawSave').click(); return true; })()`);
    await page.waitFor(`document.getElementById('drawStatus').classList.contains('ok')`, 'the drawing used in the project');
    const drawings = await page.evaluate(`fetch('/api/drawings').then(r => r.json()).then(b => b.drawings.map(d => d.file))`);
    assert.ok(drawings.includes('art/smoke_ball.parts.json'), `drawings: ${drawings}`);
    assert.ok(await page.evaluate(noSideScroll), 'no sideways scroll on the board');
    await page.evaluate(`document.getElementById('modeAnimate').click(), true`);
    await page.waitFor(`!document.getElementById('app').hidden`, 'back to Animate');

    // 8. Settings lists every optional add-on, installed or not.
    await page.evaluate(`location.hash = '#settings', true`);
    await page.waitFor(`document.querySelectorAll('#addonList li').length === 3`, 'the add-ons in Settings');
    // The section nav scrolls each section into view, at a phone size where they do not all fit.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.waitFor(`innerWidth === 390`, 'the window at 390 px');
    assert.ok(await page.evaluate(`document.getElementById('setAbout').getBoundingClientRect().top > innerHeight`), 'About starts below the fold');
    for (const id of ['setAbout', 'setLook', 'setAddons', 'setAi']) {
      await page.evaluate(`document.querySelector('#settingsNav [data-section="${id}"]').click(), true`);
      await page.waitFor(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return r.top > -2 && r.top < innerHeight - 160; })()`, `the ${id} section scrolled into view`);
      assert.equal(await page.evaluate(`document.querySelector('#settingsNav [aria-current="true"]').dataset.section`), id);
    }
    await page.send('Emulation.clearDeviceMetricsOverride');

    assert.deepEqual(page.problems, [], 'the page logged no error');
  } finally {
    // A deterministic teardown: a run once passed and then held the process for ten minutes. On
    // Windows, killing chrome.exe leaves its helper processes holding the stderr pipe, which keeps
    // Node waiting. So the browser is asked to quit through DevTools first, then every child is
    // killed, its pipes are destroyed and it is unreferenced, so nothing left can hold the run.
    await page?.quit();
    page?.close();
    for (const child of children) {
      child.kill();
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
      child.unref();
    }
    await new Promise(r => setTimeout(r, 300));
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

// The last guard: if anything still holds the process ten seconds after the test (a browser helper
// that outlived its parent), the run ends anyway with the test's own result. Unreferenced, so a
// clean run exits at once and never waits for it.
after(() => {
  setTimeout(() => {
    console.error('e2e: something still held the process after the test; exiting.');
    process.exit(process.exitCode ?? 0);
  }, 10_000).unref();
});
