// Gate for connecting Claude Code and Claude Desktop: the Claude Code line works in every folder,
// and the Add to Claude Desktop button adds only the studio's entry, keeps the owner's other
// servers and settings, backs the file up first, and never touches a file it cannot read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { addToDesktop, desktopStatus, desktopConfigPath } from '../src/core/claude-desktop.js';
import { connectionFor, desktopEntry } from '../src/core/connect.js';
import { createStudioServer } from '../src/server/http.js';

const entry = { command: '/usr/bin/node', args: ['/repo/tools/mcp-server.js'] };
function desktopDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-claude-desktop-'));
  return { dir, file: path.join(dir, 'claude_desktop_config.json') };
}

test('the Claude Code line adds the studio for every folder; Claude Desktop gets Node by its full path', () => {
  const { clients } = connectionFor('/repo', { execPath: '/opt/node/bin/node' });
  assert.equal(clients.find(c => c.id === 'claude-code').text, 'claude mcp add --scope user keyframe-studio -- node "/repo/tools/mcp-server.js"');
  assert.deepEqual(JSON.parse(clients.find(c => c.id === 'claude-desktop').text).mcpServers['keyframe-studio'], { command: '/opt/node/bin/node', args: ['/repo/tools/mcp-server.js'] });
  assert.deepEqual(desktopEntry('/x', { appRoot: 'C:\\Apps\\Keyframe Studio' }), { command: 'cmd', args: ['/c', 'C:\\Apps\\Keyframe Studio\\keyframe-mcp.cmd'] });
  assert.equal(desktopConfigPath({ APPDATA: 'C:\\U\\AppData\\Roaming' }, 'win32', 'C:\\U'), path.join('C:\\U\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'));
  assert.equal(desktopConfigPath({}, 'darwin', '/Users/u'), '/Users/u/Library/Application Support/Claude/claude_desktop_config.json');
});

test('adding keeps everything else, backs the file up, and does nothing the second time', () => {
  const { dir, file } = desktopDir();
  const before = { mcpServers: { other: { command: 'npx', args: ['-y', 'x'] } }, globalShortcut: 'Ctrl+Space' };
  fs.writeFileSync(file, JSON.stringify(before));
  const done = addToDesktop(entry, file, new Date('2026-11-24T10:00:00Z'));
  assert.equal(done.changed, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ...before, mcpServers: { ...before.mcpServers, 'keyframe-studio': entry } });
  assert.deepEqual(JSON.parse(fs.readFileSync(done.backup, 'utf8')), before, 'the backup is the file as it was');
  assert.equal(desktopStatus(entry, file).current, true);
  const again = addToDesktop(entry, file);
  assert.deepEqual([again.changed, again.backup], [false, null]);
  assert.equal(fs.readdirSync(dir).filter(n => n.includes('keyframe-backup')).length, 1);
  assert.equal(desktopStatus({ ...entry, command: 'node' }, file).current, false, 'an older entry is told apart');
});

test('a config it cannot read, or no Claude Desktop at all, is left alone', () => {
  const { dir, file } = desktopDir();
  fs.writeFileSync(file, '{ "mcpServers": { broken');
  assert.throws(() => addToDesktop(entry, file), err => err.code === 'claude-desktop-config-invalid');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "mcpServers": { broken');
  assert.equal(desktopStatus(entry, file).invalid, true);
  const missing = path.join(dir, 'nope', 'claude_desktop_config.json');
  assert.throws(() => addToDesktop(entry, missing), err => err.code === 'claude-desktop-missing');
  assert.equal(fs.existsSync(path.dirname(missing)), false);
  // a new install has the folder but no file yet
  const fresh = desktopDir();
  assert.equal(addToDesktop(entry, fresh.file).backup, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(fresh.file, 'utf8')), { mcpServers: { 'keyframe-studio': entry } });
});

test('the page reads the status and adds only on a POST', async () => {
  const { file } = desktopDir();
  fs.writeFileSync(file, '{}');
  const saved = process.env.KS_CLAUDE_DESKTOP_CONFIG;
  process.env.KS_CLAUDE_DESKTOP_CONFIG = file;
  const config = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-cfg-')), 'studio.config.json');
  const studio = createStudioServer({ version: 'test', configFile: config, appRoot: null });
  const port = await studio.listen(0);
  const call = method => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: '/api/connect/claude-desktop', headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject); req.end(method === 'POST' ? '{}' : undefined);
  });
  try {
    assert.deepEqual([(await call('GET')).added, fs.readFileSync(file, 'utf8')], [false, '{}'], 'looking changes nothing');
    const added = await call('POST');
    assert.equal(added.current, true);
    assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers['keyframe-studio'].args[0].endsWith(path.join('tools', 'mcp-server.js')));
  } finally {
    await studio.close();
    if (saved === undefined) delete process.env.KS_CLAUDE_DESKTOP_CONFIG; else process.env.KS_CLAUDE_DESKTOP_CONFIG = saved;
  }
});
