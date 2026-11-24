// The compact tool listing (ported from legacy describe.js).
//
// Measured in the legacy studio: full descriptions and schema text cost about 12,100
// tokens per session, paid by every client before a single call. The full contract stays
// and moves behind `help`; tools/list carries the summary, tagged with the tier, and the
// first sentence (or the `short` hint) of each property.

/** First sentence, capped. */
export function firstSentence(text, cap = 140) {
  const s = String(text ?? '');
  const end = s.search(/[.!?](\s|$)/);
  let out = end >= 0 ? s.slice(0, end + 1) : s;
  if (out.length > cap) out = out.slice(0, cap - 1).replace(/\s+\S*$/, '') + '...';
  return out;
}

// Recursive: a `short` on a nested property must be consumed too, or it rides onto the
// wire as an unknown schema key next to its full description (a legacy bug a gate caught).
export function compactSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const { short, ...out } = schema;
  if (short) out.description = short;
  else if (out.description) out.description = firstSentence(out.description);
  if (out.properties) {
    out.properties = Object.fromEntries(Object.entries(out.properties)
      .map(([key, property]) => [key, property && typeof property === 'object' ? compactSchema(property) : property]));
  }
  if (out.items && typeof out.items === 'object') out.items = compactSchema(out.items);
  return out;
}

// The full schema as validated and as `help` returns it: `short` hints are bookkeeping.
export function fullSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const { short, ...out } = schema;
  if (out.properties) {
    out.properties = Object.fromEntries(Object.entries(out.properties)
      .map(([key, property]) => [key, property && typeof property === 'object' ? fullSchema(property) : property]));
  }
  if (out.items && typeof out.items === 'object') out.items = fullSchema(out.items);
  return out;
}

/**
 * The tools/list entry a client sees. Registry bookkeeping leaves the wire: the tier is the
 * description's leading tag and `writes` becomes the spec's readOnlyHint.
 * @param {object} tool  a registry definition
 * @param {{ full?: boolean }} [options] full descriptions instead of compact ones
 */
export function toWire(tool, { full = false } = {}) {
  return {
    name: tool.name,
    description: full ? `${tool.description} Use when: ${tool.when}${tool.notWhen ? ` Not when: ${tool.notWhen}` : ''}`
      : `[${tool.tier}] ${tool.summary} Use when: ${tool.when}`,
    inputSchema: full ? fullSchema(tool.inputSchema) : compactSchema(tool.inputSchema),
    annotations: { readOnlyHint: !tool.writes },
  };
}
