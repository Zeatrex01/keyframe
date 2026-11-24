// The live drawing feed: what draw_rig drew, part by part, so the page can show it being drawn.
//
//   <project>/.keyframe/draw-feed.jsonl   one event per line
//
// draw_rig appends a `start` event, one `part` event per part it drew (its placement and its safe
// SVG tree, src/render/svg-safe.js) and a `done` event; the page polls for events after the last
// one it played and traces each part on the drawing board. The MCP server and the page server
// can be different processes, so the feed is a file in the project's working folder (like the
// chat), never memory. It is a record of what was shown, not a source: the drawing itself is the
// <name>.parts.json beside the rig. Node only.

import fs from 'node:fs';
import path from 'node:path';
import { CHAT_DIR } from './chat.js';

export const FEED_FILE = 'draw-feed.jsonl';
export const FEED_KINDS = Object.freeze(['start', 'part', 'done']);
const MAX_BYTES = 4 * 1024 * 1024;   // past this the feed keeps only the latest drawing session
const MAX_READ = 200;                // events per read; the page asks again for the rest

const fileOf = dir => path.join(dir, CHAT_DIR, FEED_FILE);

/** Every event in the feed (unreadable lines are skipped). */
function readAll(dir) {
  let text = '';
  try { text = fs.readFileSync(fileOf(dir), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); if (Number.isInteger(e.seq) && FEED_KINDS.includes(e.kind)) out.push(e); } catch { /* a torn line */ }
  }
  return out;
}

/** The number of the last event, 0 when the feed is empty. */
export function lastFeedSeq(dir) {
  if (!dir) return 0;
  const all = readAll(dir);
  return all.length ? all[all.length - 1].seq : 0;
}

/**
 * Append events (each { kind, rig, file, ... }); returns them with their numbers.
 * @param {string} dir project folder
 * @param {object[]} events
 */
export function appendFeed(dir, events) {
  const file = fileOf(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let seq = lastFeedSeq(dir);
  const time = new Date().toISOString();
  const numbered = events.map(e => ({ ...e, seq: ++seq, time }));
  fs.appendFileSync(file, numbered.map(e => JSON.stringify(e)).join('\n') + '\n');
  try {
    if (fs.statSync(file).size > MAX_BYTES) {
      const all = readAll(dir);
      const from = all.map(e => e.kind).lastIndexOf('start');
      fs.writeFileSync(file, all.slice(Math.max(0, from)).map(e => JSON.stringify(e)).join('\n') + '\n');
    }
  } catch { /* the trim is best effort; the feed still reads */ }
  return numbered;
}

/**
 * The events after `since`, at most 200; `last` is the newest number in the feed.
 * @param {string} dir @param {number} since
 */
export function readFeed(dir, since = 0) {
  const all = readAll(dir);
  const after = all.filter(e => e.seq > since);
  return { events: after.slice(0, MAX_READ), last: all.length ? all[all.length - 1].seq : 0, more: after.length > MAX_READ };
}
