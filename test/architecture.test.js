// Architecture gate: the layer table in docs/architecture.md, enforced on every import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

// Keep in step with docs/architecture.md. `shared` is importable by every layer.
const ALLOWED = {
  shared: [],
  core: [],
  spine: [],
  engine: ['spine'],
  runtime: ['spine', 'engine'],
  understand: ['spine', 'engine', 'runtime'],
  render: ['core', 'spine', 'engine', 'runtime', 'understand'],
  deliver: ['core', 'spine', 'engine', 'runtime', 'understand'],
  mcp: ['core', 'spine', 'engine', 'runtime', 'understand', 'render', 'deliver'],
  agent: ['core', 'mcp'],
  server: ['core', 'spine', 'engine', 'runtime', 'understand', 'render', 'deliver', 'mcp', 'agent'],
};
const ISOMORPHIC = new Set(['shared', 'spine', 'engine', 'understand']);

function listJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Static `import ... from 'x'`, `export ... from 'x'`, bare `import 'x'`, and dynamic `import('x')`.
function importsOf(source) {
  const found = [];
  const strip = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of strip.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gm)) found.push({ spec: m[1], dynamic: false });
  for (const m of strip.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) found.push({ spec: m[1], dynamic: false });
  for (const m of strip.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push({ spec: m[1], dynamic: true });
  return found;
}

const layerOf = file => path.relative(SRC, file).split(path.sep)[0];

export function violationsIn(file, source) {
  const layer = layerOf(file);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const out = [];
  if (!(layer in ALLOWED)) return [`${rel}: unknown layer "${layer}" (add it to docs/architecture.md first)`];
  for (const { spec, dynamic } of importsOf(source)) {
    if (spec.startsWith('node:')) {
      if (ISOMORPHIC.has(layer)) out.push(`${rel}: isomorphic layer "${layer}" imports ${spec}`);
      else if (layer === 'runtime' && !dynamic) out.push(`${rel}: runtime imports ${spec} statically (use a dynamic import on the Node path)`);
      continue;
    }
    if (!spec.startsWith('.')) { out.push(`${rel}: imports package "${spec}" (no dependencies, ADR-6)`); continue; }
    const target = path.resolve(path.dirname(file), spec);
    if (!target.startsWith(SRC + path.sep)) continue; // vendor/, locale/ etc. are not layers
    const to = layerOf(target);
    if (to === layer || to === 'shared') continue;
    if (!ALLOWED[layer].includes(to)) out.push(`${rel}: layer "${layer}" may not import "${to}" (${spec})`);
  }
  return out;
}

test('every import follows the layer table', () => {
  const violations = listJs(SRC).flatMap(f => violationsIn(f, fs.readFileSync(f, 'utf8')));
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('the gate catches a forbidden edge, a node import in a pure layer and a package', () => {
  const at = layer => path.join(SRC, layer, 'probe.js');
  assert.equal(violationsIn(at('spine'), "import { x } from '../deliver/y.js';").length, 1);
  assert.equal(violationsIn(at('spine'), "import fs from 'node:fs';").length, 1);
  assert.equal(violationsIn(at('runtime'), "import vm from 'node:vm';").length, 1);
  assert.equal(violationsIn(at('runtime'), "const vm = await import('node:vm');").length, 0);
  assert.equal(violationsIn(at('core'), "import lodash from 'lodash';").length, 1);
  assert.equal(violationsIn(at('mcp'), "import { a } from '../spine/a.js';\nimport { b } from '../shared/errors.js';").length, 0);
});
