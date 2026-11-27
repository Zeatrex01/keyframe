// Writing tools over files: restore_file, export_binary, export_player, export_godot.

import fs from 'node:fs';
import path from 'node:path';
import { projectOf } from '../project.js';
import { restore, snapshotBytesDeferred } from '../../core/backup.js';
import { writeSkeletonBinary } from '../../spine/binary.js';
import { parseSkeletonBinary, spineRuntimeAvailable } from '../../runtime/index.js';
import { DELIVERY_MARKER } from '../../deliver/compose.js';
import { StudioError } from '../../shared/errors.js';
import { standalonePlayerFor } from '../../deliver/standalone.js';
import { godotScene } from '../../engine/godot.js';

export const restoreFileTool = {
  name: 'restore_file',
  tier: 'core',
  writes: true,
  summary: 'Brings back an earlier version of a file the studio wrote; the current one is backed up first.',
  description: 'Restores one backup (a stamp from list_history) over a file the studio wrote. The current version is backed up first, so a restore is itself undoable. Files the studio never wrote have no history and are refused.',
  inputSchema: {
    type: 'object', required: ['file', 'backup'], additionalProperties: false,
    properties: { file: { type: 'string', description: 'Project-relative file.' }, backup: { type: 'string', description: 'Backup stamp from list_history.' } },
  },
  run({ file, backup }, { session }) {
    const project = projectOf(session);
    return { file, ...restore(project.dir, project.resolve(file), file, backup) };
  },
};

export const exportBinaryTool = {
  name: 'export_binary',
  tier: 'advanced',
  writes: true,
  summary: 'Writes a Spine binary .skel of a skeleton, verified by the official binary reader; needs the Spine add-on.',
  description: 'Writes the Spine 4.2 binary form of a skeleton JSON (smaller and faster to load in a game). The output is read back with the official Spine binary reader before it is kept, so this tool needs the Spine add-on and refuses (spine-addon-off) without it, writing nothing. Default target is <file>.skel beside the JSON; an existing .skel is overwritten only when it belongs to a studio delivery (and is backed up), never the owner\'s own export.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton JSON.' },
      into: { type: 'string', short: 'target .skel', description: 'Project-relative .skel target; default beside the JSON.' },
      nonessential: { type: 'boolean', short: 'keep editor-only data (default true)', description: 'Keep nonessential editor data (bone colours, icons, ...). Default true.' },
    },
  },
  async run({ file, into, nonessential = true }, { session }) {
    if (!spineRuntimeAvailable()) {
      throw new StudioError('spine-addon-off', 'Writing a Spine binary .skel needs the Spine add-on (it is read back with the official binary reader). The add-on is off: enable it in Settings (it needs your own Spine license). The JSON plays without it.');
    }
    const project = projectOf(session);
    const { sk, rel, abs } = project.skeleton(file);
    const targetAbs = project.resolve(into || project.rel(abs.replace(/\.json$/i, '.skel')));
    if (!/\.skel$/i.test(targetAbs)) throw new StudioError('bad-argument', 'The binary target must end in .skel.', { into });
    const exists = fs.existsSync(targetAbs);
    if (exists && !sk[DELIVERY_MARKER]) {
      throw new StudioError('target-exists', `${project.rel(targetAbs)} exists and the source is an owner file; choose another \`into\` so the owner's export is not overwritten.`,
        { into: project.rel(targetAbs) });
    }
    const bytes = writeSkeletonBinary(sk, { nonessential });
    await parseSkeletonBinary(bytes); // refuses here, before anything is written
    const pending = exists ? snapshotBytesDeferred(project.dir, fs.readFileSync(targetAbs), project.rel(targetAbs), '.skel') : null;
    const temp = path.join(path.dirname(targetAbs), `.${path.basename(targetAbs)}.${process.pid}.tmp`);
    try {
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, targetAbs);
    } catch (err) {
      try { fs.unlinkSync(temp); } catch { /* not created */ }
      pending?.rollback();
      throw new StudioError('write-failed', `The binary could not be written: ${err.message}`, { into: project.rel(targetAbs) });
    }
    return { file: rel, written: project.rel(targetAbs), bytes: bytes.length, backup: pending ? pending.commit() : null, verified: 'official binary reader' };
  },
};

export const exportPlayerTool = {
  name: 'export_player',
  tier: 'advanced',
  writes: true,
  summary: 'Writes one HTML file that plays a skeleton by double-click, with no studio, server or network.',
  description: 'Writes a standalone player: one HTML file with the studio\'s engine, the skeleton and its atlas pages inside, that plays in any browser opened from disk (clip menu, play/pause, loop, speed). Use it to show or send an animation to someone without the studio. Default target is <file>.player.html beside the skeleton; an existing player is replaced with a backup, any other file is never overwritten.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton JSON (Spine 4.2 or Keyframe).' },
      into: { type: 'string', short: 'target .html', description: 'Project-relative .html target; default <file>.player.html beside the skeleton.' },
      animation: { type: 'string', short: 'clip shown first', description: 'The clip the player starts with; default the first.' },
    },
  },
  run({ file, into, animation }, { session }) {
    const project = projectOf(session);
    const { rel, abs } = project.skeleton(file);
    const atlas = project.atlasFor(abs);
    if (!atlas) throw new StudioError('file-not-found', `No atlas beside ${rel}: the player needs the art.`, { file: rel });
    const targetAbs = project.resolve(into || project.rel(abs.replace(/(\.keyframe)?\.json$/i, '.player.html')));
    if (!/\.html?$/i.test(targetAbs)) throw new StudioError('bad-argument', 'The player target must end in .html.', { into });
    const html = standalonePlayerFor(abs, { atlas: atlas.abs, animation });
    const exists = fs.existsSync(targetAbs);
    if (exists && !fs.readFileSync(targetAbs, 'utf8').includes('<meta name="generator" content="Keyframe Studio">')) {
      throw new StudioError('target-exists', `${project.rel(targetAbs)} exists and is not a player the studio wrote; choose another \`into\`.`, { into: project.rel(targetAbs) });
    }
    const pending = exists ? snapshotBytesDeferred(project.dir, fs.readFileSync(targetAbs), project.rel(targetAbs), '.html') : null;
    try {
      fs.writeFileSync(targetAbs, html);
    } catch (err) {
      pending?.rollback();
      throw new StudioError('write-failed', `The player could not be written: ${err.message}`, { into: project.rel(targetAbs) });
    }
    return { file: rel, written: project.rel(targetAbs), bytes: Buffer.byteLength(html), backup: pending ? pending.commit() : null };
  },
};

export const exportGodotTool = {
  name: 'export_godot',
  tier: 'core',
  writes: true,
  summary: 'Writes <file>.kfscene for Godot 4: the Keyframe add-on imports it as Skeleton2D, Polygon2D and AnimationPlayer nodes.',
  description: 'Writes the Godot scene description of a skeleton beside it (<file>.kfscene). In a Godot 4 project with the Keyframe add-on (integrations/godot), copy the .kfscene with its atlas pages and Godot imports it as a scene: Skeleton2D and Bone2D, a Polygon2D per attachment, and an AnimationPlayer whose clips are Godot\'s own tracks (keyed bone channels keep their bezier handles; IK, inherit modes and shear are baked into keys at `fps`). The answer lists what was baked and what Godot cannot show (clipping, tint black). An existing .kfscene is replaced with a backup.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton JSON (Spine 4.2 or Keyframe).' },
      fps: { type: 'number', short: 'bake rate (default 30)', description: 'Frames per second for baked keys (constraints, colour, draw order, deform). Default 30.' },
      loops: { type: 'object', short: 'per clip: loops or plays once', additionalProperties: { type: 'boolean' }, description: 'Whether each named clip loops in Godot: { idle: true, cross: false }. Wins over the loop each clip was written with (write_animation `loop`) and over the guess (a clip that ends in its first pose loops unless its name is an action such as attack, jab, cross, block, step). A clip that plays once fires animation_finished.' },
      physics: { type: 'string', enum: ['baked', 'live'], short: 'baked or live', description: 'baked (default): the swing the studio shows, as keys. live: the rig runs the same springs in the game, so a scarf or a cape also reacts to the game moving the character.' },
    },
  },
  run({ file, fps = 30, loops, physics = 'baked' }, { session }) {
    const project = projectOf(session);
    const { sk, rel, abs } = project.skeleton(file);
    const atlas = project.atlasFor(abs);
    if (!atlas) throw new StudioError('file-not-found', `No atlas beside ${rel}: Godot needs the art.`, { file: rel });
    const name = path.basename(abs).replace(/(\.keyframe)?\.json$/i, '');
    const scene = godotScene(sk, { atlasText: atlas.text, fps, name, loops, physics: physics === 'live' ? 'live' : 'baked' });
    const targetAbs = abs.replace(/(\.keyframe)?\.json$/i, '.kfscene');
    const text = `${JSON.stringify(scene)}\n`;
    const pending = fs.existsSync(targetAbs) ? snapshotBytesDeferred(project.dir, fs.readFileSync(targetAbs), project.rel(targetAbs), '.kfscene') : null;
    try {
      fs.writeFileSync(targetAbs, text);
    } catch (err) {
      pending?.rollback();
      throw new StudioError('write-failed', `The Godot scene could not be written: ${err.message}`, { file: rel });
    }
    return { file: rel, written: project.rel(targetAbs), pages: scene.pages.map(p => p.name), clips: scene.animations.map(a => ({ name: a.name, length: a.length, loop: a.loop })),
      baked: scene.report.baked, ...(scene.report.live ? { live: scene.report.live } : {}), notImported: scene.report.skipped, backup: pending ? pending.commit() : null,
      next: 'Copy the .kfscene and its pages into a Godot 4 project with the Keyframe add-on enabled (integrations/godot); Godot imports it as a scene.' };
  },
};
