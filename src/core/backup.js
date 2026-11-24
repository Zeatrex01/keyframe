// Every write is reversible, not just the last one. Ported from legacy core/backup.js:
// the safety net under the one-way rule.
//
// A single `.bak` beside a file is one generation: the second write eats the first, so
// "undo twice" was never possible, and there was no tool to put a backup back. This
// keeps generations under `<project>/.backup/<slug>/<stamp><ext>`, prunes to KEEP, and
// restores any of them.
//
// Folder names (decided 2026-10-28): generations are WRITTEN under `.backup/`.
// The legacy roots (`studio/history/`, where legacy backup.js actually wrote, and the
// legacy backup folder name) are READ as aliases, so an existing project keeps its whole
// undo trail. Nothing is ever written into a legacy root, and it is never pruned.
//
// Identity: each history folder carries a marker naming the exact project-relative path
// it belongs to. A generation counts only when the marker matches, which is what makes
// history usable as proof that the studio wrote a file (see hasExactHistory).
//
// Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StudioError } from '../shared/errors.js';
import { PROJECT_FOLDERS, isRealInside } from './paths.js';

export const KEEP = 20;
export const MARKER = '.source-path.json';

/** Every history root, the write root first, then the legacy roots that are only read. */
export function historyRoots(projectDir) {
  const root = path.resolve(projectDir);
  const spec = PROJECT_FOLDERS.backup;
  return [spec.name, ...spec.legacy].map(name => path.join(root, name));
}

export const normalizeRel = rel => String(rel).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');

/**
 * The identity of a project file: its project-relative path as the filesystem spells it.
 * On Windows the JS realpath may echo the caller's casing; the native one returns the
 * directory entry's real spelling. That resolves Game.json/game.json aliases without
 * case-folding distinct Unicode names such as a dotted capital I and i + combining dot.
 */
export function identityRel(projectDir, rel, absFile) {
  try {
    const real = fs.realpathSync.native || fs.realpathSync;
    const root = real(path.resolve(projectDir));
    const actual = real(absFile || path.resolve(projectDir, String(rel)));
    const found = path.relative(root, actual);
    if (found === '..' || found.startsWith('..' + path.sep) || path.isAbsolute(found)) return normalizeRel(rel);
    return normalizeRel(found);
  } catch { return normalizeRel(rel); }
}

// The old readable slug folded every non-ASCII character to `_`, so for example rig_S
// with cedilla and rig_O with umlaut silently shared one trail. A readable folder is used
// only when that formula is lossless for the path; otherwise the folder keeps a readable
// prefix bound to the exact path by a SHA-256 digest. Normalization is identity: NFC and
// NFD spellings are different files on most filesystems and get different folders.
export const readableSlugOf = rel => String(rel).replace(/^[./\\]+/, '').replace(/[\\/]+/g, '__').replace(/[^\w.-]+/g, '_');

export const isReadableLossless = rel => {
  const exact = normalizeRel(rel);
  return !!exact && exact.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !part.includes('_'));
};

export const hashedSlugOf = rel => {
  const exact = normalizeRel(rel);
  const readable = exact.replace(/[\\/]+/g, '__').replace(/[^\p{L}\p{N}_.-]+/gu, '_').slice(0, 72) || 'file';
  return readable + '--' + crypto.createHash('sha256').update(exact).digest('hex');
};

export const slugOf = rel => isReadableLossless(rel) ? readableSlugOf(rel) : hashedSlugOf(rel);

const stampOf = d => d.toISOString().replace(/[:.]/g, '-');

function entryExists(file) {
  try { fs.lstatSync(file); return true; } catch { return false; }
}

function markerMatches(dir, rel) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8'));
    return !!marker && marker.path === normalizeRel(rel);
  } catch { return false; }
}

// A fresh lossless ASCII path keeps the readable folder name. If that folder already
// holds marker-less generations (an old, ambiguous trail), provenance is not claimed:
// new exact snapshots go to the hashed folder instead.
function dirIn(root, rel) {
  const preferred = path.join(root, slugOf(rel));
  if (!isReadableLossless(rel) || !entryExists(preferred) || markerMatches(preferred, rel)) return preferred;
  try {
    if (!fs.readdirSync(preferred).filter(f => f !== MARKER).length) return preferred;
  } catch { /* unreadable: do not claim it */ }
  return path.join(root, hashedSlugOf(rel));
}

/** The folder new generations of `rel` are written to. */
export const dirFor = (projectDir, rel) => dirIn(historyRoots(projectDir)[0], rel);

// Every folder, in every root, whose marker proves it belongs to exactly `rel`.
function exactDirs(projectDir, rel) {
  const out = [];
  for (const root of historyRoots(projectDir)) {
    const names = new Set([dirIn(root, rel), path.join(root, hashedSlugOf(rel))]);
    if (isReadableLossless(rel)) names.add(path.join(root, readableSlugOf(rel)));
    for (const dir of names) {
      if (!out.includes(dir) && isRealInside(projectDir, dir) && markerMatches(dir, rel)) out.push(dir);
    }
  }
  return out;
}

// Generation order. Fixed from legacy: it sorted file names as plain strings, and a
// same-millisecond suffix sorts BEFORE its base (`Z-1.json` < `Z.json`, and `-10` < `-2`),
// so the newer generation was listed as older and pruned first.
const STAMP = /^(.*?Z)(?:-(\d+))?(\.[^.]*)?$/;
function orderKey(file) {
  const m = STAMP.exec(file);
  return m ? [m[1], Number(m[2] ?? 0)] : [file.replace(/\.[^.]*$/, ''), 0];
}
function oldestFirst(a, b) {
  const [ka, na] = orderKey(a);
  const [kb, nb] = orderKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : na - nb;
}

// Generation files in one folder: everything but dotfiles (the marker and staged writes).
function generationFiles(dir) {
  return fs.readdirSync(dir).filter(f => !f.startsWith('.')).sort(oldestFirst);
}

function prune(dir) {
  try {
    const files = generationFiles(dir);
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* keep going */ }
    }
  } catch { /* unreadable: nothing to prune */ }
}

function prepareExactDir(projectDir, rel) {
  const dir = dirFor(projectDir, rel);
  let madeDir = false;
  let madeMarker = false;
  try {
    if (!entryExists(dir)) { fs.mkdirSync(dir, { recursive: false }); madeDir = true; }
    if (!isRealInside(projectDir, dir)) throw new Error('the history folder escapes the project');
    const markerFile = path.join(dir, MARKER);
    if (!entryExists(markerFile)) {
      fs.writeFileSync(markerFile, JSON.stringify({ path: normalizeRel(rel) }), { encoding: 'utf8', flag: 'wx' });
      madeMarker = true;
    }
    if (!markerMatches(dir, rel)) throw new Error('the history folder belongs to another file');
    return { dir, madeDir, madeMarker };
  } catch {
    if (madeMarker) try { fs.unlinkSync(path.join(dir, MARKER)); } catch { /* best effort */ }
    if (madeDir) try { fs.rmdirSync(dir); } catch { /* best effort */ }
    return null;
  }
}

function undoPrepared(prepared) {
  if (prepared?.madeMarker) try { fs.unlinkSync(path.join(prepared.dir, MARKER)); } catch { /* best effort */ }
  if (prepared?.madeDir) try { fs.rmdirSync(prepared.dir); } catch { /* best effort */ }
}

// Write one generation under its exact folder. The bytes are staged under a private
// name and linked into place, so a generation name never points at partial content and
// two writers in the same millisecond take `-1`, `-2`, ... instead of clobbering.
// Returns { stamp, prepared, written } or null; leaves nothing behind on failure.
function record(projectDir, bytes, rel, ext, now) {
  let prepared = null;
  let written = null;
  let staged = null;
  try {
    const root = historyRoots(projectDir)[0];
    // Check the nearest existing ancestor BEFORE mkdir: if the history root is a junction
    // to the outside, creating it would already be an outside write.
    if (!isRealInside(projectDir, root)) return null;
    fs.mkdirSync(root, { recursive: true });
    prepared = prepareExactDir(projectDir, rel);
    if (!prepared) return null;
    const base = stampOf(now || new Date());
    for (let n = 0; ; n++) {
      const stamp = base + (n ? '-' + n : '');
      const target = path.join(prepared.dir, stamp + ext);
      try {
        staged = path.join(prepared.dir, `.history-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
        fs.writeFileSync(staged, bytes, { flag: 'wx' });
        fs.linkSync(staged, target);
        written = target;
        fs.unlinkSync(staged);
        staged = null;
        return { stamp, prepared, written };
      } catch (e) {
        if (staged) try { fs.unlinkSync(staged); } catch { /* best effort */ }
        staged = null;
        if (written) throw e;
        if (!e || e.code !== 'EEXIST') throw e;
      }
    }
  } catch {
    if (staged) try { fs.unlinkSync(staged); } catch { /* best effort */ }
    if (written) try { fs.unlinkSync(written); } catch { /* best effort */ }
    undoPrepared(prepared);
    return null;
  }
}

const safeExt = ext => (ext && /^\.[A-Za-z0-9]+$/.test(ext) ? ext : '.json');

/**
 * Snapshot the file as it is RIGHT NOW. Returns the stamp, or null when there is nothing
 * to snapshot (a brand new file) or the history folder is not writable or not safe: a
 * failed backup must never stop the write it was protecting. Callers that must not write
 * without history check for null themselves.
 */
export function snapshot(projectDir, absFile, rel, now) {
  let bytes;
  try {
    if (!fs.existsSync(absFile)) return null;
    bytes = fs.readFileSync(absFile);
  } catch { return null; }
  const done = record(projectDir, bytes, identityRel(projectDir, rel, absFile), path.extname(absFile), now);
  if (!done) return null;
  prune(done.prepared.dir);
  return done.stamp;
}

/**
 * Seed a delivery's undo trail before the delivery exists: record `bytes` under the
 * TARGET identity without ever materialising them at the live target path. A new target
 * built from an immutable source would otherwise have a first "undo" that is a no-op.
 */
export function snapshotBytes(projectDir, bytes, rel, extension, now) {
  const done = record(projectDir, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), normalizeRel(rel), safeExt(extension), now);
  if (!done) return null;
  prune(done.prepared.dir);
  return done.stamp;
}

/**
 * Transactional variant: the generation is durable before the caller renames the live
 * file, but pruning waits until the caller's read-back succeeds. On rollback the new
 * generation (and any folder or marker created only for it) is removed, so a failed
 * publish cannot consume the oldest valid undo generation.
 * @returns {{ stamp: string, commit(): string|null, rollback(): boolean } | null}
 */
export function snapshotBytesDeferred(projectDir, bytes, rel, extension, now) {
  const done = record(projectDir, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), normalizeRel(rel), safeExt(extension), now);
  if (!done) return null;
  let closed = false;
  return {
    stamp: done.stamp,
    commit() {
      if (closed) return null;
      closed = true;
      prune(done.prepared.dir);
      return done.stamp;
    },
    rollback() {
      if (closed) return false;
      closed = true;
      fs.unlinkSync(done.written);
      undoPrepared(done.prepared);
      return true;
    },
  };
}

// Every exact generation of `rel` across roots, newest first. A name present in two
// roots is taken from the first (the write root).
function generations(projectDir, rel) {
  const seen = new Set();
  const out = [];
  for (const dir of exactDirs(projectDir, rel)) {
    let files;
    try { files = generationFiles(dir); } catch { continue; }
    for (const file of files) if (!seen.has(file)) { seen.add(file); out.push({ dir, file }); }
  }
  return out.sort((a, b) => oldestFirst(b.file, a.file));
}

const stampOfFile = f => f.replace(/\.[^.]+$/, '');

/**
 * Newest FIRST: the answer to "give me the last good one" is list()[0].
 * @returns {{ backup: string, file: string, size: number, time: string|null }[]}
 */
export function list(projectDir, rel) {
  return generations(projectDir, identityRel(projectDir, rel)).map(({ dir, file }) => {
    let size = 0;
    let time = null;
    try { const st = fs.statSync(path.join(dir, file)); size = st.size; time = st.mtime.toISOString(); } catch { /* vanished mid-listing */ }
    return { backup: stampOfFile(file), file, size, time };
  });
}

/**
 * The only evidence that the studio owns a file: exact-path history exists for it. A
 * readable slug folder without a matching marker is ambiguous by construction and never
 * qualifies.
 */
export const hasExactHistory = (projectDir, rel) => generations(projectDir, identityRel(projectDir, rel)).length > 0;

/**
 * Put a generation back. The CURRENT state is snapshotted first, so a restore is itself
 * undoable. Refusals: `outside-project`, `no-history`, `no-such-backup`, `write-failed`.
 * @returns {{ restored: string, previousState: string|null }}
 */
export function restore(projectDir, absFile, rel, stamp) {
  // Fixed from legacy: restore wrote wherever absFile pointed, so a path through a
  // junction to the outside could be overwritten with a project generation.
  if (!isRealInside(projectDir, absFile)) {
    throw new StudioError('outside-project', `Restore target resolves outside the project: ${rel}`, { file: String(rel) });
  }
  rel = identityRel(projectDir, rel, fs.existsSync(absFile) ? absFile : null);
  if (!exactDirs(projectDir, rel).length) {
    throw new StudioError('no-history', `No history for ${rel}: the studio never wrote it.`, { file: rel });
  }
  const all = generations(projectDir, rel);
  const hit = all.find(g => g.file === stamp || stampOfFile(g.file) === stamp);
  const available = all.map(g => stampOfFile(g.file));
  if (!hit) throw new StudioError('no-such-backup', `No backup "${stamp}" for ${rel}.`, { file: rel, available });
  // READ THE GENERATION FIRST. `snapshot` writes one more file into this same folder and
  // prunes to KEEP, so at the steady state the oldest one is deleted, and the oldest one
  // is exactly what a caller asking for the FIRST version wants. Measured in legacy
  // 2026-08-20: restoring the oldest returned ENOENT, the generation was gone, the live
  // file untouched, and every retry ate one more generation.
  let bytes;
  try { bytes = fs.readFileSync(path.join(hit.dir, hit.file)); } catch {
    throw new StudioError('no-such-backup', `Backup "${stamp}" for ${rel} could not be read.`, { file: rel, available });
  }
  const previousState = snapshot(projectDir, absFile, rel);
  try {
    fs.mkdirSync(path.dirname(absFile), { recursive: true });
    fs.writeFileSync(absFile, bytes);
  } catch (e) {
    throw new StudioError('write-failed', `Could not write ${rel}: ${e.message}`, { file: rel, reason: e.message });
  }
  return { restored: stampOfFile(hit.file), previousState };
}
