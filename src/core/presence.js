// Who is driving the studio from outside: an MCP client the owner runs (Claude Code, Claude
// Desktop, Codex...) stamps itself here on every tool call, so the page can say "Claude Code is
// connected" even when the client only writes and checks, and can say which folder it works on
// when that is not the project open in the page.
//
// Two stamps, both cheap and throttled:
//   - the project's own agent state (src/core/chat.js touchAgent), which the top bar's pill reads;
//   - one machine-wide file beside the studio's config (client.json): the last outside client,
//     its folder and when, so the page can point at a client working elsewhere.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { resolvePaths } from './app-paths.js';
import { touchAgent } from './chat.js';

/** A client counts as present this long after its last call (the same window as the chat's). */
export const PRESENT_MS = 90_000;
/** At most one stamp this often per server: a burst of calls writes once. */
export const STAMP_EVERY_MS = 15_000;

/** The names clients send in their handshake, as people call them. */
const LABELS = Object.freeze({ 'claude-code': 'Claude Code', 'claude-ai': 'Claude Desktop', 'claude-desktop': 'Claude Desktop',
  codex: 'Codex', 'codex-mcp-client': 'Codex', 'gemini-cli': 'Gemini CLI', cursor: 'Cursor', 'cursor-vscode': 'Cursor', vscode: 'VS Code' });

/** "claude-code 2.1.0" → "Claude Code"; an unknown client keeps its own name; none → "An AI client". */
export function clientLabel(raw) {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+v?\d[\w.+-]*$/, '') : '';
  if (!name) return 'An AI client';
  return LABELS[name.toLowerCase()] ?? name;
}

export const presenceFile = (configFile = resolvePaths().configFile) => path.join(path.dirname(configFile), 'client.json');

/** The last outside client, if it called within PRESENT_MS: { name, dir, at } or null. */
export function readPresence(file = presenceFile(), now = Date.now()) {
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = Date.parse(p?.at);
    if (!Number.isFinite(at) || now - at > PRESENT_MS || typeof p.name !== 'string') return null;
    return { name: p.name, dir: typeof p.dir === 'string' ? p.dir : null, at: p.at };
  } catch { return null; }
}

/**
 * The stamp an MCP server calls on each tool call. Never throws: presence must not break a call.
 * @param {{ file?: string, now?: () => number, touch?: typeof touchAgent }} [deps]
 * @returns {(call: { client?: string|null, dir?: string|null }) => boolean} true when it wrote
 */
export function presenceStamper({ file = presenceFile(), now = Date.now, touch = touchAgent } = {}) {
  let last = 0, lastKey = '';
  return ({ client, dir }) => {
    const t = now();
    const name = clientLabel(client);
    const key = `${name}\n${dir ?? ''}`;
    if (key === lastKey && t - last < STAMP_EVERY_MS) return false;
    last = t; lastKey = key;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ name, dir: dir ?? null, at: new Date(t).toISOString() }));
      fs.renameSync(tmp, file);
    } catch { /* the page just won't see it */ }
    if (dir) { try { touch(dir, { name }, t); } catch { /* not a project folder we may write */ } }
    return true;
  };
}
