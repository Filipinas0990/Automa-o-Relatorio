import type { Gestor } from '../database/schema';
import type { Linha } from '../compartilhado/tipos';
import type { DashboardRepository } from './DashboardRepository';

const int = (v: unknown) => parseInt(String(v || 0));

/** % com uma casa decimal; 0 quando não há total. */
function percentual(parte: number, total: number): number {
  return total > 0 ? Math.round(parte / total * 1000) / 10 : 0;
}

/** Variação % entre a última semana e um quarto do último mês; null sem base. */
function variacaoSemanal(semana: number | undefined, mes: number | undefined): number | null {
  if (semana === undefined || !mes) return null;
  return Math.round((semana / (mes / 4) - 1) * 1000) / 10;
}

const CORES_STATUS = [
  { chave: 'realizadas',  status: 'Realizadas',  cor: '#10B981' },
  { chave: 'canceladas',  status: 'Canceladas',  cor: '#EF4444' },
  { chave: 'confirmadas', status: 'Confirmadas', cor: '#3B82F6' },
  { chave: 'agendadas',   status: 'Agendadas',   cor: '#F59E0B' },
] as const;

/** Gráficos do dashboard: evolução de vendas e reuniões perdidas. */
export class DashboardService {
  constructor(private readonly dashboard: DashboardRepository) {}

  /** Séries de 7 e 30 dias. Admin pode filtrar por gestor; gestor comum vê só as dele. */
  async evolucao(quem: Gestor, gestorPedido: string | undefined) {
    const gestorId = quem.isAdmin ? (gestorPedido ? parseInt(gestorPedido) : null) : quem.id;
    const linhas   = await this.dashboard.vendasPorDia(gestorId);

    const ponto = (r: Linha) => ({
      data:         String(r.data),
      vendas:       int(r.vendas),
      receita:      parseFloat(r.receita || 0),
      atendimentos: int(r.atendimentos),
    });
    const serie7d  = linhas.filter((r) => int(r.periodo_dias) === 7).map(ponto);
    const serie30d = linhas.filter((r) => int(r.periodo_dias) === 30).map(ponto);
    const ultimo7d  = serie7d[serie7d.length - 1] ?? null;
    const ultimo30d = serie30d[serie30d.length - 1] ?? null;

    return {
      serie_7d:   serie7d,
      serie_30d:  serie30d,
      ultimo_7d:  ultimo7d,
      ultimo_30d: ultimo30d,
      // A última semana comparada com a proporção equivalente do mês (30d / 4)
      variacao_vendas:  ultimo7d && ultimo30d ? variacaoSemanal(ultimo7d.vendas,  ultimo30d.vendas)  : null,
      variacao_receita: ultimo7d && ultimo30d ? variacaoSemanal(ultimo7d.receita, ultimo30d.receita) : null,
    };
  }

  /** Reuniões canceladas ("perdidas"): total, por farmácia e por mês. */
  async reunioesPerdidas(quem: Gestor) {
    const gestorId = quem.isAdmin ? null : quem.id;
    const [s, porFarmacia, porMes] = await Promise.all([
      this.dashboard.reunioesPorStatus(gestorId),
      this.dashboard.reunioesPorFarmacia(gestorId),
      this.dashboard.reunioesPorMes(gestorId),
    ]);

    const totais = {
      total:       int(s.total),
      realizadas:  int(s.realizadas),
      canceladas:  int(s.canceladas),
      confirmadas: int(s.confirmadas),
      agendadas:   int(s.agendadas),
    };

    return {
      ...totais,
      taxa_realizacao: percentual(totais.realizadas, totais.total),
      taxa_perda:      percentual(totais.canceladas, totais.total),
      // Donut: só os status que têm reunião
      distribuicao: CORES_STATUS
        .map(({ chave, status, cor }) => ({ status, valor: totais[chave], cor }))
        .filter((d) => d.valor > 0),
      por_farmacia: porFarmacia.map((r) => ({
        farmacia_nome: r.farmacia_nome,
        total:         int(r.total),
        realizadas:    int(r.realizadas),
        canceladas:    int(r.canceladas),
        pendentes:     int(r.pendentes),
        taxa_perda:    percentual(int(r.canceladas), int(r.total)),
      })),
      evolucao_mensal: porMes.map((r) => ({
        mes:        r.mes,
        total:      int(r.total),
        realizadas: int(r.realizadas),
        canceladas: int(r.canceladas),
        taxa_perda: percentual(int(r.canceladas), int(r.total)),
      })),
    };
  }
}
