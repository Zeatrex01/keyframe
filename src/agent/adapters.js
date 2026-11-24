// One adapter per supported agent CLI. Each says how to find the program, the command line for a
// headless run, and how to read the lines it streams, as the studio's own small event set:
//
//   { type: 'session', session }          the CLI's session id (kept to resume the conversation)
//   { type: 'text', text, delta? }         something the agent said: a whole block, or with `delta` a piece
//                                          of it as it streams (shown live, never stored)
//   { type: 'tool', name, phase, ok?, early? }  a tool call starting ('start') or finished ('end'); `early`
//                                          marks the streamed announcement before the whole call
//   { type: 'done', text?, session? }      the run finished; `text` is the final answer when the CLI gives one
//   { type: 'error', message }             the run failed, in the CLI's words
//
// Claude Code is the reference adapter; Codex CLI and Gemini CLI are best effort (their stream
// formats move between releases), with the same interface. A line an adapter does not understand
// is skipped, never an error. Credentials are never touched: every CLI runs on the owner's login.
//
// Isolation: a studio run must not carry the owner's other work into the studio. Each adapter
// starts its CLI without the owner's personal instructions, memory, hooks, plugins or other MCP
// servers, with only the studio's server and the project folder as its working folder
// (docs/agents.md, "Security"). test/agent-adapters.test.js asserts the command lines.
//
// Node-only (layer `agent`).

import { SERVER_NAME } from '../mcp/server.js';

/**
 * @typedef {{ type: 'session', session: string }
 *   | { type: 'text', text: string, delta?: boolean }
 *   | { type: 'tool', name: string, phase: 'start'|'end', ok?: boolean, early?: boolean }
 *   | { type: 'done', text?: string, session?: string }
 *   | { type: 'error', message: string }} AgentEvent
 */

/**
 * @typedef {object} RunPlan
 * @property {string} projectDir the project folder (the CLI's working folder)
 * @property {{ command: string, args: string[] }} mcp how to start the studio's MCP server for this run
 * @property {string[]} tools the studio tool names this run may call
 * @property {string} brief the role brief (system prompt text)
 * @property {string|null} resume the CLI session to continue, or null for a new one
 * @property {string} configFile where the adapter may write the MCP config it needs (a file it owns)
 * @property {string} [model] the model to run ('' or absent: the CLI's own default)
 */

/**
 * @typedef {object} Adapter
 * @property {'claude-code'|'codex'|'gemini'} id
 * @property {string} name
 * @property {string} bin the executable's base name
 * @property {string} env the variable that names the executable (final when set)
 * @property {{ win32: string, darwin: string, other: string }} install
 * @property {boolean} systemPrompt whether the brief goes on the command line (else it leads the first prompt)
 * @property {string[]} models the models offered in Settings ('' is always offered too: the CLI's own default)
 * @property {string} defaultModel the model a slot runs until the owner picks one ('' : the CLI's own default)
 * @property {(plan: RunPlan) => { args: string[], env?: Record<string, string>, files?: Record<string, string> }} command
 * @property {(line: string) => AgentEvent[]} parse
 */

const PREFIX = `mcp__${SERVER_NAME}__`;
/** A tool name as the owner reads it: the studio's own name without the client's prefix. */
export const shortToolName = name => String(name ?? '').replace(/^mcp__.+?__/, '') || 'tool';

const json = line => { try { const v = JSON.parse(line); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const textOf = content => (Array.isArray(content) ? content : [content]).map(c => (typeof c === 'string' ? c : c?.type === 'text' ? c.text : '')).join('');
const mcpServers = plan => ({ [SERVER_NAME]: { command: plan.mcp.command, args: plan.mcp.args } });

// ---------- Claude Code: `claude -p --output-format stream-json --verbose` ----------

/** @param {string} line @returns {AgentEvent[]} */
export function parseClaude(line) {
  const m = json(line);
  if (!m) return [];
  if (m.type === 'system' && m.subtype === 'init' && m.session_id) return [{ type: 'session', session: m.session_id }];
  // With --include-partial-messages: the answer as it is written, token by token.
  if (m.type === 'stream_event' && !m.parent_tool_use_id) {
    const e = m.event;
    if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) return [{ type: 'text', text: e.delta.text, delta: true }];
    if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use') return [{ type: 'tool', name: shortToolName(e.content_block.name), phase: 'start', early: true }];
    return [];
  }
  if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
    if (m.parent_tool_use_id) return []; // a sub-agent's turn, not the answer
    /** @type {AgentEvent[]} */
    const out = [];
    for (const block of m.message.content) {
      if (block?.type === 'text' && block.text?.trim()) out.push({ type: 'text', text: block.text });
      else if (block?.type === 'tool_use') out.push({ type: 'tool', name: shortToolName(block.name), phase: 'start' });
    }
    return out;
  }
  if (m.type === 'user' && Array.isArray(m.message?.content)) {
    return m.message.content.filter(b => b?.type === 'tool_result').map(b => ({ type: 'tool', name: 'result', phase: 'end', ok: b.is_error !== true }));
  }
  if (m.type === 'result') {
    if (m.is_error || (m.subtype && m.subtype !== 'success')) {
      return [{ type: 'error', message: String(m.result || m.error || (m.subtype === 'error_max_turns' ? 'The agent reached its turn limit.' : 'The agent stopped with an error.')) }];
    }
    return [{ type: 'done', text: typeof m.result === 'string' ? m.result : undefined, session: m.session_id }];
  }
  return [];
}

/** A file beside the run's config: `<dir>/<name>.<part><ext>`. */
const sibling = (configFile, part, ext = '.json') => configFile.replace(/\.json$/i, '') + `.${part}${ext}`;

/** @type {Adapter} */
export const claudeCode = {
  id: 'claude-code', name: 'Claude Code', bin: 'claude', env: 'KS_AGENT_CLAUDE', systemPrompt: true,
  // A capable, lower-cost model by default: the studio's turns are many and the owner pays for them.
  models: ['sonnet', 'haiku', 'opus'], defaultModel: 'sonnet',
  install: {
    win32: 'irm https://claude.ai/install.ps1 | iex   (then run `claude` once to sign in)',
    darwin: 'curl -fsSL https://claude.ai/install.sh | bash   (then run `claude` once to sign in)',
    other: 'curl -fsSL https://claude.ai/install.sh | bash   (then run `claude` once to sign in)',
  },
  command(plan) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--mcp-config', plan.configFile, '--strict-mcp-config',
      // No built-in tools at all (no shell, no file edits): the studio's tools are the only hands.
      '--tools', '',
      '--allowedTools', plan.tools.map(t => PREFIX + t).join(','),
      '--permission-mode', 'default',
      // Isolation: no user settings (so no personal CLAUDE.md, hooks or plugins from ~/.claude),
      // no hooks at all (the project's included), no skills or slash commands.
      '--setting-sources', 'project',
      // Settings and the brief travel as files: no argument carries a quote that a shell could eat.
      '--settings', sibling(plan.configFile, 'settings'),
      '--disable-slash-commands'];
    const files = { [plan.configFile]: JSON.stringify({ mcpServers: mcpServers(plan) }, null, 2),
      // Every CLAUDE.md is excluded too, a second lock behind CLAUDE_CODE_DISABLE_CLAUDE_MDS.
      [sibling(plan.configFile, 'settings')]: JSON.stringify({ disableAllHooks: true, claudeMdExcludes: ['**/*'] }, null, 2) };
    if (plan.brief) {
      files[sibling(plan.configFile, 'brief', '.md')] = plan.brief;
      args.push('--append-system-prompt-file', sibling(plan.configFile, 'brief', '.md'));
    }
    if (plan.model) args.push('--model', plan.model);
    if (plan.resume) args.push('--resume', plan.resume);
    // No instruction files: the owner's global and folder CLAUDE.md (which may hold anything from
    // their other work) are never read. No auto-memory: what the agent learns elsewhere stays there.
    return { args, env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }, files };
  },
  parse: parseClaude,
};

// ---------- Codex CLI: `codex exec --json` (best effort) ----------

/** @param {string} line @returns {AgentEvent[]} */
export function parseCodex(line) {
  const m = json(line);
  if (!m) return [];
  // The current format: thread / turn / item events.
  if (m.type === 'thread.started' && m.thread_id) return [{ type: 'session', session: m.thread_id }];
  if ((m.type === 'item.started' || m.type === 'item.completed') && m.item) {
    const item = m.item, phase = m.type === 'item.started' ? 'start' : 'end';
    if (item.type === 'agent_message' && m.type === 'item.completed' && item.text?.trim()) return [{ type: 'text', text: item.text }];
    if (item.type === 'mcp_tool_call') return [{ type: 'tool', name: shortToolName(item.tool), phase, ...(phase === 'end' ? { ok: item.status !== 'failed' && !item.error } : {}) }];
    if (item.type === 'command_execution') return [{ type: 'tool', name: 'shell', phase, ...(phase === 'end' ? { ok: item.status !== 'failed' } : {}) }];
    if (item.type === 'error' && item.message) return [{ type: 'error', message: item.message }];
    return [];
  }
  if (m.type === 'turn.completed') return [{ type: 'done' }];
  if (m.type === 'turn.failed') return [{ type: 'error', message: m.error?.message ?? 'The agent stopped with an error.' }];
  if (m.type === 'error' && m.message) return [{ type: 'error', message: m.message }];
  // The earlier format: { msg: { type, ... } }.
  const msg = m.msg;
  if (msg && typeof msg === 'object') {
    if (msg.type === 'session_configured' && msg.session_id) return [{ type: 'session', session: msg.session_id }];
    if (msg.type === 'agent_message' && msg.message?.trim()) return [{ type: 'text', text: msg.message }];
    if (msg.type === 'mcp_tool_call_begin') return [{ type: 'tool', name: shortToolName(msg.invocation?.tool), phase: 'start' }];
    if (msg.type === 'mcp_tool_call_end') return [{ type: 'tool', name: shortToolName(msg.invocation?.tool), phase: 'end', ok: !msg.result?.Err }];
    if (msg.type === 'task_complete') return [{ type: 'done', ...(msg.last_agent_message ? { text: msg.last_agent_message } : {}) }];
    if (msg.type === 'error') return [{ type: 'error', message: msg.message ?? 'The agent stopped with an error.' }];
  }
  return [];
}

// TOML for a `-c` override. Strings are literal ('...') where they can be, so a Windows path keeps
// its backslashes and the argument holds no double quote (cmd.exe, the last-resort way to start
// a CLI, would strip it).
const toml = value => {
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  const text = String(value);
  return /^[^'\r\n]*$/.test(text) ? `'${text}'` : JSON.stringify(text);
};

/** @type {Adapter} */
export const codex = {
  id: 'codex', name: 'Codex CLI', bin: 'codex', env: 'KS_AGENT_CODEX', systemPrompt: false,
  models: [], defaultModel: '',
  install: { win32: 'npm install -g @openai/codex   (then run `codex` once to sign in)', darwin: 'brew install codex   (then run `codex` once to sign in)', other: 'npm install -g @openai/codex   (then run `codex` once to sign in)' },
  command(plan) {
    // The whole mcp_servers table is replaced, so the owner's other servers are not started; no
    // AGENTS.md instructions are read (project_doc_max_bytes=0) and no notify hook runs.
    const server = `{command=${toml(plan.mcp.command)},args=${toml(plan.mcp.args)},enabled_tools=${toml(plan.tools)}}`;
    const options = ['--json', '--skip-git-repo-check', '--sandbox', 'read-only',
      '-c', `mcp_servers={${toml(SERVER_NAME)}=${server}}`,
      '-c', 'project_doc_max_bytes=0',
      '-c', 'notify=[]', ...(plan.model ? ['--model', plan.model] : [])];
    // `-` reads the prompt from standard input.
    return { args: plan.resume ? ['exec', ...options, 'resume', plan.resume, '-'] : ['exec', ...options, '-'] };
  },
  parse: parseCodex,
};

// ---------- Gemini CLI: `gemini --output-format stream-json` (best effort) ----------

/** @param {string} line @returns {AgentEvent[]} */
export function parseGemini(line) {
  const m = json(line);
  if (!m) return [];
  if (m.type === 'init' && m.session_id) return [{ type: 'session', session: m.session_id }];
  if (m.type === 'message' && m.role === 'assistant') {
    const text = textOf(m.content);
    return text ? [{ type: 'text', text, ...(m.delta ? { delta: true } : {}) }] : [];
  }
  if (m.type === 'tool_use') return [{ type: 'tool', name: shortToolName(m.tool_name), phase: 'start' }];
  if (m.type === 'tool_result') return [{ type: 'tool', name: 'result', phase: 'end', ok: m.status !== 'error' }];
  if (m.type === 'error' && m.severity !== 'warning') return [{ type: 'error', message: m.message ?? 'The agent stopped with an error.' }];
  if (m.type === 'result') {
    if (m.status && m.status !== 'success') return [{ type: 'error', message: m.error?.message ?? 'The agent stopped with an error.' }];
    return [{ type: 'done' }];
  }
  return [];
}

/** @type {Adapter} */
export const gemini = {
  id: 'gemini', name: 'Gemini CLI', bin: 'gemini', env: 'KS_AGENT_GEMINI', systemPrompt: false,
  models: ['gemini-2.5-flash', 'gemini-2.5-pro'], defaultModel: '',
  install: { win32: 'npm install -g @google/gemini-cli   (then run `gemini` once to sign in)', darwin: 'brew install gemini-cli   (then run `gemini` once to sign in)', other: 'npm install -g @google/gemini-cli   (then run `gemini` once to sign in)' },
  command(plan) {
    // Gemini reads MCP servers from settings only, so this run gets a settings file of its own;
    // a trusted server with an explicit tool list, and nothing else.
    // System settings win over the owner's: no context files (GEMINI.md) are read, and extensions
    // are off for the run.
    const settings = { mcpServers: { [SERVER_NAME]: { ...mcpServers(plan)[SERVER_NAME], trust: true, includeTools: plan.tools } },
      context: { fileName: ['.keyframe-no-context.md'] } };
    const args = ['--output-format', 'stream-json', '--allowed-mcp-server-names', SERVER_NAME, '--extensions', 'none'];
    if (plan.model) args.push('--model', plan.model);
    if (plan.resume) args.push('--resume', plan.resume);
    // The request itself arrives on standard input; -p makes the run headless.
    args.push('-p', 'Answer the request given on standard input.');
    return { args, env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: plan.configFile }, files: { [plan.configFile]: JSON.stringify(settings, null, 2) } };
  },
  parse: parseGemini,
};

/** Every supported CLI, in the order Settings lists them. */
export const ADAPTERS = Object.freeze([claudeCode, codex, gemini]);
export const AGENT_IDS = Object.freeze(ADAPTERS.map(a => a.id));
/** @param {string} id */
export const adapterFor = id => ADAPTERS.find(a => a.id === id) ?? null;
