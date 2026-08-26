'use strict';

/* ------------------------------------------------------------------ *
 * Camada de dados — tudo que fala com o Postgres mora aqui.
 *
 * O resto do código chama função com nome e nunca escreve consulta. Duas
 * regras que valem para o arquivo inteiro:
 *
 *   1. Bitfield de permissão entra e sai como TEXTO. Quem converte para
 *      BigInt é o lib/permissions.js. Inteiro de 64 bits com sinal não
 *      guarda o bit alto sem susto.
 *
 *   2. `resolve()` é o único lugar que decide o que alguém pode. Não tem
 *      cache de propósito: permissão que muda e continua valendo a antiga
 *      é o tipo de bug que ninguém acha. Se um dia a latência incomodar,
 *      é aqui — e só aqui — que um cache curto entra.
 * ------------------------------------------------------------------ */

const postgres = require('postgres');
const config = require('./config');
const perms = require('./permissions');

if (!config.supabase.databaseUrl) {
  throw new Error('store: falta DB_PASSWORD ou DATABASE_URL no ambiente.');
}

const sql = postgres(config.supabase.databaseUrl, {
  ssl: 'require',
  prepare: false,            // o pooler em modo transação não aceita prepared statement
  connect_timeout: 20,
  idle_timeout: 30,
  max: 10,
  onnotice: () => {}         // os "already exists" do IF NOT EXISTS não interessam
});

/** Erro com motivo legível, para virar mensagem na tela sem tradução. */
class StoreError extends Error {
  constructor(message, code = 'erro') {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

const CODIGO_UNICO = '23505';
const CODIGO_FK = '23503';

/* ------------------------------ pessoas ------------------------------ */

/* A identidade é do Supabase Auth; aqui fica só o espelho que as chaves
 * estrangeiras precisam. Chamado a cada conexão, então é upsert. */
async function upsertUser({ id, email, name, avatar }) {
  try {
    const [row] = await sql`
      insert into users (id, email, name, avatar_url, last_seen_at)
      values (${id}, ${email || ''}, ${name || 'sem nome'}, ${avatar || null}, now())
      on conflict (id) do update
        set email = excluded.email,
            name = excluded.name,
            avatar_url = coalesce(excluded.avatar_url, users.avatar_url),
            last_seen_at = now()
      returning id, email, name, coalesce(custom_avatar, avatar_url) as avatar_url`;
    return row;
  } catch (err) {
    /* `users.id` referencia auth.users. Falhar aqui significa token com
     * assinatura boa de uma conta que não existe mais — apagada no painel
     * do Supabase, por exemplo. É sessão inválida, não erro de servidor:
     * sem esta tradução, o navegador recebia 500 e não sabia deslogar. */
    if (err.code === CODIGO_FK) {
      throw new StoreError('Esta conta não existe mais. Entre de novo.', 'conta_inexistente');
    }
    throw err;
  }
}

async function getUser(id) {
  const [row] = await sql`
    select id, email, name, coalesce(custom_avatar, avatar_url) as avatar_url
    from users where id = ${id}`;
  return row || null;
}

/** Guarda a foto redimensionada pelo próprio navegador; null volta pro
 * avatar do login (Google etc). */
async function setCustomAvatar(userId, dataUri) {
  if (dataUri && dataUri.length > 200000) {
    throw new StoreError('Imagem grande demais.', 'imagem_grande');
  }
  await sql`update users set custom_avatar = ${dataUri || null} where id = ${userId}`;
}

/* ------------------------------ servidores ------------------------------ */

async function createGuild(ownerId, name) {
  const limpo = String(name || '').trim();
  if (!limpo) throw new StoreError('Dê um nome ao servidor.', 'nome_vazio');

  const [{ create_guild: id }] = await sql`select create_guild(${ownerId}, ${limpo})`;
  return getGuild(id);
}

async function getGuild(id) {
  const [row] = await sql`select id, name, icon_url, owner_id, created_at from guilds where id = ${id}`;
  return row || null;
}

async function guildsForUser(userId) {
  return sql`
    select g.id, g.name, g.icon_url, g.owner_id
    from guilds g
    join guild_members m on m.guild_id = g.id
    where m.user_id = ${userId}
    order by m.joined_at`;
}

async function renameGuild(id, name) {
  const limpo = String(name || '').trim();
  if (!limpo) throw new StoreError('Nome vazio.', 'nome_vazio');
  await sql`update guilds set name = ${limpo} where id = ${id}`;
}

/** Guarda o ícone redimensionado pelo próprio navegador; null volta pras
 * iniciais do nome. */
async function setGuildIcon(id, dataUri) {
  if (dataUri && dataUri.length > 200000) {
    throw new StoreError('Imagem grande demais.', 'imagem_grande');
  }
  await sql`update guilds set icon_url = ${dataUri || null} where id = ${id}`;
}

async function deleteGuild(id) {
  await sql`delete from guilds where id = ${id}`;
}

/* O dono não pode simplesmente sair: `guilds.owner_id` é RESTRICT, então
 * apagar a conta dele seria barrado pelo banco com uma mensagem ilegível.
 * Passar a posse é o caminho — e o novo dono tem que já ser membro. */
async function transferOwnership(guildId, novoDonoId) {
  const membro = await isMember(guildId, novoDonoId);
  if (!membro) throw new StoreError('A pessoa precisa estar no servidor para receber a posse.', 'nao_membro');
  await sql`update guilds set owner_id = ${novoDonoId} where id = ${guildId}`;
}

/* ------------------------------ membros ------------------------------ */

async function isMember(guildId, userId) {
  const [row] = await sql`select 1 from guild_members where guild_id = ${guildId} and user_id = ${userId}`;
  return Boolean(row);
}

async function addMember(guildId, userId) {
  await sql`
    insert into guild_members (guild_id, user_id) values (${guildId}, ${userId})
    on conflict (guild_id, user_id) do nothing`;
}

async function removeMember(guildId, userId) {
  const guild = await getGuild(guildId);
  if (guild?.owner_id === userId) {
    throw new StoreError('O dono não pode sair. Passe a posse ou apague o servidor.', 'dono_nao_sai');
  }
  await sql`delete from guild_members where guild_id = ${guildId} and user_id = ${userId}`;
}

async function setNickname(guildId, userId, nickname) {
  const limpo = nickname ? String(nickname).trim().slice(0, 32) : null;
  await sql`update guild_members set nickname = ${limpo} where guild_id = ${guildId} and user_id = ${userId}`;
}

/** Membros com o apelido do servidor e os cargos de cada um. */
async function guildMembers(guildId) {
  const rows = await sql`
    select u.id, u.name, coalesce(u.custom_avatar, u.avatar_url) as avatar_url, m.nickname, m.joined_at,
           coalesce(
             array_agg(mr.role_id) filter (where mr.role_id is not null),
             '{}'
           ) as role_ids
    from guild_members m
    join users u on u.id = m.user_id
    left join member_roles mr on mr.guild_id = m.guild_id and mr.user_id = m.user_id
    where m.guild_id = ${guildId}
    group by u.id, u.name, u.avatar_url, u.custom_avatar, m.nickname, m.joined_at
    order by lower(coalesce(m.nickname, u.name))`;

  return rows.map((r) => ({
    id: r.id,
    name: r.nickname || r.name,
    realName: r.name,
    avatar: r.avatar_url,
    joinedAt: r.joined_at,
    roleIds: r.role_ids
  }));
}

/* ------------------------------ cargos ------------------------------ */

const mapRole = (r) => ({
  id: r.id,
  name: r.name,
  color: r.color,
  permissions: r.permissions,
  position: r.position,
  isEveryone: r.is_everyone
});

async function guildRoles(guildId) {
  const rows = await sql`
    select id, name, color, permissions, position, is_everyone
    from roles where guild_id = ${guildId}
    order by position desc, created_at`;
  return rows.map(mapRole);
}

async function createRole(guildId, { name, color = null, permissions = '0', position = 1 }) {
  const limpo = String(name || '').trim();
  if (!limpo) throw new StoreError('Dê um nome ao cargo.', 'nome_vazio');

  const [row] = await sql`
    insert into roles (guild_id, name, color, permissions, position)
    values (${guildId}, ${limpo}, ${color}, ${perms.toText(perms.toBits(permissions))}, ${position})
    returning id, name, color, permissions, position, is_everyone`;
  return mapRole(row);
}

async function updateRole(roleId, patch) {
  const atual = await getRole(roleId);
  if (!atual) throw new StoreError('Cargo não encontrado.', 'sem_cargo');

  // O @everyone não pode ser renomeado nem sair de posição: ele é o piso.
  const name = atual.isEveryone ? atual.name : (patch.name !== undefined ? String(patch.name).trim() : atual.name);
  const position = atual.isEveryone ? 0 : (patch.position !== undefined ? Number(patch.position) : atual.position);
  const color = patch.color !== undefined ? patch.color : atual.color;
  const permissions = patch.permissions !== undefined
    ? perms.toText(perms.toBits(patch.permissions))
    : atual.permissions;

  if (!name) throw new StoreError('Nome vazio.', 'nome_vazio');

  const [row] = await sql`
    update roles set name = ${name}, color = ${color}, permissions = ${permissions}, position = ${position}
    where id = ${roleId}
    returning id, name, color, permissions, position, is_everyone`;
  return mapRole(row);
}

async function getRole(roleId) {
  const [row] = await sql`
    select id, guild_id, name, color, permissions, position, is_everyone
    from roles where id = ${roleId}`;
  return row ? { ...mapRole(row), guildId: row.guild_id } : null;
}

async function deleteRole(roleId) {
  const cargo = await getRole(roleId);
  if (!cargo) return;
  if (cargo.isEveryone) throw new StoreError('O @everyone não pode ser apagado.', 'everyone_fixo');
  await sql`delete from roles where id = ${roleId}`;
}

async function assignRole(guildId, userId, roleId) {
  const cargo = await getRole(roleId);
  if (!cargo || cargo.guildId !== guildId) throw new StoreError('Cargo não é deste servidor.', 'cargo_de_outro');
  if (cargo.isEveryone) return;   // todos já têm, não precisa de linha

  try {
    await sql`
      insert into member_roles (guild_id, user_id, role_id) values (${guildId}, ${userId}, ${roleId})
      on conflict do nothing`;
  } catch (err) {
    if (err.code === CODIGO_FK) throw new StoreError('Pessoa ou cargo não existe.', 'sem_alvo');
    throw err;
  }
}

async function unassignRole(guildId, userId, roleId) {
  await sql`delete from member_roles where guild_id = ${guildId} and user_id = ${userId} and role_id = ${roleId}`;
}

/**
 * Cargos que valem para a pessoa, com o @everyone SEMPRE incluído.
 * Esquecer o @everyone aqui é o jeito mais comum de todo mundo virar
 * ninguém — e é por isso que a inclusão é feita na consulta, não no caller.
 */
async function memberRoles(guildId, userId) {
  const rows = await sql`
    select r.id, r.name, r.color, r.permissions, r.position, r.is_everyone
    from roles r
    where r.guild_id = ${guildId}
      and (
        r.is_everyone
        or exists (
          select 1 from member_roles mr
          where mr.guild_id = r.guild_id and mr.user_id = ${userId} and mr.role_id = r.id
        )
      )
    order by r.position desc`;
  return rows.map(mapRole);
}

/* ------------------------------ canais ------------------------------ */

const mapChannel = (c) => ({ id: c.id, guildId: c.guild_id, type: c.type, name: c.name, position: c.position });

async function guildChannels(guildId) {
  const rows = await sql`
    select id, guild_id, type, name, position from channels
    where guild_id = ${guildId} order by type, position, created_at`;
  return rows.map(mapChannel);
}

async function getChannel(id) {
  const [row] = await sql`select id, guild_id, type, name, position from channels where id = ${id}`;
  return row ? mapChannel(row) : null;
}

async function createChannel(guildId, type, name) {
  if (type !== 'text' && type !== 'voice') throw new StoreError('Tipo de canal inválido.', 'tipo_invalido');
  const limpo = String(name || '').trim();
  if (!limpo) throw new StoreError('Dê um nome ao canal.', 'nome_vazio');

  const [{ n }] = await sql`select count(*)::int as n from channels where guild_id = ${guildId} and type = ${type}`;
  const [row] = await sql`
    insert into channels (guild_id, type, name, position)
    values (${guildId}, ${type}, ${limpo}, ${n})
    returning id, guild_id, type, name, position`;
  return mapChannel(row);
}

async function renameChannel(id, name) {
  const limpo = String(name || '').trim();
  if (!limpo) throw new StoreError('Nome vazio.', 'nome_vazio');
  await sql`update channels set name = ${limpo} where id = ${id}`;
}

async function deleteChannel(id) {
  await sql`delete from channels where id = ${id}`;
}

/* --------------------------- sobrescritas --------------------------- */

const mapOverwrite = (o) => ({
  targetType: o.target_type,
  targetId: o.target_id,
  allow: o.allow,
  deny: o.deny
});

async function channelOverwrites(channelId) {
  const rows = await sql`
    select target_type, target_id, allow, deny from channel_overwrites where channel_id = ${channelId}`;
  return rows.map(mapOverwrite);
}

async function setOverwrite(channelId, targetType, targetId, allow, deny) {
  if (targetType !== 'role' && targetType !== 'user') {
    throw new StoreError('Alvo de sobrescrita inválido.', 'alvo_invalido');
  }
  const a = perms.toBits(allow);
  const d = perms.toBits(deny);
  // Permitir e negar o mesmo bit é contradição: o "permite" fica.
  const limpo = d & ~a;

  await sql`
    insert into channel_overwrites (channel_id, target_type, target_id, allow, deny)
    values (${channelId}, ${targetType}, ${targetId}, ${perms.toText(a)}, ${perms.toText(limpo)})
    on conflict (channel_id, target_type, target_id) do update
      set allow = excluded.allow, deny = excluded.deny`;
}

async function clearOverwrite(channelId, targetType, targetId) {
  await sql`
    delete from channel_overwrites
    where channel_id = ${channelId} and target_type = ${targetType} and target_id = ${targetId}`;
}

/* ------------------------------ permissões ------------------------------ */

/**
 * O que a pessoa pode. Passe `channelId` para levar as sobrescritas em
 * conta; sem ele o resultado é o do servidor.
 *
 * Este é o único caminho para decidir permissão. Todo evento de socket e
 * toda rota passam por aqui — esconder botão na tela não é controle.
 *
 * @returns {{bits: bigint, guild: object, roles: Array, can: (p: bigint) => boolean}}
 */
/* Numa consulta só, de propósito. A versão anterior fazia seis idas ao
 * banco — servidor, cargos, canal, sobrescritas — e como isso roda a CADA
 * evento de socket, dava um a dois segundos de espera por mensagem enviada
 * num banco remoto. Inaceitável num chat. */
async function resolve({ guildId, userId, channelId = null }) {
  const [linha] = await sql`
    select
      g.id, g.name, g.icon_url, g.owner_id, g.created_at,
      (
        select coalesce(json_agg(json_build_object(
                 'id', r.id, 'name', r.name, 'color', r.color,
                 'permissions', r.permissions, 'position', r.position,
                 'isEveryone', r.is_everyone) order by r.position desc), '[]'::json)
        from roles r
        where r.guild_id = g.id
          and (r.is_everyone or exists (
                select 1 from member_roles mr
                where mr.guild_id = r.guild_id and mr.user_id = ${userId} and mr.role_id = r.id))
      ) as roles,
      ${channelId ? sql`
      (
        select c.id from channels c where c.id = ${channelId} and c.guild_id = g.id
      ) as canal_ok,
      (
        select coalesce(json_agg(json_build_object(
                 'targetType', o.target_type, 'targetId', o.target_id,
                 'allow', o.allow, 'deny', o.deny)), '[]'::json)
        from channel_overwrites o where o.channel_id = ${channelId}
      ) as overwrites
      ` : sql`null as canal_ok, '[]'::json as overwrites`}
    from guilds g
    where g.id = ${guildId}`;

  if (!linha) throw new StoreError('Servidor não encontrado.', 'sem_servidor');
  if (channelId && !linha.canal_ok) {
    throw new StoreError('Canal não é deste servidor.', 'canal_de_outro');
  }

  const guild = {
    id: linha.id, name: linha.name, icon_url: linha.icon_url,
    owner_id: linha.owner_id, created_at: linha.created_at
  };
  const roles = linha.roles;

  let bits = perms.basePermissions({ ownerId: guild.owner_id }, userId, roles);
  if (channelId) bits = perms.channelPermissions(bits, userId, roles, linha.overwrites);

  return { bits, guild, roles, can: (p) => perms.has(bits, p) };
}

/**
 * Resolve tudo a partir do CANAL, numa consulta: o canal, o servidor dele,
 * se a pessoa é membro, os cargos e as sobrescritas.
 *
 * Este é o caminho quente — roda a cada mensagem, cada tecla de "digitando"
 * e cada entrada na voz. Fazer canal, membro e permissão em três viagens
 * separadas somava latência de banco remoto em cima de toda ação.
 *
 * Devolve null se o canal não existe. `isMember` vem separado de propósito:
 * quem decide o que fazer com "não é membro" é quem chamou.
 */
async function resolveForChannel({ channelId, userId }) {
  const [linha] = await sql`
    select
      c.id as canal_id, c.type as canal_tipo, c.name as canal_nome, c.position as canal_pos,
      g.id as guild_id, g.name as guild_nome, g.icon_url, g.owner_id,
      exists (
        select 1 from guild_members m where m.guild_id = g.id and m.user_id = ${userId}
      ) as e_membro,
      (
        select coalesce(json_agg(json_build_object(
                 'id', r.id, 'name', r.name, 'color', r.color,
                 'permissions', r.permissions, 'position', r.position,
                 'isEveryone', r.is_everyone) order by r.position desc), '[]'::json)
        from roles r
        where r.guild_id = g.id
          and (r.is_everyone or exists (
                select 1 from member_roles mr
                where mr.guild_id = r.guild_id and mr.user_id = ${userId} and mr.role_id = r.id))
      ) as roles,
      (
        select coalesce(json_agg(json_build_object(
                 'targetType', o.target_type, 'targetId', o.target_id,
                 'allow', o.allow, 'deny', o.deny)), '[]'::json)
        from channel_overwrites o where o.channel_id = c.id
      ) as overwrites
    from channels c
    join guilds g on g.id = c.guild_id
    where c.id = ${channelId}`;

  if (!linha) return null;

  const roles = linha.roles;
  const base = perms.basePermissions({ ownerId: linha.owner_id }, userId, roles);
  const bits = perms.channelPermissions(base, userId, roles, linha.overwrites);

  return {
    channel: {
      id: linha.canal_id, guildId: linha.guild_id,
      type: linha.canal_tipo, name: linha.canal_nome, position: linha.canal_pos
    },
    guild: { id: linha.guild_id, name: linha.guild_nome, icon_url: linha.icon_url, owner_id: linha.owner_id },
    isMember: linha.e_membro,
    roles,
    bits,
    can: (p) => perms.has(bits, p)
  };
}

/** Cargos de duas pessoas de uma vez, para a checagem de hierarquia. */
async function hierarchyContext(guildId, actorId, targetId) {
  const guild = await getGuild(guildId);
  if (!guild) throw new StoreError('Servidor não encontrado.', 'sem_servidor');
  const [actorRoles, targetRoles] = await Promise.all([
    memberRoles(guildId, actorId),
    memberRoles(guildId, targetId)
  ]);
  return { guild: { ownerId: guild.owner_id }, actorRoles, targetRoles };
}

/** Se `actorId` alcança `targetId` na hierarquia de cargos. */
async function canActOn(guildId, actorId, targetId) {
  const ctx = await hierarchyContext(guildId, actorId, targetId);
  return perms.canActOn({
    guild: ctx.guild, actorId, actorRoles: ctx.actorRoles, targetId, targetRoles: ctx.targetRoles
  });
}

/** Só os canais que a pessoa pode ver — o filtro certo para montar a tela. */
async function visibleChannels(guildId, userId) {
  const [guild, roles, canais] = await Promise.all([
    getGuild(guildId), memberRoles(guildId, userId), guildChannels(guildId)
  ]);
  if (!guild) throw new StoreError('Servidor não encontrado.', 'sem_servidor');

  const contexto = { ownerId: guild.owner_id };
  const base = perms.basePermissions(contexto, userId, roles);
  if (perms.has(base, perms.P.ADMINISTRATOR)) return canais;

  // Uma consulta para as sobrescritas de todos os canais, não uma por canal.
  const ids = canais.map((c) => c.id);
  if (!ids.length) return [];
  const todas = await sql`
    select channel_id, target_type, target_id, allow, deny
    from channel_overwrites where channel_id in ${sql(ids)}`;

  const porCanal = new Map();
  for (const o of todas) {
    if (!porCanal.has(o.channel_id)) porCanal.set(o.channel_id, []);
    porCanal.get(o.channel_id).push(mapOverwrite(o));
  }

  return canais.filter((c) => {
    const bits = perms.channelPermissions(base, userId, roles, porCanal.get(c.id) || []);
    return perms.has(bits, perms.P.VIEW_CHANNEL);
  });
}

/* ------------------------------ mensagens ------------------------------ */

const mapMessage = (m) => ({
  id: m.id,
  channelId: m.channel_id,
  uid: m.author_id,
  name: m.author_nickname || m.author_name,
  avatar: m.author_avatar,
  text: m.content,
  at: Number(new Date(m.created_at)),
  editedAt: m.edited_at ? Number(new Date(m.edited_at)) : null,
  replyTo: m.reply_id ? { id: m.reply_id, name: m.reply_name, text: m.reply_text } : null,
  reactions: m.reactions || {}
});

const SELECT_MESSAGE = sql`
  select m.id, m.channel_id, m.author_id, m.content, m.created_at, m.edited_at,
         u.name as author_name, coalesce(u.custom_avatar, u.avatar_url) as author_avatar,
         gm.nickname as author_nickname,
         r.id as reply_id, ru.name as reply_name, left(r.content, 120) as reply_text,
         (
           select coalesce(jsonb_object_agg(e.emoji, e.quem), '{}'::jsonb)
           from (
             select emoji, jsonb_agg(user_id) as quem
             from message_reactions where message_id = m.id group by emoji
           ) e
         ) as reactions
  from messages m
  join users u on u.id = m.author_id
  join channels c on c.id = m.channel_id
  left join guild_members gm on gm.guild_id = c.guild_id and gm.user_id = m.author_id
  left join messages r on r.id = m.reply_to
  left join users ru on ru.id = r.author_id`;

async function addMessage(channelId, authorId, content, replyTo = null) {
  const texto = String(content || '').trim();
  if (!texto) throw new StoreError('Mensagem vazia.', 'vazia');
  if (texto.length > 2000) throw new StoreError('Mensagem longa demais.', 'longa');

  const [{ id }] = await sql`
    insert into messages (channel_id, author_id, content, reply_to)
    values (${channelId}, ${authorId}, ${texto}, ${replyTo || null})
    returning id`;
  return getMessage(id);
}

async function getMessage(id) {
  const [row] = await sql`${SELECT_MESSAGE} where m.id = ${id} and m.deleted_at is null`;
  return row ? mapMessage(row) : null;
}

/** Página da conversa, do mais antigo para o mais novo. `before` pagina. */
async function recentMessages(channelId, limit = 50, before = null) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = before
    ? await sql`${SELECT_MESSAGE}
        where m.channel_id = ${channelId} and m.deleted_at is null
          and m.created_at < (select created_at from messages where id = ${before})
        order by m.created_at desc, m.id desc limit ${n}`
    : await sql`${SELECT_MESSAGE}
        where m.channel_id = ${channelId} and m.deleted_at is null
        order by m.created_at desc, m.id desc limit ${n}`;
  return rows.map(mapMessage).reverse();
}

async function editMessage(id, authorId, content) {
  const texto = String(content || '').trim();
  if (!texto) throw new StoreError('Mensagem vazia.', 'vazia');

  const [row] = await sql`
    update messages set content = ${texto}, edited_at = now()
    where id = ${id} and author_id = ${authorId} and deleted_at is null
    returning id`;
  if (!row) throw new StoreError('Só quem escreveu pode editar.', 'nao_autor');
  return getMessage(id);
}

/** Apagar é marcar: o histórico de quem já leu não muda debaixo dos pés. */
async function deleteMessage(id) {
  await sql`update messages set deleted_at = now() where id = ${id}`;
}

async function messageAuthor(id) {
  const [row] = await sql`select author_id, channel_id from messages where id = ${id} and deleted_at is null`;
  return row ? { authorId: row.author_id, channelId: row.channel_id } : null;
}

/** Liga e desliga a reação da pessoa, devolvendo quem sobrou naquele emoji. */
async function toggleReaction(messageId, userId, emoji) {
  const chave = String(emoji || '').slice(0, 16);
  if (!chave) throw new StoreError('Emoji inválido.', 'emoji_invalido');

  const apagou = await sql`
    delete from message_reactions
    where message_id = ${messageId} and user_id = ${userId} and emoji = ${chave}
    returning user_id`;

  if (!apagou.length) {
    try {
      await sql`
        insert into message_reactions (message_id, user_id, emoji)
        values (${messageId}, ${userId}, ${chave})`;
    } catch (err) {
      if (err.code === CODIGO_FK) throw new StoreError('Mensagem não existe mais.', 'sem_mensagem');
      if (err.code !== CODIGO_UNICO) throw err;
    }
  }

  const quem = await sql`
    select user_id from message_reactions where message_id = ${messageId} and emoji = ${chave}`;
  return quem.map((r) => r.user_id);
}

/* ------------------------------ convites ------------------------------ */

// Sem 0/O/1/I/l: o código é lido em voz alta e digitado à mão.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function novoCodigo(tamanho = 8) {
  const bytes = require('crypto').randomBytes(tamanho);
  let out = '';
  for (let i = 0; i < tamanho; i++) out += ALFABETO[bytes[i] % ALFABETO.length];
  return out;
}

async function createInvite(guildId, inviterId, { horas = 24 * 7, maxUsos = null } = {}) {
  const expira = horas ? new Date(Date.now() + horas * 36e5) : null;

  // Colisão é improvável, mas quem decide é o índice único do banco.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      const [row] = await sql`
        insert into invites (code, guild_id, inviter_id, expires_at, max_uses)
        values (${novoCodigo()}, ${guildId}, ${inviterId}, ${expira}, ${maxUsos})
        returning code, guild_id, inviter_id, expires_at, max_uses, uses`;
      return row;
    } catch (err) {
      if (err.code !== CODIGO_UNICO) throw err;
    }
  }
  throw new StoreError('Não deu para gerar um código. Tente de novo.', 'sem_codigo');
}

async function getInvite(code) {
  const [row] = await sql`
    select code, guild_id, inviter_id, expires_at, max_uses, uses
    from invites where code = ${String(code || '').toUpperCase()}`;
  return row || null;
}

function inviteIsUsable(invite) {
  if (!invite) return false;
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return false;
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) return false;
  return true;
}

async function invitesForGuild(guildId) {
  return sql`
    select code, inviter_id, expires_at, max_uses, uses, created_at
    from invites where guild_id = ${guildId} order by created_at desc`;
}

async function deleteInvite(code) {
  await sql`delete from invites where code = ${code}`;
}

/**
 * Aceitar convite. Numa transação: conferir o convite, o banimento, entrar
 * e contar o uso precisam acontecer juntos, senão duas pessoas passam pelo
 * mesmo último uso ao mesmo tempo.
 *
 * A ORDEM aqui tem uma pegadinha que só apareceu no teste: quem JÁ é membro
 * é atendido antes de olhar validade e uso. Sem isso, clicar de novo no
 * próprio link — depois de o convite esgotar ou vencer — respondia "este
 * convite não vale mais" para alguém que já está lá dentro. O convite é a
 * porta; quem está dentro não precisa dela.
 */
async function redeemInvite(code, userId) {
  return sql.begin(async (tx) => {
    // O convite precisa existir de qualquer forma: é ele que diz o servidor.
    const [invite] = await tx`
      select code, guild_id, expires_at, max_uses, uses from invites
      where code = ${String(code || '').toUpperCase()}
      for update`;
    if (!invite) throw new StoreError('Este convite não vale mais.', 'convite_ruim');

    const [jaEra] = await tx`
      select 1 from guild_members where guild_id = ${invite.guild_id} and user_id = ${userId}`;

    if (jaEra) {
      const [guild] = await tx`select id, name, icon_url, owner_id from guilds where id = ${invite.guild_id}`;
      return { guild, already: true };
    }

    const [banido] = await tx`
      select 1 from bans where guild_id = ${invite.guild_id} and user_id = ${userId}`;
    if (banido) throw new StoreError('Você está banido deste servidor.', 'banido');

    if (!inviteIsUsable(invite)) throw new StoreError('Este convite não vale mais.', 'convite_ruim');

    await tx`insert into guild_members (guild_id, user_id) values (${invite.guild_id}, ${userId})`;
    await tx`update invites set uses = uses + 1 where code = ${invite.code}`;

    const [guild] = await tx`select id, name, icon_url, owner_id from guilds where id = ${invite.guild_id}`;
    return { guild, already: false };
  });
}

/* ------------------------------ banimentos ------------------------------ */

async function banMember(guildId, userId, byId, reason = null) {
  await sql.begin(async (tx) => {
    await tx`
      insert into bans (guild_id, user_id, reason, banned_by)
      values (${guildId}, ${userId}, ${reason}, ${byId})
      on conflict (guild_id, user_id) do update set reason = excluded.reason`;
    await tx`delete from guild_members where guild_id = ${guildId} and user_id = ${userId}`;
  });
}

async function unbanMember(guildId, userId) {
  await sql`delete from bans where guild_id = ${guildId} and user_id = ${userId}`;
}

async function isBanned(guildId, userId) {
  const [row] = await sql`select 1 from bans where guild_id = ${guildId} and user_id = ${userId}`;
  return Boolean(row);
}

async function bansForGuild(guildId) {
  return sql`
    select b.user_id, b.reason, b.banned_by, b.created_at, u.name,
           coalesce(u.custom_avatar, u.avatar_url) as avatar_url
    from bans b join users u on u.id = b.user_id
    where b.guild_id = ${guildId} order by b.created_at desc`;
}

/* ------------------------------ auditoria ------------------------------ */

async function audit(guildId, actorId, action, targetId = null, detail = null) {
  await sql`
    insert into audit_log (guild_id, actor_id, action, target_id, detail)
    values (${guildId}, ${actorId}, ${action}, ${targetId}, ${detail ? sql.json(detail) : null})`;
}

async function auditLog(guildId, limit = 50) {
  return sql`
    select a.id, a.actor_id, a.action, a.target_id, a.detail, a.created_at, u.name as actor_name
    from audit_log a left join users u on u.id = a.actor_id
    where a.guild_id = ${guildId} order by a.id desc limit ${Math.min(Number(limit) || 50, 200)}`;
}

/* ------------------------------ manutenção ------------------------------ */

async function health() {
  const [row] = await sql`select 1 as ok`;
  return row?.ok === 1;
}

async function close() {
  await sql.end({ timeout: 5 });
}

module.exports = {
  sql, StoreError, health, close,
  upsertUser, getUser, setCustomAvatar,
  createGuild, getGuild, guildsForUser, renameGuild, setGuildIcon, deleteGuild, transferOwnership,
  isMember, addMember, removeMember, setNickname, guildMembers,
  guildRoles, createRole, updateRole, getRole, deleteRole, assignRole, unassignRole, memberRoles,
  guildChannels, getChannel, createChannel, renameChannel, deleteChannel, visibleChannels,
  channelOverwrites, setOverwrite, clearOverwrite,
  resolve, resolveForChannel, hierarchyContext, canActOn,
  addMessage, getMessage, recentMessages, editMessage, deleteMessage, messageAuthor, toggleReaction,
  createInvite, getInvite, inviteIsUsable, invitesForGuild, deleteInvite, redeemInvite,
  banMember, unbanMember, isBanned, bansForGuild,
  audit, auditLog
};
