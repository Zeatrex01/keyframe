const { buildIcon } = require('./kit.cjs'); const H = require('./human.cjs');
const parts = H.humanParts();
buildIcon({ name: 'human', ground: H.GROUND, bounds: H.BOUNDS, badge: [104, 80], sparkles: [[-120, 60], [124, 20]], bones: parts.bones, ik: parts.ik, pieces: parts.pieces }, __dirname + '/pack')
  .then(r => { const sk = require('./pack/human/human.json'); console.log('human: bones', sk.bones.length, 'slots', sk.slots.length, 'ik', (sk.ik || []).map(c => c.name).join(' '), 'skins', sk.skins.map(s => s.name).join(', ')); });
