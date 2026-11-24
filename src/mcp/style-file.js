// The project's style guide on disk: <project>/keyframe.style.json (src/art/style.js). Node only.

import fs from 'node:fs';
import path from 'node:path';
import { STYLE_FILE, presetStyle, validateStyle } from '../art/style.js';

/**
 * The project's guide, or the default preset when it has none yet.
 * @param {string | null} dir  project folder
 * @returns {{ style: object, file: string, saved: boolean }}
 */
export function projectStyle(dir) {
  const file = dir ? path.join(dir, STYLE_FILE) : STYLE_FILE;
  if (dir) {
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = null; }
    if (text !== null) return { style: validateStyle(JSON.parse(text)), file, saved: true };
  }
  return { style: validateStyle(presetStyle()), file, saved: false };
}
