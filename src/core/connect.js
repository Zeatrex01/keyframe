// How any MCP client connects to the studio: one stdio server, written the way each client
// expects it. Shared by the page's Settings (src/server/http.js) and `npm run connect`
// (tools/connect.js), so the two can never disagree.
//
// Every client runs the same command, `node <checkout>/tools/mcp-server.js`. Started without
// --project it follows the project open in the page.

import path from 'node:path';

export const SERVER_NAME = 'keyframe-studio';

/**
 * @param {string} root the checkout
 * @returns {{ server: string, clients: Array<{ id: string, name: string, where: string, format: 'command'|'json'|'toml', text: string }> }}
 */
export function connectionFor(root) {
  const server = path.join(root, 'tools', 'mcp-server.js');
  const json = key => JSON.stringify({ [key]: { [SERVER_NAME]: key === 'servers' ? { type: 'stdio', command: 'node', args: [server] } : { command: 'node', args: [server] } } }, null, 2);
  /** @type {Array<{ id: string, name: string, where: string, format: 'command'|'json'|'toml', text: string }>} */
  const clients = [
    { id: 'claude-code', name: 'Claude Code', where: 'run once in a terminal', format: 'command', text: `claude mcp add ${SERVER_NAME} -- node "${server}"` },
    { id: 'codex', name: 'OpenAI Codex CLI', where: '~/.codex/config.toml', format: 'toml',
      text: `[mcp_servers.${SERVER_NAME}]\ncommand = "node"\nargs = [${JSON.stringify(server)}]` },
    { id: 'gemini', name: 'Gemini CLI', where: '~/.gemini/settings.json (merge into "mcpServers")', format: 'json', text: json('mcpServers') },
    { id: 'cursor', name: 'Cursor', where: '~/.cursor/mcp.json or <project>/.cursor/mcp.json', format: 'json', text: json('mcpServers') },
    { id: 'vscode', name: 'VS Code (Copilot agent mode)', where: '<workspace>/.vscode/mcp.json', format: 'json', text: json('servers') },
    { id: 'windsurf', name: 'Windsurf', where: '~/.codeium/windsurf/mcp_config.json', format: 'json', text: json('mcpServers') },
    { id: 'claude-desktop', name: 'Claude Desktop', where: 'Settings > Developer > Edit Config (claude_desktop_config.json)', format: 'json', text: json('mcpServers') },
    { id: 'other', name: 'Any other MCP client', where: 'its MCP settings: a stdio server', format: 'json', text: json('mcpServers') },
  ];
  return { server, clients };
}
