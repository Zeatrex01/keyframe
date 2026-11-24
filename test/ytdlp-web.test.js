// The link intake for web links (any public https page the program can read): naming, the two-call
// flow, the argument arrays and the new failure codes. No network and no real program: a fake runner
// stands in for yt-dlp. The YouTube side is in test/ytdlp.test.js, the address checks in test/link.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLink } from '../src/core/link.js';
import { buildArgs, buildIdentityArgs, webStem, classifyFailure, fetchReference } from '../src/core/ytdlp.js';

const ID = 'dQw4w9WgXcQ';
const URL_OK = `https://www.youtube.com/watch?v=${ID}`;
// What the owner pastes, and the address the studio rewrites it to (the watch page asks for a signed-in account).
const PASTED = 'https://vimeo.com/76979871';
const WEB = 'https://player.vimeo.com/video/76979871';
const WEB_PAGE = 'https://www.artstation.com/artwork/abc123';
const code = fn => { try { fn(); } catch (e) { return e.code; } return null; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kf-ytdlp-web-'));
const clean = dir => fs.rmSync(dir, { recursive: true, force: true });

const isIdentity = args => args.includes('--skip-download');
const noCookies = args => !args.some(a => /cookie|--username|--password|--netrc/i.test(a));
const identity = (extractor, count, id) => `${extractor}\t${count}\t${id}\n`;
/** A fake program: answers the identity call with `who`, and a download by writing a file with `ext` into -P. */
function fakeProgram({ who, ext = 'mp4', seen = [] }) {
  return async (_cmd, args) => {
    seen.push(args);
    if (isIdentity(args)) return { code: 0, stdout: who, stderr: '' };
    const out = path.join(args[args.indexOf('-P') + 1], `${args[args.indexOf('-o') + 1].replace('.%(ext)s', '')}.${ext}`);
    fs.writeFileSync(out, 'video');
    return { code: 0, stdout: `${out}\n`, stderr: '' };
  };
}

// Real stderr text captured from yt-dlp 2026.10.26 on 2026-11-13 (metadata-only calls).
const FIXTURES = {
  'login-required': 'ERROR: [vimeo] 76979871: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (vimeo) to provide account credentials. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies',
  'unsupported-site': 'ERROR: Unsupported URL: https://example.com/',
  'not-found': 'ERROR: [vimeo] 56015672: Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)',
};

test('web stem: extractor and id reduced to safe characters, capped, hashed when the id changed', () => {
  assert.match(webStem('Vimeo', '76979871', WEB), /^vimeo_76979871_[0-9a-f]{8}$/);
  assert.match(webStem('ArtStation', 'ab-C_9', WEB), /^artstation_ab-C_9_[0-9a-f]{8}$/);
  assert.equal(webStem('Vimeo', '76979871', WEB), webStem('Vimeo', '76979871', WEB), 'the same link always gets the same name');
  const safe = /^[A-Za-z0-9_-]{1,80}$/;
  const hostile = ['../../etc/passwd', 'a/b\\c', '..', '.', 'two words', 'caf\u00e9-\u2603', 'x\u0000y', 'CON', 'a.b.c', '%2e%2e', '$(id)', '; rm -rf', 'a'.repeat(300)];
  const names = new Set();
  for (const id of hostile) {
    const stem = webStem('Vimeo', id, `https://vimeo.com/${encodeURIComponent(id)}`);
    assert.match(stem, safe, id);
    assert.ok(!stem.includes('..') && !stem.includes('/') && !stem.includes('\\'), id);
    names.add(stem);
  }
  assert.equal(names.size, hostile.length, 'different ids never share a name');
  assert.notEqual(webStem('Vimeo', 'a/b', 'https://x.org/1'), webStem('Vimeo', 'ab', 'https://x.org/1'), 'a reduced id differs from the clean id it reduces to');
  assert.equal(webStem('Vimeo', 'a'.repeat(300), WEB).length, 80);
  // an empty id, or one with nothing left, falls back to a short hash of the address
  for (const id of ['', '///', '..', '\u2603']) assert.match(webStem('Vimeo', id, WEB), /^vimeo_[0-9a-f]{8}$/, JSON.stringify(id));
  assert.match(webStem('', '123', WEB), /^web_123_[0-9a-f]{8}$/);
  assert.match(webStem('\u2603/..', '123', WEB), /^web_123_[0-9a-f]{8}$/);
  // the generic extractor names a file after the page, which is not unique: the address is added
  assert.match(webStem('Generic', 'index', 'https://a.example.org/x'), /^generic_index_[0-9a-f]{8}$/);
  assert.notEqual(webStem('Generic', 'index', 'https://a.example.org/x'), webStem('Generic', 'index', 'https://b.example.org/x'));
});

test('web stem: two different videos never share a name, also on a case-insensitive disk', () => {
  // an extractor that names the video after the page file gives the same id for different sites
  assert.notEqual(webStem('HTML5MediaEmbed', 'portfolio-1', 'https://a-artist.com/portfolio'), webStem('HTML5MediaEmbed', 'portfolio-1', 'https://b-artist.com/portfolio'));
  assert.notEqual(webStem('HTML5MediaEmbed', 'watch-1', 'https://s.org/watch.php?v=1'), webStem('HTML5MediaEmbed', 'watch-1', 'https://s.org/watch.php?v=2'));
  // ids that differ only in letter case must differ in lower case too (NTFS treats them as one file)
  const lower = (id, url) => webStem('Vimeo', id, url).toLowerCase();
  assert.notEqual(lower('AbC', 'https://vimeo.com/AbC'), lower('aBc', 'https://vimeo.com/aBc'));
  assert.notEqual(lower('ABC', 'https://vimeo.com/ABC'), lower('abc', 'https://vimeo.com/abc'));
});

test('the identity call asks who the video is and downloads nothing', () => {
  const a = buildIdentityArgs({ url: WEB });
  assert.deepEqual(a, ['--ignore-config', '--no-playlist', '--quiet', '--no-warnings', '--skip-download', '-I', '1',
    '--print', '%(extractor_key|)s\t%(playlist_count|)s\t%(id|)s', '--', WEB]);
  assert.ok(noCookies(a));
  assert.equal(code(() => buildIdentityArgs({ url: 'https://VIMEO.com/1' })), 'bad-link', 'only the address parseLink built');
  assert.equal(code(() => buildIdentityArgs({ url: '-o x' })), 'bad-link');
});

test('buildArgs for a web link: first item only, the format fallback, remux, "--", no cookies', () => {
  const dir = path.join(os.tmpdir(), 'reference');
  const whole = buildArgs({ url: WEB, dir, stem: 'vimeo_76979871', remux: true });
  assert.ok(Array.isArray(whole));
  assert.deepEqual(whole.slice(whole.indexOf('-I'), whole.indexOf('-I') + 2), ['-I', '1'], 'first video of a page only');
  assert.ok(whole.includes('--no-playlist') && whole.includes('--ignore-config') && whole.includes('--no-overwrites') && whole.includes('--no-mtime'));
  assert.equal(whole[whole.indexOf('-P') + 1], dir);
  assert.equal(whole[whole.indexOf('-o') + 1], 'vimeo_76979871.%(ext)s');
  assert.equal(whole[whole.indexOf('--max-filesize') + 1], '300M');
  assert.deepEqual(whole.slice(-2), ['--', WEB], 'the address comes after the end of options');
  assert.equal(whole.indexOf('--'), whole.length - 2, 'no other bare "--"');
  assert.equal(whole[whole.indexOf('-f') + 1], 'bv[height<=720][ext=mp4]/bv[height<=720][ext=webm]/b[height<=?720]/b/b*', 'video-only first, then combined, then anything');
  assert.equal(whole[whole.indexOf('-S') + 1], 'fps,res:720,vcodec:h264');
  assert.match(whole[whole.indexOf('--remux-video') + 1], /^mkv>mp4/);
  assert.ok(!buildArgs({ url: WEB, dir, stem: 'vimeo_1' }).includes('--remux-video'), 'without ffmpeg nothing is rewritten');
  assert.ok(!whole.includes('--download-sections'));
  assert.ok(noCookies(whole));

  const ranged = buildArgs({ url: WEB, dir, stem: 'vimeo_76979871', from: 2, to: 6, ffmpegLocation: 'C:\\tools\\ffmpeg.exe' });
  assert.equal(ranged[ranged.indexOf('--download-sections') + 1], '*0:00:02-0:00:06');
  assert.equal(ranged[ranged.indexOf('-o') + 1], 'vimeo_76979871_2-6.%(ext)s');
  assert.equal(ranged[ranged.indexOf('--ffmpeg-location') + 1], 'C:\\tools\\ffmpeg.exe');
  assert.deepEqual(ranged.slice(-2), ['--', WEB]);
  assert.ok(noCookies(ranged));

  for (const stem of [undefined, '', '../x', 'a b', 'a/b', 'x'.repeat(81)]) assert.equal(code(() => buildArgs({ url: WEB, dir, stem })), 'bad-argument', String(stem));
  assert.equal(code(() => buildArgs({ url: 'https://VIMEO.com/76979871', dir, stem: 'vimeo_1' })), 'bad-link');
});

test('a YouTube argument array keeps its own format and gains only the end of options', () => {
  const a = buildArgs({ url: URL_OK, dir: os.tmpdir() });
  assert.equal(a[a.indexOf('-f') + 1], 'bv[height<=720][ext=mp4]/bv[height<=720][ext=webm]');
  assert.deepEqual(a.slice(-2), ['--', URL_OK]);
  assert.ok(!a.includes('-I') && !a.includes('--remux-video'));
  assert.ok(noCookies(a));
});

test('a web link takes two calls and names the file from the program\'s answer', async () => {
  const dir = tmp();
  try {
    const seen = [];
    const probe = async () => ({ fps: 60, width: 1280, height: 720, duration: 8 });
    const r = await fetchReference(dir, PASTED, { ytdlp: 'fake', ffmpeg: 'ffmpeg', runner: fakeProgram({ who: identity('Vimeo', '', '76979871'), seen }), probe });
    assert.equal(seen.length, 2);
    assert.ok(isIdentity(seen[0]) && !isIdentity(seen[1]));
    assert.equal(seen[1][seen[1].indexOf('-o') + 1], `${webStem('Vimeo', '76979871', WEB)}.%(ext)s`);
    assert.ok(seen[1].includes('--remux-video'), 'ffmpeg is present, so unreadable containers are rewritten');
    assert.ok(seen.every(noCookies));
    assert.deepEqual([r.file, r.site, r.host, r.id, r.fps], [`reference/${webStem('Vimeo', '76979871', WEB)}.mp4`, 'web', 'vimeo.com', webStem('Vimeo', '76979871', WEB), 60]);
    assert.equal(r.warning, undefined, 'one video at 60 fps: nothing to warn about');
  } finally { clean(dir); }
});

test('a pasted Vimeo watch link reaches the program as the player address, in both calls', async () => {
  const dir = tmp();
  try {
    const seen = [];
    const probe = async () => ({ fps: 60, width: 1280, height: 720, duration: 8 });
    assert.equal(parseLink(PASTED).url, WEB);
    const r = await fetchReference(dir, PASTED, { ytdlp: 'fake', ffmpeg: 'ffmpeg', runner: fakeProgram({ who: identity('Vimeo', '', '76979871'), seen }), probe });
    assert.equal(seen.length, 2);
    assert.ok(isIdentity(seen[0]) && !isIdentity(seen[1]));
    for (const args of seen) {
      assert.deepEqual(args.slice(-2), ['--', 'https://player.vimeo.com/video/76979871']);
      assert.ok(!args.some(a => a.includes('//vimeo.com/')), 'the watch address never reaches the program');
    }
    assert.equal(r.host, 'vimeo.com', 'the host stays the one the owner pasted');
  } finally { clean(dir); }
});

test('a web link already saved is reused: the identity call runs, the download does not', async () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'reference'));
    const stem = webStem('Vimeo', '76979871', WEB);
    fs.writeFileSync(path.join(dir, 'reference', `${stem}.webm`), 'owner file');
    const seen = [];
    const r = await fetchReference(dir, PASTED, { ytdlp: 'fake', ffmpeg: null, runner: fakeProgram({ who: identity('Vimeo', '', '76979871'), seen }) });
    assert.equal(seen.length, 1);
    assert.ok(isIdentity(seen[0]));
    assert.equal(r.reused, true);
    assert.equal(r.file, `reference/${stem}.webm`);
    assert.equal(fs.readFileSync(path.join(dir, 'reference', `${stem}.webm`), 'utf8'), 'owner file');
  } finally { clean(dir); }
});

test('only the first of several videos is taken, and the result says how many there were', async () => {
  const dir = tmp();
  try {
    const seen = [];
    const probe = async () => ({ fps: 25, width: 320, height: 176, duration: 10 });
    const who = identity('HTML5MediaEmbed', '2', 'html5_video-1');
    const r = await fetchReference(dir, WEB_PAGE, { ytdlp: 'fake', ffmpeg: 'f', probe, runner: fakeProgram({ who, seen }) });
    assert.equal(r.file, `reference/${webStem('HTML5MediaEmbed', 'html5_video-1', WEB_PAGE)}.mp4`);
    assert.match(r.warning, /The page holds 2 videos; only the first was saved\./);
    assert.match(r.warning, /25 fps/, 'both warnings are kept');
    assert.deepEqual(r.warnings, [{ code: 'more-videos', count: 2 }, { code: 'low-fps', fps: 25 }]);
    for (const args of seen) assert.deepEqual(args.slice(args.indexOf('-I'), args.indexOf('-I') + 2), ['-I', '1']);
    // saved again: reused, and the page's count is still reported
    const again = await fetchReference(dir, WEB_PAGE, { ytdlp: 'fake', ffmpeg: null, runner: fakeProgram({ who, seen: [] }) });
    assert.equal(again.reused, true);
    assert.match(again.warning, /holds 2 videos/);
    // no ffmpeg: the frame rate is unknown, which is its own code beside the page count
    assert.deepEqual(again.warnings, [{ code: 'more-videos', count: 2 }, { code: 'fps-unknown' }]);
    // a page of one video, an empty count and a count that is not a number carry no such warning
    for (const count of ['1', '', 'NA']) {
      const d2 = tmp();
      try {
        const one = await fetchReference(d2, PASTED, { ytdlp: 'f', ffmpeg: null, runner: fakeProgram({ who: identity('Vimeo', count, '5') }) });
        assert.ok(!/videos;/.test(one.warning ?? ''), `count ${JSON.stringify(count)}`);
      } finally { clean(d2); }
    }
  } finally { clean(dir); }
});

test('a hostile id from the program cannot leave the reference folder or change the name', async () => {
  const dir = tmp();
  try {
    const seen = [];
    const r = await fetchReference(dir, PASTED, { ytdlp: 'fake', ffmpeg: null, runner: fakeProgram({ who: identity('Vimeo', '', '../../evil/..\\x y'), seen }) });
    assert.match(seen[1][seen[1].indexOf('-o') + 1], /^vimeo_[A-Za-z0-9_-]+\.%\(ext\)s$/);
    assert.equal(path.dirname(path.join(dir, r.file)), path.join(dir, 'reference'));
    assert.deepEqual(fs.readdirSync(dir), ['reference']);
  } finally { clean(dir); }
});

test('a web link needs the program before anything else, and a range needs ffmpeg', async () => {
  const dir = tmp();
  try {
    await assert.rejects(() => fetchReference(dir, PASTED, { ytdlp: null, ffmpeg: null }), e => e.code === 'no-yt-dlp');
    await assert.rejects(() => fetchReference(dir, PASTED, { ytdlp: 'x', ffmpeg: null, from: 1, to: 2, runner: async () => assert.fail('nothing runs') }), e => e.code === 'no-ffmpeg');
    assert.equal(fs.existsSync(path.join(dir, 'reference')), false);
  } finally { clean(dir); }
});

test('an identity answer with no video, or a failed call, is a coded refusal and saves nothing', async () => {
  const dir = tmp();
  try {
    const fail = stderr => async () => ({ code: 1, stdout: '', stderr });
    const opts = runner => ({ ytdlp: 'x', ffmpeg: null, runner });
    await assert.rejects(() => fetchReference(dir, PASTED, opts(fakeProgram({ who: '\n' }))), e => e.code === 'unsupported-site');
    await assert.rejects(() => fetchReference(dir, PASTED, opts(fakeProgram({ who: 'Vimeo\t\t\n' }))), e => e.code === 'unsupported-site');
    await assert.rejects(() => fetchReference(dir, PASTED, opts(fail(FIXTURES['unsupported-site']))), e => e.code === 'unsupported-site' && /no video it can read/.test(e.message));
    await assert.rejects(() => fetchReference(dir, PASTED, opts(fail(FIXTURES['login-required']))), e => e.code === 'login-required' && /never signs in/.test(e.message) && /add it as a file/.test(e.message));
    await assert.rejects(() => fetchReference(dir, PASTED, opts(fail('HTTP Error 429: Too Many Requests'))), e => e.code === 'rate-limited');
    await assert.rejects(() => fetchReference(dir, PASTED, opts(async () => ({ code: -1, stdout: '', stderr: '', timedOut: true }))), e => e.code === 'timeout');
    assert.equal(fs.existsSync(path.join(dir, 'reference')), false, 'nothing was created before the program named a video');
  } finally { clean(dir); }
});

test('a web download in a container the studio cannot read is removed and refused plainly', async () => {
  const dir = tmp();
  try {
    await assert.rejects(() => fetchReference(dir, PASTED, { ytdlp: 'x', ffmpeg: null, runner: fakeProgram({ who: identity('Vimeo', '', '9'), ext: 'mkv' }) }),
      e => e.code === 'bad-container' && /\.mkv/.test(e.message) && /Installing ffmpeg/.test(e.message));
    assert.deepEqual(fs.readdirSync(path.join(dir, 'reference')), [], 'the unreadable file is not left behind');
    await assert.rejects(() => fetchReference(dir, PASTED, { ytdlp: 'x', ffmpeg: 'f', probe: async () => ({}), runner: fakeProgram({ who: identity('Vimeo', '', '9'), ext: 'flv' }) }),
      e => e.code === 'bad-container' && /could not convert/.test(e.message));
    assert.deepEqual(fs.readdirSync(path.join(dir, 'reference')), []);
  } finally { clean(dir); }
});

test('two pages whose videos get the same id are two files, not a reuse', async () => {
  const dir = tmp();
  try {
    const who = identity('HTML5MediaEmbed', '', 'portfolio-1');
    const a = await fetchReference(dir, 'https://alice-anim.com/portfolio', { ytdlp: 'x', ffmpeg: null, runner: fakeProgram({ who }) });
    const b = await fetchReference(dir, 'https://bob-anim.com/portfolio', { ytdlp: 'x', ffmpeg: null, runner: fakeProgram({ who }) });
    assert.notEqual(a.file, b.file);
    assert.equal(b.reused, undefined);
    assert.equal(fs.readdirSync(path.join(dir, 'reference')).length, 2);
  } finally { clean(dir); }
});

test('a file the owner already had is never deleted or taken for this run result', async () => {
  const dir = tmp();
  try {
    const stem = webStem('Vimeo', '300', WEB);
    const ref = path.join(dir, 'reference');
    fs.mkdirSync(ref);
    fs.writeFileSync(path.join(ref, `${stem}.notes.txt`), 'owner');
    fs.writeFileSync(path.join(ref, `${stem}.mkv`), 'owner');
    // the program prints the path of a file that was already there
    const printing = file => async (_c, args) => (args.includes('--skip-download')
      ? { code: 0, stdout: identity('Vimeo', '', '300'), stderr: '' }
      : { code: 0, stdout: `${path.join(ref, file)}\n`, stderr: '' });
    await assert.rejects(() => fetchReference(dir, PASTED, { ytdlp: 'x', ffmpeg: null, runner: printing(`${stem}.mkv`) }), e => e.code === 'bad-container');
    await assert.rejects(() => fetchReference(dir, PASTED, { ytdlp: 'x', ffmpeg: null, runner: printing(`${stem}.notes.txt`) }), e => e.code === 'bad-container' || e.code === 'download-failed');
    assert.equal(fs.readFileSync(path.join(ref, `${stem}.mkv`), 'utf8'), 'owner');
    assert.equal(fs.readFileSync(path.join(ref, `${stem}.notes.txt`), 'utf8'), 'owner');
    // a printed path that is some other mp4 of the owner is not this run's result
    fs.writeFileSync(path.join(ref, 'owner-upload.mp4'), 'owner');
    await assert.rejects(() => fetchReference(dir, PASTED, { ytdlp: 'x', ffmpeg: null, runner: printing('owner-upload.mp4') }), e => e.code === 'download-failed');
    assert.equal(fs.readFileSync(path.join(ref, 'owner-upload.mp4'), 'utf8'), 'owner');
  } finally { clean(dir); }
});

test('a failed or stopped download removes what it made under its name and nothing else', async () => {
  const dir = tmp();
  try {
    const stem = webStem('Vimeo', '500', WEB);
    const ref = path.join(dir, 'reference');
    fs.mkdirSync(ref);
    fs.writeFileSync(path.join(ref, 'keep.mp4'), 'owner');
    fs.writeFileSync(path.join(ref, `${stem}.notes.txt`), 'owner');
    for (const end of [{ code: 1, stderr: 'ERROR: boom' }, { code: -1, stderr: '', timedOut: true }]) {
      const runner = async (_c, args) => {
        if (args.includes('--skip-download')) return { code: 0, stdout: identity('Vimeo', '', '500'), stderr: '' };
        for (const n of [`${stem}.mkv`, `${stem}.temp.mp4`, `${stem}.f1.mp4.part`]) fs.writeFileSync(path.join(ref, n), 'x');
        return { stdout: '', ...end };
      };
      await assert.rejects(() => fetchReference(dir, PASTED, { ytdlp: 'x', ffmpeg: null, runner }));
      assert.deepEqual(fs.readdirSync(ref).sort(), ['keep.mp4', `${stem}.notes.txt`].sort());
    }
  } finally { clean(dir); }
});

test('web links share the one-download-at-a-time slot with everything else', async () => {
  const dir = tmp();
  try {
    let release; const gate = new Promise(r => { release = r; });
    const program = fakeProgram({ who: identity('Vimeo', '', '9') });
    const opts = { ytdlp: 'x', ffmpeg: null, runner: async (c, a) => { await gate; return program(c, a); } };
    const first = fetchReference(dir, PASTED, opts);
    const same = fetchReference(dir, PASTED, opts);
    await assert.rejects(() => fetchReference(dir, 'https://vimeo.com/222', opts), e => e.code === 'busy');
    await assert.rejects(() => fetchReference(dir, URL_OK, opts), e => e.code === 'busy');
    await assert.rejects(() => fetchReference(dir, PASTED, { ...opts, from: 1, to: 2, ffmpeg: 'f' }), e => e.code === 'busy', 'another range of the same link is another download');
    release();
    const [a, b] = await Promise.all([first, same]);
    assert.equal(a.file, b.file);
  } finally { clean(dir); }
});

test('classifyFailure reads the new codes from the program\'s real messages', async () => {
  assert.equal(classifyFailure(FIXTURES['unsupported-site']), 'unsupported-site');
  assert.equal(classifyFailure(FIXTURES['login-required']), 'login-required');
  assert.equal(classifyFailure(`WARNING: [generic] Falling back on generic information extractor\n${FIXTURES['unsupported-site']}`), 'unsupported-site');
  // the older codes keep winning where the messages overlap
  assert.equal(classifyFailure('ERROR: [youtube] x: Sign in to confirm you\u2019re not a bot. Use --cookies-from-browser or --cookies for the authentication.'), 'bot-check');
  assert.equal(classifyFailure('ERROR: [youtube] x: Private video. Sign in if you\'ve been granted access to this video'), 'unavailable');
  assert.equal(classifyFailure('ERROR: HTTP Error 429: Too Many Requests. Use --cookies'), 'rate-limited');
  // a missing page is neither, and not a network problem either
  assert.equal(classifyFailure(FIXTURES['not-found']), 'not-found');
  assert.equal(classifyFailure('ERROR: [generic] x: Unable to download webpage: HTTP Error 410: Gone'), 'not-found');
  assert.equal(classifyFailure('ERROR: [vimeo] 1: Unable to download webpage: HTTP Error 403: Forbidden'), 'blocked');
  assert.equal(classifyFailure('ERROR: Unable to download webpage: HTTP Error 401: Unauthorized'), 'blocked');
  assert.equal(classifyFailure('ERROR: Unable to download webpage: <urlopen error timed out>'), 'network');
  // the texts of the two new codes say what to do instead
  for (const c of ['login-required', 'unsupported-site']) {
    await assert.rejects(() => fetchReference(tmp(), PASTED, { ytdlp: 'x', ffmpeg: null, runner: async () => ({ code: 1, stdout: '', stderr: FIXTURES[c] }) }), e => e.code === c && /file/.test(e.message));
  }
});

test('an unrecognised failure shows the last line of the program', async () => {
  const run = async () => ({ code: 1, stdout: '', stderr: 'WARNING: x\nERROR: [vimeo] 1: Requested format is not available' });
  await assert.rejects(() => fetchReference(tmp(), PASTED, { ytdlp: 'x', ffmpeg: null, runner: run }), e => e.code === 'unknown' && /Requested format is not available/.test(e.message));
});

test('no argument array of any kind, for either site, carries a cookies or login option', () => {
  const dir = os.tmpdir();
  const arrays = [
    buildArgs({ url: URL_OK, dir }), buildArgs({ url: URL_OK, dir, from: 1, to: 3 }),
    buildArgs({ url: WEB, dir, stem: 'vimeo_1' }), buildArgs({ url: WEB, dir, stem: 'vimeo_1', from: 1, to: 3, remux: true }),
    buildIdentityArgs({ url: URL_OK }), ...['https://player.vimeo.com/video/1', 'https://www.behance.net/gallery/1/x', 'https://x.artstation.com/p/1'].map(url => buildIdentityArgs({ url })),
  ];
  for (const a of arrays) { assert.ok(noCookies(a), a.join(' ')); assert.ok(a.includes('--ignore-config')); assert.equal(a.at(-2), '--'); }
});
