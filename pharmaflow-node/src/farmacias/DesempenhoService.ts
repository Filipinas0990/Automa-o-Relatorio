import type { Gestor } from '../database/schema';
import { Proibido } from '../compartilhado/erros';
import { AgregadorCanais } from './AgregadorCanais';
import type { Linha } from '../compartilhado/tipos';
import type { DesempenhoRepository } from './DesempenhoRepository';
import type { FarmaciaRepository } from './FarmaciaRepository';

export interface FiltrosDesempenho {
  dias?: string;
  /** Só o admin escolhe; gestor comum sempre vê só as dele. */
  gestor_id?: string;
  status?: string;
  busca?: string;
  fase?: string;
}

interface AcaoResumida {
  id: number;
  nome: string;
  tipo: string;
  status: string;
  cor: string | null;
}

const ROTULO_ALERTA: Record<string, string> = { verde: 'Ativa', amarelo: 'Atencao', vermelho: 'Alerta' };

/** Indicadores das farmácias: painel geral, listagem com metas e evolução semanal. */
export class DesempenhoService {
  constructor(
    private readonly desempenho: DesempenhoRepository,
    private readonly farmacias: FarmaciaRepository,
  ) {}

  async painel(quem: Gestor, filtros: FiltrosDesempenho) {
    const gestorId = this.escopo(quem, filtros);
    const dias     = this.dias(filtros);
    const rows     = await this.desempenho.rankingAtual(dias, gestorId);

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
    for (const linha of await this.desempenho.canaisSomados(dias, gestorId)) canais.somar(linha);

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

  /** Farmácias ativas com ranking, metas, canais e as ações do mês de cada uma. */
  async listar(quem: Gestor, filtros: FiltrosDesempenho) {
    const gestorId = this.escopo(quem, filtros);
    const dias     = this.dias(filtros);
    const { status, busca } = filtros;

    const [rows, canais, acoes] = await Promise.all([
      this.desempenho.farmaciasComRanking(dias, gestorId, filtros.fase || null),
      this.canaisPorFarmacia(dias, gestorId),
      this.acoesPorFarmacia(),
    ]);

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
        acoes_ativas: acoes.get(fid) ?? [],
      });
    }
    return resultado;
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

  private async canaisPorFarmacia(dias: number, gestorId: string | null): Promise<Map<number, AgregadorCanais>> {
    const porFarmacia = new Map<number, AgregadorCanais>();
    for (const linha of await this.desempenho.canaisPorFarmacia(dias, gestorId)) {
      const fid = parseInt(linha.farmacia_id);
      if (!porFarmacia.has(fid)) porFarmacia.set(fid, new AgregadorCanais());
      porFarmacia.get(fid)!.somar(linha);
    }
    return porFarmacia;
  }

  private async acoesPorFarmacia(): Promise<Map<number, AcaoResumida[]>> {
    const agora = new Date();
    const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    const porFarmacia = new Map<number, AcaoResumida[]>();
    for (const a of await this.desempenho.acoesDoMes(mes)) {
      const fid = parseInt(a.farmacia_id);
      if (!porFarmacia.has(fid)) porFarmacia.set(fid, []);
      porFarmacia.get(fid)!.push({
        id: parseInt(a.id), nome: a.nome, tipo: a.tipo, status: a.status, cor: a.cor ?? null,
      });
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
