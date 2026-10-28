import { sql } from 'drizzle-orm';
import type { BancoDeDados, Linha } from '../compartilhado/tipos';
import type { LinhaCanal } from './AgregadorCanais';

/** Soma de uma origem de uma farmácia num intervalo da coleta diária. */
export type LinhaDiariaSomada = {
  farmacia_id:  number;
  origem:       string;
  atendimentos: number;
  vendas:       number;
  receita:      number;
}

/**
 * Leituras de desempenho das farmácias: ranking da última coleta, vendas por
 * canal e evolução semanal.
 *
 * `gestorId` null = todas as farmácias (visão do admin).
 */
export class DesempenhoRepository {
  constructor(private readonly db: BancoDeDados) {}

  /** Ranking atual das farmácias que já têm coleta no período. */
  async rankingAtual(dias: number, gestorId: string | null): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT r.* FROM vw_ranking_atual r
      JOIN farmacias f ON f.id = r.farmacia_id
      WHERE r.periodo_dias = ${dias} ${this.doGestor(gestorId)}
    `);
    return rows;
  }

  /** Todas as farmácias ativas, com o ranking quando houver (sem coleta vira verde/zerado). */
  async farmaciasComRanking(dias: number, gestorId: string | null, fase: string | null): Promise<Linha[]> {
    const faseSql = fase ? sql`AND f.fase = ${fase}` : sql``;
    const { rows } = await this.db.execute(sql`
      SELECT f.id AS farmacia_id, f.nome AS farmacia, f.nome_fachada, f.gestor_id, f.ativa, f.tem_chatbot,
             f.fase, f.telefone, f.responsavel, f.cidade,
             f.meta_vendas, f.meta_receita, f.meta_leads_google, f.meta_leads_meta, f.meta_ad_account_id,
             COALESCE(r.nivel_alerta, 'verde')    AS nivel_alerta,
             COALESCE(r.receita_total, 0)         AS receita_total,
             COALESCE(r.total_atendimentos, 0)    AS total_atendimentos,
             COALESCE(r.vendas_realizadas, 0)     AS vendas_realizadas,
             COALESCE(r.variacao_receita, 0)      AS variacao_receita,
             COALESCE(r.variacao_vendas, 0)       AS variacao_vendas,
             COALESCE(r.score_criticidade, 0)     AS score_criticidade,
             COALESCE(r.posicao_ranking, 9999)    AS posicao_ranking,
             r.periodo_inicio, r.periodo_fim, r.data_coleta
      FROM farmacias f
      LEFT JOIN vw_ranking_atual r ON r.farmacia_id = f.id AND r.periodo_dias = ${dias}
      WHERE f.ativa = TRUE ${this.doGestor(gestorId)} ${faseSql}
      ORDER BY posicao_ranking
    `);
    return rows;
  }

  /** Totais por canal na última coleta de cada farmácia, somando todas. */
  async canaisSomados(dias: number, gestorId: string | null): Promise<LinhaCanal[]> {
    const { rows } = await this.db.execute<LinhaCanal>(sql`
      SELECT cc.canal,
             SUM(cc.atendimentos)::int       AS total_atendimentos,
             SUM(cc.vendas)::int             AS total_vendas,
             SUM(cc.receita_vendas)::numeric AS total_receita_vendas
      FROM coleta_canais cc
      JOIN ${this.ultimaColeta(dias)} latest ON latest.coleta_id = cc.coleta_id
      JOIN farmacias f ON f.id = latest.farmacia_id
      WHERE f.ativa = TRUE ${this.doGestor(gestorId)}
      GROUP BY cc.canal
      ORDER BY total_atendimentos DESC
    `);
    return rows;
  }

  /** Totais por canal na última coleta, separados por farmácia. */
  async canaisPorFarmacia(dias: number, gestorId: string | null): Promise<(LinhaCanal & { farmacia_id: string })[]> {
    const { rows } = await this.db.execute<LinhaCanal & { farmacia_id: string }>(sql`
      SELECT latest.farmacia_id, cc.canal,
             SUM(cc.atendimentos)::int       AS total_atendimentos,
             SUM(cc.vendas)::int             AS total_vendas,
             SUM(cc.receita_vendas)::numeric AS total_receita_vendas
      FROM coleta_canais cc
      JOIN ${this.ultimaColeta(dias)} latest ON latest.coleta_id = cc.coleta_id
      JOIN farmacias f ON f.id = latest.farmacia_id
      WHERE f.ativa = TRUE ${this.doGestor(gestorId)}
      GROUP BY latest.farmacia_id, cc.canal
      ORDER BY latest.farmacia_id, total_atendimentos DESC
    `);
    return rows;
  }

  /** Farmácias ativas do escopo, sem números — o período livre soma os dias à parte. */
  async farmaciasDoEscopo(gestorId: string | null, fase: string | null): Promise<Linha[]> {
    const faseSql = fase ? sql`AND f.fase = ${fase}` : sql``;
    const { rows } = await this.db.execute(sql`
      SELECT f.id AS farmacia_id, f.nome AS farmacia, f.nome_fachada, f.gestor_id, f.ativa, f.tem_chatbot,
             f.fase, f.telefone, f.responsavel, f.cidade,
             f.meta_vendas, f.meta_receita, f.meta_leads_google, f.meta_leads_meta, f.meta_ad_account_id
      FROM farmacias f
      WHERE f.ativa = TRUE ${this.doGestor(gestorId)} ${faseSql}
    `);
    return rows;
  }

  /** Soma da coleta dia a dia no intervalo, por farmácia e origem. */
  async somaDiaria(inicio: string, fim: string, gestorId: string | null): Promise<LinhaDiariaSomada[]> {
    const { rows } = await this.db.execute<LinhaDiariaSomada>(sql`
      SELECT cd.farmacia_id, cd.origem,
             SUM(cd.atendimentos)::int AS atendimentos,
             SUM(cd.vendas)::int       AS vendas,
             SUM(cd.receita)::float8   AS receita
      FROM coleta_diaria cd
      JOIN farmacias f ON f.id = cd.farmacia_id
      WHERE cd.dia BETWEEN ${inicio} AND ${fim} AND f.ativa = TRUE ${this.doGestor(gestorId)}
      GROUP BY cd.farmacia_id, cd.origem
    `);
    return rows;
  }

  /** Primeiro e último dia com coleta gravada (limites do seletor de período). */
  async periodoDisponivel(): Promise<{ primeiro_dia: string | null; ultimo_dia: string | null }> {
    const { rows } = await this.db.execute<{ primeiro_dia: string | null; ultimo_dia: string | null }>(sql`
      SELECT MIN(dia)::text AS primeiro_dia, MAX(dia)::text AS ultimo_dia FROM coleta_diaria
    `);
    return rows[0] ?? { primeiro_dia: null, ultimo_dia: null };
  }

  async evolucaoSemanal(farmaciaId: number, dias: number): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT * FROM vw_evolucao_semanal
      WHERE farmacia_id = ${farmaciaId} AND periodo_dias = ${dias}
      ORDER BY semana_numero ASC
    `);
    return rows;
  }

  private doGestor(gestorId: string | null) {
    return gestorId ? sql`AND f.gestor_id = ${gestorId}` : sql``;
  }

  private ultimaColeta(dias: number) {
    return sql`(SELECT DISTINCT ON (farmacia_id) id AS coleta_id, farmacia_id
                FROM coletas WHERE periodo_dias = ${dias} ORDER BY farmacia_id, data_coleta DESC)`;
  }
}
