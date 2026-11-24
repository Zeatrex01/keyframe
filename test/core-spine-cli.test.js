// Gate for src/core/spine-cli.js. Ported from the CLI half of legacy test_spine_info.js.
// The licensed editor is not available to a gate, so a FIXTURE stands in for Spine.com: a
// Node script that records its argv and prints a canned verdict. That proves what this
// module owns (lookup order, argument passing, verbatim output, exit code, timeout) and
// nothing about the real editor's output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locateSpineCli, runSpineCli } from '../src/core/spine-cli.js';

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-cli-'));
  // A lookup env that finds nothing even on a machine with Spine installed.
  const empty = path.join(dir, 'empty.config.json');
  fs.writeFileSync(empty, '{}');
  const env = { KS_CONFIG: empty, ProgramFiles: path.join(dir, 'x1'), 'ProgramFiles(x86)': path.join(dir, 'x2'),
    LOCALAPPDATA: path.join(dir, 'x3') };
  return { dir, env, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const touch = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); return file; };

test('with nothing installed the answer is null, not an exception', () => {
  const s = scratch();
  try {
    assert.equal(locateSpineCli(s.env), null);
    assert.equal(locateSpineCli({ ...s.env, KS_CONFIG: path.join(s.dir, 'missing.json') }), null, 'no config file');
    fs.writeFileSync(s.env.KS_CONFIG, '{ not json');
    assert.equal(locateSpineCli(s.env), null, 'a broken config is not a crash');
  } finally { s.done(); }
});

test('SPINE_CLI is final: when it points nowhere no other install is used', () => {
  const s = scratch();
  try {
    const installed = touch(path.join(s.env.ProgramFiles, 'Spine', 'Spine.com'));
    assert.equal(locateSpineCli(s.env), installed, 'the install is found without SPINE_CLI');
    assert.equal(locateSpineCli({ ...s.env, SPINE_CLI: path.join(s.dir, 'nope') }), null);
    const chosen = touch(path.join(s.dir, 'chosen', 'Spine.com'));
    assert.equal(locateSpineCli({ ...s.env, SPINE_CLI: chosen }), chosen);
    assert.equal(locateSpineCli({ ...s.env, SPINE_CLI: path.join(s.dir, 'chosen') }), null, 'a folder is not a CLI');
  } finally { s.done(); }
});

test('spineCli in the config comes before the usual installs, and a stale one is skipped', () => {
  const s = scratch();
  try {
    const installed = touch(path.join(s.env.LOCALAPPDATA, 'Spine Pro', 'Spine.exe'));
    const configured = touch(path.join(s.dir, 'configured', 'Spine.com'));
    fs.writeFileSync(s.env.KS_CONFIG, JSON.stringify({ spineCli: configured }));
    assert.equal(locateSpineCli(s.env), configured);
    fs.writeFileSync(s.env.KS_CONFIG, JSON.stringify({ spineCli: path.join(s.dir, 'gone', 'Spine.com') }));
    assert.equal(locateSpineCli(s.env), installed, 'a config path that no longer exists falls through');
  } finally { s.done(); }
});

test('the usual installs are searched root by root, Spine.com first', () => {
  const s = scratch();
  try {
    const x86 = touch(path.join(s.env['ProgramFiles(x86)'], 'Spine', 'Spine.exe'));
    assert.equal(locateSpineCli(s.env), x86);
    const com = touch(path.join(s.env['ProgramFiles(x86)'], 'Spine', 'Spine.com'));
    assert.equal(locateSpineCli(s.env), com, 'Spine.com (the console build) wins over Spine.exe');
    const first = touch(path.join(s.env.ProgramFiles, 'Spine.exe'));
    assert.equal(locateSpineCli(s.env), first, 'ProgramFiles comes before ProgramFiles(x86); a bare root counts');
  } finally { s.done(); }
});

function fakeCli(dir, ext = '.js') {
  const argvLog = path.join(dir, 'argv.json');
  const file = path.join(dir, 'fake_spine' + ext);
  const body = `
fs.writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));
const a = process.argv.slice(2);
const f = a[a.indexOf('-i') + 1] || '';
if (/broken/.test(f)) { console.error('Error: cannot read project'); process.exit(3); }
if (/slow/.test(f)) { setTimeout(() => {}, 60000); }
else if (/loud/.test(f)) { process.stdout.write('x'.repeat(4096)); }
else { console.log('Project: ' + f.split(/[\\\\/]/).pop() + '\\nSaved with: 4.2.43'); }
`;
  // Pin the .js stand-in to CommonJS whatever package.json sits above the temp folder.
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}');
  fs.writeFileSync(file, (ext === '.mjs' ? "import fs from 'node:fs';" : "const fs = require('fs');") + body);
  return { file, argvLog };
}

test('a .js stand-in runs under Node with exactly the given arguments, output verbatim', async () => {
  const s = scratch();
  try {
    const { file, argvLog } = fakeCli(s.dir);
    const target = path.join(s.dir, 'rig.json');
    const r = await runSpineCli(file, ['-i', target]);
    assert.deepEqual(JSON.parse(fs.readFileSync(argvLog, 'utf8')), ['-i', target]);
    assert.equal(r.code, 0);
    assert.equal(r.spawnError, null);
    assert.equal(r.timedOut, false);
    assert.match(r.stdout, /^Project: rig\.json\r?\nSaved with: 4\.2\.43/);
    assert.equal(r.stderr, '');
  } finally { s.done(); }
});

test('an .mjs stand-in runs under Node too', async () => {
  const s = scratch();
  try {
    const { file } = fakeCli(s.dir, '.mjs');
    const r = await runSpineCli(file, ['-i', 'hero.spine']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Project: hero\.spine/);
  } finally { s.done(); }
});

test('a non-zero exit is reported with its code and stderr, not hidden', async () => {
  const s = scratch();
  try {
    const { file } = fakeCli(s.dir);
    const r = await runSpineCli(file, ['-i', 'broken.json']);
    assert.equal(r.code, 3);
    assert.equal(r.timedOut, false);
    assert.equal(r.spawnError, null);
    assert.match(r.stderr, /cannot read project/);
  } finally { s.done(); }
});

test('a hung CLI is killed at the timeout and says so', async () => {
  const s = scratch();
  try {
    const { file } = fakeCli(s.dir);
    const r = await runSpineCli(file, ['-i', 'slow.json'], { timeoutMs: 400 });
    assert.equal(r.timedOut, true);
    assert.equal(r.code, null);
  } finally { s.done(); }
});

test('a CLI that cannot start is a spawn error, not an exception', async () => {
  const s = scratch();
  try {
    const r = await runSpineCli(path.join(s.dir, 'missing', 'Spine.com'), ['-i', 'x']);
    assert.equal(r.spawnError, 'ENOENT');
    assert.equal(r.code, null);
    assert.equal(r.timedOut, false);
  } finally { s.done(); }
});

test('output beyond maxBuffer is cut and reported, never as a timeout', async () => {
  const s = scratch();
  try {
    const { file } = fakeCli(s.dir);
    const r = await runSpineCli(file, ['-i', 'loud.json'], { maxBuffer: 100 });
    assert.equal(r.spawnError, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    assert.equal(r.timedOut, false);
    assert.ok(r.stdout.length <= 100, `kept ${r.stdout.length} bytes`);
  } finally { s.done(); }
});
