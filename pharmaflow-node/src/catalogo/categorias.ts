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
 * Semente do cadastro de categorias — histórico, NÃO é mais lida em runtime.
 *
 * Eram devolvidas como "sugestões" em toda listagem, fixas no código: mudar
 * qualquer uma exigia deploy, e ninguém conseguia excluir a que não usava. A
 * migration 0031 inseriu esta lista na tabela `catalogo_categorias` e a partir
 * dali o cadastro manda. Fica aqui só para documentar de onde vieram as sete
 * linhas que todo banco tem; apagar daqui não muda nada em produção.
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
