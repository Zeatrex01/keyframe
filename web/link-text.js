// What the page says about a link download, from the machine-readable parts of the answer.
// The server writes English sentences for the CLI and for agents; the page renders its own language
// from the codes (ref.warn.* for warnings, ref.fail.* for refusals) and shows the server text only
// for a code it does not know. No DOM here, so a test can load it.

const camel = code => code.replace(/-(\w)/g, (_, c) => c.toUpperCase());

/** The locale key for a code, e.g. ('ref.warn', 'low-fps') -> 'ref.warn.lowFps'. */
export const linkKey = (prefix, code) => `${prefix}.${camel(String(code))}`;

const known = (t, key) => t(key) !== key;

/** The warnings of a finished download as one line, in the page language. */
export function linkWarnings(t, result) {
  if (!Array.isArray(result.warnings)) return result.warning ?? '';
  const parts = result.warnings.map(w => (known(t, linkKey('ref.warn', w.code)) ? t(linkKey('ref.warn', w.code), w) : ''));
  // A code this page does not know: fall back to the server's English text for the whole result.
  return parts.includes('') ? (result.warning ?? '') : parts.join(' ');
}

/** The reason a download failed, in the page language; the server text for a code this page does not know. */
export function linkFailure(t, err) {
  const key = linkKey('ref.fail', err?.code ?? '');
  if (!err?.code || !known(t, key)) return err?.message ?? '';
  const said = /The program said: (.*)$/s.exec(err.message ?? '');
  return said && err.code === 'unknown' ? `${t(key)} ${t('ref.fail.programSaid', { line: said[1] })}` : t(key);
}

/**
 * One time field of the page's link form as seconds: '' is "not given" (undefined); '90', '90.5',
 * '1:30' and '1:02:03.5' are read the way a video player shows time. Anything else is NaN.
 */
export function readTime(text) {
  const s = String(text ?? '').trim();
  if (s === '') return undefined;
  if (!/^(\d+(\.\d+)?|(\d+:)?\d{1,2}:\d{1,2}(\.\d+)?)$/.test(s)) return NaN;
  const parts = s.split(':').map(Number);
  if (parts.slice(1).some(p => p >= 60)) return NaN;
  return parts.reduce((total, p) => total * 60 + p, 0);
}

/**
 * The part of the video the page asks for, from its two fields: {} for the whole video,
 * { from }, { to } or { from, to } in seconds, or null when a field cannot be read or the start
 * is not before the end. The server checks the range again (checkRange); this only stops a
 * request that cannot succeed.
 */
export function linkRange(fromText, toText) {
  const from = readTime(fromText);
  const to = readTime(toText);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  if (to !== undefined && to <= (from ?? 0)) return null;
  const range = {};
  if (from !== undefined) range.from = from;
  if (to !== undefined) range.to = to;
  return range;
}
