import { el, FINAL_TRIAL, formatTime, phaseHint, phaseTitle, remainingMs, store, syncClock } from '/shared/common.js';

const socket = io();
const $ = (id) => document.getElementById(id);
const ROOM_KEY = 'witch-trial-host-room';

let state = null;
let joinInfo = null;
let canControl = true;
let lastPhaseKey = '';

// { code, key } of the room this screen runs. Kept in the tab (never in the URL, which may be
// screenshared) so a refresh returns to the same village.
let room = null;
try { room = JSON.parse(store.get(sessionStorage, ROOM_KEY)); } catch { /* corrupted entry */ }

socket.on('connect', () => {
  socket.emit('host:hello', { code: room?.code, key: room?.key }, (res) => {
    if (!res.ok) return $('stage').replaceChildren(el('p', { class: 'error' }, res.error));
    canControl = res.canControl;
    if (room?.code !== res.code) joinInfo = null;
    room = { code: res.code, key: res.key };
    store.set(sessionStorage, ROOM_KEY, JSON.stringify(room));
    render();
  });
});

// The server closes a village that has gone an hour without a game in progress.
socket.on('host:closed', ({ error }) => {
  room = null;
  state = null;
  store.remove(sessionStorage, ROOM_KEY);
  $('stage').replaceChildren(
    el('p', { class: 'error' }, error),
    el('button', { class: 'primary', onclick: () => location.reload() }, 'Open a new village'));
});

// Refused by the server (too many connections from this network); it won't retry on its own.
socket.on('connect_error', (err) => {
  if (!socket.active) $('stage').replaceChildren(el('p', { class: 'error' }, err.message));
});

// Sent after every host:hello, once the QR code is ready.
socket.on('host:joinInfo', (info) => {
  if (room?.code !== info.code) return;
  joinInfo = info;
  render();
});

socket.on('host:state', (s) => {
  state = s;
  syncClock(s.timer);
  render();
});

function command(cmd, arg) {
  socket.emit('host:cmd', { cmd, arg }, (res) => {
    $('hostError').textContent = res.ok ? '' : res.error;
  });
}

$('btnPause').onclick = () => command(state?.timer?.pausedRemaining != null ? 'resume' : 'pause');
$('btnAdd').onclick = () => command('addTime');
$('btnSkip').onclick = () => {
  if (confirm('Skip to the next step?')) command('skip');
};

// ---------- rendering ----------

function timerNode() {
  return el('div', { class: 'timer', id: 'timer' });
}

function updateTimer() {
  const node = $('timer');
  if (!node || !state) return;
  const ms = remainingMs(state.timer);
  node.textContent = ms == null ? '' : formatTime(ms);
  node.classList.toggle('low', ms != null && ms <= 10_000 && state.timer.pausedRemaining == null);
  node.classList.toggle('paused', state.timer?.pausedRemaining != null);
}
setInterval(updateTimer, 200);

function render() {
  if (!state) return;
  const { phase } = state;

  $('phaseName').textContent = phase.type === 'lobby' ? '' : phaseTitle(phase);
  $('roomCode').textContent = room ? `Village ${room.code}` : '';
  renderProgress();
  renderVillage();
  renderControls();

  const stage = $('stage');
  stage.replaceChildren(...(screens[phase.type] ?? (() => []))().filter(Boolean));
  // Entrance animations play once per phase, not on every broadcast.
  const phaseKey = `${phase.type}:${phase.step}:${phase.runoff ?? ''}:${phase.defense?.index ?? ''}`;
  if (phaseKey === lastPhaseKey) stage.querySelectorAll('.fade-in').forEach((n) => n.classList.remove('fade-in'));
  lastPhaseKey = phaseKey;
  updateTimer();
}

function renderProgress() {
  const { phase } = state;
  const bar = $('progress');
  if (phase.type === 'lobby') return bar.replaceChildren();
  bar.replaceChildren(
    ...Array.from({ length: phase.totalSteps }, (_, i) =>
      el('span', { class: i < phase.step ? 'done' : i === phase.step ? 'now' : '' })),
  );
}

function renderControls() {
  const { phase, timer } = state;
  const inGame = phase.type !== 'lobby' && phase.type !== 'reveal';
  $('controls').classList.toggle('hidden', !inGame || !canControl);
  $('btnPause').textContent = timer?.pausedRemaining != null ? 'Resume' : 'Pause';
  $('btnPause').disabled = !timer;
  $('btnAdd').disabled = !timer;
}

function renderVillage() {
  const { phase, players } = state;
  const aside = $('village');
  const heading = phase.type === 'lobby'
    ? `Villagers (${players.length}/${state.maxPlayers})`
    : 'The Village';
  aside.replaceChildren(
    el('h3', { class: 'display' }, heading),
    ...players.map((p) => {
      const cls = ['vp'];
      if (p.ghost) cls.push('ghost');
      else if (!p.alive) cls.push('dead');
      if (p.acting) cls.push(p.done ? 'done' : 'waiting');
      if (!p.connected) cls.push('offline');
      return el('div', { class: cls.join(' ') },
        el('span', { class: 'dot' }),
        el('span', { class: 'name' }, p.name),
        p.ghost ? el('span', { class: 'tag' }, '👻 Ghost') : null,
        phase.type === 'lobby' && canControl
          ? el('button', { class: 'kick ghost-btn', title: 'Remove', onclick: () => command('kick', p.id) }, '×')
          : null);
    }),
  );
}

function progressLine() {
  const acting = state.players.filter((p) => p.acting);
  if (!acting.length) return null;
  const done = acting.filter((p) => p.done).length;
  const verb = { roles: 'ready', cast: 'cast', vote: 'voted', nominate: 'nominated' }[state.phase.type] ?? 'done';
  return el('div', { class: 'big-count' }, `${done} of ${acting.length} ${verb}`);
}

function tallyNode(tally) {
  const max = Math.max(1, ...tally.map((t) => t.count));
  return el('div', { class: 'tally' },
    tally.map((t, i) =>
      el('div', { class: `bar ${i === 0 && t.count > 0 ? 'top' : ''}` },
        el('span', {}, t.name),
        el('div', { class: 'fill', style: `width:${(t.count / max) * 100}%` }),
        el('span', {}, t.count))));
}

// The clipboard is only available over HTTPS or on localhost, so the button hides elsewhere.
function copyLinkButton() {
  if (!joinInfo || !canControl || !navigator.clipboard) return null;
  return el('button', {
    onclick: (e) => navigator.clipboard.writeText(joinInfo.url).then(() => { e.target.textContent = 'Copied ✓'; }),
  }, 'Copy link');
}

// Messages from the most recent Séance.
function latestGhostMessages() {
  const last = state.ghostMessages.at(-1)?.seance;
  return state.ghostMessages.filter((m) => m.seance === last);
}

const screens = {
  lobby() {
    const enough = state.players.length >= state.minPlayers;
    return [
      el('div', { class: 'lobby fade-in' },
        joinInfo ? el('img', { class: 'qr', src: joinInfo.qr, alt: 'Scan to join' }) : el('div'),
        el('div', { class: 'stack' },
          el('h1', { class: 'title' }, 'Gather the village'),
          el('p', { class: 'steps' }, 'Scan the code, or open this link on your phone:'),
          el('div', { class: 'url' }, joinInfo?.url ?? '…'),
          copyLinkButton(),
          el('p', { class: 'muted' }, 'On a video call? Paste the link into the chat. ',
            'Village code: ', el('strong', { class: 'code' }, room?.code ?? '')),
          el('p', { class: 'muted' }, `${state.minPlayers}–${state.maxPlayers} players. Whoever is running this screen should join on their phone too.`),
          el('p', { class: 'muted' }, 'New players: the rules are on the join screen, under “How to play”.'),
          canControl
            ? el('button', {
                class: 'primary', disabled: !enough,
                style: 'font-size:22px;padding:18px 34px;margin-top:10px',
                onclick: () => command('start'),
              }, enough ? 'Begin the game' : `Waiting for ${state.minPlayers - state.players.length} more…`)
            : null)),
    ];
  },

  roles() {
    return [
      el('p', { class: 'intro fade-in' }, `“${state.intro}”`),
      el('p', { class: 'hint' }, phaseHint(state.phase)),
      timerNode(),
      progressLine(),
    ];
  },

  cast() {
    return [
      el('h1', { class: 'title' }, phaseTitle(state.phase)),
      el('p', { class: 'hint' }, phaseHint(state.phase)),
      timerNode(),
      progressLine(),
    ];
  },

  discuss() {
    return [
      el('h1', { class: 'title' }, 'Discuss'),
      el('p', { class: 'hint' }, phaseHint(state.phase)),
      timerNode(),
      ...latestGhostMessages().map((m) => el('p', { class: 'ghost-past' }, `${m.from} said: “${m.text}”`)),
    ];
  },

  vote() {
    const { phase } = state;
    const showCandidates = phase.runoff || phase.trial === FINAL_TRIAL;
    return [
      el('h1', { class: 'title' }, phaseTitle(phase)),
      el('p', { class: 'hint' }, phaseHint(phase)),
      showCandidates ? el('div', { class: 'candidates' }, phase.candidates.map((c) => el('span', {}, c.name))) : null,
      timerNode(),
      progressLine(),
    ];
  },

  verdict() {
    const trial = state.trials.find((t) => t.trial === state.phase.trial);
    if (!trial) return [];
    const parts = [];
    if (trial.condemned) {
      parts.push(el('div', { class: 'display muted', style: 'font-size:28px' }, 'The village has condemned'));
      parts.push(el('div', { class: 'condemned display fade-in' }, trial.condemned.name));
      if (trial.trial !== FINAL_TRIAL) {
        parts.push(el('p', { class: 'hint' }, 'They become a Ghost. Their role stays a mystery… for now.'));
      } else {
        parts.push(el('div', { class: 'role-reveal display fade-in' }, `They were the ${trial.condemnedRole}.`));
      }
      if (trial.randomTieBreak) parts.push(el('p', { class: 'muted' }, 'The runoff was still tied, so fate chose.'));
    } else {
      parts.push(el('div', { class: 'condemned display' }, 'No verdict'));
      parts.push(el('p', { class: 'hint' }, 'The village could not agree. Nobody is condemned.'));
    }
    parts.push(tallyNode(trial.tally));
    return parts;
  },

  seance() {
    const s = state.seance;
    const messages = state.ghostMessages.filter((m) => m.seance === state.phase.seance);
    const several = state.ghosts.length > 1;
    const allAnswered = s.answeredCount >= s.ghostCount;
    return [
      el('h1', { class: 'title' }, phaseTitle(state.phase)),
      // One line per Ghost: their message once sent, otherwise a flickering placeholder.
      ...state.ghosts.map((g) => {
        const m = messages.find((x) => x.from === g.name);
        return m
          ? el('div', { class: 'ghost-msg fade-in' }, several ? el('div', { class: 'ghost-from' }, g.name) : null, `“${m.text}”`)
          : el('div', { class: 'ghost-msg flicker', style: 'opacity:.5' }, `${g.name} stirs beyond the veil…`);
      }),
      el('div', { class: 'status-row' },
        el('span', { class: `status ${s.messagesSent ? 'on' : ''}` },
          several ? `👻 ${s.messagesSent} of ${s.ghostCount} messages received` : s.messagesSent ? '👻 Message received' : '👻 Awaiting message'),
        s.mediumPresent
          ? el('span', { class: `status ${s.questionAsked ? 'on' : ''}` },
              !s.questionAsked ? '🔮 The Medium may ask one question'
                : allAnswered ? `🔮 The ${several ? 'Ghosts have' : 'Ghost has'} answered the Medium`
                : `🔮 The ${several ? 'Ghosts are' : 'Ghost is'} answering the Medium…`)
          : null),
      el('p', { class: 'hint' }, phaseHint(state.phase)),
      timerNode(),
    ];
  },

  nominate() {
    return [
      el('h1', { class: 'title' }, phaseTitle(state.phase)),
      el('p', { class: 'hint' }, phaseHint(state.phase)),
      timerNode(),
      progressLine(),
    ];
  },

  defense() {
    const d = state.phase.defense;
    return [
      el('div', { class: 'display muted', style: 'font-size:26px' }, `Accused ${d.index + 1} of ${d.total}`),
      el('div', { class: 'spotlight display fade-in' }, d.name),
      el('p', { class: 'hint' }, 'Speak in your own defence.'),
      timerNode(),
      el('div', { class: 'candidates' }, state.nominees.map((n) => el('span', {}, `${n.name} · ${n.count} nomination${n.count === 1 ? '' : 's'}`))),
    ];
  },

  reveal() {
    const o = state.outcome;
    const head = o.village ? 'The Witch has been caught.' : 'The Witch walks free.';
    return [
      el('h1', { class: 'outcome-head display fade-in' }, head),
      el('div', { class: 'factions' },
        el('div', { class: `faction ${o.village ? 'win' : 'lose'}` }, `Village ${o.village ? 'wins' : 'loses'}`),
        el('div', { class: `faction ${o.witch ? 'win' : 'lose'}` }, `Witch & Familiar ${o.witch ? 'win' : 'lose'}`),
        el('div', { class: `faction ${o.werewolf ? 'win' : 'lose'}` }, `Werewolf ${o.werewolf ? 'wins' : 'loses'}`)),
      el('div', { class: 'roster' },
        o.players.map((p) =>
          el('div', { class: `card fade-in ${p.won ? 'won' : 'lost'}` },
            el('div', { class: 'who' }, p.name),
            el('div', { class: 'role' }, p.roleName),
            el('div', { class: 'fate' }, p.fate),
            el('div', { class: 'res' }, p.won ? 'Victory' : 'Defeat')))),
      canControl
        ? el('div', { class: 'status-row' },
            el('button', { class: 'primary', onclick: () => command('newGame') }, 'Play again with these players'),
            el('button', { onclick: () => confirm('Clear all players and start fresh?') && command('endGame') }, 'New village'))
        : null,
    ];
  },
};
