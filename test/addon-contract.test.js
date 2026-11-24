// Every optional add-on follows one contract (src/core/addons.js, docs/addons.md): detection never
// throws, absent is a normal state with a 501 refusal code, and Settings can describe it in every
// language. A new add-on that skips a step fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADDONS, detectAddons, addonStatus } from '../src/core/addons.js';
import { statusFor } from '../src/server/respond.js';

const locale = lang => JSON.parse(fs.readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'));
const LANGS = fs.readdirSync(new URL('../locale/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));

test('each add-on states every part of the contract', () => {
  const ids = new Set();
  for (const addon of ADDONS) {
    assert.match(addon.id, /^[a-z][A-Za-z]*$/, `${addon.id}: a plain identifier`);
    assert.ok(!ids.has(addon.id), `${addon.id}: unique`); ids.add(addon.id);
    assert.equal(typeof addon.name, 'string');
    assert.match(addon.env, /^[A-Z_]+$/, `${addon.id}: an environment variable names its path`);
    assert.equal(typeof addon.locate, 'function');
    for (const platform of ['win32', 'darwin', 'other']) assert.ok(addon.install[platform], `${addon.id}: install line for ${platform}`);
    assert.match(addon.missingCode, /^no-/, `${addon.id}: refusal code`);
    assert.equal(statusFor(addon.missingCode), 501, `${addon.id}: absent is 501, not a crash`);
    for (const lang of LANGS) assert.ok(locale(lang)[`settings.addon.${addon.id}`], `${lang}: settings.addon.${addon.id}`);
  }
});

test('detection answers a path or null for every add-on and never throws', () => {
  const env = { ...process.env, FFMPEG: '/nowhere/ffmpeg', YT_DLP: '/nowhere/yt-dlp', SPINE_CLI: '/nowhere/Spine', KS_CONFIG: '/nowhere/c.json' };
  const found = detectAddons(env);
  assert.deepEqual(Object.keys(found), ADDONS.map(a => a.id));
  for (const id of Object.keys(found)) assert.ok(found[id] === null || typeof found[id] === 'string', id);
  assert.equal(found.spineCli, null, 'an explicit SPINE_CLI that points nowhere is final');
  assert.ok(addonStatus({}, 'linux').every(a => a.installed === false), 'missing ids count as absent');
});

test('a locator that throws counts as absent', () => {
  const broken = { ...ADDONS[0], id: 'broken', locate: () => { throw new Error('boom'); } };
  const fine = { ...ADDONS[0], id: 'fine', locate: () => '/usr/bin/fine' };
  assert.deepEqual(detectAddons({}, [broken, fine]), { broken: null, fine: '/usr/bin/fine' });
});
