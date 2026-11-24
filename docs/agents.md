# Agents in the studio

Keyframe Studio is agent-assisted as a whole: the motion is written by an AI agent through the
studio's tools. There are two ways to bring one in, and they use the same tools.

- **Embedded (decided 2026-11-24):** the studio drives the agent CLI already installed on
  this machine, headless, from the chat panel. Nobody opens a second terminal. This page is mostly
  about this path.
- **External:** any MCP client connects to `tools/mcp-server.js` (`npm run connect` prints the
  lines) and loops on `wait_for_message` / `reply`. Nothing about that path changed.

## How the embedded agent works

1. The owner writes in the chat panel. `POST /api/messages` appends the message to the project
   conversation (`<project>/.keyframe/chat.jsonl`), as it always did.
2. If the **director** slot has an agent CLI chosen and that CLI is installed, the studio starts
   one headless run of it with the owner's words on standard input, in the project folder.
3. The run connects to the studio's own MCP server for that project. The CLI streams what it does;
   the studio reads the stream (tool calls, text) and shows it as the slot's `activity`.
4. When the run ends, its final answer is appended to the conversation as an agent message that
   carries the CLI's name (`name: "Claude Code"`, `slot: "director"`), the same shape an external
   agent's `reply` has, so the page shows it unchanged. If the agent already said exactly that
   through `reply` (with `work: "ready"` and the delivery file, so the stage plays it), it is not
   said twice.
5. The CLI's session id is kept per project and slot (`<project>/.keyframe/agent-sessions.json`),
   so the next message resumes the same conversation. A fresh session is told the last twelve
   messages first. A session the CLI no longer knows is dropped and the run starts fresh once.

One run at a time per slot. A message the owner sends while the director works waits and goes in
the next run (several waiting messages go as one request). Stop (`POST /api/agent/stop`) ends the
run and everything it started, and drops what was waiting. A run stops itself after 20 minutes
(`KS_AGENT_TIMEOUT_MS`). A failed run says why in the conversation (`error: "agent-failed"` or
`"agent-timeout"` on the message) and the slot shows `status: "error"` with the message.

## Slots and roles

A slot is one agent with one role. Exactly one agent per slot.

| Field | Meaning |
|---|---|
| `id` | lower-case letters, digits and dashes; unique; `director` is required |
| `role` | `director` (only the `director` slot), `illustrator`, `researcher`, or any other name |
| `agent` | `claude-code`, `codex`, `gemini`, or `null` (the slot is off) |
| `tools` | `studio` (every core tool), `read` (the core tools that change nothing), or a list of tool names |
| `brief` | the owner's own words for this slot (at most 2000 characters), added after the role's brief |

- The **director** is the one the owner talks to. It is started first, writes with the `studio`
  scope by default, and its brief tells it the working order: start with `start_here`, write, then
  prove with `check_skeleton`, `critique_animation` and `see_animation` before calling it done.
- **Extra slots** (illustrator, researcher, anything else) read by default. They run when given a
  task (`POST /api/agent/run { slot, text }`); their answer is appended to the conversation with
  their slot id. Delegation from the director to an extra slot (an `ask_slot` tool on the
  director's wire) is the next step; see `docs/roadmap.md`.
- The role briefs are short English system prompts in `src/agent/roles.js`. Claude Code gets them
  through `--append-system-prompt`; Codex and Gemini have no such flag, so the brief leads the
  first prompt of each session.

The slots are a machine setting, saved in the studio config (`studio.config.json`, or `KS_CONFIG`)
under `agentSlots`, beside the project list. Until the owner chooses, the director has no agent.

## Security model

- **No credentials.** The studio never asks for, stores or passes an API key or a token. The CLI
  runs on the owner's own login (`claude`, `codex` or `gemini` signed in once in a terminal).
- **Only the studio's tools.** Each run's MCP server is started with `--only <tools>`, so it serves
  exactly the slot's tools and nothing else; `wait_for_message` is never given (the owner's
  message is the run). The CLI is also told the same list where it can be: Claude Code gets
  `--tools ""` (no built-in tools: no shell, no file reads or edits), `--strict-mcp-config` (the
  owner's other MCP servers are not loaded) and `--allowedTools` with the studio tools only;
  Codex runs with `--sandbox read-only` and the server's `enabled_tools`; Gemini gets a settings
  file of its own with only the studio server and its `includeTools`.
- **Isolated from the owner's other work.** A studio run never sees what the owner keeps for their
  other projects. Claude Code runs with `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (no CLAUDE.md is read:
  not `~/.claude/CLAUDE.md`, not one in or above the project; `--setting-sources` alone does not
  keep the global one out), `--setting-sources project` (no `~/.claude` settings, hooks or
  plugins), a settings file with `disableAllHooks` and `claudeMdExcludes: ["**/*"]` (no hooks at
  all, and a second lock on CLAUDE.md), `--disable-slash-commands` (no skills) and
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (no memory read or written). It keeps the owner's login,
  which `--bare` would drop. Codex gets its whole `mcp_servers` table replaced by the studio's,
  `project_doc_max_bytes=0` (no AGENTS.md) and `notify=[]`; Gemini gets `--extensions none` and
  system settings that read no context file. The command lines are asserted by
  `test/agent-adapters.test.js`; the Codex and Gemini ones are best effort, like those adapters.
  `test/agent-isolation-real.test.js` proves the Claude Code isolation against the real CLI: it
  plants a codeword in CLAUDE.md files and checks the run cannot see it (opt in with
  `KS_REAL_AGENT=1`, since it uses the owner's login).
- **A stopped request stays stopped.** Stop ends the process and marks the turn. The next turn
  still resumes the conversation, but it starts by telling the agent that the stopped request is
  cancelled and must not be continued unless the owner asks again.
- **The project folder is the working folder.** Every write goes through the studio's tools, which
  keep the one-way rule: deliveries beside the source with a backup, never the source itself.
- **Local only.** The routes answer on 127.0.0.1 and refuse another site's page (foreign host,
  foreign origin, cross-site), like every other route.
- **The owner's words never reach a shell.** They go to the CLI on standard input. On Windows an
  npm `.cmd` shim is resolved to what it runs: a script is started under Node, a program (Claude
  Code's native `claude.exe`) is started directly. Only a shim that cannot be read falls back to
  `cmd.exe`, with every argument quoted and stripped of the characters `cmd.exe` interprets, so
  no adapter puts a quote, `%` or `&` in an argument: settings and the brief travel as files.
- **Absent is normal.** Detection never throws. A slot whose CLI is not installed shows
  `status: "error"` with the install line; a run on it is refused with `no-agent-cli` (501).

## Supported CLIs

| Id | CLI | How it runs | Resume | Status |
|---|---|---|---|---|
| `claude-code` | Claude Code | `claude -p --output-format stream-json --verbose --mcp-config <file> --strict-mcp-config --tools "" --allowedTools <studio tools> --append-system-prompt <brief>` | `--resume <session id>` | reference adapter, tried on a real install |
| `codex` | Codex CLI | `codex exec --json --sandbox read-only -c mcp_servers.keyframe-studio.* -` | `codex exec … resume <thread id> -` | best effort |
| `gemini` | Gemini CLI | `gemini --output-format stream-json --allowed-mcp-server-names keyframe-studio -p …` with its own settings file | `--resume <session id>` | best effort |

Each is found on `PATH` and in the vendor's usual install folder; `KS_AGENT_CLAUDE`,
`KS_AGENT_CODEX` and `KS_AGENT_GEMINI` name the executable instead (final when set: a path that is
not a file means "not installed"). A `.js` path runs under Node, which is how the gates stand a
fake CLI in (`test/fixtures/agent/fake-claude.js`). Settings re-checks on each `GET /api/agent`,
so a CLI installed while the studio runs is seen without a restart.

Adding a CLI is one adapter in `src/agent/adapters.js`: `command(plan)` builds the command line
and any config file it needs, `parse(line)` turns one streamed line into the studio's events
(`session`, `text`, `tool`, `done`, `error`), plus a recorded stream in `test/fixtures/agent/` and
its gate in `test/agent-adapters.test.js`.

## HTTP contract

| Route | Body | Answer |
|---|---|---|
| `GET /api/agent` | | `{ slots: Slot[], agents: [{ id, name, installed, install }] }` |
| `PUT /api/agent/slots` | `{ slots: [{ id, role, agent, tools?, brief? }] }` | the same as `GET /api/agent`; `bad-slots` (400), `agent-busy` (409) when a working slot would change |
| `POST /api/agent/stop` | `{ slot }` | `{ stopped: boolean, slots, agents }`; `unknown-slot` (404) |
| `POST /api/agent/run` | `{ slot, text }` | `{ slot, started: true }`; `no-agent-cli` (501), `agent-busy` (409), `agent-off` (409), `unknown-slot` (404) |
| `POST /api/messages` | `{ text }` | the message, plus `agent: { slot: 'director', started, queued?, code?, message? }` |
| `GET /api/state` | | as before; `agent` keeps `connected`, `name`, `work` and adds `slots` and `agents` |

`Slot` in an answer: `{ id, role, agent, tools, brief, status, message?, activity }`, where
`status` is `off` (no agent chosen), `starting`, `working`, `ready` or `error`, and `activity` is
the current or last run's last twenty events, `{ kind: 'tool'|'text'|'error'|'done', name, at }`.

## Using an external agent instead

Leave the director's agent at none (Settings) and connect any MCP client as before
(`npm run connect`, `docs/getting-started.md`). Use one or the other for a project: both answer
the owner's messages if both are on.
