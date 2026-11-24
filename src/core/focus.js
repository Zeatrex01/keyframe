// What the owner pointed at in the reference: which file, which part of the picture, which
// stretch of time. The page writes it; the reference tools default to it, so "learn this" in
// the page is enough and nobody types coordinates.

import fs from 'node:fs';
import path from 'node:path';
import { CHAT_DIR } from './chat.js';
import { checkRegion } from './video.js';
import { StudioError } from '../shared/errors.js';

const focusFile = dir => path.join(dir, CHAT_DIR, 'focus.state');

export function readFocus(projectDir) {
  try { return JSON.parse(fs.readFileSync(focusFile(projectDir), 'utf8')); } catch { return null; }
}

/**
 * @param {string} projectDir
 * @param {{ file?: string, region?: object, from?: number, to?: number, label?: string }} [focus]
 */
export function writeFocus(projectDir, { file, region, from, to, label } = {}) {
  if (typeof file !== 'string' || !file) throw new StudioError('bad-argument', 'A focus names the reference file.');
  const number = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const focus = { file, ...(region ? { region: checkRegion(region) } : {}), ...(number(from) !== undefined ? { from: number(from) } : {}),
    ...(number(to) !== undefined ? { to: number(to) } : {}), ...(typeof label === 'string' && label.trim() ? { label: label.trim().slice(0, 80) } : {}), time: new Date().toISOString() };
  if (focus.from !== undefined && focus.to !== undefined && focus.to <= focus.from) throw new StudioError('bad-argument', 'The focus range ends before it starts.', { from, to });
  fs.mkdirSync(path.join(projectDir, CHAT_DIR), { recursive: true });
  fs.writeFileSync(focusFile(projectDir), JSON.stringify(focus));
  return focus;
}

export function clearFocus(projectDir) { fs.rmSync(focusFile(projectDir), { force: true }); }
