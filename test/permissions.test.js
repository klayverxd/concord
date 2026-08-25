'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  P, ALL, DEFAULT_EVERYONE, toBits, toText, has, names, fromNames,
  basePermissions, channelPermissions, permissionsFor, topPosition, canActOn
} = require('../lib/permissions');

const guild = { ownerId: 'dono' };
const everyone = { id: 'r-everyone', isEveryone: true, position: 0, permissions: toText(DEFAULT_EVERYONE) };

const role = (id, perms, position) => ({ id, position, permissions: toText(perms) });
const ow = (targetType, targetId, allow, deny) => ({
  targetType, targetId, allow: toText(allow), deny: toText(deny)
});

/* ------------------------------ o básico ------------------------------ */

test('bitfield sobrevive à ida e volta em texto', () => {
  assert.equal(toText(P.VIEW_CHANNEL | P.SPEAK), '17');
  assert.equal(toBits('17'), P.VIEW_CHANNEL | P.SPEAK);
  assert.equal(toBits(null), 0n);
  assert.equal(toBits('nada disso'), 0n);   // entrada suja não derruba nada
  assert.equal(toBits(P.ADMINISTRATOR), P.ADMINISTRATOR);
});

test('o bit mais alto atravessa texto sem se perder', () => {
  // É por isso que não se guarda bitfield em inteiro de 64 bits com sinal.
  const round = toBits(toText(P.ADMINISTRATOR));
  assert.equal(round, P.ADMINISTRATOR);
  assert.ok(has(toText(ALL), P.ADMINISTRATOR));
});

test('nomes e bits convertem nos dois sentidos', () => {
  const bits = fromNames(['VIEW_CHANNEL', 'CONNECT']);
  assert.equal(bits, P.VIEW_CHANNEL | P.CONNECT);
  assert.deepEqual(names(bits).sort(), ['CONNECT', 'VIEW_CHANNEL']);
  assert.equal(fromNames(['NAO_EXISTE']), 0n);
});

test('quem tem ADMINISTRATOR passa em qualquer checagem', () => {
  assert.ok(has(P.ADMINISTRATOR, P.BAN_MEMBERS));
  assert.ok(!has(P.KICK_MEMBERS, P.BAN_MEMBERS));
});

/* ------------------------------ base ------------------------------ */

test('dono do servidor pode tudo, mesmo sem cargo nenhum', () => {
  assert.equal(basePermissions(guild, 'dono', []), ALL);
});

test('cargos somam — não é o último que vale', () => {
  const bits = basePermissions(guild, 'ana', [
    everyone,
    role('r-mod', P.KICK_MEMBERS, 5),
    role('r-dj', P.MUTE_MEMBERS, 3)
  ]);
  assert.ok(has(bits, P.KICK_MEMBERS));
  assert.ok(has(bits, P.MUTE_MEMBERS));
  assert.ok(has(bits, P.SPEAK));            // veio do @everyone
  assert.ok(!has(bits, P.BAN_MEMBERS));
});

test('ADMINISTRATOR em qualquer cargo abre tudo', () => {
  const bits = basePermissions(guild, 'ana', [everyone, role('r-adm', P.ADMINISTRATOR, 9)]);
  assert.equal(bits, ALL);
});

test('sem @everyone na lista a pessoa fica sem piso — o esquecimento clássico', () => {
  const bits = basePermissions(guild, 'ana', [role('r-dj', P.MUTE_MEMBERS, 3)]);
  assert.ok(!has(bits, P.VIEW_CHANNEL));
});

/* ------------------------------ sobrescritas ------------------------------ */

test('sobrescrita do @everyone tira acesso do canal', () => {
  const base = basePermissions(guild, 'ana', [everyone]);
  const bits = channelPermissions(base, 'ana', [everyone], [
    ow('role', 'r-everyone', 0n, P.VIEW_CHANNEL)
  ]);
  assert.ok(!has(bits, P.VIEW_CHANNEL));
  assert.ok(has(bits, P.CONNECT));   // o resto continua
});

test('cargo devolve o que o @everyone tirou', () => {
  const mod = role('r-mod', 0n, 5);
  const base = basePermissions(guild, 'ana', [everyone, mod]);
  const bits = channelPermissions(base, 'ana', [everyone, mod], [
    ow('role', 'r-everyone', 0n, P.VIEW_CHANNEL),
    ow('role', 'r-mod', P.VIEW_CHANNEL, 0n)
  ]);
  assert.ok(has(bits, P.VIEW_CHANNEL));
});

test('entre dois cargos, quem permite vence quem nega', () => {
  // Este é o caso que denuncia implementação errada: aplicar um cargo por
  // vez faria o resultado depender da ordem em que vieram do banco.
  const nega = role('r-nega', 0n, 2);
  const libera = role('r-libera', 0n, 8);
  const roles = [everyone, nega, libera];
  const overwrites = [
    ow('role', 'r-nega', 0n, P.SPEAK),
    ow('role', 'r-libera', P.SPEAK, 0n)
  ];

  const base = basePermissions(guild, 'ana', roles);
  const direto = channelPermissions(base, 'ana', roles, overwrites);
  const invertido = channelPermissions(base, 'ana', [everyone, libera, nega], [...overwrites].reverse());

  assert.ok(has(direto, P.SPEAK));
  assert.equal(direto, invertido, 'a ordem dos cargos não pode mudar o resultado');
});

test('sobrescrita da pessoa ganha de qualquer cargo', () => {
  const mod = role('r-mod', 0n, 5);
  const roles = [everyone, mod];
  const base = basePermissions(guild, 'ana', roles);
  const bits = channelPermissions(base, 'ana', roles, [
    ow('role', 'r-mod', P.SPEAK, 0n),
    ow('user', 'ana', 0n, P.SPEAK)
  ]);
  assert.ok(!has(bits, P.SPEAK), 'o silêncio individual tem que valer');
});

test('sobrescrita não alcança quem tem ADMINISTRATOR', () => {
  const adm = role('r-adm', P.ADMINISTRATOR, 9);
  const roles = [everyone, adm];
  const base = basePermissions(guild, 'ana', roles);
  const bits = channelPermissions(base, 'ana', roles, [
    ow('role', 'r-everyone', 0n, ALL),
    ow('user', 'ana', 0n, ALL)
  ]);
  assert.equal(bits, ALL);
});

test('dono passa por cima de sobrescrita que nega tudo', () => {
  const bits = permissionsFor({
    guild, userId: 'dono', memberRoles: [everyone],
    overwrites: [ow('user', 'dono', 0n, ALL)]
  });
  assert.equal(bits, ALL);
});

test('canal sem sobrescrita devolve a base intacta', () => {
  const roles = [everyone];
  assert.equal(
    permissionsFor({ guild, userId: 'ana', memberRoles: roles, overwrites: [] }),
    basePermissions(guild, 'ana', roles)
  );
});

/* ------------------------------ hierarquia ------------------------------ */

test('posição mais alta é a que conta, e o dono fica acima de tudo', () => {
  assert.equal(topPosition(guild, 'ana', [everyone, role('a', 0n, 3), role('b', 0n, 7)]), 7);
  assert.equal(topPosition(guild, 'dono', []), Infinity);
});

test('só alcança quem está estritamente abaixo', () => {
  const alto = [role('r1', P.KICK_MEMBERS, 9)];
  const medio = [role('r2', P.KICK_MEMBERS, 5)];
  const outroMedio = [role('r3', P.KICK_MEMBERS, 5)];

  assert.ok(canActOn({ guild, actorId: 'a', actorRoles: alto, targetId: 'b', targetRoles: medio }));
  assert.ok(!canActOn({ guild, actorId: 'b', actorRoles: medio, targetId: 'a', targetRoles: alto }));
  assert.ok(
    !canActOn({ guild, actorId: 'b', actorRoles: medio, targetId: 'c', targetRoles: outroMedio }),
    'mesmo nível não alcança — senão dois moderadores se expulsam em looping'
  );
});

test('ninguém alcança o dono, nem com cargo altíssimo', () => {
  assert.ok(!canActOn({
    guild, actorId: 'ana', actorRoles: [role('r', P.ADMINISTRATOR, 999)],
    targetId: 'dono', targetRoles: []
  }));
});

test('não se age sobre si mesmo', () => {
  assert.ok(!canActOn({ guild, actorId: 'dono', actorRoles: [], targetId: 'dono', targetRoles: [] }));
});

/* ------------------------------ cenário inteiro ------------------------------ */

test('canal de voz trancado só para um cargo', () => {
  // "Canal dos veteranos": @everyone não vê nem entra; o cargo entra e fala.
  const vet = role('r-vet', 0n, 4);
  const roles = [everyone, vet];
  const overwrites = [
    ow('role', 'r-everyone', 0n, P.VIEW_CHANNEL | P.CONNECT),
    ow('role', 'r-vet', P.VIEW_CHANNEL | P.CONNECT, 0n)
  ];

  const novato = permissionsFor({ guild, userId: 'novato', memberRoles: [everyone], overwrites });
  assert.ok(!has(novato, P.VIEW_CHANNEL));
  assert.ok(!has(novato, P.CONNECT));

  const veterano = permissionsFor({ guild, userId: 'ana', memberRoles: roles, overwrites });
  assert.ok(has(veterano, P.VIEW_CHANNEL));
  assert.ok(has(veterano, P.CONNECT));
  assert.ok(has(veterano, P.SPEAK));
});

test('canal de anúncio: todos leem, só o cargo escreve', () => {
  const staff = role('r-staff', 0n, 6);
  const overwrites = [
    ow('role', 'r-everyone', 0n, P.SEND_MESSAGES),
    ow('role', 'r-staff', P.SEND_MESSAGES, 0n)
  ];

  const leitor = permissionsFor({ guild, userId: 'joao', memberRoles: [everyone], overwrites });
  assert.ok(has(leitor, P.VIEW_CHANNEL));
  assert.ok(!has(leitor, P.SEND_MESSAGES));

  const escritor = permissionsFor({ guild, userId: 'ana', memberRoles: [everyone, staff], overwrites });
  assert.ok(has(escritor, P.SEND_MESSAGES));
});
