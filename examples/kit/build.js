// `npm run examples`: rebuild the showcase examples in examples/showcase/, in the order the
// Examples page lists them. Each writes its clips through the studio, proves them (check_skeleton,
// critique_animation with no warnings), and renders preview.png and filmstrips into examples/kit/look/.
// Name examples to rebuild only those: `npm run examples -- chest coin-burst`.
import { build as mika } from './mika.js';
import { build as pip } from './pip.js';
import { build as chest } from './chest.js';
import { build as playButton } from './play-button.js';
import { build as coinBurst } from './coin-burst.js';
import { build as warrior } from './warrior.js';

const ALL = { mika, pip, chest, 'play-button': playButton, 'coin-burst': coinBurst, warrior };
const names = process.argv.slice(2);
for (const name of names) if (!ALL[name]) { console.error(`No example named ${name}. Examples: ${Object.keys(ALL).join(', ')}`); process.exit(2); }
for (const name of names.length ? names : Object.keys(ALL)) await ALL[name]();
