/**
 * globalSetup do Vitest — cria o banco de teste do zero antes da suíte.
 *
 * Os testes NUNCA tocam o banco de desenvolvimento: usam um banco separado
 * (`farmacia_monitor_test`), recriado a cada execução para que o resultado não
 * dependa de sobras da rodada anterior.
 *
 * O schema vem de `test/schema.sql` (pg_dump --schema-only). Quando o schema
 * mudar, regenere com:
 *   docker exec farmacia_db pg_dump -U farmacia -d farmacia_monitor \
 *     --schema-only --no-owner --no-privileges > test/schema.sql
 */
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ADMIN_URL = process.env.TEST_ADMIN_URL
  || 'postgresql://farmacia:farmacia123@localhost:5432/postgres';

export const TEST_DB   = process.env.TEST_DB_NAME || 'farmacia_monitor_test';
export const TEST_URL  = process.env.TEST_DATABASE_URL
  || `postgresql://farmacia:farmacia123@localhost:5432/${TEST_DB}`;

export default async function prepararBanco(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();

  // Derruba conexões abertas, senão o DROP trava
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [TEST_DB],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  // O pg_dump 17+ inclui meta-comandos do psql (\restrict, \unrestrict) que a
  // lib `pg` não entende — só o psql interpreta. Removemos essas linhas.
  const schema = readFileSync(resolve(__dirname, 'schema.sql'), 'utf-8')
    .split('\n')
    .filter((linha) => !linha.startsWith('\\'))
    .join('\n');

  const alvo = new Client({ connectionString: TEST_URL });
  await alvo.connect();
  await alvo.query(schema);
  await alvo.end();

  // eslint-disable-next-line no-console
  console.log(`\n[testes] banco "${TEST_DB}" recriado a partir de test/schema.sql`);
}
