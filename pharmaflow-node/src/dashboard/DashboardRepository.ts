import { sql, type SQL } from 'drizzle-orm';
import type { BancoDeDados, Linha } from '../compartilhado/tipos';

/** Leituras dos gráficos do dashboard. */
export class DashboardRepository {
  constructor(private readonly db: BancoDeDados) {}

  /**
   * Vendas, receita e atendimentos somados por dia de coleta, nos últimos 90
   * dias, para os períodos de 7 e 30 dias. `gestorId` null = todas as farmácias.
   */
  async vendasPorDia(gestorId: number | null): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT
        c.data_coleta::date                AS data,
        c.periodo_dias,
        SUM(c.vendas_realizadas)::int      AS vendas,
        ROUND(SUM(c.receita_total), 2)     AS receita,
        SUM(c.total_atendimentos)::int     AS atendimentos,
        COUNT(DISTINCT c.farmacia_id)::int AS farmacias
      FROM coletas c
      JOIN farmacias f ON f.id = c.farmacia_id
      WHERE f.ativa = TRUE
        AND c.periodo_dias IN (7, 30)
        AND c.data_coleta >= NOW() - INTERVAL '90 days'
        ${gestorId ? sql`AND f.gestor_id = ${gestorId}` : sql``}
      GROUP BY c.data_coleta::date, c.periodo_dias
      ORDER BY data ASC, c.periodo_dias ASC
    `);
    return rows;
  }

  /** Reuniões criadas nos últimos 90 dias, por status. */
  async reunioesPorStatus(gestorId: number | null): Promise<Linha> {
    const { rows } = await this.db.execute(sql`
      SELECT
        COUNT(*)::int                                          AS total,
        COUNT(*) FILTER (WHERE r.status = 'realizada')::int   AS realizadas,
        COUNT(*) FILTER (WHERE r.status = 'cancelada')::int   AS canceladas,
        COUNT(*) FILTER (WHERE r.status = 'confirmada')::int  AS confirmadas,
        COUNT(*) FILTER (WHERE r.status = 'agendada')::int    AS agendadas
      FROM reunioes r
      WHERE r.criado_em >= NOW() - INTERVAL '90 days'
      ${this.doGestor(gestorId)}
    `);
    return rows[0] || {};
  }

  /** As 10 farmácias com mais reuniões criadas nos últimos 90 dias. */
  async reunioesPorFarmacia(gestorId: number | null): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT
        f.nome                                                             AS farmacia_nome,
        COUNT(*)::int                                                      AS total,
        COUNT(*) FILTER (WHERE r.status = 'realizada')::int               AS realizadas,
        COUNT(*) FILTER (WHERE r.status = 'cancelada')::int               AS canceladas,
        COUNT(*) FILTER (WHERE r.status IN ('agendada','confirmada'))::int AS pendentes
      FROM reunioes r
      JOIN farmacias f ON f.id = r.farmacia_id
      WHERE r.criado_em >= NOW() - INTERVAL '90 days'
      ${this.doGestor(gestorId)}
      GROUP BY f.id, f.nome
      ORDER BY total DESC
      LIMIT 10
    `);
    return rows;
  }

  /** Reuniões criadas por mês nos últimos 6 meses. */
  async reunioesPorMes(gestorId: number | null): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', r.criado_em), 'YYYY-MM') AS mes,
        COUNT(*)::int                                          AS total,
        COUNT(*) FILTER (WHERE r.status = 'realizada')::int   AS realizadas,
        COUNT(*) FILTER (WHERE r.status = 'cancelada')::int   AS canceladas
      FROM reunioes r
      WHERE r.criado_em >= NOW() - INTERVAL '6 months'
      ${this.doGestor(gestorId)}
      GROUP BY DATE_TRUNC('month', r.criado_em)
      ORDER BY mes ASC
    `);
    return rows;
  }

  /** Reuniões que o gestor conduz ou criou. */
  private doGestor(gestorId: number | null): SQL {
    return gestorId ? sql`AND (r.gestor_id = ${gestorId} OR r.criado_por_id = ${gestorId})` : sql``;
  }
}
