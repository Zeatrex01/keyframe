// Runs a few plain-number GDScript functions of the Godot add-on here, so a gate can hold the
// add-on's own code against the studio's engine without Godot. Only a small subset is read: an
// inner class's members and methods made of `var`, assignments, `if` / `elif` / `else` / `while`
// blocks, `return`, float maths (atan2, cos, sin, pow, clampf, minf, maxf, wrapf, absf,
// Vector2(x, y).length()) and `entry.get("key", default)`. Anything else is refused, so a change
// outside the subset fails the gate instead of passing untested. Test-only: the translated text
// is the repository's own add-on, run through the Function constructor.
/* eslint-disable no-new-func */

const MATH = new Set(['atan2', 'cos', 'sin', 'pow', 'sqrt']);
const LIB = new Set(['clampf', 'minf', 'maxf', 'wrapf', 'absf']);
const WORDS = { and: '&&', or: '||', not: '!', true: 'true', false: 'false', PI: 'Math.PI' };

export const lib = {
  clampf: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
  minf: Math.min, maxf: Math.max, absf: Math.abs,
  wrapf: (v, lo, hi) => { const range = hi - lo; return range === 0 ? lo : v - range * Math.floor((v - lo) / range); },
};

const indentOf = line => line.match(/^\t*/)[0].length;
const strip = line => line.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '');

function expression(text, known) {
  let e = text
    .replace(/\bPackedFloat64Array\(\[(.*)\]\)/g, '[$1]')
    .replace(/\bPackedFloat64Array\(\)/g, '[]')
    .replace(/\bVector2\(([^()]+)\)\.length\(\)/g, 'Math.hypot($1)')
    .replace(/\b(\w+)\.get\("(\w+)", ([^()]+?)\)/g, '($1["$2"] ?? $3)')
    .replace(/\bfloat\(/g, '(');
  if (/"/.test(e.replace(/\["\w+"\]/g, ''))) throw new Error(`gdscript: a string outside entry.get(): ${text}`);
  e = e.replace(/(\.|\["?)?\b([A-Za-z_]\w*)\b/g, (all, before, word) => {
    if (before) return all;
    if (Object.hasOwn(WORDS, word)) return WORDS[word];
    if (MATH.has(word)) return `Math.${word}`;
    if (LIB.has(word)) return `lib.${word}`;
    if (known.members.has(word)) return `self.${word}`;
    if (known.locals.has(word) || word === 'Math') return word;
    throw new Error(`gdscript: "${word}" is not in the subset (in: ${text})`);
  });
  return e.replace(/\bnot\b/g, '!');
}

function statement(text, known) {
  let m;
  if ((m = text.match(/^var (\w+)(?:\s*:\s*\w+)?\s*:?=\s*(.+)$/))) { known.locals.add(m[1]); return `let ${m[1]} = ${expression(m[2], known)};`; }
  if ((m = text.match(/^return(?:\s+(.+))?$/))) return `return ${m[1] ? expression(m[1], known) : ''};`;
  if ((m = text.match(/^(\w+)\s*([+\-*/]?=)\s*(.+)$/))) return `${expression(m[1], known)} ${m[2]} ${expression(m[3], known)};`;
  throw new Error(`gdscript: a statement outside the subset: ${text}`);
}

/** The lines of a block that starts after `start` and is indented deeper than `indent`. */
function blockLines(lines, start, indent) {
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() && indentOf(line) <= indent) break;
    out.push(line);
  }
  return out;
}

function translate(lines, members, params) {
  const known = { members, locals: new Set(params) };
  const open = [];
  const js = [];
  for (const raw of lines) {
    const line = strip(raw);
    if (!line.trim()) continue;
    const indent = indentOf(line), text = line.trim();
    while (open.length && open[open.length - 1] >= indent) { open.pop(); js.push('}'); }
    let m;
    if ((m = text.match(/^(if|while|elif) (.+):$/))) {
      js.push(`${m[1] === 'elif' ? 'else if' : m[1]} (${expression(m[2], known)}) {`);
      open.push(indent);
    } else if (text === 'else:') {
      js.push('else {');
      open.push(indent);
    } else {
      for (const part of text.split(';')) if (part.trim()) js.push(statement(part.trim(), known));
    }
  }
  while (open.length) { open.pop(); js.push('}'); }
  return js.join('\n');
}

/**
 * An inner class of a GDScript file, run here: `create(...args)` makes an instance (member
 * defaults, then `_init`), `call(self, name, ...args)` runs one of its methods.
 * @param {string} source @param {string} className
 */
export function gdClass(source, className) {
  const lines = source.split('\n');
  const at = lines.findIndex(l => new RegExp(`^\\t*class ${className}\\b`).test(l));
  if (at < 0) throw new Error(`gdscript: no class ${className}`);
  const indent = indentOf(lines[at]);
  const body = blockLines(lines, at + 1, indent);
  const members = new Map();
  const methods = new Map();
  for (let i = 0; i < body.length; i++) {
    const line = strip(body[i]);
    if (!line.trim() || indentOf(line) !== indent + 1) continue;
    let m;
    if ((m = line.trim().match(/^var (\w+)(?:\s*:\s*\w+)?(?:\s*:?=\s*(.+))?$/))) members.set(m[1], m[2] ?? null);
    else if ((m = line.trim().match(/^(?:static )?func (\w+)\(([^)]*)\)(?:\s*->\s*\w+)?:$/))) {
      const params = m[2].split(',').map(p => p.trim().split(/[\s:=]/)[0]).filter(Boolean);
      methods.set(m[1], { params, lines: blockLines(body, i + 1, indent + 1) });
    }
  }
  const names = new Set(members.keys());
  const compiled = new Map();
  const method = name => {
    if (!compiled.has(name)) {
      const m = methods.get(name);
      if (!m) throw new Error(`gdscript: no method ${className}.${name}`);
      compiled.set(name, new Function('self', 'lib', ...m.params, translate(m.lines, names, m.params)));
    }
    return compiled.get(name);
  };
  return {
    members: [...names],
    create(...args) {
      const self = {};
      for (const [name, value] of members) {
        self[name] = value === null ? null
          : /^PackedFloat64Array\(\)$/.test(value) ? [] : new Function('lib', `return ${expression(value, { members: new Set(), locals: new Set() })};`)(lib);
      }
      if (methods.has('_init')) method('_init')(self, lib, ...args);
      return self;
    },
    call(self, name, ...args) { return method(name)(self, lib, ...args); },
  };
}
