import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { coletaCanais, coletas, farmacias } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';
import type {
  FarmaciaVinculada, GravadorDeColetas, LeitorDeVinculos, NovaColeta, NovoCanal,
} from './contratos';

const numOuNull = (v: string | null) => (v == null ? null : Number(v));

/** Farmácias vinculadas ao PharmaChatbot e gravação em coletas / coleta_canais. */
export class ColetaRepository implements LeitorDeVinculos, GravadorDeColetas {
  constructor(private readonly db: BancoDeDados) {}

  async farmaciasVinculadas(): Promise<FarmaciaVinculada[]> {
    const linhas = await this.db
      .select({
        id: farmacias.id, nome: farmacias.nome,
        tenant: farmacias.pcTenant, companyId: farmacias.pcCompanyId,
        metaReceita: farmacias.metaReceita,
        metaLeadsGoogle: farmacias.metaLeadsGoogle, metaLeadsMeta: farmacias.metaLeadsMeta,
      })
      .from(farmacias)
      .where(and(
        eq(farmacias.ativa, true), eq(farmacias.fase, 'ativo'),
        isNotNull(farmacias.pcTenant), isNotNull(farmacias.pcCompanyId),
      ));
    return linhas.map((f) => ({
      ...f,
      tenant: f.tenant!,
      companyId: f.companyId!,
      metaReceita: numOuNull(f.metaReceita),
    }));
  }

  async substituir(coleta: NovaColeta, canais: NovoCanal[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const antigas = await tx.select({ id: coletas.id }).from(coletas).where(and(
        eq(coletas.farmaciaId, coleta.farmaciaId),
        eq(coletas.periodoDias, coleta.periodoDias),
        eq(coletas.periodoFim, coleta.periodoFim),
      ));
      const ids = antigas.map((c) => c.id);
      if (ids.length) {
        await tx.delete(coletaCanais).where(inArray(coletaCanais.coletaId, ids));
        await tx.delete(coletas).where(inArray(coletas.id, ids));
      }

      const [nova] = await tx.insert(coletas).values({
        ...coleta,
        receitaTotal:     String(coleta.receitaTotal),
        variacaoGoogle:   String(coleta.variacaoGoogle),
        variacaoFacebook: String(coleta.variacaoFacebook),
        variacaoGrupos:   String(coleta.variacaoGrupos),
        variacaoVendas:   String(coleta.variacaoVendas),
        variacaoReceita:  String(coleta.variacaoReceita),
        scoreCriticidade: String(coleta.scoreCriticidade),
      }).returning({ id: coletas.id });

      if (canais.length) {
        await tx.insert(coletaCanais).values(canais.map((c) => ({
          coletaId: nova.id, canal: c.canal.slice(0, 80),
          atendimentos: c.atendimentos, vendas: c.vendas, receitaVendas: String(c.receitaVendas),
        })));
      }
    });
  }
}
