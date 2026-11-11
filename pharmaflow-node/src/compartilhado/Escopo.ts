/** O mínimo de quem está logado para decidir o alcance de uma consulta. */
export interface QuemPede {
  id:      number;
  isAdmin: boolean;
}

/**
 * REGRA DO DONO (11/11/2026): o admin precisa saber de TUDO o que os gestores
 * fazem — listas que os clientes mandam, disparos programados, histórico.
 *
 * Devolve o gestorId para filtrar a consulta, ou `null` = sem filtro (todos
 * os gestores). Toda leitura escopada por gestor deve passar por aqui, para a
 * regra não depender de cada service lembrar do `isAdmin`.
 */
export function gestorDoEscopo(quem: QuemPede): number | null {
  return quem.isAdmin ? null : quem.id;
}
