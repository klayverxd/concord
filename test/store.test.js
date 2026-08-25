'use strict';

/* Testes da camada de dados contra o Postgres real do projeto.
 *
 * Cria pessoas de mentira em auth.users, faz o trabalho, e apaga tudo no
 * final — inclusive se algum teste falhar. Se o .env não tiver o banco, o
 * arquivo inteiro é pulado em vez de explodir. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const perms = require('../lib/permissions');
const { P } = perms;

const temBanco = Boolean(config.supabase.databaseUrl);
const store = temBanco ? require('../lib/store') : null;

const criados = [];   // ids em auth.users, para a limpeza

async function novaPessoa(nome) {
  const [{ id }] = await store.sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), ${'00000000-0000-0000-0000-000000000000'},
            ${'authenticated'}, ${'authenticated'},
            ${`teste-${Date.now()}-${Math.floor(Math.random() * 1e6)}@concord.teste`},
            ${''}, now(), now(), now())
    returning id`;
  criados.push(id);
  return store.upsertUser({ id, email: `${nome}@concord.teste`, name: nome, avatar: null });
}

after(async () => {
  if (!temBanco) return;
  // Servidores primeiro: guilds.owner_id é RESTRICT de propósito.
  for (const id of criados) {
    await store.sql`delete from guilds where owner_id = ${id}`;
    await store.sql`delete from auth.users where id = ${id}`;
  }
  await store.close();
});

const opcoes = { skip: !temBanco ? 'sem DATABASE_URL no .env' : false };

/* ------------------------------ pessoas ------------------------------ */

test('upsertUser cria e depois atualiza sem duplicar', opcoes, async () => {
  const pessoa = await novaPessoa('Ana');
  assert.equal(pessoa.name, 'Ana');

  const outra = await store.upsertUser({ id: pessoa.id, email: 'ana2@x.com', name: 'Ana Maria', avatar: 'http://a/b.png' });
  assert.equal(outra.id, pessoa.id);
  assert.equal(outra.name, 'Ana Maria');

  // avatar novo não pode ser apagado por um login que veio sem avatar
  const semAvatar = await store.upsertUser({ id: pessoa.id, email: 'ana2@x.com', name: 'Ana Maria', avatar: null });
  assert.equal(semAvatar.avatar_url, 'http://a/b.png');
});

/* ------------------------------ servidor novo ------------------------------ */

test('servidor nasce completo e o dono pode tudo', opcoes, async () => {
  const dona = await novaPessoa('Dona');
  const guild = await store.createGuild(dona.id, '  Os Cria  ');

  assert.equal(guild.name, 'Os Cria', 'o nome é aparado');

  const canais = await store.guildChannels(guild.id);
  const cargos = await store.guildRoles(guild.id);
  assert.equal(canais.length, 2);
  assert.deepEqual(canais.map((c) => c.type).sort(), ['text', 'voice']);
  assert.equal(cargos.length, 1);
  assert.ok(cargos[0].isEveryone);
  assert.ok(await store.isMember(guild.id, dona.id));

  const r = await store.resolve({ guildId: guild.id, userId: dona.id });
  assert.equal(r.bits, perms.ALL, 'dono recebe tudo sem ter cargo');
  assert.ok(r.can(P.BAN_MEMBERS));
});

test('nome vazio não cria servidor', opcoes, async () => {
  const p = await novaPessoa('Vazio');
  await assert.rejects(() => store.createGuild(p.id, '   '), /nome/i);
});

/* ------------------------------ membros e cargos ------------------------------ */

test('quem entra recebe o piso do @everyone, e nada mais', opcoes, async () => {
  const dona = await novaPessoa('Dona2');
  const novato = await novaPessoa('Novato');
  const guild = await store.createGuild(dona.id, 'Servidor');
  await store.addMember(guild.id, novato.id);

  const r = await store.resolve({ guildId: guild.id, userId: novato.id });
  assert.ok(r.can(P.VIEW_CHANNEL));
  assert.ok(r.can(P.SPEAK));
  assert.ok(!r.can(P.KICK_MEMBERS), 'piso não inclui moderar');
  assert.ok(!r.can(P.ADMINISTRATOR));
});

test('cargo dado à pessoa soma permissão', opcoes, async () => {
  const dona = await novaPessoa('Dona3');
  const mod = await novaPessoa('Mod');
  const guild = await store.createGuild(dona.id, 'Servidor');
  await store.addMember(guild.id, mod.id);

  const cargo = await store.createRole(guild.id, {
    name: 'Moderador', permissions: perms.toText(P.KICK_MEMBERS), position: 5
  });
  await store.assignRole(guild.id, mod.id, cargo.id);

  const r = await store.resolve({ guildId: guild.id, userId: mod.id });
  assert.ok(r.can(P.KICK_MEMBERS));
  assert.ok(r.can(P.SPEAK), 'continua com o piso do @everyone');

  // memberRoles tem que trazer o @everyone junto — o esquecimento clássico
  const cargos = await store.memberRoles(guild.id, mod.id);
  assert.equal(cargos.length, 2);
  assert.ok(cargos.some((c) => c.isEveryone));

  await store.unassignRole(guild.id, mod.id, cargo.id);
  const depois = await store.resolve({ guildId: guild.id, userId: mod.id });
  assert.ok(!depois.can(P.KICK_MEMBERS));
});

test('o @everyone é protegido de renome, reposição e exclusão', opcoes, async () => {
  const dona = await novaPessoa('Dona4');
  const guild = await store.createGuild(dona.id, 'Servidor');
  const [everyone] = await store.guildRoles(guild.id);

  const tentativa = await store.updateRole(everyone.id, { name: 'outro nome', position: 99 });
  assert.equal(tentativa.name, '@everyone');
  assert.equal(tentativa.position, 0);

  await assert.rejects(() => store.deleteRole(everyone.id), /everyone/i);
});

test('banco recusa um segundo @everyone', opcoes, async () => {
  const dona = await novaPessoa('Dona5');
  const guild = await store.createGuild(dona.id, 'Servidor');
  await assert.rejects(
    () => store.sql`insert into roles (guild_id, name, is_everyone) values (${guild.id}, ${'falso'}, true)`,
    (e) => e.code === '23505'
  );
});

test('cargo de outro servidor não pode ser atribuído', opcoes, async () => {
  const dona = await novaPessoa('Dona6');
  const g1 = await store.createGuild(dona.id, 'Um');
  const g2 = await store.createGuild(dona.id, 'Dois');
  const cargo = await store.createRole(g2.id, { name: 'Alheio', permissions: '0', position: 2 });

  await assert.rejects(() => store.assignRole(g1.id, dona.id, cargo.id), /não é deste servidor/i);
});

/* ------------------------------ canais trancados ------------------------------ */

test('canal trancado esconde de quem não tem o cargo', opcoes, async () => {
  const dona = await novaPessoa('Dona7');
  const vet = await novaPessoa('Veterano');
  const novato = await novaPessoa('Novato2');
  const guild = await store.createGuild(dona.id, 'Servidor');
  await store.addMember(guild.id, vet.id);
  await store.addMember(guild.id, novato.id);

  const [everyone] = await store.guildRoles(guild.id);
  const cargoVet = await store.createRole(guild.id, { name: 'Veterano', permissions: '0', position: 4 });
  await store.assignRole(guild.id, vet.id, cargoVet.id);

  const secreto = await store.createChannel(guild.id, 'voice', 'Veteranos');
  await store.setOverwrite(secreto.id, 'role', everyone.id, '0', perms.toText(P.VIEW_CHANNEL | P.CONNECT));
  await store.setOverwrite(secreto.id, 'role', cargoVet.id, perms.toText(P.VIEW_CHANNEL | P.CONNECT), '0');

  const doNovato = await store.resolve({ guildId: guild.id, userId: novato.id, channelId: secreto.id });
  assert.ok(!doNovato.can(P.VIEW_CHANNEL));
  assert.ok(!doNovato.can(P.CONNECT));

  const doVet = await store.resolve({ guildId: guild.id, userId: vet.id, channelId: secreto.id });
  assert.ok(doVet.can(P.CONNECT));
  assert.ok(doVet.can(P.SPEAK), 'o piso do @everyone atravessa');

  // e a lista de canais visíveis tem que refletir isso
  const vistosNovato = await store.visibleChannels(guild.id, novato.id);
  const vistosVet = await store.visibleChannels(guild.id, vet.id);
  assert.ok(!vistosNovato.some((c) => c.id === secreto.id), 'novato não vê o canal na lista');
  assert.ok(vistosVet.some((c) => c.id === secreto.id));

  // dono passa por cima de qualquer sobrescrita
  const vistosDona = await store.visibleChannels(guild.id, dona.id);
  assert.ok(vistosDona.some((c) => c.id === secreto.id));
});

test('sobrescrita contraditória resolve a favor do permitir', opcoes, async () => {
  const dona = await novaPessoa('Dona8');
  const guild = await store.createGuild(dona.id, 'Servidor');
  const [everyone] = await store.guildRoles(guild.id);
  const [canal] = await store.guildChannels(guild.id);

  await store.setOverwrite(canal.id, 'role', everyone.id, perms.toText(P.SPEAK), perms.toText(P.SPEAK));
  const [ow] = await store.channelOverwrites(canal.id);
  assert.equal(ow.allow, perms.toText(P.SPEAK));
  assert.equal(ow.deny, '0', 'o bit contraditório sai do deny');
});

test('canal de outro servidor é recusado na resolução', opcoes, async () => {
  const dona = await novaPessoa('Dona9');
  const g1 = await store.createGuild(dona.id, 'Um');
  const g2 = await store.createGuild(dona.id, 'Dois');
  const [canalDeOutro] = await store.guildChannels(g2.id);

  await assert.rejects(
    () => store.resolve({ guildId: g1.id, userId: dona.id, channelId: canalDeOutro.id }),
    /não é deste servidor/i
  );
});

/* ------------------------------ hierarquia ------------------------------ */

test('hierarquia: só alcança quem está abaixo, e ninguém alcança o dono', opcoes, async () => {
  const dona = await novaPessoa('DonaH');
  const chefe = await novaPessoa('Chefe');
  const meio = await novaPessoa('Meio');
  const outroMeio = await novaPessoa('OutroMeio');
  const guild = await store.createGuild(dona.id, 'Servidor');
  for (const p of [chefe, meio, outroMeio]) await store.addMember(guild.id, p.id);

  const alto = await store.createRole(guild.id, { name: 'Alto', permissions: perms.toText(P.KICK_MEMBERS), position: 9 });
  const medio = await store.createRole(guild.id, { name: 'Medio', permissions: perms.toText(P.KICK_MEMBERS), position: 5 });
  await store.assignRole(guild.id, chefe.id, alto.id);
  await store.assignRole(guild.id, meio.id, medio.id);
  await store.assignRole(guild.id, outroMeio.id, medio.id);

  assert.ok(await store.canActOn(guild.id, chefe.id, meio.id));
  assert.ok(!(await store.canActOn(guild.id, meio.id, chefe.id)));
  assert.ok(!(await store.canActOn(guild.id, meio.id, outroMeio.id)), 'mesmo nível não alcança');
  assert.ok(!(await store.canActOn(guild.id, chefe.id, dona.id)), 'ninguém alcança o dono');
  assert.ok(await store.canActOn(guild.id, dona.id, chefe.id));
});

/* ------------------------------ convites ------------------------------ */

test('convite entra na sala uma vez e conta o uso', opcoes, async () => {
  const dona = await novaPessoa('DonaI');
  const amigo = await novaPessoa('Amigo');
  const guild = await store.createGuild(dona.id, 'Servidor');

  const convite = await store.createInvite(guild.id, dona.id, { horas: 24, maxUsos: 1 });
  assert.match(convite.code, /^[A-Z2-9]{8}$/);

  const r1 = await store.redeemInvite(convite.code, amigo.id);
  assert.equal(r1.guild.id, guild.id);
  assert.equal(r1.already, false);
  assert.ok(await store.isMember(guild.id, amigo.id));

  // Quem já é membro é atendido mesmo com o convite esgotado — clicar de
  // novo no próprio link não pode dizer "não vale mais" para quem está lá.
  const r2 = await store.redeemInvite(convite.code, amigo.id);
  assert.equal(r2.already, true);
  assert.equal(r2.guild.id, guild.id);

  // mas o limite de 1 uso está esgotado para quem está de fora
  const estranho = await novaPessoa('Estranho');
  await assert.rejects(() => store.redeemInvite(convite.code, estranho.id), /não vale mais/i);

  // e o mesmo vale para convite vencido: membro entra, estranho não
  await store.sql`update invites set expires_at = now() - interval '1 day' where code = ${convite.code}`;
  const r3 = await store.redeemInvite(convite.code, amigo.id);
  assert.equal(r3.already, true, 'membro passa mesmo com o convite vencido');
});

test('convite vencido é recusado', opcoes, async () => {
  const dona = await novaPessoa('DonaJ');
  const alguem = await novaPessoa('Alguem');
  const guild = await store.createGuild(dona.id, 'Servidor');

  const convite = await store.createInvite(guild.id, dona.id, { horas: 24 });
  await store.sql`update invites set expires_at = now() - interval '1 hour' where code = ${convite.code}`;
  await assert.rejects(() => store.redeemInvite(convite.code, alguem.id), /não vale mais/i);
});

test('código inexistente é recusado sem explodir', opcoes, async () => {
  const p = await novaPessoa('DonaK');
  await assert.rejects(() => store.redeemInvite('ZZZZZZZZ', p.id), /não vale mais/i);
});

/* ------------------------------ banimento ------------------------------ */

test('banido sai do servidor e o convite não o traz de volta', opcoes, async () => {
  const dona = await novaPessoa('DonaL');
  const chato = await novaPessoa('Chato');
  const guild = await store.createGuild(dona.id, 'Servidor');
  await store.addMember(guild.id, chato.id);

  const convite = await store.createInvite(guild.id, dona.id, {});
  await store.banMember(guild.id, chato.id, dona.id, 'testando');

  assert.ok(await store.isBanned(guild.id, chato.id));
  assert.ok(!(await store.isMember(guild.id, chato.id)), 'banir também remove');
  await assert.rejects(() => store.redeemInvite(convite.code, chato.id), /banido/i);

  await store.unbanMember(guild.id, chato.id);
  const volta = await store.redeemInvite(convite.code, chato.id);
  assert.equal(volta.guild.id, guild.id);
});

/* ------------------------------ conversa ------------------------------ */

test('mensagem grava, edita, reage e apaga', opcoes, async () => {
  const dona = await novaPessoa('DonaM');
  const outra = await novaPessoa('Outra');
  const guild = await store.createGuild(dona.id, 'Servidor');
  await store.addMember(guild.id, outra.id);
  const canal = (await store.guildChannels(guild.id)).find((c) => c.type === 'text');

  const m1 = await store.addMessage(canal.id, dona.id, '  primeira  ');
  assert.equal(m1.text, 'primeira', 'texto é aparado');
  assert.equal(m1.name, 'DonaM');
  assert.equal(m1.editedAt, null);

  const resposta = await store.addMessage(canal.id, outra.id, 'respondendo', m1.id);
  assert.equal(resposta.replyTo.id, m1.id);
  assert.equal(resposta.replyTo.name, 'DonaM');

  const editada = await store.editMessage(m1.id, dona.id, 'corrigida');
  assert.equal(editada.text, 'corrigida');
  assert.ok(editada.editedAt);

  // só quem escreveu edita
  await assert.rejects(() => store.editMessage(m1.id, outra.id, 'invadindo'), /só quem escreveu/i);

  const quem1 = await store.toggleReaction(m1.id, outra.id, '🔥');
  assert.deepEqual(quem1, [outra.id]);
  const quem2 = await store.toggleReaction(m1.id, dona.id, '🔥');
  assert.equal(quem2.length, 2);
  const quem3 = await store.toggleReaction(m1.id, outra.id, '🔥');   // desliga
  assert.deepEqual(quem3, [dona.id]);

  const lista = await store.recentMessages(canal.id, 50);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].id, m1.id, 'ordem é do mais antigo para o mais novo');
  assert.deepEqual(Object.keys(lista[0].reactions), ['🔥']);

  await store.deleteMessage(m1.id);
  const depois = await store.recentMessages(canal.id, 50);
  assert.equal(depois.length, 1, 'apagada sai da lista');
  assert.equal(await store.getMessage(m1.id), null);
});

test('apelido do servidor aparece no lugar do nome real', opcoes, async () => {
  const dona = await novaPessoa('NomeReal');
  const guild = await store.createGuild(dona.id, 'Servidor');
  const canal = (await store.guildChannels(guild.id)).find((c) => c.type === 'text');

  await store.setNickname(guild.id, dona.id, 'Apelido');
  const m = await store.addMessage(canal.id, dona.id, 'oi');
  assert.equal(m.name, 'Apelido');

  const [membro] = await store.guildMembers(guild.id);
  assert.equal(membro.name, 'Apelido');
  assert.equal(membro.realName, 'NomeReal');
});

test('mensagem vazia e longa demais são recusadas', opcoes, async () => {
  const dona = await novaPessoa('DonaN');
  const guild = await store.createGuild(dona.id, 'Servidor');
  const canal = (await store.guildChannels(guild.id)).find((c) => c.type === 'text');

  await assert.rejects(() => store.addMessage(canal.id, dona.id, '   '), /vazia/i);
  await assert.rejects(() => store.addMessage(canal.id, dona.id, 'x'.repeat(2001)), /longa/i);
});

/* ------------------------------ posse e saída ------------------------------ */

test('dono não sai; passar a posse resolve', opcoes, async () => {
  const dona = await novaPessoa('DonaO');
  const herdeiro = await novaPessoa('Herdeiro');
  const guild = await store.createGuild(dona.id, 'Servidor');

  await assert.rejects(() => store.removeMember(guild.id, dona.id), /dono não pode sair/i);
  await assert.rejects(() => store.transferOwnership(guild.id, herdeiro.id), /precisa estar no servidor/i);

  await store.addMember(guild.id, herdeiro.id);
  await store.transferOwnership(guild.id, herdeiro.id);

  const depois = await store.getGuild(guild.id);
  assert.equal(depois.owner_id, herdeiro.id);

  // agora a antiga dona pode sair, e o novo dono manda
  await store.removeMember(guild.id, dona.id);
  assert.ok(!(await store.isMember(guild.id, dona.id)));

  const r = await store.resolve({ guildId: guild.id, userId: herdeiro.id });
  assert.equal(r.bits, perms.ALL);

  // e a limpeza precisa achar o servidor pelo dono novo
  await store.sql`delete from guilds where id = ${guild.id}`;
});

/* ------------------------------ auditoria ------------------------------ */

test('auditoria registra e sobrevive à saída de quem agiu', opcoes, async () => {
  const dona = await novaPessoa('DonaP');
  const mod = await novaPessoa('ModP');
  const guild = await store.createGuild(dona.id, 'Servidor');
  await store.addMember(guild.id, mod.id);

  await store.audit(guild.id, mod.id, 'expulsou', dona.id, { motivo: 'teste' });
  const [linha] = await store.auditLog(guild.id);
  assert.equal(linha.action, 'expulsou');
  assert.equal(linha.actor_name, 'ModP');
  assert.deepEqual(linha.detail, { motivo: 'teste' });

  // actor_id é SET NULL: o registro fica, o autor some
  await store.sql`delete from auth.users where id = ${mod.id}`;
  criados.splice(criados.indexOf(mod.id), 1);
  const [aindaLa] = await store.auditLog(guild.id);
  assert.equal(aindaLa.action, 'expulsou');
  assert.equal(aindaLa.actor_id, null);
});
