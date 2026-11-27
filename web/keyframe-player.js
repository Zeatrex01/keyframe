// The stage player on the studio's own engine: loads a skeleton (Spine 4.2 JSON or Keyframe),
// its atlas and pages, and plays it on a 2D canvas. No Spine code is loaded.
//
// It answers the small part of the official player's interface the stage uses (play, pause,
// paused, speed, setAnimation, animationState.getCurrent / apply / addListener, skeleton.data,
// dispose), so the stage drives it, or the official player when the Spine add-on is on, the
// same way. On top of that it plays a layer over the clip (`setLayer`) and crossfades between
// clips (`mix`), on the engine's mixer, with physics stepped every frame.

import { compileSkeleton, Pose, Mixer, collectDraws, clipFrames, parseAtlas, atlasRegions } from '/src/engine/index.js';
import { createCanvasRenderer, fitView } from '/src/engine/canvas.js';
import { toSkeletonJson, isKeyframeDocument } from '/src/engine/keyframe-format.js';

const loadImage = url => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Could not load ${url}`));
  image.src = url;
});

/** The player to use: the official one when the Spine add-on loaded it, else the studio's own. */
export const playerClass = () => (typeof globalThis.spine !== 'undefined' && globalThis.spine.SpinePlayer ? globalThis.spine.SpinePlayer : KeyframePlayer);

/** Load the official player script once, when the Spine add-on is on. Resolves either way. */
let spineScript = null;
export function loadSpineAddon() {
  if (spineScript) return spineScript;
  spineScript = new Promise(resolve => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/addons/spine/spine-player.min.css' });
    const js = Object.assign(document.createElement('script'), { src: '/addons/spine/spine-player.min.js' });
    js.onload = () => resolve(true);
    js.onerror = () => resolve(false);
    document.head.append(css, js);
  });
  return spineScript;
}

export class KeyframePlayer {
  /**
   * @param {HTMLElement} host
   * @param {{ skeleton: string, atlas: string, animation?: string, backgroundColor?: string, alpha?: boolean, [option: string]: any,
   *   success?: (p: KeyframePlayer) => void, error?: (p: KeyframePlayer, reason: string) => void }} config
   */
  constructor(host, config) {
    this.config = { ...config, viewport: {} };
    this.paused = true;
    this.speed = 1;
    this.disposed = false;
    this.entry = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'kf-canvas';
    this.canvas.style.cssText = 'width:100%;height:100%;display:block';
    host.append(this.canvas);
    this.renderer = createCanvasRenderer({ makeCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) });
    const player = this;
    this.listeners = [];
    this.animationState = {
      data: { defaultMix: 0 },
      getCurrent: track => (track ? player.mixer?.current(track) ?? null : player.entry),
      apply: () => { player.dirty = true; },
      addListener: listener => { player.listeners.push(listener); },
    };
    /** Seconds a new clip crossfades from the one before (0 cuts). */
    this.mix = 0;
    this.load().catch(err => { if (!this.disposed) config.error?.(this, String(err?.message ?? err)); });
  }

  async load() {
    const { skeleton, atlas } = this.config;
    const [json, atlasText] = await Promise.all([
      fetch(skeleton).then(r => { if (!r.ok) throw new Error(`${skeleton}: HTTP ${r.status}`); return r.json(); }),
      fetch(atlas).then(r => { if (!r.ok) throw new Error(`${atlas}: HTTP ${r.status}`); return r.text(); }),
    ]);
    const model = compileSkeleton(isKeyframeDocument(json) ? toSkeletonJson(json) : json);
    const parsed = parseAtlas(atlasText);
    const base = new URL(atlas, location.href);
    /** @type {Map<string, any>} */
    const pages = new Map(await Promise.all(parsed.pages.map(async p => /** @type {[string, any]} */ ([p.name, await loadImage(new URL(p.name, base).href)]))));
    if (this.disposed) return;
    this.model = model;
    this.regions = atlasRegions(parsed);
    this.pages = pages;
    this.pose = new Pose(model);
    this.mixer = new Mixer(model, { pose: this.pose });
    this.mixer.addListener({ complete: ({ track, entry }) => { if (track === 0) for (const l of this.listeners) l.complete?.(entry); } });
    // The framing of each clip: the setup pose and everything the clip draws, sampled densely enough
    // (30 a second, at most 60 per clip) that a swing at its extreme is not cut off between samples.
    // `x/y/width/height` stay the union of all clips, for callers that frame the whole rig once.
    const { all: box, clips: frames } = clipFrames(model, this.regions);
    const data = { x: box?.x ?? 0, y: box?.y ?? 0, width: box?.width ?? 0, height: box?.height ?? 0,
      frameOf: name => frames.get(name) ?? box, findAnimation: name => model.animations.get(name) ?? null, animations: [...model.animations.values()] };
    this.skeleton = { data, updateWorldTransform: () => { this.dirty = true; } };
    const first = this.config.animation && model.animations.has(this.config.animation) ? this.config.animation : model.animations.keys().next().value;
    if (first) this.setAnimation(first, true);
    this.last = performance.now();
    const tick = now => {
      if (this.disposed) return;
      const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000)); // a frame stamp can precede the start
      this.last = now;
      // A clip completes each time it reaches its end (every lap when it loops), as in Spine.
      if (this.entry && !this.paused) this.mixer.update(dt * this.speed);
      this.draw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.config.success?.(this);
  }

  drawsAt(animation, time) {
    this.pose.apply(animation, time).updateWorld();
    return collectDraws(this.pose, this.regions).draws;
  }

  setAnimation(name, loop = true) {
    const animation = this.model?.animations.get(name);
    if (!animation) return null;
    this.entry = this.mixer.setAnimation(0, name, { loop, mix: this.entry ? this.mix : 0 });
    this.dirty = true;
    return this.entry;
  }

  /** Play `name` over the clip (track 1), fading in; null fades the layer out. */
  setLayer(name, { mix = 0.2, alpha = 1 } = {}) {
    if (!this.model) return null;
    if (!name || !this.model.animations.has(name)) { this.mixer.clearTrack(1, { mix }); return null; }
    return this.mixer.setAnimation(1, name, { loop: true, mix, alpha });
  }

  play() { this.paused = false; }
  pause() { this.paused = true; }

  draw() {
    const canvas = this.canvas;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * ratio)), h = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // With alpha the canvas is clear and the page behind it (the stage's own colour) shows through.
    if (this.config.alpha) ctx.clearRect(0, 0, w, h);
    else { ctx.fillStyle = this.config.backgroundColor ?? '#100E17'; ctx.fillRect(0, 0, w, h); }
    // A skeleton with no clip yet (a rig just drawn) shows its setup pose.
    let draws;
    if (this.entry) draws = collectDraws(this.mixer.apply(), this.regions).draws;
    else draws = collectDraws(this.pose.updateWorld(), this.regions).draws;
    const vp = this.config.viewport;
    const box = vp && vp.width > 0 ? vp : this.skeleton.data;
    this.renderer.render(ctx, draws, page => this.pages.get(page), fitView(box, w, h));
  }

  dispose() {
    this.disposed = true;
    this.canvas.remove();
  }
}
