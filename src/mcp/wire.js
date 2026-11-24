// The MCP wire: JSON-RPC over a line stream, both protocol eras, and every guard a call
// passes through (ported from legacy dispatch.js and modern_wire.js).
//
// Guards, in order, and why:
//   1. known tool?           an unknown name answers with the tool list
//   2. foreign-folder guard  a writing tool outside a project stops before touching disk;
//                            "silently working in the wrong place" was the legacy repo's
//                            most expensive defect class
//   3. argument gate         each tool's inputSchema, enforced here for every tool
//   4. invoke                WITH the registry as receiver context; legacy once invoked
//                            handlers detached and a tool was dead over MCP while its unit
//                            gate stayed green
// Errors leave as data: a StudioError becomes an isError result carrying its code and
// details; anything else is reported as code "internal-error", never swallowed.
//
// Eras: a message whose params._meta declares a protocol version is the stateless
// 2026-07-28 era (no handshake, decorated results, -32022 for unknown versions);
// everything else is the handshake era.

import { validateArgs } from './args.js';
import { toWire } from './describe.js';
import { isStudioError } from '../shared/errors.js';
import { fixFor } from './fixes.js';
import { noteCall } from '../core/proof.js';
import { projectOf } from './project.js';

export const HANDSHAKE_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
export const MODERN_VERSIONS = Object.freeze(['2026-07-28']);
const PV = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
const SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
const UNSUPPORTED_PROTOCOL_VERSION = -32022;
const HANDSHAKE_ONLY = new Set(['initialize', 'notifications/initialized', 'notifications/roots/list_changed']);
const CACHEABLE = new Set(['tools/list', 'resources/list', 'server/discover']);

const versionOf = msg => {
  const meta = msg?.params?._meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta[PV] : undefined;
};

/**
 * @param {object} deps
 * @param {ReturnType<import('./registry.js').buildRegistry>} deps.registry
 * @param {{ dir: string|null, writable(): boolean, client?: string }} deps.session
 * @param {(message: object) => void} deps.write     one JSON-RPC object out
 * @param {string} deps.instructions
 * @param {{ name: string, version: string }} deps.serverInfo
 * @param {{ listing(): object[], read(uri: string): object|null }} [deps.resources]
 * @param {boolean} [deps.fullDescriptions]  serve full descriptions in tools/list
 * @param {(record: object) => void} [deps.onRefusal]  observes refusals and errors; must not throw
 */
export function createWire({ registry, session, write, instructions, serverInfo, resources = null,
  fullDescriptions = false, onRefusal = () => {} }) {
  const capabilities = { tools: {}, ...(resources ? { resources: {} } : {}) };
  const toolList = registry.tools.map(t => toWire(t, { full: fullDescriptions }));
  const inflight = new Map();
  const flightKey = id => `${typeof id}:${id}`;
  const plain = {
    reply: (id, result) => write({ jsonrpc: '2.0', id, result }),
    failWith: (id, code, message, data) => write({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } }),
  };
  const observe = record => { try { onRefusal(record); } catch { /* observation never breaks a call */ } };

  async function callTool(id, params, out) {
    const name = params?.name;
    if (typeof name !== 'string' || !name) return out.failWith(id, -32602, 'tools/call needs params.name (a tool name).');
    const tool = registry.byName.get(name);
    if (!tool) return out.failWith(id, -32602, `Unknown tool "${name}". Tools: ${registry.tools.map(t => t.name).join(', ')}`);
    // Every refusal says how to get past it (`fix`), and where the argument shape may be the
    // problem, carries a call that works (`example`).
    const errorResult = (code, message, details = {}) => {
      const error = { code, message, details, fix: fixFor(code, details),
        ...(/^bad-|^unknown-/.test(code) && tool.example ? { example: { tool: name, arguments: tool.example } } : {}) };
      return out.reply(id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ error }, null, 2) }], structuredContent: { error } });
    };
    if (registry.writers.has(name) && !session.writable()) {
      observe({ tool: name, code: 'foreign-folder' });
      return errorResult('foreign-folder',
        `"${name}" writes, and ${session.dir ?? 'no folder'} is not an open project. Nothing was written. Open a project in the studio page (Projects), or start the server with --project <folder>.`,
        { dir: session.dir });
    }
    const args = params.arguments ?? {};
    const issues = validateArgs(tool.inputSchema, args);
    if (issues.length) {
      observe({ tool: name, code: 'bad-arguments', issues });
      return errorResult('bad-arguments', `Arguments for ${name} were refused: ${issues.join(' ')}`, { issues });
    }
    const flight = new AbortController();
    const key = flightKey(id);
    inflight.set(key, flight);
    try {
      const result = await tool.run(args, { session, registry, signal: flight.signal });
      if (flight.signal.aborted) return undefined;
      // The proof ledger: what was written, and whether it was proven since (src/core/proof.js).
      try { noteCall(projectOf(session).dir, name, args, result); } catch { /* no project, or a read-only one: nothing to note */ }
      if (result && result.image) {
        return out.reply(id, { content: [
          { type: 'image', data: result.image.data, mimeType: result.image.mimeType ?? 'image/png' },
          { type: 'text', text: JSON.stringify(result.meta ?? {}, null, 2) },
        ] });
      }
      const structured = result && typeof result === 'object' && !Array.isArray(result);
      return out.reply(id, { content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }],
        ...(structured ? { structuredContent: result } : {}) });
    } catch (err) {
      if (flight.signal.aborted) return undefined;
      if (isStudioError(err)) {
        observe({ tool: name, code: err.code, message: err.message });
        return errorResult(err.code, err.message, err.details);
      }
      observe({ tool: name, code: 'internal-error', message: String(err?.message ?? err) });
      return errorResult('internal-error', `${name} failed unexpectedly: ${err?.message ?? err}`, {});
    } finally {
      if (inflight.get(key) === flight) inflight.delete(key);
    }
  }

  function handleHandshakeEra(msg, out = plain) {
    const { id, method, params } = msg;
    if (method === undefined) return undefined; // a response to a request we never send
    if (method === 'initialize') {
      const info = params?.clientInfo;
      if (info?.name) session.client = info.name + (info.version ? ` ${info.version}` : '');
      const asked = params?.protocolVersion;
      return out.reply(id, {
        protocolVersion: HANDSHAKE_VERSIONS.includes(asked) ? asked : HANDSHAKE_VERSIONS[0],
        capabilities, serverInfo, instructions,
      });
    }
    if (method === 'notifications/cancelled') {
      inflight.get(flightKey(params?.requestId))?.abort();
      return undefined;
    }
    if (String(method).startsWith('notifications/')) return undefined;
    if (method === 'ping') return out.reply(id, {});
    if (method === 'tools/list') return out.reply(id, { tools: toolList });
    if (method === 'tools/call') return callTool(id, params, out);
    if (resources && method === 'resources/list') return out.reply(id, { resources: resources.listing() });
    if (resources && method === 'resources/read') {
      const hit = resources.read(params?.uri);
      return hit ? out.reply(id, { contents: [hit] }) : out.failWith(id, -32602, `Unknown resource: ${params?.uri}`);
    }
    if (id !== undefined) return out.failWith(id, -32601, `Method not found: ${method}`);
    return undefined;
  }

  function handleModernEra(msg) {
    const { id, method } = msg;
    const version = versionOf(msg);
    const supported = [...MODERN_VERSIONS, ...HANDSHAKE_VERSIONS];
    if (!MODERN_VERSIONS.includes(version)) {
      if (id !== undefined) plain.failWith(id, UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', { supported, requested: version });
      return undefined;
    }
    const info = msg.params._meta[CLIENT_INFO];
    if (info && typeof info.name === 'string') session.client = info.name + (info.version ? ` ${info.version}` : '');
    const decorate = result => ({ resultType: 'complete', ...result, ...(CACHEABLE.has(method) ? { ttlMs: 0, cacheScope: 'private' } : {}) });
    const out = { reply: (rid, result) => plain.reply(rid, decorate(result)), failWith: plain.failWith };
    if (HANDSHAKE_ONLY.has(method)) {
      if (id !== undefined) out.failWith(id, -32601, `Method not available in protocol ${version}: ${method}`);
      return undefined;
    }
    if (method === 'server/discover') {
      return out.reply(id, { supportedVersions: supported, capabilities, _meta: { [SERVER_INFO]: serverInfo }, instructions });
    }
    return handleHandshakeEra(msg, out);
  }

  /** Route one parsed message. Returns a promise for tool calls (useful in tests). */
  function handle(msg) {
    return versionOf(msg) !== undefined ? handleModernEra(msg) : handleHandshakeEra(msg);
  }

  /** Feed raw text; complete lines are parsed and routed. */
  function lineReader() {
    let buffer = '';
    return chunk => {
      buffer += chunk;
      const pending = [];
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { plain.failWith(null, -32700, 'Parse error'); continue; }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
          plain.failWith(null, -32600, 'Invalid Request: expected a single JSON-RPC object'); continue;
        }
        pending.push(handle(msg));
      }
      return Promise.all(pending);
    };
  }

  return { handle, lineReader, toolList };
}
