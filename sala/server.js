'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Áudios gravados trafegam como base64 pelo socket, então o buffer precisa de folga.
const io = new Server(server, { maxHttpBufferSize: 6e6 });

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = Number(process.env.MAX_PER_ROOM || 8);

app.use(express.static(path.join(__dirname, 'public')));

// Servidores de ICE. STUN público basta na maioria das redes domésticas.
// Se alguém do grupo estiver atrás de um NAT simétrico (algumas operadoras
// de celular / redes corporativas), preencha as variáveis de TURN.
app.get('/ice-config', (_req, res) => {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }
  ];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
      username: process.env.TURN_USER,
      credential: process.env.TURN_PASS
    });
  }
  res.json({ iceServers });
});

app.get('/health', (_req, res) => res.send('ok'));

/** @type {Map<string, Map<string, {name: string, muted: boolean, sharing: boolean}>>} */
const rooms = new Map();

function peopleIn(room) {
  const members = rooms.get(room);
  if (!members) return [];
  return [...members.entries()].map(([id, info]) => ({ id, ...info }));
}

io.on('connection', (socket) => {
  let room = null;

  socket.on('join', ({ room: rawRoom, name } = {}, ack) => {
    if (room) return;

    const roomId = String(rawRoom || '').trim().toLowerCase().slice(0, 32);
    const nick = String(name || '').trim().slice(0, 24) || 'anônimo';
    if (!roomId) return ack && ack({ error: 'Escreva o nome do grupo para entrar.' });

    const members = rooms.get(roomId) || new Map();
    if (members.size >= MAX_PER_ROOM) {
      return ack && ack({ error: `Este grupo já está com ${MAX_PER_ROOM} pessoas.` });
    }

    room = roomId;
    socket.join(room);
    members.set(socket.id, { name: nick, muted: false, sharing: false });
    rooms.set(room, members);

    ack && ack({
      you: { id: socket.id, name: nick },
      room,
      peers: peopleIn(room).filter((p) => p.id !== socket.id)
    });

    socket.to(room).emit('peer-joined', { id: socket.id, name: nick, muted: false, sharing: false });
  });

  // Ofertas, respostas e candidatos ICE — o servidor só repassa.
  socket.on('signal', ({ to, description, candidate } = {}) => {
    if (!room || !to) return;
    io.to(to).emit('signal', { from: socket.id, description, candidate });
  });

  socket.on('state', ({ muted, sharing } = {}) => {
    if (!room) return;
    const info = rooms.get(room)?.get(socket.id);
    if (!info) return;
    if (typeof muted === 'boolean') info.muted = muted;
    if (typeof sharing === 'boolean') info.sharing = sharing;
    socket.to(room).emit('peer-state', { id: socket.id, muted: info.muted, sharing: info.sharing });
  });

  socket.on('chat', ({ text } = {}) => {
    if (!room) return;
    const body = String(text || '').slice(0, 2000).trim();
    if (!body) return;
    const info = rooms.get(room)?.get(socket.id);
    io.to(room).emit('chat', {
      id: socket.id,
      name: info?.name || '?',
      text: body,
      at: Date.now()
    });
  });

  socket.on('voice-note', ({ data, seconds, mime } = {}) => {
    if (!room || typeof data !== 'string') return;
    if (data.length > 5e6) return;
    const info = rooms.get(room)?.get(socket.id);
    io.to(room).emit('voice-note', {
      id: socket.id,
      name: info?.name || '?',
      data,
      mime: typeof mime === 'string' ? mime.slice(0, 60) : 'audio/webm',
      seconds: Number(seconds) || 0,
      at: Date.now()
    });
  });

  socket.on('reaction', ({ emoji } = {}) => {
    if (!room) return;
    const info = rooms.get(room)?.get(socket.id);
    io.to(room).emit('reaction', {
      id: socket.id,
      name: info?.name || '?',
      emoji: String(emoji || '').slice(0, 8)
    });
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const members = rooms.get(room);
    if (members) {
      members.delete(socket.id);
      if (members.size === 0) rooms.delete(room);
    }
    socket.to(room).emit('peer-left', { id: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Sala no ar em http://localhost:${PORT}`);
});
