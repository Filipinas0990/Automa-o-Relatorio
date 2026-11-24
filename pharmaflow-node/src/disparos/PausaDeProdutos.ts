import { RequisicaoInvalida, NaoEncontrado, Proibido, Conflito } from '../compartilhado/erros';
import { gestorDoEscopo, type QuemPede } from '../compartilhado/Escopo';
import { logger } from '../logger';
import { motivoParaNaoPausar, motivoParaNaoReativar, type SituacaoDaCampanha } from './pausa';

/**
 * O que o PausaDeProdutos precisa do banco — e só isso (ISP). O
 * DisparoRepository cumpre este contrato; o service não conhece a classe.
 *
 * As leituras NÃO trazem `midias_json`: as imagens de um disparo pesam dezenas
 * de MB, e pausar um produto é um clique na tela de acompanhamento.
 */
export interface PausasDosProdutos {
  /** Situação da campanha e o rótulo do produto naquele índice. null = disparo não existe. */
  situacaoParaPausa(disparoId: number, indice: number): Promise<
    (SituacaoDaCampanha & { gestorId: number; rotulo: string | null }) | null
  >;
  /** Marca como pausado (idempotente) e devolve a lista atualizada. */
  pausarMidia(disparoId: number, indice: number): Promise<number[]>;
  /** Tira a pausa (idempotente) e devolve a lista atualizada. */
  reativarMidia(disparoId: number, indice: number): Promise<number[]>;
}

export interface ResultadoPausa {
  indice:   number;
  /** "Dipirona — R$ 9,90"; null = arte pronta, que não tem rótulo. */
  rotulo:   string | null;
  pausado:  boolean;
  /** Todos os índices pausados da campanha depois da mudança. */
  pausados: number[];
}

/**
 * Pausa e reativa UM produto de uma campanha em andamento, sem cancelá-la.
 *
 * Pausado, o produto não sai em postagem nenhuma; reativado, volta para a fila
 * (e, se perdeu a vez enquanto estava pausado, sai na postagem seguinte — ver
 * fatiarRodizio). A campanha continua com os outros produtos.
 *
 * Mesma regra de alcance do resto dos disparos: o gestor mexe nos dele, o
 * admin em todos (regra do dono de 11/11/2026).
 */
export class PausaDeProdutos {
  constructor(private readonly repo: PausasDosProdutos) {}

  async definir(quem: QuemPede, disparoId: number, indice: number, pausado: boolean): Promise<ResultadoPausa> {
    if (!Number.isInteger(disparoId) || disparoId <= 0) throw new RequisicaoInvalida('Disparo inválido.');
    if (!Number.isInteger(indice) || indice < 0) throw new RequisicaoInvalida('Produto inválido.');

    const situacao = await this.repo.situacaoParaPausa(disparoId, indice);
    if (!situacao) throw new NaoEncontrado('Disparo não encontrado');

    const escopo = gestorDoEscopo(quem);
    if (escopo !== null && situacao.gestorId !== escopo) {
      throw new Proibido('Este disparo não pertence a você');
    }

    if (indice >= situacao.totalMidias) throw new NaoEncontrado('Produto não encontrado neste disparo.');

    const motivo = pausado
      ? motivoParaNaoPausar(situacao, indice)
      : motivoParaNaoReativar(situacao);
    if (motivo) throw new Conflito(motivo);

    const pausados = pausado
      ? await this.repo.pausarMidia(disparoId, indice)
      : await this.repo.reativarMidia(disparoId, indice);

    // Quem pausou o quê fica no log: o sistema registra a conta, e "não fui eu"
    // já foi uma pergunta difícil de responder (cancelamentos de 14/09).
    logger.info(
      { disparoId, indice, rotulo: situacao.rotulo, pausado, porGestor: quem.id },
      pausado ? 'Produto pausado na campanha' : 'Produto reativado na campanha',
    );

    return { indice, rotulo: situacao.rotulo, pausado, pausados };
  }
}
