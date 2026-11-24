// Which file, in which project, and is it really a skeleton. Ported from legacy
// core/paths.js, where almost every tool resolved its paths through these functions.
//
// The one rule that matters here: the project directory is READ LIVE, never captured.
// A client may switch projects mid-session (an MCP `roots` notification). If a caller
// passed the directory in as a value, every tool built on top of it would keep resolving
// against the OLD project after a switch: the file is found, the work is done, the wrong
// project is touched, and for a write tool that is not recoverable. So the functions
// that resolve a caller's path take a `getProjectDir` FUNCTION, not a string.
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';
import { LEGACY_BACKUP_ROOTS, LEGACY_REFERENCE_FOLDER } from '../shared/legacy-names.js';

// ── project folders ──
// Decided 2026-10-28: the new tree writes English folder names and READS the
// legacy names as aliases, so existing projects keep their history and references.
// Legacy core/backup.js kept its generations under studio/history/, not under the legacy
// backup folder name; both are read so no existing undo trail is lost.
export const PROJECT_FOLDERS = Object.freeze({
  backup: Object.freeze({ name: '.backup', legacy: LEGACY_BACKUP_ROOTS }),
  reference: Object.freeze({ name: 'reference', legacy: Object.freeze([LEGACY_REFERENCE_FOLDER]) }),
});

/**
 * Where a project folder of `kind` is written, and every existing spelling to read from,
 * the new name first. A legacy folder is never a write target.
 * @returns {{ write: string, read: string[] }}
 */
export function projectFolders(projectDir, kind) {
  const spec = PROJECT_FOLDERS[kind];
  if (!spec) throw new StudioError('unknown-folder', `Unknown project folder kind "${kind}".`, { kind });
  const root = path.resolve(projectDir);
  const write = path.join(root, spec.name);
  const read = [spec.name, ...spec.legacy].map(name => path.join(root, name)).filter(isDirectory);
  return { write, read };
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

// ── containment ──

const escapes = rel => rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);

/**
 * Resolve `rel` inside the live project directory. A path that escapes is refused rather
 * than clamped: guessing what the caller "meant" is how a tool ends up writing into
 * someone's home folder. Lexical only; see `insideProjectReal` for links.
 */
export function insideProject(getProjectDir, rel) {
  // Fixed from legacy: it compared against the raw directory string, so a project given
  // with a trailing separator or forward slashes (or a drive root) refused every path.
  const dir = path.resolve(getProjectDir());
  const p = path.resolve(dir, String(rel || ''));
  if (escapes(path.relative(dir, p))) {
    throw new StudioError('outside-project', `Path outside the project was refused: ${rel}`, { path: String(rel) });
  }
  return p;
}

function entryExists(file) {
  try { fs.lstatSync(file); return true; } catch { return false; }
}

/**
 * Is `abs` really inside the project once links are followed? Lexical containment does
 * not stop `project/link/file.json` when `link` is a junction or symlink to another
 * directory. The file itself is resolved when it exists, else its nearest existing
 * ancestor, so a target that does not exist yet is judged by the folder it would land in.
 * Hoisted from legacy backup.js `contained` and animation_delivery.js `assertRealContained`,
 * which carried the same rule twice.
 */
export function isRealInside(projectDir, abs) {
  try {
    const root = fs.realpathSync(path.resolve(projectDir));
    let cursor = path.resolve(abs);
    while (!entryExists(cursor)) {
      const parent = path.dirname(cursor);
      if (parent === cursor) return false;
      cursor = parent;
    }
    return !escapes(path.relative(root, fs.realpathSync(cursor)));
  } catch { return false; }
}

/** `insideProject`, then the same answer with links followed. */
export function insideProjectReal(getProjectDir, rel) {
  const p = insideProject(getProjectDir, rel);
  if (!isRealInside(getProjectDir(), p)) {
    throw new StudioError('outside-project', `Path resolves outside the project through a link: ${rel}`,
      { path: String(rel), link: true });
  }
  return p;
}

// ── choosing and opening a skeleton ──

const slash = f => String(f).replace(/\\/g, '/');
const stemOf = f => path.posix.basename(slash(f)).replace(/\.json$/i, '');

/**
 * The BASE among candidates: the file whose name is a prefix of every other name
 * (x.json vs x_v2.json), safe because deliveries are named after their base. The prefix
 * test is about NAMES, not locations: comparing whole project-relative paths asked
 * whether "exports/delivery" starts with "rig", which nothing ever does.
 */
export function baseCandidates(files) {
  return files.filter(x => files.every(y => stemOf(y).startsWith(stemOf(x))));
}

/**
 * File-first mode: with no explicit path, the folder's own skeletons are the candidates.
 * One skeleton: that one. Several: the base. Ambiguous: NO guess, list them and let the
 * agent choose. Silently picking one would be the worst outcome: the tool would answer
 * confidently about a file nobody asked for.
 * @param {{ file: string }[]} candidates
 * @returns {{ file: string, reason: 'only-skeleton' | 'base-file', why: string }}
 */
export function chooseSkeleton(candidates) {
  if (!candidates.length) {
    throw new StudioError('no-skeleton', 'No skeleton to read: the folder has no Spine skeleton (try scan_project).');
  }
  if (candidates.length === 1) {
    return { file: candidates[0].file, reason: 'only-skeleton', why: 'the only skeleton in the folder' };
  }
  // Fixed from legacy: this compared whole paths while protectedBases compared names,
  // although both claimed to be the same rule. Both now call baseCandidates.
  const roots = baseCandidates(candidates.map(c => c.file));
  if (roots.length === 1) {
    const others = candidates.map(c => c.file).filter(f => f !== roots[0]);
    return { file: roots[0], reason: 'base-file',
      why: `base file (the others are derived from its name: ${others.join(', ')})` };
  }
  const list = candidates.map(c => c.file);
  throw new StudioError('ambiguous-skeleton',
    `Several skeletons here and which one is meant is unclear; pass \`file\`: ${list.join(', ')}`, { candidates: list });
}

/**
 * Resolve `rel` to an on-disk file. The `.json` extension is OPTIONAL: a listing hands
 * back "x.json" while a caller may pass "x", and an agent must be able to round-trip the
 * very name a tool gave it. When neither exists the refusal names BOTH attempts.
 * @returns {{ rel: string, abs: string }}
 */
export function resolveSkeletonPath(getProjectDir, rel) {
  rel = String(rel ?? '');
  const p = insideProject(getProjectDir, rel);
  // Fixed from legacy: it accepted anything that existed, so `rig` resolved to a folder
  // named rig (or the project itself for an empty name) instead of rig.json.
  if (isFile(p)) return { rel, abs: p };
  const hasExt = /\.json$/i.test(rel);
  if (!hasExt) {
    const alt = rel + '.json';
    const pAlt = insideProject(getProjectDir, alt);
    if (isFile(pAlt)) return { rel: alt, abs: pAlt };
    throw new StudioError('file-not-found', `File not found: ${rel} (also tried: ${alt}).`, { file: rel, tried: [rel, alt] });
  }
  throw new StudioError('file-not-found', `File not found: ${rel}.`, { file: rel, tried: [rel] });
}

/**
 * Parse with refusals that name the FILE. A raw JSON error ("Expected ',' at position
 * 3994") does not say which file broke, and a truncated or corrupted export is the most
 * common input on this path.
 */
export function readSkeletonFile(rel, abs) {
  let sk;
  try { sk = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) {
    throw new StudioError('not-json',
      `"${rel}" could not be read: not valid JSON (${e.message}). It may be a truncated or corrupted download; re-export from Spine.`,
      { file: rel, reason: e.message });
  }
  if (!sk || typeof sk !== 'object' || !Array.isArray(sk.bones)) {
    throw new StudioError('not-skeleton', `"${rel}" is not a Spine skeleton (no bones array).`, { file: rel });
  }
  return sk;
}

/**
 * The single read throat for skeletons: the explicit path, else the folder's own.
 * `onRead` is the hook for version history (legacy finding J: the owner re-exported over
 * the same name and the old version was simply gone, so nothing could say what changed).
 * It is injected, and its failure is swallowed: history is a convenience and must never
 * fail the real work.
 * @param {() => string} getProjectDir
 * @param {string} [rel]
 * @param {{ findSkeletons?: (dir: string) => { file: string }[], onRead?: (dir: string, rel: string, sk: object) => void }} [opts]
 */
export function openSkeleton(getProjectDir, rel, opts = {}) {
  let r = rel;
  let chosen = null;
  if (!r) {
    let candidates = [];
    try { candidates = opts.findSkeletons ? opts.findSkeletons(getProjectDir()) : []; } catch { /* empty folder */ }
    chosen = chooseSkeleton(candidates);
    r = chosen.file;
  }
  const found = resolveSkeletonPath(getProjectDir, r);
  const sk = readSkeletonFile(found.rel, found.abs);
  if (opts.onRead) { try { opts.onRead(getProjectDir(), found.rel, sk); } catch { /* never fatal */ } }
  return { sk, rel: found.rel, abs: found.abs, ...(chosen ? { autoChosen: { reason: chosen.reason, why: chosen.why } } : {}) };
}

// ── the one-way rule: which files may never be written over ──

/**
 * The protected bases: the same rule chooseSkeleton uses. On ambiguity it is PROTECTIVE:
 * every candidate is protected, because guessing wrong costs the member their Spine
 * export, while guessing protective costs one refusal that names the files.
 * The one exemption is a file the studio can prove it wrote: exact-path history exists
 * for it (`hasExactHistory`, injected so this module does not depend on backup.js).
 * PRESENCE of a trail is proof; absence proves nothing, which is the safe direction.
 * A brand new delivery is not on disk yet, so it is not a candidate and its first write
 * is never refused.
 * @param {{ findSkeletons?: (dir: string) => { file: string }[], hasExactHistory?: (dir: string, rel: string) => boolean }} [opts]
 * @returns {string[]}
 */
export function protectedBases(getProjectDir, opts = {}) {
  const bases = [];
  try {
    const found = (opts.findSkeletons ? opts.findSkeletons(getProjectDir()) : []).map(x => x.file);
    if (!found.length) return bases;
    const roots = baseCandidates(found);
    if (roots.length === 1) return [roots[0]];
    // Only collision-safe, exact-path history is ownership evidence (see backup.js).
    const wroteIt = f => {
      try { return !!opts.hasExactHistory && opts.hasExactHistory(getProjectDir(), f); } catch { return false; }
    };
    for (const f of found) if (!wroteIt(f)) bases.push(f);
  } catch { /* an unreadable folder protects nothing extra */ }
  return bases;
}

/** Is `abs` one of the protected bases? Compared through insideProject, so a base named
 * with a different spelling still resolves to the same file. */
export function isProtectedBase(getProjectDir, abs, opts = {}) {
  return protectedBases(getProjectDir, opts).some(b => {
    try { return insideProject(getProjectDir, b) === path.resolve(abs); } catch { return false; }
  });
}
