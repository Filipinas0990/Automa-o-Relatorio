// Regras puras do custo por resultado: janelas de datas e leitura do Insights.
// Sem banco e sem rede, para poder ser testado direto.

/** As únicas janelas que o sistema puxa. */
export const JANELAS = [7, 15, 30] as const;
export type Janela = typeof JANELAS[number];

/**
 * O único resultado que conta: conversa iniciada no WhatsApp. O custo é só das
 * campanhas que levam para o WhatsApp (destino do conjunto = WHATSAPP); lead de
 * formulário, compra no site e tráfego não entram nem no gasto nem nos resultados.
 */
export const ACAO_WHATSAPP   = 'onsite_conversion.messaging_conversation_started_7d';
export const ROTULO_WHATSAPP = 'Conversas no WhatsApp';

/**
 * Destino do conjunto que leva para o WhatsApp: "WHATSAPP" e também os de
 * vários destinos que incluem o WhatsApp
 * ("MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP", "MESSAGING_MESSENGER_WHATSAPP"...).
 */
export const levaParaWhatsapp = (destino: string | undefined): boolean => !!destino?.includes('WHATSAPP');

/** Linha do /insights no nível de campanha (a Graph API devolve tudo como string). */
export interface InsightLinha {
  campaign_id?: string;
  spend?:       string;
  clicks?:      string;
  impressions?: string;
  actions?:     Array<{ action_type: string; value: string }>;
}

export interface ResumoJanela {
  gasto:             number;
  resultados:        number;
  /** gasto / resultados; null quando não houve resultado. */
  custoPorResultado: number | null;
  tipoResultado:     string | null;
  cliques:           number;
  impressoes:        number;
}

export interface PeriodoJanela { inicio: string; fim: string }

const arredondar = (n: number): number => Math.round(n * 100) / 100;

/** Data "YYYY-MM-DD" no fuso de Brasília — a mesma que o gestor vê no calendário. */
function dataBrasilia(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Período da janela, terminando ONTEM (hoje tem dado parcial e distorceria o
 * custo). 7 dias = ontem-6 até ontem; 15 = ontem-14; 30 = ontem-29.
 */
export function periodoDaJanela(dias: Janela, agora: Date = new Date()): PeriodoJanela {
  const fim = somarDias(dataBrasilia(agora), -1);
  return { inicio: somarDias(fim, -(dias - 1)), fim };
}

/** Data de hoje em Brasília e hora cheia (0–23) — usado pelo agendamento das 06:00. */
export function agoraBrasilia(agora: Date = new Date()): { data: string; hora: number } {
  const hora = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false,
  }).format(agora));
  return { data: dataBrasilia(agora), hora: hora === 24 ? 0 : hora };
}

/** Data (Brasília) em que um instante caiu. */
export const diaBrasilia = dataBrasilia;

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Junta as campanhas de WhatsApp da conta numa janela só.
 *
 * Campanhas fora de  são ignoradas por completo. O gasto de
 * TODAS as de WhatsApp entra, inclusive das que não geraram conversa: dinheiro
 * sem retorno é justamente o que o painel precisa mostrar.
 */
export function resumirCampanhas(linhas: InsightLinha[], campanhasWhatsapp: Set<string>): ResumoJanela {
  let gasto = 0, cliques = 0, impressoes = 0, resultados = 0;

  for (const l of linhas) {
    if (!l.campaign_id || !campanhasWhatsapp.has(l.campaign_id)) continue;
    gasto      += num(l.spend);
    cliques    += num(l.clicks);
    impressoes += num(l.impressions);
    resultados += num((l.actions ?? []).find((a) => a.action_type === ACAO_WHATSAPP)?.value);
  }

  gasto = arredondar(gasto);
  return {
    gasto,
    resultados,
    custoPorResultado: resultados > 0 ? arredondar(gasto / resultados) : null,
    tipoResultado:     resultados > 0 ? ROTULO_WHATSAPP : null,
    cliques,
    impressoes,
  };
}
