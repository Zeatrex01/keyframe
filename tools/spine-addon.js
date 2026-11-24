#!/usr/bin/env node
// The Spine add-on from the command line (Settings does the same):
//   npm run spine-addon                     says whether it is on, and what it needs
//   npm run spine-addon -- --accept-license turns it on: downloads the official runtime after
//                                           you accept the Spine Runtimes License
//   npm run spine-addon -- --off            turns it off and deletes the runtime
import { spineAddonStatus, installSpineRuntime, removeSpineRuntime, spineAddonDir, SPINE_RUNTIME } from '../src/core/spine-addon.js';

const args = new Set(process.argv.slice(2));
const say = line => process.stdout.write(`${line}\n`);

try {
  if (args.has('--off')) {
    removeSpineRuntime();
    say('The Spine add-on is off; its files are deleted.');
  } else if (args.has('--accept-license') || args.has('--accept-licence') /* the British spelling still works */) {
    say(`Downloading ${SPINE_RUNTIME.package}@${SPINE_RUNTIME.version} from npm...`);
    const status = await installSpineRuntime({ acceptLicense: true });
    say(`The Spine add-on is on (${status.version}), in ${spineAddonDir()}.`);
  } else {
    const status = spineAddonStatus();
    say(`The Spine add-on is ${status.on ? `on (${status.version}, accepted ${status.acceptedAt})` : 'off'}.`);
    if (!status.on) {
      say('');
      say('The studio works without it, on its own engine. The add-on brings Esoteric Software\'s official');
      say(`Spine runtime, which is under the ${SPINE_RUNTIME.license} (${SPINE_RUNTIME.licenseUrl}):`);
      say('you need your own Spine Editor license to use it. To accept it and turn the add-on on:');
      say('  npm run spine-addon -- --accept-license');
    }
  }
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
}
