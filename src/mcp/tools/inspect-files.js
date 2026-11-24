// Reading tools over files: diff_skeletons, read_atlas, check_assets, list_history, spine_info.

import fs from 'node:fs';
import path from 'node:path';
import { projectOf } from '../project.js';
import { diffSkeletons } from '../../spine/diff.js';
import { skinsOf } from '../../spine/check.js';
import { readAtlas } from '../../understand/atlas.js';
import { list as listBackups } from '../../core/backup.js';
import { locateSpineCli, runSpineCli } from '../../core/spine-cli.js';
import { StudioError } from '../../shared/errors.js';

const FILE = { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton JSON; empty picks the folder\'s base.' };

export const diffSkeletonsTool = {
  name: 'diff_skeletons',
  tier: 'advanced',
  writes: false,
  summary: 'What differs between two skeletons: bones, slots, skins, attachments, constraints and animations, by name.',
  description: 'Compares two skeleton JSON files structurally: added, removed and changed bones (with the setup fields that changed), slots, skins and attachments, constraints, events and animations. Answers "did my delivery leave the rig untouched", "what did the owner change in the new export". Reading only.',
  inputSchema: {
    type: 'object', required: ['before', 'after'], additionalProperties: false,
    properties: { before: { type: 'string', description: 'Project-relative skeleton (the older or the base).' }, after: { type: 'string', description: 'Project-relative skeleton (the newer or the delivery).' } },
  },
  run({ before, after }, { session }) {
    const project = projectOf(session);
    const a = project.skeleton(before);
    const b = project.skeleton(after);
    return { before: a.rel, after: b.rel, ...diffSkeletons(a.sk, b.sk) };
  },
};

export const readAtlasTool = {
  name: 'read_atlas',
  tier: 'advanced',
  writes: false,
  summary: 'Pages and region geometry of a .atlas, read by the official parser.',
  description: 'Reads a texture .atlas (the libGDX/Spine text format) with the studio\'s atlas reader: every page (name, size, premultiplied alpha, filters) and every region (page, packed x/y, size before rotation, rotation degrees, trim offsets, original size). Give `atlas` directly, or a skeleton to read the atlas paired beside it.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { file: FILE, atlas: { type: 'string', short: 'read this .atlas directly', description: 'Project-relative .atlas path instead of the one beside the skeleton.' } },
  },
  async run({ file, atlas }, { session }) {
    const project = projectOf(session);
    let abs;
    if (atlas) abs = project.resolve(atlas);
    else {
      const { abs: skeletonAbs, rel } = project.skeleton(file);
      const paired = project.atlasFor(skeletonAbs);
      if (!paired) return { file: rel, atlas: null, note: 'No .atlas beside this skeleton (x.json pairs with x.atlas or x.atlas.txt).' };
      abs = paired.abs;
    }
    if (!fs.existsSync(abs)) throw new StudioError('file-not-found', `Atlas not found: ${atlas}.`, { atlas });
    return { atlas: project.rel(abs), ...(await readAtlas(fs.readFileSync(abs, 'utf8'))) };
  },
};

export const checkAssetsTool = {
  name: 'check_assets',
  tier: 'advanced',
  writes: false,
  summary: 'Does every image the skeleton uses resolve: atlas regions present, page images on disk.',
  description: 'Checks that the art a skeleton needs is really there: every region and mesh attachment (by its path, or name) must exist as a region in the paired atlas, and every page image the atlas names must exist beside it. A skeleton that passes check_skeleton can still open as white boxes when this fails. Reading only.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { file: FILE } },
  async run({ file }, { session }) {
    const project = projectOf(session);
    const { sk, rel, abs } = project.skeleton(file);
    const needed = new Map();
    for (const skin of skinsOf(sk)) {
      for (const [slot, attachments] of Object.entries(skin.attachments ?? {})) {
        for (const [name, a] of Object.entries(attachments ?? {})) {
          const type = a?.type ?? 'region';
          if (!['region', 'mesh', 'linkedmesh'].includes(type)) continue;
          const region = a?.path ?? a?.name ?? name;
          if (a?.sequence) continue; // sequences resolve numbered regions; reported by the runtime when missing
          if (!needed.has(region)) needed.set(region, []);
          needed.get(region).push(`${skin.name}/${slot}/${name}`);
        }
      }
    }
    const paired = project.atlasFor(abs);
    if (!paired) return { file: rel, atlas: null, ok: needed.size === 0, missingRegions: [...needed.keys()], note: 'No .atlas beside this skeleton.' };
    const atlas = await readAtlas(paired.text);
    const regions = new Set(atlas.regions.map(r => r.name));
    const missingRegions = [...needed.entries()].filter(([region]) => !regions.has(region)).map(([region, usedBy]) => ({ region, usedBy }));
    const missingPages = atlas.pages.map(p => p.name).filter(page => !fs.existsSync(path.join(path.dirname(paired.abs), page)));
    return { file: rel, atlas: paired.rel, ok: !missingRegions.length && !missingPages.length,
      regionsUsed: needed.size, missingRegions, missingPages };
  },
};

export const listHistoryTool = {
  name: 'list_history',
  tier: 'core',
  writes: false,
  summary: 'The backups the studio keeps of a file it wrote, newest first.',
  description: 'Lists the backups of a file the studio has written (deliveries, atlases beside them): stamp, size and time, newest first. restore_file brings one back. Owner files the studio never wrote have no history.',
  inputSchema: { type: 'object', required: ['file'], additionalProperties: false, properties: { file: { type: 'string', description: 'Project-relative file.' } } },
  run({ file }, { session }) {
    const project = projectOf(session);
    project.resolve(file);
    return { file, backups: listBackups(project.dir, file) };
  },
};

const OUTPUT_CAP = 4000;
const cap = s => (s.length > OUTPUT_CAP ? `${s.slice(0, OUTPUT_CAP)}...` : s).trim();
// The CLI prints the license holder's name and e-mail; that is the owner's data, not the file's.
const hideLicensee = s => s.replace(/^(\s*Licensed to:).*$/gim, '$1 (hidden)');

export const spineInfoTool = {
  name: 'spine_info',
  tier: 'advanced',
  writes: false,
  summary: 'Asks the installed Spine command line about a .spine, .json or .skel file; refuses without a licensed Spine.',
  description: 'Runs the installed Spine command line in info mode (`Spine -i <file>`) and returns what the real editor says, verbatim (its format is undocumented, so nothing is parsed), with the license holder line hidden. This is "will the real Spine open it"; check_skeleton answers without Spine. Needs a licensed install: set SPINE_CLI to the executable, or spineCli in studio.config.json. Without it the tool refuses and runs nothing.',
  inputSchema: { type: 'object', required: ['file'], additionalProperties: false, properties: { file: { type: 'string', description: 'Project-relative .spine, .json or .skel file.' } } },
  async run({ file }, { session, signal }) {
    if (!/\.(spine|json|skel)$/i.test(file)) throw new StudioError('bad-argument', `spine_info reads .spine, .json or .skel files, not ${file}.`, { file });
    const abs = projectOf(session).resolve(file);
    if (!fs.existsSync(abs)) throw new StudioError('file-not-found', `File not found: ${file}.`, { file });
    const cli = locateSpineCli();
    if (!cli) throw new StudioError('no-spine-cli', 'No Spine command line found. Set SPINE_CLI to the Spine executable (Spine.com on Windows) or spineCli in studio.config.json.');
    if (signal?.aborted) return { cancelled: true };
    const r = await runSpineCli(cli, ['-i', abs]);
    return { file, spineCli: cli, ok: r.code === 0 && !r.timedOut, exitCode: r.code,
      ...(r.timedOut ? { timedOut: true } : {}), ...(r.spawnError ? { spawnError: r.spawnError } : {}),
      output: cap(hideLicensee(r.stdout)), ...(r.stderr.trim() ? { errorOutput: cap(r.stderr) } : {}) };
  },
};
