import { eq, and, sql } from 'drizzle-orm';
import { gestoresTrafego } from '../database/schema';
import type { Gestor } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';

export type NovoGestor = typeof gestoresTrafego.$inferInsert;

export interface GestorComContagem {
  id: number;
  nome: string;
  email: string;
  is_admin: boolean;
  criado_em: Date;
  farmacias: number;
}

/** Acesso à tabela gestores_trafego. */
export class GestorRepository {
  constructor(private readonly db: BancoDeDados) {}

  async buscarPorId(id: number): Promise<Gestor | undefined> {
    const [g] = await this.db.select().from(gestoresTrafego).where(eq(gestoresTrafego.id, id));
    return g;
  }

  async buscarAtivoPorId(id: number): Promise<Gestor | undefined> {
    const [g] = await this.db.select().from(gestoresTrafego).where(
      and(eq(gestoresTrafego.id, id), eq(gestoresTrafego.ativo, true)),
    );
    return g;
  }

  async buscarPorEmail(email: string): Promise<Gestor | undefined> {
    const [g] = await this.db.select().from(gestoresTrafego).where(eq(gestoresTrafego.email, email));
    return g;
  }

  /** O gestor identificado pelo telefone do WhatsApp — usado pelo bot de ads. */
  async buscarPorTelefoneWhatsapp(telefone: string): Promise<{ id: number } | null> {
    const [g] = await this.db.select({ id: gestoresTrafego.id }).from(gestoresTrafego)
      .where(eq(gestoresTrafego.telefoneWhatsapp, telefone)).limit(1);
    return g ?? null;
  }

  /** Gestores ativos com o número de farmácias ativas de cada um. `somenteId` restringe a um gestor. */
  async listarAtivosComContagem(somenteId?: number): Promise<GestorComContagem[]> {
    const filtro = somenteId === undefined ? sql`` : sql`AND g.id = ${somenteId}`;
    const rows = await this.db.execute(sql`
      SELECT g.*, COUNT(f.id) FILTER (WHERE f.ativa = TRUE) AS farmacias
      FROM gestores_trafego g
      LEFT JOIN farmacias f ON f.gestor_id = g.id
      WHERE g.ativo = TRUE ${filtro}
      GROUP BY g.id
      ORDER BY g.nome
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.rows.map((g: any) => ({
      id: g.id, nome: g.nome, email: g.email,
      is_admin: g.is_admin, criado_em: g.criado_em,
      farmacias: parseInt(g.farmacias || 0),
    }));
  }

  async criar(dados: NovoGestor): Promise<Gestor> {
    const [g] = await this.db.insert(gestoresTrafego).values(dados).returning();
    return g;
  }

  async atualizar(id: number, dados: Partial<NovoGestor>): Promise<void> {
    if (!Object.keys(dados).length) return;
    await this.db.update(gestoresTrafego).set(dados).where(eq(gestoresTrafego.id, id));
  }

  async desativar(id: number): Promise<void> {
    await this.db.update(gestoresTrafego).set({ ativo: false }).where(eq(gestoresTrafego.id, id));
  }
}
