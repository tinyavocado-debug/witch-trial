// Helpers shared by the table screen and the phone client.

export const TRIAL_NAMES = { 1: 'First', 2: 'Second', 3: 'Final' };
export const FINAL_TRIAL = 3;

export function phaseTitle(phase) {
  switch (phase.type) {
    case 'lobby': return 'Gathering the Village';
    case 'roles': return 'Secret Roles';
    case 'cast': return `Spell Round ${phase.round}`;
    case 'discuss': return `Discussion · Round ${phase.round}`;
    case 'vote': {
      const name = TRIAL_NAMES[phase.trial];
      return phase.runoff ? `${name} Trial · Runoff` : `The ${name} ${phase.trial === 3 ? 'Trial' : 'Witch Trial'}`;
    }
    case 'verdict': return `The ${TRIAL_NAMES[phase.trial]} Verdict`;
    case 'seance': return phase.seance === 1 ? 'The Séance' : 'The Second Séance';
    case 'nominate': return 'Final Trial · Nominations';
    case 'defense': return 'Final Trial · Defenses';
    case 'reveal': return 'The Reveal';
    default: return '';
  }
}

// Instructions shown on the shared table screen.
export function phaseHint(phase) {
  switch (phase.type) {
    case 'roles': return 'Read your role in secret. Tap “Ready” when you have memorised it.';
    case 'cast': return phase.round === 3
      ? 'Last chance to cast. Choose your spell in secret on your phone.'
      : 'Everyone still alive secretly chooses one spell on their phone.';
    case 'discuss': return 'Your results have arrived. Reveal them, exaggerate them, hide them, or lie.';
    case 'vote': return phase.runoff
      ? 'It is a tie. Vote again, only between the tied players.'
      : phase.trial !== FINAL_TRIAL
        ? 'Vote for the player you find most suspicious. They become a Ghost, and their role stays hidden.'
        : 'Vote now, all at once. The condemned player\'s role will be revealed.';
    case 'verdict': return '';
    case 'seance': return 'Each Ghost may send one message. The Medium may ask one yes-or-no question aloud — only the Medium sees the Ghosts\' answers. Then discuss openly.';
    case 'nominate': return 'Nominate your main suspect. The three most-named will stand trial.';
    case 'defense': return 'Each accused player has 20 seconds to defend themselves.';
    default: return '';
  }
}

// Browser storage that quietly does nothing when blocked (e.g. private mode).
export const store = {
  get(storage, key) { try { return storage.getItem(key); } catch { return null; } },
  set(storage, key, value) { try { storage.setItem(key, value); } catch { /* private mode */ } },
  remove(storage, key) { try { storage.removeItem(key); } catch { /* private mode */ } },
};

// Tracks clock skew between this device and the server so countdowns agree across phones.
let offset = 0;
export function syncClock(timer) {
  if (timer?.serverNow) offset = timer.serverNow - Date.now();
}

export function remainingMs(timer) {
  if (!timer) return null;
  if (timer.pausedRemaining != null) return timer.pausedRemaining;
  return Math.max(0, timer.endsAt - (Date.now() + offset));
}

export function formatTime(ms) {
  if (ms == null) return '';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
