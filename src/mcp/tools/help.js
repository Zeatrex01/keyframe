// help — the full contract behind the compact listing.

import { fullSchema } from '../describe.js';
import { TIERS } from '../registry.js';
import { StudioError } from '../../shared/errors.js';

export default {
  name: 'help',
  tier: 'core',
  writes: false,
  summary: 'The full contract of one tool, or the index of all tools by tier.',
  description: 'tools/list carries short summaries to keep every session cheap. `help` with a tool name returns that tool\'s full description, when to use it (and when not), one example call that works, the tools that usually come next, and its complete input schema; with no argument it returns the index of every tool grouped by tier (core is the SEE -> WRITE -> PROVE path; the advanced shelf is listed only when the server was started with --all).',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { tool: { type: 'string', short: 'tool name; empty = index', description: 'Name of the tool to explain; leave empty for the index.' } },
  },
  run({ tool }, { registry }) {
    if (tool) {
      const def = registry.byName.get(tool);
      if (!def) {
        throw new StudioError('unknown-tool', `No tool named "${tool}".`, { available: registry.tools.map(t => t.name) });
      }
      const served = new Set(registry.tools.map(t => t.name));
      return { name: def.name, tier: def.tier, writes: def.writes, description: def.description,
        when: def.when, ...(def.notWhen ? { notWhen: def.notWhen } : {}),
        example: { tool: def.name, arguments: def.example },
        next: def.next.filter(n => served.has(n)),
        inputSchema: fullSchema(def.inputSchema) };
    }
    return {
      tiers: Object.fromEntries(TIERS.map(tier => [tier,
        registry.tools.filter(t => t.tier === tier).map(t => ({ name: t.name, writes: t.writes, summary: t.summary, when: t.when }))])),
    };
  },
};
