// The e2e smoke run must end on its own: once a passing run held the process for ten minutes
// (on Windows, chrome.exe's helpers kept its stderr pipe open after the kill).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const smoke = fs.readFileSync(new URL('../e2e/smoke.e2e.js', import.meta.url), 'utf8');

test('the e2e teardown quits the browser through DevTools, frees every child and has a last guard', () => {
  const teardown = smoke.slice(smoke.lastIndexOf('} finally {'));
  assert.match(smoke, /send\('Browser\.close'\)/, 'the browser is asked to quit all its processes');
  assert.ok(teardown.indexOf('page?.quit()') >= 0 && teardown.indexOf('page?.quit()') < teardown.indexOf('child.kill()'), 'quit before the kill');
  assert.match(teardown, /stream\?\.destroy\(\)/, 'the pipes of every child are destroyed');
  assert.match(teardown, /child\.unref\(\)/, 'no child keeps the run alive');
  assert.match(smoke, /after\(\(\) => \{\s*setTimeout\([\s\S]*process\.exit[\s\S]*\.unref\(\)/, 'a last guard ends a held run');
});
