import type { Gestor } from '../database/schema';
import { logger } from '../logger';
import { metaReq } from '../meta/client';
import { tokenProprioDo, msgTokenExpirado } from '../meta/tokenGestor';
import {
  JANELAS, periodoDaJanela, resumirCampanhas, agoraBrasilia, diaBrasilia,
  type Janela, type InsightLinha,
} from './calculo';
import type { ContaParaSincronizar, CustoResultadoRepository, LinhaCusto } from './CustoResultadoRepository';

/** Hora (Brasília) a partir da qual a rodada do dia pode acontecer. */
export const HORA_DO_JOB = 6;

/** Erros de limite de requisições do Meta: vale esperar e tentar de novo. */
const ERRO_LIMITE = /\[(4|17|32|613)\]/;
const TENTATIVAS  = 3;

const esperar = (ms: number) => ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

export interface ResumoExecucao { farmaciasOk: number; farmaciasErro: number; semToken: number }

interface PaginaInsights {
  data?:   InsightLinha[];
  paging?: { cursors?: { after?: string }; next?: string };
}

interface PaginaAdsets {
  data?:   Array<{ campaign_id?: string; destination_type?: string }>;
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Custo por resultado do Meta Ads: lê o gasto e os resultados de cada farmácia
 * nos últimos 7, 15 e 30 dias (sempre até ontem) e guarda o custo por resultado — só das campanhas que levam para o WhatsApp.
 */
export class CustoResultadoService {
  private rodando = false;

  constructor(
    private readonly repo: CustoResultadoRepository,
    /** Pausa entre farmácias, para não estourar o limite de requisições do Meta. */
    private readonly pausaEntreContasMs: number = Number(process.env.CUSTO_META_PAUSA_MS ?? 1500),
  ) {}

  /** Lê e grava todas as farmácias com conta de anúncios. Uma falhar não para as outras. */
  async sincronizarTodas(agora: Date = new Date()): Promise<ResumoExecucao> {
    if (this.rodando) {
      logger.warn('Custo por resultado: rodada anterior ainda em andamento — ignorando');
      return { farmaciasOk: 0, farmaciasErro: 0, semToken: 0 };
    }
    this.rodando = true;
    try {
      const todas = await this.repo.contasParaSincronizar();
      let farmaciasOk = 0, farmaciasErro = 0;

      // Cada gestor lê com o PRÓPRIO token. Farmácia cujo gestor não conectou o
      // Facebook (ou cuja conexão expirou) não é lida e não aparece no painel:
      // o que havia de leituras antigas dela é apagado.
      const contas: Array<{ conta: ContaParaSincronizar; token: string }> = [];
      const semToken: number[] = [];
      for (const conta of todas) {
        const token = tokenProprioDo(conta.gestor);
        if (token) contas.push({ conta, token }); else semToken.push(conta.farmaciaId);
      }
      await this.repo.limparFarmacias(semToken);

      for (const [i, { conta, token }] of contas.entries()) {
        if (i > 0) await esperar(this.pausaEntreContasMs);
        try {
          await this.sincronizarConta(conta, token, agora);
          farmaciasOk++;
        } catch (err) {
          farmaciasErro++;
          const msg = (err as Error).message;
          logger.error({ farmaciaId: conta.farmaciaId, err: msg }, 'Custo por resultado: falha ao ler a conta');
          await this.repo.registrarErro(conta.farmaciaId, msg);
        }
      }

      await this.repo.registrarExecucao(farmaciasOk, farmaciasErro);
      logger.info({ farmaciasOk, farmaciasErro, semToken: semToken.length }, 'Custo por resultado: rodada concluída');
      return { farmaciasOk, farmaciasErro, semToken: semToken.length };
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Chamado pelo scheduler a cada minuto: roda uma vez por dia, a partir das
   * 06:00 de Brasília. Se a API estava fora às 06:00, a rodada acontece assim
   * que ela volta; se já rodou hoje, não repete (mesmo após reinício).
   */
  async rodarSeForAHora(agora: Date = new Date()): Promise<ResumoExecucao | null> {
    const { data, hora } = agoraBrasilia(agora);
    if (hora < HORA_DO_JOB) return null;

    const ultima = await this.repo.ultimaExecucao();
    if (ultima && diaBrasilia(ultima.executadoEm) === data) return null;

    return this.sincronizarTodas(agora);
  }

  /** Uma conta, as três janelas. Qualquer erro sobe e marca a farmácia como falha. */
  private async sincronizarConta(conta: ContaParaSincronizar, token: string, agora: Date): Promise<void> {
    const campanhasWhatsapp = await this.campanhasWhatsapp(conta.adAccountId, token);

    for (const dias of JANELAS) {
      const periodo = periodoDaJanela(dias, agora);
      const linhas  = await this.lerInsights(conta.adAccountId, token, periodo);
      await this.repo.salvar(conta.farmaciaId, dias, periodo, resumirCampanhas(linhas, campanhasWhatsapp));
    }
  }

  /**
   * IDs das campanhas que levam para o WhatsApp: as que têm algum conjunto com
   * destino WHATSAPP. O Insights não informa o destino, então vem dos conjuntos.
   */
  private async campanhasWhatsapp(adAccountId: string, token: string): Promise<Set<string>> {
    const ids = new Set<string>();
    let after: string | undefined;

    do {
      const params: Record<string, string> = { fields: 'campaign_id,destination_type', limit: '500' };
      if (after) params.after = after;

      const pagina = await this.comRetentativa(() =>
        metaReq<PaginaAdsets>('GET', `/${adAccountId}/adsets`, token, params),
      );

      for (const c of pagina.data ?? []) {
        if (c.destination_type === 'WHATSAPP' && c.campaign_id) ids.add(c.campaign_id);
      }
      after = pagina.paging?.next ? pagina.paging.cursors?.after : undefined;
    } while (after);

    return ids;
  }

  /** Insights por campanha no período, seguindo a paginação e tentando de novo no limite do Meta. */
  private async lerInsights(
    adAccountId: string, token: string, periodo: { inicio: string; fim: string },
  ): Promise<InsightLinha[]> {
    const linhas: InsightLinha[] = [];
    let after: string | undefined;

    do {
      const params: Record<string, string> = {
        fields:     'campaign_id,spend,clicks,impressions,actions',
        level:      'campaign',
        time_range: JSON.stringify({ since: periodo.inicio, until: periodo.fim }),
        limit:      '500',
      };
      if (after) params.after = after;

      const pagina = await this.comRetentativa(() =>
        metaReq<PaginaInsights>('GET', `/${adAccountId}/insights`, token, params),
      );

      linhas.push(...(pagina.data ?? []));
      after = pagina.paging?.next ? pagina.paging.cursors?.after : undefined;
    } while (after);

    return linhas;
  }

  private async comRetentativa<T>(fn: () => Promise<T>): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await fn();
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'META_TOKEN_EXPIRADO') throw new Error(msgTokenExpirado(true));
        if (tentativa >= TENTATIVAS || !ERRO_LIMITE.test(msg)) throw err;
        await esperar(this.pausaEntreContasMs * 4 * tentativa);
      }
    }
  }

  // ── Leitura para a API ─────────────────────────────────────────────────────

  /**
   * Custo por resultado por farmácia, com as três janelas lado a lado.
   * Gestor comum vê só as dele; admin vê todas (ou filtra por `gestorPedido`).
   */
  async listar(quem: Gestor, gestorPedido?: string) {
    const gestorId = quem.isAdmin ? (gestorPedido ? parseInt(gestorPedido, 10) : null) : quem.id;
    const [linhas, execucao] = await Promise.all([this.repo.listar(gestorId), this.repo.ultimaExecucao()]);

    const porFarmacia = new Map<number, LinhaCusto[]>();
    for (const l of linhas) porFarmacia.set(l.farmaciaId, [...(porFarmacia.get(l.farmaciaId) ?? []), l]);

    const farmacias = [...porFarmacia.entries()].map(([farmaciaId, ls]) => {
      const janela = (dias: Janela) => {
        const l = ls.find((x) => x.janelaDias === dias);
        return l && {
          periodo_inicio:      l.periodoInicio,
          periodo_fim:         l.periodoFim,
          gasto:               parseFloat(l.gasto),
          resultados:          l.resultados,
          custo_por_resultado: l.custoPorResultado == null ? null : parseFloat(l.custoPorResultado),
          tipo_resultado:      l.tipoResultado,
          cliques:             l.cliques,
          impressoes:          l.impressoes,
        };
      };
      return {
        farmacia_id:     farmaciaId,
        farmacia:        ls[0].farmaciaNome,
        gestor_id:       ls[0].gestorId,
        janela_7d:       janela(7)  ?? null,
        janela_15d:      janela(15) ?? null,
        janela_30d:      janela(30) ?? null,
        erro:            ls.find((x) => x.erro)?.erro ?? null,
        sincronizado_em: ls.reduce<Date | null>((m, x) => !m || x.sincronizadoEm > m ? x.sincronizadoEm : m, null),
      };
    }).sort((a, b) => a.farmacia.localeCompare(b.farmacia, 'pt-BR'));

    return { ultima_execucao: execucao?.executadoEm ?? null, farmacias };
  }
}
