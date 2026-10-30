/**
 * O dono manda `[{ id, preco, preco_de }]`. Ainda aceitamos `number[]` (o
 * formato antigo) porque um celular com a página em cache continua postando
 * assim — e `preco_de` também falta nos envios anteriores ao de/por.
 */
export type ProdutoEnviado = number | { id: number; preco?: string | null; preco_de?: string | null };

/**
 * Produto dentro do JSON da solicitação. Nome e preços viajam junto do id
 * porque o catálogo pode mudar depois do envio.
 */
export interface ProdutoSolicitado {
  /** Negativo = produto que o próprio cliente mandou (ver `ListaDoDono.idDoCliente`). */
  id:        number;
  nome:      string;
  preco?:    string | null;
  /** Preço antigo (riscado na arte) quando o dono ligou o "de/por". */
  preco_de?: string | null;
  /** 'cliente' quando a foto é do espaço do cliente (produtos_cliente), não do banco de imagens. */
  origem?:   'cliente';
}

interface Escolha {
  id: number;
  preco: string | null;
  precoDe: string | null;
}

/** A lista de produtos que o dono da farmácia escolhe pelo link público. */
export class ListaDoDono {
  /**
   * O preço vem de uma tela pública e vai parar dentro da arte da oferta, então
   * entra só o que é preço: dígitos, vírgula e ponto. Vazio vira null — o dono
   * não é obrigado a informar, o gestor completa no passo 3.
   */
  static limparPreco(bruto: unknown): string | null {
    if (typeof bruto !== 'string') return null;
    const limpo = bruto.replace(/[^\d.,]/g, '').slice(0, 15).trim();
    return limpo || null;
  }

  /** O que veio no corpo, nos dois formatos, já com os preços limpos. */
  static escolhas(bruto: unknown): Escolha[] {
    return (Array.isArray(bruto) ? (bruto as ProdutoEnviado[]) : [])
      .map((p) => (typeof p === 'object' && p !== null
        ? { id: Number(p.id), preco: ListaDoDono.limparPreco(p.preco), precoDe: ListaDoDono.limparPreco(p.preco_de) }
        : { id: Number(p), preco: null, precoDe: null }))
      .filter((p) => Number.isFinite(p.id))
      // "de" sem "por" não vira arte nenhuma: o riscado só existe em relação
      // ao preço da oferta. Cai fora aqui para não chegar quebrado no gestor.
      .map((p) => (p.preco ? p : { ...p, precoDe: null }));
  }

  /**
   * Produto do espaço do cliente entra na lista com o id NEGATIVO (-id de
   * produtos_cliente). Assim ele nunca colide com um id do catálogo, e quem lê
   * a lista (passo 3 do disparo) separa os dois pelo sinal.
   */
  static idDoCliente(produtoClienteId: number): number {
    return -produtoClienteId;
  }

  /**
   * Só os produtos que existem — no catálogo ou no espaço do cliente (`nomes`
   * já traz estes com o id negativo) —, com o nome de agora.
   */
  static paraGuardar(escolhas: Escolha[], nomes: Map<number, string>): ProdutoSolicitado[] {
    return escolhas
      .filter((p) => nomes.has(p.id))
      .map((p) => ({
        id: p.id, nome: nomes.get(p.id) as string, preco: p.preco, preco_de: p.precoDe,
        ...(p.id < 0 ? { origem: 'cliente' as const } : {}),
      }));
  }

  /** Lê o JSON guardado na solicitação; JSON quebrado vira lista vazia. */
  static ler(json: string | null | undefined): ProdutoSolicitado[] {
    if (!json) return [];
    try { return JSON.parse(json); } catch { return []; }
  }
}
