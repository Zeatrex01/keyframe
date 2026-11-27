// The standalone player: one HTML file that plays a skeleton by double-click, with no studio, no
// server and no network. The studio's engine, the skeleton and its atlas pages are all inside.
//
// The engine is plain ES modules; a page opened from disk cannot import them, so they are joined
// here into one classic script: each module becomes a factory in a small registry, its imports
// read from the registry and its exports returned. No bundler, no dependency.
//
// Node-only (layer `deliver`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioError } from '../shared/errors.js';
import { bootStandalone } from './standalone-boot.js';
import { parseAtlas } from '../engine/atlas.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** What the page needs from the engine; everything they import comes along. */
const ENTRIES = ['engine/index.js', 'engine/canvas.js', 'engine/keyframe-format.js'];

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm;
const REEXPORT = /^export\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm;
const LOCAL_EXPORT = /^export\s*\{([^}]*)\};?\s*$/gm;
const DECLARATION = /^export\s+(async\s+function\*?|function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

const names = list => list.split(',').map(s => s.trim()).filter(Boolean).map(s => {
  const [name, alias] = s.split(/\s+as\s+/);
  return { name: name.trim(), alias: (alias ?? name).trim() };
});

/** One module's source as a registry factory body; `deps` collects what it imports. */
export function moduleFactory(source, id) {
  const deps = [];
  const exported = [];
  const resolve = spec => {
    if (!spec.startsWith('.')) throw new StudioError('bad-argument', `${id}: only relative imports can be bundled (${spec}).`);
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
    deps.push(dep);
    return dep;
  };
  let reexports = 0;
  let body = source
    .replace(REEXPORT, (_, list, spec) => {
      const ref = `__re${reexports++}`;
      for (const n of names(list)) exported.push(`${JSON.stringify(n.alias)}: ${ref}.${n.name}`);
      return `const ${ref} = __require(${JSON.stringify(resolve(spec))});`;
    })
    .replace(IMPORT, (_, list, spec) => `const { ${names(list).map(n => (n.name === n.alias ? n.name : `${n.name}: ${n.alias}`)).join(', ')} } = __require(${JSON.stringify(resolve(spec))});`)
    .replace(LOCAL_EXPORT, (_, list) => { for (const n of names(list)) exported.push(`${JSON.stringify(n.alias)}: ${n.name}`); return ''; })
    .replace(DECLARATION, (_, kind, name) => { exported.push(`${JSON.stringify(name)}: ${name}`); return `${kind} ${name}`; });
  if (/^\s*(import|export)\b/m.test(body)) throw new StudioError('bad-argument', `${id}: a module form the bundler does not handle.`);
  body += `\nreturn { ${exported.join(', ')} };`;
  return { body, deps };
}

/** The engine as one classic script defining `__require(id)`. */
export function bundleEngine(entries = ENTRIES, root = SRC) {
  const factories = new Map();
  const visit = id => {
    if (factories.has(id)) return;
    const file = path.join(root, id);
    if (!fs.existsSync(file)) throw new StudioError('file-not-found', `The bundler cannot find ${id}.`);
    const { body, deps } = moduleFactory(fs.readFileSync(file, 'utf8'), id);
    factories.set(id, body);
    deps.forEach(visit);
  };
  entries.forEach(visit);
  const parts = [...factories].map(([id, body]) => `__modules[${JSON.stringify(id)}] = function () {\n${body}\n};`);
  return `'use strict';
const __modules = {}, __cache = {};
function __require(id) {
  if (!(id in __cache)) { if (!__modules[id]) throw new Error('Missing module ' + id); __cache[id] = __modules[id](); }
  return __cache[id];
}
${parts.join('\n')}`;
}

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** JSON that is safe inside a <script> element. */
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * The standalone player page.
 * @param {{ skeleton: object, atlasText: string, pages: Record<string, Buffer|Uint8Array>, title?: string,
 *   animation?: string, background?: string }} input  pages: atlas page name -> image bytes
 * @returns {string} the HTML
 */
export function standalonePlayer({ skeleton, atlasText, pages, title = 'Keyframe player', animation, background = '#14121c' }) {
  if (!skeleton || typeof skeleton !== 'object') throw new StudioError('bad-argument', 'A standalone player needs a skeleton.');
  if (!/^#[0-9a-f]{3,8}$/i.test(background)) throw new StudioError('bad-argument', 'The background is a hex colour like #14121c.', { background });
  if (typeof atlasText !== 'string') throw new StudioError('bad-argument', 'A standalone player needs the skeleton\'s atlas.');
  const images = {};
  for (const [name, bytes] of Object.entries(pages)) {
    const mime = MIME[path.extname(name).toLowerCase()] ?? 'image/png';
    images[name] = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  const data = { skeleton, atlasText, images, animation: animation ?? null, background };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Keyframe Studio">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${escapeHtml(background)}; color: #ece9f5; font: 14px/1.4 system-ui, sans-serif; }
  body { display: flex; flex-direction: column; }
  canvas { flex: 1; width: 100%; min-height: 0; display: block; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: rgba(0,0,0,.35); flex-wrap: wrap; }
  .bar button, .bar select { font: inherit; color: inherit; background: #2a2638; border: 1px solid #4a4560; border-radius: 6px; padding: 4px 10px; }
  .bar button:focus-visible, .bar select:focus-visible { outline: 2px solid #f5b544; outline-offset: 1px; }
  .bar .time { margin-left: auto; font-variant-numeric: tabular-nums; opacity: .8; }
  .error { padding: 24px; }
</style>
</head>
<body>
<canvas aria-label="${escapeHtml(title)}"></canvas>
<div class="bar"><select aria-label="Animation"></select><select aria-label="Layer" data-act="layer" title="Play a second clip over this one"><option value="">No layer</option></select><button type="button" data-act="play">Pause</button><button type="button" data-act="loop" aria-pressed="true">Loop</button><select aria-label="Speed" data-act="speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><span class="time"></span></div>
<script>
${bundleEngine()}
const KEYFRAME_DATA = ${scriptJson(data)};
(${bootStandalone.toString()})(__require, KEYFRAME_DATA);
</script>
</body>
</html>
`;
}

/**
 * Build the standalone player for a skeleton file on disk (its atlas beside it).
 * @param {string} skeletonFile @param {{ atlas?: string, title?: string, animation?: string }} [options]
 */
export function standalonePlayerFor(skeletonFile, { atlas, title, animation } = {}) {

  let skeleton;
  try { skeleton = JSON.parse(fs.readFileSync(skeletonFile, 'utf8')); } catch (err) {
    throw new StudioError('bad-skeleton', `${path.basename(skeletonFile)} could not be read as JSON: ${err.message}`);
  }
  const atlasFile = atlas ?? skeletonFile.replace(/(\.keyframe)?\.json$/i, '.atlas');
  if (!fs.existsSync(atlasFile)) throw new StudioError('file-not-found', `No atlas beside ${path.basename(skeletonFile)} (looked for ${path.basename(atlasFile)}).`);
  const atlasText = fs.readFileSync(atlasFile, 'utf8');
  /** @type {Record<string, Buffer>} */
  const pages = {};
  for (const { name } of parseAtlas(atlasText).pages) {
    const file = path.join(path.dirname(atlasFile), name);
    if (!fs.existsSync(file)) throw new StudioError('file-not-found', `The atlas page ${name} is missing.`, { page: name });
    pages[name] = fs.readFileSync(file);
  }
  return standalonePlayer({ skeleton, atlasText, pages, title: title ?? path.basename(skeletonFile).replace(/(\.keyframe)?\.json$/i, ''), animation });
}
