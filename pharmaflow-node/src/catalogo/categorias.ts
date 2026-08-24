/**
 * Categorias do banco de imagens — lista FECHADA, definida aqui.
 *
 * Por que não deixar o gestor digitar a categoria livremente: com texto livre um
 * cadastra "Higiene", outro "higiene pessoal" e um terceiro "Higiene e beleza".
 * O filtro racha em três e o dono da farmácia não acha o produto. Lista fixa
 * custa uma decisão nossa e resolve o problema de vez.
 *
 * O banco guarda o SLUG (`higiene-beleza`), não o rótulo. Assim dá para renomear
 * "Mamãe e Bebê" para "Infantil" mexendo só em ROTULOS, sem migration de dados.
 *
 * ATENÇÃO: esta lista é espelhada em FrontEND/src/lib/categorias.ts — os dois
 * arquivos vivem em pacotes separados e não compartilham import. Mexeu em um,
 * mexa no outro.
 */

export const CATEGORIAS = [
  'higiene-beleza',
  'dermocosmeticos',
  'medicamentos',
  'mamae-bebe',
  'vitaminas',
  'cuidado-pessoal',
  'sazonais',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export const ROTULOS: Record<Categoria, string> = {
  'higiene-beleza':  'Higiene e Beleza',
  'dermocosmeticos': 'Dermocosméticos',
  'medicamentos':    'Medicamentos (MIP)',
  'mamae-bebe':      'Mamãe e Bebê',
  'vitaminas':       'Vitaminas e Suplementos',
  'cuidado-pessoal': 'Cuidado Pessoal',
  'sazonais':        'Sazonais / Datas',
};

/**
 * Aceita um slug conhecido. `null` é válido de propósito: significa "sem
 * categoria", que é o estado de todo produto cadastrado antes da migration 0028
 * e o jeito de LIMPAR a categoria de um produto já classificado.
 */
export function categoriaValida(v: unknown): v is Categoria | null {
  return v === null || (typeof v === 'string' && (CATEGORIAS as readonly string[]).includes(v));
}
