// Witch Trial server: serves the table screen (/host) and phone client (/play), and relays
// actions to each room's game engine over Socket.IO. Each phone only ever receives its own private view.

import express from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
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
const MAX_ROOMS_PER_CLIENT = 5; // villages one network can have open at once
const MAX_CONNECTIONS_PER_CLIENT = 60; // a few full tables sharing one Wi-Fi, with room for reconnects
const TABLE_IDLE_MS = 60 * 60 * 1000; // a room with no game in progress for an hour is closed, even if connected
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, which read as 1 and 0
const CODE_LENGTH = 6; // 24^6 ≈ 191 million codes, so live villages can't be found by guessing
const WRONG_CODE_LIMIT = 20; // wrong village codes one network may try per minute

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

// The header a trusted proxy sets to the client's real address. Render sits behind Cloudflare, whose
// CF-Connecting-IP can't be forged by the client; elsewhere a client could send any header, so the
// socket address is used unless CLIENT_IP_HEADER says otherwise.
const CLIENT_IP_HEADER = (process.env.CLIENT_IP_HEADER || (process.env.RENDER ? 'cf-connecting-ip' : '')).toLowerCase();

const durations = FAST ? scaleDurations(DEFAULT_DURATIONS, 1 / 6) : DEFAULT_DURATIONS;

// The address phones use to join: the deployed URL on Render, otherwise this machine's Wi-Fi address.
const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://${lanAddress()}:${PORT}`)
  .replace(/\/+$/, '');
const joinUrl = (code) => `${publicUrl}/play/?room=${code}`;

// ---------- clients ----------
// Limits are counted per client network rather than per socket, since opening sockets is free.

// The first four groups of an IPv6 address: one household or attacker usually controls a whole /64.
function ipv6Prefix(ip) {
  const [head, tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

function clientOf(socket) {
  const header = CLIENT_IP_HEADER && socket.handshake.headers[CLIENT_IP_HEADER];
  const ip = (typeof header === 'string' && header.trim()) || socket.handshake.address || '';
  const plain = ip.replace(/^::ffff:/, '').replace(/%.*$/, '');
  return net.isIPv6(plain) ? ipv6Prefix(plain) : plain;
}

const connectionsByClient = new Map(); // client -> number of open sockets

// Wrong village codes, per network. Past the limit every lookup is refused until the minute is up,
// whether or not the village exists, so the refusals themselves don't reveal anything.
const wrongCodes = new Map(); // client -> { count, resetAt }

function tooManyWrongCodes(client) {
  const entry = wrongCodes.get(client);
  return !!entry && entry.count >= WRONG_CODE_LIMIT && Date.now() < entry.resetAt;
}

function recordWrongCode(client) {
  const now = Date.now();
  let entry = wrongCodes.get(client);
  if (!entry || now >= entry.resetAt) wrongCodes.set(client, (entry = { count: 0, resetAt: now + 60_000 }));
  entry.count++;
}

// ---------- rooms ----------

const rooms = new Map(); // code -> { code, hostKey, game, socketsByPlayer, client, lastActive, idleSince, joinInfo }

const normalizeCode = (code) => String(code ?? '').trim().toUpperCase();

const roomsOwnedBy = (client) => [...rooms.values()].filter((r) => r.client === client).length;

function createRoom(client) {
  let code;
  do code = Array.from({ length: CODE_LENGTH }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
  while (rooms.has(code));
  const room = {
    code,
    hostKey: randomBytes(16).toString('hex'), // proves a socket is this room's table screen
    game: new Game({ durations }),
    socketsByPlayer: new Map(), // playerId -> Set<socket>
    client, // the network that created it, for the per-client room limit
    lastActive: Date.now(),
    idleSince: Date.now(), // when the table last had no game in progress, or null mid-game
  };
  rooms.set(code, room);
  return room;
}

const hostChannel = (room) => `host:${room.code}`;

// Sends the table screen its join link and QR code. Only a room's host gets these, so there's no
// public way to check whether a village code exists. Encoding the QR code takes ~20ms of CPU, so
// each room makes it once and keeps it: otherwise repeated host:hellos could stall the server.
function sendJoinInfo(socket, room) {
  const url = joinUrl(room.code);
  room.joinInfo ??= QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: '#1a1024', light: '#f4ead5' } })
    .then((qr) => ({ code: room.code, url, qr }));
  room.joinInfo
    .then((info) => socket.emit('host:joinInfo', info))
    .catch((err) => {
      room.joinInfo = null; // try again on the next host:hello
      console.error(`Error making the QR code for ${room.code}:`, err);
    });
}

// Ends a room for everyone in it. Their sockets stay connected so they can open or join another.
function closeRoom(room, reason) {
  rooms.delete(room.code);
  room.closed = true;
  io.to(hostChannel(room)).emit('host:closed', { error: reason });
  io.in(hostChannel(room)).socketsLeave(hostChannel(room));
  for (const sockets of room.socketsByPlayer.values()) {
    for (const s of sockets) s.emit('state', { removed: true, closed: true });
  }
  room.socketsByPlayer.clear();
}

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

const server = http.createServer(app);
const io = new Server(server);

// ---------- input checks ----------
// Socket payloads come straight off the network, so check their shape before they reach a room or
// the engine. Anything that doesn't match is refused rather than coerced.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isOptionalString = (v) => v == null || isString(v);

function isValidAction(a) {
  if (!isObject(a)) return false;
  switch (a.type) {
    case 'ready':
    case 'mediumQuestion':
      return true;
    case 'cast':
      return isString(a.spell) && Array.isArray(a.targets) && a.targets.length <= 4 && a.targets.every(isString);
    case 'vote':
    case 'nominate':
      return isString(a.target);
    case 'ghostMessage':
      return isString(a.text);
    case 'ghostAnswer':
      return isString(a.answer);
    default:
      return false;
  }
}

const INVALID = { ok: false, error: 'Invalid request.' };

// Wraps a listener so it always gets a callable ack and can never throw: an uncaught exception
// in a Socket.IO listener would take down the whole process, and every village with it.
function guard(event, handler) {
  return (...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.pop() : () => {};
    try {
      handler(args[0], ack);
    } catch (err) {
      console.error(`Error handling ${event}:`, err);
      ack({ ok: false, error: 'Something went wrong. Try again.' });
    }
  };
}

// ---------- sockets ----------

io.use((socket, next) => {
  socket.data.client = clientOf(socket);
  if ((connectionsByClient.get(socket.data.client) ?? 0) >= MAX_CONNECTIONS_PER_CLIENT) {
    return next(new Error('Too many connections from your network. Close some tabs and try again.'));
  }
  next();
});

io.on('connection', (socket) => {
  const { client } = socket.data;
  connectionsByClient.set(client, (connectionsByClient.get(client) ?? 0) + 1);

  // A socket is either a table screen or a player, never both. Each mode tracks its own
  // room so host authority can't carry over to a village the socket later joins as a player.
  let hostRoom = null; // the room whose host key this socket has shown
  let playerRoom = null; // the room this socket has joined as a player
  let playerId = null;

  const unbindPlayer = () => {
    if (!playerId) return;
    playerRoom.socketsByPlayer.get(playerId)?.delete(socket);
    broadcast(playerRoom);
    playerRoom = null;
    playerId = null;
  };

  const unbindHost = () => {
    if (!hostRoom) return;
    socket.leave(hostChannel(hostRoom));
    hostRoom = null;
  };

  // The table screen sends the room it created earlier (if any) and gets that room back,
  // or a fresh room if it's gone or the key doesn't match.
  socket.on('host:hello', guard('host:hello', (payload, ack) => {
    if (!isObject(payload)) return ack(INVALID);
    const { code, key } = payload;
    if (!isOptionalString(code) || !isOptionalString(key)) return ack(INVALID);
    let target = rooms.get(normalizeCode(code));
    if (!target || target.hostKey !== key) {
      if (rooms.size >= MAX_ROOMS) return ack({ ok: false, error: 'Too many games are running right now. Try again in a few minutes.' });
      if (roomsOwnedBy(client) >= MAX_ROOMS_PER_CLIENT) {
        return ack({ ok: false, error: `Your network already has ${MAX_ROOMS_PER_CLIENT} villages open. Close one, or wait ten minutes for unused ones to close.` });
      }
      target = createRoom(client);
    }
    unbindPlayer();
    unbindHost();
    hostRoom = target;
    socket.join(hostChannel(hostRoom));
    socket.emit('host:state', hostRoom.game.publicView());
    ack({ ok: true, code: hostRoom.code, key: hostRoom.hostKey, canControl: true });
    sendJoinInfo(socket, hostRoom);
  }));

  socket.on('host:cmd', guard('host:cmd', (payload, ack) => {
    if (!hostRoom) return ack({ ok: false, error: 'Only the table screen can do that.' });
    if (hostRoom.closed) return ack({ ok: false, error: 'This village has closed.' });
    if (!isObject(payload)) return ack(INVALID);
    const { cmd, arg } = payload;
    if (!isString(cmd) || !isOptionalString(arg)) return ack(INVALID);
    const room = hostRoom;
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
    ack(result);
  }));

  socket.on('player:join', guard('player:join', (payload, ack) => {
    if (!isObject(payload)) return ack(INVALID);
    const { room: code, name, token } = payload;
    if (!isOptionalString(code) || !isOptionalString(name) || !isOptionalString(token)) return ack(INVALID);
    if (!normalizeCode(code)) return ack({ ok: false, error: 'Enter the village code from the table screen.', noRoom: true });
    const target = rooms.get(normalizeCode(code));
    // A phone rejoining with its seat token already knows the code, so it isn't held up by guesses
    // made elsewhere on its network. Anyone else is, whether or not the code is real.
    const returning = !!target && !!token && target.game.players.some((p) => p.token === token);
    if (!returning && tooManyWrongCodes(client)) return ack({ ok: false, error: 'Too many wrong codes. Wait a minute and try again.' });
    if (!target) {
      recordWrongCode(client);
      return ack({ ok: false, error: `There's no village with the code ${normalizeCode(code)}. Check the table screen.`, noRoom: true });
    }
    const result = target.game.join(name, token);
    if (result.ok) {
      unbindHost();
      unbindPlayer();
      playerRoom = target;
      playerId = result.id;
      if (!playerRoom.socketsByPlayer.has(playerId)) playerRoom.socketsByPlayer.set(playerId, new Set());
      playerRoom.socketsByPlayer.get(playerId).add(socket);
      broadcast(playerRoom);
    }
    ack({ ...result, code: target.code });
  }));

  socket.on('player:act', guard('player:act', (action, ack) => {
    if (!playerId || playerRoom.closed) return ack({ ok: false, error: 'Join the game first.' });
    if (!isValidAction(action)) return ack(INVALID);
    const result = playerRoom.game.act(playerId, action);
    if (result.ok) broadcast(playerRoom);
    ack(result);
  }));

  socket.on('disconnect', guard('disconnect', () => {
    const count = connectionsByClient.get(client) - 1;
    if (count > 0) connectionsByClient.set(client, count);
    else connectionsByClient.delete(client);
    unbindPlayer();
  }));
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    // A bug in one game must not stop the loop for every other village (or crash the process).
    // A broken game would fail every tick, so only log its first error.
    try {
      if (room.game.tick()) broadcast(room);
    } catch (err) {
      if (!room.tickFailed) console.error(`Error ticking village ${room.code}:`, err);
      room.tickFailed = true;
    }
    // A table with no game in progress (lobby or final reveal) is closed after an hour even if
    // someone is still connected, so idle connections can't hold room slots forever.
    const inProgress = room.game.started && room.game.phase.type !== 'reveal';
    room.idleSince = inProgress ? null : (room.idleSince ?? now);
    if (hasConnections(room)) room.lastActive = now;
    if (now - room.lastActive > ROOM_IDLE_MS) closeRoom(room);
    else if (room.idleSince != null && now - room.idleSince > TABLE_IDLE_MS) {
      closeRoom(room, 'This village closed after an hour without a game in progress.');
    }
  }
}, 250);

setInterval(() => {
  const now = Date.now();
  for (const [client, entry] of wrongCodes) if (now >= entry.resetAt) wrongCodes.delete(client);
}, 60_000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🕯️  Witch Trial is running\n');
  console.log(`  Table screen:  http://localhost:${PORT}/host`);
  console.log(`  Players join:  ${publicUrl}/play/  (the table screen shows each village's link and code)`);
  if (FAST) console.log('  (fast mode: timers shortened for testing)');
  console.log('');
});
