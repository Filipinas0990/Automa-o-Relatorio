import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../database/db';
import {
  linksOferta, solicitacoesOferta, farmacias, gestoresTrafego,
} from '../database/schema';
import type { LinkOferta, SolicitacaoOferta, Farmacia } from '../database/schema';

export const ofertasRepository = {

  // ── Link público do gestor ─────────────────────────────────────────────────

  async getLink(gestorId: number): Promise<LinkOferta | null> {
    const [row] = await db.select().from(linksOferta)
      .where(eq(linksOferta.gestorId, gestorId));
    return row ?? null;
  },

  async criarLink(gestorId: number, token: string): Promise<LinkOferta> {
    const [row] = await db.insert(linksOferta)
      .values({ gestorId, token })
      .returning();
    return row;
  },

  async trocarToken(id: number, token: string): Promise<LinkOferta> {
    const [row] = await db.update(linksOferta)
      .set({ token, ativo: true, atualizadoEm: sql`NOW()` })
      .where(eq(linksOferta.id, id))
      .returning();
    return row;
  },

  /** Resolve o token para o gestor dono do link. Null se inválido ou inativo. */
  async gestorPorToken(token: string): Promise<{ id: number; nome: string } | null> {
    const [row] = await db
      .select({ id: gestoresTrafego.id, nome: gestoresTrafego.nome })
      .from(linksOferta)
      .innerJoin(gestoresTrafego, eq(gestoresTrafego.id, linksOferta.gestorId))
      .where(and(
        eq(linksOferta.token, token),
        eq(linksOferta.ativo, true),
        eq(gestoresTrafego.ativo, true),
      ));
    return row ?? null;
  },

  // ── Farmácias do gestor (o dono escolhe a dele nessa lista) ────────────────

  async farmaciasDoGestor(gestorId: number): Promise<Farmacia[]> {
    return db.select().from(farmacias).where(
      and(eq(farmacias.gestorId, gestorId), eq(farmacias.ativa, true)),
    );
  },

  // ── Solicitações ───────────────────────────────────────────────────────────

  async criarSolicitacao(data: {
    gestorId:       number;
    farmaciaId:     number;
    produtosJson:   string;
    produtosLivres: string | null;
    observacao:     string | null;
    enviadoPor:     string | null;
  }): Promise<SolicitacaoOferta> {
    const [row] = await db.insert(solicitacoesOferta).values(data).returning();
    return row;
  },

  async getSolicitacao(id: number): Promise<SolicitacaoOferta | null> {
    const [row] = await db.select().from(solicitacoesOferta)
      .where(eq(solicitacoesOferta.id, id));
    return row ?? null;
  },

  /** Solicitações do gestor, pendentes primeiro, com o nome da farmácia. */
  async listarSolicitacoes(gestorId: number) {
    return db
      .select({
        id:             solicitacoesOferta.id,
        farmaciaId:     solicitacoesOferta.farmaciaId,
        farmacia:       farmacias.nome,
        produtosJson:   solicitacoesOferta.produtosJson,
        produtosLivres: solicitacoesOferta.produtosLivres,
        observacao:     solicitacoesOferta.observacao,
        enviadoPor:     solicitacoesOferta.enviadoPor,
        status:         solicitacoesOferta.status,
        criadoEm:       solicitacoesOferta.criadoEm,
        atendidaEm:     solicitacoesOferta.atendidaEm,
      })
      .from(solicitacoesOferta)
      .innerJoin(farmacias, eq(farmacias.id, solicitacoesOferta.farmaciaId))
      .where(eq(solicitacoesOferta.gestorId, gestorId))
      .orderBy(desc(solicitacoesOferta.criadoEm))
      .limit(200);
  },

  /**
   * A carteira do gestor: TODAS as farmácias dele, cada uma marcada com o
   * pedido pendente (se houver). É o inverso da caixa de entrada — o gestor
   * precisa ver quem NÃO respondeu para poder cobrar.
   *
   * "Respondeu" = tem solicitação pendente. Depois que o disparo sai, a
   * solicitação vira 'atendida' e o cliente volta a aparecer como sem resposta,
   * pronto para mandar a lista do próximo ciclo.
   */
  async carteiraDoGestor(gestorId: number) {
    const [lista, solicitacoes] = await Promise.all([
      this.farmaciasDoGestor(gestorId),
      this.listarSolicitacoes(gestorId),
    ]);

    return lista.map((f) => {
      const daFarmacia = solicitacoes.filter((s) => s.farmaciaId === f.id);
      const pendente   = daFarmacia.find((s) => s.status === 'pendente') ?? null;
      const ultimo     = daFarmacia[0] ?? null;   // listarSolicitacoes já vem por data desc

      return {
        farmacia:    f,
        pendente,
        ultimoEnvioEm: ultimo?.criadoEm ?? null,
      };
    });
  },

  async atualizarStatus(id: number, status: string): Promise<void> {
    await db.update(solicitacoesOferta)
      .set({
        status,
        atendidaEm: status === 'atendida' ? sql`NOW()` : null,
      })
      .where(eq(solicitacoesOferta.id, id));
  },

  /** Quantas solicitações pendentes o gestor tem (badge do menu). */
  async contarPendentes(gestorId: number): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(solicitacoesOferta)
      .where(and(
        eq(solicitacoesOferta.gestorId, gestorId),
        eq(solicitacoesOferta.status, 'pendente'),
      ));
    return row?.total ?? 0;
  },
};
