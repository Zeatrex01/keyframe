// Every tool declares itself, or it does not exist (ported from legacy registry.js).
//
// A list you must remember to edit is a defect factory: legacy shipped two unclassified
// tools once and only a gate caught them. So classification is a field each definition
// cannot omit, and the registry refuses to build without it.
//
// A tool definition:
//   name         snake_case, public
//   tier         'core' (the SEE -> WRITE -> PROVE path, always served) | 'advanced' (the shelf: served only with --all)
//   writes       true when it can write into the project (the foreign-folder guard keys on it)
//   summary      one or two sentences for the compact listing
//   description  the full contract, served by `help`
//   inputSchema  JSON Schema subset enforced by src/mcp/args.js
//   when         one sentence: the situation this tool is for (src/mcp/guide.js)
//   notWhen      optional: the look-alike situation that needs another tool
//   example      arguments of one call that works, checked against inputSchema by a gate
//   next         the tools that usually follow
//   run(args, context) -> result (sync or async)

export const TIERS = Object.freeze(['core', 'advanced']);

const fail = message => { throw new Error(`registry: ${message}`); };

/** Validate the definitions and return them ordered by tier, then name. */
export function buildRegistry(tools) {
  if (!Array.isArray(tools) || !tools.length) fail('no tool definitions');
  const seen = new Set();
  for (const t of tools) {
    if (!t || typeof t.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(t.name)) fail(`bad tool name: ${t?.name}`);
    if (seen.has(t.name)) fail(`duplicate tool name: ${t.name}`);
    seen.add(t.name);
    if (typeof t.writes !== 'boolean') {
      fail(`tool "${t.name}" does not declare writes: true|false; an unclassified write tool would bypass the foreign-folder guard`);
    }
    if (!TIERS.includes(t.tier)) fail(`tool "${t.name}" does not declare a tier (${TIERS.join('|')})`);
    if (typeof t.summary !== 'string' || !t.summary.trim()) fail(`tool "${t.name}" has no summary`);
    if (typeof t.description !== 'string' || !t.description.trim()) fail(`tool "${t.name}" has no description`);
    if (!t.inputSchema || t.inputSchema.type !== 'object') fail(`tool "${t.name}" needs an object inputSchema`);
    if (typeof t.run !== 'function') fail(`tool "${t.name}" has no run()`);
    if (typeof t.when !== 'string' || !t.when.trim()) fail(`tool "${t.name}" does not say when to use it (when)`);
    if (t.notWhen !== undefined && (typeof t.notWhen !== 'string' || !t.notWhen.trim())) fail(`tool "${t.name}" has an empty notWhen`);
    if (!t.example || typeof t.example !== 'object' || Array.isArray(t.example)) fail(`tool "${t.name}" has no example call (example: {...})`);
    if (!Array.isArray(t.next) || t.next.some(n => typeof n !== 'string')) fail(`tool "${t.name}" does not list what comes next (next: [...])`);
  }
  const ordered = [...tools].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.name.localeCompare(b.name));
  return {
    tools: ordered,
    byName: new Map(ordered.map(t => [t.name, t])),
    writers: new Set(ordered.filter(t => t.writes).map(t => t.name)),
  };
}
