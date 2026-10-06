// Links into the game, shared by every page of the site.
//
// <meta name="game-url"> is the deployed game's address. Empty means the page is served
// by the game itself (same origin). Each page has its own copy of the meta tag; keep
// them the same.

const gameUrl = document.querySelector('meta[name="game-url"]')?.content.trim().replace(/\/+$/, '');
if (gameUrl) {
  for (const a of document.querySelectorAll('[data-game-path]')) a.href = gameUrl + a.dataset.gamePath;
  // The free server sleeps after ~15 minutes idle and takes up to a minute to wake.
  // Knock now so it's awake by the time someone presses Host.
  fetch(`${gameUrl}/rules/`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}
