// The agent CLI adapters: each reads its CLI's recorded stream into the studio's events, builds a
// command line that gives the agent only the studio's tools, and is found (or not) without throwing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeCode, codex, gemini, ADAPTERS, AGENT_IDS, adapterFor, shortToolName } from '../src/agent/adapters.js';
import { locateCli, commandFor, shimTarget, quoteForCmd } from '../src/agent/locate.js';
import { TOOL_SCOPES, toolsFor, briefFor, KNOWN_TOOLS } from '../src/agent/roles.js';

const fixture = name => fs.readFileSync(new URL(`./fixtures/agent/${name}`, import.meta.url), 'utf8').split('\n');
const events = (adapter, name) => fixture(name).flatMap(line => adapter.parse(line));

test('Claude Code: a recorded stream-json run reads as session, tool, text and the final answer', () => {
  const all = events(claudeCode, 'claude-stream.jsonl');
  const early = all.filter(e => e.early);
  assert.deepEqual(early.map(e => [e.type, e.name, e.phase]), [['tool', 'start_here', 'start']], 'the streamed announcement of the call');
  const got = all.filter(e => !e.early);
  assert.deepEqual(got.map(e => e.type), ['session', 'tool', 'tool', 'text', 'done']);
  assert.equal(got[0].session, 'ffd4afc0-e576-4a3b-846a-be0a4521e7ad');
  assert.deepEqual([got[1].name, got[1].phase], ['start_here', 'start']);
  assert.deepEqual([got[2].phase, got[2].ok], ['end', true]);
  assert.match(got[3].text, /ident\.json/);
  assert.equal(got[4].text, got[3].text, 'the result line carries the final answer');
  assert.equal(got[4].session, got[0].session);
});

test('Claude Code: a login failure is an error event, partial and sub-agent lines are skipped', () => {
  const got = events(claudeCode, 'claude-error.jsonl');
  assert.deepEqual(got.map(e => e.type), ['session', 'text', 'error']);
  assert.match(got[2].message, /Not logged in/);
  assert.deepEqual(claudeCode.parse('{"type":"assistant","parent_tool_use_id":"toolu_9","message":{"content":[{"type":"text","text":"inner"}]}}'), []);
  assert.deepEqual(claudeCode.parse('{"type":"result","subtype":"error_max_turns","is_error":false}').map(e => e.type), ['error']);
  for (const junk of ['', 'not json', '[]', 'null', '{"type":"stream_event"}']) assert.deepEqual(claudeCode.parse(junk), [], junk);
  assert.deepEqual(claudeCode.parse('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}},"parent_tool_use_id":null}'), [{ type: 'text', text: 'Hel', delta: true }]);
  assert.deepEqual(claudeCode.parse('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}},"parent_tool_use_id":"toolu_9"}'), [], 'a sub-agent streams nothing');
  assert.ok(claudeCode.command(plan()).args.includes('--include-partial-messages'), 'the answer streams');
});

test('Codex CLI: thread/item events and the earlier msg format both read', () => {
  const got = events(codex, 'codex-stream.jsonl');
  assert.deepEqual(got.map(e => e.type + (e.phase ? `:${e.phase}` : '')), ['session', 'tool:start', 'tool:end', 'tool:start', 'tool:end', 'text', 'done']);
  assert.deepEqual([got[1].name, got[2].ok, got[4].ok], ['start_here', true, false]);
  assert.equal(got[5].text, 'The project has one skeleton, ident.json.');
  const legacy = events(codex, 'codex-legacy-stream.jsonl');
  assert.deepEqual(legacy.map(e => e.type), ['session', 'tool', 'tool', 'text', 'done']);
  assert.equal(legacy[4].text, 'Six bones.');
  assert.deepEqual(codex.parse('{"type":"turn.failed","error":{"message":"stream disconnected"}}'), [{ type: 'error', message: 'stream disconnected' }]);
});

test('Gemini CLI: deltas, tools and a warning that is not a failure', () => {
  const got = events(gemini, 'gemini-stream.jsonl');
  assert.deepEqual(got.map(e => e.type), ['session', 'tool', 'tool', 'text', 'text', 'done']);
  assert.equal(got.filter(e => e.type === 'text').map(e => e.text).join(''), 'There is one skeleton, ident.json.');
  assert.ok(got.filter(e => e.type === 'text').every(e => e.delta === true));
  assert.deepEqual(gemini.parse('{"type":"result","status":"error","error":{"message":"quota"}}'), [{ type: 'error', message: 'quota' }]);
});

const plan = (over = {}) => ({ projectDir: '/p', tools: ['help', 'read_rig'], brief: 'Be the director.', resume: null, configFile: '/p/.keyframe/agent/director.json',
  mcp: { command: '/usr/bin/node', args: ['/s/tools/mcp-server.js', '--project', '/p', '--only', 'help,read_rig'] }, ...over });

test('Claude Code command: no built-in tools, only the studio tools allowed, the brief appended, resume when known', () => {
  const fresh = claudeCode.command(plan());
  const a = fresh.args;
  assert.deepEqual(a.slice(0, 4), ['-p', '--output-format', 'stream-json', '--verbose']);
  assert.equal(a[a.indexOf('--tools') + 1], '', 'no shell, no file tools');
  assert.equal(a[a.indexOf('--allowedTools') + 1], 'mcp__keyframe-studio__help,mcp__keyframe-studio__read_rig');
  assert.ok(a.includes('--strict-mcp-config'), 'the owner\'s other MCP servers are not loaded');
  assert.equal(a[a.indexOf('--append-system-prompt-file') + 1], '/p/.keyframe/agent/director.brief.md');
  assert.equal(fresh.files['/p/.keyframe/agent/director.brief.md'], 'Be the director.');
  assert.equal(a.includes('--resume'), false);
  assert.ok(!a.includes('--dangerously-skip-permissions'));
  const config = JSON.parse(fresh.files['/p/.keyframe/agent/director.json']);
  assert.deepEqual(config.mcpServers['keyframe-studio'].args.slice(-2), ['--only', 'help,read_rig']);
  const resumed = claudeCode.command(plan({ resume: 'abc' })).args;
  assert.equal(resumed[resumed.indexOf('--resume') + 1], 'abc');
});

test('every agent CLI runs isolated: none of the owner\'s personal instructions, memory, hooks, plugins or other servers', () => {
  // Claude Code: only project settings (no ~/.claude CLAUDE.md, hooks or plugins), every hook off,
  // no skills, no auto-memory, only the studio's MCP server.
  const claude = claudeCode.command(plan());
  const a = claude.args;
  assert.equal(a[a.indexOf('--setting-sources') + 1], 'project');
  assert.equal(a[a.indexOf('--settings') + 1], '/p/.keyframe/agent/director.settings.json');
  assert.deepEqual(JSON.parse(claude.files['/p/.keyframe/agent/director.settings.json']), { disableAllHooks: true, claudeMdExcludes: ['**/*'] });
  assert.ok(a.includes('--disable-slash-commands') && a.includes('--strict-mcp-config'));
  // --setting-sources does not keep ~/.claude/CLAUDE.md out (the PC test showed it): this does.
  assert.equal(claude.env?.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  assert.equal(claude.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.deepEqual(Object.keys(JSON.parse(claude.files['/p/.keyframe/agent/director.json']).mcpServers), ['keyframe-studio']);
  assert.ok(!a.includes('--bare'), 'bare mode would drop the owner\'s login');
  // Codex: the whole server table replaced, no AGENTS.md, no notify hook.
  const c = codex.command(plan()).args;
  const servers = c[c.indexOf(c.find(x => x.startsWith('mcp_servers=')))];
  assert.equal(servers, "mcp_servers={'keyframe-studio'={command='/usr/bin/node',args=['/s/tools/mcp-server.js','--project','/p','--only','help,read_rig'],enabled_tools=['help','read_rig']}}");
  assert.ok(c.includes('project_doc_max_bytes=0') && c.includes('notify=[]'));
  // Gemini: system settings with no context files, extensions off, only the studio server.
  const g = gemini.command(plan());
  assert.equal(g.args[g.args.indexOf('--extensions') + 1], 'none');
  assert.equal(g.args[g.args.indexOf('--allowed-mcp-server-names') + 1], 'keyframe-studio');
  const settings = JSON.parse(g.files['/p/.keyframe/agent/director.json']);
  assert.deepEqual(Object.keys(settings.mcpServers), ['keyframe-studio']);
  assert.deepEqual(settings.context.fileName, ['.keyframe-no-context.md']);
});

test('no argument of any adapter holds a character cmd.exe would eat (Windows, last-resort start)', () => {
  const winPlan = plan({ projectDir: 'C:\\Users\\o\\proj', configFile: 'C:\\Users\\o\\proj\\.keyframe\\agent\\director.json', brief: 'Be "the" director & 100% sure.',
    mcp: { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\ks\\tools\\mcp-server.js', '--project', 'C:\\Users\\o\\proj', '--only', 'help,read_rig'] } });
  for (const adapter of [claudeCode, codex, gemini]) {
    for (const arg of adapter.command(winPlan).args) assert.equal(quoteForCmd(arg), `"${arg}"`, `${adapter.id}: ${arg}`);
  }
  // A Windows path inside a TOML literal string keeps its backslashes.
  const c = codex.command(winPlan).args.find(x => x.startsWith('mcp_servers='));
  assert.ok(c.includes("command='C:\\Program Files\\nodejs\\node.exe'"));
});

test('Codex and Gemini commands: read-only sandbox, the studio server with its tool list, resume', () => {
  const c = codex.command(plan({ resume: 'th-1' })).args;
  assert.equal(c[0], 'exec');
  assert.deepEqual(c.slice(-3), ['resume', 'th-1', '-'], 'the prompt comes on standard input');
  assert.equal(c[c.indexOf('--sandbox') + 1], 'read-only');
  const g = gemini.command(plan({ resume: 's-1' }));
  assert.equal(g.args[g.args.indexOf('--resume') + 1], 's-1');
  assert.equal(g.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, '/p/.keyframe/agent/director.json');
  assert.deepEqual(JSON.parse(g.files['/p/.keyframe/agent/director.json']).mcpServers['keyframe-studio'].includeTools, ['help', 'read_rig']);
});

test('the adapters list is the contract the page reads', () => {
  assert.deepEqual(AGENT_IDS, ['claude-code', 'codex', 'gemini']);
  for (const a of ADAPTERS) {
    assert.equal(adapterFor(a.id), a);
    assert.match(a.env, /^KS_AGENT_[A-Z]+$/);
    for (const p of ['win32', 'darwin', 'other']) assert.ok(a.install[p], `${a.id} install ${p}`);
  }
  assert.equal(adapterFor('nope'), null);
  assert.equal(shortToolName('mcp__keyframe-studio__write_animation'), 'write_animation');
  assert.equal(shortToolName(undefined), 'tool');
});

test('tool scopes: the director writes, a reading slot changes nothing, the wait loop is never given', () => {
  assert.ok(TOOL_SCOPES.studio.includes('write_animation'));
  assert.ok(TOOL_SCOPES.studio.includes('reply'));
  for (const w of ['write_animation', 'restore_file', 'reply', 'set_curves', 'delete_animation']) assert.ok(!TOOL_SCOPES.read.includes(w), w);
  for (const scope of Object.values(TOOL_SCOPES)) assert.ok(!scope.includes('wait_for_message'));
  assert.ok(!KNOWN_TOOLS.includes('wait_for_message'));
  assert.deepEqual(toolsFor(['read_rig', 'wait_for_message', 'nope']), ['read_rig']);
  assert.deepEqual(toolsFor('unknown-scope'), [...TOOL_SCOPES.read], 'an unknown scope falls back to reading');
  assert.match(briefFor('director'), /Director/);
  assert.match(briefFor('animator', 'Prefer snappy timing.'), /animator slot[\s\S]*Prefer snappy timing\.$/);
});

test('locating a CLI: the override is final, PATH is searched, absent is null, nothing throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-locate-'));
  try {
    const exe = path.join(dir, 'claude');
    fs.writeFileSync(exe, '#!/bin/sh\n'); fs.chmodSync(exe, 0o755);
    const spec = { bin: 'claude', env: 'KS_AGENT_CLAUDE' };
    assert.equal(locateCli(spec, { PATH: dir }, 'linux'), exe);
    assert.equal(locateCli(spec, { PATH: dir, KS_AGENT_CLAUDE: '/nowhere/claude' }, 'linux'), null, 'an override that points nowhere is final');
    assert.equal(locateCli(spec, { PATH: dir, KS_AGENT_CLAUDE: exe }, 'linux'), exe);
    assert.equal(locateCli({ bin: 'no-such-cli-here', env: 'X' }, { PATH: dir }, 'linux'), null);
    fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\n');
    assert.equal(locateCli(spec, { Path: dir }, 'win32'), path.join(dir, 'claude.cmd'), 'Windows finds the shim, never the bare file');
    assert.equal(locateCli(/** @type {any} */ ({ get bin() { throw new Error('boom'); }, env: 'X' }), {}, 'linux'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('starting a CLI: a script runs under node, a Windows shim runs its script, cmd.exe only as a quoted fallback', () => {
  assert.deepEqual(commandFor('/x/fake.js', ['-p']), { command: process.execPath, args: ['/x/fake.js', '-p'], shell: false });
  assert.deepEqual(commandFor('/usr/bin/claude', ['-p'], 'linux'), { command: '/usr/bin/claude', args: ['-p'], shell: false });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-shim-'));
  try {
    const script = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    fs.mkdirSync(path.dirname(script), { recursive: true }); fs.writeFileSync(script, '');
    const shim = path.join(dir, 'claude.cmd');
    fs.writeFileSync(shim, '@ECHO off\r\nGOTO start\r\n:start\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
    assert.equal(shimTarget(shim), path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'));
    assert.deepEqual(commandFor(shim, ['-p'], 'win32'), { command: process.execPath, args: [script, '-p'], shell: false });
    const opaque = path.join(dir, 'gemini.cmd');
    fs.writeFileSync(opaque, '@echo off\r\nsomething.exe %*\r\n');
    const fallback = commandFor(opaque, ['--tools', '', 'a "b" %PATH% & del x'], 'win32');
    assert.equal(fallback.shell, true);
    assert.equal(fallback.command, `"${opaque}" "--tools" "" "a b PATH  del x"`);
    // Claude Code's native build: the npm shim runs claude.exe, which starts directly, no cmd.exe.
    const exe = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, '');
    const native = path.join(dir, 'claude-native.cmd');
    fs.writeFileSync(native, '@ECHO off\r\n"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
    assert.deepEqual(commandFor(native, ['--settings', '{"a":1}'], 'win32'), { command: exe, args: ['--settings', '{"a":1}'], shell: false });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(quoteForCmd('x\ny'), '"x y"');
});

test('the model: each CLI gets --model when a slot names one, and none for the CLI\'s own default', () => {
  const at = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  assert.equal(at(claudeCode.command(plan({ model: 'sonnet' })).args, '--model'), 'sonnet');
  assert.equal(at(codex.command(plan({ model: 'gpt-5-mini' })).args, '--model'), 'gpt-5-mini');
  assert.equal(at(gemini.command(plan({ model: 'gemini-2.5-flash' })).args, '--model'), 'gemini-2.5-flash');
  for (const a of ADAPTERS) {
    assert.ok(!a.command(plan({ model: '' })).args.includes('--model'), `${a.id}: '' is the CLI's own default`);
    assert.ok(a.defaultModel === '' || a.models.includes(a.defaultModel), `${a.id}: the default is offered`);
  }
  assert.equal(claudeCode.defaultModel, 'sonnet', 'a lower-cost default: the studio runs many turns on the owner\'s account');
});
