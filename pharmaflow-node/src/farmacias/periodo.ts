import { somarDias } from '../custo/calculo';
import { RequisicaoInvalida } from '../compartilhado/erros';

/** Período livre escolhido na tela (mês fechado ou de/até), datas "AAAA-MM-DD". */
export interface Intervalo { inicio: string; fim: string }

/** Maior período aceito: cobre um trimestre fechado. */
export const MAX_DIAS_INTERVALO = 93;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function diasNoIntervalo({ inicio, fim }: Intervalo): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Lê `inicio`/`fim` da query; null quando nenhum veio (a tela usa as janelas 7/15/30). */
export function lerIntervalo(inicio?: string, fim?: string): Intervalo | null {
  if (!inicio && !fim) return null;
  if (!inicio || !fim || !DATA.test(inicio) || !DATA.test(fim)) {
    throw new RequisicaoInvalida('Informe inicio e fim no formato AAAA-MM-DD');
  }
  if (inicio > fim) throw new RequisicaoInvalida('A data inicial é depois da final');
  if (diasNoIntervalo({ inicio, fim }) > MAX_DIAS_INTERVALO) {
    throw new RequisicaoInvalida(`Escolha um período de até ${MAX_DIAS_INTERVALO} dias`);
  }
  return { inicio, fim };
}

const ultimoDiaDoMes = (ano: number, mes: number) =>
  new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);

/** O intervalo é exatamente um mês do calendário (do dia 1 ao último dia)? */
function mesFechado({ inicio, fim }: Intervalo): boolean {
  const [ano, mes, dia] = inicio.split('-').map(Number);
  return dia === 1 && fim === ultimoDiaDoMes(ano, mes);
}

/**
 * Período de comparação: mês fechado compara com o mês anterior inteiro
 * (setembro × agosto); qualquer outro, com os mesmos N dias logo antes.
 */
export function intervaloAnterior(atual: Intervalo): Intervalo {
  if (mesFechado(atual)) {
    const fim = somarDias(atual.inicio, -1);
    return { inicio: `${fim.slice(0, 8)}01`, fim };
  }
  const n = diasNoIntervalo(atual);
  return { inicio: somarDias(atual.inicio, -n), fim: somarDias(atual.inicio, -1) };
}
