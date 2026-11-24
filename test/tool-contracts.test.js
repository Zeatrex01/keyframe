// Gate for roadmap Phase 1: every tool explains itself well enough that a model which has
// never seen the studio can call it right the first time (src/mcp/guide.js, src/mcp/fixes.js).
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, createServer } from '../src/mcp/server.js';
import { validateArgs } from '../src/mcp/args.js';
import { fullSchema } from '../src/mcp/describe.js';

const names = new Set(TOOLS.map(t => t.name));

test('every tool says when to use it, gives an example call that passes its own schema, and names what comes next', () => {
  for (const tool of TOOLS) {
    assert.ok(tool.when && tool.when.length >= 20, `${tool.name}: "when" is missing or too short`);
    const issues = validateArgs(tool.inputSchema, tool.example);
    assert.deepEqual(issues, [], `${tool.name}: its example is refused by its own schema: ${issues.join(' ')}`);
    for (const required of tool.inputSchema.required ?? []) {
      assert.ok(Object.hasOwn(tool.example, required), `${tool.name}: the example leaves out the required "${required}"`);
    }
    for (const next of tool.next) assert.ok(names.has(next), `${tool.name}: next names an unknown tool "${next}"`);
    assert.ok(!tool.next.includes(tool.name), `${tool.name}: next points at itself`);
  }
});

test('every argument of every tool is described, and numbers say their range or default', () => {
  const walk = (tool, schema, path) => {
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      const at = `${tool.name}.${path}${key}`;
      assert.ok(typeof property.description === 'string' && property.description.trim().length >= 8, `${at} has no description`);
      if (property.type === 'number' || property.type === 'integer') {
        const bounded = property.minimum !== undefined || property.maximum !== undefined;
        const explained = /default|seconds|\bpx\b|fraction|degrees|units|ratio|times|share|between|0-1|0\.\.1|frames/i.test(property.description);
        assert.ok(bounded || explained, `${at} is a number with no range, unit or default`);
      }
      if (property.type === 'object' && property.properties) walk(tool, property, `${path}${key}.`);
    }
  };
  for (const tool of TOOLS) walk(tool, fullSchema(tool.inputSchema), '');
});

test('core tools only point at tools that are served by default', () => {
  const core = new Set(TOOLS.filter(t => t.tier === 'core').map(t => t.name));
  for (const tool of TOOLS.filter(t => t.tier === 'core')) {
    for (const next of tool.next) assert.ok(core.has(next), `${tool.name}: next names "${next}", which needs --all`);
    const text = `${tool.when} ${tool.notWhen ?? ''}`;
    for (const name of names) if (!core.has(name)) assert.ok(!text.includes(name), `${tool.name}: when/notWhen mention ${name}, which needs --all`);
  }
});

test('help returns the guide: when, an example call and the served next tools', async () => {
  const sent = [];
  const { wire } = createServer({ session: { dir: null, writable: () => false }, version: 'test', write: m => sent.push(m) });
  await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'help', arguments: { tool: 'write_animation' } } });
  const help = sent[0].result.structuredContent;
  assert.match(help.when, /clip/);
  assert.equal(help.example.tool, 'write_animation');
  assert.ok(help.example.arguments.clip.bones, 'the example is a whole call');
  assert.ok(help.next.includes('check_skeleton'));
});

test('every error code the studio can raise maps to a fix that is not the generic fallback', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fixFor } = await import('../src/mcp/fixes.js');
  const generic = fixFor('zzz-never-raised');
  const codes = new Set();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) for (const m of fs.readFileSync(full, 'utf8').matchAll(/StudioError\('([a-z0-9-]+)'/g)) codes.add(m[1]);
    }
  };
  walk(fileURLToPath(new URL('../src', import.meta.url)));
  const unmapped = [...codes].filter(code => fixFor(code) === generic);
  // Codes whose message alone is the fix (they name the one thing to change) are listed here on purpose.
  const selfExplaining = new Set(['timeout', 'too-large', 'nothing-tracked', 'not-a-folder', 'no-animation', 'invariant-violation',
    'empty-motion', 'delivery-folder', 'degenerate-bone', 'write-failed', 'tool-failed', 'unsupported-site', 'nothing-to-bake',
    'not-skeleton', 'not-paintable', 'not-json', 'no-project', 'no-history', 'no-height', 'no-bones', 'needs-grid', 'merge-version',
    'merge-gate', 'folder-in-use', 'download-failed', 'same-bone', 'runtime-load', 'repair-new-fatal', 'setup-mismatch',
    'bake-broke-file', 'invariant-violation', 'outside-project', 'delivery-exists', 'bind-marker-malformed']);
  const missing = unmapped.filter(code => !selfExplaining.has(code));
  assert.deepEqual(missing, [], `give these codes a fix in src/mcp/fixes.js: ${missing.join(', ')}`);
});
