import type { DisparoGrupo } from '../database/schema';

/** "HH:MM" de 00:00 a 23:59. */
export function horarioValido(valor: unknown): valor is string {
  return typeof valor === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(valor);
}

/** Lê `horarios_json` — sempre ordenado e sem repetido. */
export function lerHorarios(json: string | null): string[] {
  if (!json) return [];
  try {
    const lista = JSON.parse(json) as unknown;
    if (!Array.isArray(lista)) return [];
    return [...new Set(lista.filter(horarioValido))].sort();
  } catch {
    return [];
  }
}

const emMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Minutos desde a meia-noite **no fuso do disparo**.
 *
 * Não dá para usar `getHours()`: o servidor roda em UTC e o horário que o
 * gestor escolheu ("08:00") é de Brasília — daria 3 horas de diferença.
 */
function minutosNoFuso(data: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const [h, m] = fmt.format(data).split(':').map(Number);
  return h * 60 + m;
}

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Dia da semana (0 = domingo … 6 = sábado) **no fuso do disparo**.
 *
 * Mesmo motivo do `minutosNoFuso`: a VPS roda em UTC. Um envio de sexta às
 * 21:00 de Brasília é sábado 00:00 em UTC — `getDay()` diria "sábado" e o
 * disparo seria adiado sem necessidade.
 */
function diaDaSemanaNoFuso(data: Date, timezone: string): number {
  const dia = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(data);
  return DIAS.indexOf(dia);
}

/** Sábado ou domingo no fuso do disparo — dias em que nada pode sair. */
export function ehFimDeSemana(data: Date, timezone = 'America/Sao_Paulo'): boolean {
  const dia = diaDaSemanaNoFuso(data, timezone);
  return dia === 0 || dia === 6;
}

/**
 * Próxima data de envio: passa por todos os horários fixos do dia e só então
 * avança conforme a repetição. Retorna null quando não há mais envio (o
 * disparo é finalizado).
 *
 * Com horários [08:00, 18:00] e repetição diária: 08:00 → 18:00 → 08:00 do dia
 * seguinte. Sem repetição, sai nos horários do dia marcado e encerra.
 */
export function calcularProximoEnvio(disparo: DisparoGrupo, base: Date): Date | null {
  const referencia = disparo.proximoEnvio ? new Date(disparo.proximoEnvio) : base;
  const proximo    = new Date(referencia);
  const horarios   = lerHorarios(disparo.horariosJson);
  const timezone   = disparo.timezone || 'America/Sao_Paulo';

  /** Desloca por diferença de minutos — mexer na hora absoluta ignoraria o fuso. */
  const irPara = (hhmm: string) => {
    proximo.setMinutes(proximo.getMinutes() + (emMinutos(hhmm) - minutosNoFuso(proximo, timezone)));
  };

  /** Próximo horário fixo ainda por vir no mesmo dia. */
  const proximoNoMesmoDia = (): boolean => {
    if (horarios.length < 2) return false;
    const agora = minutosNoFuso(proximo, timezone);
    const seguinte = horarios.find((h) => emMinutos(h) > agora);
    if (!seguinte) return false;
    irPara(seguinte);
    return true;
  };

  const avancarOcorrencia = (): boolean => {
    switch (disparo.repetir) {
      case 'diario':  proximo.setDate(proximo.getDate() + 1);   break;
      case 'semanal': proximo.setDate(proximo.getDate() + 7);   break;
      case 'mensal':  proximo.setMonth(proximo.getMonth() + 1); break;
      default: return false;
    }
    // Recomeça o dia pelo primeiro horário da lista
    if (horarios.length > 0) irPara(horarios[0]);
    return true;
  };

  const avancar = (): boolean => proximoNoMesmoDia() || avancarOcorrencia();

  /**
   * Por padrão nada sai em sábado ou domingo (regra do dono, 11/09/2026): cai
   * no fim de semana, empurra para o próximo dia útil, no primeiro horário da
   * lista.
   *
   * Exceção: se o gestor liberou o fim de semana ao criar a campanha
   * (`permitirFimDeSemana`, migration 0044), a trava não se aplica e os envios
   * saem em qualquer dia. Só `true` libera — `undefined`/`false` mantêm a regra.
   *
   * Disparo que NÃO se repete não é empurrado — ele foi marcado para um dia
   * específico, e adiar para segunda seria postar num dia que o gestor não
   * escolheu. Nesse caso a campanha simplesmente encerra.
   */
  const pularFimDeSemana = (): boolean => {
    if (disparo.permitirFimDeSemana === true) return true;
    if (!ehFimDeSemana(proximo, timezone)) return true;
    if (disparo.repetir === 'nunca') return false;

    // No máximo 3 saltos (sáb → dom → seg); a trava é contra fuso maluco.
    for (let i = 0; i < 3 && ehFimDeSemana(proximo, timezone); i++) {
      proximo.setDate(proximo.getDate() + 1);
      if (horarios.length > 0) irPara(horarios[0]);
    }
    return !ehFimDeSemana(proximo, timezone);
  };

  /** Passou da data de término escolhida pelo gestor (null = sem término). */
  const passouDoFim = (): boolean =>
    disparo.repetirAte !== null && proximo.getTime() > new Date(disparo.repetirAte).getTime();

  if (!avancar()) return null;
  if (!pularFimDeSemana()) return null;
  if (passouDoFim()) return null;

  // Se a referência ficou no passado (ex.: serviço parado), avança até o futuro
  while (proximo.getTime() <= base.getTime()) {
    if (!avancar()) return null;
    if (!pularFimDeSemana()) return null;
    if (passouDoFim()) return null;
  }

  return proximo;
}
