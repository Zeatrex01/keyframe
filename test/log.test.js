// The studio's log: levelled, on stderr, readable by a person or (json) by a collector, and the
// page server stops cleanly on a stop signal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../src/core/log.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = () => new Date('2026-01-02T03:04:05.678Z');
const capture = () => { const lines = []; return { lines, stream: { write: s => lines.push(s) } }; };

test('a line below the level is dropped; text lines carry the time, the level and the fields', () => {
  const { lines, stream } = capture();
  const log = createLogger({ level: 'info', stream, now: at });
  log.debug('hidden');
  log.info('started', { port: 8731, dir: 'C:\\My Projects' });
  log.warn('slow');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '2026-01-02T03:04:05.678Z INFO  started port=8731 dir="C:\\\\My Projects"\n');
  assert.match(lines[1], / WARN {2}slow\n$/);
});

test('json lines are one object each, and an error keeps its message, code and stack', () => {
  const { lines, stream } = capture();
  const log = createLogger({ level: 'debug', format: 'json', stream, now: at }).child({ part: 'http' });
  log.error('failed', { err: Object.assign(new Error('boom'), { code: 'E1' }) });
  const obj = JSON.parse(lines[0]);
  assert.equal(obj.level, 'error');
  assert.equal(obj.part, 'http');
  assert.equal(obj.err.message, 'boom');
  assert.equal(obj.err.code, 'E1');
  assert.match(obj.err.stack, /log\.test\.js/);
});

test('silent writes nothing, an unknown level falls back to info, a broken stream never throws', () => {
  const { lines, stream } = capture();
  createLogger({ level: 'silent', stream }).error('x');
  assert.equal(lines.length, 0);
  assert.equal(createLogger({ level: 'loud', stream }).level, 'info');
  assert.doesNotThrow(() => createLogger({ stream: { write() { throw new Error('closed'); } } }).error('x'));
});

const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test('the page server answers on KS_PORT and stops cleanly on SIGTERM', { skip: process.platform === 'win32' && 'POSIX signals' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-stop-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'studio.js')], { env: { ...process.env, KS_PORT: String(port), KS_CONFIG: path.join(home, 'c.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let out = '';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no start: ${out}`)), 10_000);
      child.stdout.on('data', d => { out += d; if (out.includes(`127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); } });
      child.on('exit', code => reject(new Error(`exited ${code}: ${out}`)));
    });
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.ok, true);
    const code = await new Promise(resolve => { child.removeAllListeners('exit'); child.on('exit', resolve); child.kill('SIGTERM'); });
    assert.equal(code, 0);
  } finally { child.kill('SIGKILL'); fs.rmSync(home, { recursive: true, force: true }); }
});

test('a port that is not a number is refused before anything starts', () => {
  const r = spawn(process.execPath, [path.join(ROOT, 'tools', 'studio.js'), '--port', 'abc']);
  return new Promise(resolve => r.on('exit', code => { assert.equal(code, 2); resolve(); }));
});
