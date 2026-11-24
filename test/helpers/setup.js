// Loaded before every gate (`node --test --import ./test/helpers/setup.js`): the runtime finds the
// Spine add-on exactly as the studio does, so gates that compare against the official runtime run
// where the add-on is installed and skip where it is not. KS_SPINE_RUNTIME points at a folder.
import { configureSpineRuntime } from '../../src/runtime/index.js';
import { locateSpineRuntime } from '../../src/core/spine-addon.js';

configureSpineRuntime({ locate: () => locateSpineRuntime(process.env) });

// Gates never read or write the owner's real studio config: a dev machine whose director slot
// has an agent CLI chosen would otherwise start that CLI from any gate that posts a message.
if (!process.env.KS_CONFIG) {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = mkdtempSync(join(tmpdir(), 'kf-config-'));
  process.env.KS_CONFIG = join(folder, 'studio.config.json');
  process.on('exit', () => { try { rmSync(folder, { recursive: true, force: true }); } catch { /* left to the OS */ } });
}
