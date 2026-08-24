import { sql, eq, desc, inArray } from 'drizzle-orm';
import { db } from '../database/db';
import { catalogoProdutos } from '../database/schema';
import { normalizarCategoria } from './categorias';

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

/**
 * Cadastra/atualiza um produto do catálogo (upsert pelo nome normalizado).
 *
 * `categoria` é opcional e `undefined` NÃO é o mesmo que `null` aqui: quando
 * vem undefined o campo fica fora do UPDATE, para que reenviar a foto de um
 * produto já classificado não apague a categoria dele. Passe `null` explícito
 * para de fato limpar.
 */
export async function upsertProduto(
  nome: string,
  imagemB64: string,
  mime = 'image/png',
  categoria?: string | null,
): Promise<void> {
  const nomeNorm = normalizar(nome);
  const set: Record<string, unknown> = { nome, imagemB64, mime, atualizadoEm: new Date() };
  if (categoria !== undefined) set.categoria = categoria;

  await db
    .insert(catalogoProdutos)
    .values({ nome, nomeNorm, imagemB64, mime, categoria: categoria ?? null })
    .onConflictDoUpdate({ target: catalogoProdutos.nomeNorm, set });
}

/** Conta quantos produtos existem no catálogo. */
export async function contarProdutos(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(catalogoProdutos);
  return row?.total ?? 0;
}

/** Lista os produtos do catálogo (sem a imagem, para ser leve). Inclui todos, ativos e desligados. */
export async function listarProdutos(): Promise<Array<{
  id: number; nome: string; ativo: boolean; categoria: string | null; criadoEm: Date | null;
}>> {
  return db
    .select({
      id:        catalogoProdutos.id,
      nome:      catalogoProdutos.nome,
      ativo:     catalogoProdutos.ativo,
      categoria: catalogoProdutos.categoria,
      criadoEm:  catalogoProdutos.criadoEm,
    })
    .from(catalogoProdutos)
    .orderBy(desc(catalogoProdutos.criadoEm));
}

/**
 * Classifica vários produtos de uma vez. Devolve quantos foram alterados.
 *
 * Existe por causa do acervo antigo: são centenas de imagens cadastradas antes
 * da migration 0028, todas sem categoria. Classificar uma a uma na interface
 * seria inviável, então a tela oferece seleção múltipla e chama isto.
 * `categoria: null` limpa a classificação.
 */
export async function setCategoriaEmLote(ids: number[], categoria: string | null): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(catalogoProdutos)
    .set({ categoria, atualizadoEm: new Date() })
    .where(inArray(catalogoProdutos.id, ids))
    .returning({ id: catalogoProdutos.id });
  return rows.length;
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

/**
 * Categorias em uso, com quantos produtos cada uma tem.
 *
 * Alimenta as sugestões do campo de digitação e os chips das telas. Só o que
 * está realmente aplicado a algum produto: categoria que ficou sem produto
 * nenhum simplesmente deixa de existir, sem cadastro para limpar.
 */
export async function categoriasEmUso(): Promise<Array<{ nome: string; total: number }>> {
  const rows = await db
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

/**
 * Antifragmentação do texto livre: se o que o gestor digitou normaliza igual a
 * uma categoria que já existe, grava a GRAFIA JÁ CADASTRADA em vez da digitada.
 *
 * Sem isto, "higiene e beleza" digitado com pressa abre um chip separado do
 * "Higiene e Beleza" que já existia, e o acervo racha em dois. Com isto, a
 * primeira grafia cadastrada vira a oficial e as variações caem nela.
 *
 * Custa um SELECT numa lista de dezenas de linhas, no caminho de salvar — não
 * é caminho quente.
 */
export async function canonizarCategoria(texto: string | null): Promise<string | null> {
  if (!texto) return null;
  const alvo = normalizarCategoria(texto);
  if (!alvo) return null;

  const existentes = await categoriasEmUso();
  const igual = existentes.find((c) => normalizarCategoria(c.nome) === alvo);
  return igual ? igual.nome : texto;
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
