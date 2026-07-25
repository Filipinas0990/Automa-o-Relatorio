import { sql, eq, desc } from 'drizzle-orm';
import { db } from '../database/db';
import { catalogoProdutos } from '../database/schema';

// ── Normalização de nomes (usada no cadastro e no match) ──────────────────────
// Remove acentos, coloca em minúsculo e colapsa espaços.
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')  // tira acentos
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

/**
 * Carrega o catálogo ATIVO (id, nome, imagem) para o match em memória.
 * Produtos desligados (ativo = false) ficam de fora — não entram nos criativos.
 */
export async function carregarCatalogo(): Promise<CatalogoRow[]> {
  return db
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

/** Cadastra/atualiza um produto do catálogo (upsert pelo nome normalizado). */
export async function upsertProduto(nome: string, imagemB64: string, mime = 'image/png'): Promise<void> {
  const nomeNorm = normalizar(nome);
  await db
    .insert(catalogoProdutos)
    .values({ nome, nomeNorm, imagemB64, mime })
    .onConflictDoUpdate({
      target: catalogoProdutos.nomeNorm,
      set: { nome, imagemB64, mime, atualizadoEm: new Date() },
    });
}

/** Conta quantos produtos existem no catálogo. */
export async function contarProdutos(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(catalogoProdutos);
  return row?.total ?? 0;
}

/** Lista os produtos do catálogo (sem a imagem, para ser leve). Inclui todos, ativos e desligados. */
export async function listarProdutos(): Promise<Array<{ id: number; nome: string; ativo: boolean; criadoEm: Date | null }>> {
  return db
    .select({
      id:       catalogoProdutos.id,
      nome:     catalogoProdutos.nome,
      ativo:    catalogoProdutos.ativo,
      criadoEm: catalogoProdutos.criadoEm,
    })
    .from(catalogoProdutos)
    .orderBy(desc(catalogoProdutos.criadoEm));
}

/** Liga/desliga um produto do catálogo. Retorna false se o produto não existe. */
export async function setAtivo(id: number, ativo: boolean): Promise<boolean> {
  const rows = await db
    .update(catalogoProdutos)
    .set({ ativo, atualizadoEm: new Date() })
    .where(eq(catalogoProdutos.id, id))
    .returning({ id: catalogoProdutos.id });
  return rows.length > 0;
}

/** Retorna a imagem (base64 + mime) de um produto. */
export async function getImagem(id: number): Promise<{ imagemB64: string | null; mime: string | null } | null> {
  const [row] = await db
    .select({ imagemB64: catalogoProdutos.imagemB64, mime: catalogoProdutos.mime })
    .from(catalogoProdutos)
    .where(eq(catalogoProdutos.id, id))
    .limit(1);
  return row ?? null;
}

/** Remove um produto do catálogo. */
export async function deletarProduto(id: number): Promise<void> {
  await db.delete(catalogoProdutos).where(eq(catalogoProdutos.id, id));
}

// ── Match de uma lista de produtos vindos da planilha ─────────────────────────

export interface ProdutoEntrada {
  nome: string;
  preco?: string;
}

export interface ProdutoIdentificado {
  nome: string;                       // nome oficial do catálogo (se achou) ou o digitado
  preco: string;
  status: 'encontrado' | 'nao_encontrado';
  imagem: string | null;             // data URI pronta para <img src>
  catalogoId: number | null;
}

/**
 * Recebe a lista de produtos da planilha e devolve cada um com a imagem do
 * catálogo (quando o nome bate) ou marcado como não encontrado.
 */
export async function identificarProdutos(entradas: ProdutoEntrada[]): Promise<ProdutoIdentificado[]> {
  const catalogo = await carregarCatalogo();

  return entradas.map((entrada) => {
    const alvo = normalizar(entrada.nome);

    // 1) match exato pelo nome normalizado
    // 2) match por conteúdo (um contém o outro) — cobre variações de escrita
    const achado =
      catalogo.find((c) => c.nomeNorm === alvo) ??
      catalogo.find((c) => c.nomeNorm.includes(alvo) || alvo.includes(c.nomeNorm));

    if (achado) {
      return {
        nome:       achado.nome,
        preco:      entrada.preco?.trim() || '—',
        status:     'encontrado',
        imagem:     achado.imagemB64
          ? `data:${achado.mime ?? 'image/png'};base64,${achado.imagemB64}`
          : null,
        catalogoId: achado.id,
      };
    }

    return {
      nome:       entrada.nome,
      preco:      entrada.preco?.trim() || '—',
      status:     'nao_encontrado',
      imagem:     null,
      catalogoId: null,
    };
  });
}
