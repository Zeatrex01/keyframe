// The one-shot command line: the same wire, one call per process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../tools/cli.js', import.meta.url));
const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-cli-'));
  for (const f of ['ident.json', 'ident.atlas', 'ident.png']) fs.copyFileSync(new URL(f, FIXTURE), path.join(dir, f));
  return dir;
}

test('list shows the default set, and the shelf only with --all', () => {
  const plain = run('list');
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout.trim().split('\n').length, 31);
  assert.ok(plain.stdout.includes('bake_animation') && !plain.stdout.includes('export_binary'));
  assert.ok(run('list', '--all').stdout.includes('export_binary'));
});

test('a tool call prints the answer, writes a returned image, and reports refusals by exit code', () => {
  const dir = project();
  try {
    const start = run('start_here', '--project', dir);
    assert.equal(start.status, 0);
    assert.equal(JSON.parse(start.stdout).skeletons[0].file, 'ident.json');

    const out = path.join(dir, 'strip.png');
    const animation = JSON.parse(start.stdout).skeletons[0].animations[0];
    const see = run('see_animation', '--project', dir, '--args', JSON.stringify({ animation }), '--out', out);
    assert.equal(see.status, 0, see.stdout + see.stderr);
    assert.deepEqual([...fs.readFileSync(out).subarray(1, 4)], [0x50, 0x4e, 0x47], 'a PNG was written');

    assert.equal(run('export_binary', '--project', dir).status, 1, 'a shelved tool is refused without --all');
    assert.equal(run('read_rig', '--project', dir, '--args', '{not json').status, 2);
    assert.equal(run().status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a long answer arrives whole through a pipe', () => {
  const dir = project();
  try {
    const times = Array.from({ length: 121 }, (_, i) => +(i / 30).toFixed(4));
    const start = JSON.parse(run('start_here', '--project', dir).stdout);
    const out = run('sample_animation', '--project', dir, '--args', JSON.stringify({ animation: start.skeletons[0].animations[0], times }));
    assert.equal(out.status, 0);
    assert.ok(out.stdout.length > 100000, `only ${out.stdout.length} bytes arrived`);
    assert.equal(JSON.parse(out.stdout).samples.length, times.length, 'the JSON is complete and parses');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('a tool off the default set is refused with how to turn it on', () => {
  const dir = project();
  try {
    const r = run('export_player', '--project', dir, '--args', JSON.stringify({ file: 'ident.json' }));
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /advanced tool.*--all/);
    assert.equal(run('export_player', '--project', dir, '--all', '--args', JSON.stringify({ file: 'ident.json' })).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
