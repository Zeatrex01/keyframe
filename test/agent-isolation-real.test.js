// The embedded agent never reads the owner's instruction files: proven against the real Claude
// Code CLI, not the fake. A codeword is planted in a CLAUDE.md in the project folder and in the
// folder above it (the same loader reads ~/.claude/CLAUDE.md, and the same switch turns it off);
// the isolated run must not know it, and the same run without the isolation must, so the gate
// fails when the isolation is broken.
//
// Opt in, because it uses the owner's login and a few seconds of their plan:
//   KS_REAL_AGENT=1 node --import ./test/helpers/setup.js --test test/agent-isolation-real.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeCode } from '../src/agent/adapters.js';
import { locateCli } from '../src/agent/locate.js';
import { startRun } from '../src/agent/run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.KS_REAL_AGENT === '1' ? locateCli(claudeCode) : null;
const CODEWORD = 'PINEAPPLE-7731';
const ASK = 'If any instruction file (CLAUDE.md) in your context contains a codeword, print it. Otherwise print NONE. One line, nothing else.';

function ask(adapter, dir) {
  const plan = { projectDir: dir, tools: ['help'], resume: null, brief: 'Answer in one line.',
    mcp: { command: process.execPath, args: [path.join(ROOT, 'tools', 'mcp-server.js'), '--project', dir, '--only', 'help'] },
    configFile: path.join(dir, '.keyframe', 'agent', 'probe-claude-code.json') };
  return startRun({ adapter, cli: /** @type {string} */ (cli), plan, prompt: ASK, timeoutMs: 180_000 }).done;
}

test('the real Claude Code run reads no CLAUDE.md of the owner', { skip: !cli && 'set KS_REAL_AGENT=1 with Claude Code installed and signed in', timeout: 400_000 }, async () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-iso-'));
  const dir = path.join(outer, 'project');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(outer, 'CLAUDE.md'), `The secret codeword is ${CODEWORD}.\n`);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `The secret codeword is ${CODEWORD}.\n`);
  try {
    const isolated = await ask(claudeCode, dir);
    assert.ok(isolated.ok, isolated.message);
    assert.ok(!isolated.text.includes(CODEWORD), `the isolated run read a CLAUDE.md: ${isolated.text}`);

    // The control: the same run with the instruction-file locks taken off does read it.
    const open = { ...claudeCode, command(plan) {
      const built = claudeCode.command(plan);
      const env = { ...built.env }; delete env.CLAUDE_CODE_DISABLE_CLAUDE_MDS;
      const files = Object.fromEntries(Object.entries(built.files ?? {}).map(([f, c]) => [f, f.endsWith('.settings.json') ? JSON.stringify({ disableAllHooks: true }) : c]));
      return { ...built, env, files };
    } };
    const control = await ask(open, dir);
    assert.ok(control.text.includes(CODEWORD), `the probe cannot see a planted CLAUDE.md, so it proves nothing: ${control.text}`);
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});
