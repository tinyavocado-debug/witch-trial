// Fills the village with bots that play randomly, for solo testing.
// Usage: npm run bots -- [count] [url]      e.g. npm run bots -- 5
// Join from your own phone/browser too, then press "Begin" on the laptop screen.

import { io } from 'socket.io-client';

const count = Number(process.argv[2]) || 5;
const url = process.argv[3] || 'http://localhost:3000';
const NAMES = ['Agatha', 'Barnaby', 'Cordelia', 'Dorian', 'Esme', 'Fitz', 'Gwendolyn', 'Hollis', 'Isolde', 'Jasper', 'Keziah'];
const GHOST_LINES = ['The quiet one counts the votes.', 'Two monsters argued, but only one lied.', 'Trust the second clue, not the first.'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const later = (fn) => setTimeout(fn, 400 + Math.random() * 2500);

function startBot(name) {
  const socket = io(url);
  let token = null;
  let lastKey = '';
  const messagedSeances = new Set();

  const act = (action) => socket.emit('player:act', action, (res) => {
    if (!res.ok) console.log(`[${name}] ${action.type} rejected: ${res.error}`);
  });

  socket.on('connect', () => {
    socket.emit('player:join', { name, token }, (res) => {
      if (!res.ok) return console.log(`[${name}] could not join: ${res.error}`);
      token = res.token;
    });
  });

  socket.on('state', (v) => {
    if (v.removed) return socket.close();
    const me = v.you;
    const ph = v.phase;
    const key = `${ph.type}:${ph.step}:${ph.runoff}:${v.seance?.questionAsked}`;
    if (key === lastKey) return;
    lastKey = key;
    const others = v.players.filter((p) => p.id !== me.id);
    const livingOthers = others.filter((p) => p.alive);

    if (ph.type === 'reveal') return console.log(`[${name}] ${me.roleName} — ${me.won ? 'won' : 'lost'}`);
    if (ph.type === 'roles') later(() => act({ type: 'ready' }));
    if (!me.alive && ph.type === 'seance') {
      if (!v.seance.myMessage && !messagedSeances.has(ph.seance)) {
        messagedSeances.add(ph.seance);
        later(() => act({ type: 'ghostMessage', text: pick(GHOST_LINES) }));
      }
      if (v.seance.questionAsked && !v.seance.myAnswer) later(() => act({ type: 'ghostAnswer', answer: pick(['Yes', 'No', 'Unclear']) }));
    }
    if (!me.alive) return;

    if (ph.type === 'cast') {
      const spell = pick(v.spells);
      let targets = [];
      if (spell.key === 'curse') targets = [pick(livingOthers).id];
      else if (spell.targets === 1) targets = [pick(others).id];
      later(() => act({ type: 'cast', spell: spell.key, targets }));
    }
    if (ph.type === 'vote') {
      const options = ph.candidates.filter((c) => c.id !== me.id);
      later(() => act({ type: 'vote', target: pick(options).id }));
    }
    if (ph.type === 'nominate') later(() => act({ type: 'nominate', target: pick(livingOthers).id }));
    if (ph.type === 'seance' && me.role === 'medium' && !v.seance.questionAsked) {
      later(() => act({ type: 'mediumQuestion' }));
    }
  });
}

console.log(`Sending ${count} bots to ${url}`);
NAMES.slice(0, count).forEach((name, i) => setTimeout(() => startBot(name), i * 150));
