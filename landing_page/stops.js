// The stops on the walk through the village, top to bottom.
//
// Each entry must match an element in index.html with the same `data-stop` on both the
// art (inside .world) and the text (.stop section).
//
//   id      matches data-stop in index.html
//   length  how much scrolling the stop takes, in screen heights (default 2).
//           The last screen height of each stop is the move to the next stop;
//           the rest is time spent at the stop.
//   camera  optional. Replaces the default camera move for this stop. Scroll scrubs it:
//           0% is the moment the stop begins, 100% is the moment the next stop begins.
//
// `camera` can be any of:
//
//   1. A keyframe list (Web Animations format) applied to the .world layer:
//        camera: [
//          { transform: 'translateY(-100svh) scale(1.1)' },
//          { transform: 'translateY(-200svh) scale(1)' },
//        ]
//
//   2. A function that returns one, given where things are in pixels:
//        camera: ({ at, next, vh, vw }) => [
//          { transform: `translateY(${-at}px)` },
//          { transform: `translateY(${-at}px) scale(1.15)`, offset: 0.6 },
//          { transform: `translateY(${-next}px)` },
//        ]
//      `at` is this stop's position on the panorama, `next` the following stop's
//      (equal to `at` for the last stop), `vh`/`vw` the screen size.
//
//   3. A list of tracks, to move more than one layer:
//        camera: [
//          { target: '.world', keyframes: ({ at, next }) => [...] },
//          { target: '[data-layer="fog"]', keyframes: [...], easing: 'ease-in-out' },
//        ]
//      `target` is a CSS selector looked up inside the camera.

export const STOPS = [
  { id: 'village', length: 2.4 },
  { id: 'gate', length: 2.2 },
  { id: 'woods', length: 2.6 },
  { id: 'bonfire', length: 2.4 },
  { id: 'courthouse', length: 2.2 },
  { id: 'graveyard', length: 2.2 },
  { id: 'chapel', length: 2.2 },
  { id: 'accused' }, // as tall as its content (see .accused in styles.css)
];
