'use strict';

/* ------------------------------------------------------------------ *
 * Permissões — bitfield, cargos e sobrescritas por canal.
 *
 * O modelo é o do Discord porque ele resolve bem o problema: cada cargo
 * carrega um conjunto de bits, a pessoa acumula os bits de todos os cargos
 * dela, e cada canal pode tirar ou dar bits por cima disso.
 *
 * A ORDEM da resolução importa e é a parte que se erra:
 *   1. dono do servidor pode tudo, ponto final
 *   2. base = @everyone OU todos os cargos da pessoa
 *   3. ADMINISTRATOR na base = pode tudo, ponto final
 *   4. sobrescrita do @everyone naquele canal
 *   5. sobrescritas dos cargos da pessoa, com os "nega" somados antes
 *      dos "permite" — um cargo que permite vence outro que nega
 *   6. sobrescrita da pessoa em si, que vence tudo
 *
 * Este arquivo é lógica pura: nada de banco, nada de rede. Dá para testar
 * inteiro, e é por isso que ele existe separado.
 * ------------------------------------------------------------------ */

const P = {
  VIEW_CHANNEL:    1n << 0n,   // ver o canal e ler o que foi dito
  SEND_MESSAGES:   1n << 1n,
  MANAGE_MESSAGES: 1n << 2n,   // apagar mensagem de outra pessoa
  CONNECT:         1n << 3n,   // entrar no canal de voz
  SPEAK:           1n << 4n,   // abrir o microfone depois de entrar
  STREAM:          1n << 5n,   // transmitir tela
  MUTE_MEMBERS:    1n << 6n,
  DEAFEN_MEMBERS:  1n << 7n,
  MOVE_MEMBERS:    1n << 8n,   // arrastar alguém entre canais de voz
  MANAGE_CHANNELS: 1n << 9n,
  MANAGE_ROLES:    1n << 10n,
  KICK_MEMBERS:    1n << 11n,
  BAN_MEMBERS:     1n << 12n,
  CREATE_INVITE:   1n << 13n,
  MANAGE_GUILD:    1n << 14n,  // renomear o servidor, mexer no geral
  ADMINISTRATOR:   1n << 15n   // atalho para tudo, inclusive o que vier depois
};

const ALL = Object.values(P).reduce((acc, bit) => acc | bit, 0n);

// O que o @everyone ganha num servidor novo: existir na conversa e na voz.
const DEFAULT_EVERYONE =
  P.VIEW_CHANNEL | P.SEND_MESSAGES | P.CONNECT | P.SPEAK | P.STREAM;

/* --------------------------- ida e volta em texto --------------------------- */

/* Bitfield viaja como string por toda parte: inteiro de 64 bits com sinal
 * não guarda o bit alto sem susto, e JSON não tem BigInt. */
function toBits(value) {
  if (typeof value === 'bigint') return value;
  if (value === null || value === undefined || value === '') return 0n;
  try {
    return BigInt(value);
  } catch (_) {
    return 0n;
  }
}

function toText(bits) {
  return (bits & ALL).toString();
}

function has(bits, permission) {
  const b = toBits(bits);
  if (b & P.ADMINISTRATOR) return true;
  return (b & permission) === permission;
}

function names(bits) {
  const b = toBits(bits);
  return Object.entries(P).filter(([, bit]) => (b & bit) === bit).map(([name]) => name);
}

function fromNames(list) {
  return (list || []).reduce((acc, name) => acc | (P[name] || 0n), 0n);
}

/* ------------------------------ resolução ------------------------------ */

/**
 * Permissões da pessoa no servidor, sem olhar canal nenhum.
 *
 * @param {{ownerId: string}} guild
 * @param {string} userId
 * @param {Array<{id: string, permissions: string|bigint, isEveryone?: boolean, position?: number}>} memberRoles
 *        Os cargos da pessoa. O @everyone precisa estar nesta lista — é ele
 *        que dá o piso, e esquecer dele é o jeito mais comum de a pessoa
 *        ficar sem poder nada.
 */
function basePermissions(guild, userId, memberRoles) {
  if (guild.ownerId === userId) return ALL;

  let bits = 0n;
  for (const role of memberRoles) bits |= toBits(role.permissions);

  return bits & P.ADMINISTRATOR ? ALL : bits;
}

/**
 * Permissões dentro de um canal: pega a base e aplica as sobrescritas.
 *
 * @param {bigint} base resultado de basePermissions
 * @param {string} userId
 * @param {Array<{id: string, isEveryone?: boolean}>} memberRoles
 * @param {Array<{targetType: 'role'|'user', targetId: string, allow: string|bigint, deny: string|bigint}>} overwrites
 */
function channelPermissions(base, userId, memberRoles, overwrites) {
  if (base & P.ADMINISTRATOR) return ALL;

  let bits = base;
  const find = (type, id) =>
    overwrites.find((o) => o.targetType === type && o.targetId === id);

  // 1) o @everyone do canal
  const everyone = memberRoles.find((r) => r.isEveryone);
  if (everyone) {
    const ow = find('role', everyone.id);
    if (ow) bits = (bits & ~toBits(ow.deny)) | toBits(ow.allow);
  }

  /* 2) os cargos da pessoa, juntando tudo antes de aplicar. Somar os "nega"
   * e os "permite" separados é o que faz um cargo que libera vencer outro
   * que bloqueia — aplicar um cargo por vez daria resultado dependente da
   * ordem em que eles vieram do banco. */
  let allow = 0n;
  let deny = 0n;
  for (const role of memberRoles) {
    if (role.isEveryone) continue;
    const ow = find('role', role.id);
    if (!ow) continue;
    deny |= toBits(ow.deny);
    allow |= toBits(ow.allow);
  }
  bits = (bits & ~deny) | allow;

  // 3) a sobrescrita da pessoa, que ganha de qualquer cargo
  const mine = find('user', userId);
  if (mine) bits = (bits & ~toBits(mine.deny)) | toBits(mine.allow);

  return bits;
}

/** Atalho: base e canal de uma vez. */
function permissionsFor({ guild, userId, memberRoles, overwrites }) {
  const base = basePermissions(guild, userId, memberRoles);
  if (!overwrites || !overwrites.length) return base;
  return channelPermissions(base, userId, memberRoles, overwrites);
}

/* ------------------------------ hierarquia ------------------------------ */

/** Posição do cargo mais alto da pessoa. Dono fica acima de qualquer cargo. */
function topPosition(guild, userId, memberRoles) {
  if (guild.ownerId === userId) return Infinity;
  return memberRoles.reduce((max, r) => Math.max(max, r.position || 0), 0);
}

/**
 * Se `actor` pode agir sobre `target` (expulsar, banir, mexer nos cargos).
 * Ter a permissão não basta: no Discord você não alcança quem está no mesmo
 * nível ou acima — senão dois moderadores se expulsam em looping, e um
 * cargo com KICK viraria caminho para derrubar o dono.
 */
function canActOn({ guild, actorId, actorRoles, targetId, targetRoles }) {
  if (actorId === targetId) return false;          // sobre si mesmo, não
  if (guild.ownerId === actorId) return true;
  if (guild.ownerId === targetId) return false;    // ninguém alcança o dono

  return topPosition(guild, actorId, actorRoles) > topPosition(guild, targetId, targetRoles);
}

module.exports = {
  P, ALL, DEFAULT_EVERYONE,
  toBits, toText, has, names, fromNames,
  basePermissions, channelPermissions, permissionsFor,
  topPosition, canActOn
};
