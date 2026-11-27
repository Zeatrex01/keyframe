// The embeddable web player's runtime: a KeyframePlayer class and a <keyframe-player> element for
// web games and pages. It is serialized into keyframe-player.js with Function.prototype.toString,
// so it must not use anything from this module's scope: it gets the bundled engine's `require`.
//
//   <script src="keyframe-player.js"></script>
//   <keyframe-player src="ui.json" animation="press" loop></keyframe-player>
//
//   const player = await KeyframePlayer.create(canvas, { skeleton: 'ui.json', animation: 'idle' });
//   player.play('press', { loop: false });  player.on('complete', name => ...);
//   player.play('run', { mix: 0.2 });        // crossfade from the clip before
//   player.layer('punch_upper', { loop: false });  player.clearLayer();   // punch while running
//   player.setLook('play', 'play_pressed');  player.stop();

/* eslint-disable no-undef */
/** @param {(id: string) => any} load */
export function defineKeyframePlayer(load) {
  const engine = load('engine/index.js');
  const { createCanvasRenderer, fitView } = load('engine/canvas.js');
  const { toSkeletonJson, isKeyframeDocument } = load('engine/keyframe-format.js');
  const loadImage = src => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`The atlas page ${src} could not be loaded.`));
    image.src = src;
  });
  const resolveUrl = (url, base) => new URL(url, base ?? document.baseURI).href;

  class KeyframePlayer {
    /**
     * Load a skeleton (URL or object) with its atlas and pages, and draw it on a canvas.
     * @param {HTMLCanvasElement} canvas
     * @param {{ skeleton: string | object, atlas?: string, atlasText?: string, images?: Record<string, string>, animation?: string,
     *   loop?: boolean, speed?: number, autoplay?: boolean, background?: string | null, fit?: 'all' | 'setup', mix?: number }} options  mix: default crossfade seconds for play (0)
     */
    static async create(canvas, options) {
      const skeletonUrl = typeof options.skeleton === 'string' ? resolveUrl(options.skeleton) : null;
      const json = skeletonUrl ? await (await fetch(skeletonUrl)).json() : options.skeleton;
      const atlasUrl = options.atlas ? resolveUrl(options.atlas) : skeletonUrl ? skeletonUrl.replace(/(_v\d+)?\.json(\?.*)?$/i, '.atlas') : null;
      const atlasText = options.atlasText ?? (atlasUrl ? await (await fetch(atlasUrl)).text() : null);
      if (typeof atlasText !== 'string') throw new Error('KeyframePlayer needs the atlas (atlas or atlasText).');
      const atlas = engine.parseAtlas(atlasText);
      const pages = new Map();
      for (const page of atlas.pages) pages.set(page.name, await loadImage(options.images?.[page.name] ?? resolveUrl(page.name, atlasUrl ?? undefined)));
      return new KeyframePlayer(canvas, json, atlas, pages, options);
    }

    constructor(canvas, json, atlas, pages, options = {}) {
      this.canvas = canvas;
      // A canvas with no CSS size is laid out at its width and height attributes, so drawing it at
      // the device pixel ratio would grow it on every frame. Keep that size as its CSS size.
      if (!canvas.style.width && !canvas.style.height && canvas.clientWidth === canvas.width && canvas.clientHeight === canvas.height && canvas.width > 0) {
        canvas.style.width = `${canvas.width}px`; canvas.style.height = `${canvas.height}px`;
      }
      this.json = isKeyframeDocument(json) ? toSkeletonJson(json) : json;
      this.model = engine.compileSkeleton(this.json);
      this.regions = engine.atlasRegions(atlas);
      this.pages = pages;
      this.pose = new engine.Pose(this.model);
      this.renderer = createCanvasRenderer({ makeCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) });
      this.background = options.background ?? null;
      this.speed = options.speed ?? 1;
      this.mix = Math.max(0, options.mix ?? 0);
      this.looks = new Map();
      this.listeners = new Map();
      this.loop = options.loop ?? true; this.paused = !(options.autoplay ?? true);
      // Tracks, layers and crossfades: the engine's mixer. Track 0 is the clip `play` plays.
      this.mixer = new engine.Mixer(this.model, { pose: this.pose, defaultMix: this.mix });
      this.mixer.addListener({
        complete: ({ track, entry }) => {
          if (track !== 0) return;
          if (entry.loop) this.emit('loop', entry.name);
          else { this.paused = true; this.emit('complete', entry.name); }
        },
        event: ({ event: e }) => this.emit('event', e.name, { ...(this.json.events?.[e.name] ?? {}), ...e }),
      });
      const lists = [];
      for (const a of this.model.animations.values()) for (let i = 0; i <= 8; i++) lists.push(this.drawsAt(a, a.duration * i / 8));
      lists.push(this.drawsAt(null, 0));
      this.box = engine.boundsOf(options.fit === 'setup' ? [this.drawsAt(null, 0)] : lists) ?? { x: -100, y: -100, width: 200, height: 200 };
      if (options.animation) this.play(options.animation, { loop: this.loop, mix: 0 });
      else if (this.model.animations.size && options.autoplay !== false) this.play([...this.model.animations.keys()][0], { loop: this.loop, mix: 0 });
      this.last = performance.now();
      this.frame = this.frame.bind(this);
      this.raf = requestAnimationFrame(this.frame);
    }

    /** The clip names. */
    get animations() { return [...this.model.animations.keys()]; }
    /** The clip `play` plays, or null. */
    get current() { return this.mixer.current(0)?.animation ?? null; }
    /** Seconds into it. */
    get time() { return this.mixer.current(0)?.time ?? 0; }
    /** The current clip's length in seconds (0 with none). */
    get duration() { return this.current?.duration ?? 0; }

    clip(name) {
      const clip = this.model.animations.get(name);
      if (!clip) throw new Error(`No animation "${name}". Clips: ${this.animations.join(', ')}`);
      return clip;
    }
    /** Play a clip from its start; `mix` seconds crossfade from the clip before (the player's `mix` option when left out). */
    play(name, { loop = this.loop, mix = this.mix } = {}) {
      this.clip(name);
      this.loop = loop; this.paused = false;
      this.mixer.setAnimation(0, name, { loop, mix });
      this.emit('start', name);
      return this;
    }
    /**
     * Lay a clip over the one playing, on track 1 or higher: what it keys wins by `alpha` (an
     * upper-body punch over a run), what it leaves alone keeps playing; `add` adds its offsets
     * instead (a breath on top). It fades in over `mix` seconds.
     */
    layer(name, { track = 1, loop = true, alpha = 1, add = false, mix = 0.2 } = {}) {
      this.clip(name);
      if (!(track >= 1)) throw new Error('A layer goes on track 1 or higher; track 0 is play().');
      this.mixer.setAnimation(track, name, { loop, alpha, add, mix });
      return this;
    }
    /** Fade a layer out over `mix` seconds. */
    clearLayer(track = 1, { mix = 0.2 } = {}) { this.mixer.clearTrack(track, { mix }); return this; }
    /** Stop and show the setup pose. */
    stop() { for (let i = 0; i < this.mixer.tracks.length; i++) this.mixer.clearTrack(i, { mix: 0 }); this.paused = true; this.render(); return this; }
    pause() { this.paused = true; return this; }
    resume() { this.paused = false; return this; }
    /** Jump to a time in the current clip (seconds). */
    seek(seconds) { const e = this.mixer.current(0); if (e) { e.time = Math.max(0, seconds); e.lastTime = null; } this.render(); return this; }
    setSpeed(speed) { this.speed = Math.max(0, Number(speed) || 0); return this; }
    /** Show another look of a slot (a drawn state such as play_pressed), or null to let clips decide again. */
    setLook(slot, attachment) { if (attachment === null || attachment === undefined) this.looks.delete(slot); else this.looks.set(slot, attachment); this.render(); return this; }
    /** Listen: 'start', 'complete' (a clip that does not loop ended), 'loop', 'event' (name, data). Returns a function that stops listening. */
    on(type, fn) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); return () => set.delete(fn); }
    emit(type, ...args) { for (const fn of this.listeners.get(type) ?? []) { try { fn(...args); } catch (err) { setTimeout(() => { throw err; }); } } }
    destroy() { cancelAnimationFrame(this.raf); this.listeners.clear(); }

    /** One clip at one instant (for framing), or with no clip what the mixer holds now. */
    drawsAt(clip, time) {
      if (clip) this.pose.apply(clip, time).updateWorld();
      else if (this.mixer) this.mixer.apply();
      else this.pose.setupPose(), this.pose.updateWorld();
      for (const [slotName, att] of this.looks ?? []) {
        const s = this.pose.slots.find(x => x.data.name === slotName);
        if (s) this.pose.setAttachment(s, att);
      }
      return engine.collectDraws(this.pose, this.regions).draws;
    }

    frame(now) {
      const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000)); // a frame stamp can precede the start
      this.last = now;
      if (!this.paused) this.mixer.update(dt * this.speed);
      this.render();
      this.raf = requestAnimationFrame(this.frame);
    }

    render() {
      const canvas = this.canvas, ratio = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio)), h = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (this.background) { ctx.fillStyle = this.background; ctx.fillRect(0, 0, w, h); } else ctx.clearRect(0, 0, w, h);
      this.renderer.render(ctx, this.drawsAt(null, 0), page => this.pages.get(page), fitView(this.box, w, h));
    }
  }

  // <keyframe-player src="ui.json" animation="idle" loop speed="1" atlas="ui.atlas"></keyframe-player>
  if (typeof customElements !== 'undefined' && !customElements.get('keyframe-player')) {
    customElements.define('keyframe-player', class extends HTMLElement {
      async connectedCallback() {
        if (this.player) return;
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%';
        if (!this.style.display) this.style.display = 'block';
        this.append(canvas);
        try {
          this.player = await KeyframePlayer.create(canvas, {
            skeleton: this.getAttribute('src'), atlas: this.getAttribute('atlas') ?? undefined,
            animation: this.getAttribute('animation') ?? undefined, loop: this.hasAttribute('loop'),
            speed: Number(this.getAttribute('speed') ?? 1), background: this.getAttribute('background'),
          });
          this.dispatchEvent(new CustomEvent('ready', { detail: this.player }));
        } catch (err) { this.dispatchEvent(new CustomEvent('error', { detail: err })); }
      }
      disconnectedCallback() { this.player?.destroy(); this.player = null; }
    });
  }
  return KeyframePlayer;
}
