// The asset catalog: every piece of art, sound and data the owner has, found in one place.
//
// Three sources are read, and nothing in any of them is ever written:
//   project  the open project folder: images, atlases, skeletons, drawings, sounds, fonts, models,
//            Godot scenes. For these the catalog also knows what uses what (a skeleton its atlas,
//            an atlas its pages, a drawing a library item, a Godot scene its textures), so it can
//            say which files nothing uses.
//   library  the bundled packs (src/core/asset-library.js), with what in the project uses each item.
//   folders  asset folders the owner keeps outside any project (a folder of bought packs, a shared
//            art folder), listed in studio.config.json under `assetFolders`.
//
// "What changed since the last look" keeps a snapshot of the project and the folders in the
// studio's own state folder, never beside the owner's files: each look compares the disk with the
// snapshot and adds the differences to a change log; the owner (or the agent) marks the log as
// seen, and the next look lists only what came after. A file moved with its contents unchanged is
// one "moved" line, not a removal and an addition.
//
// Node-only (layer `core`), standard library only.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { listPacks, ASSET_ROOT } from './asset-library.js';

/** The kind of a file, by its extension. Files of any other extension are not catalogued. */
export const KIND_BY_EXT = Object.freeze({
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.bmp': 'image',
  '.tga': 'image', '.psd': 'image', '.svg': 'image', '.kra': 'image',
  '.aseprite': 'aseprite', '.ase': 'aseprite',
  '.atlas': 'atlas',
  '.json': 'data', '.skel': 'skeleton', '.spine': 'skeleton',
  '.wav': 'audio', '.mp3': 'audio', '.ogg': 'audio', '.flac': 'audio', '.m4a': 'audio',
  '.ttf': 'font', '.otf': 'font', '.woff': 'font', '.woff2': 'font',
  '.glb': 'model', '.gltf': 'model', '.fbx': 'model', '.obj': 'model', '.blend': 'model', '.dae': 'model',
  '.tscn': 'scene', '.scn': 'scene', '.tres': 'scene',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.mkv': 'video',
  '.html': 'page',
});
/** The kinds an answer can be narrowed to. `data` JSON is only listed when it is a skeleton or a drawing. */
export const KINDS = Object.freeze(['image', 'skeleton', 'drawing', 'atlas', 'aseprite', 'audio', 'font', 'model', 'scene', 'video', 'page']);
/** Kinds whose files are used by others; the rest (skeletons, drawings, scenes, pages) are what uses them. */
const USED_KINDS = new Set(['image', 'atlas', 'aseprite', 'audio', 'font', 'model', 'video']);

/** Folders never read: tools' own state, packages, engine caches, the studio's backups. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.backup', '.keyframe', '.godot', '.import',
  '__pycache__', '_Archive', 'Library', 'Temp', 'obj', '.vs', '.idea', '.vscode', 'dist']);
const REFERENCE_DIRS = new Set(['reference', 'references']);
export const LIMITS = Object.freeze({ files: 50000, depth: 10, readText: 4 * 1024 * 1024, hashBytes: 32 * 1024 * 1024, log: 2000 });

const toSlash = p => p.split(path.sep).join('/');
const extOf = name => (name.toLowerCase().endsWith('.atlas.txt') ? '.atlas' : path.extname(name).toLowerCase());

/**
 * Every catalogued file under `root`, without following links; `truncated` when the limit was hit;
 * `godotRoots` the folders (relative, '' for the root) that hold a project.godot.
 */
export function walk(root, { files = LIMITS.files, depth = LIMITS.depth } = {}) {
  const out = [];
  const godotRoots = new Set();
  let truncated = false;
  const visit = (abs, level) => {
    if (out.length >= files) { truncated = true; return; }
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= files) { truncated = true; return; }
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        if (level < depth) visit(full, level + 1);
        continue;
      }
      if (e.isFile() && e.name === 'project.godot') godotRoots.add(toSlash(path.relative(root, abs)));
      if (!e.isFile() || !(extOf(e.name) in KIND_BY_EXT)) continue;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      out.push({ rel: toSlash(path.relative(root, full)), abs: full, size: st.size, mtime: Math.round(st.mtimeMs) });
    }
  };
  visit(root, 0);
  return { files: out, truncated, godotRoots };
}

// --- image size and format, from the first bytes --------------------------------------------

const SVG_HEAD = 4096;
const JPEG_SCAN = 1 << 20;
const sized = (width, height, format) => (width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height), format } : null);

function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return sized(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5), 'JPEG');
    i += 2 + length;
  }
  return null;
}

function svgSize(text) {
  const tag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const attr = name => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i'))?.[1];
  const w = Number(attr('width')), h = Number(attr('height'));
  if (w > 0 && h > 0) return sized(w, h, 'SVG');
  const box = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
  return box ? sized(Number(box[1]), Number(box[2]), 'SVG') : null;
}

/** { width, height, format } of a PNG, JPEG, GIF, WebP, BMP, PSD, TGA or SVG, or null. */
export function imageInfo(abs) {
  let fd;
  try {
    fd = fs.openSync(abs, 'r');
    const head = Buffer.alloc(SVG_HEAD);
    const n = fs.readSync(fd, head, 0, SVG_HEAD, 0);
    const b = head.subarray(0, n);
    if (n >= 24 && b.toString('latin1', 1, 4) === 'PNG' && b.toString('latin1', 12, 16) === 'IHDR') return sized(b.readUInt32BE(16), b.readUInt32BE(20), 'PNG');
    if (n >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      const more = Buffer.alloc(JPEG_SCAN);
      return jpegSize(more.subarray(0, fs.readSync(fd, more, 0, JPEG_SCAN, 0)));
    }
    if (n >= 10 && b.toString('latin1', 0, 3) === 'GIF') return sized(b.readUInt16LE(6), b.readUInt16LE(8), 'GIF');
    if (n >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8X') return sized(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3), 'WebP');
      if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return sized(1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff), 'WebP'); }
      if (chunk === 'VP8 ') return sized(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff, 'WebP');
      return null;
    }
    if (n >= 26 && b.toString('latin1', 0, 2) === 'BM') return sized(b.readInt32LE(18), Math.abs(b.readInt32LE(22)), 'BMP');
    if (n >= 22 && b.toString('latin1', 0, 4) === '8BPS') return sized(b.readUInt32BE(18), b.readUInt32BE(14), 'PSD');
    const ext = path.extname(abs).toLowerCase();
    if (ext === '.tga' && n >= 18 && [1, 2, 3, 9, 10, 11].includes(b[2])) return sized(b.readUInt16LE(12), b.readUInt16LE(14), 'TGA');
    if (ext === '.svg') return svgSize(b.toString('utf8'));
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ } }
  return null;
}

// --- what uses what, inside the project -----------------------------------------------------

const readText = abs => { try { return fs.statSync(abs).size <= LIMITS.readText ? fs.readFileSync(abs, 'utf8') : null; } catch { return null; } };
const isSkeleton = v => v && typeof v === 'object' && Array.isArray(v.bones) && (v.skeleton || Array.isArray(v.slots));
const LIBRARY_REF = /asset:([a-z0-9-]+)\/([a-z0-9-]+)/g;
const ASSET_PATH = /\.(png|jpe?g|webp|gif|bmp|tga|psd|svg|atlas|wav|mp3|ogg|flac|m4a|ttf|otf|woff2?|glb|gltf|fbx|obj|aseprite|ase|mp4|webm)$/i;

/** Every string inside a JSON value (keys too), depth-limited. */
function stringsOf(value, out = [], depth = 0) {
  if (depth > 40 || out.length > 20000) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out, depth + 1);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(k); stringsOf(v, out, depth + 1); }
  return out;
}

/** The atlas a skeleton pairs with by name (x.json with x.atlas or x.atlas.txt), as a path relative to the root. */
function pairedAtlas(rel, have) {
  const stem = rel.replace(/\.json$/i, '');
  return [`${stem}.atlas`, `${stem}.atlas.txt`].find(r => have.has(r)) ?? null;
}

/** Page image names of a libGDX/Spine atlas text: the lines naming an image file, before their key: value lines. */
export function atlasPages(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.includes(':') && /\.(png|webp|jpe?g)$/i.test(l));
}

/** The images a skeleton without an atlas loads: <images>/<attachment path>.png (Spine's own rule). */
function looseImages(sk, rel) {
  const base = path.posix.dirname(rel);
  const images = typeof sk.skeleton?.images === 'string' && sk.skeleton.images ? sk.skeleton.images : './';
  const dir = path.posix.normalize(path.posix.join(base, images.replace(/\\/g, '/')));
  const skins = Array.isArray(sk.skins) ? sk.skins : Object.entries(sk.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));
  const out = [];
  for (const skin of skins) {
    for (const [, attachments] of Object.entries(skin?.attachments ?? {})) {
      for (const [name, a] of Object.entries(attachments ?? {})) {
        const type = a?.type ?? 'region';
        if (!['region', 'mesh', 'linkedmesh'].includes(type)) continue;
        out.push(path.posix.join(dir, String(a?.path ?? a?.name ?? name)));
      }
    }
  }
  const audio = typeof sk.skeleton?.audio === 'string' ? path.posix.join(base, sk.skeleton.audio.replace(/\\/g, '/')) : base;
  for (const e of Object.values(sk.events ?? {})) if (typeof e?.audio === 'string' && e.audio) out.push(path.posix.join(audio, e.audio));
  return out;
}

/** The folder holding project.godot above `rel` ('' for the root), or null. */
function godotRoot(rel, godotRoots) {
  let dir = path.posix.dirname(rel);
  for (;;) {
    if (godotRoots.has(dir === '.' ? '' : dir)) return dir === '.' ? '' : dir;
    if (dir === '.' || dir === '' || dir === '/') return null;
    dir = path.posix.dirname(dir);
  }
}

/**
 * What every file of the project uses. `files` are the walked entries; the answer maps a file to
 * the project files it uses (`uses`), and lists its library items (`library`, asset:<pack>/<item>).
 * Also sets `kind` of each JSON file: skeleton, drawing (keyframe-parts) or data.
 */
export function projectGraph(files, godotRoots = new Set()) {
  const have = new Set(files.map(f => f.rel));
  const lower = new Map(files.map(f => [f.rel.toLowerCase(), f.rel]));
  const find = rel => (have.has(rel) ? rel : lower.get(rel.toLowerCase()) ?? null);
  const uses = new Map(), library = new Map(), kinds = new Map();
  const add = (from, rel) => { const hit = rel && find(path.posix.normalize(rel)); if (hit && hit !== from) { if (!uses.has(from)) uses.set(from, new Set()); uses.get(from).add(hit); } };
  const addImage = (from, stem) => { if (ASSET_PATH.test(stem)) return add(from, stem); for (const ext of ['.png', '.webp', '.jpg']) add(from, stem + ext); };
  for (const f of files) {
    const ext = extOf(f.rel);
    const kind = KIND_BY_EXT[ext];
    if (!['data', 'atlas', 'scene', 'page'].includes(kind)) continue;
    const text = readText(f.abs);
    if (text === null) continue;
    const here = path.posix.dirname(f.rel);
    const relTo = s => path.posix.join(here, s.replace(/\\/g, '/'));
    if (kind === 'atlas') { for (const page of atlasPages(text)) add(f.rel, relTo(page)); continue; }
    if (kind === 'scene') {
      const groot = godotRoot(f.rel, godotRoots);
      for (const m of text.matchAll(/res:\/\/([^"'\s)]+)/g)) add(f.rel, groot === null ? m[1] : path.posix.join(groot, m[1]));
      continue;
    }
    if (kind === 'page') { for (const m of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"':?#]+)["']/gi)) add(f.rel, relTo(m[1])); continue; }
    let value;
    try { value = JSON.parse(text); } catch { continue; }
    if (isSkeleton(value)) {
      kinds.set(f.rel, 'skeleton');
      const atlas = pairedAtlas(f.rel, have);
      if (atlas) add(f.rel, atlas); else for (const img of looseImages(value, f.rel)) addImage(f.rel, img);
    } else if (value?.format === 'keyframe-parts') kinds.set(f.rel, 'drawing');
    for (const s of stringsOf(value)) {
      for (const m of s.matchAll(LIBRARY_REF)) { if (!library.has(f.rel)) library.set(f.rel, new Set()); library.get(f.rel).add(`asset:${m[1]}/${m[2]}`); }
      if (s.length < 400 && ASSET_PATH.test(s) && !/^[a-z]+:\/\//i.test(s)) { add(f.rel, relTo(s)); add(f.rel, s.replace(/^\.?\//, '')); }
    }
    // A drawing belongs to the rig it builds: <name>.parts.json makes <name>.json, .atlas, .png, .svg.
    if (kinds.get(f.rel) === 'drawing') { const stem = f.rel.replace(/\.parts\.json$/i, ''); for (const e of ['.json', '.atlas', '.png', '.svg']) add(f.rel, stem + e); }
  }
  return { uses, library, kinds };
}

// --- the catalog --------------------------------------------------------------------------

const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0131/g, 'i').toLowerCase();

/**
 * The whole catalog. `projectDir` may be null (no project open); `folders` are absolute paths.
 * @returns {{ sources: object[], assets: object[] }}
 */
export function buildCatalog({ projectDir = null, folders = [], libraryRoot = ASSET_ROOT } = {}) {
  projectDir = projectDir && path.resolve(projectDir);
  folders = [...new Set(folders.map(f => path.resolve(f)))];
  const sources = [];
  const assets = [];
  const libraryUsers = new Map();
  if (projectDir && fs.existsSync(projectDir)) {
    const { files, truncated, godotRoots } = walk(projectDir);
    const graph = projectGraph(files, godotRoots);
    const usedBy = new Map();
    for (const [from, set] of graph.uses) for (const to of set) { if (!usedBy.has(to)) usedBy.set(to, []); usedBy.get(to).push(from); }
    for (const [from, set] of graph.library) for (const ref of set) { if (!libraryUsers.has(ref)) libraryUsers.set(ref, []); libraryUsers.get(ref).push(from); }
    let count = 0;
    for (const f of files) {
      const kind = graph.kinds.get(f.rel) ?? KIND_BY_EXT[extOf(f.rel)];
      if (kind === 'data') continue;
      count += 1;
      const entry = { source: 'project', path: f.rel, name: path.posix.basename(f.rel), kind, size: f.size, mtime: f.mtime };
      if (kind === 'image') entry.image = imageInfo(f.abs);
      if (USED_KINDS.has(kind)) {
        const by = usedBy.get(f.rel) ?? [];
        entry.usage = by.length ? 'used' : REFERENCE_DIRS.has(f.rel.split('/')[0].toLowerCase()) ? 'reference' : 'unreferenced';
        entry.usedBy = by.sort();
      }
      const own = [...(graph.uses.get(f.rel) ?? []), ...(graph.library.get(f.rel) ?? [])].sort();
      if (own.length) entry.uses = own;
      assets.push(entry);
    }
    sources.push({ source: 'project', root: projectDir, files: count, ...(truncated ? { truncated: true } : {}) });
  }
  let libraryCount = 0;
  for (const pack of listPacks(libraryRoot)) {
    if (pack.problems) continue;
    for (const item of pack.items) {
      const abs = path.join(libraryRoot, pack.id, item.file);
      let size = null;
      try { size = fs.statSync(abs).size; } catch { /* listed by pack.json, checked by its gate */ }
      const by = (libraryUsers.get(item.ref) ?? []).sort();
      assets.push({ source: 'library', path: `${pack.id}/${item.file}`, name: item.file, kind: 'image', ref: item.ref, pack: pack.id,
        license: pack.license, tags: item.tags, size, image: imageInfo(abs), ...(projectDir ? { usage: by.length ? 'used' : 'unreferenced', usedBy: by } : {}) });
      libraryCount += 1;
    }
  }
  sources.push({ source: 'library', root: libraryRoot, files: libraryCount });
  for (const folder of folders) {
    if (!fs.existsSync(folder)) { sources.push({ source: 'folder', root: folder, files: 0, missing: true }); continue; }
    const { files, truncated } = walk(folder);
    let count = 0;
    for (const f of files) {
      let kind = KIND_BY_EXT[extOf(f.rel)];
      if (kind === 'data') {
        const text = f.size <= LIMITS.readText ? readText(f.abs) : null;
        let v = null;
        try { v = text && JSON.parse(text); } catch { /* not JSON */ }
        if (isSkeleton(v)) kind = 'skeleton'; else if (v?.format === 'keyframe-parts') kind = 'drawing'; else continue;
      }
      count += 1;
      const entry = { source: 'folder', root: folder, path: f.rel, name: path.posix.basename(f.rel), kind, size: f.size, mtime: f.mtime };
      if (kind === 'image') entry.image = imageInfo(f.abs);
      assets.push(entry);
    }
    sources.push({ source: 'folder', root: folder, files: count, ...(truncated ? { truncated: true } : {}) });
  }
  return { sources, assets };
}

/** The catalog entries matching a search: every word of `query` in the path, tags, pack or kind. */
export function searchCatalog(assets, { query = '', kind = [], source = 'all', usage = null, folder = null } = {}) {
  const words = fold(query).split(/[\s/_.-]+/).filter(Boolean);
  const kinds = new Set(kind);
  return assets.filter(a => {
    if (source !== 'all' && a.source !== source) return false;
    if (folder && a.root !== folder) return false;
    if (kinds.size && !kinds.has(a.kind)) return false;
    if (usage && a.usage !== usage) return false;
    if (!words.length) return true;
    const hay = fold(`${a.path} ${a.kind} ${a.pack ?? ''} ${(a.tags ?? []).join(' ')} ${a.image?.format ?? ''}`);
    return words.every(w => hay.includes(w));
  });
}

/** How many of each kind, usage and source. */
export function countsOf(assets) {
  const counts = { kinds: {}, usage: {}, sources: {} };
  for (const a of assets) {
    counts.kinds[a.kind] = (counts.kinds[a.kind] ?? 0) + 1;
    counts.sources[a.source] = (counts.sources[a.source] ?? 0) + 1;
    if (a.usage) counts.usage[a.usage] = (counts.usage[a.usage] ?? 0) + 1;
  }
  return counts;
}

// --- what changed since the last look -----------------------------------------------------

const SNAPSHOT = 'snapshot.json', LOG = 'changes.jsonl', SEEN = 'seen.json';
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file); };

/** The state folder of one project's catalog: under the studio's data, keyed by the project path. */
export function stateDirFor(dataDir, projectDir) {
  const key = crypto.createHash('sha1').update(path.resolve(projectDir ?? '-')).digest('hex').slice(0, 16);
  return path.join(dataDir, 'state', 'assets', key);
}

function hashOf(abs, size) {
  if (size > LIMITS.hashBytes) return null;
  try { return crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex'); } catch { return null; }
}

/**
 * Compare the disk with the last snapshot, log the differences, and answer what came after the
 * last "seen" mark. The first look of a source only records it (`baseline`).
 * @param {{ sources: object[], assets: object[] }} catalog
 * @param {string} stateDir
 * @param {{ markSeen?: boolean, now?: number, limit?: number, offset?: number }} [options]
 */
export function lookForChanges(catalog, stateDir, { markSeen = false, now = Date.now(), limit = 25, offset = 0 } = {}) {
  fs.mkdirSync(stateDir, { recursive: true });
  const before = readJson(path.join(stateDir, SNAPSHOT), { roots: [], files: {} });
  const knownRoots = new Set(before.roots);
  const files = {};
  const tracked = catalog.assets.filter(a => a.source !== 'library');
  for (const a of tracked) {
    const root = a.source === 'project' ? catalog.sources.find(s => s.source === 'project').root : a.root;
    const key = `${a.source === 'project' ? 'project' : root}|${a.path}`;
    const old = before.files[key];
    const hash = old && old.size === a.size && old.mtime === a.mtime ? old.hash : hashOf(path.join(root, a.path), a.size);
    files[key] = { size: a.size, mtime: a.mtime, hash };
  }
  const roots = catalog.sources.filter(s => s.source !== 'library' && !s.missing).map(s => (s.source === 'project' ? 'project' : s.root));
  const rootOf = key => key.slice(0, key.indexOf('|'));
  const pathOf = key => key.slice(key.indexOf('|') + 1);
  const sourceOf = root => (root === 'project' ? { source: 'project' } : { source: 'folder', root });
  const fresh = roots.filter(r => !knownRoots.has(r));
  const lines = [];
  const added = Object.keys(files).filter(k => !(k in before.files) && knownRoots.has(rootOf(k)));
  const removed = Object.keys(before.files).filter(k => !(k in files) && roots.includes(rootOf(k)));
  const movedFrom = new Set();
  for (const k of added) {
    const h = files[k].hash;
    const from = h && removed.find(r => !movedFrom.has(r) && rootOf(r) === rootOf(k) && before.files[r].hash === h);
    if (from) { movedFrom.add(from); lines.push({ time: now, what: 'moved', ...sourceOf(rootOf(k)), path: pathOf(k), from: pathOf(from) }); }
    else lines.push({ time: now, what: 'added', ...sourceOf(rootOf(k)), path: pathOf(k) });
  }
  for (const k of removed) if (!movedFrom.has(k)) lines.push({ time: now, what: 'removed', ...sourceOf(rootOf(k)), path: pathOf(k) });
  for (const [k, f] of Object.entries(files)) {
    const old = before.files[k];
    if (!old) continue;
    const differs = f.hash && old.hash ? f.hash !== old.hash : f.size !== old.size || f.mtime !== old.mtime;
    if (differs) lines.push({ time: now, what: 'changed', ...sourceOf(rootOf(k)), path: pathOf(k) });
  }
  // Roots not read this time (a folder taken off the list) keep their files in the snapshot.
  const kept = Object.fromEntries(Object.entries(before.files).filter(([k]) => !roots.includes(rootOf(k))));
  writeJson(path.join(stateDir, SNAPSHOT), { roots: [...new Set([...before.roots, ...roots])], files: { ...kept, ...files } });
  const logFile = path.join(stateDir, LOG);
  let log = [];
  try { log = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { /* first look */ }
  log.push(...lines);
  if (lines.length) { log = log.slice(-LIMITS.log); fs.writeFileSync(logFile, log.map(l => JSON.stringify(l)).join('\n') + '\n'); }
  const seen = readJson(path.join(stateDir, SEEN), { time: null });
  const since = log.filter(l => seen.time === null || l.time > seen.time).reverse();
  if (markSeen) writeJson(path.join(stateDir, SEEN), { time: now });
  return {
    since: seen.time, total: since.length, offset, changes: since.slice(offset, offset + limit),
    ...(fresh.length ? { baseline: fresh.map(r => (r === 'project' ? 'project' : r)) } : {}),
    ...(markSeen ? { markedSeen: now } : {}),
  };
}
