// find_assets — the asset catalog (src/core/asset-catalog.js) for the agent: what art, sound and
// data the owner has in the project, in the bundled library and in their own asset folders; what
// uses what, what nothing uses, and what changed since the last look.

import fs from 'node:fs';
import path from 'node:path';
import { buildCatalog, searchCatalog, countsOf, lookForChanges, stateDirFor, KINDS } from '../../core/asset-catalog.js';
import { readConfig, writeConfig } from '../../core/projects.js';
import { resolvePaths } from '../../core/app-paths.js';
import { StudioError } from '../../shared/errors.js';

const LIMIT = 25;
const MAX_LIMIT = 200;
const CACHE_MS = 3000;
let cache = null;

const dataDir = () => path.dirname(resolvePaths().configFile);
/** The owner's asset folders, from studio.config.json (`assetFolders`). */
export function assetFolders() {
  const list = readConfig().assetFolders;
  return Array.isArray(list) ? list.filter(f => typeof f === 'string' && path.isAbsolute(f)) : [];
}
function setFolders(folders) {
  const config = readConfig();
  writeConfig({ ...config, assetFolders: [...new Set(folders)] });
}

/** The catalog for this project and these folders, read again after a few seconds. */
export function catalogFor(projectDir, folders, { fresh = false } = {}) {
  const key = JSON.stringify([projectDir, folders]);
  if (!fresh && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.catalog;
  const catalog = buildCatalog({ projectDir, folders });
  cache = { key, at: Date.now(), catalog };
  return catalog;
}

/** One row of a list answer: what an agent needs to pick, nothing it has to skip over. */
export function briefRow(a) {
  return {
    source: a.source, path: a.path, kind: a.kind,
    ...(a.root && a.source === 'folder' ? { root: a.root } : {}),
    ...(a.ref ? { ref: a.ref } : {}),
    ...(a.image ? { image: `${a.image.width}x${a.image.height} ${a.image.format}` } : {}),
    ...(a.usage ? { usage: a.usage } : {}),
    ...(a.size !== null && a.size !== undefined ? { size: a.size } : {}),
  };
}

function oneAsset(catalog, file, source) {
  const want = String(file).replace(/\\/g, '/');
  const hits = catalog.assets.filter(a => (source === 'all' || a.source === source)
    && (a.path === want || a.ref === want || (a.root && path.join(a.root, a.path) === path.normalize(file))));
  if (!hits.length) throw new StudioError('asset-not-found', `No catalogued asset "${file}". Search first (query), then pass a row's path, ref or root + path.`, { file });
  const a = hits[0];
  const root = a.source === 'project' ? catalog.sources.find(s => s.source === 'project')?.root : a.root ?? catalog.sources.find(s => s.source === 'library')?.root;
  return { ...a, file: root ? path.join(root, a.path) : null, ...(hits.length > 1 ? { alsoIn: hits.slice(1).map(briefRow) } : {}) };
}

export default {
  name: 'find_assets',
  tier: 'core',
  writes: false,
  summary: 'Finds the owner\'s art, sounds and fonts in the project, the library and their asset folders: search, what uses what, unused files, what changed.',
  description: `One catalog of everything the owner has to build with, read from disk and never written:
- project: the open folder's images, atlases, skeletons, drawings (<name>.parts.json), Aseprite files, sounds, fonts, models, Godot scenes and pages, with what uses what (a skeleton its atlas or its loose images, an atlas its page images, a drawing its rig files and library items, a Godot scene its res:// files, any JSON the files it names) and so the usage of each image, atlas, sound, font and model: used, unreferenced (nothing in the project names it) or reference (in reference/).
- library: the bundled packs (ref asset:<pack>/<item>, which draw_rig's svg and add_effect's art take), with what in the project uses each item.
- folder: the owner's own asset folders outside any project (bought packs, a shared art folder), kept in the studio's list; add one with \`folder\` and \`remember: true\`, take it off with \`forget\`.
List answers are brief rows (source, path, kind, image size, usage, size), ${LIMIT} at a time with the total; \`file\` gives one asset in full (absolute file, uses, used by, license). Search words all have to match the path, tags, pack or kind, in any language's letters.
\`changes: true\` answers what was added, changed, moved or removed in the project and the folders since the last "seen" mark (the first look records a baseline); \`mark_seen: true\` sets the mark after answering, so the next look starts from here. The snapshot lives in the studio's own data, never beside the owner's files.
Before drawing new art, look here for art the owner already has.`,
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      query: { type: 'string', short: 'words', description: 'Words that all have to appear in the path, tags, pack or kind (coin, tree png, ui button). Empty lists everything.' },
      kind: { type: 'array', items: { type: 'string', enum: [...KINDS] }, short: 'kinds', description: `Only these kinds: ${KINDS.join(', ')}.` },
      source: { type: 'string', enum: ['all', 'project', 'library', 'folder'], short: 'where (all)', description: 'Where to look: all (default), the project, the bundled library or the owner\'s asset folders.' },
      usage: { type: 'string', enum: ['used', 'unreferenced', 'reference'], short: 'usage', description: 'Only project and library assets with this usage: unreferenced lists what nothing in the project uses.' },
      file: { type: 'string', short: 'one in full', description: 'One asset in full: a row\'s path (project or library), its ref (asset:<pack>/<item>), or the absolute file of a folder row (root + path).' },
      changes: { type: 'boolean', short: 'since last look', description: 'Answer what was added, changed, moved or removed since the last "seen" mark, newest first, instead of the list.' },
      mark_seen: { type: 'boolean', short: 'mark seen', description: 'With changes: mark everything answered as seen, so the next look lists only what comes after.' },
      folder: { type: 'string', short: 'extra folder', description: 'An absolute folder to look in as well (a folder of packs the owner keeps outside the project).' },
      remember: { type: 'boolean', short: 'keep folder', description: 'With folder: keep it in the studio\'s list of asset folders (studio.config.json, assetFolders), so every later look includes it.' },
      forget: { type: 'string', short: 'drop folder', description: 'An absolute folder to take off the studio\'s list of asset folders; the folder itself is not touched.' },
      offset: { type: 'integer', minimum: 0, short: 'skip rows', description: 'Skip this many rows (default 0), to page through a long answer.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, short: `rows (${LIMIT})`, description: `Rows per answer, default ${LIMIT}, at most ${MAX_LIMIT}.` },
    },
  },
  run({ query = '', kind = [], source = 'all', usage, file, changes = false, mark_seen = false, folder, remember = false, forget, offset = 0, limit = LIMIT }, { session }) {
    if (mark_seen && !changes) throw new StudioError('bad-argument', 'mark_seen goes with changes: true.', {});
    if (remember && !folder) throw new StudioError('bad-argument', 'remember goes with folder: the absolute folder to keep.', {});
    for (const [name, value] of [['folder', folder], ['forget', forget]]) {
      if (value !== undefined && !path.isAbsolute(value)) throw new StudioError('bad-argument', `${name} is an absolute folder path.`, { [name]: value });
    }
    if (folder) {
      let isDir = false;
      try { isDir = fs.statSync(folder).isDirectory(); } catch { /* missing */ }
      if (!isDir) throw new StudioError('file-not-found', `No folder at ${folder}.`, { folder });
    }
    let folders = assetFolders();
    if (forget) { folders = folders.filter(f => path.resolve(f) !== path.resolve(forget)); setFolders(folders); }
    if (folder && remember && !folders.some(f => path.resolve(f) === path.resolve(folder))) { folders = [...folders, path.resolve(folder)]; setFolders(folders); }
    const looked = folder && !folders.some(f => path.resolve(f) === path.resolve(folder)) ? [...folders, path.resolve(folder)] : folders;
    const projectDir = session?.dir ? path.resolve(session.dir) : null;
    const catalog = catalogFor(projectDir, looked, { fresh: changes });
    const { sources } = catalog;
    if (file) return { asset: oneAsset(catalog, file, source) };
    if (changes) return { ...lookForChanges(catalog, stateDirFor(dataDir(), projectDir), { markSeen: mark_seen, offset, limit }), sources };
    const found = searchCatalog(catalog.assets, { query, kind, source, usage: usage ?? null });
    return {
      total: found.length, offset, assets: found.slice(offset, offset + limit).map(briefRow), counts: countsOf(found), sources,
      ...(folders.length || folder ? {} : { note: 'No asset folder of the owner\'s is listed yet: pass folder (absolute) with remember: true to add one.' }),
      ...(projectDir ? {} : { project: null }),
    };
  },
};
