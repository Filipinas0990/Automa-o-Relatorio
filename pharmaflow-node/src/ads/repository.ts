import { eq, and, inArray, notInArray, desc, gte, sql } from 'drizzle-orm';
import { db } from '../database/db';
import {
  metaTokens, campanhasMeta, farmacias, gestoresTrafego,
  contasAnuncioCache, contasAnuncioCacheSync,
} from '../database/schema';
import type { MetaToken } from '../meta/types';
import type { ContaAnuncio } from '../meta/client';

// ── Meta Tokens por cliente ───────────────────────────────────────────────────

const getGlobalToken = () => process.env.META_ACCESS_TOKEN ?? '';

export async function getTokenPorFarmacia(farmaciaId: number): Promise<MetaToken | null> {
  const accessToken = getGlobalToken();
  if (!accessToken) return null;   // sem token global configurado

  const [row] = await db
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

export async function upsertToken(data: {
  farmaciaId:  number;
  adAccountId: string;
  pageId:      string;
}): Promise<void> {
  await db
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

// ── Campanhas pendentes / criadas ─────────────────────────────────────────────

export async function criarCampanhaPendente(dados: {
  farmaciaId:    number;
  gestorTelefone: string;
  payloadJson:   unknown;
  imagemBase64?: string;
}): Promise<number> {
  // Cancela qualquer pendente anterior deste gestor antes de criar novo
  await db
    .update(campanhasMeta)
    .set({ status: 'cancelada', atualizadoEm: new Date() })
    .where(
      and(
        eq(campanhasMeta.gestorTelefone, dados.gestorTelefone),
        eq(campanhasMeta.status, 'aguardando_confirmacao'),
      ),
    );

  const [row] = await db
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

export async function getCampanhaPendente(gestorTelefone: string) {
  const [row] = await db
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

/** Lista campanhas PUBLICADAS da semana atual das farmácias do gestor */
export async function getCampanhasPorGestor(gestorId: number) {
  const farms = await db
    .select({ id: farmacias.id, nome: farmacias.nome })
    .from(farmacias)
    .where(eq(farmacias.gestorId, gestorId));

  if (farms.length === 0) return [];

  const farmaciaIds = farms.map((f) => f.id);
  const semanaInicio = inicioDaSemana();

  const campanhas = await db
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

/** Lista todas as farmácias que já têm token Meta configurado */
export async function listarClientesComToken(): Promise<Array<{ id: number; nome: string }>> {
  const rows = await db
    .select({ id: farmacias.id, nome: farmacias.nome })
    .from(farmacias)
    .innerJoin(metaTokens, eq(metaTokens.farmaciaId, farmacias.id))
    .orderBy(farmacias.nome);

  return rows;
}

export async function atualizarStatusCampanha(
  id:     number,
  status: 'publicada' | 'cancelada' | 'erro',
  meta?:  { campanhaId: string; conjuntoId: string; anuncioId: string },
): Promise<void> {
  await db
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

// ── Cache das contas de anúncio (migration 0032) ──────────────────────────────

/** As contas salvas no último sync, já na ordem em que a tela mostra. */
export async function listarContasCache(): Promise<ContaAnuncio[]> {
  const rows = await db.select().from(contasAnuncioCache);
  return rows
    .map((r) => ({
      id:             r.id,
      accountId:      r.accountId,
      nome:           r.nome,
      cliente:        r.cliente,
      moeda:          r.moeda,
      status:         r.status,
      ativa:          r.ativa,
      temPagamento:   r.temPagamento,
      formaPagamento: r.formaPagamento,
    }))
    // Ordena aqui, e não no ORDER BY: a collation do banco joga nome acentuado
    // ("Ótica", "Água") para o fim da lista.
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Quando a lista inteira foi sincronizada (null = nunca). */
export async function getSyncContas(): Promise<{ sincronizadoEm: Date; erro: string | null } | null> {
  const [row] = await db.select().from(contasAnuncioCacheSync)
    .where(eq(contasAnuncioCacheSync.id, 1));
  return row ? { sincronizadoEm: row.sincronizadoEm, erro: row.erro } : null;
}

/**
 * Substitui o cache pela lista recém-lida na Meta.
 *
 * Numa transação: some quem saiu do BM, entra/atualiza o resto e o carimbo de
 * sincronização — assim ninguém lê um estado pela metade.
 */
export async function salvarContasCache(contas: ContaAnuncio[]): Promise<Date> {
  const agora = new Date();

  await db.transaction(async (tx) => {
    const ids = contas.map((c) => c.id);
    await tx.delete(contasAnuncioCache).where(
      ids.length > 0 ? notInArray(contasAnuncioCache.id, ids) : undefined,
    );

    if (contas.length > 0) {
      await tx.insert(contasAnuncioCache)
        .values(contas.map((c) => ({
          id:             c.id,
          accountId:      c.accountId,
          nome:           c.nome,
          cliente:        c.cliente,
          moeda:          c.moeda,
          status:         c.status,
          ativa:          c.ativa,
          temPagamento:   c.temPagamento,
          formaPagamento: c.formaPagamento,
          atualizadoEm:   agora,
        })))
        .onConflictDoUpdate({
          target: contasAnuncioCache.id,
          set: {
            accountId:      sql`excluded.account_id`,
            nome:           sql`excluded.nome`,
            cliente:        sql`excluded.cliente`,
            moeda:          sql`excluded.moeda`,
            status:         sql`excluded.status`,
            ativa:          sql`excluded.ativa`,
            temPagamento:   sql`excluded.tem_pagamento`,
            formaPagamento: sql`excluded.forma_pagamento`,
            atualizadoEm:   agora,
          },
        });
    }

    await tx.insert(contasAnuncioCacheSync)
      .values({ id: 1, sincronizadoEm: agora, erro: null })
      .onConflictDoUpdate({
        target: contasAnuncioCacheSync.id,
        set:    { sincronizadoEm: agora, erro: null },
      });
  });

  return agora;
}

/**
 * Marca que o sync falhou, sem apagar o cache: é melhor mostrar a lista de 40
 * min atrás do que uma tela vazia porque a Meta estava fora do ar.
 *
 * De propósito só ATUALIZA: sem sync anterior não existe lista antiga para
 * exibir, e criar o registro aqui faria a próxima consulta achar que o cache
 * está fresco e devolver "nenhuma conta" em vez do erro.
 */
export async function registrarErroSyncContas(erro: string): Promise<void> {
  await db.update(contasAnuncioCacheSync)
    .set({ erro })
    .where(eq(contasAnuncioCacheSync.id, 1));
}
