// The scroll camera.
//
// The page is a column of .stop sections (the text). Behind them, a sticky .camera shows
// the .world layer: the vertical panorama, one .art panel per stop. As the reader scrolls
// through a stop, its camera animation (see stops.js) is scrubbed from 0% to 100%.
//
// A stop whose .art holds a <video data-src> is a stretch of the pre-rendered walk: the
// camera holds still on that panel and scrolling scrubs the video from start to end.
// In the last stop, elements marked data-video-at="<seconds>" time the video instead: it
// reaches that second as the element's middle reaches the middle of the screen, and its
// last frame at the bottom of the page.

import { STOPS } from './stops.js';

const DURATION = 1000; // animations are scrubbed, so this is just the unit for currentTime
const MOVE_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Default: stay put at this stop, then use the last screen height to glide to the next one.
function defaultMove({ at, next }, length) {
  const hold = length > 1 ? (length - 1) / length : 0;
  return [
    { transform: `translate3d(0, ${-at}px, 0)`, offset: 0 },
    { transform: `translate3d(0, ${-at}px, 0)`, offset: hold, easing: MOVE_EASING },
    { transform: `translate3d(0, ${-next}px, 0)`, offset: 1 },
  ];
}

// Video stops: the video does the moving, so the camera stays on this panel throughout.
function holdStill({ at }) {
  return [
    { transform: `translate3d(0, ${-at}px, 0)` },
    { transform: `translate3d(0, ${-at}px, 0)` },
  ];
}

// Turn a stop's `camera` setting into a list of { target, keyframes, easing } tracks.
function tracksFor(stop) {
  const { camera } = stop;
  if (!camera && stop.video) return [{ keyframes: holdStill }];
  if (!camera) return [{ keyframes: (geo) => defaultMove(geo, stop.length) }];
  if (Array.isArray(camera) && camera.length && 'keyframes' in camera[0]) return camera;
  return [{ keyframes: camera }];
}

// Load a video for scrubbing. Fetching it as a blob makes every frame seekable even on
// servers that don't answer range requests (which would pin every seek to frame 0).
// Where fetch can't reach the file, fall back to the plain URL.
function loadVideo(video) {
  if (video.dataset.loading) return;
  video.dataset.loading = 'true';
  const src = video.dataset.src;
  const useUrl = (url) => { video.src = url; video.load(); };
  fetch(src)
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(res.status))))
    .then((blob) => useUrl(URL.createObjectURL(blob)))
    .catch(() => useUrl(src));

  // Reveal the video over its poster still once it has actually painted a frame.
  const reveal = () => video.classList.add('is-ready');
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(reveal);
  else video.addEventListener('loadeddata', reveal, { once: true });
}

// Returns scrub(p), which shows the frame at fraction p of the video. A new seek is
// only issued once the previous one has finished, so fast scrolling can't pile up
// seeks and freeze the decoder (phones especially).
function scrubber(video) {
  let want = 0;
  let seeking = false;
  const seek = () => {
    if (!video.duration) return;
    const t = want * Math.max(0, video.duration - 0.05);
    if (Math.abs(video.currentTime - t) < 0.01) return;
    seeking = true;
    video.currentTime = t;
  };
  video.addEventListener('seeked', () => { seeking = false; seek(); });
  video.addEventListener('loadedmetadata', seek);
  return (p) => {
    want = p;
    if (!seeking) seek();
  };
}

// Video time for scroll position y: 0 at the stop's start, then each mark's time at its
// scroll position, then `end` at `bottom`, moving in a straight line between them.
function timeAt(y, points) {
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    if (y < b.y) return a.t + (b.t - a.t) * clamp01((y - a.y) / Math.max(1, b.y - a.y));
  }
  return points[points.length - 1].t;
}

export function startCamera() {
  const cameraEl = document.querySelector('.camera');
  const world = cameraEl?.querySelector('.world');
  if (!world) return null;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const debug = new URLSearchParams(location.search).has('debug');
  const readout = debug ? document.body.appendChild(Object.assign(document.createElement('output'), { className: 'camera-debug' })) : null;

  const stops = [];
  for (const cfg of STOPS) {
    const section = document.querySelector(`.stop[data-stop="${cfg.id}"]`);
    const art = world.querySelector(`.art[data-stop="${cfg.id}"]`);
    if (!section || !art) {
      console.warn(`stops.js: no .stop and .art with data-stop="${cfg.id}" in index.html`);
      continue;
    }
    const length = cfg.length ?? 2;
    section.style.setProperty('--len', length);
    const video = art.querySelector('video[data-src]');
    const scrub = video ? scrubber(video) : null;
    stops.push({ ...cfg, length, section, art, video, scrub, top: 0, height: 0, animations: [] });
  }
  if (!stops.length) return null;

  // Load the current stop's video and the next one's, so it's ready before the seam.
  const prefetch = (i) => {
    if (reduced.matches) return;
    for (const stop of [stops[i], stops[i + 1]]) if (stop?.video) loadVideo(stop.video);
  };

  // iOS won't paint a seeked frame of a muted video that has never played: play and
  // pause each video once on the first touch.
  addEventListener('touchstart', () => {
    for (const { video } of stops) {
      if (video?.dataset.loading) video.play().then(() => video.pause()).catch(() => {});
    }
  }, { once: true, passive: true });

  let active = -1;
  let frame = 0;

  const deactivate = (i) => {
    const stop = stops[i];
    if (!stop) return;
    stop.section.classList.remove('is-active');
    stop.art.classList.remove('is-active');
    stop.animations.forEach((a) => a.cancel());
  };

  const activate = (i) => {
    if (i === active) return;
    deactivate(active);
    active = i;
    const stop = stops[i];
    stop.section.classList.add('is-active');
    stop.art.classList.add('is-active');
    cameraEl.dataset.active = stop.id;
    prefetch(i);
  };

  // Measure positions and (re)build every stop's animations.
  const layout = () => {
    for (const stop of stops) stop.animations.forEach((a) => a.cancel());
    const vh = cameraEl.clientHeight;
    const vw = cameraEl.clientWidth;

    stops.forEach((stop, i) => {
      const rect = stop.section.getBoundingClientRect();
      stop.top = rect.top + scrollY;
      stop.height = rect.height;
      const card = stop.section.querySelector('.stop__card');
      stop.section.classList.remove('is-tall');
      if (card && card.offsetHeight > vh + 1) stop.section.classList.add('is-tall');
      stop.animations = [];
      if (reduced.matches) return;

      const at = stop.art.offsetTop;
      const next = stops[i + 1]?.art.offsetTop ?? at;
      const geo = { at, next, vh, vw };
      for (const track of tracksFor(stop)) {
        const target = typeof track.target === 'string' ? cameraEl.querySelector(track.target) : world;
        if (!target) {
          console.warn(`stops.js: camera target "${track.target}" not found (stop "${stop.id}")`);
          continue;
        }
        const keyframes = typeof track.keyframes === 'function' ? track.keyframes(geo) : track.keyframes;
        const animation = target.animate(keyframes, { duration: DURATION, fill: 'both', easing: track.easing ?? 'linear' });
        animation.cancel();
        stop.animations.push(animation);
      }
    });

    cameraEl.dataset.mode = reduced.matches ? 'fade' : 'move';
    active = -1;
    update();
  };

  const update = () => {
    frame = 0;
    const y = scrollY;
    let i = 0;
    while (i + 1 < stops.length && y >= stops[i + 1].top - 1) i++;
    const stop = stops[i];
    const p = clamp01((y - stop.top) / stop.height);
    activate(i);
    for (const a of stop.animations) {
      if (a.playState !== 'paused') a.pause();
      a.currentTime = p * DURATION;
    }
    if (stop.scrub && !reduced.matches) {
      const marks = i === stops.length - 1 ? stop.section.querySelectorAll('[data-video-at]') : [];
      if (marks.length) {
        // Measured on every update, so late font loads and the growing answer can't
        // leave the marks out of date.
        const vh = cameraEl.clientHeight;
        const duration = stop.video.duration || 10;
        const points = [{ y: stop.top, t: 0 }];
        for (const el of marks) {
          const r = el.getBoundingClientRect();
          points.push({ y: Math.max(points[points.length - 1].y, r.top + r.height / 2 + y - vh / 2), t: Number(el.dataset.videoAt) });
        }
        const bottom = document.documentElement.scrollHeight - innerHeight;
        points.push({ y: Math.max(points[points.length - 1].y, bottom), t: duration });
        stop.scrub(timeAt(y, points) / duration);
      } else {
        // The last stop's final screen height is the camera scrolling away, so its video
        // finishes before then and its last frame is what scrolls off.
        const held = stop.height - cameraEl.clientHeight;
        stop.scrub(i === stops.length - 1 && held > 0 ? clamp01((y - stop.top) / held) : p);
      }
    }
    if (readout) readout.textContent = `${stop.id} · ${Math.round(p * 100)}%`;
  };

  const schedule = (fn) => () => {
    if (!frame) frame = requestAnimationFrame(fn);
  };

  addEventListener('scroll', schedule(update), { passive: true });
  addEventListener('resize', () => requestAnimationFrame(layout));
  reduced.addEventListener('change', layout);

  // Keyboard users: focusing a link inside a stop's pinned card brings the camera to that
  // stop. Stops without a card (the accusation) scroll normally, so focus leaves them be.
  document.addEventListener('focusin', (e) => {
    const section = e.target.closest?.('.stop');
    const stop = stops.find((s) => s.section === section);
    if (!stop || !section.querySelector('.stop__card')) return;
    const holdEnd = stop.top + stop.height - cameraEl.clientHeight;
    if (scrollY < stop.top - 1 || scrollY > holdEnd + 1) scrollTo({ top: stop.top, behavior: 'instant' });
  });

  layout();
  return { refresh: layout };
}
