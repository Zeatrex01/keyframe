// Frames out of a reference video, through the owner's own ffmpeg.
//
// The studio has no dependencies; ffmpeg is an optional program on the machine. Without it the
// caller gets a coded refusal that says how to provide it, and nothing else changes.

import { spawn, spawnSync } from 'node:child_process';
import { StudioError } from '../shared/errors.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from('IEND');

/** The ffmpeg executable: $FFMPEG, else `ffmpeg` on the PATH; null when neither runs. */
export function locateFfmpeg(env = process.env) {
  for (const candidate of [env.FFMPEG, 'ffmpeg'].filter(Boolean)) {
    try { if (spawnSync(candidate, ['-version'], { stdio: 'ignore', timeout: 10000 }).status === 0) return candidate; } catch { /* try the next */ }
  }
  return null;
}

function run(command, args, { timeoutMs = 120000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => { if (err.length < 65536) err += c; });
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(e.message) }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr: err }); });
  });
}

/** Split a stream of concatenated PNG files. */
export function splitPngs(buffer) {
  const frames = [];
  let start = buffer.indexOf(PNG_SIGNATURE);
  while (start >= 0) {
    const end = buffer.indexOf(IEND, start);
    if (end < 0) break;
    frames.push(buffer.subarray(start, end + 8)); // "IEND" plus its 4-byte CRC
    start = buffer.indexOf(PNG_SIGNATURE, end + 8);
  }
  return frames;
}

/** Duration in seconds, read from ffmpeg's own report of the file. */
export async function videoDuration(ffmpeg, file) {
  const r = await run(ffmpeg, ['-hide_banner', '-i', file], { timeoutMs: 30000 });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
  if (!m) throw new StudioError('bad-video', 'ffmpeg could not read this file as a video.', { detail: r.stderr.trim().split('\n').pop() });
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * `count` frames evenly spaced over [from, to], scaled to `width` px wide, as PNG buffers.
 * @param {string} file
 * @param {{ from?: number, to?: number, count?: number, width?: number, region?: object | null, ffmpeg?: string | null }} [options]
 * @returns {Promise<{ frames: Buffer[], times: number[], duration: number }>}
 */
export async function extractFrames(file, { from = 0, to, count = 12, width = 240, region = null, ffmpeg = locateFfmpeg() } = {}) {
  if (!ffmpeg) throw new StudioError('no-ffmpeg', 'Reading a video needs ffmpeg, which is not installed here. Install ffmpeg (or set FFMPEG to its path) and try again.');
  const duration = await videoDuration(ffmpeg, file);
  const start = Math.max(0, Math.min(from, duration));
  const end = Math.max(start, Math.min(to ?? duration, duration));
  const span = end - start;
  if (span <= 0) throw new StudioError('bad-argument', `The range ${from}-${to ?? duration} s is empty; the video is ${duration} s long.`, { duration });
  const step = span / count;
  // One frame per step, taken at the middle of each step so the last one is not past the end.
  const r = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(span), '-i', file,
    '-vf', `setpts=PTS-STARTPTS,${region ? `crop=iw*${region.width}:ih*${region.height}:iw*${region.x}:ih*${region.y},` : ''}fps=${count / span},scale=${width}:-2`, '-frames:v', String(count), '-f', 'image2pipe', '-vcodec', 'png', '-']);
  const frames = splitPngs(r.stdout);
  if (!frames.length) throw new StudioError('bad-video', 'ffmpeg produced no frames from this file.', { detail: r.stderr.trim().split('\n').pop() });
  return { frames, times: frames.map((_, i) => +(start + step * (i + 0.5)).toFixed(3)), duration };
}

const cropFilter = region => region ? `crop=iw*${region.width}:ih*${region.height}:iw*${region.x}:ih*${region.y},` : '';

/** A region is fractions of the frame: { x, y, width, height } with 0 <= x, y and x + width, y + height <= 1. */
export function checkRegion(region) {
  if (region === undefined || region === null) return null;
  const { x, y, width, height } = region;
  const ok = [x, y, width, height].every(v => typeof v === 'number' && Number.isFinite(v)) && x >= 0 && y >= 0 && width > 0.01 && height > 0.01 && x + width <= 1.0001 && y + height <= 1.0001;
  if (!ok) throw new StudioError('bad-argument', 'region is { x, y, width, height } as fractions of the frame (0-1), inside the frame.', { region });
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

/** The frame rate ffmpeg reports for the file (30 when it does not say). */
export async function videoInfo(ffmpeg, file) {
  const r = await run(ffmpeg, ['-hide_banner', '-i', file], { timeoutMs: 30000 });
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
  if (!d) throw new StudioError('bad-video', 'ffmpeg could not read this file as a video.', { detail: r.stderr.trim().split('\n').pop() });
  const f = /,\s*(\d+(?:\.\d+)?)\s*fps/.exec(r.stderr);
  const size = /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(r.stderr);
  return { duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]), fps: f ? Number(f[1]) : 30,
    ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}) };
}

/**
 * Every frame of a range at a steady rate, for measuring (not for looking): cropped to a region,
 * scaled so the crop is `width` px wide. The rate is the source's, capped at 60 and lowered
 * when the range would give more than `maxFrames`.
 * @param {string} file
 * @param {{ from?: number, to?: number, region?: object | null, width?: number, maxFrames?: number, fps?: number, ffmpeg?: string | null }} [options]
 * @returns {Promise<{ frames: Buffer[], fps: number, from: number, to: number, duration: number, source: object }>}
 */
export async function analysisFrames(file, { from = 0, to, region = null, width = 256, maxFrames = 360, fps, ffmpeg = locateFfmpeg() } = {}) {
  if (!ffmpeg) throw new StudioError('no-ffmpeg', 'Reading a video needs ffmpeg, which is not installed here. Install ffmpeg (or set FFMPEG to its path) and try again.');
  const info = await videoInfo(ffmpeg, file);
  const start = Math.max(0, Math.min(from, info.duration));
  const end = Math.max(start, Math.min(to ?? info.duration, info.duration));
  const span = end - start;
  if (span <= 0) throw new StudioError('bad-argument', `The range ${from}-${to ?? info.duration} s is empty; the video is ${info.duration} s long.`, { duration: info.duration });
  let rate = Math.min(60, fps ?? info.fps);
  if (span * rate > maxFrames) rate = Math.max(5, Math.floor(maxFrames / span));
  const r = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(span), '-i', file,
    // Encoders delay the first frame's timestamp; without resetting it, the fps filter pads the
    // start with copies of the first frame and everything reads a frame or two late.
    '-vf', `setpts=PTS-STARTPTS,${cropFilter(region)}fps=${rate},scale=${width}:-2:flags=area`, '-f', 'image2pipe', '-vcodec', 'png', '-'], { timeoutMs: 180000 });
  const frames = splitPngs(r.stdout);
  if (frames.length < 2) throw new StudioError('bad-video', 'ffmpeg produced too few frames from this range.', { detail: r.stderr.trim().split('\n').pop() });
  return { frames, fps: rate, from: start, to: end, duration: info.duration, source: info };
}
