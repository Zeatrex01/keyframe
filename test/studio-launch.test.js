// tools/studio.js as a user (or a test harness) starts it: `--port 0` takes any free port, and
// the printed address answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const STUDIO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'studio.js');

test('--port 0 listens on a free port, never on the default one', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-launch-'));
  const child = spawn(process.execPath, [STUDIO, '--port', '0'], { env: { ...process.env, KS_CONFIG: path.join(tmp, 'c.json'), KS_PORT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let out = '';
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no address printed: ${out}`)), 10_000);
      child.stdout.on('data', c => { out += c; const m = /open:\s+http:\/\/127\.0\.0\.1:(\d+)\//.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } });
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`exited ${code}: ${out}`)); });
    });
    assert.notEqual(port, 8731);
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.ok, true);
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
