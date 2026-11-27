// Tracks, layers and crossfades on the Keyframe engine: what a game needs to punch while it runs
// and to change clips without a pop.
//
//   track 0   the base clip (idle, run, jump), over the setup pose
//   track 1+  layers laid over the tracks below: what a layer keys wins by its `alpha`, what it
//             does not key is left to the tracks below (an upper-body punch over a run); an
//             additive layer (`add`) adds its offsets from the setup pose instead (a breath, a
//             recoil on top of whatever plays)
//
// Changing the clip on a track crossfades from the clip it had over `mix` seconds: both play,
// and the pose moves linearly from the old one to the new one, the parts only the old one keyed
// going back to what is beneath. Clearing a track fades it out the same way. Physics steps once
// per frame on the mixed pose, so hair and capes follow a crossfade too.
//
// The same entry names and the same meaning as Spine's AnimationState where they overlap
// (setAnimation, addAnimation, clearTrack, mix, alpha, loop, complete and event listeners), so a
// game written against one reads the other. Written from that documented behaviour, not from any
// runtime's code. Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { Pose } from './pose.js';

export const DEFAULT_MIX = 0.2;
export const MAX_TRACKS = 16;

const checkTrack = track => {
  if (!(Number.isInteger(track) && track >= 0 && track < MAX_TRACKS)) throw new StudioError('bad-argument', `A track is a whole number from 0 to ${MAX_TRACKS - 1}.`, { track });
};

export class Mixer {
  /**
   * @param {ReturnType<import('./model.js').compileSkeleton>} model
   * @param {{ skin?: string, defaultMix?: number, pose?: Pose }} [options]
   */
  constructor(model, { skin, defaultMix = DEFAULT_MIX, pose } = {}) {
    this.model = model;
    this.pose = pose ?? new Pose(model, { skin });
    this.defaultMix = defaultMix;
    /** @type {Array<any>} */
    this.tracks = [];
    this.listeners = [];
    this.delta = 0;
    this.started = false;
    this.setupState = this.pose.captureState();
  }

  /** Listen for `start`, `complete`, `end` and `event` ({ track, entry, event? }). */
  addListener(listener) { this.listeners.push(listener); return listener; }
  removeListener(listener) { this.listeners = this.listeners.filter(l => l !== listener); }
  emit(kind, payload) { for (const l of this.listeners) l[kind]?.(payload); }

  animation(name) {
    const animation = this.model.animations.get(name);
    if (!animation) throw new StudioError('unknown-animation', `No animation named "${name}".`, { animation: name, available: [...this.model.animations.keys()] });
    return animation;
  }

  /**
   * @param {number} track @param {string|null} name
   * @param {{ loop?: boolean, mix?: number, alpha?: number, add?: boolean, speed?: number }} [options]
   */
  entryFor(track, name, { loop = true, mix, alpha = 1, add = false, speed = 1 } = {}) {
    const animation = name === null ? null : this.animation(name);
    return { track, name, animation, loop: !!loop, alpha: Math.min(1, Math.max(0, alpha)), add: !!add, speed,
      time: 0, lastTime: null, mixTime: 0, mixDuration: Math.max(0, mix ?? this.defaultMix), from: null, next: null, delay: 0,
      // Spine's name for it, for code written against an AnimationState.
      get trackTime() { return this.time; }, set trackTime(v) { this.time = v; this.lastTime = null; } };
  }

  /**
   * Play `name` on `track` now. What the track played crossfades out over `mix` seconds (the
   * mixer's default when left out; 0 cuts). On an empty track a layer fades in over `mix`.
   * @returns {any} the entry: { name, time, loop, alpha, add, speed, mixDuration }
   */
  setAnimation(track, name, options = {}) {
    checkTrack(track);
    const entry = this.entryFor(track, name, options);
    const current = this.tracks[track];
    if (current) {
      entry.from = current.from && current.mixTime < current.mixDuration * 0.5 && entry.mixDuration > 0 ? current.from : current;
      if (entry.from === current.from) this.emit('end', { track, entry: current });
      current.next = null;
    } else if (track > 0 && entry.mixDuration > 0) {
      entry.from = this.entryFor(track, null, { mix: 0 });
    }
    if (!(entry.mixDuration > 0)) { if (entry.from?.animation) this.emit('end', { track, entry: entry.from }); entry.from = null; }
    this.tracks[track] = entry;
    this.emit('start', { track, entry });
    return entry;
  }

  /**
   * Queue `name` on `track` to start when what plays there completes (a clip that plays once at its
   * end, a loop at the end of its lap), `delay` seconds later, crossfading over `mix`.
   */
  addAnimation(track, name, { delay = 0, ...options } = {}) {
    checkTrack(track);
    const current = this.tracks[track];
    if (!current) return this.setAnimation(track, name, options);
    let last = current;
    while (last.next) last = last.next;
    const entry = this.entryFor(track, name, options);
    entry.delay = Math.max(0, delay);
    last.next = entry;
    return entry;
  }

  /**
   * Fade what plays on `track` out over `mix` seconds (0 stops it at once).
   * @param {number} track @param {{ mix?: number }} [options]
   */
  clearTrack(track, { mix } = {}) {
    checkTrack(track);
    const current = this.tracks[track];
    if (!current) return;
    if (!(Math.max(0, mix ?? this.defaultMix) > 0)) { this.tracks[track] = undefined; this.emit('end', { track, entry: current }); return; }
    const empty = this.entryFor(track, null, { mix });
    empty.from = current;
    empty.clearing = true;
    this.tracks[track] = empty;
  }

  /** What plays on a track, or null. */
  current(track) { const e = this.tracks[track]; return e && e.animation ? e : null; }

  /** Move every track `dt` seconds on: clip times, crossfades, queued clips, events and completions. */
  update(dt) {
    if (!(dt >= 0)) throw new StudioError('bad-argument', 'A mixer steps forward by zero or more seconds.', { dt });
    this.delta += dt;
    this.tracks.forEach((entry, track) => {
      if (!entry) return;
      this.advance(entry, dt, track);
      if (entry.from) {
        entry.mixTime += dt;
        if (entry.mixTime >= entry.mixDuration) {
          if (entry.from.animation) this.emit('end', { track, entry: entry.from });
          entry.from = null;
          if (entry.clearing) { this.tracks[track] = undefined; return; }
        }
      }
      const next = entry.next;
      if (next && entry.animation) {
        const d = entry.animation.duration;
        const now = entry.time - next.delay, before = (entry.lastTime ?? 0) - next.delay;
        const due = entry.loop && d > 0 ? now > 0 && Math.floor(now / d) > Math.floor(Math.max(0, before) / d) : now >= d - 1e-9;
        if (due) {
          const options = { loop: next.loop, mix: next.mixDuration, alpha: next.alpha, add: next.add, speed: next.speed };
          const started = this.setAnimation(track, next.name, options);
          started.next = next.next;
        }
      }
    });
    return this;
  }

  advance(entry, dt, track) {
    if (entry.from) this.advance(entry.from, dt, track);
    if (!entry.animation) return;
    const before = entry.time;
    entry.lastTime = before;
    entry.time = before + dt * entry.speed;
    const animation = entry.animation, d = animation.duration;
    const span = d > 0 && entry.loop ? [before, entry.time] : [Math.min(before, d), Math.min(entry.time, d)];
    for (const event of eventsIn(animation, span[0], span[1], entry.loop, before === 0 && !entry.fired)) this.emit('event', { track, entry, event });
    entry.fired = true;
    if (d > 0 && entry.loop ? Math.floor(entry.time / d) > Math.floor(before / d) : before < d && entry.time >= d) this.emit('complete', { track, entry });
  }

  /** Pose the skeleton for the current instant: every track mixed in order, then the world and physics. */
  apply() {
    const pose = this.pose;
    pose.setupPose();
    for (const entry of this.tracks) if (entry) this.applyTrack(entry);
    pose.updateWorld({ physics: this.started ? 'update' : 'reset', delta: this.delta });
    this.started = true;
    this.delta = 0;
    return pose;
  }

  /** `update(dt)` then `apply()`. */
  step(dt) { this.update(dt); return this.apply(); }

  applyTrack(entry) {
    const pose = this.pose;
    const plain = !entry.from && entry.alpha >= 1 && !entry.add;
    if (plain) { this.applyOne(entry); return; }
    const below = pose.captureState();
    if (entry.add) {
      pose.restoreState(this.setupState);
      this.applyOne(entry);
      const offset = pose.captureState();
      const ramp = entry.from && entry.mixDuration > 0 ? Math.min(1, entry.mixTime / entry.mixDuration) : 1;
      pose.blendStates(below, offset, entry.alpha * ramp, { add: this.setupState });
      return;
    }
    this.applyMixed(entry, below);
    if (entry.alpha < 1) pose.blendStates(below, pose.captureState(), entry.alpha);
  }

  /** The entry over `below`, crossfading from what it replaced. Leaves the result in the pose. */
  applyMixed(entry, below) {
    const pose = this.pose;
    if (!entry.from || !(entry.mixDuration > 0)) { pose.restoreState(below); this.applyOne(entry); return; }
    this.applyMixed(entry.from, below);
    const from = pose.captureState();
    pose.restoreState(below);
    this.applyOne(entry);
    const to = pose.captureState();
    pose.blendStates(from, to, Math.min(1, entry.mixTime / entry.mixDuration));
  }

  applyOne(entry) {
    if (!entry.animation) return;
    const d = entry.animation.duration;
    const time = entry.loop || !(d > 0) ? entry.time : Math.min(entry.time, d);
    this.pose.apply(entry.animation, Math.fround(time), { loop: entry.loop, fromSetup: false, lastTime: entry.lastTime === null ? null : Math.fround(entry.loop ? entry.lastTime : Math.min(entry.lastTime, d)) });
  }
}

/** Events a clip passes between two of its times, with laps when it loops; `first` includes one at 0. */
function eventsIn(animation, from, to, loop, first) {
  const out = [];
  const timeline = animation.timelines.find(t => t.kind === 'event');
  if (!timeline || to <= from && !first) return out;
  const d = animation.duration;
  const lo = first ? -1e-9 : from;
  if (!loop || !(d > 0)) {
    for (const e of timeline.events) if (e.time > lo && e.time <= to) out.push(e);
    return out;
  }
  for (let lap = Math.floor(Math.max(0, from) / d); lap * d <= to; lap++) {
    for (const e of timeline.events) {
      const t = lap * d + e.time;
      if (t > lo && t <= to) out.push(e);
    }
  }
  return out;
}

/**
 * A planned mix played from 0 on the fixed 1/60 grid, for frames and checks: the base clip on
 * track 0, `then` crossfading into another clip at a time, and `layers` started over it at their
 * own times. Posing at an instant gives what a player shows there after playing from the start;
 * instants between grid steps are posed at the step before. Going back replays from 0.
 *
 * @param {ReturnType<import('./model.js').compileSkeleton>} model
 * @param {{ animation: string, loop?: boolean, skin?: string,
 *   then?: { animation: string, at: number, mix?: number, loop?: boolean },
 *   layers?: Array<{ animation: string, at?: number, alpha?: number, add?: boolean, loop?: boolean, mix?: number }> }} plan
 */
export class MixPlayhead {
  constructor(model, plan) {
    this.model = model;
    this.plan = plan;
    const check = name => { if (!model.animations.has(name)) throw new StudioError('unknown-animation', `No animation named "${name}".`, { animation: name, available: [...model.animations.keys()] }); };
    check(plan.animation);
    if (plan.then) check(plan.then.animation);
    for (const l of plan.layers ?? []) check(l.animation);
    if ((plan.layers?.length ?? 0) > MAX_TRACKS - 1) throw new StudioError('bad-argument', `At most ${MAX_TRACKS - 1} layers.`);
    this.restart();
  }

  restart() {
    const { model, plan } = this;
    this.mixer = new Mixer(model, { skin: plan.skin });
    this.step = -1;
    this.actions = [
      { at: 0, run: m => m.setAnimation(0, plan.animation, { loop: plan.loop ?? true, mix: 0 }) },
      ...(plan.then ? [{ at: Math.max(0, plan.then.at), run: m => m.setAnimation(0, plan.then.animation, { loop: plan.then.loop ?? true, mix: plan.then.mix ?? DEFAULT_MIX }) }] : []),
      ...(plan.layers ?? []).map((l, i) => ({ at: Math.max(0, l.at ?? 0), run: m => m.setAnimation(i + 1, l.animation, { loop: l.loop ?? false, alpha: l.alpha ?? 1, add: !!l.add, mix: l.mix ?? 0 }) })),
    ].sort((a, b) => a.at - b.at);
  }

  /** The pose at `time` seconds (on the 1/60 grid), world transforms and physics updated. */
  at(time) {
    if (!(time >= 0) || time > 600) throw new StudioError('bad-argument', 'Sample times must be numbers between 0 and 600 s.', { time });
    const n = Math.floor(time * 60 + 1e-6);
    if (n < this.step) this.restart();
    for (let k = this.step + 1; k <= n; k++) {
      const t = k / 60;
      if (k > 0) this.mixer.update(1 / 60);
      for (const a of this.actions) if (!a.done && a.at <= t + 1e-9) { a.run(this.mixer); a.done = true; }
      this.mixer.apply();
    }
    this.step = Math.max(this.step, n);
    return this.mixer.pose;
  }
}
