import { eq } from 'drizzle-orm';
import { metaTokens, farmacias } from '../database/schema';
import type { MetaToken } from '../meta/types';
import type { BancoDeDados } from '../compartilhado/tipos';

/** Configuração Meta (conta de anúncio + página) de cada farmácia. */
export class TokenMetaRepository {
  constructor(private readonly db: BancoDeDados) {}

  private tokenGlobal(): string {
    return process.env.META_ACCESS_TOKEN ?? '';
  }

  async getTokenPorFarmacia(farmaciaId: number): Promise<MetaToken | null> {
    const accessToken = this.tokenGlobal();
    if (!accessToken) return null;   // sem token global configurado

    const [row] = await this.db
      .select()
      .from(metaTokens)
      .where(eq(metaTokens.farmaciaId, farmaciaId))
      .limit(1);

    if (!row) return null;
    return {
      farmaciaId:  row.farmaciaId,
      accessToken,                   // sempre vem do env (System User do BM)
      adAccountId: row.adAccountId,
      pageId:      row.pageId,
    };
  }

  async upsertToken(data: {
    farmaciaId:  number;
    adAccountId: string;
    pageId:      string;
  }): Promise<void> {
    await this.db
      .insert(metaTokens)
      .values(data)
      .onConflictDoUpdate({
        target: metaTokens.farmaciaId,
        set: {
          adAccountId: data.adAccountId,
          pageId:      data.pageId,
          atualizadoEm: new Date(),
        },
      });
  }

  /** Todas as farmácias que já têm token Meta configurado. */
  async listarClientesComToken(): Promise<Array<{ id: number; nome: string }>> {
    return this.db
      .select({ id: farmacias.id, nome: farmacias.nome })
      .from(farmacias)
      .innerJoin(metaTokens, eq(metaTokens.farmaciaId, farmacias.id))
      .orderBy(farmacias.nome);
  }
}
