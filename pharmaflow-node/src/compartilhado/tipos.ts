import type { db } from '../database/db';

/** Conexão do drizzle que os repositories recebem no construtor. */
export type BancoDeDados = typeof db;
