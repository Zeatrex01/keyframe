// Checking a pasted video link before it is ever handed to a program.
//
// Two kinds are accepted. A YouTube link is cut down to its 11-character id and the address is
// rebuilt, as before. Any other link is a "web" link: a public https address that the yt-dlp
// program may read. The program never receives the caller's own text, only the address the URL
// parser itself produced (never starts with a dash, carries nothing the parser rejected).
//
// This is a text check only. It cannot know where a public name resolves to, or where the site
// redirects; see docs/concept.md.

import { StudioError } from '../shared/errors.js';

const MAX_LINK = 2000;
const isYouTubeHost = h => ['youtube.com', 'youtube-nocookie.com', 'youtu.be'].some(d => h === d || h.endsWith(`.${d}`));
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Names that only exist inside a private network or never exist at all. */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.lan', '.home', '.corp', '.test', '.example', '.invalid', '.onion', '.arpa', '.intranet', '.private', '.box', '.svc', '.cluster', '.localnet'];
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f-\u00a0\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/;
const IPV4 = /^\d+(\.\d+)*$/;
const DNS_NAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

const HELP = 'Paste the link of one video: a YouTube link or a public https page that holds a video (Vimeo, a portfolio page).';

/**
 * @returns {{ site: 'youtube', id: string, url: string } | { site: 'web', host: string, url: string }}
 */
export function parseLink(text) {
  const refuse = why => new StudioError('bad-link', `${why} ${HELP}`, {});
  if (typeof text !== 'string') throw refuse('That is not a link.');
  const trimmed = text.trim();
  // Checked on the raw text: the URL class silently drops tabs and line breaks inside a link.
  if (trimmed.length > MAX_LINK) throw refuse(`That link is longer than ${MAX_LINK} characters.`);
  if (CONTROL_OR_SPACE.test(trimmed)) throw refuse('A link cannot contain spaces or control characters.');
  let u;
  try { u = new URL(trimmed); } catch { throw refuse('That is not a link.'); }
  if (u.protocol !== 'https:') throw refuse('Only https links are accepted.');
  if (u.username || u.password) throw refuse('A link with a user name or password is not accepted.');
  if (u.port) throw refuse('A link with a port number is not accepted.');

  // Judged on the normalised name: 2130706433 and 0x7f.1 have already become 127.0.0.1 here.
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || host.includes(':')) throw refuse('An address of numbers is not accepted; use the site\'s name.');
  if (!host.includes('.')) throw refuse('A public site name is needed (it must contain a dot).');
  if (IPV4.test(host) || /^\d+$/.test(host.split('.').at(-1))) throw refuse('An address of numbers is not accepted; use the site\'s name.');
  if (host === 'localhost' || PRIVATE_SUFFIXES.some(s => host.endsWith(s))) throw refuse('Local and private names are not accepted.');
  if (!DNS_NAME.test(host)) throw refuse('That is not a public site name.');

  if (isYouTubeHost(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    let id = null;
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) id = parts.length === 1 ? parts[0] : null;
    else if (parts.length === 1 && parts[0] === 'watch') id = u.searchParams.get('v');
    else if (parts.length === 2 && (parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed')) id = parts[1];
    if (id === null || !VIDEO_ID.test(id) || id === 'videoseries') throw refuse('No single video was found in that YouTube link (playlists and channels are not expanded).');
    return { site: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` };
  }
  return { site: 'web', host, url: vimeoPlayerAddress(host, u.pathname) ?? u.href };
}

/**
 * Vimeo's watch page answers only to a signed-in account, and the studio never signs in. The
 * player address of the same public video needs no account (seen live on 2026-11-13 with yt-dlp
 * 2026.10.26: two videos read, one downloaded at 60 fps), so a plain watch link is rewritten to
 * it. Anything else on Vimeo passes unchanged.
 */
function vimeoPlayerAddress(host, pathname) {
  if (host !== 'vimeo.com' && host !== 'www.vimeo.com') return null;
  const m = /^\/(?:channels\/[A-Za-z0-9_-]+\/)?(\d{4,12})(?:\/([0-9a-f]{6,16}))?\/?$/.exec(pathname);
  if (!m) return null;
  return `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ''}`;
}
