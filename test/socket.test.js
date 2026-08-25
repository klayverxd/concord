'use strict';

/* Testes de autorização do socket contra o servidor de verdade.
 *
 * Sobe o server.js num porto livre, forja tokens com o segredo real do
 * projeto e verifica o que o servidor RECUSA. O foco é o que não deve
 * passar: token inválido, canal que não é seu, e o buraco da sinalização.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { SignJWT } = require('jose');
const { io: connect } = require('socket.io-client');

const config = require('../lib/config');

const temBanco = Boolean(config.supabase.databaseUrl && config.supabase.jwtSecret);
const store = temBanco ? require('../lib/store') : null;
const opcoes = { skip: !temBanco ? 'sem banco ou segredo no .env' : false };

const PORTA = 3391;
const BASE = `http://127.0.0.1:${PORTA}`;
const segredo = new TextEncoder().encode(config.supabase.jwtSecret);

let servidor;
const pessoas = [];
const sockets = [];

function token(userId, nome) {
  return new SignJWT({
    sub: userId, aud: 'authenticated', role: 'authenticated',
    email: `${nome}@concord.teste`, user_metadata: { full_name: nome }
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setIssuer(config.supabase.issuer).setExpirationTime('1h')
    .sign(segredo);
}

async function novaPessoa(nome) {
  const [{ id }] = await store.sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), ${'00000000-0000-0000-0000-000000000000'},
            ${'authenticated'}, ${'authenticated'},
            ${`sock-${Date.now()}-${Math.floor(Math.random() * 1e6)}@concord.teste`},
            ${''}, now(), now(), now())
    returning id`;
  pessoas.push(id);
  await store.upsertUser({ id, email: `${nome}@concord.teste`, name: nome, avatar: null });
  return { id, nome, token: await token(id, nome) };
}

/** Conecta e resolve quando estiver pronto, ou rejeita com o motivo. */
function conecta(tok) {
  return new Promise((resolve, reject) => {
    const s = connect(BASE, { auth: { token: tok }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err) => reject(new Error(err.message)));
    setTimeout(() => reject(new Error('tempo esgotado')), 8000);
  });
}

const emite = (s, evento, dados) =>
  new Promise((resolve) => {
    s.emit(evento, dados, resolve);
    setTimeout(() => resolve({ error: 'sem resposta' }), 6000);
  });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* Esperar tempo fixo faz o teste passar pelo motivo errado: "a mensagem
 * ainda está lá" é verdade tanto se o servidor recusou quanto se ele só
 * estava lento. Aqui se espera o EVENTO — e o banco é remoto, então cada
 * resolução de permissão custa uma ida de rede. */
function evento(s, nome, timeout = 8000) {
  return new Promise((resolve) => {
    const fim = setTimeout(() => resolve(null), timeout);
    s.once(nome, (dados) => { clearTimeout(fim); resolve(dados || {}); });
  });
}

/** Um dos dois primeiro: usado para "passou ou foi barrado?". */
function primeiroDe(s, nomeA, nomeB, timeout = 8000) {
  return new Promise((resolve) => {
    const fim = setTimeout(() => resolve({ qual: 'nada' }), timeout);
    const pega = (qual) => (dados) => { clearTimeout(fim); resolve({ qual, dados: dados || {} }); };
    s.once(nomeA, pega(nomeA));
    s.once(nomeB, pega(nomeB));
  });
}

before(async () => {
  if (!temBanco) return;
  servidor = spawn(process.execPath, ['server.js'], {
    cwd: require('path').join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORTA) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const pronto = setTimeout(() => reject(new Error('servidor não subiu')), 20000);
    servidor.stdout.on('data', (d) => {
      if (String(d).includes('no ar')) { clearTimeout(pronto); resolve(); }
    });
    servidor.stderr.on('data', (d) => process.stderr.write(`[servidor] ${d}`));
  });
});

after(async () => {
  for (const s of sockets) { try { s.close(); } catch (_) {} }
  if (servidor) { servidor.kill(); }
  if (!temBanco) return;
  for (const id of pessoas) {
    await store.sql`delete from guilds where owner_id = ${id}`;
    await store.sql`delete from auth.users where id = ${id}`;
  }
  await store.close();
});

/* ------------------------------ porta de entrada ------------------------------ */

test('socket sem token não conecta', opcoes, async () => {
  await assert.rejects(() => conecta(undefined), /token ausente|não autenticado|inválido/i);
});

test('socket com token de lixo não conecta', opcoes, async () => {
  await assert.rejects(() => conecta('isto.nao.e.jwt'), /inválido/i);
});

test('a chave anon do projeto não abre socket', opcoes, async () => {
  // Ela está no HTML da página. Se abrisse socket, qualquer visitante entrava.
  await assert.rejects(() => conecta(config.supabase.anonKey), /não é de usuário|inválido/i);
});

test('token válido conecta', opcoes, async () => {
  const p = await novaPessoa('Valida');
  const s = await conecta(p.token);
  assert.ok(s.connected);
});

/* ------------------------------ entrar na voz ------------------------------ */

test('não-membro não entra no canal de voz', opcoes, async () => {
  const dona = await novaPessoa('DonaS1');
  const estranho = await novaPessoa('Estranho1');
  const guild = await store.createGuild(dona.id, 'Servidor S1');
  const voz = (await store.guildChannels(guild.id)).find((c) => c.type === 'voice');

  const s = await conecta(estranho.token);
  const r = await emite(s, 'join-voice', { channelId: voz.id });
  assert.ok(r.error, 'tem que recusar');
  assert.match(r.error, /não encontrado/i, 'e não pode revelar que o canal existe');
});

test('membro entra e recebe as próprias permissões', opcoes, async () => {
  const dona = await novaPessoa('DonaS2');
  const guild = await store.createGuild(dona.id, 'Servidor S2');
  const voz = (await store.guildChannels(guild.id)).find((c) => c.type === 'voice');

  const s = await conecta(dona.token);
  const r = await emite(s, 'join-voice', { channelId: voz.id });
  assert.ok(!r.error, r.error);
  assert.equal(r.channel.id, voz.id);
  assert.equal(r.you.userId, dona.id);
  assert.ok(r.permissions, 'volta com o bitfield');
});

test('sem CONNECT a pessoa não entra, mesmo sendo membro', opcoes, async () => {
  const perms = require('../lib/permissions');
  const dona = await novaPessoa('DonaS3');
  const novato = await novaPessoa('Novato3');
  const guild = await store.createGuild(dona.id, 'Servidor S3');
  await store.addMember(guild.id, novato.id);

  const [everyone] = await store.guildRoles(guild.id);
  const voz = (await store.guildChannels(guild.id)).find((c) => c.type === 'voice');
  await store.setOverwrite(voz.id, 'role', everyone.id, '0', perms.toText(perms.P.CONNECT));

  const s = await conecta(novato.token);
  const r = await emite(s, 'join-voice', { channelId: voz.id });
  assert.match(r.error, /não pode entrar/i);

  // e o dono passa por cima da sobrescrita
  const sd = await conecta(dona.token);
  const rd = await emite(sd, 'join-voice', { channelId: voz.id });
  assert.ok(!rd.error, 'dono entra de qualquer jeito');
});

test('canal de texto não serve de canal de voz', opcoes, async () => {
  const dona = await novaPessoa('DonaS4');
  const guild = await store.createGuild(dona.id, 'Servidor S4');
  const texto = (await store.guildChannels(guild.id)).find((c) => c.type === 'text');

  const s = await conecta(dona.token);
  const r = await emite(s, 'join-voice', { channelId: texto.id });
  assert.match(r.error, /não encontrado/i);
});

/* ------------------------------ o buraco da sinalização ------------------------------ */

test('sinalização não atravessa para quem está em outro canal', opcoes, async () => {
  /* Este é o teste que fecha o buraco: antes, o servidor repassava a oferta
   * WebRTC para qualquer id de socket que o cliente mandasse — inclusive de
   * outro servidor, de outra pessoa qualquer. */
  const dona = await novaPessoa('DonaS5');
  const outra = await novaPessoa('OutraS5');
  const g1 = await store.createGuild(dona.id, 'Servidor A');
  const g2 = await store.createGuild(outra.id, 'Servidor B');
  const voz1 = (await store.guildChannels(g1.id)).find((c) => c.type === 'voice');
  const voz2 = (await store.guildChannels(g2.id)).find((c) => c.type === 'voice');

  const sA = await conecta(dona.token);
  const sB = await conecta(outra.token);
  await emite(sA, 'join-voice', { channelId: voz1.id });
  await emite(sB, 'join-voice', { channelId: voz2.id });

  let chegou = false;
  sB.on('signal', () => { chegou = true; });

  sA.emit('signal', { to: sB.id, description: { type: 'offer', sdp: 'malicioso' } });
  await espera(700);
  assert.equal(chegou, false, 'oferta de outro canal NÃO pode chegar');
});

test('sinalização atravessa entre quem está no mesmo canal', opcoes, async () => {
  const dona = await novaPessoa('DonaS6');
  const amigo = await novaPessoa('AmigoS6');
  const guild = await store.createGuild(dona.id, 'Servidor S6');
  await store.addMember(guild.id, amigo.id);
  const voz = (await store.guildChannels(guild.id)).find((c) => c.type === 'voice');

  const sA = await conecta(dona.token);
  const sB = await conecta(amigo.token);
  await emite(sA, 'join-voice', { channelId: voz.id });
  await emite(sB, 'join-voice', { channelId: voz.id });

  const recebido = new Promise((resolve) => sB.on('signal', resolve));
  sA.emit('signal', { to: sB.id, description: { type: 'offer', sdp: 'legitimo' } });

  const msg = await Promise.race([recebido, espera(3000).then(() => null)]);
  assert.ok(msg, 'no mesmo canal a oferta tem que chegar');
  assert.equal(msg.from, sA.id);
  assert.equal(msg.description.sdp, 'legitimo');
});

test('quem não entrou na voz não consegue sinalizar', opcoes, async () => {
  const dona = await novaPessoa('DonaS7');
  const amigo = await novaPessoa('AmigoS7');
  const guild = await store.createGuild(dona.id, 'Servidor S7');
  await store.addMember(guild.id, amigo.id);
  const voz = (await store.guildChannels(guild.id)).find((c) => c.type === 'voice');

  const dentro = await conecta(dona.token);
  const fora = await conecta(amigo.token);
  await emite(dentro, 'join-voice', { channelId: voz.id });

  let chegou = false;
  dentro.on('signal', () => { chegou = true; });
  fora.emit('signal', { to: dentro.id, description: { type: 'offer', sdp: 'de fora' } });
  await espera(700);
  assert.equal(chegou, false);
});

/* ------------------------------ conversa ------------------------------ */

test('não-membro não lê nem escreve no canal de texto', opcoes, async () => {
  const dona = await novaPessoa('DonaS8');
  const estranho = await novaPessoa('Estranho8');
  const guild = await store.createGuild(dona.id, 'Servidor S8');
  const texto = (await store.guildChannels(guild.id)).find((c) => c.type === 'text');

  const s = await conecta(estranho.token);
  const r = await emite(s, 'history', { channelId: texto.id });
  assert.match(r.error, /não encontrado/i);

  // Escrever tem que ser barrado com aviso, não em silêncio nem gravando.
  const resultado = await primeiroDe(s, 'forced', 'chat');
  s.emit('chat', { channelId: texto.id, text: 'invadindo' });
  const fim = await resultado;
  assert.notEqual(fim.qual, 'chat', 'a mensagem não pode ter sido aceita');

  const gravadas = await store.recentMessages(texto.id, 10);
  assert.equal(gravadas.length, 0, 'nada foi gravado');
});

test('sem SEND_MESSAGES a pessoa lê mas não escreve', opcoes, async () => {
  const perms = require('../lib/permissions');
  const dona = await novaPessoa('DonaS9');
  const leitor = await novaPessoa('Leitor9');
  const guild = await store.createGuild(dona.id, 'Servidor S9');
  await store.addMember(guild.id, leitor.id);

  const [everyone] = await store.guildRoles(guild.id);
  const texto = (await store.guildChannels(guild.id)).find((c) => c.type === 'text');
  await store.setOverwrite(texto.id, 'role', everyone.id, '0', perms.toText(perms.P.SEND_MESSAGES));

  const s = await conecta(leitor.token);
  const r = await emite(s, 'history', { channelId: texto.id });
  assert.ok(!r.error, 'ler continua liberado');

  const avisado = new Promise((resolve) => s.on('forced', resolve));
  s.emit('chat', { channelId: texto.id, text: 'nao devia passar' });
  const aviso = await Promise.race([avisado, espera(2500).then(() => null)]);
  assert.ok(aviso, 'tem que avisar por que não deu');
  assert.match(aviso.reason, /não pode escrever/i);

  assert.equal((await store.recentMessages(texto.id, 10)).length, 0);
});

test('mensagem de membro grava e chega para quem está ouvindo o canal', opcoes, async () => {
  const dona = await novaPessoa('DonaS10');
  const amigo = await novaPessoa('AmigoS10');
  const guild = await store.createGuild(dona.id, 'Servidor S10');
  await store.addMember(guild.id, amigo.id);
  const texto = (await store.guildChannels(guild.id)).find((c) => c.type === 'text');

  const sA = await conecta(dona.token);
  const sB = await conecta(amigo.token);
  sA.emit('watch', { channelId: texto.id });
  sB.emit('watch', { channelId: texto.id });
  await espera(600);

  const chegou = new Promise((resolve) => sB.on('chat', resolve));
  sA.emit('chat', { channelId: texto.id, text: 'ola mundo' });

  const msg = await Promise.race([chegou, espera(4000).then(() => null)]);
  assert.ok(msg, 'a mensagem tem que chegar no outro');
  assert.equal(msg.text, 'ola mundo');
  assert.equal(msg.name, 'DonaS10');

  const gravadas = await store.recentMessages(texto.id, 10);
  assert.equal(gravadas.length, 1, 'e ficar gravada');
});

test('editar mensagem de outra pessoa não passa', opcoes, async () => {
  const dona = await novaPessoa('DonaS11');
  const amigo = await novaPessoa('AmigoS11');
  const guild = await store.createGuild(dona.id, 'Servidor S11');
  await store.addMember(guild.id, amigo.id);
  const texto = (await store.guildChannels(guild.id)).find((c) => c.type === 'text');
  const msg = await store.addMessage(texto.id, dona.id, 'original');

  const s = await conecta(amigo.token);
  await emite(s, 'watch', { channelId: texto.id });

  // Ou vem o aviso de recusa, ou vem a edição aplicada. Não pode ser a segunda.
  const resultado = primeiroDe(s, 'forced', 'chat-edit');
  s.emit('chat-edit', { id: msg.id, text: 'sequestrada' });
  const fim = await resultado;
  assert.notEqual(fim.qual, 'chat-edit', 'a edição não pode ter sido aplicada');
  if (fim.qual === 'forced') assert.match(fim.dados.reason, /só quem escreveu/i);

  const depois = await store.getMessage(msg.id);
  assert.equal(depois.text, 'original', 'o texto não pode ter mudado');
});

test('apagar mensagem de outra pessoa exige MANAGE_MESSAGES', opcoes, async () => {
  const perms = require('../lib/permissions');
  const dona = await novaPessoa('DonaS12');
  const mod = await novaPessoa('ModS12');
  const guild = await store.createGuild(dona.id, 'Servidor S12');
  await store.addMember(guild.id, mod.id);
  const texto = (await store.guildChannels(guild.id)).find((c) => c.type === 'text');

  const alvo1 = await store.addMessage(texto.id, dona.id, 'primeira');
  const s = await conecta(mod.token);
  await emite(s, 'watch', { channelId: texto.id });

  // sem a permissão: tem que vir aviso, e a mensagem fica
  const semPerm = primeiroDe(s, 'forced', 'chat-delete');
  s.emit('chat-delete', { id: alvo1.id });
  const r1 = await semPerm;
  assert.equal(r1.qual, 'forced', 'tem que avisar por que não deu');
  assert.match(r1.dados.reason, /suas mensagens/i);
  assert.ok(await store.getMessage(alvo1.id), 'sem a permissão, continua lá');

  // agora com o cargo certo — resolve() não tem cache, então vale já
  const cargo = await store.createRole(guild.id, {
    name: 'Mod', permissions: perms.toText(perms.P.MANAGE_MESSAGES), position: 5
  });
  await store.assignRole(guild.id, mod.id, cargo.id);

  const alvo2 = await store.addMessage(texto.id, dona.id, 'segunda');
  const comPerm = evento(s, 'chat-delete');
  s.emit('chat-delete', { id: alvo2.id });
  const r2 = await comPerm;
  assert.ok(r2, 'com a permissão, o servidor confirma o apagamento');
  assert.equal(r2.id, alvo2.id);
  assert.equal(await store.getMessage(alvo2.id), null, 'e some do banco');
});

/* ------------------------------ transmissão ------------------------------ */

test('sem STREAM a pessoa não consegue marcar que está transmitindo', opcoes, async () => {
  const perms = require('../lib/permissions');
  const dona = await novaPessoa('DonaS13');
  const novato = await novaPessoa('Novato13');
  const guild = await store.createGuild(dona.id, 'Servidor S13');
  await store.addMember(guild.id, novato.id);

  const [everyone] = await store.guildRoles(guild.id);
  const voz = (await store.guildChannels(guild.id)).find((c) => c.type === 'voice');
  await store.setOverwrite(voz.id, 'role', everyone.id, '0', perms.toText(perms.P.STREAM));

  const s = await conecta(novato.token);
  await emite(s, 'join-voice', { channelId: voz.id });

  const avisado = new Promise((resolve) => s.on('forced', resolve));
  s.emit('state', { sharing: true });
  const aviso = await Promise.race([avisado, espera(2500).then(() => null)]);
  assert.ok(aviso);
  assert.match(aviso.reason, /não pode transmitir/i);
  assert.equal(aviso.sharing, false);
});
