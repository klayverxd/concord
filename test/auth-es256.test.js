'use strict';

/* O login real quebrou porque o projeto assina com ES256 e o verificador
 * só aceitava HS256 — e os testes não pegaram, porque o token de teste era
 * forjado com o mesmo algoritmo do verificador.
 *
 * Este arquivo fecha esse buraco: sobe um JWKS de mentira num porto local,
 * aponta o config para ele, e verifica token ES256 de verdade. Assim o
 * caminho assimétrico é exercitado sem precisar de um login do Google. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { SignJWT, generateKeyPair, exportJWK } = require('jose');

const PORTA = 3392;
const ISS = `http://127.0.0.1:${PORTA}/auth/v1`;
const UID = '99999999-8888-7777-6666-555555555555';

let servidor, privada, outraPrivada, auth;

before(async () => {
  const par = await generateKeyPair('ES256');
  privada = par.privateKey;
  const jwk = { ...(await exportJWK(par.publicKey)), alg: 'ES256', use: 'sig', kid: 'chave-de-teste' };

  // uma segunda chave, para provar que assinatura de outro par é recusada
  const outroPar = await generateKeyPair('ES256');
  outraPrivada = outroPar.privateKey;

  servidor = http.createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => servidor.listen(PORTA, '127.0.0.1', r));

  /* O lib/auth.js monta o resolvedor de JWKS no momento em que é carregado,
   * a partir do config. Então o ambiente é ajustado ANTES do require. */
  process.env.SUPABASE_URL = `http://127.0.0.1:${PORTA}`;
  process.env.SUPABASE_JWT_SECRET = 'segredo-simetrico-de-teste-1234567890';
  delete require.cache[require.resolve('../lib/config')];
  delete require.cache[require.resolve('../lib/auth')];
  auth = require('../lib/auth');
});

after(() => { servidor?.close(); });

function assina(chave, alg, extra = {}) {
  return new SignJWT({ sub: UID, aud: 'authenticated', role: 'authenticated', email: 'x@y.com', ...extra })
    .setProtectedHeader({ alg, kid: 'chave-de-teste' })
    .setIssuedAt().setIssuer(ISS).setExpirationTime('1h')
    .sign(chave);
}

test('token ES256 assinado pela chave do JWKS é aceito', async () => {
  const token = await assina(privada, 'ES256', { user_metadata: { full_name: 'Ju Silva' } });
  const user = await auth.verifyToken(token);
  assert.equal(user.id, UID);
  assert.equal(user.name, 'Ju Silva');
});

test('token ES256 de OUTRA chave é recusado', async () => {
  const token = await assina(outraPrivada, 'ES256');
  await assert.rejects(() => auth.verifyToken(token), /inválido/i);
});

test('HS256 continua funcionando no mesmo servidor', async () => {
  // Projeto antigo, com o segredo legado — os dois caminhos convivem.
  const chave = new TextEncoder().encode('segredo-simetrico-de-teste-1234567890');
  const token = await assina(chave, 'HS256');
  const user = await auth.verifyToken(token);
  assert.equal(user.id, UID);
});

test('HS256 assinado com segredo errado é recusado', async () => {
  const errada = new TextEncoder().encode('nao-e-o-segredo-certo-xxxxxxxxxxxxxx');
  const token = await assina(errada, 'HS256');
  await assert.rejects(() => auth.verifyToken(token), /inválido/i);
});

test('ES256 com emissor de outro projeto é recusado', async () => {
  const token = await new SignJWT({ sub: UID, aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'chave-de-teste' })
    .setIssuedAt().setIssuer('https://outro.supabase.co/auth/v1').setExpirationTime('1h')
    .sign(privada);
  await assert.rejects(() => auth.verifyToken(token), /inválido/i);
});

test('ES256 vencido é recusado como sessão expirada', async () => {
  const token = await new SignJWT({ sub: UID, aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'chave-de-teste' })
    .setIssuedAt().setIssuer(ISS).setExpirationTime('-1h')
    .sign(privada);
  await assert.rejects(() => auth.verifyToken(token), /expirada/i);
});

test('ES256 com role errado é recusado', async () => {
  const token = await new SignJWT({ sub: UID, aud: 'authenticated', role: 'anon' })
    .setProtectedHeader({ alg: 'ES256', kid: 'chave-de-teste' })
    .setIssuedAt().setIssuer(ISS).setExpirationTime('1h')
    .sign(privada);
  await assert.rejects(() => auth.verifyToken(token), /não é de usuário/i);
});

test('alg none é recusado nos dois caminhos', async () => {
  const { UnsecuredJWT } = require('jose');
  const nu = new UnsecuredJWT({ sub: UID, role: 'authenticated', aud: 'authenticated', iss: ISS }).encode();
  await assert.rejects(() => auth.verifyToken(nu), /inválido/i);
});
