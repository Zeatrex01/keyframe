// How any MCP client connects to the studio: one stdio server, written the way each client
// expects it. Shared by the page's Settings (src/server/http.js) and `npm run connect`
// (tools/connect.js), so the two can never disagree.
//
// Every client runs the same command, `node <checkout>/tools/mcp-server.js`. Started without
// --project it follows the project open in the page. The packaged app has no Node on PATH and a
// folder per version, so its clients run `cmd /c <install>\keyframe-mcp.cmd` instead, which
// starts the current version's server with the bundled Node and survives updates.

import path from 'node:path';

export const SERVER_NAME = 'keyframe-studio';

export const MCP_SHIM = 'keyframe-mcp.cmd';

/**
 * The entry Claude Desktop runs: the packaged app's shim, or this Node (by its full path) with the server.
 * @returns {{ command: string, args: string[] }}
 */
export function desktopEntry(root, { appRoot = null, execPath = process.execPath } = {}) {
  if (appRoot) return { command: 'cmd', args: ['/c', path.win32.join(appRoot, MCP_SHIM)] };
  return { command: execPath, args: [path.join(root, 'tools', 'mcp-server.js')] };
}

/**
 * @param {string} root the checkout
 * @param {{ appRoot?: string|null, execPath?: string }} [options] the packaged app's install folder; the Node that runs the server
 * @returns {{ server: string, clients: Array<{ id: string, name: string, where: string, format: 'command'|'json'|'toml', text: string }> }}
 */
export function connectionFor(root, { appRoot = null, execPath = process.execPath } = {}) {
  const server = appRoot ? path.win32.join(appRoot, MCP_SHIM) : path.join(root, 'tools', 'mcp-server.js');
  const command = appRoot ? 'cmd' : 'node';
  const args = appRoot ? ['/c', server] : [server];
  const line = appRoot ? `cmd /c "${server}"` : `node "${server}"`;
  const json = key => JSON.stringify({ [key]: { [SERVER_NAME]: key === 'servers' ? { type: 'stdio', command, args } : { command, args } } }, null, 2);
  /** @type {Array<{ id: string, name: string, where: string, format: 'command'|'json'|'toml', text: string }>} */
  const clients = [
    // --scope user: the studio is there in every folder Claude Code is started in, not only this one.
    { id: 'claude-code', name: 'Claude Code', where: 'run once in a terminal', format: 'command', text: `claude mcp add --scope user ${SERVER_NAME} -- ${line}` },
    { id: 'codex', name: 'OpenAI Codex CLI', where: '~/.codex/config.toml', format: 'toml',
      text: `[mcp_servers.${SERVER_NAME}]\ncommand = ${JSON.stringify(command)}\nargs = [${args.map(a => JSON.stringify(a)).join(', ')}]` },
    { id: 'gemini', name: 'Gemini CLI', where: '~/.gemini/settings.json (merge into "mcpServers")', format: 'json', text: json('mcpServers') },
    { id: 'cursor', name: 'Cursor', where: '~/.cursor/mcp.json or <project>/.cursor/mcp.json', format: 'json', text: json('mcpServers') },
    { id: 'vscode', name: 'VS Code (Copilot agent mode)', where: '<workspace>/.vscode/mcp.json', format: 'json', text: json('servers') },
    { id: 'windsurf', name: 'Windsurf', where: '~/.codeium/windsurf/mcp_config.json', format: 'json', text: json('mcpServers') },
    // Claude Desktop does not start servers from a terminal, so Node is named by its full path.
    { id: 'claude-desktop', name: 'Claude Desktop', where: 'Settings > Developer > Edit Config (claude_desktop_config.json), or the studio\'s Add button', format: 'json',
      text: JSON.stringify({ mcpServers: { [SERVER_NAME]: desktopEntry(root, { appRoot, execPath }) } }, null, 2) },
    { id: 'other', name: 'Any other MCP client', where: 'its MCP settings: a stdio server', format: 'json', text: json('mcpServers') },
  ];
  return { server, clients };
}
