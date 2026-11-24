#!/usr/bin/env node
// Print one version's section of CHANGELOG.md (the release notes of that version).
//
//   node tools/release-notes.js 0.3.0
//
// Fails when the section is missing or empty, so a release cannot go out undocumented.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The body under `## <version>` (or `## [<version>]`, with or without a date), up to the next `## `.
 * @param {string} changelog
 * @param {string} version
 * @returns {string | null}
 */
export function sectionOf(changelog, version) {
  const lines = changelog.split('\n');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex(l => new RegExp(`^## \\[?${escaped}\\]?(\\s|$)`).test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  return body || null;
}

if (process.argv[1]?.endsWith('release-notes.js')) {
  const version = process.argv[2];
  const body = version ? sectionOf(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version) : null;
  if (!body) { console.error(`CHANGELOG.md has no notes under "## ${version ?? '<version>'}".`); process.exit(1); }
  console.log(body);
}
