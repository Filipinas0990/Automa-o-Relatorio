import { eq, and } from 'drizzle-orm';
import { farmacias } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';

export type Farmacia     = typeof farmacias.$inferSelect;
export type NovaFarmacia = typeof farmacias.$inferInsert;

/** Acesso à tabela farmacias (o cadastro). */
export class FarmaciaRepository {
  constructor(private readonly db: BancoDeDados) {}

  async buscarPorId(id: number): Promise<Farmacia | undefined> {
    const [f] = await this.db.select().from(farmacias).where(eq(farmacias.id, id));
    return f;
  }

  /** A farmácia, só se ela for do gestor informado. */
  async buscarDoGestor(id: number, gestorId: number): Promise<Farmacia | undefined> {
    const [f] = await this.db.select().from(farmacias).where(
      and(eq(farmacias.id, id), eq(farmacias.gestorId, gestorId)),
    );
    return f;
  }

  async buscarAtiva(id: number): Promise<Farmacia | null> {
    const [f] = await this.db.select().from(farmacias).where(and(eq(farmacias.id, id), eq(farmacias.ativa, true)));
    return f ?? null;
  }

  /** Farmácias ativas por nome. `gestorId` null = todas (o admin não tem carteira própria). */
  listarAtivas(gestorId: number | null): Promise<Farmacia[]> {
    return this.db.select().from(farmacias)
      .where(gestorId === null
        ? eq(farmacias.ativa, true)
        : and(eq(farmacias.gestorId, gestorId), eq(farmacias.ativa, true)))
      .orderBy(farmacias.nome);
  }

  async criar(dados: NovaFarmacia): Promise<Farmacia> {
    const [f] = await this.db.insert(farmacias).values(dados).returning();
    return f;
  }

  async atualizar(id: number, dados: Partial<NovaFarmacia>): Promise<void> {
    if (!Object.keys(dados).length) return;
    await this.db.update(farmacias).set(dados).where(eq(farmacias.id, id));
  }

  async desativar(id: number): Promise<void> {
    await this.db.update(farmacias).set({ ativa: false }).where(eq(farmacias.id, id));
  }
}
