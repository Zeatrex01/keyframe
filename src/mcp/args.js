// The argument gate: each tool's own inputSchema is its contract, enforced centrally so
// every tool gets it (ported from legacy dispatch.js validateArgs). Without it a missing
// argument died inside the tool as a Node TypeError, which an agent cannot act on.
//
// Not a JSON Schema engine: the subset the tools use, applied recursively — required,
// type (string, number, integer, boolean, array, object), enum, minimum, maximum,
// items, nested properties, additionalProperties: false.

const typeName = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function matchesType(value, type) {
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeName(value) === type;
}

/**
 * @returns {string[]} plain-English issues; empty when the arguments are acceptable
 */
export function validateArgs(schema, args, where = 'arguments') {
  const issues = [];
  if (!schema) return issues;
  if (schema.type === 'object') {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      issues.push(`${where} must be an object (got ${typeName(args)}).`);
      return issues;
    }
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (args[key] === undefined || args[key] === null || args[key] === '') {
        const hint = properties[key]?.description ? ` (${String(properties[key].description).slice(0, 90)})` : '';
        issues.push(`${where}.${key} is required${hint}.`);
      }
    }
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined) continue;
      const property = properties[key];
      if (!property) {
        if (schema.additionalProperties === false) {
          issues.push(`${where}.${key} is not accepted; accepted: ${Object.keys(properties).join(', ') || '(none)'}.`);
        }
        continue;
      }
      issues.push(...validateValue(property, value, `${where}.${key}`));
    }
    return issues;
  }
  return validateValue(schema, args, where);
}

function validateValue(schema, value, where) {
  const issues = [];
  if (schema.type && !matchesType(value, schema.type)) {
    issues.push(`${where} must be ${schema.type === 'integer' ? 'an integer' : `a${/^[aeiou]/.test(schema.type) ? 'n' : ''} ${schema.type}`} (got ${typeName(value)}).`);
    return issues;
  }
  if (schema.enum && !schema.enum.includes(value)) issues.push(`${where} must be one of: ${schema.enum.join(' | ')}.`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${where} must be >= ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(`${where} must be <= ${schema.maximum}.`);
  }
  if (schema.type === 'array' && schema.items) {
    value.forEach((item, i) => { if (issues.length < 5) issues.push(...validateValue(schema.items, item, `${where}[${i}]`)); });
  }
  if (schema.type === 'object' && (schema.properties || schema.required)) issues.push(...validateArgs(schema, value, where));
  return issues;
}
