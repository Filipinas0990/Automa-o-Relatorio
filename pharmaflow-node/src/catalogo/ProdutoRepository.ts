import { sql, eq, inArray, desc } from 'drizzle-orm';
import { catalogoProdutos } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';

/** Remove acentos, coloca em minúsculo e colapsa espaços — chave do match com a planilha. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CatalogoRow {
  id: number;
  nome: string;
  nomeNorm: string;
  imagemB64: string | null;
  mime: string | null;
}

/** Acesso à tabela catalogo_produtos (imagens dos criativos). */
export class ProdutoRepository {
  constructor(private readonly db: BancoDeDados) {}

  /**
   * Catálogo ATIVO (id, nome, imagem) para o match em memória. Produtos
   * desligados (ativo = false) ficam de fora — não entram nos criativos.
   */
  async carregarAtivos(): Promise<CatalogoRow[]> {
    return this.db
      .select({
        id:        catalogoProdutos.id,
        nome:      catalogoProdutos.nome,
        nomeNorm:  catalogoProdutos.nomeNorm,
        imagemB64: catalogoProdutos.imagemB64,
        mime:      catalogoProdutos.mime,
      })
      .from(catalogoProdutos)
      .where(eq(catalogoProdutos.ativo, true));
  }

  /**
   * Cadastra/atualiza um produto (upsert pelo nome normalizado).
   *
   * `categoria` é opcional e `undefined` NÃO é o mesmo que `null` aqui: quando
   * vem undefined o campo fica fora do UPDATE, para que reenviar a foto de um
   * produto já classificado não apague a categoria dele. Passe `null`
   * explícito para de fato limpar.
   */
  async upsert(
    nome: string,
    imagemB64: string,
    mime = 'image/png',
    categoria?: string | null,
  ): Promise<void> {
    const nomeNorm = normalizar(nome);
    const set: Record<string, unknown> = { nome, imagemB64, mime, atualizadoEm: new Date() };
    if (categoria !== undefined) set.categoria = categoria;

    await this.db
      .insert(catalogoProdutos)
      .values({ nome, nomeNorm, imagemB64, mime, categoria: categoria ?? null })
      .onConflictDoUpdate({ target: catalogoProdutos.nomeNorm, set });
  }

  /** Quantos produtos existem no catálogo. */
  async contar(): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(catalogoProdutos);
    return row?.total ?? 0;
  }

  /**
   * Produtos do catálogo (sem a imagem, para ser leve). Inclui ativos e
   * desligados. Nome igual ao de `ProdutosDoCatalogo` (ver ofertas/SolicitacaoService)
   * de propósito — esta classe é passada direto como esse colaborador em
   * composicao.ts, sem precisar de objeto adaptador.
   */
  async listarProdutos(): Promise<Array<{
    id: number; nome: string; ativo: boolean; categoria: string | null;
    criadoEm: Date | null; atualizadoEm: Date | null;
  }>> {
    return this.db
      .select({
        id:        catalogoProdutos.id,
        nome:      catalogoProdutos.nome,
        ativo:     catalogoProdutos.ativo,
        categoria: catalogoProdutos.categoria,
        criadoEm:  catalogoProdutos.criadoEm,
        // Versão da imagem: o front põe na URL (?v=) para furar o cache depois de editar.
        atualizadoEm: catalogoProdutos.atualizadoEm,
      })
      .from(catalogoProdutos)
      .orderBy(desc(catalogoProdutos.criadoEm));
  }

  /** Classifica vários produtos de uma vez. Devolve quantos foram alterados. */
  async setCategoriaEmLote(ids: number[], categoria: string | null): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(catalogoProdutos)
      .set({ categoria, atualizadoEm: new Date() })
      .where(inArray(catalogoProdutos.id, ids))
      .returning({ id: catalogoProdutos.id });
    return rows.length;
  }

  /**
   * Edita os dados de um produto (tela de edição). Campo ausente fica como
   * está. Trocar o nome recalcula o nome normalizado junto. Retorna false se o
   * produto não existe.
   */
  async atualizar(
    id: number,
    campos: { nome?: string; categoria?: string | null; ativo?: boolean },
  ): Promise<boolean> {
    const set: Record<string, unknown> = { atualizadoEm: new Date() };
    if (campos.nome !== undefined) {
      set.nome = campos.nome;
      set.nomeNorm = normalizar(campos.nome);
    }
    if (campos.categoria !== undefined) set.categoria = campos.categoria;
    if (campos.ativo !== undefined) set.ativo = campos.ativo;

    const rows = await this.db
      .update(catalogoProdutos)
      .set(set)
      .where(eq(catalogoProdutos.id, id))
      .returning({ id: catalogoProdutos.id });
    return rows.length > 0;
  }

  /** Substitui a imagem de um produto existente. Retorna false se o produto não existe. */
  async trocarImagem(id: number, imagemB64: string, mime: string): Promise<boolean> {
    const rows = await this.db
      .update(catalogoProdutos)
      .set({ imagemB64, mime, atualizadoEm: new Date() })
      .where(eq(catalogoProdutos.id, id))
      .returning({ id: catalogoProdutos.id });
    return rows.length > 0;
  }

  /** Id do produto que já usa este nome (normalizado), ou null. */
  async idPorNomeNorm(nomeNorm: string): Promise<number | null> {
    const [row] = await this.db
      .select({ id: catalogoProdutos.id })
      .from(catalogoProdutos)
      .where(eq(catalogoProdutos.nomeNorm, nomeNorm))
      .limit(1);
    return row?.id ?? null;
  }

  /** Quando o produto mudou pela última vez (vira o ETag da imagem). Null se não existe. */
  async versaoImagem(id: number): Promise<Date | null> {
    const [row] = await this.db
      .select({ atualizadoEm: catalogoProdutos.atualizadoEm })
      .from(catalogoProdutos)
      .where(eq(catalogoProdutos.id, id))
      .limit(1);
    return row?.atualizadoEm ?? null;
  }

  /** A imagem (base64 + mime) de um produto. */
  async getImagem(id: number): Promise<{ imagemB64: string | null; mime: string | null } | null> {
    const [row] = await this.db
      .select({ imagemB64: catalogoProdutos.imagemB64, mime: catalogoProdutos.mime })
      .from(catalogoProdutos)
      .where(eq(catalogoProdutos.id, id))
      .limit(1);
    return row ?? null;
  }

  async deletar(id: number): Promise<void> {
    await this.db.delete(catalogoProdutos).where(eq(catalogoProdutos.id, id));
  }

  /**
   * Categorias APLICADAS a algum produto, com quantas imagens cada uma tem.
   * Não é o cadastro oficial (ver CategoriaRepository) — é o retrato do
   * acervo, e é o que alimenta os chips de filtro das telas.
   */
  async categoriasEmUso(): Promise<Array<{ nome: string; total: number }>> {
    const rows = await this.db
      .select({
        nome:  catalogoProdutos.categoria,
        total: sql<number>`count(*)::int`,
      })
      .from(catalogoProdutos)
      .where(sql`${catalogoProdutos.categoria} IS NOT NULL AND ${catalogoProdutos.categoria} <> ''`)
      .groupBy(catalogoProdutos.categoria)
      .orderBy(catalogoProdutos.categoria);
    return rows.map((r) => ({ nome: r.nome as string, total: r.total }));
  }

  /** Reescreve a categoria dos produtos que estão em alguma das `grafias`. `para: null` limpa. */
  async reclassificar(grafias: string[], para: string | null): Promise<number> {
    if (grafias.length === 0) return 0;
    const rows = await this.db
      .update(catalogoProdutos)
      .set({ categoria: para, atualizadoEm: new Date() })
      .where(inArray(catalogoProdutos.categoria, grafias))
      .returning({ id: catalogoProdutos.id });
    return rows.length;
  }
}
