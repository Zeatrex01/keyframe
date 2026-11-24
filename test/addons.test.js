// ffmpeg and yt-dlp are optional add-ons. Without them the studio works and does not nag: the link
// field is not shown at all, and Settings lists each add-on with what it adds and how to install it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addons, createStudioServer } from '../src/server/http.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('each add-on says whether it is here and gives the install line for this platform', () => {
  const none = addons({ ffmpeg: null, ytdlp: null }, 'win32');
  assert.deepEqual(none.map(a => [a.id, a.installed]), [['ffmpeg', false], ['ytdlp', false], ['spineCli', false]]);
  assert.match(none[1].install, /^winget install yt-dlp$/);
  assert.match(addons({}, 'darwin')[0].install, /^brew install ffmpeg$/);
  assert.match(addons({}, 'linux')[1].install, /yt-dlp/);
  assert.equal(addons({ ffmpeg: '/usr/bin/ffmpeg', ytdlp: 'yt-dlp', spineCli: '/opt/Spine' }, 'linux').every(a => a.installed), true);
});

test('Settings answers with the add-ons', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-addons-'));
  const studio = createStudioServer({ version: 'test', configFile: path.join(root, 'c.json') });
  const port = await studio.listen(0);
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/api/settings`)).json();
    assert.deepEqual(body.addons.map(a => a.id), ['ffmpeg', 'ytdlp', 'spineCli']);
    for (const a of body.addons) assert.equal(typeof a.installed, 'boolean');
  } finally { await studio.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('without yt-dlp the link field is hidden, not disabled with an install paragraph', () => {
  assert.match(read('../web/index.html'), /<form class="ref-link" id="refLinkForm" hidden>/, 'hidden before any script runs');
  const ref = read('../web/reference.js');
  assert.match(ref, /el\.refLinkForm\.hidden = !can;/);
  for (const lang of ['en', 'tr']) {
    const dict = JSON.parse(read(`../locale/${lang}.json`));
    assert.equal(dict['ref.linkMissing'], undefined, `${lang}: no install nag beside the reference`);
    for (const key of ['settings.addonsTitle', 'settings.addon.ffmpeg', 'settings.addon.ytdlp', 'settings.addon.spineCli']) assert.ok(dict[key], `${lang} ${key}`);
  }
  assert.match(read('../web/index.html'), /id="addonList"/);
});
