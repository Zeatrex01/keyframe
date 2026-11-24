// The link intake: parsing, the argument array, failure reading and the save path, all without
// the network or the yt-dlp program (a fake runner stands in for it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locateYtDlp, parseLink, buildArgs, checkRange, classifyFailure, fetchReference, killTree } from '../src/core/ytdlp.js';
import { parseArgs, main as cli } from '../tools/fetch-reference.js';

const ID = 'dQw4w9WgXcQ';
const URL_OK = `https://www.youtube.com/watch?v=${ID}`;
const code = fn => { try { fn(); } catch (e) { return e.code; } return null; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kf-ytdlp-'));
const clean = dir => fs.rmSync(dir, { recursive: true, force: true });

test('parseLink accepts each allowed form and rebuilds the address', () => {
  for (const link of [`https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&t=5s&list=PLx`, `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=abc`, `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/live/${ID}?feature=share`, `  https://youtu.be/${ID}  `]) {
    assert.deepEqual(parseLink(link), { site: 'youtube', id: ID, url: URL_OK }, link);
  }
});

test('parseLink refuses what is not a usable YouTube link, and anything that is not a link', () => {
  // (the full list of refusals for other sites is in test/link.test.js)
  for (const bad of [`http://www.youtube.com/watch?v=${ID}`, 'https://www.youtube.com/playlist?list=PLabcdefghijk', 'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/watch?list=PLabcdefghijk', 'https://www.youtube.com/watch?v=short', `https://www.youtube.com/watch?v=${ID}x`,
    `https://youtu.be/${ID};rm -rf /`, `https://youtu.be/${ID}$(id)`, `--exec=calc ${URL_OK}`, `-o ${URL_OK}`, '--version', '', 'not a link',
    `https://user:pw@www.youtube.com/watch?v=${ID}`, `https://www.youtube.com:8443/watch?v=${ID}`, 42, null, undefined]) {
    assert.equal(code(() => parseLink(bad)), 'bad-link', String(bad));
  }
});

test('buildArgs is an array, takes no cookies, stays inside dir and ranges only when valid', () => {
  const dir = path.join(os.tmpdir(), 'reference');
  const whole = buildArgs({ url: URL_OK, dir });
  assert.ok(Array.isArray(whole));
  assert.ok(whole.includes('--no-playlist'));
  assert.ok(whole.includes('--ignore-config'), 'a user config file cannot bring cookies back');
  assert.ok(!whole.some(a => /cookie/i.test(a)));
  assert.ok(!whole.includes('--download-sections'));
  assert.equal(whole[whole.indexOf('-P') + 1], dir);
  assert.equal(whole[whole.indexOf('-o') + 1], `${ID}.%(ext)s`);
  assert.equal(whole.at(-1), URL_OK);
  assert.equal(whole.filter(a => a.startsWith('http')).length, 1);

  const ranged = buildArgs({ url: URL_OK, dir, from: 5, to: 12.5, ffmpegLocation: 'C:\\tools\\ffmpeg.exe' });
  assert.equal(ranged[ranged.indexOf('--download-sections') + 1], '*0:00:05-0:00:12.5');
  assert.equal(ranged[ranged.indexOf('-o') + 1], `${ID}_5-12p5.%(ext)s`);
  assert.equal(ranged[ranged.indexOf('--ffmpeg-location') + 1], 'C:\\tools\\ffmpeg.exe');
  assert.equal(ranged.at(-1), URL_OK);

  for (const [from, to] of [[-1, 5], [5, 5], [9, 3], [Number.NaN, 4], ['2', '6'], [0, Infinity], [0, 99999999]]) {
    assert.equal(code(() => buildArgs({ url: URL_OK, dir, from, to })), 'bad-argument', `${from}-${to}`);
  }
  assert.equal(code(() => buildArgs({ url: `https://youtu.be/${ID}`, dir })), 'bad-link', 'only the rebuilt address is accepted');
  assert.equal(code(() => buildArgs({ url: URL_OK })), 'bad-argument');
});

test('classifyFailure reads the program\'s own messages', () => {
  const cases = {
    'bot-check': 'ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you\u2019re not a bot. Use --cookies-from-browser',
    'unavailable': 'ERROR: [youtube] dQw4w9WgXcQ: Private video. Sign in if you\'ve been granted access to this video',
    'too-large': 'File is larger than max-filesize (400000000 bytes > 314572800 bytes). Aborting.',
    'rate-limited': 'ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests',
    'network': 'ERROR: [youtube] dQw4w9WgXcQ: Unable to download API page: <urlopen error [Errno 11001] getaddrinfo failed>',
    'unknown': 'ERROR: something nobody has seen',
  };
  for (const [want, stderr] of Object.entries(cases)) assert.equal(classifyFailure(stderr), want);
  assert.equal(classifyFailure('ERROR: Video unavailable. This video is members-only'), 'unavailable');
  assert.equal(classifyFailure('Sign in to confirm your age. This video may be inappropriate for some users.'), 'unavailable');
  assert.equal(classifyFailure(''), 'unknown');
});

test('locateYtDlp is null when nothing runs', () => {
  assert.equal(locateYtDlp({ YT_DLP: path.join(tmp(), 'missing-yt-dlp'), PATH: '' }), null);
});

test('fetchReference without the program says how to get it', async () => {
  const dir = tmp();
  try {
    await assert.rejects(() => fetchReference(dir, URL_OK, { ytdlp: null, ffmpeg: null }), e => e.code === 'no-yt-dlp' && /winget install yt-dlp/.test(e.message));
    assert.equal(fs.existsSync(path.join(dir, 'reference')), false, 'nothing was created');
  } finally { clean(dir); }
});

test('fetchReference reuses an existing file and runs nothing', async () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'reference'));
    fs.writeFileSync(path.join(dir, 'reference', `${ID}.mp4`), 'owner file');
    let ran = false;
    const r = await fetchReference(dir, URL_OK, { ytdlp: 'nope', ffmpeg: null, runner: async () => { ran = true; return { code: 0, stdout: '', stderr: '' }; } });
    assert.equal(ran, false);
    assert.equal(r.reused, true);
    assert.equal(r.file, `reference/${ID}.mp4`);
    assert.equal(fs.readFileSync(path.join(dir, 'reference', `${ID}.mp4`), 'utf8'), 'owner file');
  } finally { clean(dir); }
});

test('fetchReference saves through the runner, reads the real rate and warns below 50 fps', async () => {
  const dir = tmp();
  try {
    const seen = [];
    const runner = async (command, args) => {
      seen.push([command, args]);
      const out = path.join(args[args.indexOf('-P') + 1], `${ID}.webm`);
      fs.writeFileSync(out, 'video');
      return { code: 0, stdout: `${out}\n`, stderr: '' };
    };
    const probe = async () => ({ fps: 30, width: 1280, height: 720, duration: 12.5 });
    const r = await fetchReference(dir, URL_OK, { ytdlp: 'fake-yt-dlp', ffmpeg: 'fake-ffmpeg', runner, probe });
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], 'fake-yt-dlp');
    assert.equal(r.file, `reference/${ID}.webm`);
    assert.deepEqual([r.id, r.fps, r.width, r.height, r.duration], [ID, 30, 1280, 720, 12.5]);
    assert.match(r.warning, /30 fps.*less exact than a 60 fps/);
    assert.deepEqual(r.warnings, [{ code: 'low-fps', fps: 30 }]);
    const again = await fetchReference(dir, URL_OK, { ytdlp: 'fake', ffmpeg: 'fake', runner, probe: async () => ({ fps: 60, duration: 3 }) });
    assert.equal(again.reused, true);
    assert.equal(again.warning, undefined);
    assert.equal(again.warnings, undefined);
    assert.equal(seen.length, 1, 'the second call downloaded nothing');
  } finally { clean(dir); }
});

test('fetchReference turns a failed run into a coded, plain refusal', async () => {
  const dir = tmp();
  try {
    const failing = stderr => async () => ({ code: 1, stdout: '', stderr });
    await assert.rejects(() => fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: null, runner: failing('Sign in to confirm you\u2019re not a bot') }),
      e => e.code === 'bot-check' && /15-30 minutes/.test(e.message) && /never uses your browser cookies/.test(e.message));
    await assert.rejects(() => fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: null, runner: failing('HTTP Error 429') }), e => e.code === 'rate-limited' && /15-30 minutes/.test(e.message));
    await assert.rejects(() => fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: null, runner: async () => ({ code: 0, stdout: '', stderr: '' }) }), e => e.code === 'download-failed');
    await assert.rejects(() => fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: null, from: 1, to: 2 }), e => e.code === 'no-ffmpeg');
    await assert.rejects(() => fetchReference(dir, 'http://example.com/x', { ytdlp: 'x' }), e => e.code === 'bad-link');
  } finally { clean(dir); }
});

test('the range is rounded once, so the cut, the file name and the reuse key agree', () => {
  const dir = path.join(os.tmpdir(), 'reference');
  const sections = (from, to) => { const a = buildArgs({ url: URL_OK, dir, from, to }); return [a[a.indexOf('--download-sections') + 1], a[a.indexOf('-o') + 1]]; };
  assert.deepEqual(sections(5.9996, 8), ['*0:00:06-0:00:08', `${ID}_6-8.%(ext)s`]);
  assert.deepEqual(sections(59.9996, 70), ['*0:01:00-0:01:10', `${ID}_60-70.%(ext)s`]);
  assert.deepEqual(sections(3599.9999, 3700), ['*1:00:00-1:01:40', `${ID}_3600-3700.%(ext)s`]);
  assert.equal(code(() => checkRange(5.0001, 5.0002)), 'bad-argument', 'a span that rounds to nothing is refused');
  assert.equal(code(() => checkRange(1.0001, 1.0003)), 'bad-argument');
});

test('a non-numeric end of the range is refused on its own', () => {
  for (const to of [Number.NaN, '6', null, {}, true]) assert.equal(code(() => checkRange(1, to)), 'bad-argument', String(to));
  assert.equal(code(() => checkRange(Number.NaN, undefined)), 'bad-argument');
  assert.deepEqual(checkRange(1, 6), { from: 1, to: 6 });
});

test('the format sort names the codec', () => {
  const a = buildArgs({ url: URL_OK, dir: os.tmpdir() });
  assert.match(a[a.indexOf('-S') + 1], /vcodec:h264/);
});

test('a probe that cannot read the saved file is a warning, not a failure, and the file is reused later', async () => {
  const dir = tmp();
  try {
    const runner = async (_c, args) => { const out = path.join(args[args.indexOf('-P') + 1], `${ID}.mp4`); fs.writeFileSync(out, 'v'); return { code: 0, stdout: out, stderr: '' }; };
    const probe = async () => { throw new Error('no duration'); };
    const r = await fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: 'f', runner, probe });
    assert.equal(r.file, `reference/${ID}.mp4`);
    assert.match(r.warning, /could not read it/);
    assert.deepEqual(r.warnings, [{ code: 'probe-failed', reason: 'no duration' }]);
    const again = await fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: 'f', runner, probe });
    assert.equal(again.reused, true);
  } finally { clean(dir); }
});

test('fetchReference: timeout, foreign printed path, oversize file, leftovers', async () => {
  const dir = tmp();
  try {
    const ref = path.join(dir, 'reference');
    const left = path.join(ref, `${ID}.f137.mp4.part`);
    const leave = () => { fs.mkdirSync(ref, { recursive: true }); fs.writeFileSync(left, 'half'); fs.writeFileSync(path.join(ref, `${ID}.ytdl`), 'x'); };
    await assert.rejects(() => fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: null, runner: async () => { leave(); return { code: -1, stdout: '', stderr: '', timedOut: true }; } }), e => e.code === 'timeout');
    assert.equal(fs.existsSync(left), false, 'the half-written file is removed after a timeout');
    assert.equal(fs.existsSync(path.join(ref, `${ID}.ytdl`)), false);
    await assert.rejects(() => fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: null, runner: async () => { leave(); return { code: 1, stdout: '', stderr: 'HTTP Error 429' }; } }), e => e.code === 'rate-limited');
    assert.equal(fs.existsSync(left), false, 'and after a failed run');

    // A printed path outside the folder is ignored; the file is found by its own name.
    const outside = path.join(dir, 'outside.mp4');
    const r = await fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: null, runner: async (_c, a) => {
      fs.writeFileSync(outside, 'no'); fs.writeFileSync(path.join(a[a.indexOf('-P') + 1], `${ID}.mp4`), 'yes');
      return { code: 0, stdout: `${outside}\n`, stderr: '' };
    } });
    assert.equal(r.file, `reference/${ID}.mp4`);
    fs.rmSync(path.join(ref, `${ID}.mp4`));
    // A printed path with a foreign extension is not trusted either; with no real file the run fails and names the size limit.
    const exe = path.join(ref, 'evil.exe'); fs.writeFileSync(exe, 'x');
    await assert.rejects(() => fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: null, runner: async () => ({ code: 0, stdout: `${exe}\n`, stderr: '' }) }), e => e.code === 'download-failed' && /300M/.test(e.message));

    // A file over the cap is deleted and reported.
    await assert.rejects(() => fetchReference(dir, URL_OK, { ytdlp: 'x', ffmpeg: null, maxBytes: 3, runner: async (_c, a) => {
      const out = path.join(a[a.indexOf('-P') + 1], `${ID}.mp4`); fs.writeFileSync(out, 'four'); return { code: 0, stdout: out, stderr: '' };
    } }), e => e.code === 'too-large' && /--from/.test(e.message));
    assert.equal(fs.existsSync(path.join(ref, `${ID}.mp4`)), false, 'the oversize file is removed');
  } finally { clean(dir); }
});

test('only one download runs per project: the same link joins it, another is refused', async () => {
  const dir = tmp();
  try {
    let release; const gate = new Promise(r => { release = r; });
    let runs = 0;
    const runner = async (_c, a) => { runs++; await gate; const out = path.join(a[a.indexOf('-P') + 1], `${ID}.mp4`); fs.writeFileSync(out, 'v'); return { code: 0, stdout: out, stderr: '' }; };
    const opts = { ytdlp: 'x', ffmpeg: null, runner };
    const first = fetchReference(dir, URL_OK, opts);
    const same = fetchReference(dir, URL_OK, opts);
    await assert.rejects(() => fetchReference(dir, 'https://youtu.be/AAAAAAAAAAA', opts), e => e.code === 'busy');
    release();
    const [a, b] = await Promise.all([first, same]);
    assert.equal(runs, 1);
    assert.equal(a.file, b.file);
    // The slot is free again afterwards.
    await assert.rejects(() => fetchReference(dir, 'https://youtu.be/AAAAAAAAAAA', { ...opts, runner: async () => ({ code: 1, stdout: '', stderr: '' }) }), e => e.code === 'unknown');
  } finally { clean(dir); }
});

test('killTree takes the whole tree down on Windows and the process elsewhere', () => {
  const calls = [];
  killTree({ pid: 42, kill: s => calls.push(['kill', s]) }, { platform: 'win32', exec: (...a) => calls.push(['exec', a[0], a[1]]) });
  assert.deepEqual(calls, [['exec', 'taskkill', ['/PID', '42', '/T', '/F']]]);
  const other = [];
  killTree({ pid: 42, kill: s => other.push(s) }, { platform: 'linux', exec: () => assert.fail('no taskkill off Windows') });
  assert.deepEqual(other, ['SIGKILL']);
});

test('the fetch-reference CLI parses its arguments and refuses plainly', async () => {
  assert.equal(parseArgs([]).error, 'a link is required');
  assert.match(parseArgs([URL_OK, '--wat']).error, /unknown option --wat/);
  assert.match(parseArgs([URL_OK, '--from', 'abc']).error, /--from needs a number/);
  assert.match(parseArgs([URL_OK, '--to']).error, /--to needs a number/);
  assert.match(parseArgs([URL_OK, URL_OK]).error, /only one link/);
  assert.deepEqual(parseArgs([URL_OK, '--project', 'p', '--from', '2', '--to', '9']), { link: URL_OK, project: 'p', from: 2, to: 9 });
  const out = [], err = [];
  assert.equal(await cli(['not a link'], { log: m => out.push(m), error: m => err.push(m) }), 1);
  assert.match(err.join('\n'), /refused \[bad-link\]/);
  assert.equal(await cli([], { log: m => out.push(m), error: m => err.push(m) }), 1);
  assert.match(err.at(-1), /usage:/);
  assert.equal(out.length, 0);
});
