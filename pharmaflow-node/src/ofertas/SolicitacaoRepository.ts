import { and, eq, desc, sql } from 'drizzle-orm';
import { solicitacoesOferta, farmacias } from '../database/schema';
import type { SolicitacaoOferta } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';

export type SolicitacaoComFarmacia = Awaited<ReturnType<SolicitacaoRepository['listarDoGestor']>>[number];

/** Acesso à tabela solicitacoes_oferta (as listas que os donos enviam). */
export class SolicitacaoRepository {
  constructor(private readonly db: BancoDeDados) {}

  async criar(dados: {
    gestorId:     number;
    farmaciaId:   number;
    produtosJson: string;
    enviadoPor:   string;
  }): Promise<SolicitacaoOferta> {
    const [row] = await this.db.insert(solicitacoesOferta).values(dados).returning();
    return row;
  }

  async buscarPorId(id: number): Promise<SolicitacaoOferta | null> {
    const [row] = await this.db.select().from(solicitacoesOferta).where(eq(solicitacoesOferta.id, id));
    return row ?? null;
  }

  /** Solicitações do gestor, mais recentes primeiro (até 200), com o nome da farmácia. */
  listarDoGestor(gestorId: number) {
    return this.db
      .select({
        id:           solicitacoesOferta.id,
        farmaciaId:   solicitacoesOferta.farmaciaId,
        farmacia:     farmacias.nome,
        produtosJson: solicitacoesOferta.produtosJson,
        enviadoPor:   solicitacoesOferta.enviadoPor,
        status:       solicitacoesOferta.status,
        criadoEm:     solicitacoesOferta.criadoEm,
        atendidaEm:   solicitacoesOferta.atendidaEm,
      })
      .from(solicitacoesOferta)
      .innerJoin(farmacias, eq(farmacias.id, solicitacoesOferta.farmaciaId))
      .where(eq(solicitacoesOferta.gestorId, gestorId))
      .orderBy(desc(solicitacoesOferta.criadoEm))
      .limit(200);
  }

  /**
   * A última lista que este cliente mandou pelo link deste gestor — em
   * qualquer status, menos 'descartada' (lista excluída não volta a
   * pré-marcar o passo 3). Um gestor não enxerga o que o cliente mandou pelo
   * link de outro.
   */
  async ultimaDaFarmacia(gestorId: number, farmaciaId: number): Promise<SolicitacaoOferta | null> {
    const [row] = await this.db.select().from(solicitacoesOferta)
      .where(and(
        eq(solicitacoesOferta.gestorId, gestorId),
        eq(solicitacoesOferta.farmaciaId, farmaciaId),
        sql`${solicitacoesOferta.status} <> 'descartada'`,
      ))
      .orderBy(desc(solicitacoesOferta.criadoEm))
      .limit(1);
    return row ?? null;
  }

  /** 'atendida' marca a hora; qualquer outro status a apaga. */
  async atualizarStatus(id: number, status: string): Promise<void> {
    await this.db.update(solicitacoesOferta)
      .set({ status, atendidaEm: status === 'atendida' ? sql`NOW()` : null })
      .where(eq(solicitacoesOferta.id, id));
  }

  async contarPendentes(gestorId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(solicitacoesOferta)
      .where(and(eq(solicitacoesOferta.gestorId, gestorId), eq(solicitacoesOferta.status, 'pendente')));
    return row?.total ?? 0;
  }
}
