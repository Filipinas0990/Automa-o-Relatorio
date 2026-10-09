import type { Acao, Gestor } from '../database/schema';
import type { Linha } from '../compartilhado/tipos';
import { Mes } from '../compartilhado/Mes';
import { NaoEncontrado, Proibido, RequisicaoInvalida } from '../compartilhado/erros';
import type { FarmaciaRepository } from '../farmacias/FarmaciaRepository';
import type { AcaoRepository, FiltrosAcao, NovaAcao } from './AcaoRepository';
import type { ParticipacaoRepository } from './ParticipacaoRepository';

export const STATUS_ACAO = ['planejada', 'em_andamento', 'concluida', 'cancelada'];

const FORMATO_MES = /^\d{4}-\d{2}$/;
const int = (v: unknown) => parseInt(String(v || 0));

export interface DadosAcao {
  nome?: string;
  tipo?: string;
  descricao?: string | null;
  mes_referencia?: string;
  status?: string;
  cor?: string | null;
}

/**
 * Ações de marketing do mês (ex.: "Outubro Rosa") e as farmácias que
 * participam de cada uma. Só o admin cria e edita; todos consultam.
 */
export class AcaoService {
  constructor(
    private readonly acoes: AcaoRepository,
    private readonly participacoes: ParticipacaoRepository,
    private readonly farmacias: FarmaciaRepository,
  ) {}

  listar(filtros: FiltrosAcao): Promise<Linha[]> {
    return this.acoes.listar(filtros);
  }

  /** Resumo de um mês (padrão: o atual): totais por status e por tipo, e as ações. */
  async resumo(mesPedido: string | undefined) {
    const mes = Mes.daQuery(mesPedido);
    const [lista, s, tipos] = await Promise.all([
      this.acoes.doMes(mes),
      this.acoes.totaisDoMes(mes),
      this.acoes.tiposDoMes(mes),
    ]);
    return {
      mes,
      total_acoes:        int(s.total_acoes),
      farmacias_com_acao: int(s.farmacias_com_acao),
      por_status: {
        planejadas:   int(s.planejadas),
        em_andamento: int(s.em_andamento),
        concluidas:   int(s.concluidas),
        canceladas:   int(s.canceladas),
      },
      por_tipo: tipos.map((t) => ({ tipo: t.tipo, quantidade: int(t.quantidade) })),
      acoes: lista.map((a) => ({
        id:              int(a.id),
        nome:            a.nome,
        tipo:            a.tipo,
        status:          a.status,
        cor:             a.cor ?? null,
        total_farmacias: int(a.total_farmacias),
      })),
    };
  }

  /** A ação com as farmácias participantes. */
  async detalhar(id: number): Promise<{ acao: Linha; farmacias: Linha[] }> {
    const acao = await this.acoes.buscarComCriador(id);
    if (!acao) throw new NaoEncontrado('Ação não encontrada.');
    return { acao, farmacias: await this.participacoes.daAcao(id) };
  }

  /** Status fora da lista vira 'planejada'. */
  async criar(d: DadosAcao, quem: Gestor): Promise<Acao> {
    if (!d.nome)           throw new RequisicaoInvalida('Campo "nome" é obrigatório.');
    if (!d.tipo)           throw new RequisicaoInvalida('Campo "tipo" é obrigatório.');
    if (!d.mes_referencia) throw new RequisicaoInvalida('Campo "mes_referencia" é obrigatório (YYYY-MM).');
    if (!FORMATO_MES.test(d.mes_referencia)) {
      throw new RequisicaoInvalida('Campo "mes_referencia" deve estar no formato YYYY-MM.');
    }

    return this.acoes.criar({
      nome:          d.nome,
      tipo:          d.tipo,
      descricao:     d.descricao ?? null,
      mesReferencia: d.mes_referencia,
      status:        STATUS_ACAO.includes(d.status || '') ? d.status! : 'planejada',
      cor:           d.cor ?? null,
      criadoPorId:   quem.id,
    });
  }

  /** Só muda os campos enviados; aqui status inválido é recusado. */
  async atualizar(id: number, d: DadosAcao): Promise<Acao> {
    await this.exigir(id);

    const mudancas: Partial<NovaAcao> = {};
    if (d.nome      !== undefined) mudancas.nome      = d.nome;
    if (d.tipo      !== undefined) mudancas.tipo      = d.tipo;
    if (d.descricao !== undefined) mudancas.descricao = d.descricao;
    if (d.mes_referencia !== undefined) {
      if (!FORMATO_MES.test(d.mes_referencia)) {
        throw new RequisicaoInvalida('"mes_referencia" deve estar no formato YYYY-MM.');
      }
      mudancas.mesReferencia = d.mes_referencia;
    }
    if (d.status !== undefined) {
      if (!STATUS_ACAO.includes(d.status)) {
        throw new RequisicaoInvalida(`Status inválido. Use: ${STATUS_ACAO.join(', ')}.`);
      }
      mudancas.status = d.status;
    }
    if (d.cor !== undefined) mudancas.cor = d.cor;

    await this.acoes.atualizar(id, mudancas);
    return this.exigir(id);
  }

  /** Cancela, não apaga: a ação continua no histórico do mês. */
  async cancelar(id: number): Promise<void> {
    await this.exigir(id);
    await this.acoes.atualizar(id, { status: 'cancelada' });
  }

  /** Inclui as farmácias (ativas) na ação; as que já participavam são ignoradas. */
  async adicionarFarmacias(acaoId: number, ids: unknown, observacoes: string | null, quem: Gestor) {
    await this.exigir(acaoId);
    const pedidos = Array.isArray(ids) ? ids.map(Number).filter((n) => !isNaN(n)) : [];
    if (!pedidos.length) throw new RequisicaoInvalida('Campo "farmacia_ids" deve ser um array não vazio de IDs.');

    const validos = await this.participacoes.farmaciasAtivas(pedidos);
    if (!validos.length) throw new NaoEncontrado('Nenhuma farmácia válida encontrada.');

    let adicionadas = 0;
    for (const fid of validos) {
      if (await this.participacoes.adicionar(acaoId, fid, observacoes, quem.id)) adicionadas++;
    }
    return { adicionadas, total: await this.participacoes.total(acaoId) };
  }

  async removerFarmacia(acaoId: number, farmaciaId: number): Promise<void> {
    if (!await this.participacoes.remover(acaoId, farmaciaId)) {
      throw new NaoEncontrado('Participação não encontrada.');
    }
  }

  async anotar(acaoId: number, farmaciaId: number, observacoes: string | null): Promise<void> {
    if (!await this.participacoes.atualizarObservacoes(acaoId, farmaciaId, observacoes)) {
      throw new NaoEncontrado('Participação não encontrada.');
    }
  }

  /** Ações de uma farmácia. Gestor comum só consulta farmácia dele. */
  async daFarmacia(quem: Gestor, farmaciaId: number, mes?: string): Promise<Linha[]> {
    if (!quem.isAdmin && !await this.farmacias.buscarDoGestor(farmaciaId, quem.id)) {
      throw new Proibido('Acesso negado a esta farmácia.');
    }
    return this.participacoes.daFarmacia(farmaciaId, mes);
  }

  private async exigir(id: number): Promise<Acao> {
    const a = await this.acoes.buscarPorId(id);
    if (!a) throw new NaoEncontrado('Ação não encontrada.');
    return a;
  }
}
