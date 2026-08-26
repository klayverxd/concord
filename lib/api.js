'use strict';

/* ------------------------------------------------------------------ *
 * Rotas HTTP — contas, servidores, canais, cargos e convites.
 *
 * Regra da casa, sem exceção: toda rota que toca um servidor resolve a
 * permissão no banco antes de responder. Esconder botão na tela não é
 * controle de acesso — quem decide é aqui.
 *
 * Servidor que não existe e servidor onde você não entrou respondem a
 * mesma coisa (404). A diferença entre os dois já é informação.
 * ------------------------------------------------------------------ */

const express = require('express');
const config = require('./config');
const auth = require('./auth');
const store = require('./store');
const perms = require('./permissions');

const { P } = perms;
const router = express.Router();
router.use(express.json({ limit: '64kb' }));

const MAX_GUILDS = Number(process.env.MAX_GUILDS_PER_USER || 20);

/* ------------------------------ auxiliares ------------------------------ */

const publicUser = (u) => ({ id: u.id, name: u.name, avatar: u.avatar_url || u.avatar || null });

const publicGuild = (g, userId) => ({
  id: g.id, name: g.name, icon: g.icon_url, ownerId: g.owner_id, isOwner: g.owner_id === userId
});

/** Envolve handler async para que erro rejeitado não derrube o processo. */
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* Exige login e participação no servidor de :guildId, e já deixa a
 * permissão resolvida em req.perm para o handler não repetir consulta. */
const exigeMembro = rota(async (req, res, next) => {
  const guildId = req.params.guildId;
  if (!(await store.isMember(guildId, req.user.id))) {
    return res.status(404).json({ error: 'Servidor não encontrado.' });
  }
  req.perm = await store.resolve({ guildId, userId: req.user.id });
  req.guild = req.perm.guild;
  next();
});

/** Exige uma permissão específica no servidor. */
const exige = (permissao, oQue) => (req, res, next) => {
  if (!req.perm.can(permissao)) {
    return res.status(403).json({ error: `Você não tem permissão para ${oQue}.` });
  }
  next();
};

const exigeDono = (req, res, next) => {
  if (req.guild.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Só o dono do servidor pode fazer isso.' });
  }
  next();
};

/* ------------------------------ sessão ------------------------------ */

// O navegador precisa destes dois para iniciar o login. Ambos são públicos.
router.get('/config', (_req, res) => {
  res.json({
    supabaseUrl: config.supabase.url,
    supabaseAnonKey: config.supabase.anonKey,
    ready: config.authReady(),
    adsenseClientId: config.adsense.clientId,
    adsenseSlotId: config.adsense.slotId
  });
});

/* Toda entrada passa por aqui: confere o token e espelha a pessoa no banco.
 * É o que garante que existe linha em `users` para as chaves estrangeiras. */
router.post('/me', auth.requireUser, rota(async (req, res) => {
  const user = await store.upsertUser(req.user);
  const guilds = await store.guildsForUser(user.id);
  res.json({ user: publicUser(user), guilds: guilds.map((g) => publicGuild(g, user.id)) });
}));

/* Foto enviada por quem usa — o navegador já manda redimensionada e
 * comprimida; aqui só confere o formato e o tamanho antes de guardar. */
router.patch('/me/avatar', auth.requireUser, rota(async (req, res) => {
  const { avatar } = req.body || {};
  if (avatar !== null && (typeof avatar !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(avatar))) {
    return res.status(400).json({ error: 'Imagem inválida.' });
  }
  try {
    await store.setCustomAvatar(req.user.id, avatar);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const user = await store.getUser(req.user.id);
  res.json({ user: publicUser(user) });
}));

/* ------------------------------ servidores ------------------------------ */

router.post('/guilds', auth.requireUser, rota(async (req, res) => {
  await store.upsertUser(req.user);
  if ((await store.guildsForUser(req.user.id)).length >= MAX_GUILDS) {
    return res.status(400).json({ error: `Você já está em ${MAX_GUILDS} servidores.` });
  }
  const guild = await store.createGuild(req.user.id, req.body?.name);
  res.json({
    guild: publicGuild(guild, req.user.id),
    channels: await store.guildChannels(guild.id)
  });
}));

/* A tela inteira de um servidor numa resposta. Os canais vêm FILTRADOS por
 * VIEW_CHANNEL: canal que você não pode ver não aparece nem na lista. */
router.get('/guilds/:guildId', auth.requireUser, exigeMembro, rota(async (req, res) => {
  const [channels, members, roles, myRoles] = await Promise.all([
    store.visibleChannels(req.guild.id, req.user.id),
    store.guildMembers(req.guild.id),
    store.guildRoles(req.guild.id),
    store.memberRoles(req.guild.id, req.user.id)
  ]);

  res.json({
    guild: publicGuild(req.guild, req.user.id),
    channels,
    members,
    roles,
    me: {
      permissions: perms.toText(req.perm.bits),
      permissionNames: perms.names(req.perm.bits),
      roleIds: myRoles.map((r) => r.id)
    }
  });
}));

router.patch('/guilds/:guildId', auth.requireUser, exigeMembro,
  exige(P.MANAGE_GUILD, 'renomear o servidor'), rota(async (req, res) => {
    await store.renameGuild(req.guild.id, req.body?.name);
    await store.audit(req.guild.id, req.user.id, 'renomeou_servidor', null, { nome: req.body?.name });
    res.json({ guild: publicGuild(await store.getGuild(req.guild.id), req.user.id) });
  }));

/* Ícone do servidor — o navegador já manda redimensionado e comprimido;
 * aqui só confere o formato antes de guardar. */
router.patch('/guilds/:guildId/icon', auth.requireUser, exigeMembro,
  exige(P.MANAGE_GUILD, 'trocar o ícone do servidor'), rota(async (req, res) => {
    const { icon } = req.body || {};
    if (icon !== null && (typeof icon !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(icon))) {
      return res.status(400).json({ error: 'Imagem inválida.' });
    }
    try {
      await store.setGuildIcon(req.guild.id, icon);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ guild: publicGuild(await store.getGuild(req.guild.id), req.user.id) });
  }));

router.delete('/guilds/:guildId', auth.requireUser, exigeMembro, exigeDono, rota(async (req, res) => {
  await store.deleteGuild(req.guild.id);
  res.json({ ok: true });
}));

router.post('/guilds/:guildId/transfer', auth.requireUser, exigeMembro, exigeDono, rota(async (req, res) => {
  await store.transferOwnership(req.guild.id, req.body?.userId);
  await store.audit(req.guild.id, req.user.id, 'passou_posse', req.body?.userId);
  res.json({ ok: true });
}));

router.delete('/guilds/:guildId/members/me', auth.requireUser, exigeMembro, rota(async (req, res) => {
  await store.removeMember(req.guild.id, req.user.id);
  res.json({ ok: true });
}));

/* ------------------------------ canais ------------------------------ */

router.post('/guilds/:guildId/channels', auth.requireUser, exigeMembro,
  exige(P.MANAGE_CHANNELS, 'criar canal'), rota(async (req, res) => {
    const channel = await store.createChannel(req.guild.id, req.body?.type, req.body?.name);
    await store.audit(req.guild.id, req.user.id, 'criou_canal', channel.id, { nome: channel.name });
    res.json({ channel });
  }));

/* Canal precisa ser DESTE servidor. Sem esta checagem, quem administra um
 * servidor qualquer renomeia canal de qualquer outro. */
const exigeCanalDoServidor = rota(async (req, res, next) => {
  const channel = await store.getChannel(req.params.channelId);
  if (!channel || channel.guildId !== req.guild.id) {
    return res.status(404).json({ error: 'Canal não encontrado.' });
  }
  req.channel = channel;
  next();
});

router.patch('/guilds/:guildId/channels/:channelId', auth.requireUser, exigeMembro,
  exige(P.MANAGE_CHANNELS, 'renomear canal'), exigeCanalDoServidor, rota(async (req, res) => {
    await store.renameChannel(req.channel.id, req.body?.name);
    res.json({ channel: await store.getChannel(req.channel.id) });
  }));

router.delete('/guilds/:guildId/channels/:channelId', auth.requireUser, exigeMembro,
  exige(P.MANAGE_CHANNELS, 'apagar canal'), exigeCanalDoServidor, rota(async (req, res) => {
    const restantes = (await store.guildChannels(req.guild.id)).filter((c) => c.type === req.channel.type);
    if (restantes.length <= 1) {
      return res.status(400).json({ error: `O servidor precisa de pelo menos um canal de ${req.channel.type === 'text' ? 'texto' : 'voz'}.` });
    }
    await store.deleteChannel(req.channel.id);
    await store.audit(req.guild.id, req.user.id, 'apagou_canal', req.channel.id, { nome: req.channel.name });
    res.json({ ok: true });
  }));

/* --------------------------- sobrescritas --------------------------- */

router.get('/guilds/:guildId/channels/:channelId/overwrites', auth.requireUser, exigeMembro,
  exigeCanalDoServidor, rota(async (req, res) => {
    res.json({ overwrites: await store.channelOverwrites(req.channel.id) });
  }));

/* Mexer em sobrescrita exige MANAGE_ROLES — é ela que decide quem entra
 * onde, então vale o mesmo peso de mexer em cargo. */
router.put('/guilds/:guildId/channels/:channelId/overwrites', auth.requireUser, exigeMembro,
  exige(P.MANAGE_ROLES, 'mexer nas permissões do canal'), exigeCanalDoServidor, rota(async (req, res) => {
    const { targetType, targetId, allow = '0', deny = '0' } = req.body || {};

    // Alvo tem que pertencer a este servidor, senão dá para escrever
    // sobrescrita apontando para cargo alheio.
    if (targetType === 'role') {
      const cargo = await store.getRole(targetId);
      if (!cargo || cargo.guildId !== req.guild.id) {
        return res.status(400).json({ error: 'Cargo não é deste servidor.' });
      }
    } else if (targetType === 'user') {
      if (!(await store.isMember(req.guild.id, targetId))) {
        return res.status(400).json({ error: 'A pessoa não está neste servidor.' });
      }
    } else {
      return res.status(400).json({ error: 'Alvo inválido.' });
    }

    await store.setOverwrite(req.channel.id, targetType, targetId, allow, deny);
    await store.audit(req.guild.id, req.user.id, 'mudou_permissao_canal', req.channel.id, { targetType, targetId });
    res.json({ overwrites: await store.channelOverwrites(req.channel.id) });
  }));

router.delete('/guilds/:guildId/channels/:channelId/overwrites/:targetType/:targetId',
  auth.requireUser, exigeMembro, exige(P.MANAGE_ROLES, 'mexer nas permissões do canal'),
  exigeCanalDoServidor, rota(async (req, res) => {
    await store.clearOverwrite(req.channel.id, req.params.targetType, req.params.targetId);
    res.json({ overwrites: await store.channelOverwrites(req.channel.id) });
  }));

/* ------------------------------ cargos ------------------------------ */

router.get('/guilds/:guildId/roles', auth.requireUser, exigeMembro, rota(async (req, res) => {
  res.json({ roles: await store.guildRoles(req.guild.id) });
}));

/* Escada de privilégio: sem este limite, quem tem MANAGE_ROLES cria um
 * cargo com ADMINISTRATOR, veste, e vira dono na prática. O cargo criado
 * não pode passar do que quem cria já tem, nem ficar acima dele. */
function limitaAoProprio(req, permissoesPedidas, posicaoPedida) {
  const pedido = perms.toBits(permissoesPedidas || '0');
  const meu = req.perm.bits;

  const excedente = pedido & ~meu;
  if (excedente && !perms.has(meu, P.ADMINISTRATOR)) {
    return { erro: `Você não pode dar permissão que não tem: ${perms.names(excedente).join(', ')}.` };
  }

  const meuTopo = perms.topPosition({ ownerId: req.guild.owner_id }, req.user.id, req.perm.roles);
  const pos = Number(posicaoPedida ?? 1);
  if (pos >= meuTopo && req.guild.owner_id !== req.user.id) {
    return { erro: 'O cargo não pode ficar no seu nível ou acima dele.' };
  }
  return { pedido: perms.toText(pedido), pos };
}

router.post('/guilds/:guildId/roles', auth.requireUser, exigeMembro,
  exige(P.MANAGE_ROLES, 'criar cargo'), rota(async (req, res) => {
    const limite = limitaAoProprio(req, req.body?.permissions, req.body?.position);
    if (limite.erro) return res.status(403).json({ error: limite.erro });

    const role = await store.createRole(req.guild.id, {
      name: req.body?.name, color: req.body?.color || null,
      permissions: limite.pedido, position: limite.pos
    });
    await store.audit(req.guild.id, req.user.id, 'criou_cargo', role.id, { nome: role.name });
    res.json({ role });
  }));

/* Cargo alvo tem que estar abaixo de quem mexe — senão um moderador edita
 * o cargo do chefe e se promove. */
const exigeCargoAlcancavel = rota(async (req, res, next) => {
  const role = await store.getRole(req.params.roleId);
  if (!role || role.guildId !== req.guild.id) {
    return res.status(404).json({ error: 'Cargo não encontrado.' });
  }
  const meuTopo = perms.topPosition({ ownerId: req.guild.owner_id }, req.user.id, req.perm.roles);
  if (role.position >= meuTopo && req.guild.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Este cargo está no seu nível ou acima. Você não alcança.' });
  }
  req.role = role;
  next();
});

router.patch('/guilds/:guildId/roles/:roleId', auth.requireUser, exigeMembro,
  exige(P.MANAGE_ROLES, 'editar cargo'), exigeCargoAlcancavel, rota(async (req, res) => {
    if (req.body?.permissions !== undefined || req.body?.position !== undefined) {
      const limite = limitaAoProprio(
        req,
        req.body.permissions ?? req.role.permissions,
        req.body.position ?? req.role.position
      );
      if (limite.erro) return res.status(403).json({ error: limite.erro });
    }
    const role = await store.updateRole(req.role.id, req.body || {});
    await store.audit(req.guild.id, req.user.id, 'editou_cargo', role.id, { nome: role.name });
    res.json({ role });
  }));

router.delete('/guilds/:guildId/roles/:roleId', auth.requireUser, exigeMembro,
  exige(P.MANAGE_ROLES, 'apagar cargo'), exigeCargoAlcancavel, rota(async (req, res) => {
    await store.deleteRole(req.role.id);
    await store.audit(req.guild.id, req.user.id, 'apagou_cargo', req.role.id, { nome: req.role.name });
    res.json({ ok: true });
  }));

/* Dar e tirar cargo: precisa alcançar o cargo E a pessoa. Só uma das duas
 * checagens deixa buraco — alcançar o cargo mas não a pessoa permitiria
 * vestir um cargo em alguém acima de você. */
router.put('/guilds/:guildId/members/:userId/roles/:roleId', auth.requireUser, exigeMembro,
  exige(P.MANAGE_ROLES, 'dar cargo'), exigeCargoAlcancavel, rota(async (req, res) => {
    const alvo = req.params.userId;
    if (!(await store.isMember(req.guild.id, alvo))) {
      return res.status(404).json({ error: 'A pessoa não está neste servidor.' });
    }
    if (alvo !== req.user.id && !(await store.canActOn(req.guild.id, req.user.id, alvo))) {
      return res.status(403).json({ error: 'Você não alcança essa pessoa na hierarquia.' });
    }
    await store.assignRole(req.guild.id, alvo, req.role.id);
    await store.audit(req.guild.id, req.user.id, 'deu_cargo', alvo, { cargo: req.role.name });
    res.json({ roles: await store.memberRoles(req.guild.id, alvo) });
  }));

router.delete('/guilds/:guildId/members/:userId/roles/:roleId', auth.requireUser, exigeMembro,
  exige(P.MANAGE_ROLES, 'tirar cargo'), exigeCargoAlcancavel, rota(async (req, res) => {
    const alvo = req.params.userId;
    if (alvo !== req.user.id && !(await store.canActOn(req.guild.id, req.user.id, alvo))) {
      return res.status(403).json({ error: 'Você não alcança essa pessoa na hierarquia.' });
    }
    await store.unassignRole(req.guild.id, alvo, req.role.id);
    await store.audit(req.guild.id, req.user.id, 'tirou_cargo', alvo, { cargo: req.role.name });
    res.json({ roles: await store.memberRoles(req.guild.id, alvo) });
  }));

/* ------------------------------ moderação ------------------------------ */

const exigeAlcance = rota(async (req, res, next) => {
  const alvo = req.params.userId;
  if (!(await store.canActOn(req.guild.id, req.user.id, alvo))) {
    return res.status(403).json({ error: 'Você não alcança essa pessoa na hierarquia.' });
  }
  next();
});

router.delete('/guilds/:guildId/members/:userId', auth.requireUser, exigeMembro,
  exige(P.KICK_MEMBERS, 'expulsar'), exigeAlcance, rota(async (req, res) => {
    await store.removeMember(req.guild.id, req.params.userId);
    await store.audit(req.guild.id, req.user.id, 'expulsou', req.params.userId);
    res.json({ ok: true });
  }));

router.put('/guilds/:guildId/bans/:userId', auth.requireUser, exigeMembro,
  exige(P.BAN_MEMBERS, 'banir'), exigeAlcance, rota(async (req, res) => {
    await store.banMember(req.guild.id, req.params.userId, req.user.id, req.body?.reason || null);
    await store.audit(req.guild.id, req.user.id, 'baniu', req.params.userId, { motivo: req.body?.reason || null });
    res.json({ ok: true });
  }));

router.delete('/guilds/:guildId/bans/:userId', auth.requireUser, exigeMembro,
  exige(P.BAN_MEMBERS, 'desbanir'), rota(async (req, res) => {
    await store.unbanMember(req.guild.id, req.params.userId);
    await store.audit(req.guild.id, req.user.id, 'desbaniu', req.params.userId);
    res.json({ ok: true });
  }));

router.get('/guilds/:guildId/bans', auth.requireUser, exigeMembro,
  exige(P.BAN_MEMBERS, 'ver banidos'), rota(async (req, res) => {
    res.json({ bans: await store.bansForGuild(req.guild.id) });
  }));

router.get('/guilds/:guildId/audit', auth.requireUser, exigeMembro,
  exige(P.MANAGE_GUILD, 'ver o registro'), rota(async (req, res) => {
    res.json({ entries: await store.auditLog(req.guild.id) });
  }));

router.patch('/guilds/:guildId/members/me/nickname', auth.requireUser, exigeMembro, rota(async (req, res) => {
  await store.setNickname(req.guild.id, req.user.id, req.body?.nickname);
  res.json({ ok: true });
}));

/* ------------------------------ convites ------------------------------ */

router.post('/guilds/:guildId/invites', auth.requireUser, exigeMembro,
  exige(P.CREATE_INVITE, 'convidar'), rota(async (req, res) => {
    const horas = Number(req.body?.hours);
    const maxUsos = Number(req.body?.maxUses);
    const invite = await store.createInvite(req.guild.id, req.user.id, {
      horas: Number.isFinite(horas) && horas > 0 ? Math.min(horas, 24 * 30) : 24 * 7,
      maxUsos: Number.isFinite(maxUsos) && maxUsos > 0 ? Math.min(maxUsos, 100) : null
    });
    res.json({ invite });
  }));

router.get('/guilds/:guildId/invites', auth.requireUser, exigeMembro,
  exige(P.CREATE_INVITE, 'ver convites'), rota(async (req, res) => {
    res.json({ invites: await store.invitesForGuild(req.guild.id) });
  }));

router.delete('/guilds/:guildId/invites/:code', auth.requireUser, exigeMembro,
  exige(P.MANAGE_GUILD, 'apagar convite'), rota(async (req, res) => {
    const invite = await store.getInvite(req.params.code);
    if (!invite || invite.guild_id !== req.guild.id) {
      return res.status(404).json({ error: 'Convite não encontrado.' });
    }
    await store.deleteInvite(invite.code);
    res.json({ ok: true });
  }));

/* Espiar antes de aceitar: só o nome e quantas pessoas. Lista de membros
 * para quem está de fora, não. */
router.get('/invites/:code', rota(async (req, res) => {
  const invite = await store.getInvite(req.params.code);
  if (!store.inviteIsUsable(invite)) {
    return res.status(404).json({ error: 'Convite inválido ou vencido.' });
  }
  const guild = await store.getGuild(invite.guild_id);
  if (!guild) return res.status(404).json({ error: 'Convite inválido ou vencido.' });

  res.json({
    guild: { id: guild.id, name: guild.name, icon: guild.icon_url },
    memberCount: (await store.guildMembers(guild.id)).length
  });
}));

router.post('/invites/:code/accept', auth.requireUser, rota(async (req, res) => {
  await store.upsertUser(req.user);
  const { guild, already } = await store.redeemInvite(req.params.code, req.user.id);
  res.json({ guild: publicGuild(guild, req.user.id), already });
}));

/* ------------------------------ erros ------------------------------ */

// StoreError já vem com frase legível; o resto vira 500 sem vazar detalhe.
router.use((err, _req, res, _next) => {
  // Conta apagada no Supabase com token ainda válido é problema de sessão,
  // não do servidor: 401 faz o navegador limpar o token e voltar ao login.
  if (err?.code === 'conta_inexistente') return res.status(401).json({ error: err.message });
  if (err?.name === 'StoreError') return res.status(400).json({ error: err.message, code: err.code });
  if (err?.name === 'AuthError') return res.status(401).json({ error: err.message });
  console.error('api:', err);
  res.status(500).json({ error: 'Algo deu errado no servidor.' });
});

module.exports = router;
