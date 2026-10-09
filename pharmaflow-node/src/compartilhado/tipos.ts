import type { db } from '../database/db';

/** Conexão do drizzle que os repositories recebem no construtor. */
export type BancoDeDados = typeof db;

/** Linha crua do Postgres (numeric e bigint chegam como string). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Linha = Record<string, any>;
