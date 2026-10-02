// Witch Trial server: serves the laptop screen (/host) and phone client (/play), and relays
// actions to the game engine over Socket.IO. Each phone only ever receives its own private view.

import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { DEFAULT_DURATIONS, Game } from './engine/game.js';

const PORT = Number(process.env.PORT) || 3000;
const FAST = !!process.env.WITCH_FAST; // dev mode: every timer is 1/6 as long
const HOST_ANYWHERE = !!process.env.HOST_ANYWHERE; // allow host controls from non-laptop devices

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function scaleDurations(d, factor) {
  return Object.fromEntries(
    Object.entries(d).map(([k, v]) => [
      k,
      typeof v === 'object' ? scaleDurations(v, factor) : Math.max(v ? 5 : 0, Math.round(v * factor)),
    ]),
  );
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return 'localhost';
}

const game = new Game({ durations: FAST ? scaleDurations(DEFAULT_DURATIONS, 1 / 6) : DEFAULT_DURATIONS });
const joinUrl = `http://${lanAddress()}:${PORT}/play`;

const app = express();
app.use(express.static(root));
app.get('/', (_req, res) => res.redirect('/play/'));
app.get('/host', (_req, res) => res.redirect('/host/'));
app.get('/play', (_req, res) => res.redirect('/play/'));
app.get('/rules', (_req, res) => res.redirect('/rules/'));
app.get('/api/join-info', async (_req, res) => {
  const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 480, color: { dark: '#1a1024', light: '#f4ead5' } });
  res.json({ url: joinUrl, qr });
});

const server = http.createServer(app);
const io = new Server(server);

const socketsByPlayer = new Map(); // playerId -> Set<socket>

function isLocal(socket) {
  const addr = socket.handshake.address;
  return HOST_ANYWHERE || addr === '::1' || addr === '127.0.0.1' || addr === '::ffff:127.0.0.1';
}

function broadcast() {
  for (const p of game.players) p.connected = (socketsByPlayer.get(p.id)?.size ?? 0) > 0;
  io.to('host').emit('host:state', game.publicView());
  for (const [id, sockets] of socketsByPlayer) {
    const view = game.playerView(id);
    for (const s of sockets) s.emit('state', view ?? { removed: true });
  }
}

io.on('connection', (socket) => {
  let playerId = null;

  const bindPlayer = (id) => {
    playerId = id;
    if (!socketsByPlayer.has(id)) socketsByPlayer.set(id, new Set());
    socketsByPlayer.get(id).add(socket);
  };

  socket.on('host:hello', (ack) => {
    socket.join('host');
    socket.emit('host:state', game.publicView());
    ack?.({ ok: true, canControl: isLocal(socket) });
  });

  socket.on('host:cmd', ({ cmd, arg } = {}, ack) => {
    if (!isLocal(socket)) return ack?.({ ok: false, error: 'Host controls only work on the laptop running the server.' });
    const result = game.hostCommand(cmd, arg);
    if (cmd === 'kick' || cmd === 'endGame') {
      for (const [id, sockets] of socketsByPlayer) {
        if (!game.player(id)) {
          for (const s of sockets) s.emit('state', { removed: true });
          socketsByPlayer.delete(id);
        }
      }
    }
    broadcast();
    ack?.(result);
  });

  socket.on('player:join', ({ name, token } = {}, ack) => {
    const result = game.join(name, token);
    if (result.ok) {
      bindPlayer(result.id);
      broadcast();
    }
    ack?.(result);
  });

  socket.on('player:act', (action, ack) => {
    if (!playerId) return ack?.({ ok: false, error: 'Join the game first.' });
    const result = game.act(playerId, action);
    if (result.ok) broadcast();
    ack?.(result);
  });

  socket.on('disconnect', () => {
    if (!playerId) return;
    socketsByPlayer.get(playerId)?.delete(socket);
    broadcast();
  });
});

setInterval(() => {
  if (game.tick()) broadcast();
}, 250);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🕯️  Witch Trial is running\n');
  console.log(`  Laptop screen:  http://localhost:${PORT}/host`);
  console.log(`  Players join:   ${joinUrl}`);
  if (FAST) console.log('  (fast mode: timers shortened for testing)');
  console.log('\n  Everyone must be on the same Wi-Fi network.\n');
});
