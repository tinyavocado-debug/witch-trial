import { el, FINAL_TRIAL, formatTime, phaseTitle, remainingMs, store, syncClock } from '/shared/common.js';

const socket = io();
const $ = (id) => document.getElementById(id);
const ROOM_KEY = 'witch-trial-room';
const NAME_KEY = 'witch-trial-name';
const tokenKey = (code) => `witch-trial-token:${code}`;

// The village code comes from the join link, or from this tab's earlier visit (e.g. back from the rules page).
let roomCode = (new URLSearchParams(location.search).get('room') ?? '').trim().toUpperCase()
  || store.get(sessionStorage, ROOM_KEY) || '';
if (roomCode) store.set(sessionStorage, ROOM_KEY, roomCode);

let state = null; // latest player view from the server
let joined = false;
let joinError = '';
let lastPhaseKey = '';
let lastSignature = '';

// Local UI state, reset when the phase changes.
let draft = { spell: null, targets: [], editing: false };
let roleShown = false;
const texts = { ghostMessage: '' };
const openPanels = new Set(); // which <details> panels the player has expanded

// ---------- connection ----------

socket.on('connect', () => {
  const token = roomCode && store.get(sessionStorage, tokenKey(roomCode));
  if (token) {
    socket.emit('player:join', { room: roomCode, token }, (res) => {
      if (res.ok) joined = true;
      else {
        store.remove(sessionStorage, tokenKey(roomCode));
        if (res.noRoom) joinError = 'That village has closed. Ask the host for a new link.';
      }
      render();
    });
  } else {
    render();
  }
});

// Refused by the server (too many connections from this network); it won't retry on its own.
socket.on('connect_error', (err) => {
  if (socket.active) return;
  joinError = err.message;
  render();
});

socket.on('state', (view) => {
  if (view.removed) {
    lastSignature = '';
    joined = false;
    state = null;
    store.remove(sessionStorage, tokenKey(roomCode));
    joinError = view.closed ? 'That village has closed. Ask the host for a new link.' : 'You were removed from the village.';
    return render();
  }
  state = view;
  syncClock(view.timer);
  // Other players' actions trigger broadcasts; skip re-rendering (which would disturb typing)
  // when nothing this phone shows has changed.
  const signature = JSON.stringify({ ...view, timer: null });
  if (signature === lastSignature) return updateTimer();
  lastSignature = signature;
  const key = `${view.phase.type}:${view.phase.step}:${view.phase.runoff ?? ''}:${view.phase.index ?? ''}`;
  const newPhase = key !== lastPhaseKey;
  if (newPhase) {
    if (lastPhaseKey) navigator.vibrate?.(180);
    lastPhaseKey = key;
    draft = { spell: null, targets: [], editing: false };
    texts.ghostMessage = '';
    if (view.phase.type === 'roles' || view.phase.type === 'lobby') roleShown = false;
  }
  render();
  // Entrance animations play once per phase, not on every update.
  if (!newPhase) $('screen').querySelectorAll('.fade-in').forEach((n) => n.classList.remove('fade-in'));
});

function act(action) {
  socket.emit('player:act', action, (res) => {
    if (!res.ok) toast(res.error);
  });
}

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ---------- timer ----------

function updateTimer() {
  const node = $('barTimer');
  const ms = state ? remainingMs(state.timer) : null;
  node.textContent = ms == null ? '' : (state.timer.pausedRemaining != null ? '⏸ ' : '') + formatTime(ms);
  node.classList.toggle('low', ms != null && ms <= 10_000);
}
setInterval(updateTimer, 250);

// ---------- helpers ----------

const nameOf = (id) => state.players.find((p) => p.id === id)?.name ?? '?';
const me = () => state.you;

function focusKeeper() {
  // Re-rendering replaces inputs; restore focus and caret to whichever one had it.
  const active = document.activeElement;
  const id = active?.id;
  const pos = active?.selectionStart;
  return () => {
    if (!id) return;
    const node = $(id);
    if (node && node !== document.activeElement) {
      node.focus();
      if (pos != null) node.setSelectionRange(pos, pos);
    }
  };
}

// ---------- render ----------

function render() {
  const restoreFocus = focusKeeper();
  $('barTitle').textContent = state && joined ? phaseTitle(state.phase) || 'Witch Trial' : 'Witch Trial';
  const screen = $('screen');
  if (!joined || !state) screen.replaceChildren(...joinScreen());
  else {
    const parts = (views[state.phase.type] ?? (() => []))();
    if (state.allClues && state.phase.type !== 'reveal') parts.push(ghostSight());
    screen.replaceChildren(...parts.filter(Boolean));
  }
  updateTimer();
  restoreFocus();
}

// What the player has typed on the join screen, so a failed join doesn't clear it.
const joinDraft = { name: store.get(localStorage, NAME_KEY) ?? '', code: roomCode };

function joinScreen() {
  const input = el('input', {
    id: 'nameInput', placeholder: 'Your name', maxlength: 16, autocomplete: 'off',
    value: joinDraft.name, oninput: (e) => { joinDraft.name = e.target.value; },
  });
  const codeInput = el('input', {
    id: 'codeInput', placeholder: 'Village code', maxlength: 6, autocomplete: 'off',
    autocapitalize: 'characters', style: 'text-transform:uppercase',
    value: joinDraft.code, oninput: (e) => { joinDraft.code = e.target.value; },
  });
  const submit = () => {
    const name = input.value.trim();
    socket.emit('player:join', { room: codeInput.value, name }, (res) => {
      if (res.ok) {
        joined = true;
        joinError = '';
        roomCode = res.code;
        store.set(sessionStorage, ROOM_KEY, roomCode);
        store.set(sessionStorage, tokenKey(roomCode), res.token);
        store.set(localStorage, NAME_KEY, name);
        history.replaceState(null, '', `/play/?room=${roomCode}`);
      } else {
        joinError = res.error;
      }
      render();
    });
  };
  for (const field of [input, codeInput]) field.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  return [
    el('div', { class: 'center', style: 'margin-top:8vh' },
      el('div', { style: 'font-size:64px' }, '🕯️'),
      el('h2', { class: 'flicker' }, 'Witch Trial')),
    el('p', { class: 'muted center' }, 'Something supernatural has infiltrated the village.'),
    input,
    codeInput,
    el('button', { class: 'primary', onclick: submit }, 'Enter the village'),
    el('p', { class: 'error' }, joinError),
    rulesLink('First time? Read how to play'),
  ];
}

// Opens in this tab so the session token survives; returning rejoins automatically.
function rulesLink(text) {
  return el('a', { class: 'rules-link', href: '/rules/' }, text);
}

function ghostBanner() {
  if (!me().isGhost || state.phase.type === 'reveal') return null;
  return el('div', { class: 'ghost-banner' }, '👻 You are a Ghost. Do not speak aloud. Your only voice is through the Séance. You can now see every clue the living receive.');
}

function roleCard() {
  const y = me();
  if (!roleShown) {
    return el('div', { class: 'role-card concealed', onclick: () => { roleShown = true; render(); } },
      el('div', { class: 'sigil' }, '🗝️'),
      el('div', { class: 'label' }, 'Tap to reveal your role'),
      el('div', { class: 'muted', style: 'font-size:14px' }, 'Shield your screen'));
  }
  return el('div', { class: 'role-card fade-in', onclick: () => { roleShown = false; render(); } },
    el('div', { class: 'label' }, 'You are the'),
    el('div', { class: 'role-name' }, y.roleName),
    el('div', { class: 'goal' }, y.goal),
    el('div', { class: 'ability' }, y.ability),
    y.witchName ? el('div', { class: 'secret' }, `🐈‍⬛ The Witch is `, el('strong', {}, y.witchName), '.') : null,
    y.role === 'hunter' ? el('div', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, y.trueScryUsed ? 'True Scry: used' : 'True Scry: available') : null,
    y.role === 'medium' ? el('div', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, y.visionUsed ? 'Vision: used' : 'Vision: available from Round 2') : null,
    el('div', { class: 'label', style: 'margin-top:12px' }, 'Tap to hide'));
}

function clueNode(c) {
  return el('div', { class: `clue ${c.kind}` }, el('span', { class: 'round' }, `Round ${c.round}`), c.text);
}

// A <details> panel that stays open or closed across re-renders.
function panel(key, summary, body) {
  const node = el('details', { class: 'inbox', open: openPanels.has(key) }, el('summary', {}, summary), body);
  node.addEventListener('toggle', () => (node.open ? openPanels.add(key) : openPanels.delete(key)));
  return node;
}

function inbox({ exceptRound = null } = {}) {
  const list = state.inbox.filter((c) => c.round !== exceptRound);
  if (!list.length) return null;
  return panel('inbox', `📜 Your clues so far (${list.length})`,
    el('div', { class: 'stack' }, [...list].reverse().map(clueNode)));
}

function roleToggle() {
  return panel('role', '🗝️ Your role', el('div', { style: 'margin-top:8px' }, roleCard()));
}

// The Ghost sees every clue the living have received, grouped by round.
function ghostSight() {
  const clues = state.allClues;
  const rounds = [...new Set(clues.map((c) => c.round))];
  return panel('ghostSight', `👁️ Everyone's clues (${clues.length})`,
    clues.length
      ? el('div', { class: 'stack' }, rounds.reverse().map((r) => el('div', { class: 'stack' },
          el('h3', { class: 'display' }, `Round ${r}`),
          clues.filter((c) => c.round === r).map((c) =>
            el('div', { class: `clue ${c.kind}` }, el('span', { class: 'round' }, c.player), c.text)))))
      : el('p', { class: 'muted' }, 'No clues yet.'));
}

function ghostMessagesNode() {
  if (!state.ghostMessages.length) return null;
  return el('div', { class: 'stack' },
    el('h3', { class: 'display' }, 'From beyond the veil'),
    state.ghostMessages.map((m) => el('div', { class: 'ghost-msg' }, `“${m.text}”`)));
}

function playerButtons({ ids, selected = [], onPick }) {
  return el('div', { class: 'grid' },
    ids.map((id) => {
      const p = state.players.find((q) => q.id === id);
      return el('button', {
        class: `player-btn ${selected.includes(id) ? 'selected' : ''} ${p?.ghost ? 'ghostly' : ''}`,
        onclick: () => onPick(id),
      }, (p?.ghost ? '👻 ' : '') + (p?.name ?? '?'));
    }));
}

// ---------- phase views ----------

const views = {
  lobby() {
    return [
      el('h2', {}, `Welcome, ${me().name}`),
      el('p', { class: 'muted' }, 'Waiting for the host to begin. Keep this screen open.'),
      el('div', { class: 'stack' },
        el('h3', { class: 'display' }, `In the village (${state.players.length})`),
        el('div', { class: 'roster' }, state.players.map((p) => el('div', { class: 'row' }, p.name)))),
      rulesLink('📖 How to play (read while you wait)'),
    ];
  },

  roles() {
    return [
      el('p', { class: 'muted', style: 'font-style:italic' }, state.intro),
      roleCard(),
      state.acted
        ? el('div', { class: 'done-box center' }, 'Ready. Waiting for the others…')
        : el('button', { class: 'primary', onclick: () => act({ type: 'ready' }) }, 'I know my role'),
    ];
  },

  cast() {
    const y = me();
    if (!y.alive) {
      return [ghostBanner(), el('p', { class: 'muted' }, 'The living are casting spells. Watch them closely.'), inbox(), roleToggle()];
    }
    const chosen = state.myAction;
    if (chosen && !draft.editing) {
      const targetNames = chosen.targets.map(nameOf).join(' & ');
      const label = state.spells.find((s) => s.key === chosen.type)?.label ?? chosen.type;
      return [
        el('div', { class: 'done-box' }, `✨ ${label}${targetNames ? ` → ${targetNames}` : ''}`),
        el('p', { class: 'muted' }, 'Your spell will resolve when the round ends. You can still change it.'),
        el('button', { onclick: () => { draft = { spell: chosen.type, targets: [...chosen.targets], editing: true }; render(); } }, 'Change spell'),
        inbox(),
        roleToggle(),
      ];
    }

    const parts = [el('h3', { class: 'display' }, 'Choose one spell')];
    parts.push(el('div', { class: 'stack' },
      state.spells.map((s) =>
        el('button', {
          class: `spell ${draft.spell === s.key ? 'selected' : ''} ${['trueScry', 'vision'].includes(s.key) ? 'special' : ''}`,
          onclick: () => { draft.spell = s.key; draft.targets = []; render(); },
        }, el('span', { class: 'name' }, s.label), el('span', { class: 'desc' }, s.desc)))));

    const spell = state.spells.find((s) => s.key === draft.spell);
    if (spell) {
      if (spell.targets > 0) {
        const living = state.players.filter((p) => p.alive);
        const ids = spell.key === 'curse'
          ? living.filter((p) => p.id !== y.id).map((p) => p.id)
          : state.players.filter((p) => p.id !== y.id).map((p) => p.id);
        parts.push(el('h3', { class: 'display' }, 'Choose a target'));
        parts.push(playerButtons({
          ids,
          selected: draft.targets,
          onPick: (id) => {
            draft.targets = [id];
            render();
          },
        }));
      }
      const ready = draft.targets.length === spell.targets;
      parts.push(el('button', {
        class: 'primary', disabled: !ready,
        onclick: () => {
          act({ type: 'cast', spell: draft.spell, targets: draft.targets });
          draft.editing = false;
        },
      }, `Cast ${spell.label}`));
    }
    if (draft.editing) parts.push(el('button', { class: 'ghost-btn', onclick: () => { draft.editing = false; render(); } }, 'Keep my previous spell'));
    parts.push(roleToggle());
    return parts;
  },

  discuss() {
    const round = state.phase.round;
    const fresh = state.inbox.filter((c) => c.round === round);
    return [
      ghostBanner(),
      fresh.length ? el('h3', { class: 'display' }, 'Your result') : null,
      ...fresh.map(clueNode),
      el('p', { class: 'muted' }, me().isGhost
        ? 'Listen to the living argue.'
        : 'Share it, twist it, hide it, or lie. Nobody can see your screen.'),
      inbox({ exceptRound: round }),
      ghostMessagesNode(),
      roleToggle(),
    ];
  },

  vote() {
    const y = me();
    const { phase } = state;
    if (!y.alive) return [ghostBanner(), el('p', { class: 'muted' }, 'The living are voting.'), inbox()];
    const ids = phase.candidates.map((c) => c.id).filter((id) => id !== y.id);
    return [
      el('h3', { class: 'display' }, phase.runoff ? 'Runoff: choose between the tied' : phase.trial !== FINAL_TRIAL ? 'Who is most suspicious?' : 'Condemn one of the accused'),
      playerButtons({ ids, selected: state.myVote ? [state.myVote] : [], onPick: (id) => act({ type: 'vote', target: id }) }),
      state.myVote
        ? el('p', { class: 'muted center' }, `Your vote: ${nameOf(state.myVote)}. Tap another name to change it.`)
        : el('p', { class: 'muted center' }, 'Tap a name to cast your vote.'),
      inbox(),
    ];
  },

  verdict() {
    const trial = state.trials.find((t) => t.trial === state.phase.trial);
    if (!trial) return [];
    const mine = trial.condemned?.id === me().id;
    const parts = [];
    if (trial.condemned) {
      parts.push(el('p', { class: 'muted center' }, 'The village has condemned'));
      parts.push(el('div', { class: 'result-big' }, trial.condemned.name));
      if (trial.condemnedRole) parts.push(el('p', { class: 'center display', style: 'font-size:24px' }, `They were the ${trial.condemnedRole}.`));
    } else {
      parts.push(el('div', { class: 'result-big' }, 'No verdict'));
    }
    if (mine && trial.trial !== FINAL_TRIAL) {
      parts.push(el('div', { class: 'ghost-banner' },
        '👻 You are now a Ghost. From this moment you may not speak aloud. At each Séance you can send one message of eight words or fewer, and answer the Medium\'s question. You can also now see every clue the living receive.'));
    }
    return parts;
  },

  seance() {
    const y = me();
    const s = state.seance;
    const parts = [ghostBanner()];
    const messages = state.ghostMessages.filter((m) => m.seance === state.phase.seance);
    const several = state.ghosts.length > 1;
    // Every Ghost's message (or a placeholder until they send it), for everyone to read.
    const messageNodes = (ghosts) => ghosts.map((g) => {
      const m = messages.find((x) => x.from === g.name);
      return m
        ? el('div', { class: 'stack' }, el('h3', { class: 'display' }, `${g.name} speaks:`), el('div', { class: 'ghost-msg fade-in' }, `“${m.text}”`))
        : el('div', { class: 'ghost-msg flicker', style: 'opacity:.55' }, `${g.name} stirs…`);
    });

    if (y.isGhost) {
      if (!s.myMessage) {
        const count = texts.ghostMessage.trim() ? texts.ghostMessage.trim().split(/\s+/).length : 0;
        const input = el('textarea', { id: 'ghostInput', rows: 2, placeholder: 'Eight words or fewer…', maxlength: 100 });
        input.value = texts.ghostMessage;
        const counter = el('div', { class: `word-count ${count > 8 ? 'over' : ''}` }, `${count} / 8 words`);
        input.addEventListener('input', () => {
          texts.ghostMessage = input.value;
          const n = input.value.trim() ? input.value.trim().split(/\s+/).length : 0;
          counter.textContent = `${n} / 8 words`;
          counter.classList.toggle('over', n > 8);
        });
        parts.push(
          el('h3', { class: 'display' }, 'Send one message to the living'),
          el('p', { class: 'muted', style: 'font-size:14px' }, 'Be cryptic. You may not reveal anyone\'s role outright.'),
          input, counter,
          el('button', { class: 'primary', onclick: () => act({ type: 'ghostMessage', text: texts.ghostMessage }) }, 'Send from beyond'));
      } else {
        parts.push(el('div', { class: 'ghost-msg' }, `“${s.myMessage}”`), el('p', { class: 'muted center' }, 'Your message has reached the living.'));
      }
      if (s.questionAsked && !s.myAnswer) {
        parts.push(
          el('h3', { class: 'display' }, '🔮 The Medium has asked a question aloud'),
          el('p', { class: 'muted', style: 'font-size:14px' }, 'Answer silently. Only the Medium will see your answer.'),
          el('div', { class: 'answer-row' }, ['Yes', 'No', 'Unclear'].map((a) =>
            el('button', { class: 'primary', onclick: () => act({ type: 'ghostAnswer', answer: a }) }, a))));
      } else if (s.myAnswer) {
        parts.push(el('div', { class: 'done-box' }, `You answered the Medium: ${s.myAnswer}`));
      } else if (s.mediumPresent) {
        parts.push(el('p', { class: 'muted' }, 'Listen for the Medium\'s question. Your answer buttons will appear here.'));
      }
      parts.push(...messageNodes(state.ghosts.filter((g) => g.id !== y.id)));
      return parts;
    }

    parts.push(...messageNodes(state.ghosts));

    if (y.role === 'medium' && y.alive) {
      const ghostWord = several ? 'the Ghosts' : 'the Ghost';
      if (!s.questionAsked) {
        parts.push(
          el('h3', { class: 'display' }, `🔮 Ask ${ghostWord} one question`),
          el('p', { class: 'muted', style: 'font-size:14px' },
            `Say one yes-or-no question out loud, then tap below. ${several ? 'Each Ghost' : 'The Ghost'} will answer on their phone, and only you will see it.`),
          el('button', { class: 'primary', onclick: () => act({ type: 'mediumQuestion' }) }, 'I have asked my question'));
      } else {
        for (const a of s.answers) {
          const label = several ? `👻 ${a.from} answers: ` : '👻 The Ghost answers: ';
          parts.push(a.answer
            ? el('div', { class: 'done-box' }, label, el('strong', {}, a.answer))
            : el('p', { class: 'muted' }, `Waiting for ${several ? a.from : 'the Ghost'} to answer…`));
        }
        parts.push(el('p', { class: 'muted', style: 'font-size:14px' }, 'Tell the village what you learned, or lie about it.'));
      }
    } else if (s.mediumPresent && s.questionAsked) {
      parts.push(el('p', { class: 'muted center' }, `The Medium is consulting ${several ? 'the Ghosts' : 'the Ghost'}…`));
    }
    parts.push(inbox(), roleToggle());
    return parts;
  },

  nominate() {
    const y = me();
    if (!y.alive) return [ghostBanner(), el('p', { class: 'muted' }, 'The living are naming their suspects.')];
    const ids = state.players.filter((p) => p.alive && p.id !== y.id).map((p) => p.id);
    return [
      el('h3', { class: 'display' }, 'Nominate your main suspect'),
      playerButtons({ ids, selected: state.myNomination ? [state.myNomination] : [], onPick: (id) => act({ type: 'nominate', target: id }) }),
      el('p', { class: 'muted center' }, state.myNomination ? `You named ${nameOf(state.myNomination)}.` : 'The three most-named players will stand trial.'),
      inbox(),
    ];
  },

  defense() {
    const d = state.phase.defense;
    const mine = d.id === me().id;
    return [
      ghostBanner(),
      el('p', { class: 'muted center' }, `Accused ${d.index + 1} of ${d.total}`),
      el('div', { class: 'result-big' }, d.name),
      el('p', { class: 'center' }, mine ? '🗣️ Defend yourself now! You have 20 seconds.' : 'Listen to their defence.'),
      inbox(),
    ];
  },

  reveal() {
    const y = me();
    const o = state.outcome;
    return [
      el('p', { class: 'muted center' }, 'You were the'),
      el('div', { class: 'result-big', style: 'color:var(--accent)' }, y.roleName),
      el('div', { class: `result-big ${y.won ? 'won' : 'lost'}` }, y.won ? 'Victory' : 'Defeat'),
      el('p', { class: 'center display', style: 'font-size:22px' }, o.village ? 'The Witch was caught.' : 'The Witch walks free.'),
      o.werewolf ? el('p', { class: 'center muted' }, 'The Werewolf also claims victory.') : null,
      el('div', { class: 'roster' },
        o.players.map((p) => el('div', { class: `row ${p.won ? 'won' : 'lost'}` },
          el('span', {}, p.name), el('span', { class: 'r' }, p.roleName)))),
      el('p', { class: 'muted center', style: 'font-size:14px' }, 'Look at the big screen for the full story.'),
    ];
  },
};
