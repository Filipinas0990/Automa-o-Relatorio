import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  custoResultadoMeta, custoResultadoMetaExecucao, farmacias, gestoresTrafego, metaTokens,
} from '../database/schema';
import type { Gestor } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';
import { JANELAS, type PeriodoJanela, type ResumoJanela } from './calculo';

/** Farmácia ativa com conta de anúncios, e o gestor cujo token faz a leitura. */
export interface ContaParaSincronizar {
  farmaciaId:  number;
  nome:        string;
  adAccountId: string;
  gestor:      Pick<Gestor, 'id' | 'metaAccessToken' | 'metaTokenExpiraEm'> | null;
}

export type LinhaCusto = typeof custoResultadoMeta.$inferSelect & { farmaciaNome: string; gestorId: number | null };

/** Acesso às tabelas custo_resultado_meta e custo_resultado_meta_execucao (migration 0039). */
export class CustoResultadoRepository {
  constructor(private readonly db: BancoDeDados) {}

  async contasParaSincronizar(): Promise<ContaParaSincronizar[]> {
    const rows = await this.db
      .select({
        farmaciaId:  farmacias.id,
        nome:        farmacias.nome,
        adAccountId: metaTokens.adAccountId,
        gestorId:    gestoresTrafego.id,
        token:       gestoresTrafego.metaAccessToken,
        expira:      gestoresTrafego.metaTokenExpiraEm,
      })
      .from(farmacias)
      .innerJoin(metaTokens, eq(metaTokens.farmaciaId, farmacias.id))
      .leftJoin(gestoresTrafego, eq(gestoresTrafego.id, farmacias.gestorId))
      .where(eq(farmacias.ativa, true))
      .orderBy(farmacias.id);

    return rows.map((r) => ({
      farmaciaId:  r.farmaciaId,
      nome:        r.nome,
      adAccountId: r.adAccountId,
      gestor: r.gestorId == null ? null : {
        id: r.gestorId, metaAccessToken: r.token, metaTokenExpiraEm: r.expira,
      },
    }));
  }

  /** Grava (sobrescrevendo) o resultado de uma janela e limpa o erro anterior. */
  async salvar(farmaciaId: number, janela: number, periodo: PeriodoJanela, r: ResumoJanela): Promise<void> {
    const valores = {
      periodoInicio:     periodo.inicio,
      periodoFim:        periodo.fim,
      gasto:             r.gasto.toFixed(2),
      resultados:        r.resultados,
      custoPorResultado: r.custoPorResultado == null ? null : r.custoPorResultado.toFixed(2),
      tipoResultado:     r.tipoResultado,
      cliques:           r.cliques,
      impressoes:        r.impressoes,
      erro:              null,
      sincronizadoEm:    new Date(),
    };
    await this.db.insert(custoResultadoMeta)
      .values({ farmaciaId, janelaDias: janela, ...valores })
      .onConflictDoUpdate({
        target: [custoResultadoMeta.farmaciaId, custoResultadoMeta.janelaDias],
        set:    valores,
      });
  }

  /**
   * Marca que a leitura desta farmácia falhou, nas três janelas. Os números da
   * última leitura boa ficam — melhor mostrar o dado de ontem com um aviso do
   * que apagar. Sem leitura anterior, cria a linha zerada só para carregar o erro.
   */
  async registrarErro(farmaciaId: number, erro: string): Promise<void> {
    await this.db.insert(custoResultadoMeta)
      .values(JANELAS.map((j) => ({ farmaciaId, janelaDias: j, erro })))
      .onConflictDoUpdate({
        target: [custoResultadoMeta.farmaciaId, custoResultadoMeta.janelaDias],
        set:    { erro: sql`excluded.erro` },
      });
  }

  /** Linhas com o nome da farmácia. `gestorId` restringe às farmácias de um gestor. */
  async listar(gestorId: number | null, farmaciaIds?: number[]): Promise<LinhaCusto[]> {
    const filtros = [eq(farmacias.ativa, true)];
    if (gestorId !== null)  filtros.push(eq(farmacias.gestorId, gestorId));
    if (farmaciaIds?.length) filtros.push(inArray(farmacias.id, farmaciaIds));

    const rows = await this.db
      .select({ c: custoResultadoMeta, nome: farmacias.nome, gestorId: farmacias.gestorId })
      .from(custoResultadoMeta)
      .innerJoin(farmacias, eq(farmacias.id, custoResultadoMeta.farmaciaId))
      .where(and(...filtros));

    return rows.map((r) => ({ ...r.c, farmaciaNome: r.nome, gestorId: r.gestorId }));
  }

  async ultimaExecucao(): Promise<{ executadoEm: Date; farmaciasOk: number; farmaciasErro: number } | null> {
    const [row] = await this.db.select().from(custoResultadoMetaExecucao)
      .where(eq(custoResultadoMetaExecucao.id, 1));
    return row ?? null;
  }

  async registrarExecucao(farmaciasOk: number, farmaciasErro: number): Promise<void> {
    const valores = { executadoEm: new Date(), farmaciasOk, farmaciasErro };
    await this.db.insert(custoResultadoMetaExecucao)
      .values({ id: 1, ...valores })
      .onConflictDoUpdate({ target: custoResultadoMetaExecucao.id, set: valores });
  }
}
