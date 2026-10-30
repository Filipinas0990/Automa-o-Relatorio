import { eq, and, inArray, desc, gte } from 'drizzle-orm';
import { campanhasMeta, farmacias } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';

/** Retorna a segunda-feira da semana atual às 00:00 no horário de Brasília */
function inicioDaSemana(): Date {
  const agora = new Date();
  // Ajusta para BRT (UTC-3)
  const brt = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const diaSemana = brt.getUTCDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  const diasAtrasAteSegunda = diaSemana === 0 ? 6 : diaSemana - 1;
  brt.setUTCDate(brt.getUTCDate() - diasAtrasAteSegunda);
  brt.setUTCHours(0, 0, 0, 0);
  // Converte de volta para UTC
  return new Date(brt.getTime() + 3 * 60 * 60 * 1000);
}

/** Campanhas criadas via o bot de ads (WhatsApp/Web): pendentes, publicadas, canceladas. */
export class CampanhaPendenteRepository {
  constructor(private readonly db: BancoDeDados) {}

  async criarPendente(dados: {
    farmaciaId:    number;
    gestorTelefone: string;
    payloadJson:   unknown;
    imagemBase64?: string;
  }): Promise<number> {
    // Cancela qualquer pendente anterior deste gestor antes de criar novo
    await this.db
      .update(campanhasMeta)
      .set({ status: 'cancelada', atualizadoEm: new Date() })
      .where(
        and(
          eq(campanhasMeta.gestorTelefone, dados.gestorTelefone),
          eq(campanhasMeta.status, 'aguardando_confirmacao'),
        ),
      );

    const [row] = await this.db
      .insert(campanhasMeta)
      .values({
        farmaciaId:     dados.farmaciaId,
        gestorTelefone: dados.gestorTelefone,
        status:         'aguardando_confirmacao',
        payloadJson:    JSON.stringify(dados.payloadJson),
        imagemBase64:   dados.imagemBase64 ?? null,
      })
      .returning({ id: campanhasMeta.id });

    return row.id;
  }

  async getPendente(gestorTelefone: string) {
    const [row] = await this.db
      .select()
      .from(campanhasMeta)
      .where(
        and(
          eq(campanhasMeta.gestorTelefone, gestorTelefone),
          eq(campanhasMeta.status, 'aguardando_confirmacao'),
        ),
      )
      .orderBy(desc(campanhasMeta.criadoEm))  // mais recente primeiro
      .limit(1);

    return row ?? null;
  }

  /** Lista campanhas PUBLICADAS da semana atual das farmácias do gestor */
  async getCampanhasPorGestor(gestorId: number) {
    const farms = await this.db
      .select({ id: farmacias.id, nome: farmacias.nome })
      .from(farmacias)
      .where(eq(farmacias.gestorId, gestorId));

    if (farms.length === 0) return [];

    const farmaciaIds = farms.map((f) => f.id);
    const semanaInicio = inicioDaSemana();

    const campanhas = await this.db
      .select({
        id:             campanhasMeta.id,
        farmaciaId:     campanhasMeta.farmaciaId,
        farmaciaInfo:   farmacias.nome,
        status:         campanhasMeta.status,
        payloadJson:    campanhasMeta.payloadJson,
        metaCampanhaId: campanhasMeta.metaCampanhaId,
        metaConjuntoId: campanhasMeta.metaConjuntoId,
        metaAnuncioId:  campanhasMeta.metaAnuncioId,
        criadoEm:       campanhasMeta.criadoEm,
        atualizadoEm:   campanhasMeta.atualizadoEm,
      })
      .from(campanhasMeta)
      .innerJoin(farmacias, eq(farmacias.id, campanhasMeta.farmaciaId))
      .where(
        and(
          inArray(campanhasMeta.farmaciaId, farmaciaIds),
          eq(campanhasMeta.status, 'publicada'),
          gte(campanhasMeta.criadoEm, semanaInicio),
        ),
      )
      .orderBy(desc(campanhasMeta.criadoEm));

    return campanhas.map((c) => {
      const payload = JSON.parse(c.payloadJson as string);
      return {
        id:             c.id,
        farmaciaId:     c.farmaciaId,
        farmaciaInfo:   c.farmaciaInfo,
        status:         c.status,
        clienteNome:    payload.clienteNome ?? null,
        objetivo:       payload.objetivo ?? null,
        orcamentoDiario: payload.orcamentoDiario ?? null,
        dataInicio:     payload.dataInicio ?? null,
        dataFim:        payload.dataFim ?? null,
        metaCampanhaId: c.metaCampanhaId,
        criadoEm:       c.criadoEm,
      };
    });
  }

  async atualizarStatus(
    id:     number,
    status: 'publicada' | 'cancelada' | 'erro',
    meta?:  { campanhaId: string; conjuntoId: string; anuncioId: string },
  ): Promise<void> {
    await this.db
      .update(campanhasMeta)
      .set({
        status,
        metaCampanhaId: meta?.campanhaId ?? null,
        metaConjuntoId: meta?.conjuntoId ?? null,
        metaAnuncioId:  meta?.anuncioId  ?? null,
        atualizadoEm:   new Date(),
      })
      .where(eq(campanhasMeta.id, id));
  }
}
