import { sql, eq, ne, and, desc, inArray } from 'drizzle-orm';
import { db } from '../database/db';
import { catalogoProdutos, catalogoCategorias } from '../database/schema';
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
 * Categorias APLICADAS a algum produto, com quantas imagens cada uma tem.
 *
 * Não é a lista oficial — essa é o cadastro (`listarCategorias`), que também
 * guarda categoria sem imagem nenhuma. Isto aqui é o retrato do acervo, e é o
 * que alimenta os chips de filtro das telas: chip de categoria vazia seria um
 * filtro que não filtra.
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
 * grafia oficial vence e as variações caem nela.
 *
 * Olha o CADASTRO primeiro e o acervo depois: uma categoria recém-criada ainda
 * não tem produto nenhum, e é justamente ela que precisa atrair a digitação.
 *
 * Custa dois SELECTs numa lista de dezenas de linhas, no caminho de salvar —
 * não é caminho quente.
 */
export async function canonizarCategoria(texto: string | null): Promise<string | null> {
  if (!texto) return null;
  const alvo = normalizarCategoria(texto);
  if (!alvo) return null;

  const [cadastrada] = await db
    .select({ nome: catalogoCategorias.nome })
    .from(catalogoCategorias)
    .where(eq(catalogoCategorias.nomeNorm, alvo))
    .limit(1);
  if (cadastrada) return cadastrada.nome;

  const igual = (await categoriasEmUso()).find((c) => normalizarCategoria(c.nome) === alvo);
  return igual ? igual.nome : texto;
}

/**
 * Canoniza E garante linha no cadastro. É por aqui que TODA escrita de
 * categoria passa (upload de imagem e classificação em lote).
 *
 * Sem isto o cadastro descolaria da realidade: quem digita uma categoria nova
 * no modal de upload criaria uma categoria que a tela de Categorias não lista
 * — e portanto ninguém consegue renomear nem excluir.
 */
export async function garantirCategoria(texto: string | null): Promise<string | null> {
  const nome = await canonizarCategoria(texto);
  if (!nome) return null;
  await db
    .insert(catalogoCategorias)
    .values({ nome, nomeNorm: normalizarCategoria(nome) })
    .onConflictDoNothing({ target: catalogoCategorias.nomeNorm });
  return nome;
}

// ── Cadastro de categorias (migration 0031) ───────────────────────────────────
// CRUD da tela Configurações › Categorias. O vínculo com o produto continua
// sendo o TEXTO em catalogo_produtos.categoria, então renomear e excluir aqui
// precisam mexer no acervo — é o que reclassificar() faz.

export interface CategoriaCadastrada {
  id: number;
  nome: string;
  /** Produtos classificados nela agora. Zero é normal: categoria recém-criada. */
  total: number;
  criadoEm: Date | null;
}

/** Linhas cruas do cadastro, em ordem alfabética. */
async function linhasDoCadastro() {
  return db
    .select({
      id:       catalogoCategorias.id,
      nome:     catalogoCategorias.nome,
      criadoEm: catalogoCategorias.criadoEm,
    })
    .from(catalogoCategorias);
}

/**
 * Registra as categorias que estão aplicadas a produtos mas ficaram sem linha
 * no cadastro. Devolve quantas entraram.
 *
 * É rede de segurança, não caminho normal: toda escrita passa por
 * `garantirCategoria` e a migration 0031 já trouxe o acervo. Cobre o que
 * escapar por fora (import direto no banco, restore de dump antigo) e existe
 * porque categoria que a tela lista mas não deixa editar é pior que categoria
 * nenhuma. No caso comum não escreve nada.
 */
async function sincronizarCadastro(
  emUso: Array<{ nome: string }>,
  cadastradas: Array<{ nome: string }>,
): Promise<number> {
  const conhecidas = new Set(cadastradas.map((c) => normalizarCategoria(c.nome)));
  const faltando = new Map<string, string>();
  for (const c of emUso) {
    const chave = normalizarCategoria(c.nome);
    if (!chave || conhecidas.has(chave) || faltando.has(chave)) continue;
    faltando.set(chave, c.nome);
  }
  if (faltando.size === 0) return 0;

  await db
    .insert(catalogoCategorias)
    .values([...faltando].map(([nomeNorm, nome]) => ({ nome, nomeNorm })))
    .onConflictDoNothing({ target: catalogoCategorias.nomeNorm });
  return faltando.size;
}

/** O cadastro com a contagem de produtos de cada categoria, em ordem alfabética. */
export async function listarCategorias(): Promise<CategoriaCadastrada[]> {
  const emUso = await categoriasEmUso();
  let cadastro = await linhasDoCadastro();

  if (await sincronizarCadastro(emUso, cadastro)) {
    cadastro = await linhasDoCadastro();
  }

  // Contagem casada pela chave normalizada, calculada em JS dos dois lados:
  // assim uma divergência entre o normalizador do SQL (migration) e o do
  // TypeScript não faria a categoria aparecer com zero produto.
  const total = new Map(emUso.map((c) => [normalizarCategoria(c.nome), c.total]));

  return cadastro
    .map((c) => ({
      id:       c.id,
      nome:     c.nome,
      total:    total.get(normalizarCategoria(c.nome)) ?? 0,
      criadoEm: c.criadoEm,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Cadastra uma categoria. `null` = já existe uma que normaliza igual. */
export async function criarCategoria(nome: string): Promise<CategoriaCadastrada | null> {
  const [row] = await db
    .insert(catalogoCategorias)
    .values({ nome, nomeNorm: normalizarCategoria(nome) })
    .onConflictDoNothing({ target: catalogoCategorias.nomeNorm })
    .returning();
  return row ? { id: row.id, nome: row.nome, total: 0, criadoEm: row.criadoEm } : null;
}

/**
 * Todas as grafias de uma categoria que aparecem no acervo.
 *
 * Renomear precisa disto porque o produto guarda texto: em teoria só existe a
 * grafia canônica, mas basta um registro anterior à canonização para que um
 * UPDATE por igualdade exata deixasse produto para trás — órfão de uma
 * categoria que não está mais no cadastro.
 */
async function grafiasNoAcervo(nome: string): Promise<string[]> {
  const alvo = normalizarCategoria(nome);
  return (await categoriasEmUso())
    .filter((c) => normalizarCategoria(c.nome) === alvo)
    .map((c) => c.nome);
}

/** Reescreve a categoria dos produtos. `para: null` deixa sem categoria. */
async function reclassificar(de: string, para: string | null): Promise<number> {
  const grafias = await grafiasNoAcervo(de);
  if (grafias.length === 0) return 0;
  const rows = await db
    .update(catalogoProdutos)
    .set({ categoria: para, atualizadoEm: new Date() })
    .where(inArray(catalogoProdutos.categoria, grafias))
    .returning({ id: catalogoProdutos.id });
  return rows.length;
}

export type ResultadoRenomear =
  | { ok: false; motivo: 'nao-existe' | 'duplicada' }
  | { ok: true; categoria: CategoriaCadastrada; produtos: number };

/**
 * Renomeia a categoria e arrasta os produtos junto.
 *
 * Os dois passos não estão numa transação: o segundo é o UPDATE em cascata, e
 * se ele falhar sobra o cadastro novo com produtos na grafia velha — que a
 * própria `sincronizarCadastro` recolhe na listagem seguinte, sem perder
 * produto nenhum. O estado intermediário é feio, não é destrutivo.
 */
export async function renomearCategoria(id: number, nome: string): Promise<ResultadoRenomear> {
  const [atual] = await db
    .select()
    .from(catalogoCategorias)
    .where(eq(catalogoCategorias.id, id))
    .limit(1);
  if (!atual) return { ok: false, motivo: 'nao-existe' };

  const norm = normalizarCategoria(nome);
  const [conflito] = await db
    .select({ id: catalogoCategorias.id })
    .from(catalogoCategorias)
    .where(and(eq(catalogoCategorias.nomeNorm, norm), ne(catalogoCategorias.id, id)))
    .limit(1);
  if (conflito) return { ok: false, motivo: 'duplicada' };

  await db
    .update(catalogoCategorias)
    .set({ nome, nomeNorm: norm, atualizadoEm: new Date() })
    .where(eq(catalogoCategorias.id, id));

  const produtos = await reclassificar(atual.nome, nome);

  return {
    ok: true,
    categoria: { id: atual.id, nome, total: produtos, criadoEm: atual.criadoEm },
    produtos,
  };
}

/**
 * Exclui a categoria. Os produtos dela NÃO são apagados: ficam sem categoria.
 *
 * Apagar imagem porque a categoria saiu seria destruir acervo por uma operação
 * de organização. Devolve quantos produtos ficaram sem classificação, para a
 * tela poder avisar antes e confirmar depois.
 */
export async function excluirCategoria(id: number): Promise<{ ok: boolean; produtos: number }> {
  const [atual] = await db
    .select({ nome: catalogoCategorias.nome })
    .from(catalogoCategorias)
    .where(eq(catalogoCategorias.id, id))
    .limit(1);
  if (!atual) return { ok: false, produtos: 0 };

  const produtos = await reclassificar(atual.nome, null);
  await db.delete(catalogoCategorias).where(eq(catalogoCategorias.id, id));
  return { ok: true, produtos };
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
