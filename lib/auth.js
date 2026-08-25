'use strict';

/* ------------------------------------------------------------------ *
 * Autenticação — confere o token que o Supabase entregou ao navegador.
 *
 * O login acontece todo no Supabase (Google). O navegador recebe um
 * access_token e manda para cá. Aqui a assinatura é CONFERIDA, não
 * decodificada: decodificar e confiar é o erro clássico — qualquer um
 * monta um JWT com o `sub` que quiser.
 *
 * DOIS jeitos de assinar, e o projeto decide qual:
 *
 *   ES256/RS256 — chave assimétrica, o padrão nos projetos novos. A chave
 *                 pública vem do JWKS do próprio projeto.
 *   HS256       — o "legacy JWT secret", nos projetos mais antigos.
 *
 * Suportar só um dos dois é a armadilha: os testes passam (porque o token
 * de teste é forjado com o mesmo algoritmo do verificador) e o login real
 * falha. Aqui o caminho é escolhido pelo `alg` do cabeçalho, e cada um
 * fixa o seu próprio algoritmo — então não dá para rebaixar de um para o
 * outro.
 *
 * Quatro coisas precisam bater, e cada uma fecha um buraco diferente:
 *   assinatura → o token é do nosso projeto
 *   alg fixo   → ninguém troca por `none` para dispensar a chave
 *   iss        → o token não veio de OUTRO projeto Supabase
 *   role       → é token de pessoa, não a chave `anon` (que é pública!)
 * ------------------------------------------------------------------ */

const { jwtVerify, createRemoteJWKSet, decodeProtectedHeader, errors } = require('jose');
const config = require('./config');

/* O segredo do Supabase parece base64 (termina em `==`), mas é usado como
 * bytes UTF-8 crus. Tratar como base64 faz toda assinatura falhar — e o
 * sintoma é "ninguém consegue entrar", que manda caçar no lugar errado. */
const chaveSimetrica = config.supabase.jwtSecret
  ? new TextEncoder().encode(config.supabase.jwtSecret)
  : null;

/* O jose cuida do cache e de buscar de novo quando a chave gira. Criado uma
 * vez só: um resolvedor por processo, não por requisição. */
const jwks = config.supabase.url
  ? createRemoteJWKSet(new URL(`${config.supabase.url.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`), {
      cooldownDuration: 30000,
      cacheMaxAge: 10 * 60 * 1000
    })
  : null;

const ASSIMETRICOS = ['ES256', 'RS256', 'ES384', 'RS384', 'ES512', 'RS512', 'EdDSA'];

class AuthError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'AuthError';
  }
}

/**
 * Confere o token e devolve a identidade da pessoa.
 * Lança AuthError em qualquer problema — nunca devolve algo pela metade.
 *
 * @param {string} token access_token do Supabase
 * @returns {{id: string, email: string, name: string, avatar: string|null}}
 */
async function verifyToken(token) {
  if (typeof token !== 'string' || !token) throw new AuthError('token ausente');

  // Ler o cabeçalho aqui NÃO é confiar nele: serve só para escolher o
  // caminho. Cada caminho depois fixa o algoritmo que aceita.
  let alg;
  try {
    ({ alg } = decodeProtectedHeader(token));
  } catch (_) {
    throw new AuthError('token inválido');
  }

  const opcoes = {
    issuer: config.supabase.issuer || undefined,
    audience: 'authenticated'
  };

  let payload;
  try {
    if (ASSIMETRICOS.includes(alg)) {
      if (!jwks) throw new AuthError('servidor sem SUPABASE_URL');
      ({ payload } = await jwtVerify(token, jwks, { ...opcoes, algorithms: ASSIMETRICOS }));
    } else {
      if (!chaveSimetrica) throw new AuthError('servidor sem SUPABASE_JWT_SECRET');
      ({ payload } = await jwtVerify(token, chaveSimetrica, { ...opcoes, algorithms: ['HS256'] }));
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err instanceof errors.JWTExpired) throw new AuthError('sessão expirada');
    throw new AuthError('token inválido');
  }

  // As chaves `anon` e `service_role` são assinadas com o MESMO segredo e
  // passariam na conferência de assinatura. A `anon` é pública — está no
  // HTML. Sem esta checagem, qualquer visitante entraria com ela.
  if (payload.role !== 'authenticated') throw new AuthError('token não é de usuário');
  if (!payload.sub) throw new AuthError('token sem identificação de usuário');

  const meta = payload.user_metadata || {};
  return {
    id: payload.sub,
    email: payload.email || meta.email || '',
    name: (meta.full_name || meta.name || payload.email || 'sem nome').slice(0, 60),
    avatar: meta.avatar_url || meta.picture || null
  };
}

/* --------------------------- pontos de entrada --------------------------- */

function bearerFrom(req) {
  const h = req.headers?.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Middleware Express para rotas que exigem estar logado. */
function requireUser(req, res, next) {
  verifyToken(bearerFrom(req))
    .then((user) => { req.user = user; next(); })
    .catch((err) => res.status(401).json({ error: err.message }));
}

/**
 * Autenticação do socket.io no aperto de mão: um socket sem token válido
 * nem chega a conectar, então nenhum handler precisa se perguntar se há
 * alguém do outro lado.
 *
 * O cliente manda em `io({ auth: { token } })`.
 */
function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token || bearerFrom({ headers: socket.handshake.headers });
  verifyToken(token)
    .then((user) => { socket.user = user; next(); })
    .catch((err) => next(new Error(err.message)));
}

module.exports = { AuthError, verifyToken, requireUser, socketAuth, bearerFrom };
