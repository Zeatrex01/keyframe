#!/usr/bin/env node
// What this machine has for running and developing the studio, in one screen.
//
//   npm run doctor
//
// Nothing is installed or changed. Exit code 1 only when the studio itself cannot run (Node too
// old); everything else is optional and only reported.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addonStatus, detectAddons } from '../src/core/addons.js';
import { findBrowser } from '../e2e/browser.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const major = Number(process.versions.node.split('.')[0]);
const mark = ok => (ok ? 'ok  ' : '--  ');
const lines = [];

lines.push(`${mark(major >= 18)}Node.js ${process.versions.node}${major >= 18 ? '' : ' (the studio needs 18 or newer)'}`);
lines.push(`${mark(major >= 22)}Node.js 22+ for coverage thresholds and the e2e test${major >= 22 ? '' : ' (npm test still works)'}`);
const dev = ['eslint', 'typescript'].every(name => fs.existsSync(path.join(root, 'node_modules', name, 'package.json')));
lines.push(`${mark(dev)}Developer tools (ESLint, TypeScript)${dev ? '' : ': run npm ci'}`);
const browser = findBrowser();
lines.push(`${mark(!!browser)}Browser for npm run test:e2e${browser ? `: ${browser}` : ': none found (set KS_E2E_BROWSER)'}`);
lines.push('', 'Optional add-ons (the studio works without them):');
for (const a of addonStatus(detectAddons())) lines.push(`${mark(a.installed)}${a.name}${a.installed ? '' : `: ${a.install}`}`);

console.log(lines.join('\n'));
process.exitCode = major >= 18 ? 0 : 1;
