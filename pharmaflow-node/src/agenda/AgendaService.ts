import type { Gestor } from '../database/schema';
import { NaoEncontrado, RequisicaoInvalida } from '../compartilhado/erros';
import { Mes } from '../compartilhado/Mes';
import type { ReuniaoRepository } from '../reunioes/ReuniaoRepository';
import type { BloqueioRepository } from './BloqueioRepository';
import { GradeHorarios } from './GradeHorarios';
import type { ResultadoConflito, VerificadorConflito } from './VerificadorConflito';

export interface DadosBloqueio {
  data?: string;
  hora_inicio?: string;
  hora_fim?: string;
  dia_inteiro?: boolean;
  motivo?: string;
}

/** Agenda da agência: horários livres, visão do mês e bloqueios. */
export class AgendaService {
  constructor(
    private readonly bloqueios: BloqueioRepository,
    private readonly reunioes: ReuniaoRepository,
    private readonly verificador: VerificadorConflito,
  ) {}

  /** Se o horário (opcional) está livre, mais as ocupações e a grade do dia. */
  async disponibilidade(q: { data?: string; hora?: string; duracao?: string }) {
    if (!q.data) throw new RequisicaoInvalida('Parâmetro "data" obrigatório (YYYY-MM-DD).');

    let resultado: ResultadoConflito = { conflito: false };
    if (q.hora) {
      resultado = await this.verificador.verificar(new Date(`${q.data}T${q.hora}:00Z`), parseInt(q.duracao || '60'));
    }

    const [reunioesDia, bloqueiosDia] = await Promise.all([
      this.reunioes.ativasDoDia(q.data),
      this.bloqueios.doDia(q.data),
    ]);
    const diaBloqueado = bloqueiosDia.some((b) => b.dia_inteiro);

    return {
      data:          q.data,
      disponivel:    !resultado.conflito,
      conflito:      resultado,
      reunioes_dia:  reunioesDia,
      bloqueios:     bloqueiosDia,
      dia_bloqueado: diaBloqueado,
      slots:         GradeHorarios.montar(reunioesDia, diaBloqueado), // grade de 30 em 30 min
    };
  }

  /** Visão mensal: para cada dia, quantas reuniões e se está bloqueado. */
  async calendario(mesPedido: string | undefined) {
    const mes = Mes.daQuery(mesPedido, new Date().toISOString().slice(0, 7));
    const [reunioesMes, bloqueiosMes] = await Promise.all([
      this.reunioes.contagemPorDia(mes),
      this.bloqueios.doMes(mes),
    ]);
    const reunioesPorDia  = new Map(reunioesMes.map((r) => [String(r.dia), r]));
    const bloqueiosPorDia = new Map(bloqueiosMes.map((b) => [String(b.data), b]));

    const [ano, mesNum] = mes.split('-').map(Number);
    const diasNoMes = new Date(ano, mesNum, 0).getDate();
    const dias = [];
    for (let d = 1; d <= diasNoMes; d++) {
      const data = `${mes}-${String(d).padStart(2, '0')}`;
      dias.push({
        data,
        reunioes:  reunioesPorDia.get(data) || { total: 0, realizadas: 0, confirmadas: 0, agendadas: 0 },
        bloqueado: !!bloqueiosPorDia.get(data)?.dia_inteiro,
        bloqueio:  bloqueiosPorDia.get(data) || null,
      });
    }
    return { mes, dias };
  }

  /** Bloqueia o dia inteiro ou um intervalo de horário. */
  async bloquear(d: DadosBloqueio, quem: Gestor) {
    if (!d.data) throw new RequisicaoInvalida('Campo "data" obrigatório (YYYY-MM-DD).');
    if (!d.dia_inteiro && (!d.hora_inicio || !d.hora_fim)) {
      throw new RequisicaoInvalida('Para bloqueio parcial, informe hora_inicio e hora_fim.');
    }

    const novo = await this.bloqueios.criar({
      data:        d.data,
      horaInicio:  d.dia_inteiro ? null : d.hora_inicio,
      horaFim:     d.dia_inteiro ? null : d.hora_fim,
      diaInteiro:  !!d.dia_inteiro,
      motivo:      d.motivo || null,
      criadoPorId: quem.id,
    });
    return {
      ...novo,
      mensagem: d.dia_inteiro
        ? `Dia ${d.data} bloqueado.`
        : `Horário ${d.hora_inicio}–${d.hora_fim} do dia ${d.data} bloqueado.`,
    };
  }

  listarBloqueios(mes?: string) {
    return this.bloqueios.listar(mes);
  }

  async desbloquear(id: number): Promise<void> {
    if (!await this.bloqueios.buscarPorId(id)) throw new NaoEncontrado('Bloqueio não encontrado.');
    await this.bloqueios.remover(id);
  }

  /** Checagem rápida que o modal de reunião faz ao escolher data/hora. */
  async verificar(q: { data?: string; duracao?: string; reuniao_id?: string }): Promise<ResultadoConflito> {
    if (!q.data) throw new RequisicaoInvalida('Parâmetro "data" obrigatório (ISO 8601).');
    const inicio = new Date(q.data);
    if (isNaN(inicio.getTime())) throw new RequisicaoInvalida('Data inválida.');
    return this.verificador.verificar(
      inicio, parseInt(q.duracao || '60'), q.reuniao_id ? parseInt(q.reuniao_id) : undefined,
    );
  }
}
