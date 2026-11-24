// The project's briefs: what each skeleton is and what each clip is for, as the agent confirmed
// them (.keyframe/brief.json, one entry per skeleton file). critique_animation reads them.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { CHAT_DIR } from './chat.js';

const briefFile = dir => path.join(dir, CHAT_DIR, 'brief.json');

/** Every brief in the project, by project-relative skeleton file. Never throws. */
export function readBriefs(projectDir) {
  try {
    const all = JSON.parse(fs.readFileSync(briefFile(projectDir), 'utf8'));
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

/** The brief of one skeleton, or null. */
export function readBrief(projectDir, file) {
  return readBriefs(projectDir)[file] ?? null;
}

/** Store one skeleton's brief (a checked brief: src/understand/subject.js validateBrief). */
export function writeBrief(projectDir, file, brief) {
  const all = readBriefs(projectDir);
  all[file] = { ...brief, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(projectDir, CHAT_DIR), { recursive: true });
  const target = briefFile(projectDir), temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(all, null, 2)}\n`);
  fs.renameSync(temp, target);
  return all[file];
}
