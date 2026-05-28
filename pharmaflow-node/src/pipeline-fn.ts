import 'dotenv/config';
import { logger } from './logger';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { db }                        from './database/db';
import { farmacias, coletas, coletaCanais } from './database/schema';
import { coletarTodas }              from './scraper/pharmachatbot';
import { calcularScore }             from './processor/score';
import { decrypt }                   from './cripto';
import type { DadosFarmacia, FarmaciaParaColeta } from './types';

async function carregarFarmacias(gestorId?: number): Promise<(FarmaciaParaColeta & { dias?: number })[]> {
  const rows = await db.select().from(farmacias).where(
    and(
      eq(farmacias.ativa, true),
      eq(farmacias.temChatbot, true),   // pula farmácias sem chatbot
      isNotNull(farmacias.senhaEnc),
      ...(gestorId ? [eq(farmacias.gestorId, gestorId)] : []),
    )
  );
  return rows.map(f => {
    let senha = '';
    try { if (f.senhaEnc) senha = decrypt(f.senhaEnc); } catch { /* sem senha */ }
    return {
      id: f.id, nome: f.nome,
      urlBase: f.urlBase ?? '',   // sempre não-null para farmácias com chatbot
      email:   f.email   ?? '',
      senha,
      metaLeadsGoogle: f.metaLeadsGoogle ?? null,
      metaLeadsMeta:   f.metaLeadsMeta   ?? null,
    };
  });
}

export interface PipelineOpcoes {
  periodos?: number[];  // default [7, 15, 30]
  gestorId?: number;    // default: todas as farmácias
}

// Retorna quantas farmácias seriam coletadas sem disparar nada
export async function previewPipeline(opcoes: PipelineOpcoes = {}): Promise<{ farmaciasTotais: number; nomes: string[]; periodos: number[] }> {
  const periodos = opcoes.periodos?.length ? opcoes.periodos : [7, 15, 30];
  const farms = await carregarFarmacias(opcoes.gestorId);
  return { farmaciasTotais: farms.length, nomes: farms.map(f => f.nome), periodos };
}

async function coletaAnterior(farmaciaId: number, periodoDias: number) {
  const [ant] = await db.select().from(coletas)
    .where(and(eq(coletas.farmaciaId, farmaciaId), eq(coletas.periodoDias, periodoDias)))
    .orderBy(desc(coletas.dataColeta))
    .limit(1);
  return ant ?? null;
}

async function salvarResultados(dadosColetados: DadosFarmacia[], periodoDias: number): Promise<void> {
  for (const dado of dadosColetados) {
    if (dado.erro) { logger.error({ farmacia: dado.nome, erro: dado.erro }, 'Coleta falhou'); continue; }

    const [farmacia] = await db.select().from(farmacias).where(
      and(eq(farmacias.nome, dado.nome), eq(farmacias.ativa, true))
    );
    if (!farmacia) { logger.warn({ farmacia: dado.nome }, 'Farmácia não encontrada no banco'); continue; }

    const anterior = await coletaAnterior(farmacia.id, periodoDias);
    const metricasAnterior = anterior ? {
      clientesGoogle:       anterior.clientesGoogle       ?? 0,
      clientesFacebook:     anterior.clientesFacebook     ?? 0,
      clientesGruposOferta: anterior.clientesGruposOferta ?? 0,
      vendasRealizadas:     anterior.vendasRealizadas     ?? 0,
      receitaTotal:         parseFloat(anterior.receitaTotal ?? '0'),
    } : null;

    const scoreInfo = calcularScore(
      {
        clientesGoogle:       dado.clientesGoogle,
        clientesFacebook:     dado.clientesFacebook,
        clientesGruposOferta: dado.clientesGruposOferta,
        vendasRealizadas:     dado.vendasRealizadas,
        receitaTotal:         dado.receitaTotal,
      },
      metricasAnterior
    );

    const metaR = farmacia.metaReceita ? parseFloat(farmacia.metaReceita) : null;
    const atingiuMeta = metaR !== null ? dado.receitaTotal >= metaR : false;
    if (metaR !== null && !atingiuMeta) {
      scoreInfo.nivelAlerta = 'vermelho';
      if (scoreInfo.scoreCriticidade < 50) scoreInfo.scoreCriticidade = 50;
      scoreInfo.alertas.push('Meta semanal não atingida');
    }

    // Metas de leads por canal (só Google e Meta)
    const atingiuMetaGoogle = farmacia.metaLeadsGoogle !== null
      ? dado.clientesGoogle >= (farmacia.metaLeadsGoogle ?? 0)
      : null;
    const atingiuMetaMeta = farmacia.metaLeadsMeta !== null
      ? dado.clientesFacebook >= (farmacia.metaLeadsMeta ?? 0)
      : null;

    const [coleta] = await db.insert(coletas).values({
      farmaciaId:           farmacia.id,
      periodoInicio:        dado.periodoInicio,
      periodoFim:           dado.periodoFim,
      periodoDias,
      clientesGoogle:       dado.clientesGoogle,
      clientesFacebook:     dado.clientesFacebook,
      clientesGruposOferta: dado.clientesGruposOferta,
      totalAtendimentos:    dado.totalAtendimentos,
      vendasRealizadas:     dado.vendasRealizadas,
      receitaTotal:         String(dado.receitaTotal),
      scoreCriticidade:     String(scoreInfo.scoreCriticidade),
      nivelAlerta:          scoreInfo.nivelAlerta,
      variacaoGoogle:       String(scoreInfo.variacaoGoogle),
      variacaoFacebook:     String(scoreInfo.variacaoFacebook),
      variacaoGrupos:       String(scoreInfo.variacaoGrupos),
      variacaoVendas:       String(scoreInfo.variacaoVendas),
      variacaoReceita:      String(scoreInfo.variacaoReceita),
      atingiuMeta,
      atingiuMetaGoogle,
      atingiuMetaMeta,
    }).returning({ id: coletas.id });

    const vendasPorCanal: Record<string, { vendas: number; receita: number }> = {};
    for (const [k, v] of Object.entries(dado.canaisVendas || {})) {
      vendasPorCanal[k.trim().toLowerCase()] = v;
    }
    function matchCanal(nomePizza: string): { vendas?: number; receita?: number } {
      const chave = nomePizza.trim().toLowerCase();
      if (vendasPorCanal[chave]) return vendasPorCanal[chave];
      for (const [k, v] of Object.entries(vendasPorCanal)) {
        if (k.split(' ').some(t => t.length > 3 && chave.includes(t))) return v;
      }
      return {};
    }

    // Salva apenas os canais do gráfico de pizza (canais reais de marketing)
    // canaisVendas é usado apenas para enriquecer com dados de vendas/receita
    for (const [nome, totalAtend] of Object.entries(dado.canais || {})) {
      const info = matchCanal(nome);
      await db.insert(coletaCanais).values({
        coletaId:      coleta.id,
        canal:         nome,
        atendimentos:  totalAtend,
        vendas:        info.vendas  || 0,
        receitaVendas: String(info.receita || 0),
      });
    }

    logger.info({
      farmacia:    dado.nome,
      nivelAlerta: scoreInfo.nivelAlerta,
      score:       scoreInfo.scoreCriticidade,
      alertas:     scoreInfo.alertas,
      atingiuMeta,
      receita:     dado.receitaTotal,
      vendas:      dado.vendasRealizadas,
    }, 'Coleta salva');
  }
}

export async function pipeline(opcoes: PipelineOpcoes = {}): Promise<{ totalSucessos: number; totalErros: number; farmaciasTotais: number }> {
  const periodos    = opcoes.periodos?.length ? opcoes.periodos : [7, 15, 30];
  const farmsAtivas = await carregarFarmacias(opcoes.gestorId);

  logger.info({ total: farmsAtivas.length, periodos, gestorId: opcoes.gestorId }, 'Pipeline iniciado');

  const paralelo = parseInt(process.env.PARALELO_MAX || '1', 10);

  let totalSucessos = 0;
  let totalErros    = 0;

  for (const dias of periodos) {
    logger.info({ dias }, `Coletando período de ${dias} dias`);
    const farmsComPeriodo = farmsAtivas.map(f => ({ ...f, dias }));
    const resultados = await coletarTodas(farmsComPeriodo, paralelo);
    await salvarResultados(resultados, dias);
    const erros = resultados.filter(r => r.erro);
    totalSucessos += resultados.length - erros.length;
    totalErros    += erros.length;
    logger.info({ dias, sucessos: resultados.length - erros.length, erros: erros.length }, `Período ${dias}d concluído`);
  }

  logger.info({ totalSucessos, totalErros }, 'Pipeline concluído');
  return { totalSucessos, totalErros, farmaciasTotais: farmsAtivas.length };
}
