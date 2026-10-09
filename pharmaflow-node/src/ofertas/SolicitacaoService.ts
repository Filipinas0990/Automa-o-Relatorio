import type { Gestor, SolicitacaoOferta } from '../database/schema';
import { NaoEncontrado, Proibido, RequisicaoInvalida } from '../compartilhado/erros';
import { logger } from '../logger';
import type { FarmaciaRepository } from '../farmacias/FarmaciaRepository';
import type { LinkAberto } from './LinkOfertaService';
import { ListaDoDono } from './ListaDoDono';
import type { SolicitacaoRepository } from './SolicitacaoRepository';

/** O que a parte de ofertas precisa saber do catálogo. */
export interface ProdutosDoCatalogo {
  listarProdutos(): Promise<Array<{ id: number; nome: string; categoria: string | null; ativo: boolean }>>;
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

    const nomes = new Map((await this.catalogo.listarProdutos()).map((p) => [p.id, p.nome]));
    const produtos = ListaDoDono.paraGuardar(escolhas, nomes);

    const solicitacao = await this.solicitacoes.criar({
      gestorId: gestor.id, farmaciaId, produtosJson: JSON.stringify(produtos), enviadoPor,
    });
    logger.info(
      { solicitacaoId: solicitacao.id, gestorId: gestor.id, farmaciaId, total: produtos.length },
      'Nova solicitação de oferta recebida pelo link público',
    );
    return solicitacao;
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
