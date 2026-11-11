import type { Farmacia, Gestor, SolicitacaoOferta } from '../database/schema';
import { NaoEncontrado, Proibido, RequisicaoInvalida } from '../compartilhado/erros';
import { logger } from '../logger';
import type { FarmaciaRepository } from '../farmacias/FarmaciaRepository';
import type { LinkAberto } from './LinkOfertaService';
import { ListaDoDono } from './ListaDoDono';
import type { ProdutoSolicitado } from './ListaDoDono';
import type { SolicitacaoRepository } from './SolicitacaoRepository';

/** O que a parte de ofertas precisa saber do catálogo. */
export interface ProdutosDoCatalogo {
  listarProdutos(): Promise<Array<{ id: number; nome: string; categoria: string | null; ativo: boolean }>>;
}

/** Os produtos que a farmácia mandou para o espaço dela (ver ProdutoClienteService). */
export interface ProdutosDoEspaco {
  listar(farmaciaId: number): Promise<Array<{ id: number; nome: string }>>;
}

/** O que sai para fora quando um cliente envia a lista pelo link (ver AvisoN8n). */
export interface ListaRecebida {
  solicitacao: SolicitacaoOferta;
  gestor:      Pick<Gestor, 'id' | 'nome' | 'email'>;
  farmacia:    Farmacia;
  produtos:    ProdutoSolicitado[];
}

/**
 * Avisa um sistema externo (hoje, o webhook do n8n que cria o item no Monday)
 * que chegou uma lista nova. Contrato: NUNCA rejeita — falha de quem recebe o
 * aviso é registrada no log e não pode impedir o cliente de enviar a lista.
 */
export interface AvisoDeListaRecebida {
  avisar(lista: ListaRecebida): Promise<void>;
}

export interface EnvioDoDono {
  farmacia_id?: number | string;
  produtos?:    unknown;
  /** Obrigatório: o gestor precisa saber com quem falar sobre a lista. */
  enviado_por?: string;
}

const STATUS = ['pendente', 'atendida', 'descartada'];

/** As listas de produtos que os donos enviam e o que o gestor faz com elas. */
export class SolicitacaoService {
  constructor(
    private readonly solicitacoes: SolicitacaoRepository,
    private readonly farmacias: FarmaciaRepository,
    private readonly catalogo: ProdutosDoCatalogo,
    private readonly espaco: ProdutosDoEspaco,
    private readonly aviso: AvisoDeListaRecebida,
  ) {}

  /**
   * O dono envia a seleção pelo link. No link de cliente a farmácia vem do
   * próprio token (o corpo não decide nada); no legado, ela ainda precisa ser
   * do gestor — senão um link permitiria enviar em nome de cliente de outro.
   */
  async receber(link: LinkAberto, b: EnvioDoDono | undefined): Promise<SolicitacaoOferta> {
    const { gestor } = link;
    const farmaciaId = link.farmacia ? link.farmacia.id : await this.farmaciaEscolhida(link, b?.farmacia_id);

    const escolhas = ListaDoDono.escolhas(b?.produtos);
    if (escolhas.length === 0) throw new RequisicaoInvalida('Escolha ao menos um produto.');

    // Nome de quem enviou é obrigatório (migration 0027). O corte em 120
    // acompanha o tamanho da coluna.
    const enviadoPor = (b?.enviado_por ?? '').trim().slice(0, 120);
    if (enviadoPor.length < 2) throw new RequisicaoInvalida('Informe o seu nome para enviar a lista.');

    // O espaço de produtos próprios só existe no link de cliente: no legado a
    // farmácia vem do corpo, e lá não há o que buscar.
    const [catalogo, doEspaco] = await Promise.all([
      this.catalogo.listarProdutos(),
      link.farmacia ? this.espaco.listar(farmaciaId) : [],
    ]);
    const nomes = new Map<number, string>([
      ...catalogo.map((p): [number, string] => [p.id, p.nome]),
      ...doEspaco.map((p): [number, string] => [ListaDoDono.idDoCliente(p.id), p.nome]),
    ]);
    const produtos = ListaDoDono.paraGuardar(escolhas, nomes);

    const solicitacao = await this.solicitacoes.criar({
      gestorId: gestor.id, farmaciaId, produtosJson: JSON.stringify(produtos), enviadoPor,
    });
    logger.info(
      { solicitacaoId: solicitacao.id, gestorId: gestor.id, farmaciaId, total: produtos.length },
      'Nova solicitação de oferta recebida pelo link público',
    );

    // Sem await: o cliente não espera o n8n/Monday responder (e o proxy da
    // Vercel corta a resposta que demora). A lista já está salva aqui.
    void this.avisarSemTravar(solicitacao, link, farmaciaId, produtos);
    return solicitacao;
  }

  private async avisarSemTravar(
    solicitacao: SolicitacaoOferta, link: LinkAberto, farmaciaId: number, produtos: ProdutoSolicitado[],
  ): Promise<void> {
    try {
      const farmacia = link.farmacia ?? await this.farmacias.buscarPorId(farmaciaId);
      if (!farmacia) return;
      await this.aviso.avisar({ solicitacao, gestor: link.gestor, farmacia, produtos });
    } catch (err) {
      // O contrato diz que o aviso não rejeita; isto cobre a busca da farmácia.
      logger.error({ err, solicitacaoId: solicitacao.id }, 'Falha ao preparar o aviso da lista recebida');
    }
  }

  listar(quem: Gestor) {
    return this.solicitacoes.listarDoGestor(quem.id);
  }

  /** O que este cliente escolheu da última vez pelo link deste gestor. */
  async ultimaEscolha(quem: Gestor, farmaciaId: number): Promise<SolicitacaoOferta | null> {
    if (!Number.isFinite(farmaciaId)) throw new RequisicaoInvalida('Farmácia inválida');
    return this.solicitacoes.ultimaDaFarmacia(quem.id, farmaciaId);
  }

  /** Admin alcança todas — a carteira dele também lista todas as farmácias. */
  async mudarStatus(quem: Gestor, id: number, status: string | undefined): Promise<void> {
    const s = await this.solicitacoes.buscarPorId(id);
    if (!s) throw new NaoEncontrado('Solicitação não encontrada');
    if (!quem.isAdmin && s.gestorId !== quem.id) throw new Proibido('Esta solicitação não pertence a você');
    if (!status || !STATUS.includes(status)) throw new RequisicaoInvalida('Status inválido');
    await this.solicitacoes.atualizarStatus(s.id, status);
  }

  /** Total para o badge do menu. */
  pendentes(quem: Gestor): Promise<number> {
    return this.solicitacoes.contarPendentes(quem.id);
  }

  private async farmaciaEscolhida(link: LinkAberto, bruto: unknown): Promise<number> {
    const id = Number(bruto);
    if (!Number.isFinite(id)) throw new RequisicaoInvalida('Escolha a sua farmácia.');
    const doGestor = await this.farmacias.listarAtivas(link.gestor.isAdmin ? null : link.gestor.id);
    if (!doGestor.some((f) => f.id === id)) {
      throw new Proibido('Esta farmácia não está disponível neste link.');
    }
    return id;
  }
}
