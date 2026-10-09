import { Mes } from '../compartilhado/Mes';
import type { GestorRepository } from '../gestores/GestorRepository';
import type { RankingRepository } from './RankingRepository';

export interface PosicaoRanking {
  posicao: number;
  gestor_id: number;
  gestor_nome: string;
  pontos: number;
  total_farmacias: number;
  farmacias_com_coleta: number;
  coletas_no_mes: number;
  /** % das coletas em que alguma meta foi batida. */
  taxa_acerto: number;
  mes: string;
}

/** Ranking mensal dos gestores de tráfego. */
export class RankingService {
  constructor(
    private readonly ranking: RankingRepository,
    private readonly gestores: GestorRepository,
  ) {}

  /**
   * Quem teve coleta no mês entra pela pontuação; quem tem farmácia ativa mas
   * nenhuma coleta entra no fim, zerado. Gestor sem farmácia não aparece.
   */
  async doMes(mes: string | undefined): Promise<PosicaoRanking[]> {
    const mesRef = this.mesReferencia(mes);
    const linhas = await this.ranking.pontuacaoDoMes(mesRef);

    const ranking: PosicaoRanking[] = linhas.map((r, i) => {
      const coletas = parseInt(String(r.coletas_no_mes || 0));
      const pontos  = parseInt(String(r.pontos || 0));
      return {
        posicao: i + 1, gestor_id: r.gestor_id, gestor_nome: r.gestor_nome,
        pontos, total_farmacias: parseInt(String(r.total_farmacias || 0)),
        farmacias_com_coleta: parseInt(String(r.farmacias_com_coleta || 0)),
        coletas_no_mes: coletas,
        taxa_acerto: coletas > 0 ? Math.round(pontos / coletas * 1000) / 10 : 0,
        mes: mesRef.slice(0, 7),
      };
    });

    const comColeta = new Set(linhas.map((r) => r.gestor_id));
    for (const g of await this.gestores.listarAtivosComContagem()) {
      if (comColeta.has(g.id) || !g.farmacias) continue;
      ranking.push({
        posicao: ranking.length + 1, gestor_id: g.id, gestor_nome: g.nome,
        pontos: 0, total_farmacias: g.farmacias, farmacias_com_coleta: 0,
        coletas_no_mes: 0, taxa_acerto: 0, mes: mesRef.slice(0, 7),
      });
    }
    return ranking;
  }

  async historico() {
    return (await this.ranking.historico()).map((r) => ({
      gestor_id: r.gestor_id, gestor_nome: r.gestor_nome, mes: r.mes,
      pontos: parseInt(String(r.pontos || 0)), coletas_no_mes: parseInt(String(r.coletas_no_mes || 0)),
    }));
  }

  /** `AAAA-MM` pedido (ou o mês atual) como data do dia 1. */
  private mesReferencia(mes: string | undefined): string {
    return `${Mes.daQuery(mes)}-01`;
  }
}
