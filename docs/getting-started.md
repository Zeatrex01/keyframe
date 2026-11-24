# Getting started

From nothing to your first animation, with the AI agent you already use. About ten minutes.

## 1. Install

You need [Node.js](https://nodejs.org) 18 or newer. Nothing else is installed.

```bash
git clone https://github.com/Zeatrex01/keyframe.git
cd keyframe
npm start
```

On Windows you can double-click `Start Studio.cmd` instead. The studio opens as an app window. The
first run offers six examples: pick one (Mika is a good start) to get a copy to play with, or open
a folder of your own that holds a skeleton. A folder with no art yet is fine too: use **Draw** in
the top bar, or ask the AI to draw placeholder parts.

## 2a. The quickest way: the built-in Director

If [Claude Code](https://claude.com/claude-code) is installed and signed in (run `claude` once in a
terminal), open **Settings → AI connection** and choose it for the Director. Then just write in the
studio's chat panel. You see what it is doing as it works (thinking, reading, writing, checking),
its answer as it is written, and a Stop button. It runs with only the studio's tools, in the
project folder, and never reads your own instruction files, hooks or memory. More in
[`agents.md`](agents.md). The rest of this page connects an agent you run yourself instead.

## 2b. Or connect the agent you already run

The studio is an [MCP](https://modelcontextprotocol.io) server, so any agent that speaks MCP can
use it: Claude Code, OpenAI Codex CLI, Gemini CLI, Cursor, VS Code, Windsurf, Claude Desktop, or any
other MCP client. No API key is involved: the agent is the one you already run.

Print the lines for every client, with this checkout's path filled in:

```bash
npm run connect                # all clients
npm run connect -- cursor      # just one: claude-code, codex, gemini, cursor, vscode, windsurf, claude-desktop, other
```

**Settings** in the studio page shows the same lines with copy buttons. For example:

```bash
claude mcp add keyframe-studio -- node "/path/to/keyframe-studio/tools/mcp-server.js"
```

```toml
# OpenAI Codex CLI, ~/.codex/config.toml
[mcp_servers.keyframe-studio]
command = "node"
args = ["/path/to/keyframe-studio/tools/mcp-server.js"]
```

```json
{ "mcpServers": { "keyframe-studio": { "command": "node", "args": ["/path/to/keyframe-studio/tools/mcp-server.js"] } } }
```

Check that the server answers the way a client will talk to it:

```bash
npm run connect -- --check
```

`ok ... 30 tools served` means any client configured with those lines will work. Restart the agent
after adding the lines; most clients read their MCP settings only at start.

The server follows the project open in the page, so switching projects there brings the agent
along. Add `--project <folder>` to the arguments to pin an agent to one folder instead.

## 3. The first session

Ask your agent, in your own words:

> Call start_here on Keyframe Studio, then make Mika blink twice and look at the result.

What a good session looks like:

1. `start_here`: the agent learns what is in the project, what the studio can do, the order of
   work (SEE, WRITE, PROVE, DELIVER), the animation principles it writes by, and one working
   write call for this very rig.
2. `read_rig`: bone names, parents and orientation.
3. `write_animation`: one clip, written beside your file as `<name>_v2.json` with a backup. Your
   own file is never written.
4. `see_animation`, `describe_animation`, `critique_animation`, `check_skeleton`: the agent looks
   at frames, reads the clip back in sentences, measures it against the animation principles and
   proves the file opens.
5. The page plays the result. Ask for changes in the page's chat or in your agent.

If the agent is unsure how to call a tool, it can ask the studio: `help` with a tool name returns
when to use it, every argument with its unit and default, a call that works and what usually comes
next. A refused call always says how to fix it.

## 4. Talk to the agent from the page

The page has a chat under the stage. Tell your agent once:

> Work with me in the Keyframe Studio page: loop on wait_for_message and reply.

From then on you describe motions in the page and watch them play there, while the agent works.

## When something does not work

| You see | Do this |
|---|---|
| The agent does not list any keyframe-studio tools | Run `npm run connect -- --check`. If it says ok, the client did not load its settings: check the file location `npm run connect` printed, and restart the client. |
| `foreign-folder` on a write | Open a project in the page (Projects), or add `--project <folder>` to the server arguments. |
| `node` is not found by a desktop app | Put the full path of node in `command` (for example `C:\\Program Files\\nodejs\\node.exe`). |
| Frames or video tools refuse with `no-ffmpeg` | ffmpeg is optional; Settings lists how to install it. |

More: [`README.md`](../README.md), the scope in [`concept.md`](concept.md), the plan in
[`roadmap.md`](roadmap.md).
