'use strict';

/* ------------------------------------------------------------------ *
 * Aplica os arquivos de sql/ em ordem e anota o que já rodou.
 *
 * Colar SQL à mão no painel funciona uma vez; na terceira ninguém sabe
 * mais o que foi aplicado em qual banco. A tabela `_migrations` resolve
 * isso: rodar de novo não repete nada.
 *
 *   npm run migrate          aplica o que falta
 *   npm run migrate -- --lista   só mostra a situação
 * ------------------------------------------------------------------ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const postgres = require('postgres');
const config = require('../lib/config');

const DIR = path.join(__dirname, '..', 'sql');
const soListar = process.argv.includes('--lista');

if (!config.supabase.databaseUrl) {
  console.error('Falta DB_PASSWORD ou DATABASE_URL no .env.');
  process.exit(1);
}

// Os "already exists, skipping" são o comportamento normal de IF NOT EXISTS
// e enterram qualquer aviso que importe. Ficam de fora; o resto aparece.
const RUIDO = new Set(['42P07', '42710', '42P06', '42704']);

const sql = postgres(config.supabase.databaseUrl, {
  ssl: 'require',
  prepare: false,          // o pooler em modo transação não aceita prepared statement
  connect_timeout: 20,
  max: 1,
  onnotice: (n) => {
    if (!RUIDO.has(n.code)) console.log(`    aviso do banco: ${n.message}`);
  }
});

const digest = (texto) => crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16);

(async () => {
  let saida = 0;
  try {
    await sql`
      create table if not exists public._migrations (
        arquivo    text primary key,
        hash       text not null,
        aplicado_em timestamptz not null default now()
      )`;

    const jaFoi = new Map(
      (await sql`select arquivo, hash from public._migrations`).map((r) => [r.arquivo, r.hash])
    );

    const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    if (!arquivos.length) return console.log('Nenhum arquivo em sql/.');

    for (const arquivo of arquivos) {
      const texto = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
      const hash = digest(texto);
      const anotado = jaFoi.get(arquivo);

      if (anotado === hash) {
        console.log(`  já aplicado   ${arquivo}`);
        continue;
      }

      /* Arquivo já aplicado que MUDOU depois é aviso, não conserto
       * automático: o banco pode estar num estado que o novo texto não
       * descreve, e sobrescrever calado esconde o problema. */
      if (anotado && anotado !== hash) {
        console.log(`  MUDOU depois de aplicado: ${arquivo}`);
        console.log('    Crie um arquivo novo com a diferença em vez de editar este.');
        saida = 1;
        continue;
      }

      if (soListar) {
        console.log(`  pendente      ${arquivo}`);
        continue;
      }

      process.stdout.write(`  aplicando     ${arquivo} ... `);
      await sql.begin(async (tx) => {
        await tx.unsafe(texto);
        await tx`insert into public._migrations (arquivo, hash) values (${arquivo}, ${hash})`;
      });
      console.log('pronto');
    }
  } catch (err) {
    console.error('\nFalhou:', err.code || '', err.message);
    if (err.position) console.error('posição no arquivo:', err.position);
    saida = 1;
  } finally {
    await sql.end({ timeout: 5 });
    process.exit(saida);
  }
})();
