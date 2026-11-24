#!/usr/bin/env node
// CLI: node tools/fetch-reference.js <link> [--project <dir>] [--from <s>] [--to <s>]
//
// Saves the video of one link (YouTube, or any public https page the yt-dlp program can read; the
// first video of a page) into <project>/reference/ (needs the optional yt-dlp program) and prints
// the result as JSON. An existing file is never overwritten.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchReference } from '../src/core/ytdlp.js';
import { isStudioError } from '../src/shared/errors.js';

export const USAGE = 'usage: node tools/fetch-reference.js <link> [--project <dir>] [--from <seconds>] [--to <seconds>]';

/** Parse the arguments; returns { link, project, from, to } or { error }. */
export function parseArgs(args) {
  const out = { link: null, project: process.cwd() };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--project') out.project = args[++i];
    else if (a === '--from' || a === '--to') {
      const v = args[++i];
      const n = v === undefined || v.trim() === '' ? NaN : Number(v);
      if (!Number.isFinite(n)) return { error: `${a} needs a number of seconds` };
      out[a.slice(2)] = n;
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else if (out.link === null) out.link = a;
    else return { error: 'only one link at a time' };
  }
  if (!out.link || !out.project) return { error: 'a link is required' };
  return out;
}

/** @returns {Promise<number>} exit code */
export async function main(args, { log = console.log, error = console.error } = {}) {
  const parsed = parseArgs(args);
  if (parsed.error) { error(`${parsed.error}\n${USAGE}`); return 1; }
  try {
    const result = await fetchReference(path.resolve(parsed.project), parsed.link, { from: parsed.from, to: parsed.to });
    log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    error(isStudioError(err) ? `refused [${err.code}]: ${err.message}` : `failed: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = await main(process.argv.slice(2));
}
