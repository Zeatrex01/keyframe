// The key lanes under the stage are worked out from the clip's own keys: one lane per bone or slot
// and channel that has keys, in the skeleton's order, with the clip's events last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lanesFromAnimation, rulerTicks, along, CHANNELS, CHANNEL_COLOUR } from '../web/lanes.js';

const SKELETON = {
  skeleton: { spine: '4.2.40' },
  bones: [{ name: 'root' }, { name: 'body', parent: 'root' }, { name: 'head', parent: 'body' }, { name: 'tail', parent: 'body' }],
  slots: [{ name: 'body', bone: 'body' }, { name: 'mouth', bone: 'head' }],
  animations: {
    happy_in: {
      // Listed out of skeleton order on purpose: the lanes follow the bones, not the file's order.
      bones: {
        tail: { rotate: [{ time: 0.1, value: 4 }, { time: 0.3, value: -4 }] },
        body: {
          scale: [{ x: 1, y: 1 }, { time: 0.2, x: 1.1, y: 0.9 }, { time: 0.6, x: 1, y: 1 }],
          rotate: [{ value: 0 }, { time: 0.6, value: 0 }],
          translatey: [{ time: 0.2, value: 12 }],
          translate: [{ time: 0.2, x: 0, y: 4 }, { time: 0.4 }],
        },
        root: { inherit: [{ time: 0.1, inherit: 'noScale' }] },
      },
      slots: {
        mouth: { attachment: [{ name: 'mouth_open' }, { time: 0.2, name: 'mouth_smile' }] },
        body: { rgba: [{ color: 'ffffffff' }, { time: 0.5, color: 'ffd0d0ff' }], alpha: [{ time: 0.25, value: 0.5 }] },
      },
      events: [{ time: 0.2, name: 'land' }, { time: 0.2, name: 'dust' }, { name: 'start' }],
      drawOrder: [{ time: 0.7, offsets: [] }],
    },
    still: {},
  },
};

test('one lane per bone and channel, in the skeleton\'s order, keys merged and sorted', () => {
  const { duration, lanes } = lanesFromAnimation(SKELETON, 'happy_in');
  assert.equal(duration, 0.7, 'the last key anywhere, the draw order too, is the length');
  const rows = lanes.map(l => `${l.kind}:${l.target}:${l.channel}${l.child ? ' (child)' : ''}`);
  assert.deepEqual(rows, [
    'bone:body:rotate', 'bone:body:move (child)', 'bone:body:scale (child)',
    'bone:tail:rotate',
    'slot:body:colour', 'slot:mouth:image',
    'events:events:events',
  ]);
  const lane = (target, channel) => lanes.find(l => l.target === target && l.channel === channel).keys;
  assert.deepEqual(lane('body', 'rotate'), [0, 0.6], 'a key with no time is at 0');
  assert.deepEqual(lane('body', 'move'), [0.2, 0.4], 'translate and translatey share one move lane, a time once');
  assert.deepEqual(lane('body', 'scale'), [0, 0.2, 0.6]);
  assert.deepEqual(lane('body', 'colour'), [0, 0.25, 0.5], 'rgba and alpha are one colour lane');
  assert.deepEqual(lane('mouth', 'image'), [0, 0.2]);
  assert.deepEqual(lane('events', 'events'), [0, 0.2], 'two events at one time are one mark');
  assert.ok(!lanes.some(l => l.target === 'root'), 'a channel the lanes do not show (inherit) adds no lane');
});

test('a clip with no keys has no lanes, and a clip that does not exist is null', () => {
  assert.deepEqual(lanesFromAnimation(SKELETON, 'still'), { duration: 0, lanes: [] });
  assert.equal(lanesFromAnimation(SKELETON, 'nope'), null);
  assert.equal(lanesFromAnimation(null, 'happy_in'), null);
  assert.equal(lanesFromAnimation({ animations: { odd: 'not an object' } }, 'odd'), null);
});

test('every channel has a colour token, and every lane uses one of them', () => {
  const tokens = fs.readFileSync(new URL('../web/tokens.css', import.meta.url), 'utf8');
  for (const channel of CHANNELS) assert.match(tokens, new RegExp(`${CHANNEL_COLOUR[channel]}:`), channel);
  for (const lane of lanesFromAnimation(SKELETON, 'happy_in').lanes) assert.ok(CHANNELS.includes(lane.channel));
});

test('a real skeleton reads without a surprise: bones in order, keys inside the clip', () => {
  const json = JSON.parse(fs.readFileSync(new URL('./fixtures/ident/ident.json', import.meta.url), 'utf8'));
  const order = json.bones.map(b => b.name);
  for (const clip of Object.keys(json.animations)) {
    const { duration, lanes } = lanesFromAnimation(json, clip);
    assert.ok(duration > 0, clip);
    const bones = lanes.filter(l => l.kind === 'bone').map(l => order.indexOf(l.target));
    assert.deepEqual(bones, [...bones].sort((a, b) => a - b), `${clip}: bones in skeleton order`);
    for (const lane of lanes) for (const time of lane.keys) assert.ok(time >= 0 && time <= duration, `${clip} ${lane.target} ${time}`);
  }
});

test('the ruler labels a comfortable step and ticks between', () => {
  assert.deepEqual(rulerTicks(0.6).major, [0.1, 0.2, 0.3, 0.4, 0.5]);
  assert.equal(rulerTicks(0.6).step, 0.1);
  assert.equal(rulerTicks(3.2).step, 1);
  assert.deepEqual(rulerTicks(3.2).major, [1, 2, 3]);
  assert.ok(rulerTicks(3.2).minor.includes(0.25) && !rulerTicks(3.2).minor.includes(1));
  assert.deepEqual(rulerTicks(0), { major: [], minor: [], step: 0 });
  assert.equal(along(0.3, 0.6), 0.5);
  assert.equal(along(2, 0.6), 1);
  assert.equal(along(1, 0), 0);
});

test('the page draws the lanes and the ruler replaces the old scrub bar', () => {
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const id of ['timeline', 'ruler', 'laneLabels', 'lanes', 'playhead', 'laneRange']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /id="ruler" role="slider" tabindex="0"/, 'the keyboard can scrub');
  assert.doesNotMatch(html, /id="scrub"/);
  const timeline = fs.readFileSync(new URL('../web/timeline.js', import.meta.url), 'utf8');
  assert.match(timeline, /lanesFromAnimation\(source\.json, S\.anim\)/);
  assert.match(fs.readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8'), /'\/web\/lanes\.js'/);
});
