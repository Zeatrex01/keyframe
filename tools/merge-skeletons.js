#!/usr/bin/env node
// CLI: node tools/merge-skeletons.js <target.json> <source.json> <animation> [output.json]
//
// Carries one animation with its dependencies into the target and writes a NEW file.
// Ported from legacy tools/merge_skeletons.js. The inputs are never written (the one-way
// rule): an output path equal to either input is refused, where legacy would back the
// target up and then overwrite it. An existing output is kept as `<output>.bak` first.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeAnimation } from '../src/spine/merge.js';
import { isStudioError } from '../src/shared/errors.js';

export const USAGE = 'usage: node tools/merge-skeletons.js <target.json> <source.json> <animation> [output.json]';

/** Default output beside the target: `hero.json` -> `hero_merged.json`. */
export const defaultOutput = targetPath => targetPath.replace(/\.json$/i, '') + '_merged.json';

const samePath = (a, b) => {
  const norm = p => path.resolve(p);
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/**
 * @param {string[]} args command-line arguments after the script name
 * @param {{ log?: (line: string) => void, error?: (line: string) => void }} [io]
 * @returns {number} exit code
 */
export function main(args, { log = console.log, error = console.error } = {}) {
  const [targetPath, sourcePath, animation, outputArg] = args;
  if (!targetPath || !sourcePath || !animation) {
    error(USAGE);
    return 1;
  }
  const output = outputArg || defaultOutput(targetPath);
  if (samePath(output, targetPath) || samePath(output, sourcePath)) {
    error(`refused: the output ${output} is one of the inputs; inputs are never written. Choose another output path.`);
    return 1;
  }
  let result;
  try {
    const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    result = mergeAnimation(target, source, animation);
  } catch (err) {
    error(isStudioError(err) ? `refused [${err.code}]: ${err.message}` : `failed: ${err.message}`);
    return 1;
  }
  const { skeleton, report } = result;
  if (fs.existsSync(output)) fs.copyFileSync(output, output + '.bak');
  fs.writeFileSync(output, JSON.stringify(skeleton), 'utf8');
  log(`written: ${output}`);
  log(`animation: ${report.animation} | bones +${report.bonesAdded.length} (shared ${report.bonesReused.length})`
    + ` | slots +${report.slotsAdded.length} | constraints +${report.constraintsAdded}`);
  for (const [kind, map] of Object.entries(report.renamed)) {
    for (const [from, to] of Object.entries(map)) log(`  renamed ${kind}: ${from} -> ${to}`);
  }
  for (const w of report.warnings) log(`  warning: ${w.where}: ${w.message}`);
  return 0;
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
