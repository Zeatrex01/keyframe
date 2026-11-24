// Swap-to-skin migration: fold duplicated "look variant" clips into named Spine skins.
// Ported from legacy skin_migrate.js.
//
// The pattern this fixes: a colour or material variant built by duplicating the whole
// motion once per look and keying a different attachment name per slot in each copy
// (real case: the owner's Chest_Export rig, where Bronze_Chest, Gold_Chest and
// Silver_Chest are the same lid-pop motion three times over, each differing only by
// slots.<slot>.attachment: [{ name: "Gold01" }]). Every later motion edit then has to be
// repeated once per clip. Spine's skins exist for exactly this: one shared clip, the look
// picked by the active skin.
//
// Left untouched: a genuine mid-clip attachment swap used for its intended purpose
// (blink, icon change). The moment one slot shows more than one distinct attachment
// across a clip's timeline, that clip is an in-clip swap, not a duplicated-clip variant.
//
// The key-relocation trick (the part that is easy to get wrong): Spine looks a skin's
// attachment up by (slot, attachment NAME IN PLAY). Once the variant's attachment
// timeline is removed, the name in play for every skin is the slot's SETUP name (e.g.
// "Bronze01"), never the key the art sat under in `default` (e.g. "Gold01"). So the Gold
// look's art is copied into the new "Gold" skin under the key "Bronze01"; otherwise
// nothing would ever ask for "Gold01" again and the skin's entry would be dead. `path` is
// filled in when the relocation changes the key, so the same atlas region still resolves
// (what the Spine editor does when an attachment is copied under a new name).
//
// Never invents art: creating attachments is rig work and stays in Spine. A picked
// attachment that is not already in the default skin refuses the whole group.
//
// The picture must not change. A clip is folded only when the result, played with the
// variant's skin, shows what the original clip showed at every instant. Rules below that
// say "refuse" exist because the legacy module silently changed the picture there; the
// gate proves each case against the official runtime.
//
// Pure: no I/O. migrate() and splitLooks() never mutate their input; scan() only reads.
// Gate: test/skin-migration.test.js.

import { StudioError } from '../shared/errors.js';
import { skinsOf } from './check.js';

const DEFAULT_SKIN = 'default';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Deep equality of JSON data where object key order does not matter. Two clips written
// with keys in a different order are the same motion; the legacy JSON.stringify compare
// called them drifted and kept a clip it should have folded.
function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
  }
  return false;
}

function assertSkeleton(sk) {
  if (!isObject(sk)) throw new StudioError('bad-argument', 'The skeleton must be a parsed Spine JSON object.');
}

// The 4.x runtime takes the skin NAMED "default" as the default skin, wherever it sits in
// the array. The legacy module read skins[0], so a file listing another skin first had
// its art looked up in the wrong skin.
const defaultSkinOf = skins => skins.find(s => s?.name === DEFAULT_SKIN);

// The atlas region an attachment resolves to: the official parser uses `path`, else the
// attachment's own `name` field, else its key. The legacy relocation ignored `name` and
// pointed a relocated copy at the key, which is the wrong region when `name` is set.
const regionOf = (att, key) => att?.path ?? att?.name ?? key;

function slotSetupOf(sk) {
  const setup = {};
  for (const s of sk.slots ?? []) if (s?.name) setup[s.name] = s.attachment ?? null;
  return setup;
}

/** A copy of the clip with every slot's attachment timeline removed: the only thing a
 *  whole-clip look variant may differ by. Used to compare motions and to build the
 *  surviving clip. */
function stripAttachmentTimelines(anim) {
  const out = structuredClone(anim ?? {});
  for (const [slot, timelines] of Object.entries(out.slots ?? {})) {
    if (!isObject(timelines)) continue;
    delete timelines.attachment;
    if (!Object.keys(timelines).length) delete out.slots[slot];
  }
  // An empty `slots: {}` and no `slots` key are the same clip; leaving the empty object
  // would make two otherwise identical clips compare as different.
  if (out.slots && !Object.keys(out.slots).length) delete out.slots;
  return out;
}

/**
 * Read a clip's attachment channels against the setup pose.
 * picks: slot -> the one attachment name the clip shows in that slot for the whole clip.
 * problem: why the clip is not a whole-clip look (null when it is one).
 * Problems:
 *   in-clip-swap  a slot shows more than one attachment (or a name and a hide)
 *   hide-key      a slot is hidden for the whole clip while its setup shows art; removing
 *                 the timeline would make it visible
 *   late-pick     a slot's look starts after t=0; before that key the original shows the
 *                 setup look, which a skin cannot express
 */
function readClip(anim, slotSetup, { checkHides }) {
  const picks = {};
  for (const [slot, timelines] of Object.entries(anim?.slots ?? {})) {
    const keys = timelines?.attachment;
    if (!Array.isArray(keys) || !keys.length) continue;
    const names = [...new Set(keys.map(k => k?.name ?? null))];
    const named = names.filter(n => n !== null);
    if (checkHides ? names.length > 1 : named.length > 1) {
      return { picks, problem: { code: 'in-clip-swap', slot, names } };
    }
    if (!named.length) {
      if (checkHides && slotSetup[slot]) return { picks, problem: { code: 'hide-key', slot } };
      continue;
    }
    const [name] = named;
    // Before its first key a timeline shows the setup attachment. Irrelevant when the
    // look already is the setup attachment.
    const firstTime = Math.min(...keys.map(k => k?.time ?? 0));
    if (name !== slotSetup[slot] && firstTime > 0) {
      return { picks, problem: { code: 'late-pick', slot, name, time: firstTime } };
    }
    picks[slot] = name;
  }
  return { picks, problem: null };
}

const PROBLEM_TEXT = {
  'in-clip-swap': p => `slot "${p.slot}" shows more than one attachment in this clip; that is an in-clip swap (blink, icon change), not a look variant`,
  'hide-key': p => `slot "${p.slot}" is hidden for the whole clip; removing its attachment timeline would make it visible`,
  'late-pick': p => `slot "${p.slot}" shows "${p.name}" only from ${p.time} s; before that the clip shows the setup look, which a skin cannot express`,
};

// "Gold01" against the base's "Bronze01" -> "Gold": the longest common suffix is trimmed
// off and the remainder is the varying tag. Null when the slots disagree on the tag or
// there is nothing to compare; the caller names the skin explicitly either way, this only
// feeds scan()'s suggestion. The base usually has no attachment timeline at all (it
// already shows the setup look), so its look in a slot is the setup attachment; the
// legacy guess compared against an empty name there and suggested "Gold_body".
function guessSkinName(variantPicks, basePicks, slotSetup) {
  let candidate = null;
  for (const [slot, name] of Object.entries(variantPicks)) {
    const baseName = basePicks[slot] ?? slotSetup[slot] ?? '';
    if (!name || name === baseName) continue;
    let i = 0;
    while (i < name.length && i < baseName.length && name[name.length - 1 - i] === baseName[baseName.length - 1 - i]) i++;
    const prefix = name.slice(0, name.length - i).replace(/[_-]+$/, '');
    if (!prefix) return null;
    if (candidate === null) candidate = prefix;
    else if (candidate.toLowerCase() !== prefix.toLowerCase()) return null;
  }
  return candidate;
}

/**
 * Suggest look-variant families. Read-only; migrate() never calls it. Clips that become
 * identical once their attachment timelines are stripped form a family; the member whose
 * picks already match the setup attachments is offered as the base (it needs no skin).
 * @param {object} sk parsed skeleton JSON
 * @param {{ skinNames?: Record<string, string> }} [options] explicit skin name per clip
 * @returns {{ groups: Array<{ base: string, variants: Array<{ animation: string, skinName: string|null, picks: object }> }>,
 *             report: Array<{ animation: string, code: string, why: string, params: object }> }}
 */
export function scan(sk, { skinNames = {} } = {}) {
  assertSkeleton(sk);
  const slotSetup = slotSetupOf(sk);
  const names = Object.keys(sk.animations ?? {});
  const bare = {};
  const read = {};
  for (const n of names) {
    bare[n] = stripAttachmentTimelines(sk.animations[n]);
    read[n] = readClip(sk.animations[n], slotSetup, { checkHides: true });
  }
  const usable = n => !read[n].problem;
  const seen = new Set();
  const groups = [];
  for (const a of names) {
    if (seen.has(a) || !usable(a)) continue;
    const family = [a, ...names.filter(b => b !== a && !seen.has(b) && usable(b) && sameJson(bare[a], bare[b]))];
    if (family.length < 2) continue;
    family.forEach(n => seen.add(n));
    const matchesSetup = n => Object.entries(read[n].picks).every(([slot, name]) => slotSetup[slot] === name);
    const base = family.find(matchesSetup) ?? family[0];
    groups.push({
      base,
      variants: family.filter(n => n !== base).map(n => ({
        animation: n,
        skinName: skinNames[n] ?? guessSkinName(read[n].picks, read[base].picks, slotSetup),
        picks: read[n].picks,
      })),
    });
  }
  const report = names.filter(n => !usable(n)).map(n => {
    const { code, ...params } = read[n].problem;
    return { animation: n, code, why: PROBLEM_TEXT[code](params), params };
  });
  return { groups, report };
}

// A working copy with skins as an array and a default skin present.
function workingCopy(sk) {
  const out = structuredClone(sk);
  if (!Array.isArray(out.skins)) out.skins = skinsOf(out);
  let def = defaultSkinOf(out.skins);
  if (!def) { def = { name: DEFAULT_SKIN, attachments: {} }; out.skins.unshift(def); }
  def.attachments ??= {};
  return { out, defaultAttachments: def.attachments };
}

// Build a skin's attachments for one variant's picks, relocated under the setup keys.
// Returns { attachments } or { problem }.
function buildSkinAttachments(picks, slotSetup, defaultAttachments) {
  const attachments = {};
  for (const [slot, picked] of Object.entries(picks)) {
    const setupName = slotSetup[slot];
    if (!setupName) return { problem: { code: 'no-setup-attachment', why: `slot "${slot}" has no setup attachment`, params: { slot } } };
    if (picked === setupName) continue; // this look already is the setup attachment here
    const source = defaultAttachments[slot]?.[picked];
    if (!source) {
      return { problem: { code: 'art-missing',
        why: `"${picked}" (slot ${slot}) is not in the default skin; new art is rig work, done in Spine`,
        params: { slot, attachment: picked } } };
    }
    const copy = structuredClone(source);
    copy.path ??= regionOf(source, picked); // relocated key: keep pointing at the real region
    attachments[slot] = { [setupName]: copy };
  }
  return { attachments };
}

// Add a skin, or with overwrite replace the existing entry in place. The legacy module
// pushed a second entry with the same name under overwriteSkins: the duplicate skin
// the Spine editor refuses.
function putSkin(out, name, attachments) {
  const existing = out.skins.find(s => s?.name === name);
  if (existing) existing.attachments = attachments;
  else out.skins.push({ name, attachments });
}

// Why a skin name cannot be (re)created, or null.
function skinNameProblem(name, skinNames, overwriteSkins) {
  if (!name) return { code: 'no-skin-name', why: 'no skinName given', params: {} };
  // Overwriting the default skin would replace the art every other skin falls back on.
  if (name === DEFAULT_SKIN) return { code: 'skin-is-default', why: 'the default skin cannot be a look variant', params: { skin: name } };
  if (skinNames.has(name) && !overwriteSkins) return { code: 'skin-exists', why: `a skin named "${name}" already exists`, params: { skin: name } };
  return null;
}

/**
 * Fold explicit look-variant groups into named skins plus one shared clip.
 * Groups are explicit, never inferred here (scan() only suggests). A group that fails any
 * check is skipped whole (no partial skin, no partial clip edit) and the reason reported.
 *
 * @param {object} sk parsed skeleton JSON; never mutated
 * @param {Array<{ base: string, animation?: string, variants: Array<{ animation: string, skinName: string }> }>} groups
 *   base: the clip that already shows the setup look (kept, becomes the shared clip);
 *   animation: name of the surviving clip, default the base's own name.
 * @param {{ allowMotionDrift?: boolean, overwriteSkins?: boolean }} [options]
 * @returns {{ skeleton: object, changed: boolean, report: object[], skipped: Array<{ base: string, code: string, why: string, params: object }> }}
 */
export function migrate(sk, groups, { allowMotionDrift = false, overwriteSkins = false } = {}) {
  assertSkeleton(sk);
  if (!Array.isArray(groups)) throw new StudioError('bad-argument', 'groups must be an array.', { groups: typeof groups });
  const { out, defaultAttachments } = workingCopy(sk);
  out.animations ??= {};
  const slotSetup = slotSetupOf(out);
  const skinNames = new Set(out.skins.map(s => s?.name));
  const report = [];
  const skipped = [];

  for (const group of groups) {
    const g = isObject(group) ? group : {};
    const bail = (code, why, params = {}) => skipped.push({ base: g.base, code, why, params });
    const baseAnim = out.animations[g.base];
    if (!baseAnim) { bail('base-missing', `base animation not found: ${g.base}`); continue; }
    if (!Array.isArray(g.variants) || !g.variants.length) { bail('no-variants', `empty variant list: ${g.base}`); continue; }

    // The base's attachment timelines are stripped too, so it must already show the setup
    // look for the whole clip. The legacy module never checked: a base with a blink lost
    // the blink, a base on another look silently turned into the setup look.
    const base = readClip(baseAnim, slotSetup, { checkHides: true });
    if (base.problem) {
      const { code, ...params } = base.problem;
      bail(code, `${g.base} (base): ${PROBLEM_TEXT[code](params)}`, { animation: g.base, ...params });
      continue;
    }
    const offSetup = Object.entries(base.picks).find(([slot, name]) => slotSetup[slot] !== name);
    if (offSetup) {
      bail('base-not-setup', `${g.base} (base): slot "${offSetup[0]}" shows "${offSetup[1]}", not its setup attachment; the shared clip would lose that look`,
        { animation: g.base, slot: offSetup[0], attachment: offSetup[1] });
      continue;
    }

    let ok = true;
    const built = [];
    const keepClip = new Set();    // motion drifted: skin yes, collapse no
    const discarded = new Set();   // motion drifted and collapsed anyway (allowMotionDrift)
    // Two variants in one group asking for the same skin name (one look spanning several
    // clips, "Gold_Open" and "Gold_Idle" both wanting "Gold") both passed the legacy check,
    // because the name was recorded only after the whole group validated, and the file
    // got two skins named "Gold": the duplicate the Spine editor refuses.
    const claimedInGroup = new Set();
    for (const v of g.variants) {
      const fail = (code, why, params = {}) => { bail(code, `${v?.animation}: ${why}`, { animation: v?.animation, ...params }); ok = false; };
      const anim = out.animations[v?.animation];
      if (!anim) { fail('animation-missing', 'animation not found'); break; }
      if (claimedInGroup.has(v.skinName)) { fail('skin-claimed-in-group', `another variant in this group already claims skin "${v.skinName}"`, { skin: v.skinName }); break; }
      const nameProblem = skinNameProblem(v.skinName, skinNames, overwriteSkins);
      if (nameProblem) { fail(nameProblem.code, nameProblem.why, nameProblem.params); break; }
      claimedInGroup.add(v.skinName);
      const clip = readClip(anim, slotSetup, { checkHides: true });
      if (clip.problem) { const { code, ...params } = clip.problem; fail(code, PROBLEM_TEXT[code](params), params); break; }
      if (!Object.keys(clip.picks).length) { fail('no-picks', 'no attachment picks at all; nothing to fold into a skin'); break; }
      // Building the skin and collapsing the clip are two jobs (a skin change must not
      // change the animation; it should stay one clip). The first
      // legacy version refused both when the motion drifted, so a few thousandths of
      // physics-curve drift cost the file its whole skin. A skin is built from the picks
      // alone; only discarding a clip needs the motions to match.
      if (!sameJson(stripAttachmentTimelines(anim), stripAttachmentTimelines(baseAnim))) {
        (allowMotionDrift ? discarded : keepClip).add(v.animation);
      }
      const skin = buildSkinAttachments(clip.picks, slotSetup, defaultAttachments);
      if (skin.problem) { fail(skin.problem.code, skin.problem.why, skin.problem.params); break; }
      built.push({ skinName: v.skinName, attachments: skin.attachments, animation: v.animation });
    }
    if (!ok) continue;

    const finalName = g.animation || g.base;
    const removed = new Set([g.base]);
    for (const v of g.variants) if (!keepClip.has(v.animation)) removed.add(v.animation);
    // The legacy module wrote the survivor over any clip already using that name: an
    // unrelated clip, or a drifted variant it had just reported as kept.
    if (Object.hasOwn(out.animations, finalName) && !removed.has(finalName)) {
      bail('name-taken', `the surviving clip name "${finalName}" is already used by a clip this group keeps`, { animation: finalName });
      continue;
    }

    for (const b of built) {
      putSkin(out, b.skinName, b.attachments);
      skinNames.add(b.skinName);
      report.push({ skin: b.skinName, from: b.animation, slots: Object.keys(b.attachments) });
    }
    const survivor = stripAttachmentTimelines(baseAnim);
    for (const n of removed) delete out.animations[n];
    out.animations[finalName] = survivor;
    report.push({ clip: finalName, collapsedFrom: [...removed] });
    // A kept clip is not a quiet success: its attachment timeline still overrides the
    // active skin, the half-migrated state the owner hit. Name it and the way out.
    for (const n of keepClip) {
      report.push({ clipKept: n, code: 'motion-drift',
        why: 'motion differs from the base, so the clip was not discarded; its attachment timeline still overrides the active skin. Re-run with allowMotionDrift to collapse it too (its own motion is then lost).' });
    }
    // The legacy tool promised to name these and never did.
    for (const n of discarded) {
      report.push({ motionDiscarded: n, code: 'motion-discarded',
        why: `motion differed from the base; collapsed under allowMotionDrift, so it now plays the base's motion` });
    }
  }

  return { skeleton: out, changed: report.length > 0, report, skipped };
}

/**
 * The other shape, and the common one in a shipped rig (a typical game chest): the attachment channel carries the LOOK and real show/hide TIMING (a key
 * with no name is a hide), and the timings differ per look, so the clips are not
 * duplicates and migrate() rightly refuses them. This lifts only the look into a skin and
 * leaves every clip, key and time where it was, rewriting the attachment names to the
 * slot's setup name so the active skin decides the colour. Nothing is discarded.
 *
 * @param {object} sk parsed skeleton JSON; never mutated
 * @param {Array<{ animation: string, skinName: string }>} variants
 * @param {{ overwriteSkins?: boolean }} [options]
 * @returns {{ skeleton: object, changed: boolean, report: object[], skipped: Array<{ animation: string, code: string, why: string, params: object }> }}
 */
export function splitLooks(sk, variants, { overwriteSkins = false } = {}) {
  assertSkeleton(sk);
  if (!Array.isArray(variants)) throw new StudioError('bad-argument', 'variants must be an array.', { variants: typeof variants });
  const { out, defaultAttachments } = workingCopy(sk);
  const slotSetup = slotSetupOf(out);
  const skinNames = new Set(out.skins.map(s => s?.name));
  const report = [];
  const skipped = [];

  for (const variant of variants) {
    const v = isObject(variant) ? variant : {};
    const bail = (code, why, params = {}) => skipped.push({ animation: v.animation, code, why, params });
    const anim = out.animations?.[v.animation];
    if (!anim) { bail('animation-missing', 'animation not found'); continue; }
    const nameProblem = skinNameProblem(v.skinName, skinNames, overwriteSkins);
    if (nameProblem) { bail(nameProblem.code, nameProblem.why, nameProblem.params); continue; }

    // One look per slot. Hide keys are timing and stay; several distinct names in one
    // slot mean the clip changes look mid-play, which is an in-clip swap.
    const clip = readClip(anim, slotSetup, { checkHides: false });
    if (clip.problem) { const { code, ...params } = clip.problem; bail(code, PROBLEM_TEXT[code](params), params); continue; }
    if (!Object.keys(clip.picks).length) { bail('no-picks', 'no attachment names at all; nothing to lift out'); continue; }
    const skin = buildSkinAttachments(clip.picks, slotSetup, defaultAttachments);
    if (skin.problem) { bail(skin.problem.code, skin.problem.why, skin.problem.params); continue; }

    // Rewrite the names only. Times, hide keys and key count are the owner's animation.
    for (const [slot, timelines] of Object.entries(anim.slots ?? {})) {
      if (!Array.isArray(timelines?.attachment) || !slotSetup[slot]) continue;
      for (const key of timelines.attachment) if (key?.name != null) key.name = slotSetup[slot];
    }

    if (Object.keys(skin.attachments).length) {
      putSkin(out, v.skinName, skin.attachments);
      skinNames.add(v.skinName);
      report.push({ skin: v.skinName, from: v.animation, slots: Object.keys(skin.attachments), clipKept: v.animation });
    } else {
      // Every pick already equals setup: this look is the default skin, and saying so
      // beats shipping an empty skin nobody can tell from a bug.
      report.push({ skin: null, from: v.animation, clipKept: v.animation, code: 'look-is-default',
        note: 'this look is the default skin itself; no new skin was needed' });
    }
  }

  return { skeleton: out, changed: report.length > 0, report, skipped };
}

/**
 * Re-derive, from the JSON alone, what each variant now shows and compare it with what
 * the original variant clip showed: for every picked slot, the attachment the surviving
 * clip plus the variant's skin resolves (skin entry first, then default, as the runtime
 * does) must have the same region and the same data. The runtime proof lives in the gate;
 * this is the pure check a write path can run without the runtime.
 * @returns {{ ok: boolean, problems: Array<{ skin: string, slot: string, code: string, why: string }> }}
 */
export function verify(before, after, groups) {
  assertSkeleton(before);
  assertSkeleton(after);
  const problems = [];
  const beforeDefault = defaultSkinOf(skinsOf(before))?.attachments ?? {};
  const afterSkins = Object.fromEntries(skinsOf(after).map(s => [s?.name, s?.attachments ?? {}]));
  const afterDefault = afterSkins[DEFAULT_SKIN] ?? {};
  const slotSetup = slotSetupOf(after);
  const withoutPath = a => { const c = structuredClone(a); delete c.path; return c; };

  for (const g of groups ?? []) {
    for (const v of g?.variants ?? []) {
      const original = before.animations?.[v.animation];
      if (!original) continue;
      const { picks } = readClip(original, slotSetupOf(before), { checkHides: false });
      const activeSkin = afterSkins[v.skinName] ?? {};
      for (const [slot, picked] of Object.entries(picks)) {
        const setupName = slotSetup[slot];
        const was = beforeDefault[slot]?.[picked];
        if (!was) continue; // migrate() refuses such a group
        const now = activeSkin[slot]?.[setupName] ?? afterDefault[slot]?.[setupName];
        if (!now) {
          problems.push({ skin: v.skinName, slot, code: 'attachment-lost', why: `not found after migration under "${setupName}"` });
          continue;
        }
        const wasRegion = regionOf(was, picked);
        const nowRegion = regionOf(now, setupName);
        if (wasRegion !== nowRegion) {
          problems.push({ skin: v.skinName, slot, code: 'region-changed', why: `visual region changed: ${wasRegion} -> ${nowRegion}` });
        } else if (!sameJson(withoutPath(was), withoutPath(now))) {
          problems.push({ skin: v.skinName, slot, code: 'data-changed', why: 'attachment data (mesh, uvs, colour) changed in the move' });
        }
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
