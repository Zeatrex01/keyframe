// Gate for src/mcp: registry, compact listing, argument gate and the wire, driven with
// fake tools so the wire is proven independently of any real tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/mcp/registry.js';
import { toWire, compactSchema, firstSentence } from '../src/mcp/describe.js';
import { validateArgs } from '../src/mcp/args.js';
import { createWire, HANDSHAKE_VERSIONS, MODERN_VERSIONS } from '../src/mcp/wire.js';
import { StudioError } from '../src/shared/errors.js';

// The usage guide every registered tool must carry (src/mcp/guide.js).
const G = { when: 'Testing.', example: {}, next: [] };

const echo = { ...G,
  name: 'echo', tier: 'core', writes: false, summary: 'Returns its input.',
  description: 'Returns its input. A long second sentence that the compact listing drops.',
  inputSchema: { type: 'object', required: ['text'], additionalProperties: false, properties: {
    text: { type: 'string', description: 'What to echo. More words here.' },
    times: { type: 'integer', minimum: 1, maximum: 3, short: 'repeat count' },
    mode: { type: 'string', enum: ['plain', 'loud'] },
    nested: { type: 'object', properties: { deep: { type: 'number', short: 'deep hint', description: 'Long deep text. Second.' } } },
  } },
  run(args, context) { return { echoed: args.text.repeat(args.times ?? 1), receiver: !!context.registry }; },
};
const writer = { ...G, name: 'save', tier: 'core', writes: true, summary: 'Writes.', description: 'Writes a file.',
  inputSchema: { type: 'object', properties: {} }, run: () => ({ written: true }) };
const refuses = { ...G, name: 'refuse', tier: 'advanced', writes: false, summary: 'Refuses.', description: 'Always refuses.',
  inputSchema: { type: 'object', properties: {} }, run() { throw new StudioError('base-protected', 'The base is never written.', { file: 'a.json' }); } };
const crashes = { ...G, name: 'crash', tier: 'advanced', writes: false, summary: 'Crashes.', description: 'Throws a TypeError.',
  inputSchema: { type: 'object', properties: {} }, run() { return null.nothing; } };
const picture = { ...G, name: 'picture', tier: 'advanced', writes: false, summary: 'An image.', description: 'Returns an image.',
  inputSchema: { type: 'object', properties: {} }, run: () => ({ image: { data: 'AAAA' }, meta: { frames: 1 } }) };
const slow = { ...G, name: 'slow', tier: 'advanced', writes: false, summary: 'Waits.', description: 'Waits until cancelled.',
  inputSchema: { type: 'object', properties: {} },
  run: (args, { signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ late: true }))) };

function harness({ writable = true } = {}) {
  const sent = [];
  const session = { dir: 'D:/project', writable: () => writable };
  const wire = createWire({ registry: buildRegistry([echo, writer, refuses, crashes, picture, slow]), session,
    write: m => sent.push(m), instructions: 'Call start_here first.', serverInfo: { name: 'keyframe-studio', version: 'test' } });
  return { wire, sent, session, last: () => sent[sent.length - 1] };
}
const call = (wire, name, args, id = 1) => wire.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('the registry refuses a tool that omits writes, tier, summary or run, and orders core first', () => {
  const base = { ...echo };
  for (const drop of ['writes', 'tier', 'summary', 'description', 'run']) {
    const broken = { ...base }; delete broken[drop];
    assert.throws(() => buildRegistry([broken]), new RegExp(drop === 'run' ? 'run' : drop));
  }
  assert.throws(() => buildRegistry([echo, echo]), /duplicate/);
  assert.throws(() => buildRegistry([{ ...echo, name: 'Bad-Name' }]), /bad tool name/);
  assert.deepEqual(buildRegistry([refuses, echo, writer]).tools.map(t => t.name), ['echo', 'save', 'refuse']);
});

test('the compact listing carries the tier tag, short hints and first sentences; nothing internal leaks', () => {
  const wired = toWire(echo);
  assert.equal(wired.description, '[core] Returns its input. Use when: Testing.');
  assert.equal(wired.inputSchema.properties.times.description, 'repeat count');
  assert.equal(wired.inputSchema.properties.text.description, 'What to echo.');
  assert.equal(wired.inputSchema.properties.nested.properties.deep.description, 'deep hint');
  assert.deepEqual(wired.annotations, { readOnlyHint: true });
  const text = JSON.stringify(wired);
  for (const internal of ['"short"', '"tier"', '"writes"', '"summary"', '"run"']) assert.ok(!text.includes(internal), internal);
  const full = toWire(echo, { full: true });
  assert.equal(full.description, `${echo.description} Use when: ${echo.when}`);
  assert.ok(!JSON.stringify(full).includes('"short"'), 'full form drops hints too');
  assert.equal(firstSentence('One. Two.'), 'One.');
  assert.equal(compactSchema(null), null);
});

test('the argument gate names every problem in plain English', () => {
  const issues = validateArgs(echo.inputSchema, { times: 7, mode: 'shout', extra: 1, nested: { deep: 'x' } });
  assert.ok(issues.some(i => /text is required/.test(i)));
  assert.ok(issues.some(i => /times must be <= 3/.test(i)));
  assert.ok(issues.some(i => /mode must be one of: plain \| loud/.test(i)));
  assert.ok(issues.some(i => /extra is not accepted/.test(i)));
  assert.ok(issues.some(i => /nested\.deep must be a number/.test(i)));
  assert.deepEqual(validateArgs(echo.inputSchema, { text: 'ok', times: 2 }), []);
  assert.ok(validateArgs(echo.inputSchema, { text: 'ok', times: 1.5 }).some(i => /integer/.test(i)));
  assert.ok(validateArgs(echo.inputSchema, []).some(i => /must be an object/.test(i)));
  assert.ok(validateArgs({ type: 'object', properties: { list: { type: 'array', items: { type: 'number' } } } }, { list: [1, 'x'] })
    .some(i => /list\[1\] must be a number/.test(i)));
});

test('handshake: initialize negotiates the version, tools/list is compact', async () => {
  const { wire, sent, session } = harness();
  await wire.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'probe', version: '1' } } });
  assert.equal(sent[0].result.protocolVersion, '2025-06-18');
  assert.equal(sent[0].result.instructions, 'Call start_here first.');
  assert.equal(session.client, 'probe 1');
  await wire.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(sent[1].result.protocolVersion, HANDSHAKE_VERSIONS[0], 'an unknown version is answered with ours, never echoed');
  await wire.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.deepEqual(sent[2].result.tools.map(t => t.name), ['echo', 'save', 'crash', 'picture', 'refuse', 'slow']);
});

test('a call runs with context, returns text plus structured content', async () => {
  const { wire, last } = harness();
  await call(wire, 'echo', { text: 'ab', times: 2 });
  assert.deepEqual(last().result.structuredContent, { echoed: 'abab', receiver: true });
  assert.deepEqual(JSON.parse(last().result.content[0].text), { echoed: 'abab', receiver: true });
});

test('refusals and crashes leave as coded data, never as silence', async () => {
  const { wire, last } = harness();
  await call(wire, 'refuse', {});
  assert.equal(last().result.isError, true);
  const refusal = last().result.structuredContent.error;
  assert.deepEqual({ ...refusal, fix: undefined }, { code: 'base-protected', message: 'The base is never written.', details: { file: 'a.json' }, fix: undefined });
  assert.match(refusal.fix, /delivery/, 'every refusal says how to get past it');
  await call(wire, 'crash', {});
  assert.equal(last().result.structuredContent.error.code, 'internal-error');
  await call(wire, 'echo', { times: 1 });
  assert.equal(last().result.structuredContent.error.code, 'bad-arguments');
  assert.deepEqual(last().result.structuredContent.error.example, { tool: 'echo', arguments: {} }, 'a refused call carries one that works');
  assert.match(last().result.structuredContent.error.fix, /help/);
  await call(wire, 'nope', {});
  assert.equal(last().error.code, -32602);
  assert.match(last().error.message, /echo/);
});

test('a writing tool outside a project stops before running', async () => {
  const { wire, last } = harness({ writable: false });
  await call(wire, 'save', {});
  assert.equal(last().result.structuredContent.error.code, 'foreign-folder');
  await call(wire, 'echo', { text: 'reads still work' });
  assert.equal(last().result.structuredContent.echoed, 'reads still work');
});

test('an image result becomes an image block plus its metadata', async () => {
  const { wire, last } = harness();
  await call(wire, 'picture', {});
  assert.deepEqual(last().result.content[0], { type: 'image', data: 'AAAA', mimeType: 'image/png' });
  assert.deepEqual(JSON.parse(last().result.content[1].text), { frames: 1 });
});

test('cancellation aborts the call and drops its reply', async () => {
  const { wire, sent } = harness();
  const pending = call(wire, 'slow', {}, 'job-1');
  await wire.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'job-1' } });
  await pending;
  assert.equal(sent.length, 0);
});

test('the line reader answers bad lines instead of hanging the client', async () => {
  const { wire, sent } = harness();
  const feed = wire.lineReader();
  await feed('{"jsonrpc":"2.0","id":1,"method":"ping"}\nnot json\n[1,2]\n{"jsonrpc":"2.0","id":2,');
  assert.deepEqual(sent.map(m => m.error?.code ?? 'ok'), ['ok', -32700, -32600]);
  await feed('"method":"ping"}\n');
  assert.equal(sent[3].id, 2, 'a line split across chunks is joined');
  await wire.handle({ jsonrpc: '2.0', id: 9, method: 'no/such' });
  assert.equal(sent[4].error.code, -32601);
});

test('modern era: discover, decorated results, refused handshake methods and unknown versions', async () => {
  const { wire, sent } = harness();
  const meta = version => ({ _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientInfo': { name: 'm' } } });
  await wire.handle({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: meta(MODERN_VERSIONS[0]) });
  assert.ok(sent[0].result.supportedVersions.includes(MODERN_VERSIONS[0]));
  assert.equal(sent[0].result.resultType, 'complete');
  await wire.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: meta(MODERN_VERSIONS[0]) });
  assert.equal(sent[1].result.ttlMs, 0);
  await wire.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { ...meta(MODERN_VERSIONS[0]), name: 'echo', arguments: { text: 'x' } } });
  assert.equal(sent[2].result.resultType, 'complete');
  assert.equal(sent[2].result.structuredContent.echoed, 'x');
  await wire.handle({ jsonrpc: '2.0', id: 4, method: 'initialize', params: meta(MODERN_VERSIONS[0]) });
  assert.equal(sent[3].error.code, -32601);
  await wire.handle({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: meta('2099-01-01') });
  assert.equal(sent[4].error.code, -32022);
  assert.deepEqual(sent[4].error.data.requested, '2099-01-01');
});
