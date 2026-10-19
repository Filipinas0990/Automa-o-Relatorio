import type { Gestor } from '../database/schema';
import { logger } from '../logger';
import { metaReq, listarContasDeAnuncio } from '../meta/client';
import { tokenProprioDo, msgTokenExpirado } from '../meta/tokenGestor';
import {
  JANELAS, periodoDaJanela, resumirCampanhas, agoraBrasilia, diaBrasilia, levaParaWhatsapp,
  type Janela, type InsightLinha,
} from './calculo';
import { vincularContas, type ContaParaVincular } from './vinculo';
import type { CustoResultadoRepository, FarmaciaAtiva, LinhaCusto } from './CustoResultadoRepository';

/** Hora (Brasília) a partir da qual a rodada do dia pode acontecer. */
export const HORA_DO_JOB = 6;

/** Erros de limite de requisições do Meta: vale esperar e tentar de novo. */
const ERRO_LIMITE = /\[(4|17|32|613)\]/;
const TENTATIVAS  = 3;

const esperar = (ms: number) => ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * `semFachada`: farmácias ativas sem nome de fachada — ficam fora do painel.
 * `semConta`: das que têm fachada, as sem conta vinculada ou cuja conta nenhum
 * gestor conectado enxerga.
 */
export interface ResumoExecucao { farmaciasOk: number; farmaciasErro: number; semConta: number; semFachada: number }

const temFachada = (f: { nomeFachada: string | null }): boolean => !!f.nomeFachada?.trim();

/** Um gestor conectado e as contas que o token dele enxerga. */
interface TokenComContas { gestorId: number; token: string; contas: ContaParaVincular[] }

/** O que ler de uma farmácia: a conta dela e um token que a enxerga. */
interface LeituraFarmacia { farmaciaId: number; adAccountId: string; token: string }

/**
 * Decide com qual token ler a conta vinculada de cada farmácia (uma conta por
 * cliente, gravada no cadastro — migration 0040).
 *
 * Token: o do gestor da farmácia, se ele enxerga a conta; senão o de outro
 * gestor conectado que enxerga (a conta de uma farmácia do Victor pode estar no
 * token do Mathews). Conta que nenhum token enxerga não é lida.
 */
export function montarLeituras(farmacias: FarmaciaAtiva[], tokens: TokenComContas[]): LeituraFarmacia[] {
  const quemEnxerga = new Map<string, TokenComContas[]>();
  for (const t of tokens) {
    for (const c of t.contas) quemEnxerga.set(c.id, [...(quemEnxerga.get(c.id) ?? []), t]);
  }

  return farmacias.flatMap((f) => {
    if (!f.metaAdAccountId) return [];
    const quem = quemEnxerga.get(f.metaAdAccountId) ?? [];
    const t = quem.find((x) => x.gestorId === f.gestorId) ?? quem[0];
    return t ? [{ farmaciaId: f.id, adAccountId: f.metaAdAccountId, token: t.token }] : [];
  });
}

/**
 * Entre as contas que casaram pelo nome, a sugerida é a CA01 (a principal do
 * cliente); sem CA01, a primeira.
 */
export function escolherSugerida(contas: ContaParaVincular[]): string | null {
  const ca01 = contas.find((c) => /^\s*\[?\s*CA\s*-?\s*[O0]?1(?!\d)/i.test(c.nome));
  return (ca01 ?? contas[0])?.id ?? null;
}

/** Conta como aparece na lista do cadastro, e de qual farmácia ela já é. */
export interface ContaDisponivel {
  id:            string;
  nome:          string;
  farmacia_id:   number | null;
  farmacia_nome: string | null;
}

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
    /** Contas de anúncio que um token enxerga (no Meta, /me/adaccounts). */
    private readonly listarContas: (token: string) => Promise<ContaParaVincular[]> = listarContasDeAnuncio,
  ) {}

  /** Lê e grava todas as farmácias com conta de anúncios. Uma falhar não para as outras. */
  async sincronizarTodas(agora: Date = new Date()): Promise<ResumoExecucao> {
    if (this.rodando) {
      logger.warn('Custo por resultado: rodada anterior ainda em andamento — ignorando');
      return { farmaciasOk: 0, farmaciasErro: 0, semConta: 0, semFachada: 0 };
    }
    this.rodando = true;
    try {
      const [farmacias, tokens] = await Promise.all([this.repo.farmaciasAtivas(), this.tokensConectados()]);
      // Farmácia sem nome de fachada não entra no painel até o gestor preencher
      // (decisão do dono em 19/10/2026) — nem é lida no Meta.
      const comFachada  = farmacias.filter(temFachada);
      const semFachada  = farmacias.length - comFachada.length;
      const leituras    = montarLeituras(comFachada, tokens);
      const semConta    = comFachada.length - leituras.length;

      // Farmácia que não tem mais conta legível sai do painel (nada de número velho).
      await this.repo.manterSo(leituras.map((l) => l.farmaciaId));

      let farmaciasOk = 0, farmaciasErro = 0;
      for (const [i, leitura] of leituras.entries()) {
        if (i > 0) await esperar(this.pausaEntreContasMs);
        try {
          await this.sincronizarFarmacia(leitura, agora);
          farmaciasOk++;
        } catch (err) {
          farmaciasErro++;
          const msg = (err as Error).message;
          logger.error({ farmaciaId: leitura.farmaciaId, err: msg }, 'Custo por resultado: falha ao ler a conta');
          await this.repo.registrarErro(leitura.farmaciaId, msg);
        }
      }

      await this.repo.registrarExecucao(farmaciasOk, farmaciasErro, agora);
      logger.info({ farmaciasOk, farmaciasErro, semConta, semFachada }, 'Custo por resultado: rodada concluída');
      return { farmaciasOk, farmaciasErro, semConta, semFachada };
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Contas para o campo "Conta de anúncios Meta" do cadastro: todas as que os
   * gestores conectados enxergam, cada uma com a farmácia que já a usa. Com
   * `farmaciaId`, sugere a conta dessa farmácia pelo nome (CA01 primeiro),
   * entre as que ainda não têm dono.
   */
  async contasDisponiveis(farmaciaId?: number): Promise<{ contas: ContaDisponivel[]; sugerida: string | null }> {
    const [tokens, farmacias] = await Promise.all([this.tokensConectados(), this.repo.farmaciasComConta()]);
    const donos = new Map(farmacias.map((f) => [f.metaAdAccountId, f]));

    const porId = new Map<string, ContaParaVincular>();
    for (const t of tokens) for (const c of t.contas) porId.set(c.id, c);
    const contas = [...porId.values()]
      .map((c) => {
        const dono = donos.get(c.id);
        return { id: c.id, nome: c.nome, farmacia_id: dono?.id ?? null, farmacia_nome: dono ? dono.nomeFachada || dono.nome : null };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    let sugerida: string | null = null;
    if (farmaciaId) {
      const alvo = await this.repo.farmaciaParaVincular(farmaciaId);
      const livres = contas.filter((c) => c.farmacia_id === null);
      if (alvo) {
        const casadas = vincularContas(livres, [alvo]).porFarmacia.get(alvo.id) ?? [];
        sugerida = escolherSugerida(livres.filter((c) => casadas.includes(c.id)));
      }
    }
    return { contas, sugerida };
  }

  /**
   * Contas de anúncio que cada gestor conectado enxerga. Só tokens próprios —
   * NUNCA o token geral do servidor. Gestor cujo token falhou fica de fora
   * (as contas dele podem estar no token de outro).
   */
  private async tokensConectados(): Promise<TokenComContas[]> {
    const gestores = await this.repo.gestoresConectados();
    const resultado: TokenComContas[] = [];

    for (const g of gestores) {
      const token = tokenProprioDo(g);
      if (!token) continue;
      try {
        const contas = await this.comRetentativa(() => this.listarContas(token));
        resultado.push({ gestorId: g.id, token, contas });
      } catch (err) {
        logger.warn({ gestorId: g.id, err: (err as Error).message }, 'Custo por resultado: não deu para listar as contas do gestor');
      }
    }
    return resultado;
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

  /** A conta da farmácia, nas três janelas. Qualquer erro sobe e marca a farmácia como falha. */
  private async sincronizarFarmacia(leitura: LeituraFarmacia, agora: Date): Promise<void> {
    const { farmaciaId, adAccountId, token } = leitura;
    const campanhasWhatsapp = await this.campanhasWhatsapp(adAccountId, token);

    for (const dias of JANELAS) {
      const periodo = periodoDaJanela(dias, agora);
      const linhas  = await this.lerInsights(adAccountId, token, periodo);
      await this.repo.salvar(farmaciaId, dias, periodo, resumirCampanhas(linhas, campanhasWhatsapp));
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
        if (levaParaWhatsapp(c.destination_type) && c.campaign_id) ids.add(c.campaign_id);
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
