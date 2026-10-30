import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { farmacias, nomeVisivel, produtosCliente } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';
import { EspacoCheio } from './ProdutoClienteService';
import type {
  EspacoDoCliente, FotoDoProduto, ProdutoComCliente, ProdutoDoCliente, VitrineDosClientes,
} from './ProdutoClienteService';

/** Acesso à tabela produtos_cliente (o espaço de produtos de cada farmácia — migration 0041). */
export class ProdutoClienteRepository implements EspacoDoCliente, VitrineDosClientes {
  constructor(private readonly db: BancoDeDados) {}

  /**
   * Produtos de todas as farmácias ATIVAS da carteira (sem a foto), dos mais
   * recentes para os mais antigos. `gestorId` null = todas (admin).
   */
  async daCarteira(gestorId: number | null): Promise<ProdutoComCliente[]> {
    const linhas = await this.db
      .select({
        id:          produtosCliente.id,
        nome:        produtosCliente.nome,
        criadoEm:    produtosCliente.criadoEm,
        farmaciaId:  farmacias.id,
        farmacia:    farmacias.nome,
        nomeFachada: farmacias.nomeFachada,
        cidade:      farmacias.cidade,
      })
      .from(produtosCliente)
      .innerJoin(farmacias, eq(farmacias.id, produtosCliente.farmaciaId))
      .where(and(
        eq(farmacias.ativa, true),
        gestorId === null ? undefined : eq(farmacias.gestorId, gestorId),
      ))
      .orderBy(desc(produtosCliente.criadoEm), desc(produtosCliente.id));

    return linhas.map(({ nomeFachada, ...l }) => ({
      ...l,
      farmaciaVisivel: nomeVisivel({ nome: l.farmacia, nomeFachada }),
    }));
  }

  /** Produtos da farmácia, sem a foto (para ser leve), na ordem em que chegaram. */
  listar(farmaciaId: number): Promise<ProdutoDoCliente[]> {
    return this.db
      .select({ id: produtosCliente.id, nome: produtosCliente.nome, criadoEm: produtosCliente.criadoEm })
      .from(produtosCliente)
      .where(eq(produtosCliente.farmaciaId, farmaciaId))
      .orderBy(asc(produtosCliente.id));
  }

  async contar(farmaciaId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(produtosCliente)
      .where(eq(produtosCliente.farmaciaId, farmaciaId));
    return row?.total ?? 0;
  }

  /** Lança `EspacoCheio` quando o gatilho do banco recusa por limite. */
  async criar(farmaciaId: number, dados: { nome: string; imagemB64: string; mime: string }): Promise<ProdutoDoCliente> {
    try {
      const [row] = await this.db.insert(produtosCliente)
        .values({ farmaciaId, ...dados })
        .returning({ id: produtosCliente.id, nome: produtosCliente.nome, criadoEm: produtosCliente.criadoEm });
      return row;
    } catch (e) {
      if (ehLimiteDoBanco(e)) throw new EspacoCheio();
      throw e;
    }
  }

  /** Foto de um produto DESTA farmácia — null se o id for de outra. */
  async foto(farmaciaId: number, id: number): Promise<FotoDoProduto | null> {
    const [row] = await this.db
      .select({ imagemB64: produtosCliente.imagemB64, mime: produtosCliente.mime })
      .from(produtosCliente)
      .where(and(eq(produtosCliente.id, id), eq(produtosCliente.farmaciaId, farmaciaId)));
    return row ?? null;
  }

  /** Exclui só se o produto for desta farmácia. Devolve se excluiu. */
  async excluir(farmaciaId: number, id: number): Promise<boolean> {
    const apagados = await this.db.delete(produtosCliente)
      .where(and(eq(produtosCliente.id, id), eq(produtosCliente.farmaciaId, farmaciaId)))
      .returning({ id: produtosCliente.id });
    return apagados.length > 0;
  }
}

/** O drizzle às vezes embrulha o erro do pg em `cause`. */
function ehLimiteDoBanco(e: unknown): boolean {
  for (let atual = e as { message?: string; cause?: unknown } | undefined; atual; atual = atual.cause as typeof atual) {
    if (atual.message?.includes('limite_produtos_cliente')) return true;
  }
  return false;
}
