// How the studio answers: the JSON shape of every reply and refusal, the headers every response
// carries, files served with ranges, and the one table that maps an error code to an HTTP status.

import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';

export const TYPES = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.atlas': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' });

// The page loads only its own files: no inline script, no other origin, never inside a frame.
// Styles allow inline attributes because the official player sets them on the elements it builds.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "media-src 'self' blob:", "connect-src 'self'", "worker-src 'self'", "font-src 'self'", "object-src 'none'",
  "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

/** Sent with every response. */
export const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'content-security-policy': CONTENT_SECURITY_POLICY,
});

const BY_CODE = new Map(Object.entries({
  'too-large': 413, 'unsupported-type': 415, 'method-not-allowed': 405,
  'outside-project': 403, 'foreign-host': 403, 'foreign-origin': 403, 'cross-site': 403,
  'busy': 409, 'no-project': 409, 'changed-during-write': 409, 'target-exists': 409, 'delivery-exists': 409,
  'name-taken': 409, 'folder-in-use': 409, 'agent-busy': 409, 'agent-off': 409, 'stale-paint': 409, 'stale-repair': 409, 'base-protected': 409, 'not-ours': 409, 'stale-drawing': 409,
  'no-ffmpeg': 501, 'no-yt-dlp': 501, 'no-spine-cli': 501, 'no-agent-cli': 501, 'spine-addon-off': 501, 'spine-license-required': 400,
  'timeout': 504, 'tool-failed': 500, 'internal-error': 500,
}));

/**
 * The HTTP status for an error code. A code not in the table follows its name: `*-not-found`,
 * `unknown-*` and `no-such-*` are 404; any other refusal is the caller's request (400).
 */
export function statusFor(code) {
  if (BY_CODE.has(code)) return BY_CODE.get(code);
  if (/(^not-found$|-not-found$|^unknown-|^no-such-)/.test(code)) return 404;
  return 400;
}

export function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(data);
}

export const refuse = (res, status, code, message, extra) => send(res, status, { error: { code, message } }, undefined, extra);

/** Refuse with the status the code maps to. */
export const refuseError = (res, err) => refuse(res, statusFor(err.code), err.code, err.message);

/**
 * Read a request body up to `limit` bytes. A body over the limit is refused at once, and the rest is
 * read and dropped rather than the connection cut: a browser that loses the connection mid-upload
 * reports a network error, not the 413 and its sentence.
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', chunk => {
      if (over) return;
      size += chunk.length;
      if (size > limit) { over = true; chunks.length = 0; reject(new StudioError('too-large', `The request body is larger than ${Math.round(limit / 1024 / 1024) || '<1'} MB.`)); }
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Read a JSON object body; anything else is a 400. */
export async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  let body;
  try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new StudioError('bad-json', 'The request body is not JSON.'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new StudioError('bad-json', 'The request body must be a JSON object.');
  return body;
}

/** Serve a file, honouring a Range header (a <video> cannot seek without it). */
export function sendFile(req, res, abs, extra = {}) {
  let stat;
  try { stat = fs.statSync(abs); } catch { return refuse(res, 404, 'not-found', 'No such file.'); }
  if (!stat.isFile()) return refuse(res, 404, 'not-found', 'No such file.');
  const type = TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  const headers = { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes', ...extra };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const stream = (opts) => {
    const s = fs.createReadStream(abs, opts);
    // A file removed between the stat and the read ends the response instead of crashing the server.
    s.on('error', () => res.destroy());
    if (req.method === 'HEAD') { s.destroy(); return res.end(); }
    return s.pipe(res);
  };
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) { res.writeHead(416, { ...SECURITY_HEADERS, 'content-range': `bytes */${stat.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
    return stream({ start, end });
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  return stream();
}
