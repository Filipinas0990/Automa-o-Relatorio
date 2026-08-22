import { and, eq, desc, sql, isNotNull } from 'drizzle-orm';
import { db } from '../database/db';
import {
  linksOferta, solicitacoesOferta, farmacias, gestoresTrafego,
} from '../database/schema';
import type { LinkOferta, SolicitacaoOferta, Farmacia } from '../database/schema';

export const ofertasRepository = {

  // ── Links públicos (um por cliente — migration 0021) ───────────────────────

  /** Links por farmácia deste gestor. Não traz o link legado (sem farmácia). */
  async linksPorFarmacia(gestorId: number): Promise<LinkOferta[]> {
    return db.select().from(linksOferta)
      .where(and(
        eq(linksOferta.gestorId, gestorId),
        isNotNull(linksOferta.farmaciaId),
      ));
  },

  /**
   * Cria os links que faltam, em uma tacada. `onConflictDoNothing` cobre a
   * corrida de duas abas abrindo a carteira ao mesmo tempo — quem perder
   * simplesmente relê o que o outro criou.
   */
  async criarLinks(
    novos: { gestorId: number; farmaciaId: number; token: string }[],
  ): Promise<void> {
    if (novos.length === 0) return;
    await db.insert(linksOferta).values(novos).onConflictDoNothing();
  },

  /** Troca o token de um cliente — o link antigo morre na hora. */
  async trocarToken(gestorId: number, farmaciaId: number, token: string): Promise<LinkOferta | null> {
    const [row] = await db.update(linksOferta)
      .set({ token, ativo: true, atualizadoEm: sql`NOW()` })
      .where(and(
        eq(linksOferta.gestorId, gestorId),
        eq(linksOferta.farmaciaId, farmaciaId),
      ))
      .returning();
    return row ?? null;
  },

  /**
   * Resolve o token: quem é o gestor e, se o link for de um cliente, qual
   * farmácia. `farmaciaId` null = link legado, em que o dono ainda escolhe a
   * farmácia numa lista. Null geral = token inválido ou inativo.
   */
  async porToken(token: string): Promise<{
    gestor:     { id: number; nome: string; isAdmin: boolean };
    farmaciaId: number | null;
  } | null> {
    const [row] = await db
      .select({
        id:         gestoresTrafego.id,
        nome:       gestoresTrafego.nome,
        isAdmin:    gestoresTrafego.isAdmin,
        farmaciaId: linksOferta.farmaciaId,
      })
      .from(linksOferta)
      .innerJoin(gestoresTrafego, eq(gestoresTrafego.id, linksOferta.gestorId))
      .where(and(
        eq(linksOferta.token, token),
        eq(linksOferta.ativo, true),
        eq(gestoresTrafego.ativo, true),
      ));

    if (!row) return null;
    return {
      gestor:     { id: row.id, nome: row.nome, isAdmin: row.isAdmin },
      farmaciaId: row.farmaciaId,
    };
  },

  /** Uma farmácia ativa pelo id — o link do cliente resolve direto nela. */
  async getFarmaciaAtiva(id: number): Promise<Farmacia | null> {
    const [row] = await db.select().from(farmacias)
      .where(and(eq(farmacias.id, id), eq(farmacias.ativa, true)));
    return row ?? null;
  },

  // ── Farmácias do gestor (o dono escolhe a dele nessa lista) ────────────────

  /**
   * As farmácias que o link oferece. `todas` = admin: ele não tem carteira
   * própria, então enxerga todas as ativas — mesma regra do GET /api/farmacias.
   * Sem isso o link do admin abre com a lista vazia.
   */
  async farmaciasDoGestor(gestorId: number, todas = false): Promise<Farmacia[]> {
    return db.select().from(farmacias)
      .where(
        todas
          ? eq(farmacias.ativa, true)
          : and(eq(farmacias.gestorId, gestorId), eq(farmacias.ativa, true)),
      )
      .orderBy(farmacias.nome);
  },

  // ── Solicitações ───────────────────────────────────────────────────────────

  async criarSolicitacao(data: {
    gestorId:       number;
    farmaciaId:     number;
    produtosJson:   string;
    enviadoPor:     string;
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
  async carteiraDoGestor(gestorId: number, todas = false) {
    const [lista, solicitacoes] = await Promise.all([
      this.farmaciasDoGestor(gestorId, todas),
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

  /**
   * A última lista que este cliente mandou pelo link dele — em qualquer
   * status. É o que abastece o passo 3 do disparo: o gestor monta o criativo
   * em cima do que o dono escolheu, não do catálogo inteiro.
   *
   * Escopo por gestor (mesma regra da carteira): um gestor não enxerga o que
   * o cliente mandou pelo link de outro.
   */
  async ultimaSolicitacao(gestorId: number, farmaciaId: number): Promise<SolicitacaoOferta | null> {
    const [row] = await db.select().from(solicitacoesOferta)
      .where(and(
        eq(solicitacoesOferta.gestorId, gestorId),
        eq(solicitacoesOferta.farmaciaId, farmaciaId),
      ))
      .orderBy(desc(solicitacoesOferta.criadoEm))
      .limit(1);
    return row ?? null;
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
