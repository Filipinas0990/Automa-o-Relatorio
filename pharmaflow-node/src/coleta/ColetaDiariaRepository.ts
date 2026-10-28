import { and, gte, inArray, lte, max } from 'drizzle-orm';
import { coletaDiaria } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';
import type { DiaGravado, RepositorioDiario } from './contratos';

/** Leitura e gravação da coleta dia a dia (`coleta_diaria`). */
export class ColetaDiariaRepository implements RepositorioDiario {
  constructor(private readonly db: BancoDeDados) {}

  async substituirDias(farmaciaIds: number[], inicio: string, fim: string, dias: DiaGravado[]): Promise<void> {
    if (!farmaciaIds.length) return;
    await this.db.transaction(async (tx) => {
      await tx.delete(coletaDiaria).where(and(
        inArray(coletaDiaria.farmaciaId, farmaciaIds),
        gte(coletaDiaria.dia, inicio),
        lte(coletaDiaria.dia, fim),
      ));
      // Lotes de 1.000 para não passar do limite de parâmetros do Postgres
      for (let i = 0; i < dias.length; i += 1000) {
        await tx.insert(coletaDiaria).values(dias.slice(i, i + 1000).map((d) => ({
          farmaciaId: d.farmaciaId, dia: d.dia, origem: d.origem.slice(0, 80),
          atendimentos: d.atendimentos, vendas: d.vendas, receita: String(d.receita),
        })));
      }
    });
  }

  async dias(inicio: string, fim: string): Promise<DiaGravado[]> {
    const linhas = await this.db.select({
      farmaciaId: coletaDiaria.farmaciaId, dia: coletaDiaria.dia, origem: coletaDiaria.origem,
      atendimentos: coletaDiaria.atendimentos, vendas: coletaDiaria.vendas, receita: coletaDiaria.receita,
    }).from(coletaDiaria).where(and(gte(coletaDiaria.dia, inicio), lte(coletaDiaria.dia, fim)));
    return linhas.map((l) => ({ ...l, receita: Number(l.receita) }));
  }

  async ultimoDia(): Promise<string | null> {
    const [r] = await this.db.select({ ultimo: max(coletaDiaria.dia) }).from(coletaDiaria);
    return r?.ultimo ?? null;
  }
}
