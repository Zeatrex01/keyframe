#!/usr/bin/env node
// Writes docs/tools.md from the tool definitions.   npm run docs:tools
import fs from 'node:fs';
import { TOOLS } from '../src/mcp/server.js';
import { toolsMarkdown } from '../src/mcp/tool-docs.js';

const target = new URL('../docs/tools.md', import.meta.url);
fs.writeFileSync(target, toolsMarkdown(TOOLS));
process.stdout.write(`docs/tools.md: ${TOOLS.length} tools.\n`);
