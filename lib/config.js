'use strict';

/* ------------------------------------------------------------------ *
 * Configuração — lê o .env em desenvolvimento, usa o ambiente em produção.
 *
 * Nada de biblioteca para isso: o Node já carrega .env sozinho desde a
 * versão 20.6. Em produção o arquivo não existe e as variáveis vêm do
 * painel da hospedagem, então a ausência dele não é erro.
 * ------------------------------------------------------------------ */

const path = require('path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (_) {
  // sem .env: normal em produção
}

const isProd = process.env.NODE_ENV === 'production';

const config = {
  isProd,
  port: Number(process.env.PORT || 3000),
  maxPerRoom: Number(process.env.MAX_PER_ROOM || 15),

  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    jwtSecret: process.env.SUPABASE_JWT_SECRET || '',
    databaseUrl: process.env.DATABASE_URL || ''
  },

  turn: {
    url: process.env.TURN_URL || '',
    user: process.env.TURN_USER || '',
    pass: process.env.TURN_PASS || ''
  }
};

// A referência do projeto vive dentro da própria URL. Serve para conferir
// que um token veio DESTE projeto, e não de outro qualquer do Supabase.
config.supabase.ref = (() => {
  const m = /^https:\/\/([a-z0-9-]+)\.supabase\./i.exec(config.supabase.url);
  return m ? m[1] : '';
})();

config.supabase.issuer = config.supabase.url
  ? `${config.supabase.url.replace(/\/+$/, '')}/auth/v1`
  : '';

/* Se vier só a senha, a URL de conexão é montada aqui. Isso existe porque
 * senha com `@`, `/` ou `:` dentro quebra a sintaxe da URL se colada à mão —
 * e o erro que aparece é de host inválido, que manda procurar no lugar
 * errado. Passando pelo encodeURIComponent, qualquer senha serve.
 *
 * O host direto (`db.<ref>.supabase.co`) só tem endereço IPv6. Serve para
 * desenvolver; para hospedar em plataforma sem IPv6 de saída, use a string
 * do pooler em DATABASE_URL, que tem IPv4. */
if (!config.supabase.databaseUrl && process.env.DB_PASSWORD && config.supabase.ref) {
  const senha = encodeURIComponent(process.env.DB_PASSWORD);
  config.supabase.databaseUrl =
    `postgresql://postgres:${senha}@db.${config.supabase.ref}.supabase.co:5432/postgres`;
}

/** O que falta para a autenticação funcionar. Vazio = tudo pronto. */
function missing() {
  const need = {
    SUPABASE_URL: config.supabase.url,
    SUPABASE_ANON_KEY: config.supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: config.supabase.serviceKey,
    SUPABASE_JWT_SECRET: config.supabase.jwtSecret,
    DATABASE_URL: config.supabase.databaseUrl
  };
  return Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
}

config.authReady = () => missing().length === 0;
config.missing = missing;

module.exports = config;
