// What the page polls: the open project's skeletons, references, conversation and agent, put
// together into one answer. The page asks every second, so a skeleton is parsed again only when
// its file changed (size or modified time), and the conversation is read again only when it grew.

import fs from 'node:fs';
import path from 'node:path';
import { projectFolders } from '../core/paths.js';
import { readMessages, readAgent, CHAT_DIR } from '../core/chat.js';
import { readFocus } from '../core/focus.js';
import { listMotions } from '../core/motions.js';
import { DELIVERY_MARKER } from '../deliver/compose.js';
import { readAtlas } from '../understand/atlas.js';

export const REFERENCE_TYPES = new Set(['.mp4', '.webm', '.mov', '.gif', '.png', '.jpg', '.jpeg', '.webp']);

const stamp = stat => `${stat.size}:${stat.mtimeMs}`;

/** A per-file cache: the value is computed again only when the file's size or modified time changed. */
export function fileCache(compute) {
  const entries = new Map();
  const counter = { computed: 0 };
  return {
    counter,
    get(abs) {
      let stat;
      try { stat = fs.statSync(abs); } catch { entries.delete(abs); return undefined; }
      const key = stamp(stat);
      const hit = entries.get(abs);
      if (hit && hit.key === key) return hit.value;
      counter.computed++;
      const value = compute(abs, stat);
      entries.set(abs, { key, value });
      return value;
    },
    /** Drop entries for files no longer asked for (a project switch, a deleted delivery). */
    keepOnly(paths) { for (const k of entries.keys()) if (!paths.has(k)) entries.delete(k); },
    clear() { entries.clear(); },
  };
}

/**
 * @param {{ dir(): string|null, project(): object|null, version: string, canReadVideo: boolean, canFetchLink: boolean }} options
 */
export function createStateReader({ dir, project, version, canReadVideo, canFetchLink }) {
  const skeletonCache = fileCache((abs, stat) => {
    try {
      const sk = JSON.parse(fs.readFileSync(abs, 'utf8'));
      const marker = sk[DELIVERY_MARKER];
      return { role: marker ? 'delivery' : 'base', ...(marker?.base ? { deliveryOf: marker.base } : {}),
        animations: Object.keys(sk.animations ?? {}), modified: stat.mtimeMs };
    } catch { return null; }
  });
  let chat = { dir: null, key: null, messages: [] };

  function skeletons() {
    const p = project();
    const seen = new Set();
    const out = p.list().map(({ file }) => {
      const abs = p.resolve(file);
      seen.add(abs);
      const info = skeletonCache.get(abs);
      if (!info) return null;
      const atlas = p.atlasFor(abs);
      return { file, ...info, atlas: atlas ? atlas.rel : null };
    }).filter(Boolean);
    skeletonCache.keepOnly(seen);
    return out;
  }

  function messages() {
    const d = dir();
    let key = 'none';
    try { key = stamp(fs.statSync(path.join(d, CHAT_DIR, 'chat.jsonl'))); } catch { /* no conversation yet */ }
    if (chat.dir !== d || chat.key !== key) chat = { dir: d, key, messages: readMessages(d) };
    return chat.messages;
  }

  function references() {
    const d = dir();
    const out = [];
    for (const folder of projectFolders(d, 'reference').read) {
      for (const name of fs.readdirSync(folder)) {
        if (REFERENCE_TYPES.has(path.extname(name).toLowerCase())) out.push(path.relative(d, path.join(folder, name)).split(path.sep).join('/'));
      }
    }
    return out.sort();
  }

  /** The atlas pages a skeleton needs and the folder lacks, as one finding, or null. */
  async function missingArt(file) {
    const p = project();
    const abs = p.resolve(file);
    const atlas = p.atlasFor(abs);
    if (!atlas) return { code: 'no-atlas', message: `${file} has no .atlas beside it.` };
    let pages = [];
    try { pages = (await readAtlas(atlas.text)).pages.map(page => page.name); } catch { return { code: 'bad-atlas', message: `${atlas.rel} cannot be read as an atlas.` }; }
    const missing = pages.filter(name => !fs.existsSync(path.join(path.dirname(atlas.abs), name)));
    return missing.length ? { code: 'missing-page', message: `The atlas image ${missing.join(', ')} is not next to ${atlas.rel}.` } : null;
  }

  function state() {
    const d = dir();
    const common = { version, library: listMotions(), canReadVideo, canFetchLink };
    if (!d) return { ...common, project: null, agent: null, skeletons: [], show: null, references: [], focus: null, lastMessage: 0 };
    const all = skeletons();
    const list = messages();
    // What the stage shows: the delivery the agent last called ready, else the newest skeleton
    // (a delivery just written, or a rig just drawn on the board).
    const ready = [...list].reverse().find(m => m.from === 'agent' && m.work === 'ready' && m.file && all.some(s => s.file === m.file));
    const newest = all.slice().sort((a, b) => b.modified - a.modified || (a.role === 'delivery' ? -1 : 1))[0];
    const shown = ready ? all.find(s => s.file === ready.file) : (newest ?? null);
    return { ...common, project: { name: path.basename(d), dir: d, preview: fs.existsSync(path.join(d, 'preview.png')) }, agent: readAgent(d), skeletons: all,
      show: shown ? { file: shown.file, animation: ready?.animation && shown.animations.includes(ready.animation) ? ready.animation : (shown.animations[0] ?? null) } : null,
      references: references(), focus: readFocus(d), lastMessage: list.length ? list[list.length - 1].id : 0 };
  }

  return { state, references, missingArt, skeletonCache, reset() { skeletonCache.clear(); chat = { dir: null, key: null, messages: [] }; } };
}
