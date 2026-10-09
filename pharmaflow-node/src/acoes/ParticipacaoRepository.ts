import { and, eq, inArray, sql } from 'drizzle-orm';
import { farmacias } from '../database/schema';
import type { BancoDeDados, Linha } from '../compartilhado/tipos';

/** Acesso à tabela farmacia_acoes: quais farmácias participam de cada ação. */
export class ParticipacaoRepository {
  constructor(private readonly db: BancoDeDados) {}

  /** Farmácias da ação, com gestor e o alerta da última coleta semanal. */
  async daAcao(acaoId: number): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT fa.id AS participacao_id, fa.observacoes, fa.adicionado_em,
             f.id  AS farmacia_id,   f.nome AS farmacia_nome,
             f.cidade, f.responsavel, f.telefone, f.gestor_id,
             g.nome AS gestor_nome,
             COALESCE(r.nivel_alerta, 'verde') AS nivel_alerta
      FROM farmacia_acoes fa
      JOIN farmacias f ON f.id = fa.farmacia_id
      LEFT JOIN gestores_trafego g ON g.id = f.gestor_id
      LEFT JOIN vw_ranking_atual r  ON r.farmacia_id = f.id AND r.periodo_dias = 7
      WHERE fa.acao_id = ${acaoId}
      ORDER BY f.nome
    `);
    return rows;
  }

  /** Ações de que a farmácia participa; `mes` (AAAA-MM) filtra. */
  async daFarmacia(farmaciaId: number, mes?: string): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT a.id, a.nome, a.tipo, a.descricao, a.mes_referencia,
             a.status, a.cor, a.criado_em,
             fa.observacoes, fa.adicionado_em
      FROM farmacia_acoes fa
      JOIN acoes a ON a.id = fa.acao_id
      WHERE fa.farmacia_id = ${farmaciaId}
      ${mes ? sql`AND a.mes_referencia = ${mes}` : sql``}
      ORDER BY a.mes_referencia DESC, a.nome
    `);
    return rows;
  }

  /** Dos ids informados, os de farmácias ativas que existem. */
  async farmaciasAtivas(ids: number[]): Promise<number[]> {
    const rows = await this.db.select({ id: farmacias.id }).from(farmacias)
      .where(and(inArray(farmacias.id, ids), eq(farmacias.ativa, true)));
    return rows.map((f) => f.id);
  }

  /** Inclui a farmácia na ação. false se ela já participava. */
  async adicionar(acaoId: number, farmaciaId: number, observacoes: string | null, porId: number): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      INSERT INTO farmacia_acoes (acao_id, farmacia_id, observacoes, adicionado_por_id)
      VALUES (${acaoId}, ${farmaciaId}, ${observacoes}, ${porId})
      ON CONFLICT (acao_id, farmacia_id) DO NOTHING
    `);
    return (rowCount ?? 0) > 0;
  }

  async total(acaoId: number): Promise<number> {
    const { rows } = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total FROM farmacia_acoes WHERE acao_id = ${acaoId}
    `);
    return parseInt(String(rows[0]?.total || 0));
  }

  /** false se a farmácia não participava. */
  async remover(acaoId: number, farmaciaId: number): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      DELETE FROM farmacia_acoes WHERE acao_id = ${acaoId} AND farmacia_id = ${farmaciaId}
    `);
    return (rowCount ?? 0) > 0;
  }

  /** false se a farmácia não participava. */
  async atualizarObservacoes(acaoId: number, farmaciaId: number, observacoes: string | null): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      UPDATE farmacia_acoes SET observacoes = ${observacoes}
      WHERE acao_id = ${acaoId} AND farmacia_id = ${farmaciaId}
    `);
    return (rowCount ?? 0) > 0;
  }
}
