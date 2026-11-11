import { nomeVisivel } from '../database/schema';
import { logger } from '../logger';
import type { AvisoDeListaRecebida, ListaRecebida } from './SolicitacaoService';

/** n8n costuma responder em milissegundos; passou disso, algo está errado lá. */
const TIMEOUT_MS = 10_000;
/** Uma segunda chance cobre o n8n reiniciando; mais que isso vira spam no log. */
const TENTATIVAS = 2;

/**
 * Corpo enviado ao webhook. É contrato com a automação do n8n: renomear campo
 * aqui quebra o fluxo de lá. Para mudar, crie campo novo e suba `versao`.
 */
export interface CorpoListaRecebida {
  evento:         'oferta.lista_recebida';
  versao:         1;
  solicitacao_id: number;
  recebida_em:    string;
  enviado_por:    string;
  farmacia:       { id: number; nome: string; razao_social: string; cidade: string | null; telefone: string | null };
  gestor:         { id: number; nome: string; email: string };
  total_produtos: number;
  produtos:       Array<{ id: number; nome: string; preco: string | null; preco_de: string | null; origem: 'catalogo' | 'cliente' }>;
  /** Texto pronto (uma linha por produto) para colar no item/update do Monday. */
  resumo:         string;
}

/** Envia a lista recebida para o webhook do n8n (que a leva ao Monday). */
export class AvisoN8n implements AvisoDeListaRecebida {
  constructor(
    private readonly url: string,
    /** Vai no cabeçalho X-PharmaFlow-Segredo; configure o mesmo valor no "Header Auth" do nó Webhook. */
    private readonly segredo: string | undefined,
  ) {}

  async avisar(lista: ListaRecebida): Promise<void> {
    const corpo = AvisoN8n.corpo(lista);
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      try {
        const res = await fetch(this.url, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.segredo ? { 'X-PharmaFlow-Segredo': this.segredo } : {}),
          },
          body:   JSON.stringify(corpo),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) {
          logger.info({ solicitacaoId: corpo.solicitacao_id }, 'Lista de oferta enviada ao n8n');
          return;
        }
        logger.warn({ solicitacaoId: corpo.solicitacao_id, status: res.status, tentativa }, 'n8n recusou o aviso da lista');
        // 4xx = URL/segredo errado ou fluxo desativado: repetir não resolve.
        if (res.status < 500) return;
      } catch (err) {
        logger.warn({ err, solicitacaoId: corpo.solicitacao_id, tentativa }, 'n8n não respondeu ao aviso da lista');
      }
    }
    logger.error({ solicitacaoId: corpo.solicitacao_id }, 'Lista de oferta NÃO chegou ao n8n');
  }

  static corpo({ solicitacao, gestor, farmacia, produtos }: ListaRecebida): CorpoListaRecebida {
    const itens = produtos.map((p) => ({
      id: p.id, nome: p.nome, preco: p.preco ?? null, preco_de: p.preco_de ?? null,
      origem: p.origem === 'cliente' ? 'cliente' as const : 'catalogo' as const,
    }));
    return {
      evento:         'oferta.lista_recebida',
      versao:         1,
      solicitacao_id: solicitacao.id,
      recebida_em:    (solicitacao.criadoEm ?? new Date()).toISOString(),
      enviado_por:    solicitacao.enviadoPor,
      farmacia: {
        id: farmacia.id, nome: nomeVisivel(farmacia), razao_social: farmacia.nome,
        cidade: farmacia.cidade ?? null, telefone: farmacia.telefone ?? null,
      },
      gestor:         { id: gestor.id, nome: gestor.nome, email: gestor.email },
      total_produtos: itens.length,
      produtos:       itens,
      resumo:         itens.map(AvisoN8n.linha).join('\n'),
    };
  }

  private static linha(p: CorpoListaRecebida['produtos'][number]): string {
    const preco = p.preco ? (p.preco_de ? ` — de R$ ${p.preco_de} por R$ ${p.preco}` : ` — R$ ${p.preco}`) : '';
    return `• ${p.nome}${preco}${p.origem === 'cliente' ? ' (foto do cliente)' : ''}`;
  }
}

/** Usado quando N8N_WEBHOOK_OFERTAS_URL não está no .env: não avisa ninguém. */
export class SemAviso implements AvisoDeListaRecebida {
  async avisar(): Promise<void> {}
}
