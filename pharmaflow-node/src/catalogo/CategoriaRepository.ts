import { eq, ne, and } from 'drizzle-orm';
import { catalogoCategorias } from '../database/schema';
import type { CatalogoCategoria } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';

export type NovaCategoria = typeof catalogoCategorias.$inferInsert;

/** Acesso ao cadastro de categorias do banco de imagens (migration 0031). */
export class CategoriaRepository {
  constructor(private readonly db: BancoDeDados) {}

  /** Linhas cruas do cadastro. */
  async listar(): Promise<CatalogoCategoria[]> {
    return this.db
      .select({
        id:       catalogoCategorias.id,
        nome:     catalogoCategorias.nome,
        nomeNorm: catalogoCategorias.nomeNorm,
        criadoEm: catalogoCategorias.criadoEm,
        atualizadoEm: catalogoCategorias.atualizadoEm,
      })
      .from(catalogoCategorias);
  }

  async buscarPorNomeNorm(nomeNorm: string): Promise<CatalogoCategoria | undefined> {
    const [row] = await this.db.select().from(catalogoCategorias)
      .where(eq(catalogoCategorias.nomeNorm, nomeNorm)).limit(1);
    return row;
  }

  async buscarPorId(id: number): Promise<CatalogoCategoria | undefined> {
    const [row] = await this.db.select().from(catalogoCategorias)
      .where(eq(catalogoCategorias.id, id)).limit(1);
    return row;
  }

  async existeComNomeNorm(nomeNorm: string, excluirId?: number): Promise<boolean> {
    const condicao = excluirId
      ? and(eq(catalogoCategorias.nomeNorm, nomeNorm), ne(catalogoCategorias.id, excluirId))
      : eq(catalogoCategorias.nomeNorm, nomeNorm);
    const [row] = await this.db.select({ id: catalogoCategorias.id }).from(catalogoCategorias)
      .where(condicao).limit(1);
    return Boolean(row);
  }

  /** Cadastra; devolve null se já existir uma categoria com o mesmo nomeNorm. */
  async criar(nome: string, nomeNorm: string): Promise<CatalogoCategoria | null> {
    const [row] = await this.db.insert(catalogoCategorias)
      .values({ nome, nomeNorm })
      .onConflictDoNothing({ target: catalogoCategorias.nomeNorm })
      .returning();
    return row ?? null;
  }

  /** Cadastra várias de uma vez, ignorando as que já existirem. Devolve quantas entraram. */
  async criarVarias(categorias: NovaCategoria[]): Promise<number> {
    if (categorias.length === 0) return 0;
    const rows = await this.db.insert(catalogoCategorias)
      .values(categorias)
      .onConflictDoNothing({ target: catalogoCategorias.nomeNorm })
      .returning({ id: catalogoCategorias.id });
    return rows.length;
  }

  async renomear(id: number, nome: string, nomeNorm: string): Promise<void> {
    await this.db.update(catalogoCategorias)
      .set({ nome, nomeNorm, atualizadoEm: new Date() })
      .where(eq(catalogoCategorias.id, id));
  }

  async excluir(id: number): Promise<void> {
    await this.db.delete(catalogoCategorias).where(eq(catalogoCategorias.id, id));
  }
}
