#!/usr/bin/env node
// One HTML file that plays a skeleton by double-click: no studio, no server, no network.
//   npm run player -- <skeleton.json> [--out <file.html>] [--animation <name>] [--title <text>]
// The atlas beside the skeleton and its page images are written into the file.
import fs from 'node:fs';
import path from 'node:path';
import { standalonePlayerFor } from '../src/deliver/standalone.js';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = option('--out'), animation = option('--animation'), title = option('--title');
const [file] = args;
if (!file || file.startsWith('-')) {
  process.stderr.write('Usage: npm run player -- <skeleton.json> [--out <file.html>] [--animation <name>] [--title <text>]\n');
  process.exit(2);
}
try {
  const html = standalonePlayerFor(path.resolve(file), { animation, title });
  const target = path.resolve(out ?? file.replace(/(\.keyframe)?\.json$/i, '.player.html'));
  if (path.resolve(file) === target) throw new Error('The player would overwrite the skeleton; choose another --out.');
  fs.writeFileSync(target, html);
  process.stdout.write(`${target} (${Math.round(html.length / 1024)} KB): open it in any browser.\n`);
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
}
