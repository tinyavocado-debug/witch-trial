// Witch Trial server: serves the table screen (/host) and phone client (/play), and relays
// actions to each room's game engine over Socket.IO. Each phone only ever receives its own private view.

import express from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { DEFAULT_DURATIONS, Game } from './engine/game.js';

const PORT = Number(process.env.PORT) || 3000;
const FAST = !!process.env.WITCH_FAST; // dev mode: every timer is 1/6 as long
const ROOM_IDLE_MS = 10 * 60 * 1000; // a room nobody is connected to is deleted after 10 minutes
const MAX_ROOMS = 200;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, which read as 1 and 0

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

const durations = FAST ? scaleDurations(DEFAULT_DURATIONS, 1 / 6) : DEFAULT_DURATIONS;

// The address phones use to join: the deployed URL on Render, otherwise this machine's Wi-Fi address.
const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://${lanAddress()}:${PORT}`)
  .replace(/\/+$/, '');
const joinUrl = (code) => `${publicUrl}/play/?room=${code}`;

// ---------- rooms ----------

const rooms = new Map(); // code -> { code, hostKey, game, socketsByPlayer, lastActive }

const normalizeCode = (code) => String(code ?? '').trim().toUpperCase();

function createRoom() {
  let code;
  do code = Array.from({ length: 4 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
  while (rooms.has(code));
  const room = {
    code,
    hostKey: randomBytes(16).toString('hex'), // proves a socket is this room's table screen
    game: new Game({ durations }),
    socketsByPlayer: new Map(), // playerId -> Set<socket>
    lastActive: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

const hostChannel = (room) => `host:${room.code}`;

function hasConnections(room) {
  if ((io.sockets.adapter.rooms.get(hostChannel(room))?.size ?? 0) > 0) return true;
  for (const sockets of room.socketsByPlayer.values()) if (sockets.size) return true;
  return false;
}

function broadcast(room) {
  const { game, socketsByPlayer } = room;
  for (const p of game.players) p.connected = (socketsByPlayer.get(p.id)?.size ?? 0) > 0;
  io.to(hostChannel(room)).emit('host:state', game.publicView());
  for (const [id, sockets] of socketsByPlayer) {
    const view = game.playerView(id);
    for (const s of sockets) s.emit('state', view ?? { removed: true });
  }
}

// ---------- http ----------

const app = express();
app.use(express.static(root));
app.get('/', (_req, res) => res.redirect('/play/'));
app.get('/host', (_req, res) => res.redirect('/host/'));
app.get('/play', (req, res) => res.redirect(req.originalUrl.replace('/play', '/play/')));
app.get('/rules', (_req, res) => res.redirect('/rules/'));
app.get('/api/join-info', async (req, res) => {
  const room = rooms.get(normalizeCode(req.query.room));
  if (!room) return res.status(404).json({ error: 'No such village.' });
  const url = joinUrl(room.code);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: '#1a1024', light: '#f4ead5' } });
  res.json({ url, qr });
});

const server = http.createServer(app);
const io = new Server(server);

// ---------- sockets ----------

io.on('connection', (socket) => {
  let room = null; // the room this socket belongs to
  let isHost = false; // true once the socket has shown the room's host key
  let playerId = null;

  const unbindPlayer = () => {
    if (!playerId) return;
    room.socketsByPlayer.get(playerId)?.delete(socket);
    playerId = null;
  };

  // The table screen sends the room it created earlier (if any) and gets that room back,
  // or a fresh room if it's gone or the key doesn't match.
  socket.on('host:hello', ({ code, key } = {}, ack) => {
    let target = rooms.get(normalizeCode(code));
    if (!target || target.hostKey !== key) {
      if (rooms.size >= MAX_ROOMS) return ack?.({ ok: false, error: 'Too many games are running right now. Try again in a few minutes.' });
      target = createRoom();
    }
    unbindPlayer();
    if (room) socket.leave(hostChannel(room));
    room = target;
    isHost = true;
    socket.join(hostChannel(room));
    socket.emit('host:state', room.game.publicView());
    ack?.({ ok: true, code: room.code, key: room.hostKey, canControl: true });
  });

  socket.on('host:cmd', ({ cmd, arg } = {}, ack) => {
    if (!isHost) return ack?.({ ok: false, error: 'Only the table screen can do that.' });
    const { game, socketsByPlayer } = room;
    const result = game.hostCommand(cmd, arg);
    if (cmd === 'kick' || cmd === 'endGame') {
      for (const [id, sockets] of socketsByPlayer) {
        if (!game.player(id)) {
          for (const s of sockets) s.emit('state', { removed: true });
          socketsByPlayer.delete(id);
        }
      }
    }
    broadcast(room);
    ack?.(result);
  });

  socket.on('player:join', ({ room: code, name, token } = {}, ack) => {
    const target = rooms.get(normalizeCode(code));
    if (!target) {
      const error = normalizeCode(code)
        ? `There's no village with the code ${normalizeCode(code)}. Check the table screen.`
        : 'Enter the village code from the table screen.';
      return ack?.({ ok: false, error, noRoom: true });
    }
    const result = target.game.join(name, token);
    if (result.ok) {
      unbindPlayer();
      room = target;
      playerId = result.id;
      if (!room.socketsByPlayer.has(playerId)) room.socketsByPlayer.set(playerId, new Set());
      room.socketsByPlayer.get(playerId).add(socket);
      broadcast(room);
    }
    ack?.({ ...result, code: target.code });
  });

  socket.on('player:act', (action, ack) => {
    if (!playerId) return ack?.({ ok: false, error: 'Join the game first.' });
    const result = room.game.act(playerId, action);
    if (result.ok) broadcast(room);
    ack?.(result);
  });

  socket.on('disconnect', () => {
    if (!playerId) return;
    unbindPlayer();
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.game.tick()) broadcast(room);
    if (hasConnections(room)) room.lastActive = now;
    else if (now - room.lastActive > ROOM_IDLE_MS) rooms.delete(room.code);
  }
}, 250);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🕯️  Witch Trial is running\n');
  console.log(`  Table screen:  http://localhost:${PORT}/host`);
  console.log(`  Players join:  ${publicUrl}/play/  (the table screen shows each village's link and code)`);
  if (FAST) console.log('  (fast mode: timers shortened for testing)');
  console.log('');
});
