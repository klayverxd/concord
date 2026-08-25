'use strict';

/* Testes de verdade contra o segredo real do projeto: os tokens são
 * assinados aqui na hora, do mesmo jeito que o Supabase assina. Cada teste
 * fecha um buraco conhecido de verificação de JWT. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SignJWT, UnsecuredJWT } = require('jose');

const config = require('../lib/config');
const { verifyToken, AuthError } = require('../lib/auth');

const secret = new TextEncoder().encode(config.supabase.jwtSecret);
const ISS = config.supabase.issuer;
const UID = '11111111-2222-3333-4444-555555555555';

const temSegredo = Boolean(config.supabase.jwtSecret && ISS);

function sign(claims, { key = secret, expira = '1h', iss = ISS } = {}) {
  const jwt = new SignJWT({ aud: 'authenticated', role: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expira);
  if (iss) jwt.setIssuer(iss);
  return jwt.sign(key);
}

async function recusa(token, trecho) {
  await assert.rejects(
    () => verifyToken(token),
    (err) => {
      assert.ok(err instanceof AuthError, `esperava AuthError, veio ${err?.name}`);
      if (trecho) assert.match(err.message, trecho);
      return true;
    }
  );
}

test('config leu o .env e achou a referência do projeto', () => {
  assert.ok(config.supabase.url.startsWith('https://'));
  assert.match(config.supabase.ref, /^[a-z0-9]+$/);
  assert.equal(config.supabase.issuer, `${config.supabase.url}/auth/v1`);
});

test('token de pessoa é aceito e vira identidade', { skip: !temSegredo }, async () => {
  const token = await sign({
    sub: UID,
    email: 'ju@exemplo.com',
    user_metadata: { full_name: 'Ju Silva', avatar_url: 'https://exemplo.com/ju.png' }
  });

  const user = await verifyToken(token);
  assert.equal(user.id, UID);
  assert.equal(user.email, 'ju@exemplo.com');
  assert.equal(user.name, 'Ju Silva');
  assert.equal(user.avatar, 'https://exemplo.com/ju.png');
});

test('sem nome no metadata, cai para o e-mail', { skip: !temSegredo }, async () => {
  const user = await verifyToken(await sign({ sub: UID, email: 'so@email.com' }));
  assert.equal(user.name, 'so@email.com');
  assert.equal(user.avatar, null);
});

/* ------------------------------ recusas ------------------------------ */

test('a chave anon do projeto NÃO serve para entrar', { skip: !temSegredo }, async () => {
  // Ela é assinada com o mesmo segredo e passa na conferência de assinatura.
  // É pública — está no HTML. Sem checar `role`, qualquer visitante entrava.
  await recusa(config.supabase.anonKey, /não é de usuário|inválido/);
});

test('a chave service_role também não serve', { skip: !temSegredo }, async () => {
  await recusa(config.supabase.serviceKey, /não é de usuário|inválido/);
});

test('token assinado com outro segredo é recusado', { skip: !temSegredo }, async () => {
  const outro = new TextEncoder().encode('segredo-de-outra-pessoa-qualquer-1234567890');
  await recusa(await sign({ sub: UID }, { key: outro }), /inválido/);
});

test('token de OUTRO projeto Supabase é recusado', { skip: !temSegredo }, async () => {
  // Mesmo algoritmo, mesmo formato — só o emissor difere. Sem checar `iss`,
  // um projeto vizinho autenticaria gente aqui.
  await recusa(await sign({ sub: UID }, { iss: 'https://outroprojeto.supabase.co/auth/v1' }), /inválido/);
});

test('token vencido é recusado', { skip: !temSegredo }, async () => {
  await recusa(await sign({ sub: UID }, { expira: '-1h' }), /expirada/);
});

test('token sem assinatura (alg none) é recusado', { skip: !temSegredo }, async () => {
  const nu = new UnsecuredJWT({ sub: UID, role: 'authenticated', aud: 'authenticated', iss: ISS }).encode();
  await recusa(nu, /inválido/);
});

test('token válido mas sem sub é recusado', { skip: !temSegredo }, async () => {
  await recusa(await sign({ email: 'x@y.com' }), /sem identificação|inválido/);
});

test('audience errada é recusada', { skip: !temSegredo }, async () => {
  const token = await new SignJWT({ sub: UID, role: 'authenticated', aud: 'outra-coisa' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(ISS).setExpirationTime('1h').sign(secret);
  await recusa(token, /inválido/);
});

test('token vazio, nulo e lixo são recusados sem explodir', async () => {
  for (const ruim of ['', null, undefined, 'nao.e.um.jwt', 'a.b', {}, 42]) {
    await recusa(ruim);
  }
});
