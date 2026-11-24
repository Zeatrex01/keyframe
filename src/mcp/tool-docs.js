// docs/tools.md, written from the tool definitions themselves so the reference never drifts
// from what the server serves (test/tool-docs.test.js fails when the file is stale; regenerate
// with `npm run docs:tools`).

import { fullSchema } from './describe.js';

const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function argumentRows(schema) {
  const full = fullSchema(schema) ?? {};
  const required = new Set(full.required ?? []);
  return Object.entries(full.properties ?? {}).map(([name, p]) => {
    const type = p.enum ? p.enum.map(v => `\`${v}\``).join(' \\| ') : (p.type === 'array' && p.items?.type ? `${p.items.type}[]` : p.type ?? 'any');
    const range = [p.minimum !== undefined ? `≥ ${p.minimum}` : '', p.maximum !== undefined ? `≤ ${p.maximum}` : ''].filter(Boolean).join(', ');
    return `| \`${name}\`${required.has(name) ? ' (required)' : ''} | ${cell(type)}${range ? ` (${range})` : ''} | ${cell(p.description)} |`;
  });
}

/** @param {any[]} tools  TOOLS from server.js (with their guide fields) */
export function toolsMarkdown(tools) {
  const core = tools.filter(t => t.tier === 'core'), advanced = tools.filter(t => t.tier !== 'core');
  const out = [
    '# Tools',
    '',
    '<!-- Written by `npm run docs:tools` from the tool definitions; do not edit by hand. -->',
    '',
    `The studio serves ${core.length} tools to any MCP client by default; ${advanced.length} more are on the shelf and served with`,
    '`--all` (or `"all": true` in the connection). Any tool\'s full contract is also one `help { tool }` call away.',
    'Every refusal carries `fix` (how to get past it) and, for argument problems, an `example` call that works.',
    '',
    '| Tool | Tier | What it does |',
    '|---|---|---|',
    ...[...core, ...advanced].map(t => `| [\`${t.name}\`](#${t.name.replace(/_/g, '_')}) | ${t.tier} | ${cell(t.summary)} |`),
    '',
  ];
  for (const t of [...core, ...advanced]) {
    out.push(`## ${t.name}`, '', `*${t.tier}${t.writes ? ', writes files' : ', read only'}.* ${t.summary}`, '');
    if (t.when) out.push(`**Use when:** ${t.when}`, '');
    if (t.notWhen) out.push(`**Not when:** ${t.notWhen}`, '');
    out.push(t.description, '');
    const rows = argumentRows(t.inputSchema);
    if (rows.length) out.push('| Argument | Type | Meaning |', '|---|---|---|', ...rows, '');
    if (t.example) out.push('Example:', '', '```json', JSON.stringify(t.example, null, 1), '```', '');
    if (t.next?.length) out.push(`**Next:** ${t.next.map(n => `\`${n}\``).join(', ')}`, '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
