// Gate: docs/tools.md is what the tool definitions say (regenerate with `npm run docs:tools`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOOLS } from '../src/mcp/server.js';
import { toolsMarkdown } from '../src/mcp/tool-docs.js';

test('docs/tools.md is current with every tool, its arguments and its example', () => {
  const doc = fs.readFileSync(new URL('../docs/tools.md', import.meta.url), 'utf8');
  assert.equal(doc, toolsMarkdown(TOOLS), 'docs/tools.md is stale: run npm run docs:tools');
  for (const t of TOOLS) {
    assert.ok(doc.includes(`## ${t.name}\n`), t.name);
    for (const arg of Object.keys(t.inputSchema?.properties ?? {})) assert.ok(doc.includes(`| \`${arg}\``), `${t.name}.${arg}`);
  }
});
