// For gates that test the official Spine runtime itself (the Spine add-on's backend): `SPINE` is
// the runtime API with the official backend forced, or null; `needsSpine` skips a test without it.
import { officialRuntime } from './official-runtime.js';

export const SPINE = await officialRuntime();
export const needsSpine = SPINE ? {} : { skip: 'needs the Spine add-on (official runtime); the studio itself does not' };
