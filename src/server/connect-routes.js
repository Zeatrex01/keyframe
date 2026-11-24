// The page's "Add to Claude Desktop" button: whether the studio is in Claude Desktop's config,
// and adding it there on the owner's click (src/core/claude-desktop.js).
//
// Node-only (layer `server`).

import { desktopEntry } from '../core/connect.js';
import { desktopStatus, addToDesktop, desktopConfigPath } from '../core/claude-desktop.js';

/** @param {{ root: string, appRoot: string|null, configFile?: () => string }} options */
export function connectRoutes({ root, appRoot, configFile = () => desktopConfigPath() }) {
  const entry = () => desktopEntry(root, { appRoot });
  return {
    'GET /api/connect/claude-desktop': { run: () => desktopStatus(entry(), configFile()) },
    'POST /api/connect/claude-desktop': { run: () => addToDesktop(entry(), configFile()) },
  };
}
