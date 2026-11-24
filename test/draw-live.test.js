// Gate for the live drawing: a part's SVG becomes a safe tree (nothing in it can run), draw_rig
// can draw a rig part by part (merge) and records each part in the feed, the page server serves
// the feed, and the page's rules (reveal timing, sessions, following) hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { safeTree, SAFE_TAGS } from '../src/render/svg-safe.js';
import { appendFeed, readFeed, lastFeedSeq } from '../src/core/draw-feed.js';
import { createServer } from '../src/mcp/server.js';
import { createStudioServer } from '../src/server/http.js';
import { revealSchedule, shapesOf, sessionsOf, follow, gapAfter, speedOf, SPEEDS, DEFAULT_SPEED } from '../web/draw-live-model.js';
import { withNamespace } from '../web/draw-model.js';

const BODY = '<svg viewBox="0 0 100 120"><rect x="5" y="5" width="90" height="110" rx="30" fill="#7cc4ff" stroke="#123" stroke-width="4"/></svg>';
const HEAD = '<svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="40" fill="#ffd84d"/></svg>';

const tags = node => [node.tag, ...(node.children ?? []).flatMap(tags)];
const attrs = node => [...Object.entries(node.attrs ?? {}), ...(node.children ?? []).flatMap(attrs)];

test('a safe tree keeps shapes and paint and drops anything that could run or load', () => {
  const evil = `<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script>
    <foreignObject><div>x</div></foreignObject><image href="http://x/y.png"/><a href="javascript:alert(1)"><rect width="1" height="1"/></a>
    <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
    <rect x="1" y="1" width="8" height="8" fill="url(#g)" onclick="x()" style="stroke: red; behavior: url(x.htc)"/>
    <circle cx="5" cy="5" r="2" fill="url(http://evil/x#a)"/><path d="M0 0L5 5" transform="rotate(10)" filter="url(#f)"/>
    <ellipse cx="1" cy="1" rx="1" ry="1" fill="expression(alert(1))"/><rect width="2" height="2" fill="data:x"/></svg>`;
  const tree = safeTree(evil, 'btn');
  const all = tree.children.flatMap(tags);
  for (const t of all) assert.ok(SAFE_TAGS.includes(t), t);
  assert.ok(!all.includes('script') && !all.includes('foreignObject') && !all.includes('image') && !all.includes('a'));
  const pairs = tree.children.flatMap(attrs);
  for (const [k, v] of pairs) {
    assert.ok(!/^on/i.test(k) && k !== 'href' && k !== 'style' && k !== 'filter', k);
    assert.ok(!/javascript:|data:|expression|http:/i.test(v), `${k}=${v}`);
  }
  const rect = tree.children.find(n => n.tag === 'rect');
  assert.equal(rect.attrs.fill, 'url(#btn-g)', 'references are prefixed with the part');
  assert.equal(rect.attrs.stroke, 'red', 'style paint becomes attributes');
  assert.equal(tree.children.find(n => n.tag === 'defs').children[0].attrs.id, 'btn-g');
  assert.equal(tree.children.find(n => n.tag === 'circle').attrs.fill, undefined, 'an outside url() is dropped');
  assert.equal(tree.children.find(n => n.tag === 'path').attrs.transform, 'rotate(10)');
  assert.deepEqual(tree.viewBox, [0, 0, 10, 10]);
  assert.equal(tree.shapes, 5, 'a shape inside a link goes with the link');
  const painted = safeTree('<svg width="20" height="30" fill="#f00"><rect width="1" height="1"/></svg>');
  assert.deepEqual(painted.viewBox, [0, 0, 20, 30]);
  assert.equal(painted.children[0].tag, 'g');
  assert.equal(painted.children[0].attrs.fill, '#f00');
});

test('the feed numbers events, reads after a cursor, and keeps only the last session when it grows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-feed-'));
  try {
    assert.equal(lastFeedSeq(dir), 0);
    assert.deepEqual(readFeed(dir, 0), { events: [], last: 0, more: false });
    const first = appendFeed(dir, [{ kind: 'start', file: 'a.json' }, { kind: 'part', file: 'a.json' }, { kind: 'done', file: 'a.json' }]);
    assert.deepEqual(first.map(e => e.seq), [1, 2, 3]);
    assert.equal(lastFeedSeq(dir), 3);
    assert.deepEqual(readFeed(dir, 1).events.map(e => e.seq), [2, 3]);
    fs.appendFileSync(path.join(dir, '.keyframe', 'draw-feed.jsonl'), '{"torn\n');
    assert.equal(readFeed(dir, 0).events.length, 3, 'a torn line is skipped');
    const big = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < 5; i++) appendFeed(dir, [{ kind: 'start', file: `b${i}.json`, pad: big }, { kind: 'done', file: `b${i}.json` }]);
    const left = readFeed(dir, 0).events;
    assert.equal(left[0].kind, 'start');
    assert.ok(!left.some(e => e.file === 'a.json'), 'old sessions are dropped');
    assert.ok(fs.statSync(path.join(dir, '.keyframe', 'draw-feed.jsonl')).size <= 4 * 1024 * 1024, 'the feed stays under its limit');
    assert.equal(lastFeedSeq(dir), left.at(-1).seq);
    assert.ok(left.at(-1).seq > 3, 'numbers keep growing after a trim');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('draw_rig draws part by part with merge, and records every part in the feed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-live-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
  const call = async args => { sent.length = 0; await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'draw_rig', arguments: args } }); return sent[0].result.structuredContent; };
  try {
    const one = await call({ name: 'pal', parts: [{ name: 'body', svg: BODY, at: [0, 60], pivot: [0, 0] }], merge: true });
    assert.equal(one.error, undefined, JSON.stringify(one.error));
    const two = await call({ name: 'pal', parts: [{ name: 'head', svg: HEAD, at: [0, 150], pivot: [0, 115], parent: 'body' }], merge: true });
    assert.deepEqual(two.drawing, ['body', 'head'], 'the second call adds to the first');
    const redrawn = await call({ name: 'pal', parts: [{ name: 'body', svg: HEAD, at: [0, 60], pivot: [0, 0] }], merge: true });
    assert.deepEqual(redrawn.drawing, ['body', 'head'], 'the same name replaces in place');
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'pal.parts.json'), 'utf8'));
    assert.deepEqual(doc.parts.map(p => p.name), ['body', 'head']);
    const sk = JSON.parse(fs.readFileSync(path.join(dir, 'pal.json'), 'utf8'));
    assert.ok(sk.bones.some(b => b.name === 'head' && b.parent === 'body'));
    const { events, last } = readFeed(dir, 0);
    assert.equal(last, redrawn.feed);
    assert.deepEqual(events.map(e => e.kind), ['start', 'part', 'done', 'start', 'part', 'done', 'start', 'part', 'done']);
    const part = events.find(e => e.kind === 'part' && e.part.name === 'head');
    assert.equal(part.file, 'pal.parts.json');
    assert.equal(part.part.svg, undefined, 'the feed carries the safe tree, not the raw svg');
    assert.equal(part.tree.children[0].tag, 'circle');
    const whole = await call({ name: 'pal', parts: [{ name: 'body', svg: BODY, at: [0, 60] }] });
    assert.equal(whole.drawing, undefined);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pal.parts.json'), 'utf8')).parts.map(p => p.name), ['body'], 'without merge the drawing is replaced');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function get(port, target) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: target, headers: { host: `127.0.0.1:${port}` } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    }).on('error', reject);
  });
}

test('the page server serves the feed, its newest number in the state, and safe trees with a drawing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-live-http-'));
  const studio = createStudioServer({ projectDir: dir, version: 'test' });
  const port = await studio.listen(0);
  try {
    assert.equal((await get(port, '/api/state')).json.drawFeed, 0);
    const sent = [];
    const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
    await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'draw_rig', arguments: { name: 'pal', parts: [{ name: 'body', svg: BODY, at: [0, 60] }, { name: 'head', svg: HEAD, at: [0, 150], parent: 'body' }] } } });
    const state = (await get(port, '/api/state')).json;
    assert.equal(state.drawFeed, 4);
    const feed = (await get(port, '/api/draw-feed?since=1')).json;
    assert.deepEqual(feed.events.map(e => e.kind), ['part', 'part', 'done']);
    assert.equal((await get(port, '/api/draw-feed?since=nope')).json.events.length, 4, 'a bad cursor reads from the start');
    const doc = (await get(port, '/api/drawing?file=pal.parts.json')).json;
    assert.deepEqual(Object.keys(doc.trees), ['body', 'head']);
    assert.equal(doc.trees.body.children[0].tag, 'rect');
  } finally {
    await new Promise(done => studio.server.close(done));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the reveal traces outlines before fills, scales with speed and is instant at 0', () => {
  const tree = safeTree(BODY + '');
  const shapes = shapesOf(tree);
  assert.deepEqual(shapes.map(s => [s.tag, s.stroked, s.filled]), [['rect', true, true]]);
  const plan = revealSchedule(tree, 1);
  assert.equal(plan.duration, 1400);
  const stroke = plan.steps.find(s => s.kind === 'stroke'), fill = plan.steps.find(s => s.kind === 'fill');
  assert.ok(stroke.start < fill.start, 'the outline starts before the fill');
  for (const s of plan.steps) assert.ok(s.start + s.duration <= plan.duration + 1, 'every step ends within the part');
  assert.equal(revealSchedule(tree, 2).duration, 700);
  assert.deepEqual(revealSchedule(tree, 0), { duration: 0, steps: [] });
  assert.deepEqual(revealSchedule(null, 1), { duration: 0, steps: [] });
  assert.equal(gapAfter(0), 0);
  assert.ok(SPEEDS.includes(0));
  const grouped = { viewBox: [0, 0, 1, 1], children: [{ tag: 'g', attrs: { stroke: '#000', fill: 'none' }, children: [{ tag: 'path', attrs: { d: 'M0 0' }, children: [] }, { tag: 'line', attrs: {}, children: [] }] }] };
  assert.deepEqual(shapesOf(grouped).map(s => [s.trail.join('.'), s.stroked, s.filled]), [['0.0', true, false], ['0.1', true, false]], 'paint is inherited from the group');
  const many = revealSchedule({ viewBox: [0, 0, 1, 1], children: [1, 2, 3].map(() => ({ tag: 'path', attrs: { stroke: '#000', fill: '#fff' }, children: [] })) }, 1);
  const starts = many.steps.filter(s => s.kind === 'stroke').map(s => s.start);
  assert.ok(starts[0] < starts[1] && starts[1] < starts[2], 'outlines follow one another');
});

test('feed events group into sessions, and the view follows a part that leaves the screen', () => {
  const ev = [
    { seq: 1, kind: 'part', file: 'a.parts.json', part: { name: 'x' } },
    { seq: 2, kind: 'done', file: 'a.parts.json', total: 3 },
    { seq: 3, kind: 'start', file: 'b.parts.json', total: 2 },
    { seq: 4, kind: 'part', file: 'b.parts.json', part: { name: 'y' } },
    { seq: 5, kind: 'part', file: 'c.parts.json', part: { name: 'z' } },
    null,
  ];
  const s = sessionsOf(ev);
  assert.deepEqual(s.map(x => [x.file, x.parts.length, x.done]), [['a.parts.json', 1, true], ['b.parts.json', 1, false], ['c.parts.json', 1, false]]);
  assert.equal(s[0].total, 3);
  const view = { cx: 0, cy: 0, scale: 1 };
  assert.equal(follow(view, { x: -10, y: -10, width: 20, height: 20 }, 400, 300), view, 'a part on screen keeps the view');
  assert.deepEqual(follow(view, { x: 500, y: 0, width: 100, height: 40 }, 400, 300), { cx: 550, cy: 20, scale: 1 });
});

test('no stored speed means the default, not instant; a drawing without a namespace still shows', () => {
  assert.equal(speedOf(null), DEFAULT_SPEED);
  assert.equal(speedOf(''), DEFAULT_SPEED);
  assert.equal(speedOf('3'), DEFAULT_SPEED);
  assert.equal(speedOf('0'), 0);
  assert.equal(speedOf('2'), 2);
  assert.match(withNamespace('<svg viewBox="0 0 1 1"/>'), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox/);
  const named = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
  assert.equal(withNamespace(named), named);
});
