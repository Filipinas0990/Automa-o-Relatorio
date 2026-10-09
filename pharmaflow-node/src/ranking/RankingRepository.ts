import { sql } from 'drizzle-orm';
import type { BancoDeDados } from '../compartilhado/tipos';

export type LinhaPontuacao = {
  gestor_id: number;
  gestor_nome: string;
  pontos: string | number;
  coletas_no_mes: string | number;
  farmacias_com_coleta?: string | number;
  total_farmacias?: string | number;
  mes?: string;
};

/**
 * Pontos de cada gestor: 1 por meta batida (vendas, leads Google, leads Meta)
 * em cada coleta das farmácias ativas dele.
 */
const PONTOS = sql`
  (COUNT(*) FILTER (WHERE c.atingiu_meta = TRUE) +
   COUNT(*) FILTER (WHERE c.atingiu_meta_google = TRUE) +
   COUNT(*) FILTER (WHERE c.atingiu_meta_meta = TRUE))
`;

/** Leituras do ranking de gestores. */
export class RankingRepository {
  constructor(private readonly db: BancoDeDados) {}

  /** Gestores com coleta semanal no mês de `mesRef` (AAAA-MM-01), do mais pontuado para o menos. */
  async pontuacaoDoMes(mesRef: string): Promise<LinhaPontuacao[]> {
    const { rows } = await this.db.execute<LinhaPontuacao>(sql`
      SELECT g.id AS gestor_id, g.nome AS gestor_nome,
             ${PONTOS}                                             AS pontos,
             COUNT(*)                                              AS coletas_no_mes,
             COUNT(DISTINCT c.farmacia_id)                        AS farmacias_com_coleta,
             (SELECT COUNT(*) FROM farmacias f2 WHERE f2.gestor_id = g.id AND f2.ativa = TRUE) AS total_farmacias
      FROM gestores_trafego g
      JOIN farmacias f ON f.gestor_id = g.id AND f.ativa = TRUE
      JOIN coletas c   ON c.farmacia_id = f.id
                      AND c.periodo_dias = 7
                      AND DATE_TRUNC('month', c.data_coleta) = DATE_TRUNC('month', CAST(${mesRef} AS date))
      WHERE g.ativo = TRUE
      GROUP BY g.id, g.nome
      ORDER BY pontos DESC, g.nome
    `);
    return rows;
  }

  /** Pontos por gestor e mês nos últimos 6 meses. */
  async historico(): Promise<LinhaPontuacao[]> {
    const { rows } = await this.db.execute<LinhaPontuacao>(sql`
      SELECT g.id AS gestor_id, g.nome AS gestor_nome,
             TO_CHAR(DATE_TRUNC('month', c.data_coleta), 'YYYY-MM') AS mes,
             ${PONTOS} AS pontos,
             COUNT(*) AS coletas_no_mes
      FROM gestores_trafego g
      JOIN farmacias f ON f.gestor_id = g.id AND f.ativa = TRUE
      JOIN coletas c   ON c.farmacia_id = f.id
                      AND c.data_coleta >= NOW() - INTERVAL '6 months'
      WHERE g.ativo = TRUE
      GROUP BY g.id, g.nome, DATE_TRUNC('month', c.data_coleta)
      ORDER BY mes DESC, pontos DESC
    `);
    return rows;
  }
}
