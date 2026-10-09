import { ErroAplicacao } from '../compartilhado/erros';
import type { ReuniaoRepository } from '../reunioes/ReuniaoRepository';
import type { BloqueioRepository } from './BloqueioRepository';

export interface ResultadoConflito {
  conflito: boolean;
  tipo?: 'bloqueio' | 'sobreposicao';
  detalhe?: string;
  reuniao_conflitante?: { id: number; titulo: string; data_reuniao: string; duracao_minutos: number };
}

/** 409 ao marcar reunião em horário ocupado — a tela mostra com quem conflitou. */
export class HorarioOcupado extends ErroAplicacao {
  constructor(r: ResultadoConflito) {
    super(409, r.detalhe ?? 'Horário ocupado.', {}, {
      tipo_conflito:       r.tipo,
      reuniao_conflitante: r.reuniao_conflitante ?? null,
    });
  }
}

/**
 * Diz se um horário está livre. Checa, nesta ordem: (1) bloqueios da agenda
 * e (2) sobreposição com reuniões não canceladas. A agenda é uma só para a
 * agência inteira — não é por gestor.
 */
export class VerificadorConflito {
  constructor(
    private readonly bloqueios: BloqueioRepository,
    private readonly reunioes: ReuniaoRepository,
  ) {}

  async verificar(inicio: Date, duracaoMinutos: number, ignorarReuniaoId?: number): Promise<ResultadoConflito> {
    const fim     = new Date(inicio.getTime() + duracaoMinutos * 60_000);
    const data    = inicio.toISOString().split('T')[0];               // "YYYY-MM-DD"
    const horaIni = inicio.toISOString().split('T')[1].slice(0, 5);   // "HH:MM" UTC
    const horaFim = fim.toISOString().split('T')[1].slice(0, 5);

    const bloqueio = await this.bloqueios.primeiroNoIntervalo(data, horaIni, horaFim);
    if (bloqueio) {
      return {
        conflito: true,
        tipo:     'bloqueio',
        detalhe:  bloqueio.motivo ? `Agenda fechada: ${bloqueio.motivo}` : 'Agenda fechada neste horário.',
      };
    }

    const c = await this.reunioes.primeiraSobreposta(inicio, fim, ignorarReuniaoId);
    if (c) {
      const h = new Date(c.data_reuniao).toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      });
      return {
        conflito: true,
        tipo:     'sobreposicao',
        detalhe:  `Conflito com "${c.titulo}" às ${h}`,
        reuniao_conflitante: {
          id:              parseInt(c.id),
          titulo:          c.titulo,
          data_reuniao:    String(c.data_reuniao),
          duracao_minutos: parseInt(c.duracao_minutos),
        },
      };
    }

    return { conflito: false };
  }

  /** Como `verificar`, mas lança `HorarioOcupado` se houver conflito. */
  async exigirLivre(inicio: Date, duracaoMinutos: number, ignorarReuniaoId?: number): Promise<void> {
    const r = await this.verificar(inicio, duracaoMinutos, ignorarReuniaoId);
    if (r.conflito) throw new HorarioOcupado(r);
  }
}
