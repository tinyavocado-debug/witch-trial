// The Witch Trial state machine. Knows nothing about sockets: callers invoke methods, then read
// publicView() (laptop screen) and playerView(id) (one phone). Every mutating method returns
// { ok: true } or { ok: false, error }.

import { randomUUID } from 'node:crypto';
import { assignRoles, MAX_PLAYERS, MIN_PLAYERS, ROLE_INFO } from './roles.js';
import { resolveRound, SPELLS } from './spells.js';
import { evaluate } from './outcome.js';
import { pick, shuffle } from './util.js';

// Seconds.
export const DEFAULT_DURATIONS = {
  roles: 60,
  cast: 60,
  discuss: { 1: 90, 2: 150, 3: 150 },
  vote: 60,
  verdict: 12,
  seance: 180,
  nominate: 45,
  defense: 20,
  reveal: 0, // untimed
};

export const SCHEDULE = [
  { type: 'roles' },
  { type: 'cast', round: 1 },
  { type: 'discuss', round: 1 },
  { type: 'vote', trial: 1 },
  { type: 'verdict', trial: 1 },
  { type: 'cast', round: 2 },
  { type: 'discuss', round: 2 },
  { type: 'seance', seance: 1 },
  { type: 'vote', trial: 2 },
  { type: 'verdict', trial: 2 },
  { type: 'cast', round: 3 },
  { type: 'discuss', round: 3 },
  { type: 'seance', seance: 2 },
  { type: 'nominate' },
  { type: 'defense' },
  { type: 'vote', trial: 3 },
  { type: 'verdict', trial: 3 },
  { type: 'reveal' },
];

// Players condemned at earlier trials become Ghosts; the Final Trial ends the game and reveals the role.
export const FINAL_TRIAL = 3;
export const TRIALS = [1, 2, FINAL_TRIAL];

export const INTRO_TEXT =
  'Something supernatural has infiltrated the village. Your ultimate task is to identify the Witch. ' +
  'But be careful — not every supernatural creature serves them.';

const MAX_NAME = 16;
const MAX_GHOST_WORDS = 8;
const GHOST_ANSWERS = ['Yes', 'No', 'Unclear'];

const ok = { ok: true };
const fail = (error) => ({ ok: false, error });

export class Game {
  constructor({ durations = DEFAULT_DURATIONS, rng = Math.random, now = () => Date.now() } = {}) {
    this.durations = durations;
    this.rng = rng;
    this.now = now;
    this.players = [];
    this.resetGame();
  }

  resetGame() {
    this.phaseIndex = -1;
    this.phase = { type: 'lobby' };
    this.timer = null; // { endsAt, duration } or { pausedRemaining, duration }
    this.ready = new Set();
    this.rounds = {}; // round -> { actions: { playerId: {type,targets} } }
    this.inbox = {}; // playerId -> [{round, kind, text}]
    this.trials = {}; // trial -> { candidates, votes, runoff, tally, condemnedId, noVerdict }
    this.seances = {}; // n -> { messages: {ghostId: text}, asked, answers: {ghostId: answer} }
    this.nominations = {};
    this.nominees = [];
    this.nominationCounts = {};
    this.used = { trueScry: false, vision: false };
    this.outcome = null;
    for (const p of this.players) {
      p.role = null;
      p.alive = true;
      p.condemnedIn = null;
    }
  }

  // ---------- helpers ----------

  get started() {
    return this.phase.type !== 'lobby';
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  living() {
    return this.players.filter((p) => p.alive);
  }

  isGhost(p) {
    return p.condemnedIn != null && p.condemnedIn !== FINAL_TRIAL;
  }

  ghosts() {
    return this.players.filter((p) => this.isGhost(p)).sort((a, b) => a.condemnedIn - b.condemnedIn);
  }

  playerByRole(role) {
    return this.players.find((p) => p.role === role) ?? null;
  }

  startTimer(seconds) {
    this.timer = seconds > 0 ? { endsAt: this.now() + seconds * 1000, duration: seconds * 1000 } : null;
  }

  durationFor(phase) {
    const d = this.durations[phase.type];
    return typeof d === 'object' ? d[phase.round] : d;
  }

  // Players whose input the current phase is waiting on.
  eligible() {
    switch (this.phase.type) {
      case 'roles':
        return this.players;
      case 'cast':
      case 'vote':
      case 'nominate':
        return this.living();
      default:
        return [];
    }
  }

  hasActed(id) {
    switch (this.phase.type) {
      case 'roles':
        return this.ready.has(id);
      case 'cast':
        return !!this.rounds[this.phase.round].actions[id];
      case 'vote':
        return !!this.trials[this.phase.trial].votes[id];
      case 'nominate':
        return !!this.nominations[id];
      default:
        return false;
    }
  }

  maybeAutoAdvance() {
    const waiting = this.eligible();
    if (waiting.length && waiting.every((p) => this.hasActed(p.id))) this.onTimeout();
  }

  // ---------- lobby ----------

  join(name, token) {
    if (token) {
      const existing = this.players.find((p) => p.token === token);
      if (existing) return { ok: true, id: existing.id, token };
    }
    if (this.started) return fail('The game has already started.');
    if (this.players.length >= MAX_PLAYERS) return fail(`The village is full (${MAX_PLAYERS} players).`);
    let clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!clean) return fail('Please enter a name.');
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (taken.has(clean.toLowerCase())) {
      let n = 2;
      while (taken.has(`${clean} ${n}`.toLowerCase())) n++;
      clean = `${clean} ${n}`;
    }
    const player = { id: randomUUID(), token: randomUUID(), name: clean, role: null, alive: true, condemnedIn: null };
    this.players.push(player);
    return { ok: true, id: player.id, token: player.token };
  }

  kick(id) {
    if (this.started) return fail('Players can only be removed in the lobby.');
    this.players = this.players.filter((p) => p.id !== id);
    return ok;
  }

  start() {
    if (this.started) return fail('The game has already started.');
    if (this.players.length < MIN_PLAYERS) return fail(`Need at least ${MIN_PLAYERS} players.`);
    this.resetGame();
    this.players = shuffle(this.players, this.rng); // random seating order for display
    const roles = assignRoles(this.players.map((p) => p.id), this.rng);
    for (const p of this.players) p.role = roles[p.id];
    this.enter(0);
    return ok;
  }

  // ---------- phase machine ----------

  enter(index) {
    this.phaseIndex = index;
    this.phase = { ...SCHEDULE[index] };
    const ph = this.phase;
    if (ph.type === 'cast') this.rounds[ph.round] = { actions: {} };
    if (ph.type === 'vote') {
      const candidates = ph.trial === FINAL_TRIAL && this.nominees.length >= 2 ? this.nominees : this.living().map((p) => p.id);
      this.trials[ph.trial] = { candidates, votes: {}, runoff: false, tally: null, condemnedId: null };
    }
    if (ph.type === 'seance') this.seances[ph.seance] = { messages: {}, asked: false, answers: {} };
    if (ph.type === 'nominate') this.nominations = {};
    if (ph.type === 'defense') {
      if (!this.nominees.length) return this.enter(index + 1);
      ph.index = 0;
    }
    if (ph.type === 'reveal') this.outcome = evaluate(this.players);
    this.startTimer(this.durationFor(ph));
  }

  // Called when the timer runs out, the host skips, or everyone has acted.
  onTimeout() {
    const ph = this.phase;
    if (ph.type === 'lobby' || ph.type === 'reveal') return;
    if (ph.type === 'cast') this.resolveCast();
    if (ph.type === 'nominate') this.resolveNominations();
    if (ph.type === 'defense' && ph.index < this.nominees.length - 1) {
      ph.index++;
      this.startTimer(this.durations.defense);
      return;
    }
    if (ph.type === 'vote' && !this.resolveVote()) return; // runoff restarts the vote
    this.enter(this.phaseIndex + 1);
  }

  tick() {
    if (!this.timer || this.timer.pausedRemaining != null) return false;
    if (this.now() < this.timer.endsAt) return false;
    this.onTimeout();
    return true;
  }

  // ---------- resolution ----------

  resolveCast() {
    const round = this.phase.round;
    const actions = this.rounds[round].actions;
    const witch = this.playerByRole('witch');
    const witchFirstVote = this.trials[1]?.votes[witch.id];
    const { results } = resolveRound(
      {
        round,
        players: this.players,
        actions,
        visionContext: {
          witchLastSpell: this.rounds[round - 1]?.actions[witch.id]?.type ?? null,
          witchFirstVoteName: witchFirstVote ? this.player(witchFirstVote).name : null,
        },
      },
      this.rng,
    );
    for (const [id, list] of Object.entries(results)) (this.inbox[id] ??= []).push(...list);
    for (const [id, a] of Object.entries(actions)) {
      if (a.type === 'trueScry') this.used.trueScry = true;
      if (a.type === 'vision') this.used.vision = true;
      if (!results[id]) (this.inbox[id] ??= []).push({ round, kind: 'none', text: 'Your spell fizzled.' });
    }
    for (const p of this.living()) {
      if (!actions[p.id]) (this.inbox[p.id] ??= []).push({ round, kind: 'none', text: 'You cast nothing this round.' });
    }
  }

  // Returns false if a runoff vote was started instead of finishing the trial.
  resolveVote() {
    const trialNo = this.phase.trial;
    const trial = this.trials[trialNo];
    const counts = Object.fromEntries(trial.candidates.map((id) => [id, 0]));
    for (const target of Object.values(trial.votes)) if (target in counts) counts[target]++;
    trial.tally = trial.candidates
      .map((id) => ({ id, name: this.player(id).name, count: counts[id] }))
      .sort((a, b) => b.count - a.count);
    const top = trial.tally[0].count;
    const leaders = trial.tally.filter((t) => t.count === top).map((t) => t.id);

    let condemnedId = null;
    if (leaders.length === 1 && top > 0) {
      condemnedId = leaders[0];
    } else if (!trial.runoff) {
      trial.runoff = true;
      trial.previousTally = trial.tally;
      trial.candidates = leaders;
      trial.votes = {};
      trial.tally = null;
      this.startTimer(this.durations.vote);
      return false;
    } else if (trialNo !== FINAL_TRIAL) {
      condemnedId = pick(leaders, this.rng); // earlier trials must produce a Ghost
      trial.randomTieBreak = true;
    } else {
      trial.noVerdict = true; // Final Trial deadlock: nobody is condemned
    }

    if (condemnedId) {
      const p = this.player(condemnedId);
      p.alive = false;
      p.condemnedIn = trialNo;
      trial.condemnedId = condemnedId;
    }
    return true;
  }

  resolveNominations() {
    const counts = {};
    for (const target of Object.values(this.nominations)) counts[target] = (counts[target] ?? 0) + 1;
    const ranked = shuffle(Object.keys(counts), this.rng).sort((a, b) => counts[b] - counts[a]);
    this.nominees = ranked.slice(0, 3);
    this.nominationCounts = counts;
  }

  // ---------- player actions ----------

  act(playerId, action = {}) {
    const p = this.player(playerId);
    if (!p) return fail('Unknown player.');
    const ph = this.phase;
    const handlers = {
      ready: () => this.actReady(p),
      cast: () => this.actCast(p, action),
      vote: () => this.actVote(p, action.target),
      nominate: () => this.actNominate(p, action.target),
      ghostMessage: () => this.actGhostMessage(p, action.text),
      mediumQuestion: () => this.actMediumQuestion(p),
      ghostAnswer: () => this.actGhostAnswer(p, action.answer),
    };
    if (!Object.hasOwn(handlers, action?.type)) return fail('Unknown action.');
    const result = handlers[action.type]();
    if (result.ok && this.phase === ph) this.maybeAutoAdvance();
    return result;
  }

  actReady(p) {
    if (this.phase.type !== 'roles') return fail('Not now.');
    this.ready.add(p.id);
    return ok;
  }

  availableSpells(p) {
    if (this.phase.type !== 'cast' || !p.alive) return [];
    const list = ['scry', 'curse'];
    if (p.role === 'hunter' && !this.used.trueScry) list.push('trueScry');
    if (p.role === 'medium' && !this.used.vision && this.phase.round >= 2) list.push('vision');
    return list;
  }

  actCast(p, { spell, targets = [] }) {
    if (this.phase.type !== 'cast') return fail('It is not time to cast.');
    if (!p.alive) return fail('Ghosts cannot cast spells.');
    if (!this.availableSpells(p).includes(spell)) return fail('You cannot cast that spell.');
    const need = SPELLS[spell].targets;
    if (!Array.isArray(targets)) return fail('Choose your targets.');
    targets = [...new Set(targets)];
    if (targets.length !== need) return fail(`Choose ${need} different player${need === 1 ? '' : 's'}.`);
    const people = targets.map((id) => this.player(id));
    if (people.some((t) => !t)) return fail('Unknown target.');
    if (spell === 'scry' || spell === 'trueScry' || spell === 'curse') {
      if (targets[0] === p.id) return fail('Choose someone other than yourself.');
    }
    if (spell === 'curse' && people.some((t) => !t.alive)) {
      return fail('That spell needs living targets.');
    }
    this.rounds[this.phase.round].actions[p.id] = { type: spell, targets };
    return ok;
  }

  actVote(p, target) {
    if (this.phase.type !== 'vote') return fail('It is not time to vote.');
    if (!p.alive) return fail('Ghosts cannot vote.');
    const trial = this.trials[this.phase.trial];
    if (!trial.candidates.includes(target)) return fail('That player is not on trial.');
    if (target === p.id) return fail('You cannot vote for yourself.');
    trial.votes[p.id] = target;
    return ok;
  }

  actNominate(p, target) {
    if (this.phase.type !== 'nominate') return fail('It is not time to nominate.');
    if (!p.alive) return fail('Ghosts cannot nominate.');
    const t = this.player(target);
    if (!t || !t.alive || t.id === p.id) return fail('Choose another living player.');
    this.nominations[p.id] = target;
    return ok;
  }

  actGhostMessage(p, text) {
    if (this.phase.type !== 'seance') return fail('The veil is closed.');
    if (!this.isGhost(p)) return fail('Only a Ghost may speak from beyond.');
    const s = this.seances[this.phase.seance];
    if (s.messages[p.id]) return fail('You have already sent your message.');
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    const words = clean ? clean.split(' ').length : 0;
    if (!words) return fail('Your message is empty.');
    if (words > MAX_GHOST_WORDS) return fail(`Eight words or fewer (you have ${words}).`);
    s.messages[p.id] = clean.slice(0, 100);
    return ok;
  }

  // The Medium asks their question out loud; this only tells the Ghosts' phones to offer answers.
  actMediumQuestion(p) {
    if (this.phase.type !== 'seance') return fail('The veil is closed.');
    if (p.role !== 'medium' || !p.alive) return fail('Only the Medium can question the Ghost.');
    const s = this.seances[this.phase.seance];
    if (s.asked) return fail('You have already asked your question.');
    s.asked = true;
    return ok;
  }

  actGhostAnswer(p, answer) {
    if (this.phase.type !== 'seance') return fail('The veil is closed.');
    if (!this.isGhost(p)) return fail('Only a Ghost may answer.');
    const s = this.seances[this.phase.seance];
    if (!s.asked) return fail('The Medium has not asked a question yet.');
    if (s.answers[p.id]) return fail('You have already answered.');
    if (!GHOST_ANSWERS.includes(answer)) return fail('Answer Yes, No, or Unclear.');
    s.answers[p.id] = answer;
    return ok;
  }

  // ---------- host controls ----------

  hostCommand(cmd, arg) {
    switch (cmd) {
      case 'start':
        return this.start();
      case 'kick':
        return this.kick(arg);
      case 'pause':
        if (!this.timer || this.timer.pausedRemaining != null) return fail('Nothing to pause.');
        this.timer = { pausedRemaining: Math.max(0, this.timer.endsAt - this.now()), duration: this.timer.duration };
        return ok;
      case 'resume':
        if (!this.timer || this.timer.pausedRemaining == null) return fail('Not paused.');
        this.timer = { endsAt: this.now() + this.timer.pausedRemaining, duration: this.timer.duration };
        return ok;
      case 'addTime': {
        if (!this.timer) return fail('No timer running.');
        const ms = 30_000;
        if (this.timer.pausedRemaining != null) this.timer.pausedRemaining += ms;
        else this.timer.endsAt += ms;
        this.timer.duration += ms;
        return ok;
      }
      case 'skip':
        if (!this.started || this.phase.type === 'reveal') return fail('Nothing to skip.');
        this.onTimeout();
        return ok;
      case 'newGame':
        this.resetGame();
        return ok;
      case 'endGame':
        this.players = [];
        this.resetGame();
        return ok;
      default:
        return fail('Unknown command.');
    }
  }

  // ---------- views ----------

  timerView() {
    if (!this.timer) return null;
    return {
      endsAt: this.timer.endsAt ?? null,
      pausedRemaining: this.timer.pausedRemaining ?? null,
      duration: this.timer.duration,
      serverNow: this.now(),
    };
  }

  phaseView() {
    const ph = this.phase;
    const view = { ...ph, step: this.phaseIndex, totalSteps: SCHEDULE.length };
    if (ph.type === 'vote') {
      const trial = this.trials[ph.trial];
      view.runoff = trial.runoff;
      view.candidates = trial.candidates.map((id) => ({ id, name: this.player(id).name }));
    }
    if (ph.type === 'defense') {
      const id = this.nominees[ph.index];
      view.defense = { id, name: this.player(id).name, index: ph.index, total: this.nominees.length };
    }
    return view;
  }

  trialView(n) {
    const t = this.trials[n];
    if (!t || !t.tally) return null;
    const condemned = t.condemnedId ? this.player(t.condemnedId) : null;
    return {
      trial: n,
      tally: t.tally.map(({ name, count }) => ({ name, count })),
      runoffFrom: t.previousTally?.map(({ name, count }) => ({ name, count })) ?? null,
      condemned: condemned ? { id: condemned.id, name: condemned.name } : null,
      // Only the Final Trial reveals the condemned player's role.
      condemnedRole: n === FINAL_TRIAL && condemned ? ROLE_INFO[condemned.role].name : null,
      randomTieBreak: !!t.randomTieBreak,
      noVerdict: !!t.noVerdict,
    };
  }

  ghostMessages() {
    return Object.entries(this.seances).flatMap(([n, s]) =>
      Object.entries(s.messages).map(([id, text]) => ({ seance: Number(n), text, from: this.player(id).name })));
  }

  trialViews() {
    return TRIALS.map((n) => this.trialView(n)).filter(Boolean);
  }

  ghostsView() {
    return this.ghosts().map((g) => ({ id: g.id, name: g.name }));
  }

  publicView() {
    const acting = new Set(this.eligible().map((p) => p.id));
    const seance = this.phase.type === 'seance' ? this.seances[this.phase.seance] : null;
    const medium = this.playerByRole('medium');
    return {
      intro: INTRO_TEXT,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      phase: this.phaseView(),
      timer: this.timerView(),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        ghost: this.isGhost(p),
        connected: !!p.connected,
        acting: acting.has(p.id),
        done: acting.has(p.id) && this.hasActed(p.id),
      })),
      ghosts: this.ghostsView(),
      ghostMessages: this.ghostMessages(),
      seance: seance
        ? {
            ghostCount: this.ghosts().length,
            messagesSent: Object.keys(seance.messages).length,
            mediumPresent: !!medium?.alive,
            questionAsked: seance.asked,
            answeredCount: Object.keys(seance.answers).length,
          }
        : null,
      trials: this.trialViews(),
      nominees: this.nominees.map((id) => ({ id, name: this.player(id).name, count: this.nominationCounts?.[id] ?? 0 })),
      outcome: this.phase.type === 'reveal' ? this.outcome : null,
    };
  }

  playerView(id) {
    const p = this.player(id);
    if (!p) return null;
    const ph = this.phase;
    const info = p.role ? ROLE_INFO[p.role] : null;
    const isGhost = this.isGhost(p);
    const view = {
      intro: INTRO_TEXT,
      phase: this.phaseView(),
      timer: this.timerView(),
      players: this.players.map((q) => ({ id: q.id, name: q.name, alive: q.alive, ghost: this.isGhost(q) })),
      you: {
        id: p.id,
        name: p.name,
        alive: p.alive,
        isGhost,
        role: p.role,
        roleName: info?.name ?? null,
        goal: info?.goal ?? null,
        ability: info?.ability ?? null,
        team: info?.team ?? null,
        witchName: p.role === 'familiar' ? this.playerByRole('witch').name : null,
        trueScryUsed: p.role === 'hunter' ? this.used.trueScry : undefined,
        visionUsed: p.role === 'medium' ? this.used.vision : undefined,
      },
      inbox: this.inbox[p.id] ?? [],
      ghostMessages: this.ghostMessages(),
      ghosts: this.ghostsView(),
      trials: this.trialViews(),
      nominees: this.nominees.map((nid) => ({ id: nid, name: this.player(nid).name })),
      acted: this.eligible().some((q) => q.id === p.id) ? this.hasActed(p.id) : null,
    };

    if (ph.type === 'cast') {
      view.spells = this.availableSpells(p).map((key) => ({ key, ...SPELLS[key] }));
      view.myAction = this.rounds[ph.round].actions[p.id] ?? null;
    }
    if (ph.type === 'vote') view.myVote = this.trials[ph.trial].votes[p.id] ?? null;
    if (ph.type === 'nominate') view.myNomination = this.nominations[p.id] ?? null;
    if (ph.type === 'seance') {
      const s = this.seances[ph.seance];
      const isMedium = p.role === 'medium' && p.alive;
      view.seance = {
        ghostCount: this.ghosts().length,
        messagesSent: Object.keys(s.messages).length,
        myMessage: isGhost ? s.messages[p.id] ?? null : null,
        mediumPresent: !!this.playerByRole('medium')?.alive,
        questionAsked: s.asked,
        // The question is spoken aloud, but each answer reaches only the Medium (and the Ghost who gave it).
        myAnswer: isGhost ? s.answers[p.id] ?? null : null,
        answers: isMedium
          ? this.ghosts().map((gh) => ({ from: gh.name, answer: s.answers[gh.id] ?? null }))
          : null,
      };
    }
    // Ghosts see every clue the other players have received.
    if (isGhost) {
      view.allClues = this.players
        .filter((q) => q.id !== p.id)
        .flatMap((q) => (this.inbox[q.id] ?? []).map((c) => ({ ...c, player: q.name })))
        .sort((a, b) => a.round - b.round);
    }
    if (ph.type === 'reveal') {
      view.outcome = this.outcome;
      view.you.won = this.outcome.players.find((q) => q.id === p.id)?.won ?? false;
    }
    return view;
  }
}
