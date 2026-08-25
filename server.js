'use strict';

/* ------------------------------------------------------------------ *
 * Concord — sala de voz, tela e conversa.
 *
 * A voz e a tela vão direto de um computador para o outro (WebRTC em
 * malha). Este servidor faz três coisas: apresenta as pessoas umas às
 * outras, carrega o que é leve (texto, presença, avisos), e — a parte que
 * importa — DECIDE quem pode o quê.
 *
 * Toda decisão de permissão passa por store.resolve(), que lê o banco na
 * hora. Não existe cache: cargo que muda tem que valer no evento seguinte.
 * ------------------------------------------------------------------ */

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');

const config = require('./lib/config');
const auth = require('./lib/auth');
const store = require('./lib/store');
const perms = require('./lib/permissions');
const api = require('./lib/api');

const { P } = perms;

const app = express();
const server = http.createServer(app);

// Áudios gravados e imagens trafegam como base64 pelo socket.
const io = new Server(server, { maxHttpBufferSize: 8e6 });

// Atrás de proxy (Render, Cloudflare) o Express precisa saber que a
// conexão original era HTTPS.
if (config.isProd) app.set('trust proxy', 1);

/* O express.static não comprime nada por conta própria: a página ia em
 * 165 KB de texto puro. Atrás de proxy que já faz gzip é redundante, mas
 * em acesso direto corta para menos de um terço. */
app.use(compression());

/* `no-cache` não quer dizer "não guarde": quer dizer "pergunte antes de
 * usar". O navegador continua guardando e recebe 304 quando nada mudou.
 * Sem isso ele serve o app.js velho e uma correção parece não ter efeito. */
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

app.use('/api', api);

// STUN público basta na maioria das redes domésticas. TURN só é necessário
// para quem estiver atrás de NAT simétrico — operadora de celular, rede
// corporativa. Sem TURN configurado, essas pessoas simplesmente não conectam.
app.get('/ice-config', (_req, res) => {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }
  ];
  if (config.turn.url) {
    iceServers.push({
      urls: config.turn.url.split(',').map((u) => u.trim()),
      username: config.turn.user,
      credential: config.turn.pass
    });
  }
  res.json({ iceServers });
});

app.get('/health', async (_req, res) => {
  try {
    res.json({ ok: await store.health(), auth: config.authReady() });
  } catch (_) {
    res.status(503).json({ ok: false });
  }
});

/* ------------------------------ estado de voz ------------------------------ */

/* Quem está em qual canal de voz vive em memória — é efêmero por natureza,
 * não faz sentido no banco. A chave é o id do socket. */
/** @type {Map<string, {userId, guildId, channelId, name, avatar,
 *                      muted, sharing, deaf, screenId, serverMuted, status, note}>} */
const voz = new Map();

/* Imagem e áudio do chat não vão para o banco (pesado demais para guardar
 * como texto) — mas para apagar com segurança é preciso saber quem mandou.
 * Fica em memória, como o resto do estado efêmero, com uma limpeza
 * periódica para não crescer para sempre. */
const midiaEfemera = new Map(); // id -> { authorId, channelId, at }

setInterval(() => {
  const corte = Date.now() - 48 * 60 * 60 * 1000;
  for (const [id, m] of midiaEfemera) {
    if (m.at < corte) midiaEfemera.delete(id);
  }
}, 60 * 60 * 1000).unref();

const salaDoCanal = (channelId) => `voz:${channelId}`;
const salaDoGuild = (guildId) => `guild:${guildId}`;

function pessoasNoCanal(channelId) {
  const fora = [];
  for (const [socketId, v] of voz) {
    if (v.channelId === channelId) fora.push({ id: socketId, ...v });
  }
  return fora;
}

function mesmoCanal(socketIdA, socketIdB) {
  const a = voz.get(socketIdA);
  const b = voz.get(socketIdB);
  return Boolean(a && b && a.channelId === b.channelId);
}

const novoId = () => Date.now().toString(36) + crypto.randomBytes(5).toString('hex');

/* Freio por socket e por assunto: sem isso uma imagem em laço trava a sala.
 * O zumbido ficou de fora de propósito — foi pedido sem espera. */
function limitador(intervaloMs) {
  const visto = new Map();
  return (chave) => {
    const agora = Date.now();
    if (agora - (visto.get(chave) || 0) < intervaloMs) return false;
    visto.set(chave, agora);
    return true;
  };
}
const podeImagem = limitador(2000);
const podeSom = limitador(1500);

/* --------------------------- autenticação --------------------------- */

// Socket sem token válido não conecta. Assim nenhum handler precisa se
// perguntar se tem alguém do outro lado.
io.use(auth.socketAuth);

io.use(async (socket, next) => {
  try {
    // Garante linha em `users` — as chaves estrangeiras dependem dela.
    await store.upsertUser(socket.user);
    next();
  } catch (err) {
    next(new Error('não foi possível registrar sua conta'));
  }
});

/* --------------------------- ajudantes de permissão --------------------------- */

/* Uma consulta resolve canal, servidor, participação, cargos e sobrescritas.
 * Este é o caminho quente: roda a cada mensagem e a cada tecla de
 * "digitando". Fazer em viagens separadas somava latência em toda ação. */
async function permDoCanal(socket, channelId, { tipo = null, exigida = null } = {}) {
  if (!channelId || typeof channelId !== 'string') return null;

  let r;
  try {
    r = await store.resolveForChannel({ channelId, userId: socket.user.id });
  } catch (_) {
    return null;
  }

  // Canal inexistente, canal de outro tipo e canal que você não pode ver
  // respondem igual: a diferença entre eles já é informação.
  if (!r || !r.isMember) return null;
  if (tipo && r.channel.type !== tipo) return null;
  if (!r.can(P.VIEW_CHANNEL)) return null;
  if (exigida && !r.can(exigida)) return { ...r, negado: true };
  return r;
}

/** Permissão no canal de voz onde o socket está agora. */
async function permDaVoz(socket) {
  const v = voz.get(socket.id);
  if (!v) return null;
  return permDoCanal(socket, v.channelId, { tipo: 'voice' });
}

/* ------------------------------ conexões ------------------------------ */

io.on('connection', (socket) => {
  const eu = socket.user;

  /* --------------------------- entrar na voz --------------------------- */

  socket.on('join-voice', async ({ channelId } = {}, ack) => {
    const responde = (r) => typeof ack === 'function' && ack(r);
    try {
      if (voz.has(socket.id)) return responde({ error: 'Você já está num canal de voz.' });

      const r = await permDoCanal(socket, channelId, { tipo: 'voice', exigida: P.CONNECT });
      if (!r) return responde({ error: 'Canal de voz não encontrado.' });
      if (r.negado) return responde({ error: 'Você não pode entrar neste canal.' });

      if (pessoasNoCanal(channelId).length >= config.maxPerRoom) {
        return responde({ error: `Este canal já está com ${config.maxPerRoom} pessoas.` });
      }

      const canal = r.channel;
      const membros = await store.guildMembers(canal.guildId);
      const meuNome = membros.find((m) => m.id === eu.id)?.name || eu.name;

      const estado = {
        userId: eu.id, guildId: canal.guildId, channelId,
        name: meuNome, avatar: eu.avatar,
        muted: false, sharing: false, deaf: false, screenId: null,
        serverMuted: false, status: 'online', note: ''
      };

      const outros = pessoasNoCanal(channelId);
      voz.set(socket.id, estado);
      socket.join(salaDoCanal(channelId));

      responde({
        you: { id: socket.id, userId: eu.id, name: meuNome },
        channel: { id: canal.id, name: canal.name, guildId: canal.guildId },
        permissions: perms.toText(r.bits),
        peers: outros
      });

      // Alcança quem já está no canal (sinalização WebRTC) E o servidor
      // inteiro (para a lista de "quem está em cada canal" na barra
      // lateral, visível mesmo para quem não entrou).
      socket.to([salaDoCanal(channelId), salaDoGuild(canal.guildId)]).emit('peer-joined', { id: socket.id, ...estado });
    } catch (err) {
      console.error('join-voice:', err);
      responde({ error: 'Não deu para entrar no canal.' });
    }
  });

  socket.on('leave-voice', () => saiDaVoz(socket));

  function saiDaVoz(s) {
    const v = voz.get(s.id);
    if (!v) return;
    voz.delete(s.id);
    s.leave(salaDoCanal(v.channelId));
    io.to([salaDoCanal(v.channelId), salaDoGuild(v.guildId)]).emit('peer-left', { id: s.id, channelId: v.channelId });
  }

  /* --------------------------- sinalização WebRTC --------------------------- */

  /* Aqui morava o buraco: o servidor repassava a oferta para qualquer id
   * que o cliente mandasse. Dava para injetar oferta WebRTC em qualquer
   * pessoa do sistema, inclusive de outro servidor. Agora os dois precisam
   * estar no MESMO canal de voz. */
  socket.on('signal', ({ to, description, candidate } = {}) => {
    if (!to || typeof to !== 'string') return;
    if (!mesmoCanal(socket.id, to)) return;
    io.to(to).emit('signal', { from: socket.id, description, candidate });
  });

  /* --------------------------- estado na voz --------------------------- */

  socket.on('state', async ({ muted, sharing, deaf, screenId } = {}) => {
    const v = voz.get(socket.id);
    if (!v) return;

    if (typeof muted === 'boolean') v.muted = muted;
    if (typeof deaf === 'boolean') v.deaf = deaf;

    // Mudo pelo servidor não se desfaz sozinho: quem foi mutado por
    // moderação não volta a falar clicando no próprio botão.
    if (v.serverMuted) v.muted = true;

    if (typeof sharing === 'boolean') {
      if (sharing) {
        const p = await permDaVoz(socket);
        if (!p || !p.can(P.STREAM)) {
          return socket.emit('forced', { reason: 'Você não pode transmitir tela neste canal.', sharing: false });
        }
      }
      v.sharing = sharing;
    }
    if (screenId !== undefined) v.screenId = typeof screenId === 'string' ? screenId.slice(0, 80) : null;

    socket.to([salaDoCanal(v.channelId), salaDoGuild(v.guildId)]).emit('peer-state', {
      id: socket.id, channelId: v.channelId,
      muted: v.muted, sharing: v.sharing, deaf: v.deaf, screenId: v.screenId
    });
  });

  socket.on('presence', ({ status, note } = {}) => {
    const v = voz.get(socket.id);
    if (!v) return;
    const validos = new Set(['online', 'ocupado', 'volto', 'ausente', 'invisivel']);
    if (typeof status === 'string' && validos.has(status)) v.status = status;
    if (typeof note === 'string') v.note = note.slice(0, 80);
    socket.to([salaDoCanal(v.channelId), salaDoGuild(v.guildId)]).emit('peer-presence', {
      id: socket.id, channelId: v.channelId, status: v.status, note: v.note
    });
  });

  /* Presença de voz de TODO o servidor: quem entra nesta sala descobre quem
   * está em cada canal sem precisar entrar em nenhum. É o que faltava para
   * a barra lateral mostrar ocupantes de qualquer canal, sempre. */
  socket.on('watch-guild', async ({ guildId } = {}, ack) => {
    const responde = (r) => typeof ack === 'function' && ack(r);
    if (!guildId || typeof guildId !== 'string') return responde({ error: 'Servidor inválido.' });
    if (!(await store.isMember(guildId, eu.id))) return responde({ error: 'Servidor não encontrado.' });

    for (const sala of socket.rooms) {
      if (sala.startsWith('guild:')) socket.leave(sala);
    }
    socket.join(salaDoGuild(guildId));

    const porCanal = {};
    for (const [socketId, v] of voz) {
      if (v.guildId !== guildId) continue;
      (porCanal[v.channelId] ||= []).push({
        id: socketId, userId: v.userId, name: v.name, avatar: v.avatar,
        muted: v.muted, sharing: v.sharing, deaf: v.deaf, screenId: v.screenId
      });
    }
    responde({ channels: porCanal });
  });

  /* --------------------------- conversa --------------------------- */

  const podeTexto = (channelId, exigida) =>
    permDoCanal(socket, channelId, { tipo: 'text', exigida });

  socket.on('history', async ({ channelId, before } = {}, ack) => {
    const responde = (r) => typeof ack === 'function' && ack(r);
    const ctx = await podeTexto(channelId);
    if (!ctx) return responde({ error: 'Canal não encontrado.' });
    responde({ messages: await store.recentMessages(channelId, 50, before || null) });
  });

  socket.on('chat', async ({ channelId, text, replyTo } = {}) => {
    const ctx = await podeTexto(channelId, P.SEND_MESSAGES);
    if (!ctx || ctx.negado) {
      return socket.emit('forced', { reason: 'Você não pode escrever neste canal.' });
    }
    try {
      const msg = await store.addMessage(channelId, eu.id, text, replyTo || null);
      io.to(`texto:${channelId}`).emit('chat', msg);
    } catch (err) {
      socket.emit('forced', { reason: err.message || 'Não deu para enviar.' });
    }
  });

  socket.on('chat-edit', async ({ id, text } = {}) => {
    const dono = await store.messageAuthor(id);
    if (!dono) return;
    const ctx = await podeTexto(dono.channelId, P.SEND_MESSAGES);
    if (!ctx || ctx.negado) return;

    try {
      const msg = await store.editMessage(id, eu.id, text);
      io.to(`texto:${dono.channelId}`).emit('chat-edit', {
        id: msg.id, text: msg.text, editedAt: msg.editedAt
      });
    } catch (err) {
      socket.emit('forced', { reason: err.message });
    }
  });

  /* Apagar: o próprio autor sempre pode; apagar de outra pessoa exige
   * MANAGE_MESSAGES. Imagem e áudio não estão no banco (são efêmeros),
   * então são checados contra `midiaEfemera` antes de tentar como mensagem
   * de texto — sem essa checagem, um id que não é UUID quebrava a consulta
   * no Postgres e o pedido de apagar simplesmente dava erro. */
  socket.on('chat-delete', async ({ id } = {}) => {
    if (typeof id !== 'string') return;

    const midia = midiaEfemera.get(id);
    if (midia) {
      const ctx = await podeTexto(midia.channelId);
      if (!ctx) return;
      const meuTexto = midia.authorId === eu.id;
      if (!meuTexto && !ctx.can(P.MANAGE_MESSAGES)) {
        return socket.emit('forced', { reason: 'Você só pode apagar as suas mensagens.' });
      }
      midiaEfemera.delete(id);
      io.to(`texto:${midia.channelId}`).emit('chat-delete', { id });
      if (!meuTexto) {
        await store.audit(ctx.channel.guildId, eu.id, 'apagou_mensagem', midia.authorId, { mensagem: id });
      }
      return;
    }

    // Mensagem de texto de verdade tem id uuid; imagem/áudio que já saiu
    // da limpeza de 48h e não é mais achado em nenhum dos dois lados cai
    // aqui — sem isso um id de mídia velho quebrava a consulta no Postgres.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;

    const dono = await store.messageAuthor(id);
    if (!dono) return;
    const ctx = await podeTexto(dono.channelId);
    if (!ctx) return;

    const meuTexto = dono.authorId === eu.id;
    if (!meuTexto && !ctx.can(P.MANAGE_MESSAGES)) {
      return socket.emit('forced', { reason: 'Você só pode apagar as suas mensagens.' });
    }

    await store.deleteMessage(id);
    io.to(`texto:${dono.channelId}`).emit('chat-delete', { id });
    if (!meuTexto) {
      await store.audit(ctx.channel.guildId, eu.id, 'apagou_mensagem', dono.authorId, { mensagem: id });
    }
  });

  socket.on('chat-react', async ({ id, emoji } = {}) => {
    const dono = await store.messageAuthor(id);
    if (!dono) return;
    const ctx = await podeTexto(dono.channelId);
    if (!ctx) return;

    try {
      const quem = await store.toggleReaction(id, eu.id, emoji);
      io.to(`texto:${dono.channelId}`).emit('chat-react', { id, emoji, who: quem });
    } catch (_) { /* mensagem sumiu no meio */ }
  });

  socket.on('typing', async ({ channelId } = {}) => {
    const ctx = await podeTexto(channelId, P.SEND_MESSAGES);
    if (!ctx || ctx.negado) return;
    socket.to(`texto:${channelId}`).emit('typing', { id: socket.id, name: eu.name });
  });

  // Entrar e sair da "escuta" de um canal de texto — é isso que decide para
  // quem a mensagem é entregue.
  socket.on('watch', async ({ channelId } = {}, ack) => {
    const ctx = await podeTexto(channelId);
    if (!ctx) return typeof ack === 'function' && ack({ error: 'Canal não encontrado.' });
    for (const sala of socket.rooms) {
      if (sala.startsWith('texto:')) socket.leave(sala);
    }
    socket.join(`texto:${channelId}`);
    if (typeof ack === 'function') ack({ ok: true });
  });

  /* --------------------------- mídia no chat --------------------------- */

  socket.on('image', async ({ channelId, data, mime, name: fileName } = {}) => {
    if (typeof data !== 'string' || data.length > 3e6) return;
    if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(data)) return;
    if (!podeImagem(socket.id)) return;

    const ctx = await podeTexto(channelId, P.SEND_MESSAGES);
    if (!ctx || ctx.negado) {
      return socket.emit('forced', { reason: 'Você não pode escrever neste canal.' });
    }

    const id = novoId();
    midiaEfemera.set(id, { authorId: eu.id, channelId, at: Date.now() });
    io.to(`texto:${channelId}`).emit('image', {
      id, kind: 'image', uid: eu.id, name: eu.name, channelId,
      data, mime: typeof mime === 'string' ? mime.slice(0, 40) : 'image/png',
      fileName: String(fileName || 'imagem').slice(0, 60), at: Date.now(), reactions: {}
    });
  });

  socket.on('voice-note', async ({ channelId, data, seconds, mime } = {}) => {
    if (typeof data !== 'string' || data.length > 5e6) return;

    const ctx = await podeTexto(channelId, P.SEND_MESSAGES);
    if (!ctx || ctx.negado) return;

    const id = novoId();
    midiaEfemera.set(id, { authorId: eu.id, channelId, at: Date.now() });
    io.to(`texto:${channelId}`).emit('voice-note', {
      id, kind: 'audio', uid: eu.id, name: eu.name, channelId,
      data, mime: typeof mime === 'string' ? mime.slice(0, 60) : 'audio/webm',
      seconds: Number(seconds) || 0, at: Date.now(), reactions: {}
    });
  });

  /* --------------------------- atenção --------------------------- */

  socket.on('reaction', ({ emoji } = {}) => {
    const v = voz.get(socket.id);
    if (!v) return;
    io.to(salaDoCanal(v.channelId)).emit('reaction', {
      id: socket.id, name: v.name, emoji: String(emoji || '').slice(0, 8)
    });
  });

  // Sem espera entre um e outro, como foi pedido.
  socket.on('nudge', () => {
    const v = voz.get(socket.id);
    if (!v) return;
    io.to(salaDoCanal(v.channelId)).emit('nudge', { id: socket.id, name: v.name });
  });

  // O som vai misturado no áudio de quem tocou, pelo WebRTC. Aqui só o aviso.
  socket.on('soundboard', ({ label } = {}) => {
    const v = voz.get(socket.id);
    if (!v || !podeSom(socket.id)) return;
    socket.to(salaDoCanal(v.channelId)).emit('soundboard', {
      id: socket.id, name: v.name, label: String(label || '').slice(0, 24)
    });
  });

  /* --------------------------- moderação de voz --------------------------- */

  /* Mutar, ensurdecer, arrastar e desconectar alguém. Cada um exige a
   * permissão E alcance na hierarquia: ter MUTE_MEMBERS não pode virar
   * caminho para calar o dono. */
  async function moderar(alvoSocketId, permissao, oQue) {
    const v = voz.get(socket.id);
    const alvo = voz.get(alvoSocketId);
    if (!v || !alvo || v.channelId !== alvo.channelId) return null;

    const p = await permDaVoz(socket);
    if (!p || !p.can(permissao)) {
      socket.emit('forced', { reason: `Você não pode ${oQue}.` });
      return null;
    }
    if (!(await store.canActOn(v.guildId, eu.id, alvo.userId))) {
      socket.emit('forced', { reason: 'Você não alcança essa pessoa na hierarquia.' });
      return null;
    }
    return { v, alvo };
  }

  socket.on('server-mute', async ({ id: alvoId, muted } = {}) => {
    const r = await moderar(alvoId, P.MUTE_MEMBERS, 'mutar alguém');
    if (!r) return;

    r.alvo.serverMuted = Boolean(muted);
    r.alvo.muted = r.alvo.serverMuted || r.alvo.muted;
    io.to(alvoId).emit('forced', {
      reason: r.alvo.serverMuted ? 'Você foi mutado por um moderador.' : 'Você já pode falar.',
      muted: r.alvo.muted
    });
    io.to([salaDoCanal(r.v.channelId), salaDoGuild(r.v.guildId)]).emit('peer-state', {
      id: alvoId, channelId: r.v.channelId,
      muted: r.alvo.muted, sharing: r.alvo.sharing, deaf: r.alvo.deaf, screenId: r.alvo.screenId
    });
    await store.audit(r.v.guildId, eu.id, muted ? 'mutou' : 'desmutou', r.alvo.userId);
  });

  socket.on('disconnect-member', async ({ id: alvoId } = {}) => {
    const r = await moderar(alvoId, P.MOVE_MEMBERS, 'desconectar alguém');
    if (!r) return;

    const alvoSocket = io.sockets.sockets.get(alvoId);
    io.to(alvoId).emit('forced', { reason: 'Você foi desconectado do canal.', disconnected: true });
    if (alvoSocket) saiDaVoz(alvoSocket);
    await store.audit(r.v.guildId, eu.id, 'desconectou', r.alvo.userId);
  });

  /* --------------------------- saída --------------------------- */

  socket.on('disconnect', () => saiDaVoz(socket));
});

/* ------------------------------ subir ------------------------------ */

server.listen(config.port, () => {
  console.log(`Concord no ar em http://localhost:${config.port}`);
  const falta = config.missing();
  if (falta.length) {
    console.log(`  atenção: sem ${falta.join(', ')} — contas e cargos não vão funcionar.`);
  }
});

/* Serviço de hospedagem manda SIGTERM antes de trocar a versão. Sem tratar,
 * as conexões caem no meio da frase. */
let encerrando = false;
['SIGTERM', 'SIGINT'].forEach((sinal) => {
  process.on(sinal, () => {
    if (encerrando) return process.exit(0);
    encerrando = true;
    console.log(`\n${sinal} recebido — encerrando.`);
    io.close(async () => {
      try { await store.close(); } catch (_) {}
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
});
