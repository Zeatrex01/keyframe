// The link check: what a pasted address may be before a program ever sees it. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLink } from '../src/core/link.js';

const ID = 'dQw4w9WgXcQ';
const code = fn => { try { fn(); } catch (e) { return e.code; } return null; };
const refused = list => { for (const bad of list) assert.equal(code(() => parseLink(bad)), 'bad-link', JSON.stringify(bad)); };

test('a normal video page is a web link with the address the parser built', () => {
  assert.deepEqual(parseLink('https://vimeo.com/76979871'), { site: 'web', host: 'vimeo.com', url: 'https://player.vimeo.com/video/76979871' });
  assert.deepEqual(parseLink('https://www.artstation.com/artwork/abc123'), { site: 'web', host: 'www.artstation.com', url: 'https://www.artstation.com/artwork/abc123' });
  assert.deepEqual(parseLink('  https://www.behance.net/gallery/123456/My-Showreel?x=1#top  '), { site: 'web', host: 'www.behance.net', url: 'https://www.behance.net/gallery/123456/My-Showreel?x=1#top' });
  // The address handed on is the normalised one: host lower-cased, path escaped, never the raw text.
  const u = parseLink('HTTPS://Player.Vimeo.COM/video/12 ').url;
  assert.equal(u, 'https://player.vimeo.com/video/12');
  assert.equal(parseLink('https://portfolio.example.org/reel?name=a%20b').url, 'https://portfolio.example.org/reel?name=a%20b');
  assert.equal(parseLink('https://café.example.org/x').host, 'xn--caf-dma.example.org', 'unicode names become ASCII');
});

test('only https is accepted', () => {
  refused(['http://vimeo.com/1', 'ftp://vimeo.com/1', 'file:///C:/x.mp4', 'javascript:alert(1)', 'data:text/html,x', '//vimeo.com/1', 'vimeo.com/1', 'ytsearch:cats']);
});

test('a user name, a password or a port is refused', () => {
  refused(['https://user@vimeo.com/1', 'https://user:pw@vimeo.com/1', 'https://:pw@vimeo.com/1', 'https://vimeo.com:8443/1', 'https://vimeo.com:444/1']);
  assert.equal(code(() => parseLink('https://vimeo.com:443/1')), null, 'the default port is not a port the caller chose');
});

test('numbers as an address are refused, in every spelling the URL class normalises', () => {
  refused(['https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://169.254.169.254/latest', 'https://8.8.8.8/x',
    'https://2130706433/x', 'https://0x7f000001/x', 'https://0x7f.1/x', 'https://0177.0.0.1/x', 'https://017700000001/x', 'https://127.1/x',
    'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://[2001:db8::1]/x', 'https://1.2.3.4./x']);
});

test('a name with no dot, or a local or private name, is refused', () => {
  refused(['https://localhost/x', 'https://localhost./x', 'https://LOCALHOST/x', 'https://intranet/x', 'https://myserver/x']);
  for (const suffix of ['localhost', 'local', 'localdomain', 'internal', 'lan', 'home', 'corp', 'test', 'example', 'invalid', 'onion', 'arpa', 'intranet', 'private', 'box', 'svc', 'cluster', 'localnet']) {
    refused([`https://app.${suffix}/x`, `https://a.b.${suffix.toUpperCase()}/x`, `https://app.${suffix}./x`]);
  }
  refused(['https://x.home.arpa/', 'https://x.home.arpa./', 'https://fritz.box/', 'https://1.0.0.127.in-addr.arpa/']);
  refused(['https://example.example/x', 'https://youtube.com.evil.example/watch?v=' + ID]);
  assert.equal(code(() => parseLink('https://localhost.example.com/x')), null, 'only a SUFFIX makes a name private');
  assert.equal(code(() => parseLink('https://notlocal.com/x')), null);
  assert.equal(code(() => parseLink('https://my.homepage.com/x')), null);
});

test('over-long links, spaces and control characters are refused', () => {
  const long = `https://vimeo.com/${'a'.repeat(2000)}`;
  refused([long]);
  assert.equal(code(() => parseLink(`https://vimeo.com/${'a'.repeat(1900)}`)), null, 'a long but allowed link');
  refused(['https://vimeo.com/a b', 'https://vimeo.com/a\tb', 'https://vimeo.com/a\nb', 'https://vimeo.com/a\rb', 'https://vim\neo.com/1',
    'https://vimeo.com/a\u0000b', 'https://vimeo.com/a\u007fb', 'https://vimeo.com/a\u0085b', 'https://vimeo.com/a\u00a0b', 'https://vimeo.com/a\u2028b',
    'https://vimeo.com/a\u200bb', 'https://vimeo.com/1 https://example.org/2', 'https://vimeo.com/1;rm -rf /']);
});

test('a leading dash can never reach the program', () => {
  refused(['--version', '-o x https://vimeo.com/1', '--exec=calc https://vimeo.com/1', '-https://vimeo.com/1', '--', '-']);
  for (const ok of ['https://vimeo.com/1', 'https://a-b.example.org/-x', 'https://vimeo.com/--exec=x']) assert.match(parseLink(ok).url, /^https:\/\//, ok);
});

test('every YouTube-owned host is held to the YouTube rules: one video, rebuilt from its id', () => {
  const want = { site: 'youtube', id: ID, url: `https://www.youtube.com/watch?v=${ID}` };
  for (const host of ['music.youtube.com', 'gaming.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']) {
    refused([`https://${host}/playlist?list=PLabcdefghijk`, `https://${host}/channel/UCabcdefghijk`, `https://${host}/@chan`]);
    assert.deepEqual(parseLink(`https://${host}/watch?v=${ID}`), want, host);
  }
  assert.deepEqual(parseLink(`https://www.youtube-nocookie.com/embed/${ID}`), want);
  assert.deepEqual(parseLink(`https://www.youtube.com/embed/${ID}`), want);
  refused(['https://www.youtube-nocookie.com/embed/videoseries?list=PLx', 'https://www.youtube.com/embed/short']);
});

test('a look-alike YouTube host is a web link and never youtube', () => {
  for (const host of ['youtube.com.evil.org', 'www.youtube.com.evil.org', 'evilyoutube.com', 'youtube.co', 'youtu.be.evil.org', 'notyoutu.be', 'youtube-com.org', 'www.youtube.com@evil.org']) {
    const r = host.includes('@') ? null : parseLink(`https://${host}/watch?v=${ID}`);
    if (r) { assert.equal(r.site, 'web', host); assert.equal(r.url.startsWith('https://www.youtube.com/'), false, host); assert.equal(r.id, undefined); }
  }
  refused([`https://www.youtube.com@evil.org/watch?v=${ID}`]);
  assert.equal(parseLink(`https://www.youtube.com./watch?v=${ID}`).site, 'youtube', 'the root-dot spelling of the real host is the real host');
  assert.equal(parseLink(`https://WWW.YouTube.com/watch?v=${ID}`).site, 'youtube');
});

test('YouTube links are rebuilt from the id and keep their own refusals', () => {
  assert.deepEqual(parseLink(`https://youtu.be/${ID}?si=abc&t=3`), { site: 'youtube', id: ID, url: `https://www.youtube.com/watch?v=${ID}` });
  refused(['https://www.youtube.com/playlist?list=PLabcdefghijk', 'https://www.youtube.com/@chan', 'https://youtu.be/short', 'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch', `https://www.youtube.com/watch/${ID}`, 'https://youtu.be/']);
});

test('things that are not text are refused', () => {
  refused([42, null, undefined, {}, [], '', '   ', 'not a link']);
});

test('a Vimeo watch link is rewritten to the player address, which needs no account', () => {
  const player = 'https://player.vimeo.com/video/76979871';
  for (const link of ['https://vimeo.com/76979871', 'https://www.vimeo.com/76979871/', 'https://vimeo.com/channels/staffpicks/76979871', 'https://vimeo.com/76979871?share=copy']) {
    assert.equal(parseLink(link).url, player, link);
  }
  assert.equal(parseLink('https://vimeo.com/76979871/abcdef0123').url, `${player}?h=abcdef0123`);
  // Not a single video: left as it is for the program to judge.
  for (const link of ['https://vimeo.com/user123', 'https://vimeo.com/showcase/123456', 'https://notvimeo.com/76979871', 'https://vimeo.com.evil.org/76979871']) {
    assert.ok(!parseLink(link).url.startsWith('https://player.vimeo.com/'), link);
  }
});
