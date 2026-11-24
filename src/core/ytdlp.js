// A reference video from a link, through the owner's own yt-dlp.
//
// An optional add-on, like ffmpeg: the studio has no dependencies and works exactly as before
// when the program is absent. The link is a YouTube video or any public https page the program
// can read (Vimeo, a portfolio page). All this does is save one file into
// <project>/reference/, where the reference tools already look. It never uses the owner's browser
// cookies or a login (a deliberate rule), never passes the caller's text to the program (the link
// is parsed by src/core/link.js and handed on as the address the parser built), and never
// overwrites a file (the one-way rule: an existing file is returned as it is).

import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';
import { parseLink } from './link.js';
import { projectFolders } from './paths.js';
import { locateFfmpeg, videoInfo } from './video.js';

/** The containers the studio reads, in the order a finished download is looked for. */
export const SAVED_TYPES = ['.mp4', '.webm', '.mov'];
/** Same cap as the page's upload (web upload limit in src/server/http.js), as yt-dlp spells it. */
export const MAX_FILESIZE = '300M';
const MAX_BYTES = 300 * 1024 * 1024;
const MAX_RANGE_SECONDS = 12 * 3600;
const LOW_FPS = 50;
const IDENTITY_TIMEOUT_MS = 90000;
const STEM_CAP = 80;
const STEM_BASE = /^[A-Za-z0-9_-]{1,80}$/;

export { parseLink };

const INSTALL_HINT = 'Install yt-dlp (on Windows: winget install yt-dlp; or download the standalone program from the yt-dlp releases page) '
  + 'or set YT_DLP to its path, then restart the studio.';

/** The yt-dlp executable: $YT_DLP, else `yt-dlp` on the PATH; null when neither runs. */
export function locateYtDlp(env = process.env) {
  for (const candidate of [env.YT_DLP, 'yt-dlp'].filter(Boolean)) {
    try { if (spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 10000, env }).status === 0) return candidate; } catch { /* try the next */ }
  }
  return null;
}

/**
 * { from, to } in seconds, or null when neither is given. Anything else invalid is refused.
 * Both are rounded to milliseconds once, here, and checked again after rounding, so the cut, the
 * file name and the reuse key all state the same range.
 */
export function checkRange(from, to) {
  if (from === undefined && to === undefined) return null;
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const start = from === undefined ? 0 : from;
  const refuse = () => new StudioError('bad-argument', `The range must be numbers of seconds with 0 <= from < to (up to ${MAX_RANGE_SECONDS} s); got from=${from}, to=${to}.`, { from, to });
  if (!num(start) || start < 0 || start >= MAX_RANGE_SECONDS || (to !== undefined && (!num(to) || to > MAX_RANGE_SECONDS))) throw refuse();
  const ms = v => Math.round(v * 1000) / 1000;
  const range = { from: ms(start), to: to === undefined ? undefined : ms(to) };
  if (range.to !== undefined && range.to <= range.from) throw refuse();
  return range;
}

const clock = seconds => {
  const total = Math.round(seconds * 1000); // already millisecond-rounded by checkRange
  const whole = Math.floor(total / 1000), frac = total % 1000;
  const s = whole % 60, m = Math.floor(whole / 60) % 60, h = Math.floor(whole / 3600);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${frac ? `.${String(frac).padStart(3, '0').replace(/0+$/, '')}` : ''}`;
};
const stamp = n => String(n).replace('.', 'p');

/** The file name (without extension) a base name and range are saved as. */
export function stemFor(id, range) {
  return range ? `${id}_${stamp(range.from)}-${range.to === undefined ? 'end' : stamp(range.to)}` : id;
}

const shortHash = text => createHash('sha1').update(text).digest('hex').slice(0, 8);

/**
 * The base file name of a web link, from what the program reports about it, never from the link
 * text: <extractor>_<id> reduced to [A-Za-z0-9_-], lower-case extractor, cut to fit, then always a
 * short hash of the extractor, the id as reported and the address. The hash is always there because
 * an id is not unique to a video (page-embed extractors name it after the page file), two ids can
 * reduce to the same text, and Windows treats names that differ only in case as one file. The same
 * link gives the same name, so reuse still works. An id that reduces to nothing is the hash alone.
 */
export function webStem(extractor, id, url) {
  const keep = v => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  const name = keep(extractor).toLowerCase() || 'web';
  const reduced = keep(id);
  const whole = reduced === '' ? name : `${name}_${reduced}`;
  return `${whole.slice(0, STEM_CAP - 9)}_${shortHash(`${extractor}	${id}	${url}`)}`;
}

/**
 * The flags every call shares. Each is in "yt-dlp --help" of the installed program (2026.10.26).
 */
const SAFE_FLAGS = [
  '--ignore-config',  // disables config files, so a user config can never add cookies or a login
  '--no-playlist',    // only the video if the URL also names a playlist
  '--quiet', '--no-warnings', // stderr holds errors only
];

/** The yt-dlp format choices (-f is documented in the program's README, "Format Selection"). */
// YouTube: video-only, highest frame rate first (-S), up to 720p, mp4 then webm.
const YOUTUBE_FORMAT = 'bv[height<=720][ext=mp4]/bv[height<=720][ext=webm]';
// Any other site: the same video-only choice first; then a combined video+audio file up to 720p
// (height unknown passes, "<=?"), then any combined file, then any single format with video or
// audio ("b*"), because many sites offer only combined files or report no height.
const WEB_FORMAT = `${YOUTUBE_FORMAT}/b[height<=?720]/b/b*`;
// Containers the studio cannot read are rewritten to mp4 when ffmpeg is present. Only the listed
// sources are touched: a file already mp4, webm or mov is left alone.
const REMUX_RULE = 'mkv>mp4/flv>mp4/avi>mp4/ts>mp4/m4v>mp4/3gp>mp4';

/**
 * The argument ARRAY that asks the program who a web link is, without downloading anything.
 * Prints one line: extractor key, playlist count (empty when not a playlist), id (last, so a
 * stray tab inside it stays in the id). "--" ends option parsing, so the address can never be
 * read as an option.
 */
export function buildIdentityArgs({ url }) {
  const { url: clean } = parseLink(url);
  if (clean !== url) throw new StudioError('bad-link', 'buildIdentityArgs takes the address from parseLink.', {});
  return [
    ...SAFE_FLAGS,
    '--skip-download',   // "Do not download the video but write all related files" (none are asked for)
    '-I', '1',           // --playlist-items: only the first video of a page that holds several
    '--print', '%(extractor_key|)s\t%(playlist_count|)s\t%(id|)s', // --print TEMPLATE; "|" gives the empty default
    '--', clean,
  ];
}

/**
 * The argument ARRAY for execFile (never a shell string).
 * Syntax checked against "yt-dlp --help" and the yt-dlp README (see the notes per flag).
 * A web link also needs `stem`, the base name chosen from the program's own report (webStem);
 * `remux` asks the program to rewrite containers the studio cannot read (needs ffmpeg).
 */
export function buildArgs({ url, dir, from, to, stem, ffmpegLocation, remux = false }) {
  const link = parseLink(url);
  if (link.url !== url) throw new StudioError('bad-link', 'buildArgs takes the rebuilt address from parseLink.', {});
  if (typeof dir !== 'string' || !dir) throw new StudioError('bad-argument', 'buildArgs needs the folder to save into.', {});
  const range = checkRange(from, to);
  const web = link.site === 'web';
  if (web && (typeof stem !== 'string' || !STEM_BASE.test(stem))) throw new StudioError('bad-argument', 'buildArgs needs a safe base name for a web link.', {});
  return [
    ...SAFE_FLAGS,
    '--no-progress',              // "Verbosity": no progress bar
    '-f', web ? WEB_FORMAT : YOUTUBE_FORMAT,
    '-S', 'fps,res:720,vcodec:h264', // "Sorting Formats": highest frame rate, then up to 720p, then H.264 over AV1/VP9 (decodes in every ffmpeg build and browser)
    ...(web ? ['-I', '1'] : []),  // --playlist-items: only the first video of a page that holds several
    ...(web && remux ? ['--remux-video', REMUX_RULE] : []), // --remux-video "a>b/c>d" rules; only when ffmpeg is there to do it
    '--max-filesize', MAX_FILESIZE, // abort when larger than SIZE (e.g. 44.6M)
    '--no-mtime',                 // keep the download time as the file time
    '--no-overwrites',            // never overwrite (the one-way rule)
    '-P', dir,                    // the folder
    '-o', `${stemFor(web ? stem : link.id, range)}.%(ext)s`, // only a safe name (and a numeric range) in the file name
    '--print', 'after_move:filepath', // the final path, printed once the file is in place
    ...(range ? ['--download-sections', `*${clock(range.from)}-${range.to === undefined ? 'inf' : clock(range.to)}`, // "*" prefix = time range
      '--force-keyframes-at-cuts'] : []), // cut on the asked frame, not the nearest keyframe
    ...(ffmpegLocation ? ['--ffmpeg-location', ffmpegLocation] : []), // path to ffmpeg
    '--', link.url,               // end of options, then the one address
  ];
}

/** What went wrong, from the program's stderr: a stable code the caller can branch on. */
export function classifyFailure(stderr) {
  const s = String(stderr ?? '').toLowerCase();
  if (/confirm (that )?you.?re not a bot|sign in to confirm you.?re not/.test(s)) return 'bot-check';
  if (/\b429\b|too many requests|rate.?limit/.test(s)) return 'rate-limited';
  if (/larger than max-filesize|larger than the max|max-filesize/.test(s)) return 'too-large';
  if (/private video|members-only|members only|join this channel|video unavailable|has been removed|no longer available|this video is not available|not available in your country|blocked it|who has blocked|account associated with this video has been terminated|confirm your age|age-restricted|age restricted|inappropriate for some users/.test(s)) return 'unavailable';
  if (/unsupported url/.test(s)) return 'unsupported-site';
  if (/only works when logged.?in|logged.?in|login (is )?required|requires? (a )?(log ?in|authentication|account)|log in to (view|watch|see|continue)|sign in to (view|watch|see|continue)|use --cookies|--username and --password/.test(s)) return 'login-required';
  if (/http error (404|410)\b/.test(s)) return 'not-found';
  if (/http error (401|403)\b/.test(s)) return 'blocked';
  if (/unable to download|getaddrinfo|timed out|connection (reset|refused|aborted)|network is unreachable|temporary failure in name resolution|urlopen error|ssl:|remote end closed/.test(s)) return 'network';
  return 'unknown';
}

/**
 * Every warning a result can carry, as { code, ...numbers }. `warning` stays the English sentence for
 * the CLI and agents; the page renders `warnings` from its own locale keys (ref.warn.<code in camelCase>).
 */
export const WARNING_CODES = ['more-videos', 'fps-unknown', 'low-fps', 'probe-failed'];
const WARNING_TEXT = {
  'more-videos': w => `The page holds ${w.count} videos; only the first was saved.`,
  'fps-unknown': () => 'ffmpeg is not installed, so the frame rate of this file was not read.',
  'low-fps': w => `The source is ${w.fps} fps, so measured timing is less exact than a 60 fps recording.`,
  'probe-failed': w => `The file was saved, but ffmpeg could not read it (${w.reason}).`,
};

/** Every code a failed link can end in (the page keeps one sentence per code: ref.fail.<code in camelCase>). */
export const FAILURE_CODES = ['bad-link', 'bad-argument', 'busy', 'no-yt-dlp', 'no-ffmpeg', 'timeout', 'bad-container', 'download-failed',
  'bot-check', 'rate-limited', 'too-large', 'unavailable', 'unsupported-site', 'login-required', 'not-found', 'blocked', 'network', 'unknown'];

const FAILURE_TEXT = {
  'bot-check': 'The site asked for a sign-in to prove this is not a bot. Stop here and wait 15-30 minutes before trying again; do not retry in a loop. The studio never uses your browser cookies, so the alternative is to download the video yourself and add the file.',
  'rate-limited': 'The site is limiting requests from this computer (HTTP 429). Stop here and wait 15-30 minutes before trying again; do not retry in a loop.',
  'unavailable': 'This video cannot be downloaded without signing in: it is private, members-only, removed, or blocked by age or region. Add a recording of it as a file instead.',
  'login-required': 'This site only shows the video to a signed-in account. The studio never signs in and never uses your browser cookies. Save the video another way (the site\'s own download, or a screen recording) and add it as a file.',
  'unsupported-site': 'The yt-dlp program found no video it can read at that address. Paste the address of the video\'s own page, or save the video another way and add it as a file.',
  'too-large': `This video is larger than the ${MAX_FILESIZE} limit. Save only the part you need (the --from and --to options of tools/fetch-reference.js), or add a shorter recording as a file.`,
  'not-found': 'There is no video at that address (the page is gone or the link is wrong). Check the link and paste the address of the video\'s own page.',
  'blocked': 'The site refused the request (it wants a sign-in or blocks this program). The studio never signs in and never uses your browser cookies. Save the video another way and add it as a file.',
  'network': 'The download failed on the network. Check the connection and try once more.',
  'unknown': 'The download failed for a reason the studio does not recognise.',
};

/** Stop a started program and what it started (the Windows yt-dlp.exe works in a child process). */
export function killTree(child, { platform = process.platform, exec = execFile } = {}) {
  if (platform === 'win32' && child.pid) exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGKILL');
}

/** Default runner: execFile with no shell. Resolves with { code, stdout, stderr, timedOut } and never rejects. */
export function execRunner(command, args, { timeoutMs = 600000 } = {}) {
  return new Promise(resolve => {
    let timedOut = false;
    let timer = null;
    const child = execFile(command, args, { maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false }, (error, stdout, stderr) => {
      clearTimeout(timer);
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') + (error && typeof error.code !== 'number' ? `\n${error.message}` : ''), timedOut });
    });
    timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
  });
}

const listNames = folder => { try { return new Set(fs.readdirSync(folder)); } catch { return new Set(); } };

/** What a failed run leaves behind: half-written files, and any other file this run made under the stem. */
function removeLeftovers(folder, stem, before) {
  try {
    for (const name of fs.readdirSync(folder)) {
      if (!name.startsWith(`${stem}.`)) continue;
      if (!before.has(name) || /\.(part(-Frag\d+)?|ytdl)$/.test(name)) fs.rmSync(path.join(folder, name), { force: true });
    }
  } catch { /* nothing to clean */ }
}

/** One download at a time per project: project folder -> { slot, promise }. */
const inflight = new Map();

function savedFile(folders, stem) {
  for (const folder of folders) {
    for (const ext of SAVED_TYPES) {
      const abs = path.join(folder, stem + ext);
      if (fs.existsSync(abs)) return abs;
    }
  }
  return null;
}

/** A failed run as a coded, plain refusal; the program's last line goes in the detail. */
function failureOf(run) {
  const code = classifyFailure(run.stderr);
  const detail = String(run.stderr).trim().split('\n').pop();
  return new StudioError(code, code === 'unknown' && detail ? `${FAILURE_TEXT[code]} The program said: ${detail.slice(0, 300)}` : FAILURE_TEXT[code], { detail });
}

/**
 * Save the video of a link into <project>/reference/.
 * A YouTube link takes one program call. A web link first asks the program who the video is (no
 * download), names the file from that answer, and only then downloads. Only the first video of a
 * page is taken; when the page holds more the result says so.
 * @param {string} projectDir
 * @param {string} link
 * @param {{ from?: number, to?: number, ytdlp?: string|null, ffmpeg?: string|null, runner?: Function, probe?: Function, timeoutMs?: number, maxBytes?: number }} [options]
 *   ytdlp / ffmpeg: a path, or null for "not installed"; left out, they are looked up.
 * @returns {Promise<{ file: string, site: 'youtube'|'web', id: string, host?: string, fps?: number, width?: number, height?: number, duration?: number, reused?: true, warning?: string, warnings?: Array<{ code: string }> }>}
 */
export async function fetchReference(projectDir, link, options = {}) {
  const target = parseLink(link);
  const web = target.site === 'web';
  const range = checkRange(options.from, options.to);
  const folders = projectFolders(projectDir, 'reference');
  const ffmpeg = options.ffmpeg === undefined ? locateFfmpeg() : options.ffmpeg;
  const probe = options.probe ?? videoInfo;
  const runner = options.runner ?? execRunner;

  const finish = async (abs, base, extra, notes) => {
    const out = { file: `${path.basename(path.dirname(abs))}/${path.basename(abs)}`, site: target.site, id: base, ...(web ? { host: target.host } : {}), ...extra };
    const warn = [...notes];
    if (!ffmpeg) warn.push({ code: 'fps-unknown' });
    else {
      try {
        const info = await probe(ffmpeg, abs);
        Object.assign(out, { fps: info.fps, ...(info.width ? { width: info.width, height: info.height } : {}), duration: info.duration });
        if (info.fps < LOW_FPS) warn.push({ code: 'low-fps', fps: info.fps });
      } catch (err) { warn.push({ code: 'probe-failed', reason: err.message }); }
    }
    return warn.length ? { ...out, warning: warn.map(w => WARNING_TEXT[w.code](w)).join(' '), warnings: warn } : out;
  };

  // A YouTube name is known from the link, so an existing file is found before anything else runs.
  if (!web) {
    const existing = savedFile(folders.read, stemFor(target.id, range));
    if (existing) return finish(existing, target.id, { reused: true }, []);
  }

  // The same link and range again joins the running download; another one waits for it to finish.
  const key = path.resolve(projectDir);
  const slot = `${target.url}|${range ? `${range.from}-${range.to ?? ''}` : ''}`;
  const running = inflight.get(key);
  if (running) {
    if (running.slot === slot) return running.promise;
    throw new StudioError('busy', 'Another download is still running for this project. Wait for it to finish, then paste the next link.', {});
  }

  const run = async () => {
    const ytdlp = options.ytdlp === undefined ? locateYtDlp() : options.ytdlp;
    if (!ytdlp) throw new StudioError('no-yt-dlp', `Saving a video from a link needs the yt-dlp program, which is not installed here. ${INSTALL_HINT}`);
    if (range && !ffmpeg) throw new StudioError('no-ffmpeg', 'Saving part of a video needs ffmpeg, which is not installed here. Install ffmpeg (or set FFMPEG to its path), or save the whole video.');

    const notes = [];
    let base = target.site === 'youtube' ? target.id : undefined;
    if (web) {
      const who = await runner(ytdlp, buildIdentityArgs({ url: target.url }), { timeoutMs: Math.min(options.timeoutMs ?? IDENTITY_TIMEOUT_MS, IDENTITY_TIMEOUT_MS) });
      if (who.timedOut) throw new StudioError('timeout', 'The site did not answer in time. Try once more later.', {});
      if (who.code !== 0) throw failureOf(who);
      const [extractor = '', count = '', ...rest] = String(who.stdout).trim().split('\n')[0].split('\t');
      const id = rest.join('\t').trim();
      if (!extractor.trim() || !id) throw new StudioError('unsupported-site', FAILURE_TEXT['unsupported-site'], { detail: 'the program named no video' });
      base = webStem(extractor.trim(), id, target.url);
      if (Number.isInteger(Number(count)) && Number(count) > 1) notes.push({ code: 'more-videos', count: Number(count) });
      const existing = savedFile(folders.read, stemFor(base, range));
      if (existing) return finish(existing, base, { reused: true }, notes);
    }
    const stem = stemFor(base, range);

    fs.mkdirSync(folders.write, { recursive: true });
    const before = listNames(folders.write);
    const abs = await (async () => {
      const args = buildArgs({ url: target.url, dir: folders.write, from: range?.from, to: range?.to, stem: web ? base : undefined,
        ffmpegLocation: ffmpeg && ffmpeg !== 'ffmpeg' ? ffmpeg : undefined, remux: Boolean(ffmpeg) });
      const done = await runner(ytdlp, args, { timeoutMs: options.timeoutMs ?? 600000 });
      if (done.timedOut) throw new StudioError('timeout', 'The download took too long and was stopped. Try a shorter time range.', {});
      if (done.code !== 0) throw failureOf(done);
      // The program prints the final path; trust it only when it names a file inside the reference folder.
      const printed = String(done.stdout).trim().split('\n').pop()?.trim();
      let found = null;
      if (printed) {
        const candidate = path.resolve(printed);
        const rel = path.relative(folders.write, candidate);
        const ext = path.extname(candidate);
        // Trust the printed path only for a file in the reference folder named exactly <stem>.<ext>.
        const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel) && path.basename(candidate, ext) === stem && fs.existsSync(candidate);
        if (inside && SAVED_TYPES.includes(ext.toLowerCase())) found = candidate;
        else if (inside) {
          // A container the studio does not read. Only a file this run made is removed.
          if (!before.has(path.basename(candidate))) fs.rmSync(candidate, { force: true });
          throw new StudioError('bad-container', `The video came as a ${ext.toLowerCase()} file, which the studio cannot read (it reads ${SAVED_TYPES.join(', ')}). ${ffmpeg ? 'The program could not convert it.' : 'Installing ffmpeg lets the program convert it to mp4.'} Save the video another way and add it as a file.`, { ext: ext.toLowerCase() });
        }
      }
      found ??= savedFile([folders.write], stem);
      if (!found) {
        // yt-dlp reports a file over --max-filesize as a quiet screen message and exits 0, so a whole
        // download that ends with no file is most likely that. Not verified against a real run.
        const hint = range ? '' : ` A whole video over ${MAX_FILESIZE} is stopped without an error, which is the most likely cause: save only the part you need (--from and --to of tools/fetch-reference.js) or add a shorter recording as a file.`;
        throw new StudioError('download-failed', `The program finished but no video file was saved.${hint}`, { detail: String(done.stderr).trim().split('\n').pop() });
      }
      if (fs.statSync(found).size > (options.maxBytes ?? MAX_BYTES)) {
        if (!before.has(path.basename(found))) fs.rmSync(found);
        throw new StudioError('too-large', FAILURE_TEXT['too-large'], {});
      }
      return found;
    })().catch(err => { removeLeftovers(folders.write, stem, before); throw err; });
    return finish(abs, base, {}, notes);
  };

  const promise = run();
  inflight.set(key, { slot, promise });
  try { return await promise; } finally { inflight.delete(key); }
}
