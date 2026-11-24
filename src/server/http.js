// The HTTP surface the studio page talks to. Local only: it listens on 127.0.0.1 and answers
// only requests addressed to that host, so another site in the browser cannot reach it.
//
// The page never writes a skeleton. It reads state and files, sends the owner's words to the
// conversation, uploads a reference video, and can restore a backup (through the same tool an
// agent would use). When the owner chose an agent CLI for the director slot, their message also
// starts it headless (src/agent); its answer comes back into the same conversation.
//
// This file is the server and its route table. What a response looks like is respond.js; what the
// page polls is state.js.

import { readFeed } from '../core/draw-feed.js';
import { safeTree } from '../render/svg-safe.js';
import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createMcp } from '../mcp/server.js';
import { projectOf } from '../mcp/project.js';
import { projectStyle } from '../mcp/style-file.js';
import { projectFolders, insideProjectReal, isRealInside } from '../core/paths.js';
import { readMessages, appendMessage, readAgent } from '../core/chat.js';
import { writeFocus, clearFocus } from '../core/focus.js';
import { fetchReference } from '../core/ytdlp.js';
import { detectAddons, addonStatus } from '../core/addons.js';
import { spineAddonStatus, installSpineRuntime, removeSpineRuntime, locateSpineRuntime } from '../core/spine-addon.js';
import { connectionFor } from '../core/connect.js';
import { StudioError } from '../shared/errors.js';
import { listProjects, currentProject, openProject, createProject, forgetProject } from '../core/projects.js';
import { zipFolder } from '../core/zip.js';
import { resolvePaths } from '../core/app-paths.js';
import { silentLogger } from '../core/log.js';
import { findSkeletons, isExportFolder } from '../deliver/write.js';
import { standalonePlayerFor } from '../deliver/standalone.js';
import { SECURITY_HEADERS, send, refuse, refuseError, statusFor, readBody, readJson, sendFile } from './respond.js';
import { createStateReader, REFERENCE_TYPES } from './state.js';
import { createAgentHub } from '../agent/hub.js';
import { listPacks, ASSET_ROOT } from '../core/asset-library.js';
import { PARTS_FORMAT } from '../render/svg-rig.js';
import { copyExample, findExample, listExamples } from './examples.js';

export { statusFor } from './respond.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECT_TYPES = new Set(['.json', '.atlas', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov']);
const STATIC_ROOTS = { web: path.join(ROOT, 'web'), locale: path.join(ROOT, 'locale'), opening: path.join(ROOT, 'examples', 'opening'), assets: ASSET_ROOT };
// The page plays on the studio's own engine, imported as is: only these isomorphic modules are served.
const PAGE_SOURCES = new Set(['engine', 'shared', 'spine', 'art']);   // the board redraws AI-drawn parts in the guide (src/art/edit.js)
// What the Spine add-on serves to the page when it is on (src/core/spine-addon.js).
const SPINE_FILES = new Set(['spine-player.min.js', 'spine-player.min.css']);
const MAX_JSON = 64 * 1024;
const MAX_UPLOAD = 300 * 1024 * 1024;

/**
 * Save an uploaded reference without ever replacing a file already there (the one-way rule): the
 * owner's own recording, or the clip a focus and a measured motion were taken from. A taken name
 * becomes "name (2).ext", "name (3).ext"; the exclusive flag makes the check and the write one step,
 * so a case-insensitive disk and a link already at that name are refused too.
 * @returns {string} the file name used
 */
export function saveReference(projectDir, folder, name, data) {
  fs.mkdirSync(folder, { recursive: true });
  if (!isRealInside(projectDir, path.join(folder, name))) throw new StudioError('outside-project', 'The reference folder leads outside the project through a link.', {});
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n <= 1000; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    try { fs.writeFileSync(path.join(folder, candidate), data, { flag: 'wx' }); return candidate; } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  throw new StudioError('name-taken', `Too many references are named ${name}; rename the file and add it again.`, { name });
}

/** How an agent connects: the MCP server of this checkout, as each client writes it (src/core/connect.js). */
export function connectionBlocks(root = ROOT) {
  const { server, clients } = connectionFor(root);
  const text = id => clients.find(c => c.id === id).text;
  return { server, claudeCommand: text('claude-code'), claudeJson: text('claude-desktop'), codexToml: text('codex'), clients };
}

/** The optional programs and whether each is here: the add-on contract in src/core/addons.js. */
export { addonStatus as addons } from '../core/addons.js';

/** A string field of a JSON body, or a 400 that names it. */
function text(body, key, { optional = false } = {}) {
  const value = body[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new StudioError('bad-argument', `"${key}" must be a non-empty string.`, { key });
  return value;
}

/**
 * @param {object} options
 * @param {string} [options.projectDir] open this folder now; empty opens the project last open in the studio, if any
 * @param {string} options.version
 * @param {string} [options.configFile] the registry file (gates isolate themselves with it)
 * @param {number} [options.maxUpload] the largest reference upload in bytes (gates lower it)
 * @param {ReturnType<typeof import('../core/log.js').createLogger>} [options.log] where requests and failures are logged
 * @param {NodeJS.ProcessEnv} [options.agentEnv] where agent CLIs are looked up and what they run with (gates stand a fake CLI in)
 * @returns {{ server: import('node:http').Server, agents: ReturnType<typeof createAgentHub>, listen(port?: number): Promise<number>, close(): Promise<void> }}
 */
export function createStudioServer({ projectDir, version, configFile, maxUpload = MAX_UPLOAD, log = silentLogger, agentEnv = process.env }) {
  const registry = { file: configFile };
  // The open project can change while the server runs (the Projects view), so everything below
  // reads `dir` and `project` when it is called. The in-page MCP session reads session.dir per call.
  const session = { dir: null, writable: () => !!session.dir };
  let dir = null, project = null;
  // Optional add-ons (src/core/addons.js), looked up once: a program installed later needs a restart.
  const found = detectAddons();
  const ytdlp = found.ytdlp, ffmpeg = found.ffmpeg;
  const views = createStateReader({ dir: () => dir, project: () => project, version, canReadVideo: ffmpeg !== null, canFetchLink: ytdlp !== null });
  const agents = createAgentHub({ configFile: registry.file, env: agentEnv, log });
  const bind = folder => { dir = folder; session.dir = folder; project = folder ? projectOf(session) : null; views.reset(); };
  bind(projectDir ? openProject(projectDir, registry).dir : currentProject(registry));

  const sent = [];
  const { wire } = createMcp({ session, version, write: m => sent.push(m) });
  let callId = 0;
  // The page reaches tools only through this, by name, from the short list below.
  async function tool(name, args) {
    const id = ++callId;
    await wire.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const index = sent.findIndex(m => m.id === id);
    const [reply] = sent.splice(index, 1);
    if (reply.error) throw new StudioError('tool-failed', reply.error.message);
    const result = reply.result.structuredContent ?? {};
    if (reply.result.isError) throw new StudioError(result.error?.code ?? 'tool-refused', result.error?.message ?? 'The tool refused.', result.error?.details);
    return result;
  }

  // Drawings are the <name>.parts.json files draw_rig writes (format keyframe-parts).
  function listDrawings() {
    const out = [];
    const walk = (abs, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || (e.isDirectory() && isExportFolder(e.name))) continue;
        const child = path.join(abs, e.name);
        if (e.isDirectory() && depth < 3) walk(child, depth + 1);
        else if (e.isFile() && e.name.endsWith('.parts.json')) {
          try {
            const doc = JSON.parse(fs.readFileSync(child, 'utf8'));
            if (doc.format === PARTS_FORMAT) out.push({ file: project.rel(child), name: doc.name, parts: doc.parts?.length ?? 0, folder: path.posix.dirname(project.rel(child)).replace(/^\.$/, '') });
          } catch { /* not a drawing */ }
        }
      }
    };
    walk(dir, 0);
    return out.sort((a, b) => a.file.localeCompare(b.file));
  }
  function readDrawing(file) {
    if (typeof file !== 'string' || !file.endsWith('.parts.json')) throw new StudioError('bad-argument', '"file" is a <name>.parts.json in the project.', { file });
    const abs = project.resolve(file);
    let doc;
    try { doc = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { throw new StudioError('file-not-found', `${file} cannot be read.`, { file }); }
    if (doc.format !== PARTS_FORMAT) throw new StudioError('bad-argument', `${file} is not a drawing.`, { file });
    // Each part's safe SVG tree, so the board can trace it again (Replay) without parsing SVG itself.
    const trees = Object.fromEntries((doc.parts ?? []).map(p => { try { return [p.name, safeTree(p.svg, p.name)]; } catch { return [p.name, null]; } }));
    // The project's style guide, so the board can redraw a part whose words or colours the owner edits.
    let style = null;
    try { style = projectStyle(dir).style; } catch { style = null; }
    return { file, folder: path.posix.dirname(file).replace(/^\.$/, ''), ...doc, trees, version: drawingVersion(abs), style };
  }

  /** A drawing's version: a short hash of its file, so a save from an old copy is refused, not silently written over. */
  function drawingVersion(abs) {
    try { return createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 16); } catch { return null; }
  }

  // An example: a copy of it in the studio's own data folder, so a first start has something to
  // play and to ask for (src/server/examples.js). The examples themselves are never touched.
  function makeSample(name) {
    return copyExample(findExample(ROOT, name), path.join(path.dirname(registry.file ?? resolvePaths().configFile), 'samples'));
  }

  function projects() {
    const { current, projects: list } = listProjects(registry);
    return { current: dir ?? current, projects: list.map(p => {
      if (!p.exists) return p;
      let skeletons = 0, deliveries = 0;
      try { for (const s of findSkeletons(p.dir, { includeDeliveries: true })) { if (s.delivery) deliveries++; else skeletons++; } } catch { /* unreadable: counts stay 0 */ }
      return { ...p, skeletons, deliveries, preview: fs.existsSync(path.join(p.dir, 'preview.png')) };
    }) };
  }

  // ---------- routes: "METHOD /path" -> handler({ req, res, url, body() }) ----------
  // `project: true` routes need an open project; everything else works on the Projects view.
  const routes = {
    'GET /api/projects': { run: () => projects() },
    'GET /api/examples': { run: () => ({ examples: listExamples(ROOT).map(e => ({ name: e.name, preview: Boolean(e.preview) })) }) },
    'GET /api/examples/preview': { raw: true, run: ({ req, res, url }) => {
      const example = findExample(ROOT, url.searchParams.get('name') ?? '-');
      if (!example.preview) return refuse(res, 404, 'not-found', 'This example has no preview.');
      return sendFile(req, res, example.preview);
    } },
    // A project's own preview.png, for the Recent list: only for a folder in the list, only that file.
    'GET /api/projects/preview': { raw: true, run: ({ req, res, url }) => {
      const want = url.searchParams.get('dir');
      const known = listProjects(registry).projects.find(p => p.exists && p.dir === want);
      if (!known) return refuse(res, 404, 'not-found', 'No such project.');
      return sendFile(req, res, path.join(known.dir, 'preview.png'));
    } },
    'GET /api/settings': { run: () => ({ version, root: ROOT, data: path.dirname(registry.file ?? resolvePaths().configFile),
      // Whether this studio runs an AI of its own (the page then asks GET /api/agent for its slots).
      embeddedAgent: 'GET /api/agent' in routes, connection: connectionBlocks(), addons: addonStatus(found), spine: spineAddonStatus(),
      project: dir ? { name: path.basename(dir), dir, agent: readAgent(dir) } : null }) },
    // `agent` keeps what the page already reads (connected, name, work) and adds the slots.
    'GET /api/state': { run: () => { const st = views.state(); return { ...st, agent: { ...(st.agent ?? { connected: false }), ...agents.summary(dir ?? null) } }; } },
    'GET /api/assets': { run: () => ({ packs: listPacks() }) },
    'GET /api/agent': { run: () => { agents.detect(); return agents.summary(dir ?? null); } },
    // Both answer with the slots as the open project sees them (as GET /api/agent does).
    'PUT /api/agent/slots': { run: async ({ body }) => ({ ...agents.setSlots((await body()).slots), ...agents.summary(dir ?? null) }) },
    'POST /api/agent/stop': { run: async ({ body }) => ({ ...agents.stop(text(await body(), 'slot')), ...agents.summary(dir ?? null) }) },
    'POST /api/agent/run': { project: true, run: async ({ body }) => { const b = await body(); return agents.run(text(b, 'slot'), dir, text(b, 'text')); } },
    'GET /api/messages': { project: true, run: ({ url }) => ({ messages: readMessages(dir, Number(url.searchParams.get('after')) || 0), agent: readAgent(dir) }) },
    'GET /api/check': { project: true, run: async ({ url }) => {
      const r = await tool('check_skeleton', { file: url.searchParams.get('file') });
      const findings = (r.findings ?? []).slice(0, 20).map(f => ({ level: f.level, code: f.code, message: f.message }));
      // "Opens" is a promise about what the owner will see, so the art must be there too.
      const art = await views.missingArt(r.file);
      if (art) findings.unshift({ level: 'fatal', code: art.code, message: art.message });
      return { file: r.file, opens: r.runtime?.opens === true && r.fatal === 0 && !art, fatal: r.fatal + (art ? 1 : 0), summary: art ? art.message : r.summary, findings };
    } },
    'GET /api/history': { project: true, run: ({ url }) => tool('list_history', { file: url.searchParams.get('file') }) },
    'GET /api/package': { raw: true, run: ({ res }) => {
      const zip = zipFolder(ROOT, { prefix: 'keyframe-studio' });
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/zip', 'content-length': zip.length, 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="keyframe-studio-${String(version).replace(/[^\w.-]/g, '')}.zip"` });
      res.end(zip);
    } },
    // One HTML file that plays the skeleton offline (the same as `npm run player`), as a download.
    'GET /api/player': { project: true, raw: true, run: ({ res, url }) => {
      const rel = url.searchParams.get('file') ?? '';
      if (!/\.json$/i.test(rel)) throw new StudioError('bad-file', 'The player is made from a skeleton .json in the project.');
      const html = standalonePlayerFor(insideProjectReal(() => dir, rel), { title: path.basename(rel).replace(/(\.keyframe)?\.json$/i, '') });
      const name = path.basename(rel).replace(/(\.keyframe)?\.json$/i, '').replace(/[^\w.-]/g, '_') || 'player';
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html), 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="${name}.player.html"` });
      res.end(html);
    } },
    'GET /api/health': { run: () => ({ ok: true, version, project: dir !== null }) },

    'POST /api/projects/open': { run: async ({ body }) => { bind(openProject(text(await body(), 'dir'), registry).dir); return projects(); } },
    'POST /api/projects/create': { run: async ({ body }) => { const b = await body(); bind(createProject(text(b, 'parent'), text(b, 'name'), registry).dir); return projects(); } },
    'POST /api/projects/forget': { run: async ({ body }) => {
      const target = text(await body(), 'dir');
      forgetProject(target, registry);
      if (dir && path.resolve(target) === dir) bind(null);
      return projects();
    } },
    'POST /api/projects/close': { run: () => { bind(null); return projects(); } },
    'POST /api/projects/sample': { run: async ({ body }) => { bind(openProject(makeSample((await body()).example), registry).dir); return projects(); } },
    'POST /api/addons/spine': { run: async ({ body }) => {
      const b = await body();
      if (b.on === true) return installSpineRuntime({ acceptLicense: b.acceptLicense === true });
      if (b.on === false) return removeSpineRuntime();
      throw new StudioError('bad-argument', 'Send { on: true, acceptLicense: true } or { on: false }.');
    } },
    'POST /api/messages': { project: true, run: async ({ body }) => {
      const message = appendMessage(dir, { from: 'owner', text: (await body()).text });
      return { ...message, agent: agents.onOwnerMessage(dir, message) };
    } },
    'POST /api/focus': { project: true, run: async ({ body }) => {
      const b = await body();
      if (b.clear) { clearFocus(dir); return { focus: null }; }
      if (typeof b.file !== 'string' || !views.references().includes(b.file)) throw new StudioError('bad-reference', 'The focus must name one of the project\'s references.');
      return { focus: writeFocus(dir, b) };
    } },
    // The drawing board: list the drawings, read one, save one (draw_rig rebuilds the rig from it).
    'GET /api/drawings': { project: true, run: () => ({ drawings: listDrawings() }) },
    // The live drawing feed: what draw_rig drew after event `since`, part by part.
    'GET /api/draw-feed': { project: true, run: ({ url }) => readFeed(dir, Math.max(0, Number(url.searchParams.get('since')) || 0)) },
    'GET /api/drawing': { project: true, run: ({ url }) => readDrawing(url.searchParams.get('file')) },
    'POST /api/drawing': { project: true, run: async ({ body }) => {
      const b = await body();
      const parts = Array.isArray(b.parts) ? b.parts.map(p => Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => v !== null && v !== undefined))) : b.parts;
      const name = text(b, 'name'), folder = typeof b.folder === 'string' && b.folder ? b.folder : '';
      const file = `${folder ? `${folder}/` : ''}${name}.parts.json`;
      let abs = null;
      try { abs = project.resolve(file); } catch { abs = null; }
      // The board saves over the version it opened, never over one the AI drew since.
      if (typeof b.base === 'string' && abs) {
        const now = drawingVersion(abs);
        if (now && now !== b.base) throw new StudioError('stale-drawing', `${file} changed since the board opened it (the AI drew on it). Load the new version, or save yours under another name.`, { file, version: now });
      }
      const result = await tool('draw_rig', { name, parts, ...(folder ? { folder } : {}), ...(Number.isFinite(b.resolution) ? { resolution: b.resolution } : {}) });
      return abs && result && !result.error ? { ...result, version: drawingVersion(abs) } : result;
    } },
    'POST /api/restore': { project: true, run: async ({ body }) => { const b = await body(); return tool('restore_file', { file: b.file, backup: b.backup }); } },
    'POST /api/reference/link': { project: true, run: async ({ body }) => { const b = await body(); return fetchReference(dir, b.url, { from: b.from, to: b.to, ytdlp }); } },
    'POST /api/reference': { project: true, run: async ({ req, url }) => {
      const name = path.basename(url.searchParams.get('name') ?? '').replace(/[^\w.\- ]+/g, '_');
      if (!name || !REFERENCE_TYPES.has(path.extname(name).toLowerCase())) throw new StudioError('bad-reference', 'A reference is a video or an image (mp4, webm, mov, gif, png, jpg, webp).');
      const folder = projectFolders(dir, 'reference').write;
      const saved = saveReference(dir, folder, name, await readBody(req, maxUpload));
      return { file: `${path.basename(folder)}/${saved}` };
    } },
  };
  const knownPaths = new Map();
  for (const key of Object.keys(routes)) {
    const [method, pathname] = key.split(' ');
    knownPaths.set(pathname, [...(knownPaths.get(pathname) ?? []), method]);
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://local');
    let parts;
    try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); }
    catch { return refuse(res, 400, 'bad-path', 'The address is not a valid path.'); }
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    const entry = routes[`${method} ${url.pathname}`];
    if (entry) {
      if (entry.project && !dir) return refuse(res, 409, 'no-project', 'No project is open. Open one in Projects.');
      const result = await entry.run({ req, res, url, body: () => readJson(req, MAX_JSON) });
      if (!entry.raw) send(res, 200, result);
      return;
    }
    if (knownPaths.has(url.pathname)) return refuse(res, 405, 'method-not-allowed', `Use ${knownPaths.get(url.pathname).join(' or ')} here.`, { allow: knownPaths.get(url.pathname).join(', ') });

    if (method === 'GET') {
      if (!parts.length) return sendFile(req, res, path.join(STATIC_ROOTS.web, 'index.html'));
      // The service worker must be served from the root to look after the whole app.
      if (url.pathname === '/sw.js') return sendFile(req, res, path.join(STATIC_ROOTS.web, 'sw.js'), { 'service-worker-allowed': '/' });
      if (parts[0] === 'src' && PAGE_SOURCES.has(parts[1]) && parts.length > 2 && url.pathname.endsWith('.js')) {
        const base = path.join(ROOT, 'src', parts[1]);
        const abs = path.resolve(base, ...parts.slice(2));
        if (!abs.startsWith(base + path.sep)) return refuse(res, 404, 'not-found', 'No such file.');
        return sendFile(req, res, abs);
      }
      if (parts[0] === 'addons' && parts[1] === 'spine' && parts.length === 3 && SPINE_FILES.has(parts[2])) {
        const script = locateSpineRuntime();
        if (!script) return refuse(res, 404, 'spine-addon-off', 'The Spine add-on is off.');
        return sendFile(req, res, path.join(path.dirname(script), parts[2]));
      }
      if (parts[0] in STATIC_ROOTS) {
        const abs = path.resolve(STATIC_ROOTS[parts[0]], ...parts.slice(1));
        if (!abs.startsWith(STATIC_ROOTS[parts[0]] + path.sep)) return refuse(res, 404, 'not-found', 'No such file.');
        return sendFile(req, res, abs);
      }
      if (parts[0] === 'files') {
        if (!dir) return refuse(res, 409, 'no-project', 'No project is open. Open one in Projects.');
        const rel = parts.slice(1).join('/');
        if (!PROJECT_TYPES.has(path.extname(rel).toLowerCase())) return refuse(res, 404, 'not-found', 'No such file.');
        return sendFile(req, res, insideProjectReal(() => dir, rel));
      }
    }
    return refuse(res, 404, 'not-found', 'No such route.');
  }

  let allowedHosts = new Set();
  const server = http.createServer((req, res) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => log.debug('request', { method: req.method, path: req.url.split('?')[0], status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1000n) / 1000 }));
    // Addressed to us, and not sent by another site's page.
    if (!allowedHosts.has(req.headers.host)) return refuse(res, 403, 'foreign-host', 'This server answers only on its own local address.');
    const origin = req.headers.origin;
    if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) return refuse(res, 403, 'foreign-origin', 'Requests from other sites are refused.');
    // A browser that says a request came from another site is refused even without an Origin.
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none' && req.method !== 'GET' && req.method !== 'HEAD') return refuse(res, 403, 'cross-site', 'Requests from other sites are refused.');
    route(req, res).catch(err => {
      if (res.headersSent) { log.warn('response failed after it started', { path: req.url, err }); return res.end(); }
      if (err instanceof StudioError) {
        const status = statusFor(err.code);
        if (status >= 500) log.error('request failed', { method: req.method, path: req.url.split('?')[0], code: err.code, err });
        return refuseError(res, err);
      }
      // An unexpected failure: the details go to the log, never to the page.
      log.error('unexpected failure', { method: req.method, path: req.url.split('?')[0], err });
      return refuse(res, 500, 'internal-error', 'The studio hit an unexpected error; the console window has the details.');
    });
  });
  // A stalled client cannot hold a connection open forever; uploads still have minutes.
  server.headersTimeout = 30_000;
  server.requestTimeout = 10 * 60_000;
  server.keepAliveTimeout = 5_000;

  server.on('close', () => agents.stopAll());

  return {
    server,
    agents,
    // Loopback only, by design: the page has no login, so it must never answer the network.
    listen(port = 8731) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          const actual = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
          allowedHosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
          resolve(actual);
        });
      });
    },
    /** Stop accepting, end idle keep-alive connections, and resolve when the last request is done. */
    close() {
      return new Promise(resolve => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
      });
    },
  };
}
