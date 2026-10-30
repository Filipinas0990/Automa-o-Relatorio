import { and, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import {
  custoResultadoMeta, custoResultadoMetaExecucao, farmacias, gestoresTrafego,
} from '../database/schema';
import type { Gestor } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';
import { JANELAS, type PeriodoJanela, type ResumoJanela } from './calculo';
import type { FarmaciaParaVincular } from './vinculo';

/** Farmácia ativa, com a conta de anúncios dela e o gestor dono. */
export interface FarmaciaAtiva extends FarmaciaParaVincular {
  gestorId:        number | null;
  metaAdAccountId: string | null;
}

/** Gestor que conectou o Facebook — o token ainda pode estar vencido. */
export type GestorConectado = Pick<Gestor, 'id' | 'metaAccessToken' | 'metaTokenExpiraEm'>;

const CAMPOS_FARMACIA = {
  id: farmacias.id, nome: farmacias.nome, nomeFachada: farmacias.nomeFachada,
  gestorId: farmacias.gestorId, metaAdAccountId: farmacias.metaAdAccountId,
};

export type LinhaCusto =typeof custoResultadoMeta.$inferSelect & { farmaciaNome: string; gestorId: number | null };

/** Acesso às tabelas custo_resultado_meta e custo_resultado_meta_execucao (migration 0039). */
export class CustoResultadoRepository {
  constructor(private readonly db: BancoDeDados) {}

  async farmaciasAtivas(): Promise<FarmaciaAtiva[]> {
    return this.db.select(CAMPOS_FARMACIA).from(farmacias)
      .where(eq(farmacias.ativa, true))
      .orderBy(farmacias.id);
  }

  /** Farmácias (ativas ou não) que já têm conta vinculada — cada conta tem um dono só. */
  async farmaciasComConta(): Promise<FarmaciaAtiva[]> {
    return this.db.select(CAMPOS_FARMACIA).from(farmacias).where(isNotNull(farmacias.metaAdAccountId));
  }

  async farmaciaParaVincular(id: number): Promise<FarmaciaAtiva | undefined> {
    const [f] = await this.db.select(CAMPOS_FARMACIA).from(farmacias).where(eq(farmacias.id, id));
    return f;
  }

  async gestoresConectados(): Promise<GestorConectado[]> {
    return this.db
      .select({
        id: gestoresTrafego.id,
        metaAccessToken: gestoresTrafego.metaAccessToken,
        metaTokenExpiraEm: gestoresTrafego.metaTokenExpiraEm,
      })
      .from(gestoresTrafego)
      .where(isNotNull(gestoresTrafego.metaAccessToken))
      .orderBy(gestoresTrafego.id);
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

  /**
   * Apaga as leituras de toda farmácia fora desta lista — as que deixaram de
   * poder ser lidas (conta sumiu dos tokens conectados, farmácia inativada).
   */
  async manterSo(farmaciaIds: number[]): Promise<void> {
    await this.db.delete(custoResultadoMeta).where(
      farmaciaIds.length ? notInArray(custoResultadoMeta.farmaciaId, farmaciaIds) : undefined,
    );
  }

  /**
   * Linhas com o nome da farmácia. `gestorId` restringe às farmácias de um
   * gestor. Farmácia sem nome de fachada não aparece, mesmo com leitura antiga.
   */
  async listar(gestorId: number | null, farmaciaIds?: number[]): Promise<LinhaCusto[]> {
    const filtros = [eq(farmacias.ativa, true), sql`btrim(coalesce(${farmacias.nomeFachada}, '')) <> ''`];
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

  async registrarExecucao(farmaciasOk: number, farmaciasErro: number, executadoEm: Date = new Date()): Promise<void> {
    const valores = { executadoEm, farmaciasOk, farmaciasErro };
    await this.db.insert(custoResultadoMetaExecucao)
      .values({ id: 1, ...valores })
      .onConflictDoUpdate({ target: custoResultadoMetaExecucao.id, set: valores });
  }
}
