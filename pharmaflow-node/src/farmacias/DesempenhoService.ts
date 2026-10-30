import type { Gestor } from '../database/schema';
import { Proibido } from '../compartilhado/erros';
import { AgregadorCanais } from './AgregadorCanais';
import type { Linha } from '../compartilhado/tipos';
import type { DesempenhoRepository, LinhaDiariaSomada } from './DesempenhoRepository';
import type { FarmaciaRepository } from './FarmaciaRepository';
import { calcularScore } from '../processor/score';
import { metricas, porOrigem, somar } from '../coleta/metricas';
import { intervaloAnterior, lerIntervalo, type Intervalo } from './periodo';

export interface FiltrosDesempenho {
  dias?: string;
  /** Só o admin escolhe; gestor comum sempre vê só as dele. */
  gestor_id?: string;
  status?: string;
  busca?: string;
  fase?: string;
  /** Período livre (mês fechado, de/até): soma a coleta diária e ignora `dias`. */
  inicio?: string;
  fim?: string;
}

/** Linhas de ranking + canais por farmácia, venham das janelas ou do período livre. */
interface Ranking {
  rows:   Linha[];
  canais: Map<number, AgregadorCanais>;
}

const ROTULO_ALERTA: Record<string, string> = { verde: 'Ativa', amarelo: 'Atencao', vermelho: 'Alerta' };

/** Indicadores das farmácias: painel geral, listagem com metas e evolução semanal. */
export class DesempenhoService {
  constructor(
    private readonly desempenho: DesempenhoRepository,
    private readonly farmacias: FarmaciaRepository,
  ) {}

  async painel(quem: Gestor, filtros: FiltrosDesempenho) {
    const gestorId  = this.escopo(quem, filtros);
    const intervalo = lerIntervalo(filtros.inicio, filtros.fim);
    const rows      = intervalo
      ? (await this.rankingDoIntervalo(intervalo, gestorId, null)).rows.filter((r) => r.posicao_ranking < 9999)
      : await this.desempenho.rankingAtual(this.dias(filtros), gestorId);

    if (!rows.length) {
      return {
        receita_total: 0, total_atendimentos: 0, vendas_realizadas: 0,
        farmacias_ativas: 0, farmacias_alerta: 0, farmacias_atencao: 0,
        taxa_conversao_media: 0, ultima_atualizacao: null, canais: [],
      };
    }

    const receitaTotal      = rows.reduce((s, r) => s + parseFloat(r.receita_total || 0), 0);
    const totalAtendimentos = rows.reduce((s, r) => s + parseInt(r.total_atendimentos || 0), 0);
    const vendasRealizadas  = rows.reduce((s, r) => s + parseInt(r.vendas_realizadas || 0), 0);
    const conversoes = rows
      .filter((r) => parseFloat(r.total_atendimentos || 0) > 0)
      .map((r) => parseFloat(r.vendas_realizadas || 0) / parseFloat(r.total_atendimentos) * 100);
    const taxaMedia = conversoes.length
      ? Math.round(conversoes.reduce((a, b) => a + b, 0) / conversoes.length * 100) / 100 : 0;
    const ultimaAtualizacao = rows.reduce<unknown>(
      (max, r) => !max || r.data_coleta > (max as Date) ? r.data_coleta : max, null,
    );

    const canais = new AgregadorCanais();
    const linhasCanais = intervalo
      ? paraLinhasCanal(await this.desempenho.somaDiaria(intervalo.inicio, intervalo.fim, gestorId))
      : await this.desempenho.canaisSomados(this.dias(filtros), gestorId);
    for (const linha of linhasCanais) canais.somar(linha);

    return {
      receita_total:        Math.round(receitaTotal * 100) / 100,
      total_atendimentos:   totalAtendimentos,
      vendas_realizadas:    vendasRealizadas,
      farmacias_ativas:     rows.length,
      farmacias_alerta:     rows.filter((r) => r.nivel_alerta === 'vermelho').length,
      farmacias_atencao:    rows.filter((r) => r.nivel_alerta === 'amarelo').length,
      taxa_conversao_media: taxaMedia,
      ultima_atualizacao:   ultimaAtualizacao,
      canais:               canais.resumo(),
    };
  }

  /** Farmácias ativas com ranking, metas e canais de cada uma. */
  async listar(quem: Gestor, filtros: FiltrosDesempenho) {
    const gestorId  = this.escopo(quem, filtros);
    const intervalo = lerIntervalo(filtros.inicio, filtros.fim);
    const { status, busca } = filtros;

    const { rows, canais } = intervalo
      ? await this.rankingDoIntervalo(intervalo, gestorId, filtros.fase || null)
      : await this.rankingDasJanelas(this.dias(filtros), gestorId, filtros.fase || null);

    const resultado = [];
    for (const r of rows) {
      const labelStatus = ROTULO_ALERTA[r.nivel_alerta] || 'Ativa';
      if (status && labelStatus.toLowerCase() !== status.toLowerCase()) continue;
      if (busca  && !r.farmacia.toLowerCase().includes(busca.toLowerCase())) continue;

      const fid          = parseInt(r.farmacia_id);
      const receitaAtual = parseFloat(r.receita_total || 0);
      const vendasAtual  = parseInt(r.vendas_realizadas || 0);
      const metaV        = r.meta_vendas  ? parseInt(r.meta_vendas)    : null;
      const metaR        = r.meta_receita ? parseFloat(r.meta_receita) : null;

      resultado.push({
        id: fid, nome: r.farmacia, nome_fachada: r.nome_fachada ?? null,
        meta_ad_account_id: r.meta_ad_account_id ?? null,
        status: labelStatus, nivel_alerta: r.nivel_alerta,
        fase: r.fase ?? 'ativo',
        telefone:    r.telefone    ?? null,
        responsavel: r.responsavel ?? null,
        cidade:      r.cidade      ?? null,
        gestor_id: r.gestor_id, receita_total: receitaAtual,
        total_atendimentos: parseInt(r.total_atendimentos || 0),
        atendimentos_finalizados: 0,
        vendas_realizadas: vendasAtual, taxa_conversao: 0,
        variacao_receita:      parseFloat(r.variacao_receita || 0),
        variacao_atendimentos: 0,
        variacao_vendas:       parseFloat(r.variacao_vendas || 0),
        score_criticidade:     parseFloat(r.score_criticidade || 0),
        posicao_ranking:       parseInt(r.posicao_ranking),
        periodo_inicio: r.periodo_inicio ? String(r.periodo_inicio) : null,
        periodo_fim:    r.periodo_fim    ? String(r.periodo_fim)    : null,
        data_coleta: r.data_coleta,
        meta_vendas: metaV, meta_receita: metaR,
        meta_leads_google: r.meta_leads_google ? parseInt(r.meta_leads_google) : null,
        meta_leads_meta:   r.meta_leads_meta   ? parseInt(r.meta_leads_meta)   : null,
        ...this.avaliarMeta(receitaAtual, vendasAtual, metaR, metaV),
        tem_chatbot: r.tem_chatbot !== false,
        canais: canais.get(fid)?.resumo() ?? [],
      });
    }
    return resultado;
  }

  /** Limites do seletor de período: primeiro e último dia com coleta. */
  periodoDisponivel() {
    return this.desempenho.periodoDisponivel();
  }

  /** Gestor comum só vê a evolução das farmácias dele. */
  async evolucao(quem: Gestor, farmaciaId: number, dias: string | undefined): Promise<Linha[]> {
    if (!quem.isAdmin && !await this.farmacias.buscarDoGestor(farmaciaId, quem.id)) {
      throw new Proibido('Acesso negado a esta farmácia');
    }
    return this.desempenho.evolucaoSemanal(farmaciaId, parseInt(dias || '7', 10));
  }

  /**
   * Com as duas metas definidas, atingir exige bater as duas. Sem nenhuma,
   * `atingiu_meta` fica null (não dá para dizer).
   */
  private avaliarMeta(receita: number, vendas: number, metaR: number | null, metaV: number | null) {
    let atingiu: boolean | null = null, pctReceita = 0, pctVendas = 0;
    if (metaR) {
      pctReceita = Math.round(receita / metaR * 1000) / 10;
      atingiu    = receita >= metaR;
    }
    if (metaV) {
      pctVendas = Math.round(vendas / metaV * 1000) / 10;
      atingiu   = atingiu === null ? vendas >= metaV : atingiu && (vendas >= metaV);
    }
    return { atingiu_meta: atingiu, percentual_meta_receita: pctReceita, percentual_meta_vendas: pctVendas };
  }

  private async rankingDasJanelas(dias: number, gestorId: string | null, fase: string | null): Promise<Ranking> {
    const [rows, canais] = await Promise.all([
      this.desempenho.farmaciasComRanking(dias, gestorId, fase),
      this.canaisPorFarmacia(dias, gestorId),
    ]);
    return { rows, canais };
  }

  /**
   * Período livre: soma a coleta diária de cada farmácia e calcula o score
   * comparando com o período anterior (mês fechado × mês anterior; de/até ×
   * os mesmos N dias antes). Mesma ordem do ranking das janelas: maior score
   * primeiro, empate divide a posição; sem movimento vai para o fim (9999).
   */
  private async rankingDoIntervalo(intervalo: Intervalo, gestorId: string | null, fase: string | null): Promise<Ranking> {
    const anterior = intervaloAnterior(intervalo);
    const [farmacias, atual, antes] = await Promise.all([
      this.desempenho.farmaciasDoEscopo(gestorId, fase),
      this.desempenho.somaDiaria(intervalo.inicio, intervalo.fim, gestorId),
      this.desempenho.somaDiaria(anterior.inicio, anterior.fim, gestorId),
    ]);
    const atualDe = agruparPorFarmacia(atual);
    const antesDe = agruparPorFarmacia(antes);

    const canais = new Map<number, AgregadorCanais>();
    const rows: Linha[] = farmacias.map((f) => {
      const id = Number(f.farmacia_id);
      const doPeriodo = atualDe.get(id) ?? [];
      const base = { ...f, periodo_inicio: intervalo.inicio, periodo_fim: intervalo.fim, data_coleta: null };
      if (!doPeriodo.length) {
        return {
          ...base, nivel_alerta: 'verde', receita_total: 0, total_atendimentos: 0, vendas_realizadas: 0,
          variacao_receita: 0, variacao_vendas: 0, score_criticidade: 0, posicao_ranking: 9999,
        };
      }
      const origens = porOrigem(doPeriodo);
      const doAnterior = antesDe.get(id) ?? [];
      const score = calcularScore(metricas(origens), doAnterior.length ? metricas(porOrigem(doAnterior)) : null);
      const total = somar([...origens.values()]);

      const agregador = new AgregadorCanais();
      for (const linha of paraLinhasCanal(doPeriodo)) agregador.somar(linha);
      canais.set(id, agregador);

      return {
        ...base,
        nivel_alerta:       score.nivelAlerta,
        receita_total:      Math.round(total.receita * 100) / 100,
        total_atendimentos: total.atendimentos,
        vendas_realizadas:  total.vendas,
        variacao_receita:   score.variacaoReceita,
        variacao_vendas:    score.variacaoVendas,
        score_criticidade:  score.scoreCriticidade,
        posicao_ranking:    0,
      };
    });

    const comDados = rows.filter((r) => r.posicao_ranking === 0)
      .sort((a, b) => b.score_criticidade - a.score_criticidade);
    comDados.forEach((r, i) => {
      const empatado = i > 0 && comDados[i - 1].score_criticidade === r.score_criticidade;
      r.posicao_ranking = empatado ? comDados[i - 1].posicao_ranking : i + 1;
    });
    rows.sort((a, b) => a.posicao_ranking - b.posicao_ranking);
    return { rows, canais };
  }

  private async canaisPorFarmacia(dias: number, gestorId: string | null): Promise<Map<number, AgregadorCanais>> {
    const porFarmacia = new Map<number, AgregadorCanais>();
    for (const linha of await this.desempenho.canaisPorFarmacia(dias, gestorId)) {
      const fid = parseInt(linha.farmacia_id);
      if (!porFarmacia.has(fid)) porFarmacia.set(fid, new AgregadorCanais());
      porFarmacia.get(fid)!.somar(linha);
    }
    return porFarmacia;
  }

  /** Admin vê todas (ou filtra por gestor); gestor comum vê só as dele. */
  private escopo(quem: Gestor, filtros: FiltrosDesempenho): string | null {
    return quem.isAdmin ? (filtros.gestor_id || null) : String(quem.id);
  }

  private dias(filtros: FiltrosDesempenho): number {
    return parseInt(filtros.dias || '7', 10);
  }
}

function agruparPorFarmacia(linhas: LinhaDiariaSomada[]) {
  const m = new Map<number, LinhaDiariaSomada[]>();
  for (const l of linhas) {
    const id = Number(l.farmacia_id);
    m.set(id, [...(m.get(id) ?? []), { ...l, atendimentos: Number(l.atendimentos), vendas: Number(l.vendas), receita: Number(l.receita) }]);
  }
  return m;
}

/** Origens da coleta diária no formato que o AgregadorCanais soma. */
const paraLinhasCanal = (linhas: LinhaDiariaSomada[]) => linhas.map((l) => ({
  canal: l.origem, total_atendimentos: l.atendimentos, total_vendas: l.vendas, total_receita_vendas: l.receita,
}));
