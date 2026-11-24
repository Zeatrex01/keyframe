// The motion library: what the studio has learned from references, kept per user so it
// travels from project to project. One JSON file per motion; values are rest-relative
// (scale as a ratio, travel as a fraction of the element's height), so a motion measured on one
// element can be played on another of any size.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { userDataBase, APP_NAME } from './app-paths.js';
import { StudioError } from '../shared/errors.js';

/** The library folder: $KS_LIBRARY, else the per-user data folder. */
export function libraryDir(env = process.env) {
  return path.resolve(env.KS_LIBRARY || path.join(userDataBase(process.platform, env, os.homedir()), APP_NAME, 'motions'));
}

export const slugOf = name => String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** @param {string} name @param {object} motion @param {{ env?: NodeJS.ProcessEnv, note?: string, source?: object }} [options] */
export function saveMotion(name, motion, { env, note, source } = {}) {
  const slug = slugOf(name);
  if (!slug) throw new StudioError('bad-argument', 'A motion needs a name made of letters or digits.', { name });
  if (!motion?.tracks || !Object.keys(motion.tracks).length) throw new StudioError('empty-motion', 'There is no motion to save: nothing moved in what was measured.');
  const dir = libraryDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const record = { name: slug, saved: new Date().toISOString(), ...(note ? { note } : {}), ...(source ? { source } : {}), ...motion };
  const file = path.join(dir, `${slug}.json`);
  const replaced = fs.existsSync(file);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 1)}\n`);
  return { name: slug, replaced };
}

/** @param {string} name @param {{ env?: NodeJS.ProcessEnv }} [options] */
export function readMotion(name, { env } = {}) {
  const slug = slugOf(name);
  const file = path.join(libraryDir(env), `${slug}.json`);
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new StudioError('unknown-motion', `No motion named "${name}" in the library.`, { name, available: listMotions({ env }).map(m => m.name) }); }
  return record;
}

/**
 * Every motion in the library, newest first, as one line each.
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export function listMotions({ env } = {}) {
  const dir = libraryDir(env);
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')); } catch { return []; }
  return names.map(n => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      return { name: m.name, duration: m.duration, anchor: m.anchor, channels: Object.keys(m.tracks ?? {}), keys: Object.values(m.tracks ?? {}).reduce((s, k) => s + k.length, 0),
        ...(m.note ? { note: m.note } : {}), ...(m.source?.file ? { from: m.source.file } : {}), saved: m.saved };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => String(b.saved).localeCompare(String(a.saved)));
}
