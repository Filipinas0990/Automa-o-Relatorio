/**
 * Categorias do banco de imagens — TEXTO LIVRE, digitado pelo gestor.
 *
 * Era uma lista fechada (migration 0028) e virou campo aberto (0030): quem
 * opera o sistema precisa criar categoria nova sem esperar deploy.
 *
 * O preço do texto livre é a fragmentação — "Higiene", "higiene" e "HIGIENE "
 * viram três chips que dividem o mesmo acervo. Quem segura isso são duas
 * coisas, e nenhuma delas é uma lista fixa:
 *
 *   • `normalizarCategoria` aqui, que dá a chave de comparação;
 *   • `canonizarCategoria` no repository, que ao salvar reaproveita a grafia
 *     de uma categoria existente que normalize igual;
 *   • e a interface, que sugere o que já existe enquanto o gestor digita.
 */

/** Teto do campo no banco (migration 0030: varchar(60)). */
export const MAX_CATEGORIA = 60;

/**
 * Categorias oferecidas SEMPRE no campo de classificação, estejam ou não em
 * uso. São somadas às que já existem no acervo, sem duplicar.
 *
 * Não são obrigatórias e não são validadas — o campo continua aceitando
 * qualquer texto. Existem porque o gestor não deve precisar lembrar de cor as
 * categorias do negócio nem redigitá-las a cada acervo novo.
 */
export const CATEGORIAS_PADRAO = [
  'Higiene e Beleza',
  'Dermocosméticos',
  'Medicamentos (MIP)',
  'Mamãe e Bebê',
  'Vitaminas e Suplementos',
  'Cuidado Pessoal',
  'Sazonais / Datas',
];

/**
 * Chave de comparação entre categorias: sem acento, minúscula, espaços
 * colapsados. "  Higiene  e  Beleza " e "higiene e beleza" dão a mesma chave.
 */
export function normalizarCategoria(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Valida o que veio do cliente e devolve o texto pronto para gravar.
 *
 * - `null`, `undefined` ou string vazia → `null` (limpa a categoria)
 * - texto → aparado e cortado no teto do banco
 * - qualquer outro tipo → `undefined`, que o chamador traduz em 400
 *
 * `null` e `undefined` chegam aqui com o mesmo resultado de propósito; quem
 * distingue "limpar" de "não mexer" é a rota, olhando se o campo veio no corpo.
 */
export function limparCategoria(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const texto = v.replace(/\s+/g, ' ').trim();
  return texto ? texto.slice(0, MAX_CATEGORIA) : null;
}
