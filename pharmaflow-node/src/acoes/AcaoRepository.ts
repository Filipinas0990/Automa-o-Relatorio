import { eq, sql } from 'drizzle-orm';
import { acoes } from '../database/schema';
import type { Acao } from '../database/schema';
import type { BancoDeDados, Linha } from '../compartilhado/tipos';

export type NovaAcao = typeof acoes.$inferInsert;

export interface FiltrosAcao {
  mes?: string;
  status?: string;
  tipo?: string;
}

/** Acesso à tabela acoes (ações de marketing do mês). */
export class AcaoRepository {
  constructor(private readonly db: BancoDeDados) {}

  async buscarPorId(id: number): Promise<Acao | undefined> {
    const [a] = await this.db.select().from(acoes).where(eq(acoes.id, id));
    return a;
  }

  async buscarComCriador(id: number): Promise<Linha | undefined> {
    const { rows } = await this.db.execute(sql`
      SELECT a.*, g.nome AS criado_por_nome
      FROM acoes a
      LEFT JOIN gestores_trafego g ON g.id = a.criado_por_id
      WHERE a.id = ${id}
    `);
    return rows[0];
  }

  /** Com o nome de quem criou e quantas farmácias participam. */
  async listar(f: FiltrosAcao): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT a.*,
             g.nome            AS criado_por_nome,
             COUNT(fa.id)::int AS total_farmacias
      FROM acoes a
      LEFT JOIN gestores_trafego g  ON g.id = a.criado_por_id
      LEFT JOIN farmacia_acoes   fa ON fa.acao_id = a.id
      WHERE 1=1
      ${f.mes    ? sql`AND a.mes_referencia = ${f.mes}` : sql``}
      ${f.status ? sql`AND a.status = ${f.status}`      : sql``}
      ${f.tipo   ? sql`AND a.tipo = ${f.tipo}`          : sql``}
      GROUP BY a.id, g.nome
      ORDER BY a.mes_referencia DESC, a.criado_em DESC
    `);
    return rows;
  }

  /** Ações do mês com quantas farmácias participam de cada uma. */
  async doMes(mes: string): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT a.id, a.nome, a.tipo, a.status, a.cor,
             COUNT(fa.id)::int AS total_farmacias
      FROM acoes a
      LEFT JOIN farmacia_acoes fa ON fa.acao_id = a.id
      WHERE a.mes_referencia = ${mes}
      GROUP BY a.id
      ORDER BY a.tipo, a.nome
    `);
    return rows;
  }

  /** Totais do mês: ações por status e farmácias distintas envolvidas. */
  async totaisDoMes(mes: string): Promise<Linha> {
    const { rows } = await this.db.execute(sql`
      SELECT
        COUNT(DISTINCT a.id)::int                                           AS total_acoes,
        COUNT(DISTINCT fa.farmacia_id)::int                                 AS farmacias_com_acao,
        COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'planejada')::int    AS planejadas,
        COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'em_andamento')::int AS em_andamento,
        COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'concluida')::int    AS concluidas,
        COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'cancelada')::int    AS canceladas
      FROM acoes a
      LEFT JOIN farmacia_acoes fa ON fa.acao_id = a.id
      WHERE a.mes_referencia = ${mes}
    `);
    return rows[0] || {};
  }

  async tiposDoMes(mes: string): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT tipo, COUNT(*)::int AS quantidade
      FROM acoes
      WHERE mes_referencia = ${mes}
      GROUP BY tipo
      ORDER BY quantidade DESC
    `);
    return rows;
  }

  async criar(dados: NovaAcao): Promise<Acao> {
    const [a] = await this.db.insert(acoes).values(dados).returning();
    return a;
  }

  async atualizar(id: number, dados: Partial<NovaAcao>): Promise<void> {
    if (!Object.keys(dados).length) return;
    await this.db.update(acoes).set(dados).where(eq(acoes.id, id));
  }
}
