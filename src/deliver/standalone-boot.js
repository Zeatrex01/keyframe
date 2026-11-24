// The standalone player's page code. It is serialized into the HTML file with
// Function.prototype.toString, so it must not use anything from this module's scope: it gets the
// bundled engine's `require` and the data written into the page, and nothing else.

/* eslint-disable no-undef */
/**
 * @param {(id: string) => any} load
 * @param {{ skeleton: any, atlasText: string, images: Record<string, string>, animation: string|null, background: string }} data
 */
export function bootStandalone(load, data) {
  const engine = load('engine/index.js');
  const { createCanvasRenderer, fitView } = load('engine/canvas.js');
  const { toSkeletonJson, isKeyframeDocument } = load('engine/keyframe-format.js');
  const canvas = document.querySelector('canvas');
  const select = document.querySelector('select');
  const playButton = document.querySelector('[data-act="play"]');
  const loopButton = document.querySelector('[data-act="loop"]');
  const speedSelect = /** @type {HTMLSelectElement} */ (document.querySelector('[data-act="speed"]'));
  const timeLabel = document.querySelector('.time');
  const fail = message => { document.body.textContent = ''; const p = document.createElement('p'); p.className = 'error'; p.textContent = message; document.body.append(p); };

  const loadImage = src => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('An atlas page could not be decoded.'));
    image.src = src;
  });

  async function start() {
    const model = engine.compileSkeleton(isKeyframeDocument(data.skeleton) ? toSkeletonJson(data.skeleton) : data.skeleton);
    const atlas = engine.parseAtlas(data.atlasText);
    const regions = engine.atlasRegions(atlas);
    const pages = new Map();
    for (const page of atlas.pages) {
      if (!data.images[page.name]) throw new Error(`The atlas page ${page.name} is not in this file.`);
      pages.set(page.name, await loadImage(data.images[page.name]));
    }
    const renderer = createCanvasRenderer({ makeCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) });
    const pose = new engine.Pose(model);
    const drawsAt = (animation, time) => {
      if (animation) pose.apply(animation, time);
      return engine.collectDraws(pose.updateWorld(), regions).draws;
    };
    const animations = [...model.animations.values()];
    const lists = [];
    for (const a of animations) for (let i = 0; i <= 8; i++) lists.push(drawsAt(a, a.duration * i / 8));
    if (!lists.length) lists.push(drawsAt(null, 0));
    const box = engine.boundsOf(lists) ?? { x: -100, y: -100, width: 200, height: 200 };

    for (const a of animations) select.append(new Option(a.name, a.name));
    let current = animations.find(a => a.name === data.animation) ?? animations[0] ?? null;
    if (current) select.value = current.name;
    if (!animations.length) select.hidden = true;
    let time = 0, paused = false, loop = true, speed = 1, last = performance.now();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { paused = true; playButton.textContent = 'Play'; }

    select.addEventListener('change', () => { current = model.animations.get(select.value) ?? current; time = 0; });
    playButton.addEventListener('click', () => { paused = !paused; playButton.textContent = paused ? 'Play' : 'Pause'; if (!paused && current && !loop && time >= current.duration) time = 0; });
    loopButton.addEventListener('click', () => { loop = !loop; loopButton.setAttribute('aria-pressed', String(loop)); });
    speedSelect.addEventListener('change', () => { speed = Number(speedSelect.value) || 1; });

    const frame = now => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (current && !paused) time += dt * speed;
      const d = current?.duration ?? 0;
      const t = d > 0 ? (loop ? time % d : Math.min(time, d)) : 0;
      const ratio = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio)), h = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = data.background;
      ctx.fillRect(0, 0, w, h);
      renderer.render(ctx, drawsAt(current, t), page => pages.get(page), fitView(box, w, h));
      timeLabel.textContent = current ? `${t.toFixed(2)} / ${d.toFixed(2)} s` : '';
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  start().catch(err => fail(`This animation could not be played: ${err?.message ?? err}`));
}
