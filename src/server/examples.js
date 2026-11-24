// The examples the Projects view offers: each folder under examples/showcase that has a
// preview.png, in the order the page shows them. Opening one copies it into the studio's own data
// folder (never touching the examples), so the owner can ask for changes freely.

import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';

/** The page shows these first, in this order; any other showcase folder follows by name. */
export const EXAMPLE_ORDER = Object.freeze(['mika', 'pip', 'chest', 'play-button', 'coin-burst', 'warrior']);
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const COPIED = /\.(json|atlas|png|webp|jpe?g)$/i;

const rank = name => (EXAMPLE_ORDER.includes(name) ? EXAMPLE_ORDER.indexOf(name) : EXAMPLE_ORDER.length);

/**
 * The examples there are, in the page's order.
 * @param {string} root the studio's checkout
 * @returns {{ name: string, dir: string, preview: string | null }[]}
 */
export function listExamples(root) {
  const showcase = path.join(root, 'examples', 'showcase');
  let names = [];
  try { names = fs.readdirSync(showcase, { withFileTypes: true }).filter(d => d.isDirectory() && NAME.test(d.name)).map(d => d.name); } catch { /* no showcase */ }
  return names.filter(name => fs.existsSync(path.join(showcase, name, 'preview.png')))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(name => ({ name, dir: path.join(showcase, name), preview: path.join(showcase, name, 'preview.png') }));
}

/** One example by name; no name means the first the page shows. An unknown name is refused. */
export function findExample(root, name) {
  const all = listExamples(root);
  if (name === undefined || name === null || name === '') {
    if (!all.length) throw new StudioError('unknown-example', 'There is no example to open.');
    return all[0];
  }
  const example = typeof name === 'string' ? all.find(e => e.name === name) : undefined;
  if (!example) throw new StudioError('unknown-example', `There is no example called ${String(name).slice(0, 60)}.`, { example: String(name).slice(0, 60) });
  return example;
}

/**
 * Copy an example into `samplesDir/<name>` (once: a copy already there keeps the owner's changes).
 * @returns {string} the copy's folder
 */
export function copyExample(example, samplesDir) {
  const target = path.join(samplesDir, example.name);
  const has = fs.existsSync(target) && fs.readdirSync(target).some(f => COPIED.test(f));
  if (!has) {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(example.dir, target, { recursive: true, filter: from => fs.statSync(from).isDirectory() || COPIED.test(from) });
  }
  return target;
}
