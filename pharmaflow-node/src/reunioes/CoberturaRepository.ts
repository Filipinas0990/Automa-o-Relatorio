import { sql } from 'drizzle-orm';
import type { BancoDeDados, Linha } from '../compartilhado/tipos';

/**
 * Leituras de cobertura: quais farmácias tiveram reunião no mês.
 * Entram as farmácias ativas nas fases 'ativo' e 'entrada'.
 * `gestorId` null = todas (visão do admin).
 */
export class CoberturaRepository {
  constructor(private readonly db: BancoDeDados) {}

  /** Farmácias atendidas, com gestor e o alerta da última coleta semanal. */
  async farmacias(gestorId: number | null): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT f.id, f.nome, f.cidade, f.responsavel, f.telefone, f.gestor_id,
             g.nome AS gestor_nome,
             COALESCE(rv.nivel_alerta, 'verde') AS nivel_alerta
      FROM farmacias f
      LEFT JOIN gestores_trafego g ON g.id = f.gestor_id
      LEFT JOIN vw_ranking_atual rv ON rv.farmacia_id = f.id AND rv.periodo_dias = 7
      WHERE f.ativa = TRUE AND f.fase IN ('ativo', 'entrada')
      ${gestorId ? sql`AND (f.gestor_id = ${gestorId})` : sql``}
      ORDER BY f.nome
    `);
    return rows;
  }

  async totalFarmacias(gestorId: number | null): Promise<number> {
    const { rows } = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM farmacias f
      WHERE f.ativa = TRUE AND f.fase IN ('ativo', 'entrada')
      ${gestorId ? sql`AND f.gestor_id = ${gestorId}` : sql``}
    `);
    return parseInt(rows[0]?.total as string || '0');
  }

  /** Reuniões não canceladas do mês (`AAAA-MM`), com o nome do gestor. */
  async reunioesDoMes(mes: string): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT r.id, r.farmacia_id, r.titulo, r.data_reuniao,
             r.duracao_minutos, r.status, r.observacoes,
             r.gestor_id, g.nome AS gestor_nome
      FROM reunioes r
      LEFT JOIN gestores_trafego g ON g.id = r.gestor_id
      WHERE DATE_TRUNC('month', r.data_reuniao) = DATE_TRUNC('month', ${mes + '-01'}::date)
        AND r.status != 'cancelada'
      ORDER BY r.farmacia_id, r.data_reuniao ASC
    `);
    return rows;
  }

  /** Por mês (dos últimos `nMeses`): farmácias distintas com reunião e reuniões por status. */
  async porMes(nMeses: number, gestorId: number | null): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', r_inner.data_reuniao), 'YYYY-MM') AS mes,
        COUNT(DISTINCT r_inner.farmacia_id)::int                       AS farmacias_com_reuniao,
        COUNT(*)::int                                                  AS total_reunioes,
        COUNT(*) FILTER (WHERE r_inner.status = 'realizada')::int      AS realizadas,
        COUNT(*) FILTER (WHERE r_inner.status = 'confirmada')::int     AS confirmadas,
        COUNT(*) FILTER (WHERE r_inner.status = 'agendada')::int       AS agendadas
      FROM reunioes r_inner
      WHERE r_inner.status != 'cancelada'
        AND r_inner.data_reuniao >= DATE_TRUNC('month', NOW() - (${nMeses - 1} || ' months')::interval)
      ${gestorId ? sql`AND r_inner.gestor_id = ${gestorId}` : sql``}
      GROUP BY DATE_TRUNC('month', r_inner.data_reuniao)
      ORDER BY mes ASC
    `);
    return rows;
  }
}
