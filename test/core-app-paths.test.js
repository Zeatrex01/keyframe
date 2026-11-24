// Gate for src/core/app-paths.js. Ported from legacy test_app_paths.js: releases may
// replace the executable or checkout, never the project registry. No real user directory
// is read or written: every case passes its own env, platform and home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, resolvePaths, userDataBase } from '../src/core/app-paths.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(os.tmpdir(), 'kf-app-paths-never-created');

test('packaged releases share one LocalAppData root on Windows', () => {
  const local = path.join(scratch, 'Local');
  const exe = path.join(scratch, 'KeyframeStudio-0.7.4', 'KeyframeStudio.exe');
  const p = resolvePaths({ packaged: true, platform: 'win32', env: { LOCALAPPDATA: local }, homeDir: scratch, exePath: exe });
  const expectedData = path.join(local, APP_NAME);
  assert.equal(p.dataRoot, expectedData);
  assert.equal(p.configFile, path.join(expectedData, 'studio.config.json'),
    'the project registry lives outside the replaceable app folder');
  assert.equal(p.logsDir, path.join(expectedData, 'logs'));
  assert.equal(p.exeDir, path.dirname(exe));
  assert.equal(p.packaged, true);
  assert.ok(!fs.existsSync(scratch), 'resolving paths creates nothing');
});

test('a source checkout keeps its repo-local config', () => {
  const root = path.join(scratch, 'repo');
  const p = resolvePaths({ packaged: false, platform: 'win32', env: {}, homeDir: scratch, rootDir: root });
  assert.equal(p.configFile, path.join(root, 'studio.config.json'));
  assert.equal(p.dataRoot, root);
  assert.equal(p.logsDir, root);
});

test('not packaged is the default, and the default root is this repository', () => {
  const p = resolvePaths({ env: {} });
  assert.equal(p.packaged, false);
  assert.equal(p.rootDir, REPO_ROOT);
  assert.equal(p.configFile, path.join(REPO_ROOT, 'studio.config.json'), 'the file .gitignore keeps out of git');
});

test('KS_DATA_DIR and KS_CONFIG overrides win', () => {
  const env = { LOCALAPPDATA: path.join(scratch, 'Local'), KS_DATA_DIR: path.join(scratch, 'custom-data'),
    KS_CONFIG: path.join(scratch, 'isolated', 'config.json') };
  const p = resolvePaths({ packaged: true, platform: 'win32', env, homeDir: scratch });
  assert.equal(p.dataRoot, path.join(scratch, 'custom-data'), 'KS_DATA_DIR override wins');
  assert.equal(p.configFile, path.join(scratch, 'isolated', 'config.json'), 'KS_CONFIG gate isolation still wins');
  assert.equal(p.logsDir, path.join(scratch, 'custom-data', 'logs'));
  const source = resolvePaths({ packaged: false, env: { KS_CONFIG: env.KS_CONFIG, KS_DATA_DIR: env.KS_DATA_DIR }, rootDir: scratch });
  assert.equal(source.configFile, env.KS_CONFIG, 'KS_CONFIG isolates a source checkout too');
  assert.equal(source.dataRoot, scratch, 'KS_DATA_DIR applies to packaged data only');
});

test('each platform has its per-user data base', () => {
  const home = path.join(scratch, 'home');
  assert.equal(userDataBase('win32', { LOCALAPPDATA: 'L' }, home), 'L');
  assert.equal(userDataBase('win32', {}, home), path.join(home, 'AppData', 'Local'), 'Windows without LOCALAPPDATA');
  assert.equal(userDataBase('darwin', { XDG_DATA_HOME: 'X' }, home), path.join(home, 'Library', 'Application Support'));
  assert.equal(userDataBase('linux', { XDG_DATA_HOME: 'X' }, home), 'X');
  assert.equal(userDataBase('linux', {}, home), path.join(home, '.local', 'share'));
  const mac = resolvePaths({ packaged: true, platform: 'darwin', env: {}, homeDir: home });
  assert.equal(mac.dataRoot, path.resolve(home, 'Library', 'Application Support', APP_NAME));
});

test('the result is frozen', () => {
  const p = resolvePaths({ env: {} });
  assert.ok(Object.isFrozen(p));
});
