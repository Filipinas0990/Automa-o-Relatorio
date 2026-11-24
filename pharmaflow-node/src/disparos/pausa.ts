/**
 * Regras puras de "pausar um produto da campanha" (migration 0047).
 *
 * Pedido do dono (23/11/2026): o produto acaba o estoque ou muda de preço
 * depois que a campanha foi agendada. Como o preço está impresso na arte, a
 * única saída era cancelar tudo e montar de novo sem aquele produto. Agora o
 * gestor pausa só ele.
 *
 * Aqui fica só a decisão (pode ou não pode, e por quê). Quem grava é o
 * PausaDeProdutos; quem respeita a pausa no envio é o fatiarRodizio.
 */

/** O que é preciso saber da campanha para decidir sobre a pausa. */
export interface SituacaoDaCampanha {
  status:          string;
  repetir:         string;
  repetirProdutos: boolean;
  cursorMidia:     number;
  totalMidias:     number;
  midiasPausadas:  readonly number[];
  midiasPuladas:   readonly number[];
}

/** Só campanha que ainda vai postar tem o que pausar. */
const ATIVAS = new Set(['agendado', 'enviando']);

const JA_TERMINOU =
  'Esta campanha já terminou — não há próximo envio para tirar ou devolver o produto.';

const JA_SAINDO =
  'Este envio já está saindo agora — não dá mais para mexer nos produtos dele.';

/**
 * O produto já foi postado e não volta a sair nesta campanha?
 *
 * Só vale no rodízio SEM volta: tudo antes do cursor saiu, menos quem foi
 * pulado por estar pausado. Com volta, o que saiu sai de novo na próxima volta
 * — então ainda dá para pausar.
 */
export function jaSaiuDeVez(c: SituacaoDaCampanha, indice: number): boolean {
  if (c.repetir === 'nunca' || c.repetirProdutos) return false;
  return indice < c.cursorMidia && !c.midiasPuladas.includes(indice);
}

/** Por que este produto não pode ser pausado agora. null = pode. */
export function motivoParaNaoPausar(c: SituacaoDaCampanha, indice: number): string | null {
  if (!ATIVAS.has(c.status)) return JA_TERMINOU;

  // No envio único não existe "próxima postagem": se já está saindo, foi.
  if (c.repetir === 'nunca' && c.status === 'enviando') return JA_SAINDO;

  if (jaSaiuDeVez(c, indice)) {
    return 'Este produto já foi postado e não volta a sair nesta campanha — não há o que pausar.';
  }

  // Envio único com tudo pausado mandaria a mensagem sem oferta nenhuma.
  // Quem não quer enviar nada cancela — e o cancelamento confirma pelo nome.
  if (c.repetir === 'nunca' && !c.midiasPausadas.includes(indice)) {
    // Só conta índice que existe na lista: coluna mexida à mão não pode
    // travar a pausa de um produto que ainda tem companhia.
    const pausadosDeVerdade = new Set(c.midiasPausadas.filter((i) => i >= 0 && i < c.totalMidias));
    const ativos = c.totalMidias - pausadosDeVerdade.size;
    if (ativos <= 1) {
      return 'É o único produto ativo deste envio. Para não enviar nada, cancele a campanha.';
    }
  }

  return null;
}

/** Por que este produto não pode ser reativado agora. null = pode. */
export function motivoParaNaoReativar(c: SituacaoDaCampanha): string | null {
  if (!ATIVAS.has(c.status)) return JA_TERMINOU;
  if (c.repetir === 'nunca' && c.status === 'enviando') return JA_SAINDO;
  return null;
}
