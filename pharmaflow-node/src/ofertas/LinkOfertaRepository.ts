import { and, eq, sql, isNotNull } from 'drizzle-orm';
import { linksOferta, gestoresTrafego } from '../database/schema';
import type { LinkOferta } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';

export interface LinkResolvido {
  gestor:     { id: number; nome: string; isAdmin: boolean };
  /** null = link legado, em que o dono ainda escolhe a farmácia numa lista. */
  farmaciaId: number | null;
}

/** Acesso à tabela links_oferta (um link público por cliente — migration 0021). */
export class LinkOfertaRepository {
  constructor(private readonly db: BancoDeDados) {}

  /** Links por farmácia deste gestor. Não traz o link legado (sem farmácia). */
  porFarmacia(gestorId: number): Promise<LinkOferta[]> {
    return this.db.select().from(linksOferta)
      .where(and(eq(linksOferta.gestorId, gestorId), isNotNull(linksOferta.farmaciaId)));
  }

  /**
   * Cria os links que faltam, em uma tacada. `onConflictDoNothing` cobre a
   * corrida de duas abas abrindo a carteira ao mesmo tempo — quem perder
   * simplesmente relê o que o outro criou.
   */
  async criar(novos: { gestorId: number; farmaciaId: number; token: string }[]): Promise<void> {
    if (novos.length === 0) return;
    await this.db.insert(linksOferta).values(novos).onConflictDoNothing();
  }

  /** Troca o token de um cliente — o link antigo morre na hora. Null se o cliente não tinha link. */
  async trocarToken(gestorId: number, farmaciaId: number, token: string): Promise<LinkOferta | null> {
    const [row] = await this.db.update(linksOferta)
      .set({ token, ativo: true, atualizadoEm: sql`NOW()` })
      .where(and(eq(linksOferta.gestorId, gestorId), eq(linksOferta.farmaciaId, farmaciaId)))
      .returning();
    return row ?? null;
  }

  /** Quem é o dono do token (gestor ativo, link ativo). Null = token inválido ou inativo. */
  async porToken(token: string): Promise<LinkResolvido | null> {
    const [row] = await this.db
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
    return { gestor: { id: row.id, nome: row.nome, isAdmin: row.isAdmin }, farmaciaId: row.farmaciaId };
  }
}
