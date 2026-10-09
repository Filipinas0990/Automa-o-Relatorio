import type { Linha } from '../compartilhado/tipos';

export interface Slot {
  hora: string;
  disponivel: boolean;
}

const PRIMEIRA_HORA = 8;
const ULTIMA_HORA   = 18;
const PASSO_MIN     = 30;

function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Grade do dia de 08:00 às 18:00, em blocos de 30 min (UTC), marcando o que está livre. */
export class GradeHorarios {
  static montar(reunioesDoDia: Linha[], diaBloqueado: boolean): Slot[] {
    const ocupadas = new Set<string>();
    for (const r of reunioesDoDia) {
      const ini = new Date(r.data_reuniao);
      const fim = new Date(ini.getTime() + parseInt(r.duracao_minutos || 60) * 60_000);
      for (let t = new Date(ini); t < fim; t = new Date(t.getTime() + PASSO_MIN * 60_000)) {
        ocupadas.add(hhmm(t.getUTCHours(), t.getUTCMinutes()));
      }
    }

    const slots: Slot[] = [];
    for (let h = PRIMEIRA_HORA; h < ULTIMA_HORA; h++) {
      for (let m = 0; m < 60; m += PASSO_MIN) {
        const hora = hhmm(h, m);
        slots.push({ hora, disponivel: !diaBloqueado && !ocupadas.has(hora) });
      }
    }
    return slots;
  }
}
