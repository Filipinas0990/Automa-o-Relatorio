import type { Gestor, Reuniao } from '../database/schema';
import type { Linha } from '../compartilhado/tipos';
import { ErroAplicacao, Indisponivel, NaoEncontrado, Proibido, RequisicaoInvalida } from '../compartilhado/erros';
import { logger } from '../logger';
import type { VerificadorConflito } from '../agenda/VerificadorConflito';
import type { AgendaGoogle } from '../google/AgendaGoogle';
import type { FarmaciaRepository } from '../farmacias/FarmaciaRepository';
import type { FiltrosReuniao, NovaReuniao, ReuniaoRepository } from './ReuniaoRepository';

/** Corpo de criação/edição como o front manda (snake_case; números podem vir como texto). */
export interface DadosReuniao {
  farmacia_id?: string | number;
  gestor_id?: string | number;
  titulo?: string;
  descricao?: string | null;
  data_reuniao?: string;
  duracao_minutos?: string | number;
  local?: string | null;
  link_meet?: string | null;
  telefone?: string | null;
  observacoes?: string | null;
}

const num = (v: string | number) => parseInt(String(v));

/**
 * Regras das reuniões com as farmácias: quem pode ver e mexer, conflito de
 * horário, ciclo de status (agendada → confirmada → realizada, ou cancelada)
 * e o espelho no Google Calendar.
 *
 * Falha no Google nunca impede salvar a reunião — só a sincronização manual
 * (`sincronizarGoogle`) devolve o erro.
 */
export class ReuniaoService {
  constructor(
    private readonly reunioes: ReuniaoRepository,
    private readonly farmacias: FarmaciaRepository,
    private readonly conflitos: VerificadorConflito,
    private readonly google: AgendaGoogle,
  ) {}

  async estatisticas(quem: Gestor) {
    const agora = new Date();
    const s = await this.reunioes.estatisticas(
      quem.isAdmin ? null : quem.id, new Date(agora.getFullYear(), agora.getMonth(), 1),
    );
    return {
      reunioes_mes:        parseInt(s.reunioes_mes        || 0),
      total_realizadas:    parseInt(s.total_realizadas    || 0),
      agendadas_futuras:   parseInt(s.agendadas_futuras   || 0),
      confirmadas_futuras: parseInt(s.confirmadas_futuras || 0),
    };
  }

  listar(filtros: FiltrosReuniao): Promise<Linha[]> {
    return this.reunioes.listar(filtros);
  }

  async buscar(quem: Gestor, id: number): Promise<Linha> {
    const r = await this.reunioes.buscarComNomes(id);
    if (!r) throw new NaoEncontrado('Reunião não encontrada.');
    this.exigirAcesso(quem, { gestorId: r.gestor_id, criadoPorId: r.criado_por_id });
    return r;
  }

  /** Cria como 'agendada'. Gestor comum só marca para farmácia dele. */
  async criar(quem: Gestor, d: DadosReuniao): Promise<{ reuniao: Reuniao; sincronizada: boolean }> {
    if (!d.farmacia_id || !d.titulo || !d.data_reuniao) {
      throw new RequisicaoInvalida('farmacia_id, titulo e data_reuniao são obrigatórios.');
    }
    if (!quem.isAdmin && !await this.farmacias.buscarDoGestor(num(d.farmacia_id), quem.id)) {
      throw new Proibido('Acesso negado a esta farmácia.');
    }

    const inicio  = new Date(d.data_reuniao);
    const duracao = d.duracao_minutos ? num(d.duracao_minutos) : 60;
    await this.conflitos.exigirLivre(inicio, duracao);

    const reuniao = await this.reunioes.criar({
      farmaciaId:     num(d.farmacia_id),
      gestorId:       d.gestor_id ? num(d.gestor_id) : quem.id,
      criadoPorId:    quem.id,
      titulo:         String(d.titulo),
      descricao:      d.descricao ?? null,
      dataReuniao:    inicio,
      duracaoMinutos: duracao,
      local:          d.local ?? null,
      linkMeet:       d.link_meet ?? null,
      telefone:       d.telefone ?? null,
      status:         'agendada',
    });

    const eventId = await this.google.sincronizar(reuniao.gestorId ?? quem.id, reuniao.id).catch(() => null);
    return { reuniao, sincronizada: !!eventId };
  }

  /** Só muda os campos enviados; mudou data ou duração, revalida o conflito. */
  async atualizar(quem: Gestor, id: number, d: DadosReuniao): Promise<Reuniao> {
    const atual = await this.exigir(id);
    this.exigirAcesso(quem, atual);

    const mudancas: Partial<NovaReuniao> = {};
    if (d.titulo          !== undefined) mudancas.titulo         = d.titulo;
    if (d.descricao       !== undefined) mudancas.descricao      = d.descricao;
    if (d.data_reuniao    !== undefined) mudancas.dataReuniao    = new Date(d.data_reuniao);
    if (d.duracao_minutos !== undefined) mudancas.duracaoMinutos = num(d.duracao_minutos);
    if (d.local           !== undefined) mudancas.local          = d.local;
    if (d.link_meet       !== undefined) mudancas.linkMeet       = d.link_meet;
    if (d.telefone        !== undefined) mudancas.telefone       = d.telefone;
    if (d.observacoes     !== undefined) mudancas.observacoes    = d.observacoes;
    if (d.gestor_id       !== undefined) mudancas.gestorId       = num(d.gestor_id);

    if (Object.keys(mudancas).length) {
      if (mudancas.dataReuniao || mudancas.duracaoMinutos) {
        await this.conflitos.exigirLivre(
          new Date(mudancas.dataReuniao ?? atual.dataReuniao),
          mudancas.duracaoMinutos ?? atual.duracaoMinutos ?? 60,
          id,
        );
      }
      await this.reunioes.atualizar(id, mudancas);
      await this.google.sincronizar(mudancas.gestorId ?? atual.gestorId ?? quem.id, id).catch(() => null);
    }
    return this.exigir(id);
  }

  async confirmar(quem: Gestor, id: number): Promise<void> {
    const atual = await this.exigir(id);
    if (atual.status === 'cancelada') throw new RequisicaoInvalida('Reunião cancelada não pode ser confirmada.');
    this.exigirAcesso(quem, atual);

    await this.reunioes.atualizar(id, { status: 'confirmada' });
    await this.google.sincronizar(atual.gestorId ?? quem.id, id).catch(() => null);
  }

  /** As observações enviadas substituem as anteriores; sem elas, ficam as que já havia. */
  async realizar(quem: Gestor, id: number, observacoes?: string | null): Promise<void> {
    const atual = await this.exigir(id);
    if (atual.status === 'cancelada') {
      throw new RequisicaoInvalida('Reunião cancelada não pode ser marcada como realizada.');
    }
    this.exigirAcesso(quem, atual);

    await this.reunioes.atualizar(id, { status: 'realizada', observacoes: observacoes ?? atual.observacoes });
  }

  async cancelar(quem: Gestor, id: number): Promise<void> {
    const atual = await this.exigir(id);
    if (atual.status === 'realizada') throw new RequisicaoInvalida('Reunião realizada não pode ser cancelada.');
    this.exigirAcesso(quem, atual);

    await this.reunioes.atualizar(id, { status: 'cancelada' });
    await this.google.remover(atual.gestorId ?? quem.id, id).catch(() => null);
  }

  /** Sincronização pedida pelo gestor: aqui as falhas do Google voltam para a tela. */
  async sincronizarGoogle(quem: Gestor, id: number): Promise<string> {
    const atual = await this.exigir(id);
    if (!this.google.configurado) throw new Indisponivel('Google Calendar não configurado no servidor.');

    let eventId: string | null;
    try {
      eventId = await this.google.sincronizar(atual.gestorId ?? quem.id, id);
    } catch (e) {
      logger.error({ err: e }, 'Erro ao sincronizar com Google Calendar');
      throw new ErroAplicacao(502, 'Erro ao comunicar com o Google Calendar.');
    }
    if (!eventId) {
      throw new ErroAplicacao(424, 'Google Calendar não conectado. Acesse /api/auth/google para autorizar.');
    }
    return eventId;
  }

  async exigir(id: number): Promise<Reuniao> {
    const r = await this.reunioes.buscarPorId(id);
    if (!r) throw new NaoEncontrado('Reunião não encontrada.');
    return r;
  }

  /** Gestor comum só mexe na reunião que conduz ou que criou. */
  private exigirAcesso(quem: Gestor, r: { gestorId: number | null; criadoPorId: number | null }): void {
    if (!quem.isAdmin && r.gestorId !== quem.id && r.criadoPorId !== quem.id) {
      throw new Proibido('Acesso negado.');
    }
  }
}
