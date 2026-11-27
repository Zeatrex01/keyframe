// The compact tool listing is paid by every client in every session before a single call.
// Legacy measured 12,100 tokens before it was compacted; this gate keeps the real tool set
// under budget so a new tool cannot quietly grow it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, TOOLS } from '../src/mcp/server.js';
import { compactSchema } from '../src/mcp/describe.js';

// 2026-11-24: raised from 18,000 when every entry gained its "Use when" sentence (roadmap Phase 1:
// tools any AI can use without help). Still about 5,500 tokens for the whole listing, with critique_animation on the default wire.
// 2026-11-24: raised to 23,500 for add_effect (roadmap Phase 4), the 25th core tool; its tuning
// knobs sit in one `tune` object described by help, so the tool costs about 1,200 bytes.
// 2026-11-24: raised to 25,000 for draw_rig (Phase 4, #24), the 26th: placeholder art to a rig.
// 2026-11-24: raised to 30,000 for the drawing side: style_guide, critique_art and export_art
// (the art director's guide, check and exports), and the parametric shapes and components of draw_rig.
// 2026-11-27: raised to 30,500 for see_animation's `then` and `layers` (the 0.2 engine's
// crossfades and layers, seen as a game mixes them); nested fields carry one-word hints.
// 2026-11-27: raised to 30,600 for add_effect's particle emitter (`emit`): its recipe names and
// its library sprite, with the rest of its settings in `tune`.
// 2026-11-27: raised to 30,700 for export_art's `pixel` (pixel-art parts, sheets and clips), one
// object whose fields the description explains.
const BUDGET_BYTES = 30700;
const SUMMARY_MAX = 220;      // one or two sentences

test('the compact listing of the real tool set stays under budget', async () => {
  const sent = [];
  const { wire } = createServer({ session: { dir: null, writable: () => false }, version: 'budget', write: m => sent.push(m) });
  await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const bytes = JSON.stringify(sent[0].result.tools).length;
  assert.ok(bytes <= BUDGET_BYTES, `tools/list is ${bytes} bytes, budget ${BUDGET_BYTES}; move detail into the description (served by help)`);
});

test('every tool has a short summary, a full description, and core tools form the documented path', () => {
  for (const tool of TOOLS) {
    assert.ok(tool.summary.length <= SUMMARY_MAX, `${tool.name} summary is ${tool.summary.length} chars`);
    assert.ok(tool.description.length > tool.summary.length, `${tool.name} description adds to its summary`);
  }
  const core = TOOLS.filter(t => t.tier === 'core').map(t => t.name).sort();
  assert.deepEqual(core, ['add_effect', 'apply_motion', 'bake_animation', 'brief', 'check_skeleton', 'compare_reference', 'critique_animation', 'critique_art', 'delete_animation', 'describe_animation', 'draw_rig', 'export_art', 'export_godot', 'help', 'list_history',
    'measure_reference', 'paint_weights', 'read_animation', 'read_rig', 'reply', 'restore_file', 'sample_animation', 'scan_project', 'see_animation',
    'see_reference', 'set_curves', 'start_here', 'style_guide', 'wait_for_message', 'write_animation']);
});

test('by default only the core tools are on the wire; `all` adds the shelf', async () => {
  const names = async options => {
    const sent = [];
    const { wire } = createServer({ session: { dir: null, writable: () => false }, version: 'budget', write: m => sent.push(m), ...options });
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    return sent[0].result.tools.map(t => t.name);
  };
  const served = await names({});
  assert.equal(served.length, 30);
  assert.ok(served.includes('bake_animation') && !served.includes('export_binary'));
  assert.equal((await names({ all: true })).length, TOOLS.length);

  const sent = [];
  const { wire } = createServer({ session: { dir: null, writable: () => false }, version: 'budget', write: m => sent.push(m) });
  await wire.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'export_binary', arguments: {} } });
  assert.ok(JSON.stringify(sent[0]).includes('export_binary'), 'a shelved tool is refused by name, not run');
  assert.ok(sent[0].error || sent[0].result?.isError, 'a shelved tool cannot be called without --all');
});

test('no served tool points an agent at a tool that is not served', async () => {
  const shelved = TOOLS.filter(t => t.tier !== 'core').map(t => t.name);
  for (const tool of TOOLS.filter(t => t.tier === 'core')) {
    const text = `${tool.summary} ${tool.description} ${JSON.stringify(tool.inputSchema)}`;
    for (const name of shelved) assert.ok(!text.includes(name), `${tool.name} mentions ${name}, which needs --all`);
  }
});

test('the frame width limit of the seeing tools is in the short listing, not only in the refusal', () => {
  for (const name of ['see_animation', 'see_reference']) {
    const width = compactSchema(TOOLS.find(t => t.name === name).inputSchema).properties.width;
    assert.match(width.description, new RegExp(`${width.minimum}.*${width.maximum}`), name);
  }
});
