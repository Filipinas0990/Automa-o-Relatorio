import 'dotenv/config';
import { logger } from './logger';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { db }                        from './database/db';
import { farmacias, coletas, coletaCanais } from './database/schema';
import { coletarTodas }              from './scraper/pharmachatbot';
import { calcularScore }             from './processor/score';
import { decrypt }                   from './cripto';
import type { DadosFarmacia, FarmaciaParaColeta } from './types';

async function carregarFarmacias(): Promise<(FarmaciaParaColeta & { dias?: number })[]> {
  const rows = await db.select().from(farmacias).where(
    and(eq(farmacias.ativa, true), isNotNull(farmacias.senhaEnc))
  );
  return rows.map(f => {
    let senha = '';
    try { if (f.senhaEnc) senha = decrypt(f.senhaEnc); } catch { /* sem senha */ }
    return { id: f.id, nome: f.nome, urlBase: f.urlBase, email: f.email, senha };
  });
}

async function coletaAnterior(farmaciaId: number) {
  const [ant] = await db.select().from(coletas)
    .where(eq(coletas.farmaciaId, farmaciaId))
    .orderBy(desc(coletas.dataColeta))
    .limit(1);
  return ant ?? null;
}

async function salvarResultados(dadosColetados: DadosFarmacia[]): Promise<void> {
  for (const dado of dadosColetados) {
    if (dado.erro) { logger.error({ farmacia: dado.nome, erro: dado.erro }, 'Coleta falhou'); continue; }

    const [farmacia] = await db.select().from(farmacias).where(
      and(eq(farmacias.nome, dado.nome), eq(farmacias.ativa, true))
    );
    if (!farmacia) { logger.warn({ farmacia: dado.nome }, 'Farmácia não encontrada no banco'); continue; }

    const anterior = await coletaAnterior(farmacia.id);
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

    const [coleta] = await db.insert(coletas).values({
      farmaciaId:           farmacia.id,
      periodoInicio:        dado.periodoInicio,
      periodoFim:           dado.periodoFim,
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

export async function pipeline(): Promise<void> {
  logger.info('Pipeline iniciado');

  const farmsAtivas = await carregarFarmacias();
  logger.info({ total: farmsAtivas.length }, 'Farmácias ativas carregadas');

  const paralelo   = parseInt(process.env.PARALELO_MAX || '1', 10);
  const resultados = await coletarTodas(farmsAtivas, paralelo);

  await salvarResultados(resultados);

  const erros    = resultados.filter(r => r.erro);
  const sucessos = resultados.length - erros.length;
  logger.info({ sucessos, erros: erros.length, total: resultados.length }, 'Pipeline concluído');
}
