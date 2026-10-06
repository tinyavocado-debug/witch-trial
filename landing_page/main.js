import './links.js';
import { startCamera } from './camera.js';

// ---------- Artwork placeholders ----------
// Until the real images exist, hide the broken-image icon so the labelled placeholder shows.

for (const img of document.querySelectorAll('.art img')) {
  const hide = () => img.classList.add('is-missing');
  if (img.complete && !img.naturalWidth) hide();
  else img.addEventListener('error', hide, { once: true });
}

// ---------- The camera ----------

startCamera();

// ---------- One last thing: the final statement ----------

const doc = document.querySelector('.document');
if (doc) {
  const choices = [...doc.querySelectorAll('.btn--statement')];
  const retort = doc.querySelector('.document__retort');

  for (const button of choices) {
    button.addEventListener('click', () => {
      if (doc.classList.contains('is-answered')) return;
      button.classList.add('is-chosen');
      button.setAttribute('aria-pressed', 'true');
      choices.forEach((b) => { b.disabled = true; });
      doc.classList.add('is-answered');
      retort.focus({ preventScroll: true });
    });
  }
}
